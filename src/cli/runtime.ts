import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { preprocessArgv } from "../argv/preprocess.js";
import { createRealContext, type SubspaceContext } from "../context.js";
import { detectEngine } from "../engine/detect.js";

const execFileAsync = promisify(execFileCb);

export type WorkflowCommandName = "plan" | "apply" | "destroy" | "show";

export type ParsedArgv =
	| { command: "doctor"; legacy: boolean }
	| { command: WorkflowCommandName; stack?: string; env?: string }
	| {
			command: "new";
			generator?: "project" | "module" | "stack";
			name?: string;
			arg3?: string;
			arg4?: string;
			arg5?: string;
	  }
	| ParsedMigrateArgv
	| undefined;

export type ParsedMigrateArgv =
	| {
			command: "migrate";
			subcommand: "init";
			legacyPath?: string;
			out?: string;
			regions?: string[];
			appName?: string;
			role?: string;
			force: boolean;
			dryRun: boolean;
	  }
	| {
			command: "migrate";
			subcommand: "stack";
			stack?: string;
			env?: string;
			/** Legacy key :ROLE (Terraspace TS_ROLE). */
			role?: string;
			/** Legacy key :APP (Terraspace TS_APP). */
			app?: string;
			dryRun: boolean;
			reportFile?: string;
			regions?: string[];
	  };

export interface CliRuntime {
	rawArgv: string[];
	cliArgv: string[];
	oscliArgv: string[];
	parsed: ParsedArgv;
	ctx: SubspaceContext;
}

const ENGINE_OPTIONAL_COMMANDS = new Set([
	undefined,
	"doctor",
	"new",
	"migrate",
	"help",
	"--help",
	"-h",
	"--version",
	"-V",
]);

export async function resolveCliRuntime(rawArgv: string[]): Promise<CliRuntime> {
	const { cliArgv: preCliArgv, engineFlag, engineArgs } = preprocessArgv(rawArgv);
	const cliArgv = preCliArgv;

	const command = cliArgv[0];
	let engine: string;
	try {
		engine = await detectEngine(
			async (cmd, args) => {
				try {
					const { stdout, stderr } = await execFileAsync(cmd, args);
					return { stdout, stderr, exitCode: 0 };
				} catch (err: unknown) {
					const e = err as { stdout?: string; stderr?: string; code?: number };
					return {
						stdout: e.stdout ?? "",
						stderr: e.stderr ?? "",
						exitCode: e.code ?? 1,
					};
				}
			},
			process.env as Record<string, string | undefined>,
			engineFlag,
		);
	} catch (err) {
		if (ENGINE_OPTIONAL_COMMANDS.has(command) && !engineFlag) {
			engine = "none";
		} else {
			throw err;
		}
	}

	return {
		rawArgv,
		cliArgv,
		oscliArgv: normalizeOscliArgv(cliArgv),
		parsed: parseResolvedArgv(cliArgv),
		ctx: createRealContext(engine, engineArgs),
	};
}

export function parseResolvedArgv(cliArgv: string[]): ParsedArgv {
	const [command, ...rest] = cliArgv;
	switch (command) {
		case "doctor":
			return { command, legacy: rest.includes("--legacy") };
		case "plan":
		case "apply":
		case "destroy":
		case "show":
			return parseWorkflowArgv(command, rest);
		case "new": {
			const [arg1, arg2, arg3, arg4, arg5] = rest;
			return {
				command,
				generator:
					arg1 === "project" || arg1 === "module" || arg1 === "stack"
						? arg1
						: undefined,
				name: arg2,
				arg3,
				arg4,
				arg5,
			};
		}
		case "migrate":
			return parseMigrateArgv(rest);
		default:
			throw new Error(`unsupported command "${command ?? ""}"`);
	}
}

function parseMigrateArgv(args: string[]): ParsedMigrateArgv {
	if (args[0] === "init") {
		return parseMigrateInitArgv(args.slice(1));
	}
	return parseMigrateStackArgv(args);
}

function parseMigrateInitArgv(
	args: string[],
): Extract<ParsedMigrateArgv, { subcommand: "init" }> {
	const positionals: string[] = [];
	let out: string | undefined;
	let regions: string[] | undefined;
	let appName: string | undefined;
	let role: string | undefined;
	let force = false;
	let dryRun = false;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--dry-run") {
			dryRun = true;
			continue;
		}
		if (arg === "--out") {
			out = args[i + 1];
			i += 1;
			continue;
		}
		if (arg.startsWith("--out=")) {
			out = arg.slice("--out=".length);
			continue;
		}
		if (arg === "--regions") {
			regions = splitRegions(args[i + 1]);
			i += 1;
			continue;
		}
		if (arg.startsWith("--regions=")) {
			regions = splitRegions(arg.slice("--regions=".length));
			continue;
		}
		if (arg === "--app-name") {
			appName = args[i + 1];
			i += 1;
			continue;
		}
		if (arg.startsWith("--app-name=")) {
			appName = arg.slice("--app-name=".length);
			continue;
		}
		if (arg === "--role") {
			role = args[i + 1];
			i += 1;
			continue;
		}
		if (arg.startsWith("--role=")) {
			role = arg.slice("--role=".length);
			continue;
		}
		if (arg === "--force") {
			force = true;
			continue;
		}
		if (arg.startsWith("-")) continue;
		positionals.push(arg);
	}

	return {
		command: "migrate",
		subcommand: "init",
		legacyPath: positionals[0],
		out,
		regions,
		appName,
		role,
		force,
		dryRun,
	};
}

