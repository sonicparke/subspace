import { describe, expect, it } from "vitest";
import { runMigrateInit } from "../../src/commands/migrate-init.js";
import { createMockContext } from "../helpers/mock-context.js";

const REAL_BACKEND_TF = `terraform {
  backend "s3" {
    bucket = "<%= expansion('terraform-state-:ACCOUNT-:REGION-:ENV') %>"
    key    = "<%= expansion(':PROJECT/:REGION/:APP/:ROLE/:ENV/:EXTRA/:BUILD_DIR/terraform.tfstate') %>"
    region = "<%= expansion(':REGION') %>"
  }
}`;

function terraspaceFiles(
	prefix: string = "legacy",
	extra: Record<string, string> = {},
) {
	const p = prefix;
	return {
		[`${p}/config/app.rb`]: "Terraspace.configure { }",
		[`${p}/config/terraform/backend.tf`]: REAL_BACKEND_TF,
		[`${p}/app/stacks/network/main.tf`]: "",
		[`${p}/app/stacks/network/tfvars/dev.tfvars`]: "",
		[`${p}/app/stacks/network/tfvars/prod.tfvars`]: "",
		[`${p}/app/stacks/compute/main.tf`]: "",
		[`${p}/app/stacks/compute/tfvars/dev.tfvars`]: "",
		...extra,
	};
}

