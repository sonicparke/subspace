import { describe, it, expect } from "vitest";
import { writeVarLayers } from "../../src/build/var-layering.js";
import { createMockContext } from "../helpers/mock-context.js";

describe("writeVarLayers", () => {
	it("writes base.tfvars as 00-base.auto.tfvars", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/mystack/tfvars/base.tfvars": "region = \"us-east-1\"",
			},
		});

		await writeVarLayers(ctx, "app/stacks/mystack", "build", "prod");

		expect(ctx.files["build/00-base.auto.tfvars"]).toBe("region = \"us-east-1\"");
	});

	it("writes env-specific vars", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/mystack/tfvars/prod.tfvars": "instance_type = \"m5.large\"",
			},
		});

		await writeVarLayers(ctx, "app/stacks/mystack", "build", "prod");

		expect(ctx.files["build/10-env.auto.tfvars"]).toBe(
			"instance_type = \"m5.large\"",
		);
	});

	it("writes env secrets", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/mystack/tfvars/prod.secrets.tfvars": "api_key = \"secret\"",
			},
		});

		await writeVarLayers(ctx, "app/stacks/mystack", "build", "prod");

		expect(ctx.files["build/20-env-secrets.auto.tfvars"]).toBe(
			"api_key = \"secret\"",
		);
	});

	it("writes local.tfvars", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/mystack/tfvars/local.tfvars": "debug = true",
			},
		});

		await writeVarLayers(ctx, "app/stacks/mystack", "build", "prod");

		expect(ctx.files["build/90-local.auto.tfvars"]).toBe("debug = true");
	});

	it("writes env-local.tfvars", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/mystack/tfvars/prod.local.tfvars": "override = true",
			},
		});

		await writeVarLayers(ctx, "app/stacks/mystack", "build", "prod");

		expect(ctx.files["build/95-env-local.auto.tfvars"]).toBe("override = true");
	});

	it("skips env-specific layers when no env provided", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/mystack/tfvars/base.tfvars": "base = true",
				"app/stacks/mystack/tfvars/prod.tfvars": "env = true",
				"app/stacks/mystack/tfvars/local.tfvars": "local = true",
				"app/stacks/mystack/tfvars/prod.local.tfvars": "env-local = true",
			},
		});

		await writeVarLayers(ctx, "app/stacks/mystack", "build", undefined);

		expect(ctx.files["build/00-base.auto.tfvars"]).toBe("base = true");
		expect(ctx.files["build/10-env.auto.tfvars"]).toBeUndefined();
		expect(ctx.files["build/90-local.auto.tfvars"]).toBe("local = true");
		expect(ctx.files["build/95-env-local.auto.tfvars"]).toBeUndefined();
	});

	it("skips missing source files", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/mystack/tfvars/base.tfvars": "base = true",
			},
		});

		await writeVarLayers(ctx, "app/stacks/mystack", "build", "prod");

		expect(ctx.files["build/00-base.auto.tfvars"]).toBe("base = true");
		expect(ctx.files["build/10-env.auto.tfvars"]).toBeUndefined();
	});

	it("writes all layers when all files present", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/mystack/tfvars/base.tfvars": "a",
				"app/stacks/mystack/tfvars/staging.tfvars": "b",
				"app/stacks/mystack/tfvars/staging.secrets.tfvars": "c",
				"app/stacks/mystack/tfvars/local.tfvars": "d",
				"app/stacks/mystack/tfvars/staging.local.tfvars": "e",
			},
		});

		await writeVarLayers(ctx, "app/stacks/mystack", "build", "staging");

		expect(ctx.files["build/00-base.auto.tfvars"]).toBe("a");
		expect(ctx.files["build/10-env.auto.tfvars"]).toBe("b");
		expect(ctx.files["build/20-env-secrets.auto.tfvars"]).toBe("c");
		expect(ctx.files["build/90-local.auto.tfvars"]).toBe("d");
		expect(ctx.files["build/95-env-local.auto.tfvars"]).toBe("e");
	});

	it("layers multiple tfvars roots for Terraspace migrations", async () => {
		const ctx = createMockContext({
			files: {
				"config/terraform/tfvars/base.tfvars": "project_base = true",
				"config/terraform/tfvars/prod.tfvars": "project_env = true",
				"config/stacks/mystack/tfvars/base.tfvars": "stack_cfg_base = true",
				"config/stacks/mystack/tfvars/prod.tfvars": "stack_cfg_env = true",
				"app/stacks/mystack/tfvars/base.tfvars": "stack_base = true",
				"app/stacks/mystack/tfvars/prod.tfvars": "stack_env = true",
			},
		});

		await writeVarLayers(ctx, "app/stacks/mystack", "build", "prod", [
			{ dir: "config/terraform/tfvars", label: "project" },
			{ dir: "config/stacks/mystack/tfvars", label: "stack-config" },
			{ dir: "app/stacks/mystack/tfvars", label: "stack" },
		]);

		expect(ctx.files["build/00-project-base.auto.tfvars"]).toBe(
			"project_base = true",
		);
		expect(ctx.files["build/01-project-env.auto.tfvars"]).toBe(
			"project_env = true",
		);
		expect(ctx.files["build/05-stack-config-base.auto.tfvars"]).toBe(
			"stack_cfg_base = true",
		);
		expect(ctx.files["build/06-stack-config-env.auto.tfvars"]).toBe(
			"stack_cfg_env = true",
		);
		expect(ctx.files["build/10-stack-base.auto.tfvars"]).toBe(
			"stack_base = true",
		);
		expect(ctx.files["build/11-stack-env.auto.tfvars"]).toBe(
			"stack_env = true",
		);
	});
});
