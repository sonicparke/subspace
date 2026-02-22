import type { BackendType, BackendSettings } from "../domain/backends.js";
import type { ProviderType, ProviderSettings } from "../domain/providers.js";

export interface ProjectConfig {
	project: {
		backend: BackendType;
	};
	backend: BackendSettings;
	policy?: {
		allowed_providers?: ProviderType[];
	};
}

export interface StackConfig {
	stack: {
		provider: ProviderType;
	};
	provider: ProviderSettings;
}
