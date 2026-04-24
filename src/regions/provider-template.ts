import {
	REGION_PLACEHOLDER,
	renderProviderTf,
	type ProviderSettings,
	type ProviderType,
} from "../domain/providers.js";

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

/**
 * Substitute every occurrence of `REGION_PLACEHOLDER` in an existing
 * `providers.tf` with a concrete region. No-op when the placeholder is
 * absent, so it is safe to call on user-edited files that already contain
 * a real region.
 */
export function rewriteProviderTfRegion(
	content: string,
	region: string,
): string {
	return content.replaceAll(REGION_PLACEHOLDER, region);
}
