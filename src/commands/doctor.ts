import type { SubspaceContext } from "../context.js";

export async function runDoctor(ctx: SubspaceContext): Promise<number> {
	ctx.log.info("Subspace Doctor\n");

	// Check tofu
	const tofuResult = await ctx.exec("which", ["tofu"]);
	if (tofuResult.exitCode === 0) {
		const ver = await ctx.exec("tofu", ["--version"]);
		const versionLine = ver.stdout.trim().split("\n")[0];
		ctx.log.info(`  [ok]   tofu: ${versionLine}`);
	} else {
		ctx.log.info("  [warn] tofu: not found");
	}

	// Check terraform
	const tfResult = await ctx.exec("which", ["terraform"]);
	if (tfResult.exitCode === 0) {
		const ver = await ctx.exec("terraform", ["--version"]);
		const versionLine = ver.stdout.trim().split("\n")[0];
		ctx.log.info(`  [ok]   terraform: ${versionLine}`);
	} else {
		ctx.log.info("  [info] terraform: not found");
	}

	// Active engine
	ctx.log.info(`\n  Active engine: ${ctx.engine}`);

	// Check app/stacks/
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
