import type { BackendSettings, BackendType } from "../domain/backends.js";
import type { ProviderSettings, ProviderType } from "../domain/providers.js";

export interface ProjectConfig {
	project: {
		backend: BackendType;
		provider?: ProviderType;
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
