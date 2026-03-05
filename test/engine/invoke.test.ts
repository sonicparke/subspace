import { describe, expect, it } from "vitest";
import { invokeEngine } from "../../src/engine/invoke.js";
import { createMockContext } from "../helpers/mock-context.js";

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

		expect(ctx.streamCalls[0].args).toContain("-target=module.foo");
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
});
