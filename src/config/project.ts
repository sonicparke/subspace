import type { SubspaceContext } from "../context.js";
import type { BackendType } from "../domain/backends.js";
import type { ProviderType } from "../domain/providers.js";
import type { ProjectConfig } from "./schema.js";
import { parseTomlLite, stringifyTomlLite } from "./toml-lite.js";

export const PROJECT_CONFIG_PATH = "subspace.toml";

export async function loadProjectConfig(
	ctx: SubspaceContext,
): Promise<ProjectConfig | null> {
	if (!(await ctx.fs.exists(PROJECT_CONFIG_PATH))) return null;
	const content = await ctx.fs.readFile(PROJECT_CONFIG_PATH);
	return parseProjectConfig(content);
}

export async function saveProjectConfig(
	ctx: SubspaceContext,
	config: ProjectConfig,
): Promise<void> {
	await ctx.fs.writeFile(PROJECT_CONFIG_PATH, serializeProjectConfig(config));
}

export function parseProjectConfig(content: string): ProjectConfig {
	const parsed = parseTomlLite(content);
	const backend = (parsed.project?.backend as BackendType | undefined) ?? "local";
	const allowed = parsed.policy?.allowed_providers;
	return {
		project: { backend },
		backend: {
			region: parsed.backend?.region as string | undefined,
			bucket: parsed.backend?.bucket as string | undefined,
			resource_group_name: parsed.backend?.resource_group_name as string | undefined,
			storage_account_name: parsed.backend?.storage_account_name as string | undefined,
			container_name: parsed.backend?.container_name as string | undefined,
		},
		policy: allowed
			? { allowed_providers: allowed as ProviderType[] }
			: undefined,
	};
}

export function serializeProjectConfig(config: ProjectConfig): string {
	const backendKv: Record<string, string> = {};
	for (const [k, v] of Object.entries(config.backend)) {
		if (v) backendKv[k] = v;
	}
	const sections: Record<string, Record<string, string | string[]>> = {
		project: { backend: config.project.backend },
		backend: backendKv,
	};
	if (config.policy?.allowed_providers?.length) {
		sections.policy = {
			allowed_providers: config.policy.allowed_providers,
		};
	}
	return stringifyTomlLite(sections);
}
