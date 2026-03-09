import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { preprocessArgv } from "../argv/preprocess.js";
import { createRealContext, type SubspaceContext } from "../context.js";
import { detectEngine } from "../engine/detect.js";

const execFileAsync = promisify(execFileCb);

export type WorkflowCommandName = "plan" | "apply" | "destroy";

export type ParsedArgv =
	| { command: "doctor" }
	| { command: WorkflowCommandName; stack?: string; env?: string }
	| {
			command: "new";
			generator?: "project" | "module" | "stack";
			name?: string;
			arg3?: string;
			arg4?: string;
			arg5?: string;
	  }
	| undefined;

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
			return { command };
		case "plan":
		case "apply":
		case "destroy":
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
		default:
			throw new Error(`unsupported command "${command ?? ""}"`);
	}
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
	if (command !== "plan" && command !== "apply" && command !== "destroy") {
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
