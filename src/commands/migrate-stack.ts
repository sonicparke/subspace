import { loadProjectConfig } from "../config/project.js";
import type { SubspaceContext } from "../context.js";
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
		: mergeDiscoveredEnvsWithConfig(
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

	const account = await resolveAwsAccount(ctx);
	if (!account) {
		return {
			status: "no-account",
			report:
				"Could not determine AWS account id. Run `aws sts get-caller-identity` to debug.",
		};
	}

	const plan = buildMigrationPlan({
		stacks: [input.stack],
		envs,
		regions,
		templates: { bucket: ts.bucketTemplate, key: ts.keyTemplate },
		account,
		project: ts.project,
		appName: ts.appName,
		role: input.role ?? ts.role,
		app: input.app ?? ts.app,
	});

	const probe = await probeStateObjects(ctx, plan);
	const execution = input.dryRun
		? undefined
		: await executeMigrationCopies(ctx, plan);

	return {
		status: "ok",
		report: renderReport(input.stack, envs, plan, probe, input.dryRun, execution),
	};
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

function mergeDiscoveredEnvsWithConfig(
	discovered: string[],
	fromToml: string[] | undefined,
): string[] {
	const out = new Set<string>([...discovered]);
	for (const e of fromToml ?? []) {
		if (e) out.add(e);
	}
	return Array.from(out).sort();
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
		lines.push(`Migration applied for this report. Remote state location was unchanged.`);
		lines.push(``);
		lines.push(ONE_WAY_NOTICE);
	}
	return lines.join("\n");
}

async function executeMigrationCopies(
	ctx: SubspaceContext,
	plan: MigrationPlan,
): Promise<Array<{ entry: MigrationPlanEntry; result: CopyLegacyToNativeResult }>> {
	const results: Array<{
		entry: MigrationPlanEntry;
		result: CopyLegacyToNativeResult;
	}> = [];
	for (const entry of plan.entries) {
		results.push({
			entry,
			result: await copyLegacyToNative(ctx, {
				legacy: entry.legacy,
				native: entry.native,
			}),
		});
	}
	return results;
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
	`**Remote state is preserved.** Subspace keeps using the existing Terraspace bucket/key for this migration path, so repo migration does not relocate the state object.`;
