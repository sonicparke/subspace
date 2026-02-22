import { describe, it, expect } from "vitest";
import { providerTfForRegion } from "../../src/regions/provider-template.js";

describe("providerTfForRegion", () => {
	it("uses region fallback for aws when not explicitly set", () => {
		const rendered = providerTfForRegion({
			provider: "aws",
			region: "us-west-2",
			providerSettings: {},
		});
		expect(rendered).toContain('provider "aws"');
		expect(rendered).toContain('region = "us-west-2"');
	});

	it("applies region-specific override settings", () => {
		const rendered = providerTfForRegion({
			provider: "gcp",
			region: "europe-west1",
			providerSettings: { project: "global-proj", region: "us-central1" },
			regionOverrides: {
				"europe-west1": { project: "eu-proj" },
			},
		});
		expect(rendered).toContain('project = "eu-proj"');
		expect(rendered).toContain('region  = "us-central1"');
	});

	it("renders cloudflare without region injection", () => {
		const rendered = providerTfForRegion({
			provider: "cloudflare",
			region: "us-west-2",
			providerSettings: {},
		});
		expect(rendered).toContain('provider "cloudflare" {}');
	});
});
