import type { SubspaceContext } from "../context.js";
import { cleanRebuild } from "../build/clean-rebuild.js";
import { writeVarLayers } from "../build/var-layering.js";
import { invokeEngine } from "../engine/invoke.js";

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
	const envDir = env ?? "__noenv__";
	const buildDir = `.subspace/build/${stack}/${envDir}`;

	// Validate stack exists
	if (!(await ctx.fs.exists(stackDir))) {
		ctx.log.error(`stack "${stack}" not found (expected ${stackDir}/)`);
		return 1;
	}

	// Clean rebuild
	await cleanRebuild(ctx, stackDir, buildDir);

	// Write var layers
	await writeVarLayers(ctx, stackDir, buildDir, env);

	// Invoke engine
	return invokeEngine(ctx, buildDir, command, stack, env ?? "");
}
