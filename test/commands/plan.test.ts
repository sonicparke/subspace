import { describe, it, expect } from "vitest";
import { runPlan } from "../../src/commands/plan.js";
import { createMockContext } from "../helpers/mock-context.js";

describe("runPlan", () => {
	it("errors when stack does not exist", async () => {
		const ctx = createMockContext({ engine: "tofu" });

		const code = await runPlan(ctx, { stack: "missing" });

		expect(code).toBe(1);
		expect(ctx.logs.error[0]).toContain('stack "missing" not found');
	});

	it("runs clean rebuild, var layers, and invokes engine", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			files: {
				"app/stacks/mystack/main.tf": "resource {}",
				"app/stacks/mystack/tfvars/base.tfvars": "x = 1",
			},
			streamHandler: () => 0,
		});

		const code = await runPlan(ctx, { stack: "mystack", env: "prod" });

		expect(code).toBe(0);
		expect(
			ctx.files[".subspace/build/mystack/global/prod/stacks/mystack/main.tf"],
		).toBe("resource {}");
		expect(
			ctx.files[
				".subspace/build/mystack/global/prod/stacks/mystack/00-base.auto.tfvars"
			],
		).toBe("x = 1");
		expect(ctx.streamCalls.some((c) => c.args.includes("plan"))).toBe(true);
	});

	it("uses __noenv__ when env is omitted", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			files: {
				"app/stacks/mystack/main.tf": "resource {}",
			},
			streamHandler: () => 0,
		});

		await runPlan(ctx, { stack: "mystack" });

		expect(
			ctx.files[
				".subspace/build/mystack/global/__noenv__/stacks/mystack/main.tf"
			],
		).toBe("resource {}");
	});

	it("uses infra/vendor as a fallback module root for Terraspace migrations", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			files: {
				"subspace.toml": `[migration]
source = "terraspace"

[migration.terraspace]
bucket_template = "legacy-bucket"
key_template = "legacy-key"
regions = ["us-east-1"]`,
				"app/stacks/mystack/main.tf":
					'module "key-pair" { source = "../../modules/key-pair" }',
				"infra/vendor/key_pair/main.tf": "vendor module",
			},
			streamHandler: () => 0,
		});

		const code = await runPlan(ctx, { stack: "mystack", env: "prod" });

		expect(code).toBe(0);
		expect(
			ctx.files[".subspace/build/mystack/global/prod/modules/key-pair/main.tf"],
		).toBe("vendor module");
	});

	it("uses vendor/modules as a Terraspace module root", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			files: {
				"subspace.toml": `[migration]
source = "terraspace"

[migration.terraspace]
bucket_template = "legacy-bucket"
key_template = "legacy-key"
regions = ["us-east-1"]`,
				"app/stacks/mystack/main.tf":
					'module "key-pair" { source = "../../modules/key-pair" }',
				"vendor/modules/key_pair/main.tf": "standard vendor module",
			},
			streamHandler: () => 0,
		});

		const code = await runPlan(ctx, { stack: "mystack", env: "prod" });

		expect(code).toBe(0);
		expect(
			ctx.files[".subspace/build/mystack/global/prod/modules/key-pair/main.tf"],
		).toBe("standard vendor module");
	});

	it("finds nested infra/vendor modules for Terraspace migrations", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			files: {
				"subspace.toml": `[migration]
source = "terraspace"

[migration.terraspace]
bucket_template = "legacy-bucket"
key_template = "legacy-key"
regions = ["us-east-1"]`,
				"app/stacks/mystack/main.tf":
					'module "key-pair" { source = "../../modules/key-pair" }',
				"infra/vendor/modules/aws/key_pair/main.tf": "nested vendor module",
			},
			streamHandler: () => 0,
		});

		const code = await runPlan(ctx, { stack: "mystack", env: "prod" });

		expect(code).toBe(0);
		expect(
			ctx.files[".subspace/build/mystack/global/prod/modules/key-pair/main.tf"],
		).toBe("nested vendor module");
	});

	it("layers project and stack tfvars during Terraspace migrations", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			files: {
				"subspace.toml": `[migration]
source = "terraspace"

[migration.terraspace]
bucket_template = "legacy-bucket"
key_template = "legacy-key"
regions = ["us-east-1"]`,
				"app/stacks/mystack/main.tf": "resource {}",
				"config/terraform/tfvars/base.tfvars": "project_base = true",
				"config/terraform/tfvars/prod.tfvars": "project_env = true",
				"config/stacks/mystack/tfvars/base.tfvars": "stack_cfg_base = true",
				"app/stacks/mystack/tfvars/prod.tfvars": "stack_env = true",
			},
			streamHandler: () => 0,
		});

		const code = await runPlan(ctx, { stack: "mystack", env: "prod" });

		expect(code).toBe(0);
		expect(
			ctx.files[
				".subspace/build/mystack/global/prod/stacks/mystack/00-project-base.auto.tfvars"
			],
		).toBe("project_base = true");
		expect(
			ctx.files[
				".subspace/build/mystack/global/prod/stacks/mystack/01-project-env.auto.tfvars"
			],
		).toBe("project_env = true");
		expect(
			ctx.files[
				".subspace/build/mystack/global/prod/stacks/mystack/05-stack-config-base.auto.tfvars"
			],
		).toBe("stack_cfg_base = true");
		expect(
			ctx.files[
				".subspace/build/mystack/global/prod/stacks/mystack/11-stack-env.auto.tfvars"
			],
		).toBe("stack_env = true");
	});
});
