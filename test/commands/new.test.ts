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
		expect(ctx.files["demo/config/terraform/provider.tf"]).toBeUndefined();
	});

	it("creates provider config in stack for s3 backend from project config", async () => {
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
		expect(ctx.files["app/stacks/network/providers.tf"]).toContain(
			'source  = "hashicorp/aws"',
		);
		expect(ctx.files["app/stacks/network/providers.tf"]).toContain(
			'provider "aws"',
		);
		expect(ctx.files["app/stacks/network/providers.tf"]).toContain(
			'region = "us-west-2"',
		);
	});

	it("creates provider config in stack for gcs backend from project config", async () => {
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
		expect(ctx.files["app/stacks/network/providers.tf"]).toContain(
			'source  = "hashicorp/google"',
		);
		expect(ctx.files["app/stacks/network/providers.tf"]).toContain(
			'provider "google"',
		);
		expect(ctx.files["app/stacks/network/providers.tf"]).toContain(
			'region  = "us-central1"',
		);
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
		expect(ctx.files["app/stacks/network/providers.tf"]).toContain(
			'required_version = ">= 1.6.0"',
		);
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
