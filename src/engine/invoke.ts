import type { SubspaceContext } from "../context.js";
import { detectBackend, backendConfigFlags } from "./backend.js";

const INIT_REQUIRED_PATTERNS = [
	/terraform init/i,
	/tofu init/i,
	/run.*init/i,
	/backend initialization required/i,
	/provider.*not installed/i,
	/Module not installed/i,
];

/**
 * Run an engine command with init-when-needed semantics.
 *
 * 1. If .terraform/ is missing in buildDir, run init first.
 * 2. Run the requested command.
 * 3. If it fails with an "init required" pattern in stderr, run init and retry once.
 * 4. Return the engine's exit code.
 */
export async function invokeEngine(
	ctx: SubspaceContext,
	buildDir: string,
	command: string,
	stack: string,
	env: string,
): Promise<number> {
	const terraformDirExists = await ctx.fs.exists(`${buildDir}/.terraform`);

	if (!terraformDirExists) {
		ctx.log.info("Running init (no .terraform directory found)...");
		const initResult = await runInit(ctx, buildDir, stack, env);
		if (initResult !== 0) return initResult;
	}

	// Run the requested command (execStream captures stderr)
	const result = await runEngineCommand(ctx, buildDir, command);

	if (result.exitCode !== 0 && isInitRequired(result.stderr)) {
		ctx.log.info("Init required, running init...");
		const initResult = await runInit(ctx, buildDir, stack, env);
		if (initResult !== 0) return initResult;
		const retry = await runEngineCommand(ctx, buildDir, command);
		return retry.exitCode;
	}

	return result.exitCode;
}

async function runInit(
	ctx: SubspaceContext,
	buildDir: string,
	stack: string,
	env: string,
): Promise<number> {
	const backend = await detectBackend(ctx, buildDir);
	const configFlags = backendConfigFlags(backend, stack, env);
	const args = [
		`-chdir=${buildDir}`,
		"init",
		...configFlags,
	];
	const result = await ctx.execStream(ctx.engine, args);
	return result.exitCode;
}

async function runEngineCommand(
	ctx: SubspaceContext,
	buildDir: string,
	command: string,
): Promise<{ exitCode: number; stderr: string }> {
	const args = [
		`-chdir=${buildDir}`,
		command,
		...ctx.engineArgs,
	];
	return ctx.execStream(ctx.engine, args);
}

function isInitRequired(stderr: string): boolean {
	return INIT_REQUIRED_PATTERNS.some((p) => p.test(stderr));
}
