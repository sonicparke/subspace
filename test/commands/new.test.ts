import { describe, it, expect } from "vitest";
import { runNew } from "../../src/commands/new.js";
import { createMockContext } from "../helpers/mock-context.js";

describe("runNew", () => {
	it("creates a project scaffold", async () => {
		const ctx = createMockContext();

		const code = await runNew(ctx, { generator: "project", name: "demo" });

		expect(code).toBe(0);
		expect(ctx.files["demo/README.md"]).toContain("# demo");
		expect(ctx.files["demo/.gitignore"]).toContain(".subspace/");
		expect(ctx.files["demo/.subspaceignore"]).toContain(
			"Paths listed here are excluded",
		);
		expect(ctx.files["demo/config/terraform/backend.tf"]).toContain('backend "local"');
		expect(ctx.files["demo/app/modules/.keep"]).toBe("");
		expect(ctx.files["demo/app/stacks/.keep"]).toBe("");
	});

	it("creates project scaffold with selected backend", async () => {
		const ctx = createMockContext();
		const code = await runNew(ctx, {
			generator: "project",
			name: "demo",
			backend: "s3",
			region: "us-west-2",
		});

		expect(code).toBe(0);
		expect(ctx.files["demo/config/terraform/backend.tf"]).toContain('backend "s3"');
		expect(ctx.files["demo/config/terraform/backend.tf"]).toContain("bucket");
		expect(ctx.files["demo/config/terraform/backend.tf"]).toContain(
			'region = "us-west-2"',
		);
		expect(ctx.files["demo/config/terraform/providers.tf"]).toBeUndefined();
	});

	it("creates project providers.tf when provider is supplied", async () => {
		const ctx = createMockContext();
		const code = await runNew(ctx, {
			generator: "project",
			name: "demo",
			backend: "s3",
			provider: "aws",
			region: "us-west-2",
		});

		expect(code).toBe(0);
		const providers = ctx.files["demo/config/terraform/providers.tf"];
		expect(providers).toBeDefined();
		expect(providers).toContain('provider "aws"');
		expect(providers).toContain('region = "us-west-2"');
	});

	it("writes REGION_PLACEHOLDER in project providers.tf when no region supplied", async () => {
		const ctx = createMockContext();
		const code = await runNew(ctx, {
			generator: "project",
			name: "demo",
			provider: "aws",
		});

		expect(code).toBe(0);
		const providers = ctx.files["demo/config/terraform/providers.tf"];
		expect(providers).toBeDefined();
		expect(providers).toContain('region = "__SUBSPACE_REGION__"');
	});

	it("records inferred provider in stack subspace.toml for s3 backend", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/.keep": "",
				"config/terraform/backend.tf": `terraform {
  backend "s3" {
    bucket = "replace-me-tfstate"
    region = "us-west-2"
  }
}
`,
			},
		});
		const code = await runNew(ctx, { generator: "stack", name: "network" });
		expect(code).toBe(0);
		expect(ctx.files["app/stacks/network/providers.tf"]).toBeUndefined();
		const stackToml = ctx.files["app/stacks/network/subspace.toml"];
		expect(stackToml).toBeDefined();
		expect(stackToml).toContain('provider = "aws"');
		expect(stackToml).toContain("us-west-2");
	});

	it("records inferred provider in stack subspace.toml for gcs backend", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/.keep": "",
				"config/terraform/backend.tf": `terraform {
  backend "gcs" {
    bucket = "replace-me-tfstate"
  }
}
`,
			},
		});
		const code = await runNew(ctx, { generator: "stack", name: "network" });
		expect(code).toBe(0);
		expect(ctx.files["app/stacks/network/providers.tf"]).toBeUndefined();
		const stackToml = ctx.files["app/stacks/network/subspace.toml"];
		expect(stackToml).toBeDefined();
		expect(stackToml).toContain('provider = "gcp"');
	});

	it("errors when project already exists", async () => {
		const ctx = createMockContext({
			files: {
				"demo/README.md": "existing",
			},
		});

		const code = await runNew(ctx, { generator: "project", name: "demo" });

		expect(code).toBe(1);
		expect(ctx.logs.error[0]).toContain('project "demo" already exists');
	});

	it("creates a module scaffold", async () => {
		const ctx = createMockContext({
			files: {
				"app/modules/.keep": "",
			},
		});

		const code = await runNew(ctx, { generator: "module", name: "network" });

		expect(code).toBe(0);
		expect(ctx.files["app/modules/network/main.tf"]).toContain("Module resources");
		expect(ctx.files["app/modules/network/variables.tf"]).toContain("Module inputs");
		expect(ctx.files["app/modules/network/outputs.tf"]).toContain("Module outputs");
	});

	it("errors for module when app/modules is missing", async () => {
		const ctx = createMockContext();

		const code = await runNew(ctx, { generator: "module", name: "network" });

		expect(code).toBe(1);
		expect(ctx.logs.error[0]).toContain("app/modules/ not found");
	});

	it("creates a stack scaffold", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/.keep": "",
			},
		});

		const code = await runNew(ctx, { generator: "stack", name: "network" });

		expect(code).toBe(0);
		expect(ctx.files["app/stacks/network/main.tf"]).toContain("Stack resources");
		expect(ctx.files["app/stacks/network/backend.tf"]).toContain('backend "local"');
		expect(ctx.files["app/stacks/network/providers.tf"]).toBeUndefined();
		expect(ctx.files["app/stacks/network/tfvars/base.tfvars"]).toContain("Base vars");
	});

	it("rejects invalid names", async () => {
		const ctx = createMockContext();

		const code = await runNew(ctx, { generator: "stack", name: "../bad" });

		expect(code).toBe(1);
		expect(ctx.logs.error[0]).toContain('invalid name "../bad"');
	});

	it("rejects invalid backend values for project", async () => {
		const ctx = createMockContext();
		const code = await runNew(ctx, {
			generator: "project",
			name: "demo",
			backend: "bad" as unknown as "local",
		});

		expect(code).toBe(1);
		expect(ctx.logs.error[0]).toContain('invalid backend "bad"');
	});
});
