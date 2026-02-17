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
		// Build dir should have main.tf and auto.tfvars
		expect(ctx.files[".subspace/build/mystack/prod/main.tf"]).toBe("resource {}");
		expect(ctx.files[".subspace/build/mystack/prod/00-base.auto.tfvars"]).toBe("x = 1");
		// Engine should be invoked with plan command
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

		expect(ctx.files[".subspace/build/mystack/__noenv__/main.tf"]).toBe("resource {}");
	});
});