function parseMigrateStackArgv(
	args: string[],
): Extract<ParsedMigrateArgv, { subcommand: "stack" }> {
	const positionals: string[] = [];
	let dryRun = false;
	let reportFile: string | undefined;
	let regions: string[] | undefined;
	let role: string | undefined;
	let app: string | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--dry-run") {
			dryRun = true;
			continue;
		}
		if (arg === "--report-file") {
			reportFile = args[i + 1];
			i += 1;
			continue;
		}
		if (arg.startsWith("--report-file=")) {
			reportFile = arg.slice("--report-file=".length);
			continue;
		}
		if (arg === "--regions") {
			regions = splitRegions(args[i + 1]);
			i += 1;
			continue;
		}
		if (arg.startsWith("--regions=")) {
			regions = splitRegions(arg.slice("--regions=".length));
			continue;
		}
		if (arg === "--role") {
			role = args[i + 1];
			i += 1;
			continue;
		}
		if (arg.startsWith("--role=")) {
			role = arg.slice("--role=".length);
			continue;
		}
		if (arg === "--app") {
			app = args[i + 1];
			i += 1;
			continue;
		}
		if (arg.startsWith("--app=")) {
			app = arg.slice("--app=".length);
			continue;
		}
		if (arg.startsWith("-")) continue;
		positionals.push(arg);
	}

	return {
		command: "migrate",
		subcommand: "stack",
		stack: positionals[0],
		env: positionals[1],
		role,
		app,
		dryRun,
		reportFile,
		regions,
	};
}

function splitRegions(raw: string | undefined): string[] | undefined {
	if (!raw) return undefined;
	return raw
		.split(",")
		.map((r) => r.trim())
		.filter(Boolean);
}

function parseWorkflowArgv(
	command: WorkflowCommandName,
	args: string[],
): Extract<ParsedArgv, { command: WorkflowCommandName }> {
	const positionals: string[] = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--") break;
		if (arg === "--stack" || arg === "--env") {
			i += 1;
			continue;
		}
		if (arg.startsWith("--stack=") || arg.startsWith("--env=")) {
			continue;
		}
		if (arg.startsWith("-")) continue;
		positionals.push(arg);
	}

	return {
		command,
		stack: positionals[0],
		env: positionals[1],
	};
}

function normalizeOscliArgv(cliArgv: string[]): string[] {
	const [command, ...rest] = cliArgv;
	if (
		command !== "plan" &&
		command !== "apply" &&
		command !== "destroy" &&
		command !== "show"
	) {
		return cliArgv;
	}

	const workflowFlags: string[] = [];
	const positionals: string[] = [];
	let passthroughIndex = -1;

	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i];
		if (arg === "--") {
			passthroughIndex = i;
			break;
		}
		if (arg === "--stack" || arg === "--env") {
			workflowFlags.push(arg);
			if (i + 1 < rest.length) {
				workflowFlags.push(rest[i + 1]);
				i += 1;
			}
			continue;
		}
		if (arg.startsWith("--stack=") || arg.startsWith("--env=")) {
			workflowFlags.push(arg);
			continue;
		}
		positionals.push(arg);
	}

	const passthrough =
		passthroughIndex === -1 ? [] : rest.slice(passthroughIndex);
	return [...workflowFlags, command, ...positionals, ...passthrough];
}

export function assertWorkflowCommand(
	parsed: ParsedArgv,
	command: WorkflowCommandName,
): asserts parsed is Exclude<Extract<ParsedArgv, { command: WorkflowCommandName }>, undefined> {
	if (!parsed || parsed.command !== command) {
		throw new Error(`expected ${command} command`);
	}
}

export function assertNewCommand(
	parsed: ParsedArgv,
): asserts parsed is Exclude<Extract<ParsedArgv, { command: "new" }>, undefined> {
	if (!parsed || parsed.command !== "new") {
		throw new Error('expected "new" command');
	}
}

export function assertMigrateCommand(
	parsed: ParsedArgv,
): asserts parsed is Exclude<
	Extract<ParsedArgv, { command: "migrate" }>,
	undefined
> {
	if (!parsed || parsed.command !== "migrate") {
		throw new Error('expected "migrate" command');
	}
}
