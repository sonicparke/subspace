import { describe, expect, it } from "vitest";
import { runMigrateStack } from "../../src/commands/migrate-stack.js";
import { loadStackConfig } from "../../src/config/stack-config.js";
import { createMockContext } from "../helpers/mock-context.js";

const SUBSPACE_TOML = `[project]
backend = "s3"

[migration]
source = "terraspace"

[migration.terraspace]
bucket_template = "terraform-state-:ACCOUNT-:REGION-:ENV"
key_template = ":PROJECT/:REGION/:APP/:ROLE/:ENV/:EXTRA/:BUILD_DIR/terraform.tfstate"
project = "main"
regions = ["us-east-1"]
`;

const SUBSPACE_TOML_TWO_REGIONS = SUBSPACE_TOML.replace(
	'regions = ["us-east-1"]',
	'regions = ["us-east-1", "us-west-2"]',
);

const SUBSPACE_TOML_WITH_APP = `${SUBSPACE_TOML}app_name = "my-app"\n`;
const SUBSPACE_TOML_NO_REGIONS = SUBSPACE_TOML.replace(
	'regions = ["us-east-1"]\n',
	"",
);
const COST_ENGINE_TOML = SUBSPACE_TOML.replace(
	'key_template = ":PROJECT/:REGION/:APP/:ROLE/:ENV/:EXTRA/:BUILD_DIR/terraform.tfstate"',
	'key_template = ":PROJECT/:REGION/:ENV/:APP/:BUILD_DIR/terraform.tfstate"',
);
const AMBIGUOUS_NAME_TOML = SUBSPACE_TOML.replace(
	'key_template = ":PROJECT/:REGION/:APP/:ROLE/:ENV/:EXTRA/:BUILD_DIR/terraform.tfstate"',
	'key_template = ":PROJECT/:REGION/stacks/network.:ENV/terraform.tfstate"',
).replace('regions = ["us-east-1"]', 'regions = ["us-east-1"]\nenvs = ["blue", "green"]');

function stsHandler() {
	return (cmd: string, args: string[]) => {
		if (cmd === "aws" && args[0] === "sts") {
			return {
				stdout: JSON.stringify({ Account: "123456789012" }),
				stderr: "",
				exitCode: 0,
			};
		}
		if (cmd === "aws" && args[0] === "s3api") {
			return { stdout: "{}", stderr: "", exitCode: 0 };
		}
		return { stdout: "", stderr: "", exitCode: 0 };
	};
}

function migrationExecHandler(options?: {
	legacyFound?: boolean;
	nativeFound?: boolean;
	cpExitCode?: number;
	cpStderr?: string;
}) {
	const native = options?.nativeFound ?? false;
	const legacy = options?.legacyFound ?? true;
	const cpExitCode = options?.cpExitCode ?? 0;
	const cpStderr = options?.cpStderr ?? "";
	return (cmd: string, args: string[]) => {
		if (cmd === "aws" && args[0] === "sts") {
			return {
				stdout: JSON.stringify({ Account: "123456789012" }),
				stderr: "",
				exitCode: 0,
			};
		}
		if (cmd === "aws" && args[0] === "s3api" && args[1] === "head-object") {
			const key =
				args.find((arg) => arg.startsWith("--key="))?.slice("--key=".length) ?? "";
			if (/\/stacks\/[^/]+\/[^/]+\/terraform\.tfstate$/.test(key)) {
				return native
					? { stdout: "{}", stderr: "", exitCode: 0 }
					: { stdout: "", stderr: "Not Found", exitCode: 255 };
			}
			return legacy
				? { stdout: "{}", stderr: "", exitCode: 0 }
				: { stdout: "", stderr: "Not Found", exitCode: 255 };
		}
		if (cmd === "aws" && args[0] === "s3" && args[1] === "cp") {
			return { stdout: "", stderr: cpStderr, exitCode: cpExitCode };
		}
		return { stdout: "", stderr: "", exitCode: 0 };
	};
}

