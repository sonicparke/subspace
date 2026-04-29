import { describe, it, expect } from "vitest";
import { createMockContext } from "../helpers/mock-context.js";
import { loadStackConfig, saveStackConfig, stackConfigPath } from "../../src/config/stack-config.js";

describe("stack-config", () => {
	it("saves and loads stack config", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/network/.keep": "",
			},
		});
		await saveStackConfig(ctx, "network", {
			stack: { name: "network", provider: "aws" },
			regions: { values: ["us-east-1"], default: "us-east-1" },
			provider: { settings: { region: "us-east-1" } },
			migration: { native_state: { prod: "default" } },
		});
		const loaded = await loadStackConfig(ctx, "network");
		expect(loaded?.stack.provider).toBe("aws");
		expect(loaded?.regions.values).toEqual(["us-east-1"]);
		expect(loaded?.provider.settings.region).toBe("us-east-1");
		expect(loaded?.migration?.native_state?.prod).toBe("default");
	});

	it("returns null when stack config file does not exist", async () => {
		const ctx = createMockContext();
		const loaded = await loadStackConfig(ctx, "missing");
		expect(loaded).toBeNull();
	});

	it("writes to expected stack config path", async () => {
		expect(stackConfigPath("network")).toBe("app/stacks/network/subspace.toml");
	});
});
