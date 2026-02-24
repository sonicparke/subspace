import type { StackConfig } from "../config/stack-schema.js";

interface ResolveRegionsInput {
	stackConfig: StackConfig;
	regionFlag?: string;
	allRegions?: boolean;
}

export function resolveTargetRegions(input: ResolveRegionsInput): string[] {
	if (input.regionFlag) return [input.regionFlag];

	const configured = input.stackConfig.regions.values;
	if (input.allRegions && configured.length > 0) return configured;

	if (configured.length > 0) return configured;
	if (input.stackConfig.regions.default) return [input.stackConfig.regions.default];
	return ["global"];
}

export function validateRegions(regions: string[]): string[] {
	const errors: string[] = [];
	const seen = new Set<string>();
	const validPattern = /^[A-Za-z0-9-]+$/;

	if (regions.length === 0) {
		errors.push("at least one region is required");
		return errors;
	}

	for (const region of regions) {
		if (!validPattern.test(region)) {
			errors.push(`invalid region "${region}"`);
			continue;
		}
		if (seen.has(region)) {
			errors.push(`duplicate region "${region}"`);
			continue;
		}
		seen.add(region);
	}

	return errors;
}
