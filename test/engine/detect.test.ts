import { describe, it, expect } from "vitest";
import { detectEngine } from "../../src/engine/detect.js";
import type { ExecResult } from "../../src/context.js";

function makeExec(available: string[]) {
	return async (cmd: string, args: string[]): Promise<ExecResult> => {
		if (cmd === "which") {
			const binary = args[0];
			return available.includes(binary)
				? { stdout: `/usr/bin/${binary}\n`, stderr: "", exitCode: 0 }
				: { stdout: "", stderr: "", exitCode: 1 };
		}
		return { stdout: "", stderr: "", exitCode: 0 };
	};
}

describe("detectEngine", () => {
	it("uses --engine flag when provided", async () => {
		const exec = makeExec(["tofu", "terraform"]);
		const result = await detectEngine(exec, {}, "terraform");
		expect(result).toBe("terraform");
	});

	it("errors if --engine flag specifies unavailable binary", async () => {
		const exec = makeExec([]);
		await expect(detectEngine(exec, {}, "tofu")).rejects.toThrow(
			'Engine "tofu" not found on $PATH.',
		);
	});

	it("uses SUBSPACE_ENGINE env var", async () => {
		const exec = makeExec(["terraform"]);
		const result = await detectEngine(exec, { SUBSPACE_ENGINE: "terraform" }, undefined);
		expect(result).toBe("terraform");
	});

	it("errors if SUBSPACE_ENGINE specifies unavailable binary", async () => {
		const exec = makeExec([]);
		await expect(
			detectEngine(exec, { SUBSPACE_ENGINE: "tofu" }, undefined),
		).rejects.toThrow('Engine "tofu" not found on $PATH.');
	});

	it("auto-detects tofu when both available", async () => {
		const exec = makeExec(["tofu", "terraform"]);
		const result = await detectEngine(exec, {}, undefined);
		expect(result).toBe("tofu");
	});

	it("falls back to terraform when tofu not available", async () => {
		const exec = makeExec(["terraform"]);
		const result = await detectEngine(exec, {}, undefined);
		expect(result).toBe("terraform");
	});

	it("errors when no engine found", async () => {
		const exec = makeExec([]);
		await expect(detectEngine(exec, {}, undefined)).rejects.toThrow(
			"No engine found",
		);
	});

	it("--engine flag takes priority over env var", async () => {
		const exec = makeExec(["tofu", "terraform"]);
		const result = await detectEngine(
			exec,
			{ SUBSPACE_ENGINE: "terraform" },
			"tofu",
		);
		expect(result).toBe("tofu");
	});
});
