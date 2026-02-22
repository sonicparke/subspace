import { describe, it, expect } from "vitest";
import { resolveNewArgsInteractive } from "../../src/commands/new-interactive.js";

const selectDefault = async (
	_: string,
	options: readonly string[],
	defaultIndex: number,
) => options[defaultIndex];

describe("resolveNewArgsInteractive", () => {
	it("returns unchanged argv for non-new commands", async () => {
		const result = await resolveNewArgsInteractive(["plan", "network"], {
			isTTY: true,
			ask: async () => "",
			select: selectDefault,
		});
		expect(result).toEqual(["plan", "network"]);
	});

	it("returns unchanged argv when generator and name are provided", async () => {
		const result = await resolveNewArgsInteractive(["new", "stack", "network"], {
			isTTY: true,
			ask: async () => "",
			select: selectDefault,
		});
		expect(result).toEqual(["new", "stack", "network"]);
	});

	it("returns unchanged argv when project backend is already provided", async () => {
		const result = await resolveNewArgsInteractive(
			["new", "project", "demo", "s3", "us-west-2"],
			{
				isTTY: true,
				ask: async () => "",
				select: selectDefault,
			},
		);
		expect(result).toEqual(["new", "project", "demo", "s3", "us-west-2"]);
	});

	it("prompts for both args when missing", async () => {
		const answers = ["vpc"];
		const result = await resolveNewArgsInteractive(["new"], {
			isTTY: true,
			ask: async () => answers.shift() ?? "",
			select: async () => "module",
		});
		expect(result).toEqual(["new", "module", "vpc"]);
	});

	it("defaults generator to project on empty input and prompts backend", async () => {
		const answers = ["demo"];
		const result = await resolveNewArgsInteractive(["new"], {
			isTTY: true,
			ask: async () => answers.shift() ?? "",
			select: async (_title, options, defaultIndex) => options[defaultIndex],
		});
		expect(result).toEqual(["new", "project", "demo", "local"]);
	});

	it("re-prompts until valid values are entered", async () => {
		const answers = ["../oops", "network"];
		const result = await resolveNewArgsInteractive(["new"], {
			isTTY: true,
			ask: async () => answers.shift() ?? "",
			select: async () => "stack",
		});
		expect(result).toEqual(["new", "stack", "network"]);
	});

	it("prompts project backend as multiple choice", async () => {
		const answers = ["demo", "us-west-1"];
		const result = await resolveNewArgsInteractive(["new"], {
			isTTY: true,
			ask: async () => answers.shift() ?? "",
			select: async (title) => (title.includes("backend") ? "s3" : "project"),
		});
		expect(result).toEqual(["new", "project", "demo", "s3", "us-west-1"]);
	});

	it("errors in non-interactive mode when args are missing", async () => {
		await expect(
			resolveNewArgsInteractive(["new"], {
				isTTY: false,
				ask: async () => "",
				select: selectDefault,
			}),
		).rejects.toThrow('missing required arguments for "new"');
	});

	it("defaults backend to local in non-interactive mode", async () => {
		const result = await resolveNewArgsInteractive(["new", "project", "demo"], {
			isTTY: false,
			ask: async () => "",
			select: selectDefault,
		});
		expect(result).toEqual(["new", "project", "demo", "local"]);
	});

	it("defaults region for project s3 backend in non-interactive mode", async () => {
		const result = await resolveNewArgsInteractive(
			["new", "project", "demo", "s3"],
			{
				isTTY: false,
				ask: async () => "",
				select: selectDefault,
			},
		);
		expect(result).toEqual(["new", "project", "demo", "s3", "us-east-1"]);
	});
});
