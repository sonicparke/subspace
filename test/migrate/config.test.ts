import { describe, expect, it } from "vitest";
import {
	loadMigrationConfig,
	parseMigrationConfig,
} from "../../src/migrate/config.js";
import { createMockContext } from "../helpers/mock-context.js";

const FULL_TOML = `[project]
backend = "s3"

[migration]
source = "terraspace"

[migration.terraspace]
bucket_template = "terraform-state-:ACCOUNT-:REGION-:ENV"
key_template = ":PROJECT/:REGION/:APP/:ROLE/:ENV/:EXTRA/:BUILD_DIR/terraform.tfstate"
project = "main"
regions = ["us-east-1", "us-west-2"]
envs = [ "k6-lnp" ]
role = "cost"
instance = "costengine"
app_name = "my-app"
`;

describe("parseMigrationConfig", () => {
	it("returns null when there is no [migration] section", () => {
		const toml = `[project]\nbackend = "s3"\n`;
		expect(parseMigrationConfig(toml)).toBeNull();
	});

	it("parses a complete terraspace migration block", () => {
		const cfg = parseMigrationConfig(FULL_TOML);
		expect(cfg).not.toBeNull();
		if (!cfg) return;
		expect(cfg.source).toBe("terraspace");
		expect(cfg.terraspace?.bucketTemplate).toBe(
			"terraform-state-:ACCOUNT-:REGION-:ENV",
		);
		expect(cfg.terraspace?.keyTemplate).toBe(
			":PROJECT/:REGION/:APP/:ROLE/:ENV/:EXTRA/:BUILD_DIR/terraform.tfstate",
		);
		expect(cfg.terraspace?.project).toBe("main");
		expect(cfg.terraspace?.regions).toEqual(["us-east-1", "us-west-2"]);
		expect(cfg.terraspace?.envs).toEqual(["k6-lnp"]);
		expect(cfg.terraspace?.role).toBe("cost");
		expect(cfg.terraspace?.instance).toBe("costengine");
		expect(cfg.terraspace?.appName).toBe("my-app");
	});

	it("throws when source is missing", () => {
		const toml = `[migration]\n[migration.terraspace]\nbucket_template = "x"\n`;
		expect(() => parseMigrationConfig(toml)).toThrow(/source/i);
	});

	it("throws when source is unknown", () => {
		const toml = `[migration]\nsource = "spacelift"\n`;
		expect(() => parseMigrationConfig(toml)).toThrow(/unsupported.*source/i);
	});

	it("throws when source is terraspace but [migration.terraspace] is missing", () => {
		const toml = `[migration]\nsource = "terraspace"\n`;
		expect(() => parseMigrationConfig(toml)).toThrow(
			/\[migration\.terraspace\]/,
		);
	});

	it("throws when bucket_template or key_template is missing", () => {
		const toml = `[migration]\nsource = "terraspace"\n[migration.terraspace]\nbucket_template = "x"\n`;
		expect(() => parseMigrationConfig(toml)).toThrow(/key_template/);
	});

	it("treats regions as optional and returns empty array if absent", () => {
		const toml = `[migration]\nsource = "terraspace"\n[migration.terraspace]\nbucket_template = "b"\nkey_template = "k"\n`;
		const cfg = parseMigrationConfig(toml);
		expect(cfg?.terraspace?.regions).toEqual([]);
	});
});

describe("loadMigrationConfig", () => {
	it("returns null when subspace.toml does not exist", async () => {
		const ctx = createMockContext({ files: {} });
		const cfg = await loadMigrationConfig(ctx);
		expect(cfg).toBeNull();
	});

	it("returns null when subspace.toml has no [migration]", async () => {
		const ctx = createMockContext({
			files: { "subspace.toml": `[project]\nbackend = "s3"\n` },
		});
		expect(await loadMigrationConfig(ctx)).toBeNull();
	});

	it("loads and parses the migration block from subspace.toml", async () => {
		const ctx = createMockContext({
			files: { "subspace.toml": FULL_TOML },
		});
		const cfg = await loadMigrationConfig(ctx);
		expect(cfg?.source).toBe("terraspace");
		expect(cfg?.terraspace?.regions).toEqual(["us-east-1", "us-west-2"]);
	});
});
