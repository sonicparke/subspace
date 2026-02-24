import type { SubspaceContext } from "../context.js";
import { cleanRebuild } from "../build/clean-rebuild.js";
import { writeVarLayers } from "../build/var-layering.js";
import { invokeEngine } from "../engine/invoke.js";
import { loadStackConfig } from "../config/stack-config.js";
import { resolveTargetRegions, validateRegions } from "../regions/resolve.js";
import { providerTfForRegion } from "../regions/provider-template.js";
import { runAcrossRegions } from "../regions/fanout.js";

/**
 * Shared workflow for plan/apply/destroy:
 * 1. Validate stack exists
 * 2. Clean rebuild emitted directory
 * 3. Write var layers
 * 4. Invoke engine
 */
export async function runWorkflow(
	ctx: SubspaceContext,
	command: string,
	stack: string,
	env: string | undefined,
): Promise<number> {
	const stackDir = `app/stacks/${stack}`;

	// Validate stack exists
	if (!(await ctx.fs.exists(stackDir))) {
		ctx.log.error(`stack "${stack}" not found (expected ${stackDir}/)`);
		return 1;
	}

	const stackConfig = await loadStackConfig(ctx, stack);
	const regions = stackConfig
		? resolveTargetRegions({ stackConfig, allRegions: true })
		: ["global"];
	const regionErrors = validateRegions(regions);
	if (regionErrors.length > 0) {
		for (const error of regionErrors) ctx.log.error(error);
		return 1;
	}

	const results = await runAcrossRegions({
		items: regions,
		parallel: 4,
		failFast: false,
		runItem: async (region) => {
			const buildDir = buildDirFor(stack, region, env);

			await cleanRebuild(ctx, stackDir, buildDir);
			await writeVarLayers(ctx, stackDir, buildDir, env);

			if (stackConfig) {
				const providersTf = providerTfForRegion({
					provider: stackConfig.stack.provider,
					region,
					providerSettings: stackConfig.provider.settings,
					regionOverrides: stackConfig.provider.region_overrides,
				});
				await ctx.fs.writeFile(`${buildDir}/providers.tf`, providersTf);
			}

			ctx.log.info(`[${region}] running ${command}`);
			return invokeEngine(ctx, buildDir, command, stack, env ?? "", region);
		},
	});

	const failed = results.filter((r) => r.exitCode !== 0);
	if (failed.length > 0) {
		for (const result of failed) {
			ctx.log.error(`[${result.item}] ${command} failed with exit code ${result.exitCode}`);
		}
		return 1;
	}

	return 0;
}

export function buildDirFor(
	stack: string,
	region: string,
	env: string | undefined,
): string {
	return `.subspace/build/${stack}/${region}/${env ?? "__noenv__"}`;
}
