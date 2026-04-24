import { describe, expect, it } from "vitest";
import { invokeEngine } from "../../src/engine/invoke.js";
import { createMockContext } from "../helpers/mock-context.js";

const MIGRATION_TOML = `[project]
backend = "s3"

[migration]
source = "terraspace"

[migration.terraspace]
bucket_template = "terraform-state-:ACCOUNT-:REGION-:ENV"
key_template = ":PROJECT/:REGION/:APP/:ROLE/:ENV/:EXTRA/:BUILD_DIR/terraform.tfstate"
project = "main"
regions = ["us-east-1"]
`;

describe("invokeEngine", () => {
	it("runs init when .terraform is missing", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			files: {
				"build/main.tf": "resource {}",
			},
			streamHandler: () => 0,
		});

		const code = await invokeEngine(
			ctx,
			"build",
			"plan",
			"mystack",
			"prod",
			"us-east-1",
		);

		expect(code).toBe(0);
		// Should have run init then plan
		expect(ctx.streamCalls).toHaveLength(2);
		expect(ctx.streamCalls[0].args).toContain("init");
		expect(ctx.streamCalls[1].args).toContain("plan");
	});

	it("skips init when .terraform exists", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			files: {
				"build/.terraform/terraform.tfstate": "{}",
				"build/main.tf": "resource {}",
			},
			streamHandler: () => 0,
		});

		const code = await invokeEngine(
			ctx,
			"build",
			"plan",
			"mystack",
			"prod",
			"us-east-1",
		);

		expect(code).toBe(0);
		// Should have run only plan
		expect(ctx.streamCalls).toHaveLength(1);
		expect(ctx.streamCalls[0].args).toContain("plan");
	});

	it("uses -chdir flag", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			files: {
				"build/.terraform/terraform.tfstate": "{}",
			},
			streamHandler: () => 0,
		});

		await invokeEngine(ctx, "build", "apply", "mystack", "prod", "us-east-1");

		expect(ctx.streamCalls[0].args[0]).toBe("-chdir=build");
	});

	it("passes engine args", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			engineArgs: ["-target=module.foo"],
			files: {
				"build/.terraform/terraform.tfstate": "{}",
			},
			streamHandler: () => 0,
		});

		await invokeEngine(ctx, "build", "plan", "mystack", "prod", "us-east-1");

		expect(ctx.streamCalls[0].args).toContain("-input=false");
		expect(ctx.streamCalls[0].args).toContain("-target=module.foo");
	});

	it("runs workflow commands with -input=false by default", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			files: {
				"build/.terraform/terraform.tfstate": "{}",
			},
			streamHandler: () => 0,
		});

		await invokeEngine(ctx, "build", "plan", "mystack", "prod", "us-east-1");

		expect(ctx.streamCalls[0].args).toContain("-input=false");
	});

	it("does not inject -input=false when the user already provided an input flag", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			engineArgs: ["-input=true"],
			files: {
				"build/.terraform/terraform.tfstate": "{}",
			},
			streamHandler: () => 0,
		});

		await invokeEngine(ctx, "build", "plan", "mystack", "prod", "us-east-1");

		expect(
			ctx.streamCalls[0].args.filter((arg) => arg === "-input=false"),
		).toHaveLength(0);
		expect(ctx.streamCalls[0].args).toContain("-input=true");
	});

	it("returns non-zero exit code from engine", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			files: {
				"build/.terraform/terraform.tfstate": "{}",
			},
			streamHandler: () => 1,
		});

		const code = await invokeEngine(
			ctx,
			"build",
			"plan",
			"mystack",
			"prod",
			"us-east-1",
		);
		expect(code).toBe(1);
	});

	it("retries with init when stderr contains init-required pattern", async () => {
		let callCount = 0;
		const ctx = createMockContext({
			engine: "tofu",
			files: {
				"build/.terraform/terraform.tfstate": "{}",
				"build/main.tf": "resource {}",
			},
			streamHandler: (_cmd, args) => {
				if (args.includes("init")) return { exitCode: 0, stderr: "" };
				callCount++;
				if (callCount === 1) {
					return { exitCode: 1, stderr: "Error: Module not installed" };
				}
				return { exitCode: 0, stderr: "" };
			},
		});

		const code = await invokeEngine(
			ctx,
			"build",
			"plan",
			"mystack",
			"prod",
			"us-east-1",
		);

		expect(code).toBe(0);
		// Should have: plan (fail) -> init -> plan (success)
		expect(ctx.streamCalls).toHaveLength(3);
		expect(ctx.streamCalls[1].args).toContain("init");
	});

	it("dual-read is a no-op when [migration] is absent from subspace.toml (pure-TF users pay zero cost)", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			cwd: "/workspace/demo-app",
			files: {
				"build/backend.tf": 'terraform { backend "s3" {} }',
				"build/.terraform/terraform.tfstate": "{}",
				"subspace.toml": '[project]\nbackend = "s3"\n',
			},
			execHandler: () => ({ stdout: "{}", stderr: "", exitCode: 0 }),
			streamHandler: () => 0,
		});

		await invokeEngine(ctx, "build", "plan", "mystack", "prod", "us-east-1");

		const s3apiCalls = ctx.execCalls.filter(
			(c) => c.cmd === "aws" && c.args[0] === "s3api",
		);
		const s3cpCalls = ctx.execCalls.filter(
			(c) => c.cmd === "aws" && c.args[0] === "s3" && c.args[1] === "cp",
		);
		const stsCalls = ctx.execCalls.filter(
			(c) => c.cmd === "aws" && c.args[0] === "sts",
		);
		expect(s3apiCalls.length).toBe(0);
		expect(s3cpCalls.length).toBe(0);
		expect(stsCalls.length).toBe(0);
	});

	it("uses the existing Terraspace backend location for s3 init when migration config is present", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			cwd: "/workspace/demo-app",
			files: {
				"build/backend.tf": 'terraform { backend "s3" {} }',
				"subspace.toml": MIGRATION_TOML,
			},
			execHandler: (cmd, args) => {
				if (cmd === "aws" && args[0] === "sts") {
					return {
						stdout: JSON.stringify({ Account: "123456789012" }),
						stderr: "",
						exitCode: 0,
					};
				}
				return { stdout: "", stderr: "", exitCode: 0 };
			},
			streamHandler: () => 0,
		});

		await invokeEngine(ctx, "build", "plan", "mystack", "prod", "us-east-1");

		const initCall = ctx.streamCalls.find((c) => c.args.includes("init"));
		expect(initCall).toBeDefined();
		expect(initCall?.args).toContain(
			"-backend-config=bucket=terraform-state-123456789012-us-east-1-prod",
		);
		expect(
			initCall?.args,
		).toContain(
			"-backend-config=key=main/us-east-1/prod/stacks/mystack/terraform.tfstate",
		);
		const s3cpCalls = ctx.execCalls.filter(
			(c) => c.cmd === "aws" && c.args[0] === "s3" && c.args[1] === "cp",
		);
		expect(s3cpCalls.length).toBe(0);
		expect(
			ctx.logs.info.some((l) => /using existing Terraspace state location/.test(l)),
		).toBe(true);
	});

	it("falls back to the standard Subspace backend location when AWS account lookup fails", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			cwd: "/workspace/demo-app",
			files: {
				"build/backend.tf": 'terraform { backend "s3" {} }',
				"subspace.toml": MIGRATION_TOML,
			},
			execHandler: () => ({ stdout: "", stderr: "creds", exitCode: 1 }),
			streamHandler: () => 0,
		});

		await invokeEngine(ctx, "build", "plan", "mystack", "prod", "us-east-1");

		const initCall = ctx.streamCalls.find((c) => c.args.includes("init"));
		expect(initCall).toBeDefined();
		expect(
			initCall?.args,
		).toContain("-backend-config=bucket=demo-app-subspace-aws-state");
		expect(
			initCall?.args,
		).toContain(
			"-backend-config=key=subspace/aws/us-east-1/prod/mystack/subspace.tfstate",
		);
		expect(
			ctx.logs.warn.some((l) => /could not resolve AWS account id/.test(l)),
		).toBe(true);
	});

	it("dual-read warns and continues when backend is gcs with migration config", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			cwd: "/workspace/demo-app",
			files: {
				"build/backend.tf": 'terraform { backend "gcs" {} }',
				"subspace.toml": MIGRATION_TOML,
			},
			execHandler: () => ({ stdout: "{}", stderr: "", exitCode: 0 }),
			streamHandler: () => 0,
		});

		const code = await invokeEngine(
			ctx,
			"build",
			"plan",
			"mystack",
			"prod",
			"us-east-1",
		);

		expect(code).toBe(0);
		expect(
			ctx.logs.warn.some(
				(l) =>
					/preserving the existing remote state location is only implemented for S3/.test(
						l,
					),
			),
		).toBe(true);
		const s3cpCalls = ctx.execCalls.filter(
			(c) => c.cmd === "aws" && c.args[0] === "s3" && c.args[1] === "cp",
		);
		expect(s3cpCalls.length).toBe(0);
	});

	it("dual-read warns and continues when backend is azurerm with migration config", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			cwd: "/workspace/demo-app",
			files: {
				"build/backend.tf": 'terraform { backend "azurerm" {} }',
				"subspace.toml": MIGRATION_TOML,
			},
			execHandler: () => ({ stdout: "{}", stderr: "", exitCode: 0 }),
			streamHandler: () => 0,
		});

		await invokeEngine(ctx, "build", "plan", "mystack", "prod", "us-east-1");

		expect(
			ctx.logs.warn.some(
				(l) =>
					/preserving the existing remote state location is only implemented for S3/.test(
						l,
					),
			),
		).toBe(true);
	});

	it("retries init with -reconfigure when command fails with 'Backend configuration changed'", async () => {
		let planCall = 0;
		const ctx = createMockContext({
			engine: "tofu",
			files: {
				"build/backend.tf": 'terraform { backend "s3" {} }',
				"build/.terraform/terraform.tfstate": "{}",
			},
			streamHandler: (_cmd, args) => {
				if (args.includes("init")) return { exitCode: 0, stderr: "" };
				planCall += 1;
				if (planCall === 1) {
					return {
						exitCode: 1,
						stderr: "Error: Backend configuration changed",
					};
				}
				return { exitCode: 0, stderr: "" };
			},
		});

		const code = await invokeEngine(
			ctx,
			"build",
			"plan",
			"mystack",
			"prod",
			"us-east-1",
		);

		expect(code).toBe(0);
		const initCalls = ctx.streamCalls.filter((c) => c.args.includes("init"));
		const reconfigureCalls = initCalls.filter((c) =>
			c.args.includes("-reconfigure"),
		);
		expect(reconfigureCalls.length).toBe(1);
		const planCalls = ctx.streamCalls.filter((c) => c.args.includes("plan"));
		expect(planCalls.length).toBe(2);
	});

	it("retries init with -reconfigure when init itself fails with 'Backend configuration changed'", async () => {
		let initCall = 0;
		const ctx = createMockContext({
			engine: "tofu",
			files: {
				"build/backend.tf": 'terraform { backend "s3" {} }',
			},
			streamHandler: (_cmd, args) => {
				if (args.includes("init")) {
					initCall += 1;
					if (initCall === 1) {
						return {
							exitCode: 1,
							stderr:
								"Error: Backend configuration changed for \"s3\". Reinitialization required.",
						};
					}
					return { exitCode: 0, stderr: "" };
				}
				return { exitCode: 0, stderr: "" };
			},
		});

		const code = await invokeEngine(
			ctx,
			"build",
			"plan",
			"mystack",
			"prod",
			"us-east-1",
		);

		expect(code).toBe(0);
		const initCalls = ctx.streamCalls.filter((c) => c.args.includes("init"));
		expect(initCalls.length).toBe(2);
		expect(initCalls[1].args).toContain("-reconfigure");
	});

	it("does NOT auto-retry with -migrate-state; surfaces error and exits", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			files: {
				"build/backend.tf": 'terraform { backend "s3" {} }',
				"build/.terraform/terraform.tfstate": "{}",
			},
			streamHandler: (_cmd, args) => {
				if (args.includes("init")) return { exitCode: 0, stderr: "" };
				return {
					exitCode: 1,
					stderr:
						"Error: Initializing the backend. Use -migrate-state to migrate existing state.",
				};
			},
		});

		const code = await invokeEngine(
			ctx,
			"build",
			"plan",
			"mystack",
			"prod",
			"us-east-1",
		);

		expect(code).toBe(1);
		expect(
			ctx.logs.error.some((l) => /-migrate-state/.test(l)),
		).toBe(true);
		const reconfigureCalls = ctx.streamCalls.filter((c) =>
			c.args.includes("-reconfigure"),
		);
		expect(reconfigureCalls.length).toBe(0);
	});

	it("does not loop forever when reconfigure still fails", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			files: {
				"build/backend.tf": 'terraform { backend "s3" {} }',
				"build/.terraform/terraform.tfstate": "{}",
			},
			streamHandler: (_cmd, args) => {
				if (args.includes("init")) {
					return {
						exitCode: 1,
						stderr: "Error: Backend configuration changed",
					};
				}
				return {
					exitCode: 1,
					stderr: "Error: Backend configuration changed",
				};
			},
		});

		const code = await invokeEngine(
			ctx,
			"build",
			"plan",
			"mystack",
			"prod",
			"us-east-1",
		);

		expect(code).not.toBe(0);
		const initCalls = ctx.streamCalls.filter((c) => c.args.includes("init"));
		expect(initCalls.length).toBeLessThanOrEqual(2);
	});

	it("auto-injects backend config during init for s3", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			cwd: "/workspace/demo-app",
			files: {
				"build/backend.tf":
					'terraform {\n  backend "s3" {\n    bucket = "b"\n  }\n}',
			},
			streamHandler: () => 0,
		});

		await invokeEngine(ctx, "build", "plan", "mystack", "prod", "us-east-1");

		const initCall = ctx.streamCalls[0];
		expect(initCall.args).toContain("init");
		expect(initCall.args).toContain(
			"-backend-config=bucket=demo-app-subspace-aws-state",
		);
		expect(initCall.args).toContain(
			"-backend-config=key=subspace/aws/us-east-1/prod/mystack/subspace.tfstate",
		);
	});

	it("chdirs into the passed build dir (preserves Terraspace-style stacks/<stack>/ layout from caller)", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			cwd: "/workspace/demo-app",
			files: {
				".subspace/build/mystack/us-east-1/prod/stacks/mystack/backend.tf":
					'terraform { backend "s3" {} }',
				".subspace/build/mystack/us-east-1/prod/stacks/mystack/.terraform/terraform.tfstate":
					"{}",
				"subspace.toml": MIGRATION_TOML,
			},
			execHandler: (cmd, args) => {
				if (cmd === "aws" && args[0] === "sts") {
					return {
						stdout: JSON.stringify({ Account: "123456789012" }),
						stderr: "",
						exitCode: 0,
					};
				}
				if (cmd === "aws" && args[0] === "s3api" && args[1] === "head-object") {
					const key =
						args
							.find((a) => a.startsWith("--key="))
							?.slice("--key=".length) ?? "";
					if (key.startsWith("subspace/")) {
						return { stdout: "", stderr: "Not Found", exitCode: 255 };
					}
					return { stdout: "{}", stderr: "", exitCode: 0 };
				}
				if (cmd === "aws" && args[0] === "s3" && args[1] === "cp") {
					return { stdout: "", stderr: "", exitCode: 0 };
				}
				return { stdout: "", stderr: "", exitCode: 0 };
			},
			streamHandler: () => 0,
		});

		await invokeEngine(
			ctx,
			".subspace/build/mystack/us-east-1/prod/stacks/mystack",
			"plan",
			"mystack",
			"prod",
			"us-east-1",
		);

		const s3cpCalls = ctx.execCalls.filter(
			(c) => c.cmd === "aws" && c.args[0] === "s3" && c.args[1] === "cp",
		);
		expect(s3cpCalls.length).toBe(0);

		const planCall = ctx.streamCalls.find((c) => c.args.includes("plan"));
		expect(planCall?.args).toContain(
			"-chdir=.subspace/build/mystack/us-east-1/prod/stacks/mystack",
		);
	});
});
