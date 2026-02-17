import type { SubspaceContext } from "../context.js";

export type BackendType = "s3" | "gcs" | "azurerm" | "local" | null;

/**
 * Detect the backend type from HCL files in a build directory.
 * Scans for `backend "<type>"` in .tf files.
 */
export async function detectBackend(
	ctx: SubspaceContext,
	buildDir: string,
): Promise<BackendType> {
	let files: string[];
	try {
		files = await ctx.fs.readdir(buildDir);
	} catch {
		return null;
	}

	const tfFiles = files.filter((f) => f.endsWith(".tf"));

	for (const file of tfFiles) {
		const content = await ctx.fs.readFile(`${buildDir}/${file}`);
		const match = content.match(/backend\s+"(\w+)"/);
		if (match) {
			return match[1] as BackendType;
		}
	}

	return null;
}

/**
 * Generate -backend-config flags for the detected backend type.
 */
export function backendConfigFlags(
	backend: BackendType,
	stack: string,
	env: string,
): string[] {
	const envKey = env || "__noenv__";
	switch (backend) {
		case "s3":
		case "azurerm":
			return [`-backend-config=key=subspace/${stack}/${envKey}/terraform.tfstate`];
		case "gcs":
			return [`-backend-config=prefix=subspace/${stack}/${envKey}`];
		case "local":
		case null:
			return [];
	}
}
