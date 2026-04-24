import type { SubspaceContext } from "../context.js";
import { loadMigrationConfig } from "../migrate/config.js";
import { buildMigrationPlan } from "../migrate/terraspace/plan.js";
import { backendConfigFlags, detectBackend, type BackendType } from "./backend.js";

const INIT_REQUIRED_PATTERNS = [
	/terraform init/i,
	/tofu init/i,
	/run.*init/i,
	/backend initialization required/i,
	/provider.*not installed/i,
	/Module not installed/i,
];

const RECONFIGURE_REQUIRED_PATTERNS = [
	/Backend configuration changed/i,
	/backend has changed/i,
	/reinitialization required/i,
	/-reconfigure/i,
];

const MIGRATE_STATE_REQUIRED_PATTERNS = [/-migrate-state/i];

/**
 * Run an engine command with init-when-needed semantics.
 *
 * 1. If a Terraspace migration config exists and the backend is s3,
 *    init reuses the existing Terraspace bucket/key instead of
 *    relocating state.
 * 2. If .terraform/ is missing in buildDir, run init first.
 * 3. Run the requested command.
 * 4. If it fails with an "init required" pattern in stderr, run init
 *    and retry once.
 * 5. Return the engine's exit code.
 */
export async function invokeEngine(
	ctx: SubspaceContext,
	buildDir: string,
	command: string,
	stack: string,
	env: string,
	region: string,
): Promise<number> {
	const backend = await detectBackend(ctx, buildDir);

	const terraformDirExists = await ctx.fs.exists(`${buildDir}/.terraform`);

	if (!terraformDirExists) {
		ctx.log.info("Running init (no .terraform directory found)...");
		const initResult = await runInitWithReconfigureFallback(
			ctx,
			buildDir,
			stack,
			env,
			region,
			backend,
		);
		if (initResult !== 0) return initResult;
	}

	const result = await runEngineCommand(ctx, buildDir, command);

	if (result.exitCode === 0) return 0;

	if (isMigrateStateRequired(result.stderr)) {
		ctx.log.error(
			"Backend requires `-migrate-state` to merge existing state. Subspace will not auto-merge state (risk of clobbering). Run `tofu init -migrate-state` (or equivalent) manually to proceed.",
		);
		return result.exitCode;
	}

	if (isReconfigureRequired(result.stderr)) {
		ctx.log.info(
			"Backend configuration changed; re-running init with -reconfigure...",
		);
		const initResult = await runInit(
			ctx,
			buildDir,
			stack,
			env,
			region,
			backend,
			["-reconfigure"],
		);
		if (initResult !== 0) return initResult;
		const retry = await runEngineCommand(ctx, buildDir, command);
		return retry.exitCode;
	}

	if (isInitRequired(result.stderr)) {
		ctx.log.info("Init required, running init...");
		const initResult = await runInitWithReconfigureFallback(
			ctx,
			buildDir,
			stack,
			env,
			region,
			backend,
		);
		if (initResult !== 0) return initResult;
		const retry = await runEngineCommand(ctx, buildDir, command);
		return retry.exitCode;
	}

	return result.exitCode;
}

async function runInitWithReconfigureFallback(
	ctx: SubspaceContext,
	buildDir: string,
	stack: string,
	env: string,
	region: string,
	backend: BackendType,
): Promise<number> {
	const first = await runInitCapturing(ctx, buildDir, stack, env, region, backend, []);
	if (first.exitCode === 0) return 0;
	if (isMigrateStateRequired(first.stderr)) {
		ctx.log.error(
			"Backend requires `-migrate-state`; Subspace will not auto-merge. Run init manually with `-migrate-state`.",
		);
		return first.exitCode;
	}
	if (!isReconfigureRequired(first.stderr)) return first.exitCode;

	ctx.log.info(
		"Backend configuration changed on init; retrying with -reconfigure...",
	);
	const second = await runInitCapturing(
		ctx,
		buildDir,
		stack,
		env,
		region,
		backend,
		["-reconfigure"],
	);
	return second.exitCode;
}

