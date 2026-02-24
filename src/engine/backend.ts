import type { SubspaceContext } from "../context.js";

export type BackendType = "s3" | "gcs" | "azurerm" | "local" | null;
const SUPPORTED_BACKENDS = new Set(["s3", "gcs", "azurerm", "local"]);

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
	const tfJsonFiles = files.filter((f) => f.endsWith(".tf.json"));

	for (const file of tfFiles) {
		const content = await ctx.fs.readFile(`${buildDir}/${file}`);
		const match = content.match(/backend\s+"(\w+)"/);
		if (match) {
			return match[1] as BackendType;
		}
	}

	for (const file of tfJsonFiles) {
		const content = await ctx.fs.readFile(`${buildDir}/${file}`);
		const backend = parseBackendFromTfJson(content);
		if (backend) return backend;
	}

	return null;
}

function parseBackendFromTfJson(content: string): BackendType {
	try {
		const parsed = JSON.parse(content) as { terraform?: unknown };
		const terraformBlocks = Array.isArray(parsed.terraform)
			? parsed.terraform
			: [parsed.terraform];

		for (const block of terraformBlocks) {
			if (!block || typeof block !== "object") continue;
			const backend = (block as { backend?: unknown }).backend;
			if (!backend || typeof backend !== "object" || Array.isArray(backend)) {
				continue;
			}
			for (const key of Object.keys(backend as Record<string, unknown>)) {
				if (SUPPORTED_BACKENDS.has(key)) return key as BackendType;
			}
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Generate -backend-config flags for the detected backend type.
 */
export function backendConfigFlags(
	backend: BackendType,
	stack: string,
	env: string,
	region: string,
): string[] {
	const envKey = env || "__noenv__";
	const regionKey = region || "__noregion__";
	switch (backend) {
		case "s3":
		case "azurerm":
			return [`-backend-config=key=subspace/${stack}/${regionKey}/${envKey}/terraform.tfstate`];
		case "gcs":
			return [`-backend-config=prefix=subspace/${stack}/${regionKey}/${envKey}`];
		case "local":
		case null:
			return [];
	}
}
