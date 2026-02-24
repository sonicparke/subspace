import { describe, it, expect } from "vitest";
import { runAcrossRegions } from "../../src/regions/fanout.js";

describe("runAcrossRegions", () => {
	it("runs all items and collects exit codes", async () => {
		const results = await runAcrossRegions({
			items: ["us-east-1", "us-west-2"],
			parallel: 2,
			runItem: async (item) => (item === "us-east-1" ? 0 : 1),
		});
		expect(results).toHaveLength(2);
		expect(results.some((r) => r.item === "us-east-1" && r.exitCode === 0)).toBe(
			true,
		);
		expect(results.some((r) => r.item === "us-west-2" && r.exitCode === 1)).toBe(
			true,
		);
	});

	it("supports fail-fast mode", async () => {
		const seen: string[] = [];
		const results = await runAcrossRegions({
			items: ["a", "b", "c"],
			parallel: 1,
			failFast: true,
			runItem: async (item) => {
				seen.push(item);
				return item === "a" ? 1 : 0;
			},
		});
		expect(results).toHaveLength(1);
		expect(seen).toEqual(["a"]);
	});
});
