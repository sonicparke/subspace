import { describe, it, expect } from "vitest";
import {
	providerTfForRegion,
	rewriteProviderTfRegion,
} from "../../src/regions/provider-template.js";

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

describe("rewriteProviderTfRegion", () => {
	it("substitutes the placeholder with a concrete region", () => {
		const content = `provider "aws" {
  region = "__SUBSPACE_REGION__"
}
`;
		const rewritten = rewriteProviderTfRegion(content, "us-east-1");
		expect(rewritten).toContain('region = "us-east-1"');
		expect(rewritten).not.toContain("__SUBSPACE_REGION__");
	});

	it("is a no-op when the placeholder is absent", () => {
		const content = `provider "aws" {
  region = "us-west-2"
}
`;
		expect(rewriteProviderTfRegion(content, "eu-west-1")).toBe(content);
	});

	it("replaces every occurrence of the placeholder", () => {
		const content = `provider "aws" {
  region = "__SUBSPACE_REGION__"
}

provider "aws" {
  alias  = "secondary"
  region = "__SUBSPACE_REGION__"
}
`;
		const rewritten = rewriteProviderTfRegion(content, "ap-southeast-2");
		expect(rewritten).not.toContain("__SUBSPACE_REGION__");
		const matches = rewritten.match(/region = "ap-southeast-2"/g);
		expect(matches?.length).toBe(2);
	});
});