async function resolveAwsAccount(
	ctx: SubspaceContext,
): Promise<string | null> {
	const result = await ctx.exec("aws", [
		"sts",
		"get-caller-identity",
		"--output=json",
	]);
	if (result.exitCode !== 0) return null;
	try {
		const parsed = JSON.parse(result.stdout) as { Account?: string };
		return parsed.Account ?? null;
	} catch {
		return null;
	}
}

async function runInit(
	ctx: SubspaceContext,
	buildDir: string,
	stack: string,
	env: string,
	region: string,
	backend: BackendType,
	extraFlags: string[] = [],
): Promise<number> {
	const result = await runInitCapturing(
		ctx,
		buildDir,
		stack,
		env,
		region,
		backend,
		extraFlags,
	);
	return result.exitCode;
}

async function runInitCapturing(
	ctx: SubspaceContext,
	buildDir: string,
	stack: string,
	env: string,
	region: string,
	backend: BackendType,
	extraFlags: string[],
): Promise<{ exitCode: number; stderr: string }> {
	const configFlags = await resolveBackendConfigFlags(
		ctx,
		backend,
		stack,
		env,
		region,
	);
	const args = [
		`-chdir=${buildDir}`,
		"init",
		...extraFlags,
		...configFlags,
	];
	return ctx.execStream(ctx.engine, args);
}

async function resolveBackendConfigFlags(
	ctx: SubspaceContext,
	backend: BackendType,
	stack: string,
	env: string,
	region: string,
): Promise<string[]> {
	const defaultFlags = backendConfigFlags(
		backend,
		stack,
		env,
		region,
		appNameFromCwd(ctx.cwd),
	);

	const migration = await loadMigrationConfig(ctx);
	if (!migration || !migration.terraspace) return defaultFlags;

	if (backend === "gcs" || backend === "azurerm") {
		ctx.log.warn(
			`[migration] preserving the existing remote state location is only implemented for S3; backend "${backend}" will use the standard Subspace backend config.`,
		);
		return defaultFlags;
	}
	if (backend !== "s3") return defaultFlags;

	const account = await resolveAwsAccount(ctx);
	if (!account) {
		ctx.log.warn(
			"[migration] could not resolve AWS account id; falling back to the standard Subspace backend config.",
		);
		return defaultFlags;
	}

	const ts = migration.terraspace;
	const plan = buildMigrationPlan({
		stacks: [stack],
		envs: [env],
		regions: [region],
		templates: { bucket: ts.bucketTemplate, key: ts.keyTemplate },
		account,
		project: ts.project,
		appName: ts.appName,
		role: ts.role,
		app: ts.app,
	});
	const entry = plan.entries[0];
	if (!entry) return defaultFlags;

	ctx.log.info(
		`[migration] using existing Terraspace state location s3://${entry.native.bucket}/${entry.native.key}`,
	);

	return backendConfigFlags(backend, stack, env, region, appNameFromCwd(ctx.cwd), {
		bucket: entry.native.bucket,
		key: entry.native.key,
	});
}

function appNameFromCwd(cwd: string): string {
	const parts = cwd.split(/[/\\]/).filter(Boolean);
	const app = parts.at(-1) ?? "subspace";
	return app;
}

async function runEngineCommand(
	ctx: SubspaceContext,
	buildDir: string,
	command: string,
): Promise<{ exitCode: number; stderr: string }> {
	const args = [
		`-chdir=${buildDir}`,
		command,
		...nonInteractiveInputArgs(ctx.engineArgs),
		...ctx.engineArgs,
	];
	return ctx.execStream(ctx.engine, args);
}

function nonInteractiveInputArgs(engineArgs: string[]): string[] {
	return hasInputFlag(engineArgs) ? [] : ["-input=false"];
}

function hasInputFlag(engineArgs: string[]): boolean {
	return engineArgs.some(
		(arg) => arg === "-input" || arg.startsWith("-input="),
	);
}

function isInitRequired(stderr: string): boolean {
	return INIT_REQUIRED_PATTERNS.some((p) => p.test(stderr));
}

function isReconfigureRequired(stderr: string): boolean {
	return RECONFIGURE_REQUIRED_PATTERNS.some((p) => p.test(stderr));
}

function isMigrateStateRequired(stderr: string): boolean {
	return MIGRATE_STATE_REQUIRED_PATTERNS.some((p) => p.test(stderr));
}
