import type { SubspaceContext } from "../context.js";

interface VarLayer {
	source: string;
	dest: string;
	envRequired: boolean;
}

const LAYERS: VarLayer[] = [
	{ source: "base.tfvars", dest: "00-base.auto.tfvars", envRequired: false },
	{ source: "<env>.tfvars", dest: "10-env.auto.tfvars", envRequired: true },
	{ source: "<env>.secrets.tfvars", dest: "20-env-secrets.auto.tfvars", envRequired: true },
	{ source: "local.tfvars", dest: "90-local.auto.tfvars", envRequired: false },
	{ source: "<env>.local.tfvars", dest: "95-env-local.auto.tfvars", envRequired: true },
];

/**
 * Write layered *.auto.tfvars files into the build directory.
 * Reads from `<stackDir>/tfvars/` and writes to `<buildDir>/`.
 */
export async function writeVarLayers(
	ctx: SubspaceContext,
	stackDir: string,
	buildDir: string,
	env: string | undefined,
): Promise<void> {
	const tfvarsDir = `${stackDir}/tfvars`;

	for (const layer of LAYERS) {
		// Skip env-specific layers when no env provided
		if (layer.envRequired && !env) continue;

		const sourceFile = env
			? layer.source.replace("<env>", env)
			: layer.source;
		const sourcePath = `${tfvarsDir}/${sourceFile}`;

		if (!(await ctx.fs.exists(sourcePath))) continue;

		const content = await ctx.fs.readFile(sourcePath);
		await ctx.fs.writeFile(`${buildDir}/${layer.dest}`, content);
	}
}
