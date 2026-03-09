import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { preprocessArgv } from "../argv/preprocess.js";
import { resolveNewArgsInteractive } from "../commands/new-interactive.js";
import { createRealContext, type SubspaceContext } from "../context.js";
import { detectEngine } from "../engine/detect.js";

const execFileAsync = promisify(execFileCb);

export type WorkflowCommandName = "plan" | "apply" | "destroy";

export type ParsedArgv =
	| { command: "doctor" }
	| { command: WorkflowCommandName; stack: string; env?: string }
	| {
			command: "new";
			generator: "project" | "module" | "stack";
			name: string;
			arg3?: string;
			arg4?: string;
			arg5?: string;
	  }
	| undefined;

export interface CliRuntime {
	rawArgv: string[];
	cliArgv: string[];
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

	const cliArgv = await resolveNewArgsInteractive(preCliArgv, {
		isTTY: process.stdin.isTTY && process.stdout.isTTY,
		ask: askQuestion,
		select: selectFromMenu,
	});

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
		parsed: parseResolvedArgv(cliArgv),
		ctx: createRealContext(engine, engineArgs),
	};
}

export function parseResolvedArgv(cliArgv: string[]): ParsedArgv {
	const [command, arg1, arg2, arg3, arg4, arg5] = cliArgv;
	switch (command) {
		case "doctor":
			return { command };
		case "plan":
		case "apply":
		case "destroy":
			if (!arg1) return undefined;
			return { command, stack: arg1, env: arg2 };
		case "new":
			if (
				!arg1 ||
				!arg2 ||
				(arg1 !== "project" && arg1 !== "module" && arg1 !== "stack")
			) {
				return undefined;
			}
			return {
				command,
				generator: arg1,
				name: arg2,
				arg3,
				arg4,
				arg5,
			};
		default:
			throw new Error(`unsupported command "${command ?? ""}"`);
	}
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

const ANSI = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	cyan: "\x1b[36m",
	green: "\x1b[32m",
} as const;

async function askQuestion(question: string): Promise<string> {
	const { createInterface } = await import("node:readline/promises");
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		return await rl.question(question);
	} finally {
		rl.close();
	}
}

async function selectFromMenu(
	title: string,
	options: readonly string[],
	defaultIndex: number,
): Promise<string> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		return options[Math.max(0, Math.min(defaultIndex, options.length - 1))];
	}

	const stdin = process.stdin;
	const stdout = process.stdout;
	let selected = Math.max(0, Math.min(defaultIndex, options.length - 1));
	let renderedLines = 0;

	const render = () => {
		if (renderedLines > 0) stdout.write(`\x1b[${renderedLines}A`);
		stdout.write("\x1b[J");

		const lines = [
			`${ANSI.bold}${ANSI.cyan}${title}${ANSI.reset}`,
			`${ANSI.dim}Use ↑/↓ and Enter${ANSI.reset}`,
			...options.map((option, idx) => {
				if (idx === selected) {
					return `${ANSI.green}> ${ANSI.bold}${option}${ANSI.reset}`;
				}
				return `${ANSI.dim}  ${option}${ANSI.reset}`;
			}),
		];
		stdout.write(lines.join("\n"));
		stdout.write("\n");
		renderedLines = lines.length;
	};

	return new Promise((resolve, reject) => {
		const cleanup = () => {
			stdout.write(`${ANSI.reset}\x1b[?25h`);
			stdin.off("data", onData);
			stdin.setRawMode?.(false);
			stdin.pause();
		};

		const onData = (chunk: Buffer) => {
			const key = chunk.toString("utf-8");
			if (key === "\u0003") {
				cleanup();
				reject(new Error("Interrupted"));
				return;
			}
			if (key === "\r" || key === "\n") {
				const value = options[selected];
				cleanup();
				stdout.write(`${ANSI.green}Selected:${ANSI.reset} ${value}\n`);
				resolve(value);
				return;
			}
			if (key === "\u001b[A" || key.toLowerCase() === "k") {
				selected = (selected - 1 + options.length) % options.length;
				render();
				return;
			}
			if (key === "\u001b[B" || key.toLowerCase() === "j") {
				selected = (selected + 1) % options.length;
				render();
			}
		};

		stdout.write("\x1b[?25l");
		stdin.setRawMode?.(true);
		stdin.resume();
		stdin.on("data", onData);
		render();
	});
}
