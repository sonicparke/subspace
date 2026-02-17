import type { SubspaceContext } from "../context.js";

/** Files/dirs preserved across rebuilds */
const PRESERVED = new Set([
	".terraform",
	".terraform.lock.hcl",
	"terraform.tfstate",
	"terraform.tfstate.backup",
]);

/** Dirs excluded from source copy */
const EXCLUDED_DIRS = new Set([".terraform", ".subspace", "tfvars"]);

/**
 * Clean rebuild: delete non-preserved files in buildDir, then copy stack source.
 */
export async function cleanRebuild(
	ctx: SubspaceContext,
	stackDir: string,
	buildDir: string,
): Promise<void> {
	// Ensure build dir exists
	await ctx.fs.mkdir(buildDir, { recursive: true });

	// Delete everything except preserved
	await cleanBuildDir(ctx, buildDir);

	// Copy stack source, excluding certain dirs
	await copyStackSource(ctx, stackDir, buildDir);
}

async function cleanBuildDir(
	ctx: SubspaceContext,
	buildDir: string,
): Promise<void> {
	let entries: string[];
	try {
		entries = await ctx.fs.readdir(buildDir);
	} catch {
		return;
	}

	for (const entry of entries) {
		if (PRESERVED.has(entry)) continue;
		await ctx.fs.rm(`${buildDir}/${entry}`, { recursive: true, force: true });
	}
}

async function copyStackSource(
	ctx: SubspaceContext,
	stackDir: string,
	buildDir: string,
): Promise<void> {
	const entries = await ctx.fs.readdir(stackDir);

	for (const entry of entries) {
		if (EXCLUDED_DIRS.has(entry)) continue;

		const srcPath = `${stackDir}/${entry}`;
		const destPath = `${buildDir}/${entry}`;
		const stat = await ctx.fs.stat(srcPath);

		if (stat.isDirectory()) {
			await ctx.fs.cp(srcPath, destPath, { recursive: true });
		} else {
			const content = await ctx.fs.readFile(srcPath);
			await ctx.fs.writeFile(destPath, content);
		}
	}
}
