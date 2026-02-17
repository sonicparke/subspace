import { describe, it, expect } from "vitest";
import { preprocessArgv } from "../../src/argv/preprocess.js";

describe("preprocessArgv", () => {
	it("parses command with stack and env", () => {
		const result = preprocessArgv(["plan", "mystack", "prod"]);
		expect(result.cliArgv).toEqual(["plan", "mystack", "prod"]);
		expect(result.engineFlag).toBeUndefined();
		expect(result.engineArgs).toEqual([]);
	});

	it("extracts --engine flag (space-separated)", () => {
		const result = preprocessArgv(["plan", "mystack", "--engine", "terraform"]);
		expect(result.cliArgv).toEqual(["plan", "mystack"]);
		expect(result.engineFlag).toBe("terraform");
		expect(result.engineArgs).toEqual([]);
	});

	it("extracts --engine flag (equals-separated)", () => {
		const result = preprocessArgv(["plan", "mystack", "--engine=tofu"]);
		expect(result.cliArgv).toEqual(["plan", "mystack"]);
		expect(result.engineFlag).toBe("tofu");
	});

	it("captures args after --", () => {
		const result = preprocessArgv([
			"plan", "mystack", "prod", "--", "-target=foo", "-var=x=1",
		]);
		expect(result.cliArgv).toEqual(["plan", "mystack", "prod"]);
		expect(result.engineArgs).toEqual(["-target=foo", "-var=x=1"]);
	});

	it("handles --engine before -- and args after --", () => {
		const result = preprocessArgv([
			"plan", "mystack", "--engine", "tofu", "--", "-target=foo",
		]);
		expect(result.cliArgv).toEqual(["plan", "mystack"]);
		expect(result.engineFlag).toBe("tofu");
		expect(result.engineArgs).toEqual(["-target=foo"]);
	});

	it("handles no args", () => {
		const result = preprocessArgv([]);
		expect(result.cliArgv).toEqual([]);
		expect(result.engineFlag).toBeUndefined();
		expect(result.engineArgs).toEqual([]);
	});

	it("handles just --", () => {
		const result = preprocessArgv(["plan", "mystack", "--"]);
		expect(result.cliArgv).toEqual(["plan", "mystack"]);
		expect(result.engineArgs).toEqual([]);
	});

	it("does not treat --engine after -- as a flag", () => {
		const result = preprocessArgv([
			"plan", "mystack", "--", "--engine", "terraform",
		]);
		expect(result.cliArgv).toEqual(["plan", "mystack"]);
		expect(result.engineFlag).toBeUndefined();
		expect(result.engineArgs).toEqual(["--engine", "terraform"]);
	});
});