describe("runMigrateStack (--dry-run)", () => {
	it("returns 'non-s3-backend' when the project backend is gcs", async () => {
		const toml = SUBSPACE_TOML.replace('backend = "s3"', 'backend = "gcs"');
		const ctx = createMockContext({
			files: { "subspace.toml": toml },
			execHandler: stsHandler(),
		});

		const result = await runMigrateStack(ctx, {
			stack: "network",
			env: "prod",
			dryRun: false,
		});

		expect(result.status).toBe("non-s3-backend");
		expect(result.report).toMatch(/gcs/i);
		expect(result.report).toMatch(/S3-only/i);
		expect(result.report).toMatch(/Delete the legacy state object manually/);
		expect(result.report).toMatch(/Legacy state is preserved/);
	});

	it("returns 'non-s3-backend' when the project backend is azurerm", async () => {
		const toml = SUBSPACE_TOML.replace('backend = "s3"', 'backend = "azurerm"');
		const ctx = createMockContext({
			files: { "subspace.toml": toml },
			execHandler: stsHandler(),
		});

		const result = await runMigrateStack(ctx, {
			stack: "network",
			env: "prod",
			dryRun: false,
		});

		expect(result.status).toBe("non-s3-backend");
		expect(result.report).toMatch(/azurerm/i);
		expect(result.report).toMatch(/S3-only/i);
	});

	it("returns 'no-migration-config' when subspace.toml has no [migration]", async () => {
		const ctx = createMockContext({
			files: { "subspace.toml": '[project]\nbackend = "s3"\n' },
			execHandler: stsHandler(),
		});

		const result = await runMigrateStack(ctx, {
			stack: "network",
			dryRun: true,
		});

		expect(result.status).toBe("no-migration-config");
		expect(result.report).toMatch(/migrate init/i);
	});

	it("returns 'no-migration-config' when subspace.toml is missing entirely", async () => {
		const ctx = createMockContext({
			files: {},
			execHandler: stsHandler(),
		});

		const result = await runMigrateStack(ctx, {
			stack: "network",
			dryRun: true,
		});

		expect(result.status).toBe("no-migration-config");
	});

	it("returns 'no-account' when AWS sts call fails", async () => {
		const ctx = createMockContext({
			files: { "subspace.toml": SUBSPACE_TOML },
			execHandler: () => ({ stdout: "", stderr: "creds", exitCode: 1 }),
		});

		const result = await runMigrateStack(ctx, {
			stack: "network",
			env: "prod",
			dryRun: true,
		});

		expect(result.status).toBe("no-account");
	});

	it("includes --profile in the no-account debug command when provided", async () => {
		const ctx = createMockContext({
			files: { "subspace.toml": SUBSPACE_TOML },
			execHandler: () => ({ stdout: "", stderr: "creds", exitCode: 1 }),
		});

		const result = await runMigrateStack(ctx, {
			stack: "network",
			env: "prod",
			dryRun: true,
			profile: "vnh",
		});

		expect(result.status).toBe("no-account");
		expect(result.report).toContain("aws sts get-caller-identity --profile vnh");
	});

	it("defaults regions to us-east-1 when none are configured", async () => {
		const ctx = createMockContext({
			files: { "subspace.toml": SUBSPACE_TOML_NO_REGIONS },
			execHandler: stsHandler(),
		});

		const result = await runMigrateStack(ctx, {
			stack: "network",
			env: "prod",
			dryRun: true,
		});

		expect(result.status).toBe("ok");
		expect(result.report).toContain("us-east-1");
	});

	it("copies legacy state to the native state location when --dry-run is omitted", async () => {
		const ctx = createMockContext({
			files: { "subspace.toml": SUBSPACE_TOML },
			execHandler: migrationExecHandler({
				legacyFound: true,
			}),
		});

		const result = await runMigrateStack(ctx, {
			stack: "network",
			env: "prod",
			dryRun: false,
		});

		expect(result.status).toBe("ok");
		expect(result.report).toContain("action: COPIED");
		const cpCalls = ctx.execCalls.filter(
			(call) => call.cmd === "aws" && call.args[0] === "s3" && call.args[1] === "cp",
		);
		expect(cpCalls).toHaveLength(1);
		expect(cpCalls[0].args).toContain(
			"s3://terraform-state-123456789012-us-east-1-prod/main/us-east-1/prod/stacks/network/terraform.tfstate",
		);
		expect(cpCalls[0].args).toContain(
			"s3://terraform-state-123456789012-us-east-1-prod/main/us-east-1/stacks/network/default/terraform.tfstate",
		);
		const stackConfig = await loadStackConfig(ctx, "network");
		expect(stackConfig?.migration?.native_state?.prod).toBe("default");
	});

	it("reports state preservation when --dry-run is omitted", async () => {
		const ctx = createMockContext({
			files: { "subspace.toml": SUBSPACE_TOML },
			execHandler: migrationExecHandler({
				legacyFound: true,
			}),
		});

		const result = await runMigrateStack(ctx, {
			stack: "network",
			env: "prod",
			dryRun: false,
		});

		expect(result.status).toBe("ok");
		expect(result.report).toContain("# Migration report");
		expect(result.report).not.toContain("# Migration report (dry-run)");
		expect(result.report).not.toContain("This was a dry-run.");
		expect(result.report).toMatch(
			/Migration applied for this report. Legacy state was copied to native state when needed./,
		);
		expect(result.report).toMatch(/Legacy state is preserved/);
	});

	it("skips copy when the native state location already exists", async () => {
		const ctx = createMockContext({
			files: { "subspace.toml": SUBSPACE_TOML },
			execHandler: migrationExecHandler({
				legacyFound: true,
				nativeFound: true,
			}),
		});

		const result = await runMigrateStack(ctx, {
			stack: "network",
			env: "prod",
			dryRun: false,
		});

		expect(result.status).toBe("ok");
		expect(result.report).toContain("action: SKIPPED (native exists)");
		const cpCalls = ctx.execCalls.filter(
			(call) => call.cmd === "aws" && call.args[0] === "s3" && call.args[1] === "cp",
		);
		expect(cpCalls).toHaveLength(0);
		const stackConfig = await loadStackConfig(ctx, "network");
		expect(stackConfig?.migration?.native_state?.prod).toBe("default");
	});

	it("frames the report as dry-run when --dry-run is passed", async () => {
		const ctx = createMockContext({
			files: { "subspace.toml": SUBSPACE_TOML },
			execHandler: stsHandler(),
		});

		const result = await runMigrateStack(ctx, {
			stack: "network",
			env: "prod",
			dryRun: true,
		});

		expect(result.status).toBe("ok");
		expect(result.report).toContain("# Migration report (dry-run)");
		expect(result.report).not.toContain("# Migration report (probe-only)");
		expect(result.report).toContain(
			"This was a dry-run. No files or state were modified.",
		);
		expect(result.report).toMatch(/Legacy state is preserved/);
	});

	it("returns env-required when no tfvars are discoverable for the stack and env is omitted", async () => {
		const ctx = createMockContext({
			files: { "subspace.toml": SUBSPACE_TOML },
			execHandler: stsHandler(),
		});

		const result = await runMigrateStack(ctx, {
			stack: "network",
			dryRun: true,
		});

		expect(result.status).toBe("env-required");
		expect(result.report).toMatch(/No envs found/);
		expect(result.report).toMatch(/<env>/i);
	});

	it("returns env-required when the stack has only base.tfvars and no [migration.terraspace].envs", async () => {
		const ctx = createMockContext({
			files: {
				"subspace.toml": SUBSPACE_TOML,
				"app/stacks/key-pair/tfvars/base.tfvars": "",
				"app/stacks/other/tfvars/dev.tfvars": "",
				"app/stacks/another/tfvars/prod.tfvars": "",
			},
			execHandler: stsHandler(),
		});

		const result = await runMigrateStack(ctx, {
			stack: "key-pair",
			dryRun: true,
		});

		expect(result.status).toBe("env-required");
	});

	it("adds [migration.terraspace].envs when no tfvars name exists for that env (e.g. k6-lnp + TS_ENV)", async () => {
		const toml = `${SUBSPACE_TOML}envs = [ "k6-lnp" ]\n`;
		const ctx = createMockContext({
			files: {
				"subspace.toml": toml,
				"app/stacks/key-pair/tfvars/base.tfvars": "",
			},
			execHandler: stsHandler(),
		});

		const result = await runMigrateStack(ctx, {
			stack: "key-pair",
			dryRun: true,
		});

		expect(result.status).toBe("ok");
		expect(result.report).toMatch(/k6-lnp/);
	});

	it("discovers all envs for the stack when env is omitted", async () => {
		const ctx = createMockContext({
			files: {
				"subspace.toml": SUBSPACE_TOML,
				"app/stacks/key-pair/tfvars/base.tfvars": "",
				"app/stacks/key-pair/tfvars/staging.tfvars": "",
				"app/stacks/key-pair/tfvars/prod.tfvars": "",
			},
			execHandler: stsHandler(),
		});

		const result = await runMigrateStack(ctx, {
			stack: "key-pair",
			dryRun: true,
		});

		expect(result.status).toBe("ok");
		expect(result.report).toMatch(/Envs:\s+\*\*prod, staging\*\*/);
		expect(result.report).toContain("2 — discovered for this stack");
		expect(result.report).toMatch(/## key-pair \/ prod \//);
		expect(result.report).toMatch(/## key-pair \/ staging \//);
	});

	it("does not add global migration env hints when stack-specific tfvars exist", async () => {
		const toml = `${SUBSPACE_TOML}envs = ["ts04", "uat", "uat-a", "uat-b"]\n`;
		const ctx = createMockContext({
			files: {
				"subspace.toml": toml,
				"app/stacks/cost-engine-ecs/tfvars/base.tfvars": "",
				"app/stacks/cost-engine-ecs/tfvars/vnh.tfvars": "",
				"app/stacks/unrelated/tfvars/ts04.tfvars": "",
				"app/stacks/unrelated/tfvars/uat.tfvars": "",
			},
			execHandler: stsHandler(),
		});

		const result = await runMigrateStack(ctx, {
			stack: "cost-engine-ecs",
			dryRun: true,
		});

		expect(result.status).toBe("ok");
		expect(result.report).toMatch(/Env:\s+\*\*vnh\*\*/);
		expect(result.report).toMatch(/## cost-engine-ecs \/ vnh \//);
		expect(result.report).not.toMatch(/## cost-engine-ecs \/ ts04 \//);
		expect(result.report).not.toMatch(/## cost-engine-ecs \/ uat \//);
		expect(result.report).not.toMatch(/## cost-engine-ecs \/ uat-a \//);
		expect(result.report).not.toMatch(/## cost-engine-ecs \/ uat-b \//);
	});

	it("builds a single-row plan when stack and env are both supplied", async () => {
		const ctx = createMockContext({
			files: { "subspace.toml": SUBSPACE_TOML },
			execHandler: stsHandler(),
		});

		const result = await runMigrateStack(ctx, {
			stack: "network",
			env: "prod",
			dryRun: true,
		});

		expect(result.status).toBe("ok");
		expect(result.report).toContain("network");
		expect(result.report).toContain("prod");
		expect(result.report).toContain("us-east-1");
		expect(result.report).toContain(
			"s3://terraform-state-123456789012-us-east-1-prod/main/us-east-1/stacks/network/default/terraform.tfstate",
		);
	});

	it("passes --profile to AWS account and probe calls", async () => {
		const ctx = createMockContext({
			files: { "subspace.toml": SUBSPACE_TOML },
			execHandler: stsHandler(),
		});

		const result = await runMigrateStack(ctx, {
			stack: "network",
			env: "prod",
			dryRun: true,
			profile: "vnh",
		});

		expect(result.status).toBe("ok");
		for (const call of ctx.execCalls) {
			expect(call.args).toContain("--profile");
			expect(call.args).toContain("vnh");
		}
	});

	it("uses role from [migration.terraspace] for :ROLE in the legacy key (TS_ROLE)", async () => {
		const toml = `${SUBSPACE_TOML}role = "cost"\n`;
		const ctx = createMockContext({
			files: { "subspace.toml": toml },
			execHandler: stsHandler(),
		});

		const result = await runMigrateStack(ctx, {
			stack: "key-pair",
			env: "k6-lnp",
			dryRun: true,
		});

		expect(result.status).toBe("ok");
		expect(result.report).toContain(
			"main/us-east-1/cost/k6-lnp/stacks/key-pair/terraform.tfstate",
		);
	});

	it("includes the legacy S3 URI in the report", async () => {
		const ctx = createMockContext({
			files: { "subspace.toml": SUBSPACE_TOML },
			execHandler: stsHandler(),
		});

		const result = await runMigrateStack(ctx, {
			stack: "network",
			env: "prod",
			dryRun: true,
		});

		expect(result.report).toContain(
			"s3://terraform-state-123456789012-us-east-1-prod/main/us-east-1/prod/stacks/network/terraform.tfstate",
		);
	});

	it("keeps the configured backend URI aligned with the legacy S3 URI", async () => {
		const ctx = createMockContext({
			files: { "subspace.toml": SUBSPACE_TOML_WITH_APP },
			execHandler: stsHandler(),
		});

		const result = await runMigrateStack(ctx, {
			stack: "network",
			env: "prod",
			dryRun: true,
		});

		expect(result.report).toContain(
			"s3://terraform-state-123456789012-us-east-1-prod/main/us-east-1/prod/stacks/network/terraform.tfstate",
		);
	});

	it("derives cost-engine-ecs instance state paths", async () => {
		const ctx = createMockContext({
			files: { "subspace.toml": COST_ENGINE_TOML },
			execHandler: stsHandler(),
		});

		const result = await runMigrateStack(ctx, {
			stack: "cost-engine-ecs",
			env: "qa",
			app: "costengine",
			instance: "costengine",
			dryRun: true,
		});

		expect(result.status).toBe("ok");
		expect(result.report).toContain(
			"s3://terraform-state-123456789012-us-east-1-qa/main/us-east-1/qa/costengine/stacks/cost-engine-ecs.costengine/terraform.tfstate",
		);
		expect(result.report).toContain(
			"s3://terraform-state-123456789012-us-east-1-qa/main/us-east-1/stacks/cost-engine-ecs/costengine/terraform.tfstate",
		);
	});

	it("--name overrides the inferred native state name", async () => {
		const ctx = createMockContext({
			files: { "subspace.toml": COST_ENGINE_TOML },
			execHandler: stsHandler(),
		});

		const result = await runMigrateStack(ctx, {
			stack: "cost-engine-ecs",
			env: "qa",
			app: "costengine",
			instance: "costengine",
			name: "billing",
			dryRun: true,
		});

		expect(result.status).toBe("ok");
		expect(result.report).toContain(
			"s3://terraform-state-123456789012-us-east-1-qa/main/us-east-1/stacks/cost-engine-ecs/billing/terraform.tfstate",
		);
		expect(result.report).not.toContain(
			"s3://terraform-state-123456789012-us-east-1-qa/main/us-east-1/stacks/cost-engine-ecs/costengine/terraform.tfstate",
		);
	});

	it("uses the prompt callback when multiple native names are inferred", async () => {
		const ctx = createMockContext({
			files: { "subspace.toml": AMBIGUOUS_NAME_TOML },
			execHandler: stsHandler(),
		});

		const result = await runMigrateStack(ctx, {
			stack: "network",
			dryRun: true,
			chooseName: async ({ candidates }) => {
				expect(candidates).toEqual(["blue", "green"]);
				return "green";
			},
		});

		expect(result.status).toBe("ok");
		expect(result.report).toContain(
			"s3://terraform-state-123456789012-us-east-1-blue/main/us-east-1/stacks/network/green/terraform.tfstate",
		);
		expect(result.report).toContain(
			"s3://terraform-state-123456789012-us-east-1-green/main/us-east-1/stacks/network/green/terraform.tfstate",
		);
	});

	it("requires --name when multiple native names are inferred non-interactively", async () => {
		const ctx = createMockContext({
			files: { "subspace.toml": AMBIGUOUS_NAME_TOML },
			execHandler: stsHandler(),
		});

		const result = await runMigrateStack(ctx, {
			stack: "network",
			dryRun: true,
		});

		expect(result.status).toBe("name-required");
		expect(result.report).toContain("--name <name>");
	});

	it("--regions flag overrides regions from config", async () => {
		const ctx = createMockContext({
			files: { "subspace.toml": SUBSPACE_TOML },
			execHandler: stsHandler(),
		});

		const result = await runMigrateStack(ctx, {
			stack: "network",
			env: "prod",
			dryRun: true,
			regions: ["eu-west-1"],
		});

		expect(result.report).toContain("eu-west-1");
		expect(result.report).not.toContain("us-east-1");
	});

	it("expands across multiple regions when config lists more than one", async () => {
		const ctx = createMockContext({
			files: { "subspace.toml": SUBSPACE_TOML_TWO_REGIONS },
			execHandler: stsHandler(),
		});

		const result = await runMigrateStack(ctx, {
			stack: "network",
			env: "prod",
			dryRun: true,
		});

		expect(result.report).toContain("us-east-1");
		expect(result.report).toContain("us-west-2");
	});

	it("marks state objects as FOUND or MISSING based on s3api head-object result", async () => {
		const ctx = createMockContext({
			files: { "subspace.toml": SUBSPACE_TOML },
			execHandler: (cmd, args) => {
				if (cmd === "aws" && args[0] === "sts") {
					return {
						stdout: JSON.stringify({ Account: "123456789012" }),
						stderr: "",
						exitCode: 0,
					};
				}
				return { stdout: "", stderr: "Not Found", exitCode: 255 };
			},
		});

		const result = await runMigrateStack(ctx, {
			stack: "network",
			env: "prod",
			dryRun: true,
		});

		expect(result.report).toMatch(/legacy:\s*MISSING/i);
	});

	it("does not write any files in dry-run mode", async () => {
		const ctx = createMockContext({
			files: { "subspace.toml": SUBSPACE_TOML },
			execHandler: stsHandler(),
		});
		const before = Object.keys(ctx.files).sort();

		await runMigrateStack(ctx, {
			stack: "network",
			env: "prod",
			dryRun: true,
		});

		expect(Object.keys(ctx.files).sort()).toEqual(before);
	});

	it("preserves existing stack config fields when saving native state mapping", async () => {
		const ctx = createMockContext({
			files: {
				"subspace.toml": SUBSPACE_TOML,
				"app/stacks/network/subspace.toml": `[stack]
name = "Network"
provider = "aws"

[regions]
values = ["us-east-1"]

[provider]
region = "us-east-1"
`,
			},
			execHandler: migrationExecHandler({
				legacyFound: true,
			}),
		});

		const result = await runMigrateStack(ctx, {
			stack: "network",
			env: "prod",
			dryRun: false,
		});

		expect(result.status).toBe("ok");
		const stackConfig = await loadStackConfig(ctx, "network");
		expect(stackConfig?.stack.name).toBe("Network");
		expect(stackConfig?.provider.settings.region).toBe("us-east-1");
		expect(stackConfig?.migration?.native_state?.prod).toBe("default");
	});
});
