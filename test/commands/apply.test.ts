import { describe, it, expect } from "vitest";
import { runApply } from "../../src/commands/apply.js";
import { createMockContext } from "../helpers/mock-context.js";

describe("runApply", () => {
	it("errors when stack does not exist", async () => {
		const ctx = createMockContext({ engine: "tofu" });

		const code = await runApply(ctx, { stack: "missing" });

		expect(code).toBe(1);
		expect(ctx.logs.error[0]).toContain('stack "missing" not found');
	});

	it("invokes engine with apply command", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			files: {
				"app/stacks/mystack/main.tf": "resource {}",
			},
			streamHandler: () => 0,
		});

		const code = await runApply(ctx, { stack: "mystack", env: "prod" });

		expect(code).toBe(0);
		expect(ctx.streamCalls.some((c) => c.args.includes("apply"))).toBe(true);
	});
});
