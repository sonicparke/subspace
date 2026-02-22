import { describe, it, expect } from "vitest";
import { resolveTargetRegions, validateRegions } from "../../src/regions/resolve.js";

const stackConfig = {
	stack: { provider: "aws" as const },
	regions: { values: ["us-east-1", "us-west-2"], default: "us-east-1" },
	provider: { settings: { region: "us-east-1" } },
};

describe("resolveTargetRegions", () => {
	it("uses explicit --region when provided", () => {
		expect(
			resolveTargetRegions({ stackConfig, regionFlag: "eu-west-1" }),
		).toEqual(["eu-west-1"]);
	});

	it("uses all configured regions when --all-regions is set", () => {
		expect(
			resolveTargetRegions({ stackConfig, allRegions: true }),
		).toEqual(["us-east-1", "us-west-2"]);
	});

	it("uses configured regions by default", () => {
		expect(resolveTargetRegions({ stackConfig })).toEqual([
			"us-east-1",
			"us-west-2",
		]);
	});

	it("falls back to default region when values is empty", () => {
		const cfg = { ...stackConfig, regions: { values: [], default: "us-east-1" } };
		expect(resolveTargetRegions({ stackConfig: cfg })).toEqual(["us-east-1"]);
	});
});

describe("validateRegions", () => {
	it("returns empty for valid regions", () => {
		expect(validateRegions(["us-east-1", "eu-west-1"])).toEqual([]);
	});

	it("flags empty region lists", () => {
		expect(validateRegions([])).toContain("at least one region is required");
	});

	it("flags invalid and duplicate regions", () => {
		const errors = validateRegions(["us-east-1", "bad region", "us-east-1"]);
		expect(errors.some((e) => e.includes("invalid region"))).toBe(true);
		expect(errors.some((e) => e.includes("duplicate region"))).toBe(true);
	});
});
