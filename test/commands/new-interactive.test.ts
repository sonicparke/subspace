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

	it("returns unchanged argv when complete project args are provided", async () => {
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

	it("defaults project backend to local when omitted", async () => {
		const result = await resolveNewArgsInteractive(["new", "project", "demo"], {
			isTTY: false,
			ask: async () => "",
			select: selectDefault,
		});
		expect(result).toEqual(["new", "project", "demo", "local"]);
	});

	it("defaults project region for s3 in non-interactive mode", async () => {
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

	it("prompts stack provider and region in interactive mode", async () => {
		const answers = ["edge", "us-west-2"];
		const result = await resolveNewArgsInteractive(["new", "stack"], {
			isTTY: true,
			ask: async () => answers.shift() ?? "",
			select: async (title) => (title.includes("generator") ? "stack" : "aws"),
		});
		expect(result).toEqual(["new", "stack", "edge", "aws", "us-west-2"]);
	});

	it("defaults stack provider in non-interactive mode", async () => {
		const result = await resolveNewArgsInteractive(["new", "stack", "edge"], {
			isTTY: false,
			ask: async () => "",
			select: selectDefault,
		});
		expect(result).toEqual(["new", "stack", "edge", "aws"]);
	});

	it("prompts for both generator and name when missing", async () => {
		const answers = ["edge", "us-west-2"];
		const result = await resolveNewArgsInteractive(["new"], {
			isTTY: true,
			ask: async () => answers.shift() ?? "",
			select: async (title) => (title.includes("generator") ? "stack" : "aws"),
		});
		expect(result).toEqual(["new", "stack", "edge", "aws", "us-west-2"]);
	});

	it("errors in non-interactive mode when generator/name missing", async () => {
		await expect(
			resolveNewArgsInteractive(["new"], {
				isTTY: false,
				ask: async () => "",
				select: selectDefault,
			}),
		).rejects.toThrow('missing required arguments for "new"');
	});
});
