import type { SubspaceContext } from "../context.js";
import { loadMigrationConfig } from "../migrate/config.js";
import {
	discoverTerraspaceEnvsForStack,
	discoverTerraspaceStacks,
} from "../migrate/terraspace/discover.js";
import { buildMigrationPlan } from "../migrate/terraspace/plan.js";
import { headObject } from "../migrate/terraspace/probe.js";

export interface DoctorInput {
	legacy?: boolean;
}

export async function runDoctor(
	ctx: SubspaceContext,
	input: DoctorInput = {},
): Promise<number> {
	if (input.legacy) {
		return runLegacyReport(ctx);
	}

	ctx.log.info("Subspace Doctor\n");

	const tofuResult = await ctx.exec("which", ["tofu"]);
	if (tofuResult.exitCode === 0) {
		const ver = await ctx.exec("tofu", ["--version"]);
		const versionLine = ver.stdout.trim().split("\n")[0];
		ctx.log.info(`  [ok]   tofu: ${versionLine}`);
	} else {
		ctx.log.info("  [warn] tofu: not found");
	}

	const tfResult = await ctx.exec("which", ["terraform"]);
	if (tfResult.exitCode === 0) {
		const ver = await ctx.exec("terraform", ["--version"]);
		const versionLine = ver.stdout.trim().split("\n")[0];
		ctx.log.info(`  [ok]   terraform: ${versionLine}`);
	} else {
		ctx.log.info("  [info] terraform: not found");
	}

	ctx.log.info(`\n  Active engine: ${ctx.engine}`);

	const stacksDirExists = await ctx.fs.exists("app/stacks");
	if (!stacksDirExists) {
		ctx.log.info("\n  [warn] app/stacks/ directory not found");
		return 0;
	}

	ctx.log.info("\n  Stacks:");
	const stacks = await ctx.fs.readdir("app/stacks");
	if (stacks.length === 0) {
		ctx.log.info("    (none found)");
		return 0;
	}

	for (const stack of stacks) {
		const stat = await ctx.fs.stat(`app/stacks/${stack}`);
		if (!stat.isDirectory()) continue;

		const hasBase = await ctx.fs.exists(`app/stacks/${stack}/tfvars/base.tfvars`);
		const status = hasBase ? "ok" : "warn";
		const note = hasBase ? "" : " (missing tfvars/base.tfvars)";
		ctx.log.info(`    [${status}]   ${stack}${note}`);
	}

	return 0;
}

async function runLegacyReport(ctx: SubspaceContext): Promise<number> {
	ctx.log.info("Subspace Doctor — migration report\n");

	const migration = await loadMigrationConfig(ctx);
	if (!migration || !migration.terraspace) {
		ctx.log.info("  No migration configured (no [migration.terraspace] in subspace.toml).");
		return 0;
	}

	const ts = migration.terraspace;
	const account = await resolveAwsAccount(ctx);
	if (!account) {
		ctx.log.info(
			"  [warn] could not resolve AWS account id (aws sts get-caller-identity failed).",
		);
		return 0;
	}

	const discoveredStacks = await discoverTerraspaceStacks(ctx, ".");
	if (discoveredStacks.length === 0) {
		ctx.log.info("  No stacks found under app/stacks/.");
		return 0;
	}

	for (const stack of discoveredStacks) {
		const discoveredEnvs = await discoverTerraspaceEnvsForStack(ctx, ".", stack);
		const envs = mergeStringLists(discoveredEnvs, ts.envs);
		if (envs.length === 0) {
			ctx.log.info(`  [skip]     ${stack} (no envs discovered)`);
			continue;
		}

		const plan = buildMigrationPlan({
			stacks: [stack],
			envs,
			regions: ts.regions,
			templates: { bucket: ts.bucketTemplate, key: ts.keyTemplate },
			account,
			project: ts.project,
			appName: ts.appName,
			role: ts.role,
			app: ts.app,
		});

		for (const entry of plan.entries) {
			const [legacy, native] = await Promise.all([
				headObject(ctx, entry.legacy.bucket, entry.legacy.key),
				headObject(ctx, entry.native.bucket, entry.native.key),
			]);
			const tag = classify(
				legacy.status,
				native.status,
				entry.legacy.bucket === entry.native.bucket &&
					entry.legacy.key === entry.native.key,
			);
			ctx.log.info(
				`  [${tag}]  ${entry.stack} / ${entry.env} / ${entry.region}`,
			);
		}
	}

	return 0;
}

function classify(
	legacy: "found" | "missing" | "error",
	native: "found" | "missing" | "error",
	sameLocation: boolean,
): "preserved" | "native" | "legacy" | "missing" | "error" {
	if (legacy === "error" || native === "error") return "error";
	if (sameLocation && (legacy === "found" || native === "found")) {
		return "preserved";
	}
	if (native === "found") return "native";
	if (legacy === "found") return "legacy";
	return "missing";
}

function mergeStringLists(
	a: string[],
	b: string[] | undefined,
): string[] {
	const out = new Set<string>(a);
	for (const v of b ?? []) {
		if (v) out.add(v);
	}
	return Array.from(out).sort();
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
