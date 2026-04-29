import { loadProjectConfig } from "../config/project.js";
import { loadStackConfig, saveStackConfig } from "../config/stack-config.js";
import type { StackConfig } from "../config/stack-schema.js";
import type { SubspaceContext } from "../context.js";
import { awsProfileArgs } from "../migrate/aws-cli.js";
import { loadMigrationConfig } from "../migrate/config.js";
import {
	copyLegacyToNative,
	type CopyLegacyToNativeResult,
} from "../migrate/terraspace/copy.js";
import {
	buildMigrationPlan,
	type MigrationPlan,
	type MigrationPlanEntry,
} from "../migrate/terraspace/plan.js";
import { nativeNameFromLegacyKey } from "../migrate/terraspace/key.js";
import { discoverTerraspaceEnvsForStack } from "../migrate/terraspace/discover.js";
import {
	probeStateObjects,
	type ProbeReport,
} from "../migrate/terraspace/probe.js";

export interface MigrateStackInput {
	stack: string;
	env?: string;
	/** Legacy `:ROLE` (Terraspace TS_ROLE); overrides [migration.terraspace].role. */
	role?: string;
	/** Legacy `:APP` (Terraspace TS_APP); overrides [migration.terraspace].app. */
	app?: string;
	/** Terraspace stack instance used to derive `:BUILD_DIR`; overrides [migration.terraspace].instance. */
	instance?: string;
	/** Native state identity used after migration. */
	name?: string;
	/** Prompt adapter used only when multiple native-name candidates are discovered. */
	chooseName?: (input: {
		stack: string;
		envs: string[];
		candidates: string[];
	}) => Promise<string | undefined>;
	/** AWS CLI profile for migration probes/copies. */
	profile?: string;
	/**
	 * When true, the report is framed as a preview ("dry-run").
	 * When false, Subspace applies repo-side migration behavior, but keeps
	 * the existing remote state location unchanged.
	 */
	dryRun: boolean;
	regions?: string[];
}

export type MigrateStackStatus =
	| "ok"
	| "no-migration-config"
	| "no-account"
	| "env-required"
	| "name-required"
	| "non-s3-backend";

export interface MigrateStackResult {
	status: MigrateStackStatus;
	report: string;
}

const DEFAULT_REGIONS = ["us-east-1"];

export async function runMigrateStack(
	ctx: SubspaceContext,
	input: MigrateStackInput,
): Promise<MigrateStackResult> {
	const migration = await loadMigrationConfig(ctx);
	if (!migration || !migration.terraspace) {
		return {
			status: "no-migration-config",
			report: renderNoMigrationConfig(),
		};
	}

	const project = await loadProjectConfig(ctx);
	const backend = project?.project.backend;
	if (backend && backend !== "s3") {
		return {
			status: "non-s3-backend",
			report: renderNonS3Backend(backend),
		};
	}

	const ts = migration.terraspace;
	const regions =
		input.regions && input.regions.length > 0
			? input.regions
			: ts.regions.length > 0
				? ts.regions
				: DEFAULT_REGIONS;

	const envs = input.env
		? [input.env]
		: resolveEnvCandidates(
				await discoverTerraspaceEnvsForStack(ctx, ".", input.stack),
				ts.envs,
			);
	if (envs.length === 0) {
		return {
			status: "env-required",
			report:
				`No envs found for stack "${input.stack}".\n\n` +
				`Subspace looked for:\n` +
				`  - app/stacks/${input.stack}/tfvars/<env>.tfvars\n` +
				`  - config/stacks/${input.stack}/tfvars/<env>.tfvars\n` +
				`  - optional \`envs = [ ... ]\` in [migration.terraspace] for names only set via TS_ENV (e.g. base-only stack, no <env>.tfvars)\n\n` +
				`Either add envs to subspace.toml, run from the Terraspace project root, or pass one env:\n` +
				`  \`subspace migrate ${input.stack} <env> --dry-run\``,
		};
	}

	const account = await resolveAwsAccount(ctx, input.profile);
	if (!account) {
		const debugCommand = input.profile
			? `aws sts get-caller-identity --profile ${input.profile}`
			: "aws sts get-caller-identity";
		return {
			status: "no-account",
			report: `Could not determine AWS account id. Run \`${debugCommand}\` to debug.`,
		};
	}

	const basePlanInput = {
		stacks: [input.stack],
		envs,
		regions,
		templates: { bucket: ts.bucketTemplate, key: ts.keyTemplate },
		account,
		project: ts.project,
		appName: ts.appName,
		role: input.role ?? ts.role,
		app: input.app ?? ts.app,
		instance: input.instance ?? ts.instance,
	};
	const preliminaryPlan = buildMigrationPlan(basePlanInput);
	const name = await resolveNativeName({
		stack: input.stack,
		envs,
		explicitName: input.name,
		plan: preliminaryPlan,
		chooseName: input.chooseName,
	});
	if (!name) {
		return {
			status: "name-required",
			report:
				`Multiple legacy states found for "${input.stack}".\n\n` +
				`Re-run with \`--name <name>\`, or run interactively to choose one.`,
		};
	}

	const plan = buildMigrationPlan({ ...basePlanInput, name });

	const probe = await probeStateObjects(ctx, plan, { profile: input.profile });
	const execution = input.dryRun
		? undefined
		: await executeMigrationCopies(ctx, plan, input.profile);
	if (execution) {
		await persistNativeStateMappings(ctx, input.stack, execution);
	}

	return {
		status: "ok",
		report: renderReport(input.stack, envs, plan, probe, input.dryRun, execution),
	};
}

