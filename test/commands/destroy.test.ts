import { describe, it, expect } from "vitest";
import { runDestroy } from "../../src/commands/destroy.js";
import { createMockContext } from "../helpers/mock-context.js";

describe("runDestroy", () => {
	it("errors when stack does not exist", async () => {
		const ctx = createMockContext({ engine: "tofu" });

		const code = await runDestroy(ctx, { stack: "missing" });

		expect(code).toBe(1);
		expect(ctx.logs.error[0]).toContain('stack "missing" not found');
	});

	it("invokes engine with destroy command", async () => {
		const ctx = createMockContext({
			engine: "terraform",
			files: {
				"app/stacks/mystack/main.tf": "resource {}",
			},
			streamHandler: () => 0,
		});

		const code = await runDestroy(ctx, { stack: "mystack", env: "staging" });

		expect(code).toBe(0);
		expect(ctx.streamCalls.some((c) => c.args.includes("destroy"))).toBe(true);
		expect(ctx.streamCalls[0].cmd).toBe("terraform");
	});
});
