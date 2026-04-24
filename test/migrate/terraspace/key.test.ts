import { describe, expect, it } from "vitest";
import {
	buildDirOf,
	expand,
	expandBackendKey,
	withDerivedVars,
} from "../../../src/migrate/terraspace/key.js";

describe("expand()", () => {
	it("matches Terraspace's documented example", () => {
		const result = expand({
			template: ":REGION/:ENV/:BUILD_DIR/terraform.tfstate",
			vars: {
				region: "us-west-2",
				env: "dev",
				build_dir: "stacks/wordpress",
			},
		});
		expect(result).toBe("us-west-2/dev/stacks/wordpress/terraform.tfstate");
	});

	it("matches the user's real backend.tf template (empty app/role/extra)", () => {
		const template =
			":PROJECT/:REGION/:APP/:ROLE/:ENV/:EXTRA/:BUILD_DIR/terraform.tfstate";
		const result = expand({
			template,
			vars: {
				project: "main",
				region: "us-east-1",
				app: "",
				role: "",
				env: "prod",
				extra: "",
				build_dir: "stacks/network",
			},
		});
		expect(result).toBe(
			"main/us-east-1/prod/stacks/network/terraform.tfstate",
		);
	});

	it("matches the user's template with role populated", () => {
		const template =
			":PROJECT/:REGION/:APP/:ROLE/:ENV/:EXTRA/:BUILD_DIR/terraform.tfstate";
		const result = expand({
			template,
			vars: {
				project: "main",
				region: "us-east-1",
				app: "app1",
				role: "deploy",
				env: "prod",
				extra: "",
				build_dir: "stacks/network",
			},
		});
		expect(result).toBe(
			"main/us-east-1/app1/deploy/prod/stacks/network/terraform.tfstate",
		);
	});

	it("matches TS_ROLE=cost and TS_ENV=k6-lnp with empty :APP (key-pair legacy path)", () => {
		const template =
			":PROJECT/:REGION/:APP/:ROLE/:ENV/:EXTRA/:BUILD_DIR/terraform.tfstate";
		const result = expand({
			template,
			vars: {
				project: "main",
				region: "us-east-1",
				app: "",
				role: "cost",
				env: "k6-lnp",
				extra: "",
				build_dir: "stacks/key-pair",
			},
		});
		expect(result).toBe(
			"main/us-east-1/cost/k6-lnp/stacks/key-pair/terraform.tfstate",
		);
	});

	it("matches Terraspace's full default template with most vars empty", () => {
		// Per Terraspace's Ruby source, strip() only removes *trailing* slashes
		// and collapses runs of // into /. It does NOT remove leading slashes.
		// When :PROJECT is empty, the result therefore starts with `/`.
		// (In practice Terraspace sets PROJECT="main" by default, so this
		// edge case does not appear in the documented example output.)
		const template =
			":PROJECT/:TYPE_DIR/:APP/:ROLE/:MOD_NAME/:ENV/:EXTRA/:REGION/terraform.tfstate";
		const result = expand({
			template,
			vars: {
				project: "",
				type_dir: "stacks",
				app: "",
				role: "",
				mod_name: "demo",
				env: "dev",
				extra: "",
				region: "us-west-2",
			},
		});
		expect(result).toBe("/stacks/demo/dev/us-west-2/terraform.tfstate");
	});

	it("matches Terraspace's documented default example with PROJECT=main", () => {
		const template =
			":PROJECT/:TYPE_DIR/:APP/:ROLE/:MOD_NAME/:ENV/:EXTRA/:REGION/terraform.tfstate";
		const result = expand({
			template,
			vars: {
				project: "main",
				type_dir: "stacks",
				mod_name: "demo",
				env: "dev",
				region: "us-west-2",
			},
		});
		expect(result).toBe(
			"main/stacks/demo/dev/us-west-2/terraform.tfstate",
		);
	});

	it("expands the bucket name template", () => {
		const result = expand({
			template: "terraform-state-:ACCOUNT-:REGION-:ENV",
			vars: {
				account: "111111111111",
				region: "us-west-2",
				env: "dev",
			},
		});
		expect(result).toBe("terraform-state-111111111111-us-west-2-dev");
	});

	it("is case-insensitive on variable names (upper-snake as the canonical form)", () => {
		const result = expand({
			template: ":REGION/:ENV/terraform.tfstate",
			vars: { region: "us-east-1", env: "prod" },
		});
		expect(result).toBe("us-east-1/prod/terraform.tfstate");
	});

	it("collapses consecutive slashes when variables are missing", () => {
		const result = expand({
			template: ":A/:B/:C/file",
			vars: { a: "x", c: "z" },
		});
		expect(result).toBe("x/z/file");
	});

	it("strips trailing slashes", () => {
		const result = expand({
			template: ":REGION/:ENV/:BUILD_DIR/",
			vars: { region: "us-west-2", env: "dev", build_dir: "stacks/demo" },
		});
		expect(result).toBe("us-west-2/dev/stacks/demo");
	});

	it("strips leading and trailing hyphens", () => {
		const result = expand({
			template: "-:MOD_NAME-:ENV-:REGION-",
			vars: { mod_name: "demo", env: "dev", region: "us-west-2" },
		});
		expect(result).toBe("demo-dev-us-west-2");
	});

	it("preserves URL scheme separators", () => {
		const result = expand({
			template: "https://:BUCKET/:REGION/:ENV/file",
			vars: { bucket: "my-bucket", region: "us-east-1", env: "prod" },
		});
		expect(result).toBe("https://my-bucket/us-east-1/prod/file");
	});

	it("treats a missing variable as empty without leaving the literal token", () => {
		// Leading slash is preserved per Terraspace semantics (see strip() above).
		const result = expand({
			template: ":UNSET/:ENV/file",
			vars: { env: "dev" },
		});
		expect(result).toBe("/dev/file");
	});

	it("does not touch strings with no tokens", () => {
		const result = expand({
			template: "terraform.tfstate",
			vars: {},
		});
		expect(result).toBe("terraform.tfstate");
	});
});

