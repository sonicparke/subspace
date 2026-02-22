import { renderProviderTf, type ProviderSettings, type ProviderType } from "../domain/providers.js";

interface ProviderTfForRegionInput {
	provider: ProviderType;
	region: string;
	providerSettings: ProviderSettings;
	regionOverrides?: Record<string, ProviderSettings>;
}

export function providerTfForRegion(
	input: ProviderTfForRegionInput,
): string {
	const override = input.regionOverrides?.[input.region] ?? {};
	const merged: ProviderSettings = {
		...input.providerSettings,
		...override,
	};

	if (providerNeedsRegion(input.provider) && !merged.region) {
		merged.region = input.region;
	}

	return renderProviderTf(input.provider, merged);
}

function providerNeedsRegion(provider: ProviderType): boolean {
	return provider === "aws" || provider === "gcp";
}
