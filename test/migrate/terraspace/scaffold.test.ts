import { describe, expect, it } from "vitest";
import { scaffoldSubspaceToml } from "../../../src/migrate/terraspace/scaffold.js";

describe("scaffoldSubspaceToml", () => {
	const baseInput = {
		bucketTemplate: "terraform-state-:ACCOUNT-:REGION-:ENV",
		keyTemplate:
			":PROJECT/:REGION/:APP/:ROLE/:ENV/:EXTRA/:BUILD_DIR/terraform.tfstate",
		stacks: ["network", "compute"],
		envs: ["dev", "prod"],
		regions: ["us-east-1"],
		project: "main",
	};

	it("emits a [migration] section with source = terraspace", () => {
		const toml = scaffoldSubspaceToml(baseInput);
		expect(toml).toContain("[migration]");
		expect(toml).toContain('source = "terraspace"');
	});

	it("emits a [migration.terraspace] section with templates and project", () => {
		const toml = scaffoldSubspaceToml(baseInput);
		expect(toml).toContain("[migration.terraspace]");
		expect(toml).toContain(
			'bucket_template = "terraform-state-:ACCOUNT-:REGION-:ENV"',
		);
		expect(toml).toContain(
			'key_template = ":PROJECT/:REGION/:APP/:ROLE/:ENV/:EXTRA/:BUILD_DIR/terraform.tfstate"',
		);
		expect(toml).toContain('project = "main"');
	});

	it("emits regions as a TOML array", () => {
		const toml = scaffoldSubspaceToml({
			...baseInput,
			regions: ["us-east-1", "us-west-2"],
		});
		expect(toml).toContain('regions = ["us-east-1", "us-west-2"]');
	});

	it("emits envs when discover found named envs", () => {
		const toml = scaffoldSubspaceToml(baseInput);
		expect(toml).toContain('envs = ["dev", "prod"]');
	});

	it("includes app_name when provided", () => {
		const toml = scaffoldSubspaceToml({ ...baseInput, appName: "my-app" });
		expect(toml).toContain('app_name = "my-app"');
	});

	it("omits app_name when not provided", () => {
		const toml = scaffoldSubspaceToml(baseInput);
		expect(toml).not.toContain("app_name");
	});

	it("emits a [project] section so the file is a valid subspace.toml", () => {
		const toml = scaffoldSubspaceToml(baseInput);
		expect(toml).toContain("[project]");
		expect(toml).toContain('backend = "s3"');
	});

	it("records discovered stacks and envs as comments for human reference", () => {
		const toml = scaffoldSubspaceToml(baseInput);
		expect(toml).toContain("# discovered stacks: network, compute");
		expect(toml).toContain("# discovered envs: dev, prod");
	});

	it("round-trips through parseMigrationConfig", async () => {
		const { parseMigrationConfig } = await import(
			"../../../src/migrate/config.js"
		);
		const toml = scaffoldSubspaceToml({ ...baseInput, appName: "my-app" });
		const parsed = parseMigrationConfig(toml);
		expect(parsed?.source).toBe("terraspace");
		expect(parsed?.terraspace?.bucketTemplate).toBe(baseInput.bucketTemplate);
		expect(parsed?.terraspace?.keyTemplate).toBe(baseInput.keyTemplate);
		expect(parsed?.terraspace?.regions).toEqual(["us-east-1"]);
		expect(parsed?.terraspace?.appName).toBe("my-app");
		expect(parsed?.terraspace?.project).toBe("main");
		expect(parsed?.terraspace?.envs).toEqual(["dev", "prod"]);
	});
});
