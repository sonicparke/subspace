import { describe, it, expect } from "vitest";
import { runShow } from "../../src/commands/show.js";
import { createMockContext } from "../helpers/mock-context.js";

describe("runShow", () => {
	it("errors when stack does not exist", async () => {
		const ctx = createMockContext({ engine: "tofu" });

		const code = await runShow(ctx, { stack: "missing" });

		expect(code).toBe(1);
		expect(ctx.logs.error[0]).toContain('stack "missing" not found');
	});

	it("invokes the engine with the show command", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			files: {
				"app/stacks/mystack/main.tf": "resource {}",
			},
			streamHandler: () => 0,
		});

		const code = await runShow(ctx, { stack: "mystack", env: "prod" });

		expect(code).toBe(0);
		expect(ctx.streamCalls.some((c) => c.args.includes("show"))).toBe(true);
	});
});
