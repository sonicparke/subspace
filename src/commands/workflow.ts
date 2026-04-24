import type { SubspaceContext } from "../context.js";
import { cleanRebuild, type ModuleSourceRoot } from "../build/clean-rebuild.js";
import { writeVarLayers, type VarLayerSourceRoot } from "../build/var-layering.js";
import { invokeEngine } from "../engine/invoke.js";
import { loadStackConfig } from "../config/stack-config.js";
import { loadMigrationConfig } from "../migrate/config.js";
import { resolveTargetRegions, validateRegions } from "../regions/resolve.js";
import { providerTfForRegion } from "../regions/provider-template.js";
import { runAcrossRegions } from "../regions/fanout.js";

const APP_MODULES_DIR = "app/modules";
const TERRASPACE_VENDOR_MODULES_DIR = "vendor/modules";
const TERRASPACE_LEGACY_VENDOR_ROOT_DIR = "infra/vendor";

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
	const migration = await loadMigrationConfig(ctx);
	const moduleSourceRoots: ModuleSourceRoot[] =
		migration?.source === "terraspace"
			? [
					{ path: APP_MODULES_DIR },
					{ path: TERRASPACE_VENDOR_MODULES_DIR, recursive: true },
					{ path: TERRASPACE_LEGACY_VENDOR_ROOT_DIR, recursive: true },
				]
			: [{ path: APP_MODULES_DIR }];
	const varLayerRoots: VarLayerSourceRoot[] =
		migration?.source === "terraspace"
			? [
					{ dir: "config/terraform/tfvars", label: "project" },
					{ dir: `config/stacks/${stack}/tfvars`, label: "stack-config" },
					{ dir: `${stackDir}/tfvars`, label: "stack" },
				]
			: [{ dir: `${stackDir}/tfvars`, label: "stack" }];
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
			const buildRoot = buildRootFor(stack, region, env);
			const stackWorkDir = stackWorkingDir(buildRoot, stack);

			await cleanRebuild(ctx, {
				stackDir,
				buildRoot,
				stackName: stack,
				moduleSourceRoots,
			});
			await writeVarLayers(ctx, stackDir, stackWorkDir, env, varLayerRoots);

			if (stackConfig) {
				const providersTf = providerTfForRegion({
					provider: stackConfig.stack.provider,
					region,
					providerSettings: stackConfig.provider.settings,
					regionOverrides: stackConfig.provider.region_overrides,
				});
				await ctx.fs.writeFile(`${stackWorkDir}/providers.tf`, providersTf);
			}

			ctx.log.info(`[${region}] running ${command}`);
			return invokeEngine(ctx, stackWorkDir, command, stack, env ?? "", region);
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

/**
 * Returns the build-root path that contains `stacks/<stack>/` and `modules/`
 * as siblings. This is not the engine chdir target; use `stackWorkingDir`
 * for that.
 */
export function buildRootFor(
	stack: string,
	region: string,
	env: string | undefined,
): string {
	return `.subspace/build/${stack}/${region}/${env ?? "__noenv__"}`;
}

/**
 * Engine chdir target: `<buildRoot>/stacks/<stack>/`. The `.tf` files live
 * here. User source files like `source = "../../modules/foo"` resolve to
 * a sibling `<buildRoot>/modules/foo/` without any path rewriting.
 */
export function stackWorkingDir(buildRoot: string, stack: string): string {
	return `${buildRoot}/stacks/${stack}`;
}

/**
 * Target directory for staged module copies. Sibling of `stacks/` under
 * the build root.
 */
export function modulesStagingDir(buildRoot: string): string {
	return `${buildRoot}/modules`;
}

/**
 * @deprecated Prefer `buildRootFor` + `stackWorkingDir`. Retained for
 * backwards compatibility with any callers still using the flat shape.
 */
export function buildDirFor(
	stack: string,
	region: string,
	env: string | undefined,
): string {
	return stackWorkingDir(buildRootFor(stack, region, env), stack);
}
