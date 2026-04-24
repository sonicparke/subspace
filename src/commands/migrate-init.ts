import type { SubspaceContext } from "../context.js";
import { parseMigrationConfig } from "../migrate/config.js";
import { extractTemplates } from "../migrate/terraspace/backend-tf.js";
import { detectTerraspaceProject } from "../migrate/terraspace/detect.js";
import {
	discoverTerraspaceEnvs,
	discoverTerraspaceStacks,
} from "../migrate/terraspace/discover.js";
import { scaffoldSubspaceToml } from "../migrate/terraspace/scaffold.js";

export interface MigrateInitInput {
	legacyPath: string;
	out?: string;
	regions?: string[];
	appName?: string;
	role?: string;
	project?: string;
	force?: boolean;
	dryRun?: boolean;
}

export type MigrateInitStatus =
	| "ok"
	| "dry-run"
	| "not-terraspace"
	| "unextractable-templates"
	| "exists";

export interface MigrateInitResult {
	status: MigrateInitStatus;
	report: string;
	subspaceTomlPath: string;
}

const DEFAULT_PROJECT = "main";
const DEFAULT_REGIONS = ["us-east-1"];

export async function runMigrateInit(
	ctx: SubspaceContext,
	input: MigrateInitInput,
): Promise<MigrateInitResult> {
	const targetPath = resolveTargetPath(input.legacyPath, input.out);

	const detection = await detectTerraspaceProject(ctx, input.legacyPath);
	if (detection.kind !== "terraspace") {
		return {
			status: "not-terraspace",
			report: `**${input.legacyPath}** does not look like a Terraspace project. Missing: ${detection.missing.join(", ")}`,
			subspaceTomlPath: targetPath,
		};
	}

	const backendTf = await readFileOrNull(
		ctx,
		`${input.legacyPath}/config/terraform/backend.tf`,
	);
	const templates = backendTf ? extractTemplates(backendTf) : null;
	if (!templates || !templates.bucket || !templates.key) {
		return {
			status: "unextractable-templates",
			report: `Could not extract backend templates from ${input.legacyPath}/config/terraform/backend.tf.`,
			subspaceTomlPath: targetPath,
		};
	}

	const stacks = await discoverTerraspaceStacks(ctx, input.legacyPath);
	const envs = await discoverTerraspaceEnvs(ctx, input.legacyPath);
	const existingHints = await readExistingMigrationHints(ctx, targetPath);

	const tomlContent = scaffoldSubspaceToml({
		bucketTemplate: templates.bucket,
		keyTemplate: templates.key,
		stacks,
		envs,
		regions: input.regions ?? DEFAULT_REGIONS,
		project: input.project ?? DEFAULT_PROJECT,
		appName: input.appName,
		role: input.role ?? existingHints.role,
	});

	if (input.dryRun) {
		return {
			status: "dry-run",
			report: renderDryRun(targetPath, stacks, envs, tomlContent),
			subspaceTomlPath: targetPath,
		};
	}

	if (!input.force && (await ctx.fs.exists(targetPath))) {
		return {
			status: "exists",
			report: `${targetPath} already exists. Re-run with --force to overwrite, or pass --dry-run to preview.`,
			subspaceTomlPath: targetPath,
		};
	}

	await ctx.fs.writeFile(targetPath, tomlContent);

	const report = [
		`# subspace migrate init`,
		``,
		`Wrote **${targetPath}**.`,
		``,
		`- stacks: ${stacks.join(", ") || "(none)"}`,
		`- envs:   ${envs.join(", ") || "(none)"}`,
		`- regions: ${(input.regions ?? DEFAULT_REGIONS).join(", ")}`,
		``,
		`Next: \`subspace migrate <stack> [env] --dry-run\` (omit \`env\` to probe every env for that stack).`,
	].join("\n");

	return { status: "ok", report, subspaceTomlPath: targetPath };
}

function resolveTargetPath(
	legacyPath: string,
	out: string | undefined,
): string {
	if (out) return `${out}/subspace.toml`;
	if (legacyPath === "." || legacyPath === "") return "subspace.toml";
	return `${legacyPath}/subspace.toml`;
}

function renderDryRun(
	targetPath: string,
	stacks: string[],
	envs: string[],
	tomlContent: string,
): string {
	return [
		`# subspace migrate init (dry-run)`,
		``,
		`Would write **${targetPath}**.`,
		``,
		`- stacks: ${stacks.join(", ") || "(none)"}`,
		`- envs:   ${envs.join(", ") || "(none)"}`,
		``,
		`Contents:`,
		``,
		"```toml",
		tomlContent.trimEnd(),
		"```",
		``,
		`Re-run without --dry-run to write this file.`,
	].join("\n");
}

async function readFileOrNull(
	ctx: SubspaceContext,
	path: string,
): Promise<string | null> {
	try {
		return await ctx.fs.readFile(path);
	} catch {
		return null;
	}
}

async function readExistingMigrationHints(
	ctx: SubspaceContext,
	targetPath: string,
): Promise<{ role?: string }> {
	const content = await readFileOrNull(ctx, targetPath);
	if (!content) return {};
	try {
		const parsed = parseMigrationConfig(content);
		return {
			role: parsed?.terraspace?.role,
		};
	} catch {
		return {};
	}
}