describe("buildDirOf()", () => {
	it("joins type_dir and mod_name with a slash", () => {
		expect(buildDirOf("stacks", "network")).toBe("stacks/network");
	});

	it("appends instance with a hyphen when provided", () => {
		expect(buildDirOf("stacks", "network", "blue")).toBe("stacks/network-blue");
	});

	it("omits empty segments", () => {
		expect(buildDirOf(undefined, "network")).toBe("network");
		expect(buildDirOf("stacks", undefined)).toBe("stacks");
	});
});

describe("withDerivedVars()", () => {
	it("derives build_dir from type_dir + mod_name", () => {
		const out = withDerivedVars({ type_dir: "stacks", mod_name: "demo" });
		expect(out.build_dir).toBe("stacks/demo");
	});

	it("derives type_extra as type-extra when extra is set", () => {
		const out = withDerivedVars({ type: "stack", extra: "bob" });
		expect(out.type_extra).toBe("stack-bob");
	});

	it("falls back to bare type for type_extra when extra is empty", () => {
		const out = withDerivedVars({ type: "stack" });
		expect(out.type_extra).toBe("stack");
	});

	it("does not overwrite explicit build_dir", () => {
		const out = withDerivedVars({
			type_dir: "stacks",
			mod_name: "demo",
			build_dir: "custom/path",
		});
		expect(out.build_dir).toBe("custom/path");
	});
});

describe("expandBackendKey()", () => {
	it("auto-derives build_dir for the user's real template", () => {
		const key = expandBackendKey(
			":PROJECT/:REGION/:APP/:ROLE/:ENV/:EXTRA/:BUILD_DIR/terraform.tfstate",
			{
				project: "main",
				region: "us-east-1",
				env: "prod",
				type_dir: "stacks",
				mod_name: "network",
			},
		);
		expect(key).toBe("main/us-east-1/prod/stacks/network/terraform.tfstate");
	});

	it("handles instance suffix via build_dir derivation", () => {
		const key = expandBackendKey(
			":REGION/:ENV/:BUILD_DIR/terraform.tfstate",
			{
				region: "us-east-1",
				env: "prod",
				type_dir: "stacks",
				mod_name: "network",
				instance: "blue",
			},
		);
		expect(key).toBe("us-east-1/prod/stacks/network-blue/terraform.tfstate");
	});
});
