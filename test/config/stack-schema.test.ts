import { describe, it, expect } from "vitest";
import { parseStackConfig, serializeStackConfig } from "../../src/config/stack-schema.js";

describe("stack-schema", () => {
	it("parses stack config with regions and overrides", () => {
		const content = `[stack]
name = "network"
provider = "aws"

[regions]
values = ["us-east-1", "us-west-2"]
default = "us-east-1"

[provider]
region = "us-east-1"

[provider.region_overrides.us-west-2]
region = "us-west-2"

[migration.native_state]
prod = "default"
qa = "costengine"
`;
		const parsed = parseStackConfig(content);
		expect(parsed.stack.name).toBe("network");
		expect(parsed.stack.provider).toBe("aws");
		expect(parsed.regions.values).toEqual(["us-east-1", "us-west-2"]);
		expect(parsed.provider.region_overrides?.["us-west-2"]?.region).toBe("us-west-2");
		expect(parsed.migration?.native_state?.prod).toBe("default");
		expect(parsed.migration?.native_state?.qa).toBe("costengine");
	});

	it("serializes and parses back consistently", () => {
		const input = {
			stack: { name: "edge", provider: "gcp" as const },
			regions: { values: ["us-central1"], default: "us-central1" },
			backend: { type: "gcs" as const, settings: { bucket: "state-bucket" } },
			provider: {
				settings: { region: "us-central1", project: "proj" },
				region_overrides: { "europe-west1": { region: "europe-west1" } },
			},
			migration: {
				native_state: {
					"__noenv__": "vnh",
					qa: "costengine",
				},
			},
		};
		const content = serializeStackConfig(input);
		const parsed = parseStackConfig(content);
		expect(parsed.stack.provider).toBe("gcp");
		expect(parsed.backend?.type).toBe("gcs");
		expect(parsed.backend?.settings?.bucket).toBe("state-bucket");
		expect(parsed.provider.settings.project).toBe("proj");
		expect(parsed.provider.region_overrides?.["europe-west1"]?.region).toBe("europe-west1");
		expect(parsed.migration?.native_state?.__noenv__).toBe("vnh");
		expect(parsed.migration?.native_state?.qa).toBe("costengine");
	});
});
