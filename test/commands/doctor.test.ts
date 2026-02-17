import { describe, it, expect } from "vitest";
import { runDoctor } from "../../src/commands/doctor.js";
import { createMockContext } from "../helpers/mock-context.js";

describe("runDoctor", () => {
	it("reports when tofu is available", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			execHandler: (cmd, args) => {
				if (cmd === "which" && args[0] === "tofu")
					return { stdout: "/usr/bin/tofu\n", stderr: "", exitCode: 0 };
				if (cmd === "tofu" && args[0] === "--version")
					return { stdout: "OpenTofu v1.6.0\n", stderr: "", exitCode: 0 };
				if (cmd === "which" && args[0] === "terraform")
					return { stdout: "", stderr: "", exitCode: 1 };
				return { stdout: "", stderr: "", exitCode: 0 };
			},
		});

		const code = await runDoctor(ctx);

		expect(code).toBe(0);
		expect(ctx.logs.info.some((l) => l.includes("tofu") && l.includes("ok"))).toBe(true);
	});

	it("warns when tofu is not found", async () => {
		const ctx = createMockContext({
			engine: "terraform",
			execHandler: (cmd, args) => {
				if (cmd === "which" && args[0] === "tofu")
					return { stdout: "", stderr: "", exitCode: 1 };
				if (cmd === "which" && args[0] === "terraform")
					return { stdout: "/usr/bin/terraform\n", stderr: "", exitCode: 0 };
				if (cmd === "terraform" && args[0] === "--version")
					return { stdout: "Terraform v1.7.0\n", stderr: "", exitCode: 0 };
				return { stdout: "", stderr: "", exitCode: 0 };
			},
		});

		const code = await runDoctor(ctx);

		expect(code).toBe(0);
		expect(ctx.logs.info.some((l) => l.includes("tofu") && l.includes("warn"))).toBe(true);
		expect(ctx.logs.info.some((l) => l.includes("terraform") && l.includes("ok"))).toBe(true);
	});

	it("reports active engine", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			execHandler: () => ({ stdout: "", stderr: "", exitCode: 1 }),
		});

		await runDoctor(ctx);

		expect(ctx.logs.info.some((l) => l.includes("Active engine: tofu"))).toBe(true);
	});

	it("warns when app/stacks/ is missing", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			execHandler: () => ({ stdout: "", stderr: "", exitCode: 1 }),
		});

		await runDoctor(ctx);

		expect(ctx.logs.info.some((l) => l.includes("app/stacks/") && l.includes("not found"))).toBe(true);
	});

	it("lists stacks and checks for base.tfvars", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			files: {
				"app/stacks/network/main.tf": "",
				"app/stacks/network/tfvars/base.tfvars": "x=1",
				"app/stacks/compute/main.tf": "",
			},
			execHandler: () => ({ stdout: "", stderr: "", exitCode: 1 }),
		});

		await runDoctor(ctx);

		expect(ctx.logs.info.some((l) => l.includes("network") && l.includes("ok"))).toBe(true);
		expect(ctx.logs.info.some((l) => l.includes("compute") && l.includes("warn"))).toBe(true);
	});
});
