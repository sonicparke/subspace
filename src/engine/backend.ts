import type { SubspaceContext } from "../context.js";

export type BackendType = "s3" | "gcs" | "azurerm" | "local" | null;
const SUPPORTED_BACKENDS = new Set(["s3", "gcs", "azurerm", "local"]);

export interface BackendConfigOverride {
	bucket?: string;
	key?: string;
	prefix?: string;
}

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
	appName: string,
	override?: BackendConfigOverride,
): string[] {
	const envKey = env || "__noenv__";
	const regionKey = region || "__noregion__";
	const backendScope = backendScopeForPath(backend);
	const statePath = `subspace/${backendScope}/${regionKey}/${envKey}/${stack}/subspace.tfstate`;
	switch (backend) {
		case "s3":
			return [
				`-backend-config=bucket=${override?.bucket ?? buildStateBucketName(appName, backendScope)}`,
				`-backend-config=key=${override?.key ?? statePath}`,
			];
		case "gcs":
			return [
				`-backend-config=bucket=${override?.bucket ?? buildStateBucketName(appName, backendScope)}`,
				`-backend-config=prefix=${override?.prefix ?? statePath.replace(/\/subspace\.tfstate$/, "")}`,
			];
		case "azurerm":
			return [`-backend-config=key=${override?.key ?? statePath}`];
		case "local":
		case null:
			return [];
	}
}

function backendScopeForPath(backend: BackendType): string {
	switch (backend) {
		case "s3":
			return "aws";
		case "gcs":
			return "gcp";
		case "azurerm":
			return "azure";
		case "local":
		case null:
			return "local";
	}
}

function buildStateBucketName(appName: string, backendScope: string): string {
	const normalizedApp = normalizeBucketPart(appName) || "subspace";
	const normalizedScope = normalizeBucketPart(backendScope) || "state";
	const value = `${normalizedApp}-subspace-${normalizedScope}-state`;
	return value.slice(0, 63).replace(/-+$/, "");
}

function normalizeBucketPart(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "");
}
