import type { BackendType, BackendSettings } from "../domain/backends.js";
import type { ProviderType, ProviderSettings } from "../domain/providers.js";
import { parseTomlLite, stringifyTomlLite } from "./toml-lite.js";

export interface StackConfig {
	stack: {
		name?: string;
		provider: ProviderType;
	};
	regions: {
		values: string[];
		default?: string;
	};
	backend?: {
		type?: BackendType;
		settings?: BackendSettings;
	};
	provider: {
		settings: ProviderSettings;
		region_overrides?: Record<string, ProviderSettings>;
	};
}

export function parseStackConfig(content: string): StackConfig {
	const parsed = parseTomlLite(content);
	const provider = (parsed.stack?.provider as ProviderType | undefined) ?? "aws";
	const regions = parsed.regions?.values;

	const regionOverrides: Record<string, ProviderSettings> = {};
	for (const [section, values] of Object.entries(parsed)) {
		const prefix = "provider.region_overrides.";
		if (!section.startsWith(prefix)) continue;
		const region = section.slice(prefix.length);
		regionOverrides[region] = {
			region: values.region as string | undefined,
			project: values.project as string | undefined,
		};
	}

	const stackConfig: StackConfig = {
		stack: {
			name: parsed.stack?.name as string | undefined,
			provider,
		},
		regions: {
			values: Array.isArray(regions)
				? regions
				: typeof regions === "string"
					? [regions]
					: [],
			default: parsed.regions?.default as string | undefined,
		},
		provider: {
			settings: {
				region: parsed.provider?.region as string | undefined,
				project: parsed.provider?.project as string | undefined,
			},
			region_overrides:
				Object.keys(regionOverrides).length > 0 ? regionOverrides : undefined,
		},
	};

	const backendType = parsed.backend?.type as BackendType | undefined;
	if (backendType) {
		stackConfig.backend = {
			type: backendType,
			settings: {
				region: parsed["backend.settings"]?.region as string | undefined,
				bucket: parsed["backend.settings"]?.bucket as string | undefined,
				resource_group_name: parsed["backend.settings"]
					?.resource_group_name as string | undefined,
				storage_account_name: parsed["backend.settings"]
					?.storage_account_name as string | undefined,
				container_name: parsed["backend.settings"]
					?.container_name as string | undefined,
			},
		};
	}

	return stackConfig;
}

export function serializeStackConfig(config: StackConfig): string {
	const sections: Record<string, Record<string, string | string[]>> = {
		stack: {
			provider: config.stack.provider,
			...(config.stack.name ? { name: config.stack.name } : {}),
		},
		regions: {
			values: config.regions.values,
			...(config.regions.default ? { default: config.regions.default } : {}),
		},
		provider: pickDefined(config.provider.settings),
	};

	if (config.backend?.type) {
		sections.backend = { type: config.backend.type };
		sections["backend.settings"] = pickDefined(config.backend.settings ?? {});
	}

	for (const [region, settings] of Object.entries(
		config.provider.region_overrides ?? {},
	)) {
		sections[`provider.region_overrides.${region}`] = pickDefined(settings);
	}

	return stringifyTomlLite(sections);
}

function pickDefined(
	input: Record<string, string | undefined>,
): Record<string, string> {
	const output: Record<string, string> = {};
	for (const [key, value] of Object.entries(input)) {
		if (value !== undefined && value !== "") output[key] = value;
	}
	return output;
}
