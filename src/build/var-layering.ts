import type { SubspaceContext } from "../context.js";

interface VarLayer {
	source: string;
	dest: string;
	name: string;
	envRequired: boolean;
}

const LAYERS: VarLayer[] = [
	{
		source: "base.tfvars",
		dest: "00-base.auto.tfvars",
		name: "base",
		envRequired: false,
	},
	{
		source: "<env>.tfvars",
		dest: "10-env.auto.tfvars",
		name: "env",
		envRequired: true,
	},
	{
		source: "<env>.secrets.tfvars",
		dest: "20-env-secrets.auto.tfvars",
		name: "env-secrets",
		envRequired: true,
	},
	{
		source: "local.tfvars",
		dest: "90-local.auto.tfvars",
		name: "local",
		envRequired: false,
	},
	{
		source: "<env>.local.tfvars",
		dest: "95-env-local.auto.tfvars",
		name: "env-local",
		envRequired: true,
	},
];

export interface VarLayerSourceRoot {
	dir: string;
	label: string;
}

/**
 * Write layered *.auto.tfvars files into the build directory.
 * Reads from `<stackDir>/tfvars/` and writes to `<buildDir>/`.
 */
export async function writeVarLayers(
	ctx: SubspaceContext,
	stackDir: string,
	buildDir: string,
	env: string | undefined,
	sourceRoots?: VarLayerSourceRoot[],
): Promise<void> {
	const roots =
		sourceRoots && sourceRoots.length > 0
			? sourceRoots
			: [{ dir: `${stackDir}/tfvars`, label: "stack" }];

	if (roots.length === 1 && roots[0]?.dir === `${stackDir}/tfvars`) {
		for (const layer of LAYERS) {
			// Preserve native Subspace filenames for non-migration projects.
			if (layer.envRequired && !env) continue;

			const sourceFile = env
				? layer.source.replace("<env>", env)
				: layer.source;
			const sourcePath = `${roots[0].dir}/${sourceFile}`;

			if (!(await ctx.fs.exists(sourcePath))) continue;

			const content = await ctx.fs.readFile(sourcePath);
			await ctx.fs.writeFile(`${buildDir}/${layer.dest}`, content);
		}
		return;
	}

	for (const [rootIndex, root] of roots.entries()) {
		for (const [layerIndex, layer] of LAYERS.entries()) {
			if (layer.envRequired && !env) continue;

			const sourceFile = env
				? layer.source.replace("<env>", env)
				: layer.source;
			const sourcePath = `${root.dir}/${sourceFile}`;

			if (!(await ctx.fs.exists(sourcePath))) continue;

			const content = await ctx.fs.readFile(sourcePath);
			const order = String(rootIndex * LAYERS.length + layerIndex).padStart(2, "0");
			const dest = `${order}-${root.label}-${layer.name}.auto.tfvars`;
			await ctx.fs.writeFile(`${buildDir}/${dest}`, content);
		}
	}
}