async function resolveAwsAccount(
	ctx: SubspaceContext,
	profile: string | undefined,
): Promise<string | null> {
	const result = await ctx.exec("aws", [
		"sts",
		"get-caller-identity",
		"--output=json",
		...awsProfileArgs({ profile }),
	]);
	if (result.exitCode !== 0) return null;
	try {
		const parsed = JSON.parse(result.stdout) as { Account?: string };
		return parsed.Account ?? null;
	} catch {
		return null;
	}
}

function resolveEnvCandidates(
	discovered: string[],
	fromToml: string[] | undefined,
): string[] {
	if (discovered.length > 0) return discovered;
	return (fromToml ?? []).filter(Boolean).sort();
}

async function resolveNativeName(input: {
	stack: string;
	envs: string[];
	explicitName: string | undefined;
	plan: MigrationPlan;
	chooseName:
		| ((input: {
				stack: string;
				envs: string[];
				candidates: string[];
		  }) => Promise<string | undefined>)
		| undefined;
}): Promise<string | undefined> {
	if (input.explicitName) return input.explicitName;

	const candidates = Array.from(
		new Set(
			input.plan.entries
				.map((entry) => nativeNameFromLegacyKey(input.stack, entry.legacy.key))
				.filter((name): name is string => Boolean(name)),
		),
	).sort();

	if (candidates.length === 0) return "default";
	if (candidates.length === 1) return candidates[0];
	return input.chooseName?.({
		stack: input.stack,
		envs: input.envs,
		candidates,
	});
}

function renderNoMigrationConfig(): string {
	return [
		`# Migration report`,
		``,
		`No \`[migration]\` section found in \`subspace.toml\`.`,
		``,
		`Run \`subspace migrate init <path-to-terraspace-project>\` first to scaffold one.`,
	].join("\n");
}

function renderNonS3Backend(backend: string): string {
	return [
		`# Migration report (unsupported backend)`,
		``,
		`Detected project backend: **${backend}**.`,
		``,
		`Terraspace -> Subspace state migration is S3-only at MVP.`,
		`For \`gcs\`/\`azurerm\`/\`local\` projects:`,
		``,
		`  1. Delete the legacy state object manually.`,
		`  2. Re-run \`subspace init\` against the native backend.`,
		``,
		ONE_WAY_NOTICE,
	].join("\n");
}