describe("runMigrateInit", () => {
	it("returns 'not-terraspace' when path is not a Terraspace project", async () => {
		const ctx = createMockContext({ files: { "legacy/main.tf": "" } });

		const result = await runMigrateInit(ctx, { legacyPath: "legacy" });

		expect(result.status).toBe("not-terraspace");
		expect(result.report).toContain("not look like a Terraspace project");
	});

	it("returns 'unextractable-templates' when backend.tf has no expansion()", async () => {
		const files = terraspaceFiles();
		files["legacy/config/terraform/backend.tf"] = `terraform {
  backend "s3" {
    bucket = "hardcoded"
    key    = "hardcoded"
  }
}`;
		const ctx = createMockContext({ files });

		const result = await runMigrateInit(ctx, { legacyPath: "legacy" });

		expect(result.status).toBe("unextractable-templates");
	});

	it("writes subspace.toml INTO the legacy path by default", async () => {
		const ctx = createMockContext({ files: terraspaceFiles() });

		const result = await runMigrateInit(ctx, { legacyPath: "legacy" });

		expect(result.status).toBe("ok");
		expect(ctx.files["legacy/subspace.toml"]).toBeDefined();
		expect(ctx.files["legacy/subspace.toml"]).toContain("[migration]");
		// must NOT write to cwd
		expect(ctx.files["subspace.toml"]).toBeUndefined();
	});

	it("writes subspace.toml to cwd when legacyPath is '.'", async () => {
		// Simulates running `subspace migrate init` from inside the Terraspace project.
		const ctx = createMockContext({ files: terraspaceFiles(".") });

		const result = await runMigrateInit(ctx, { legacyPath: "." });

		expect(result.status).toBe("ok");
		expect(ctx.files["subspace.toml"]).toBeDefined();
		expect(ctx.files["subspace.toml"]).toContain("[migration]");
	});

	it("respects --out overriding the default write location", async () => {
		const ctx = createMockContext({ files: terraspaceFiles() });

		await runMigrateInit(ctx, { legacyPath: "legacy", out: "newproj" });

		expect(ctx.files["newproj/subspace.toml"]).toBeDefined();
		expect(ctx.files["legacy/subspace.toml"]).toBeUndefined();
	});

	it("records discovered stacks and envs in the file", async () => {
		const ctx = createMockContext({ files: terraspaceFiles() });

		await runMigrateInit(ctx, { legacyPath: "legacy" });

		const toml = ctx.files["legacy/subspace.toml"];
		expect(toml).toContain("network");
		expect(toml).toContain("compute");
		expect(toml).toContain("dev");
		expect(toml).toContain("prod");
	});

	it("records --regions in [migration.terraspace].regions", async () => {
		const ctx = createMockContext({ files: terraspaceFiles() });

		await runMigrateInit(ctx, {
			legacyPath: "legacy",
			regions: ["us-east-1", "us-west-2"],
		});

		expect(ctx.files["legacy/subspace.toml"]).toContain(
			'regions = ["us-east-1", "us-west-2"]',
		);
	});

	it("defaults regions to us-east-1 when --regions is omitted", async () => {
		const ctx = createMockContext({ files: terraspaceFiles() });

		await runMigrateInit(ctx, {
			legacyPath: "legacy",
		});

		expect(ctx.files["legacy/subspace.toml"]).toContain(
			'regions = ["us-east-1"]',
		);
	});

	it("records --app-name when provided", async () => {
		const ctx = createMockContext({ files: terraspaceFiles() });

		await runMigrateInit(ctx, {
			legacyPath: "legacy",
			appName: "my-app",
		});

		expect(ctx.files["legacy/subspace.toml"]).toContain('app_name = "my-app"');
	});

	it("records --role when provided", async () => {
		const ctx = createMockContext({ files: terraspaceFiles() });

		await runMigrateInit(ctx, {
			legacyPath: "legacy",
			role: "cost",
		});

		expect(ctx.files["legacy/subspace.toml"]).toContain('role = "cost"');
	});

	it("does not overwrite an existing subspace.toml without --force", async () => {
		const ctx = createMockContext({
			files: {
				...terraspaceFiles(),
				"legacy/subspace.toml": "existing\n",
			},
		});

		const result = await runMigrateInit(ctx, { legacyPath: "legacy" });

		expect(result.status).toBe("exists");
		expect(ctx.files["legacy/subspace.toml"]).toBe("existing\n");
	});

	it("overwrites an existing subspace.toml with --force", async () => {
		const ctx = createMockContext({
			files: {
				...terraspaceFiles(),
				"legacy/subspace.toml": "existing\n",
			},
		});

		const result = await runMigrateInit(ctx, {
			legacyPath: "legacy",
			force: true,
		});

		expect(result.status).toBe("ok");
		expect(ctx.files["legacy/subspace.toml"]).toContain("[migration]");
	});

	it("preserves an existing role on --force when no new role is provided", async () => {
		const ctx = createMockContext({
			files: {
				...terraspaceFiles(),
				"legacy/subspace.toml": `[project]
backend = "s3"

[migration]
source = "terraspace"

[migration.terraspace]
bucket_template = "terraform-state-:ACCOUNT-:REGION-:ENV"
key_template = ":PROJECT/:REGION/:APP/:ROLE/:ENV/:EXTRA/:BUILD_DIR/terraform.tfstate"
project = "main"
regions = ["us-east-1"]
role = "cost"
`,
			},
		});

		const result = await runMigrateInit(ctx, {
			legacyPath: "legacy",
			force: true,
		});

		expect(result.status).toBe("ok");
		expect(ctx.files["legacy/subspace.toml"]).toContain('role = "cost"');
	});

	it("does NOT shell out to AWS during init (init is offline-only)", async () => {
		const ctx = createMockContext({ files: terraspaceFiles() });

		await runMigrateInit(ctx, { legacyPath: "legacy" });

		const awsCalls = ctx.execCalls.filter((c) => c.cmd === "aws");
		expect(awsCalls).toEqual([]);
	});

	describe("dry-run", () => {
		it("returns 'dry-run' status and does NOT write any files", async () => {
			const files = terraspaceFiles();
			const before = Object.keys(files).sort();
			const ctx = createMockContext({ files });

			const result = await runMigrateInit(ctx, {
				legacyPath: "legacy",
				dryRun: true,
			});

			expect(result.status).toBe("dry-run");
			expect(Object.keys(ctx.files).sort()).toEqual(before);
		});

		it("includes the would-be subspace.toml content in the report", async () => {
			const ctx = createMockContext({ files: terraspaceFiles() });

			const result = await runMigrateInit(ctx, {
				legacyPath: "legacy",
				dryRun: true,
				regions: ["us-east-1"],
				appName: "my-app",
			});

			expect(result.report).toContain("[migration]");
			expect(result.report).toContain("[migration.terraspace]");
			expect(result.report).toContain(
				'bucket_template = "terraform-state-:ACCOUNT-:REGION-:ENV"',
			);
			expect(result.report).toContain('app_name = "my-app"');
		});

		it("shows the target write path in the report", async () => {
			const ctx = createMockContext({ files: terraspaceFiles() });

			const result = await runMigrateInit(ctx, {
				legacyPath: "legacy",
				dryRun: true,
			});

			expect(result.report).toContain("legacy/subspace.toml");
		});

		it("still errors with 'not-terraspace' under --dry-run when path is wrong", async () => {
			const ctx = createMockContext({ files: { "legacy/main.tf": "" } });

			const result = await runMigrateInit(ctx, {
				legacyPath: "legacy",
				dryRun: true,
			});

			expect(result.status).toBe("not-terraspace");
		});

		it("dry-run does NOT trip the 'exists' guard (it's a preview, not a write)", async () => {
			const ctx = createMockContext({
				files: {
					...terraspaceFiles(),
					"legacy/subspace.toml": "existing\n",
				},
			});

			const result = await runMigrateInit(ctx, {
				legacyPath: "legacy",
				dryRun: true,
			});

			expect(result.status).toBe("dry-run");
			expect(ctx.files["legacy/subspace.toml"]).toBe("existing\n");
		});
	});
});