function renderReport(
	stack: string,
	envs: string[],
	plan: MigrationPlan,
	probe: ProbeReport,
	dryRun: boolean,
	execution:
		| Array<{ entry: MigrationPlanEntry; result: CopyLegacyToNativeResult }>
		| undefined,
): string {
	const envLine =
		envs.length === 1
			? `Env:   **${envs[0]}**`
			: `Envs:  **${envs.join(", ")}** (${envs.length} — discovered for this stack)`;
	const heading = dryRun
		? `# Migration report (dry-run)`
		: `# Migration report`;
	const lines = [
		heading,
		``,
		`Stack: **${stack}**`,
		envLine,
		`Entries: ${plan.entries.length}`,
		``,
	];

	for (const result of probe.results) {
		const { entry, legacy, native } = result;
		lines.push(`## ${entry.stack} / ${entry.env} / ${entry.region}`);
		lines.push("");
		lines.push(
			`- legacy: ${legacy.status.toUpperCase()} — s3://${entry.legacy.bucket}/${entry.legacy.key}`,
		);
		if (legacy.errorMessage) {
			lines.push(`  - error: ${legacy.errorMessage}`);
		}
		lines.push(
			`- native: ${native.status.toUpperCase()} — s3://${entry.native.bucket}/${entry.native.key}`,
		);
		if (native.errorMessage) {
			lines.push(`  - error: ${native.errorMessage}`);
		}
		const executed = execution?.find(
			(candidate) =>
				candidate.entry.stack === entry.stack &&
				candidate.entry.env === entry.env &&
				candidate.entry.region === entry.region,
		);
		if (executed) {
			lines.push(
				`- action: ${formatCopyResult(
					executed.result,
					entry,
				)}`,
			);
		}
		lines.push("");
	}

	lines.push(`---`);
	if (dryRun) {
		lines.push(`This was a dry-run. No files or state were modified.`);
		lines.push(``);
		lines.push(ONE_WAY_NOTICE);
	} else {
		lines.push(
			`Migration applied for this report. Legacy state was copied to native state when needed.`,
		);
		lines.push(``);
		lines.push(ONE_WAY_NOTICE);
	}
	return lines.join("\n");
}

async function executeMigrationCopies(
	ctx: SubspaceContext,
	plan: MigrationPlan,
	profile: string | undefined,
): Promise<Array<{ entry: MigrationPlanEntry; result: CopyLegacyToNativeResult }>> {
	const results: Array<{
		entry: MigrationPlanEntry;
		result: CopyLegacyToNativeResult;
	}> = [];
	for (const entry of plan.entries) {
		results.push({
			entry,
			result: await copyLegacyToNative(
				ctx,
				{
					legacy: entry.legacy,
					native: entry.native,
				},
				{ profile },
			),
		});
	}
	return results;
}

async function persistNativeStateMappings(
	ctx: SubspaceContext,
	stack: string,
	execution: Array<{ entry: MigrationPlanEntry; result: CopyLegacyToNativeResult }>,
): Promise<void> {
	const successful = execution.filter(({ result }) =>
		result.status === "copied" || result.status === "native-exists",
	);
	if (successful.length === 0) return;

	const existing = await loadStackConfig(ctx, stack);
	const config = existing ?? defaultStackConfig(stack);
	config.migration ??= {};
	config.migration.native_state ??= {};

	for (const { entry } of successful) {
		config.migration.native_state[entry.env || "__noenv__"] = entry.name;
	}

	await saveStackConfig(ctx, stack, config);
}

function defaultStackConfig(stack: string): StackConfig {
	return {
		stack: { name: stack, provider: "aws" },
		regions: { values: [] },
		provider: { settings: {} },
	};
}

function formatCopyResult(
	result: CopyLegacyToNativeResult,
	entry: MigrationPlanEntry,
): string {
	switch (result.status) {
		case "same-location":
			return `UNCHANGED — state stays at s3://${entry.native.bucket}/${entry.native.key}`;
		case "copied":
			return `COPIED — s3://${entry.legacy.bucket}/${entry.legacy.key} -> s3://${entry.native.bucket}/${entry.native.key}`;
		case "native-exists":
			return `SKIPPED (native exists) — s3://${entry.native.bucket}/${entry.native.key}`;
		case "legacy-missing":
			return `SKIPPED (legacy missing) — s3://${entry.legacy.bucket}/${entry.legacy.key}`;
		case "error":
			return `ERROR — ${result.errorMessage}`;
	}
}

const ONE_WAY_NOTICE =
	`**Legacy state is preserved.** Subspace writes migrated state to the native destination and does not delete the legacy object.`;
