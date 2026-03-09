import { createCLI } from "@oscli-dev/oscli";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";
import { runApply } from "./commands/apply.js";
import { runDestroy } from "./commands/destroy.js";
import { runDoctor } from "./commands/doctor.js";
import { runNew } from "./commands/new.js";
import { version } from "./version.js";
import { preprocessArgv } from "./argv/preprocess.js";
import { detectEngine } from "./engine/detect.js";
import { createRealContext } from "./context.js";
import { resolveNewArgsInteractive } from "./commands/new-interactive.js";
import { runPlan } from "./commands/plan.js";

const execFileAsync = promisify(execFileCb);
const ANSI = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	cyan: "\x1b[36m",
	green: "\x1b[32m",
} as const;

async function main() {
	const raw = process.argv.slice(2);
	if (shouldPrintVersion(raw)) {
		console.log(version);
		return;
	}
	if (shouldPrintHelp(raw)) {
		printHelp();
		return;
	}

	const { cliArgv: preCliArgv, engineFlag, engineArgs } = preprocessArgv(raw);

	let cliArgv: string[];
	try {
		cliArgv = await resolveNewArgsInteractive(preCliArgv, {
			isTTY: process.stdin.isTTY && process.stdout.isTTY,
			ask: askQuestion,
			select: selectFromMenu,
		});
	} catch (err) {
		if ((err as Error).message === "Interrupted") {
			process.exit(130);
		}
		throw err;
	}

	const command = cliArgv[0];
	const isEngineOptionalCommand = new Set([
		undefined,
		"doctor",
		"new",
		"help",
		"--help",
		"-h",
		"--version",
		"-V",
	]).has(command);

	let engine: string;
	try {
		engine = await detectEngine(
			async (cmd, args) => {
				try {
					const { stdout, stderr } = await execFileAsync(cmd, args);
					return { stdout, stderr, exitCode: 0 };
				} catch (err: unknown) {
					const e = err as { stdout?: string; stderr?: string; code?: number };
					return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: e.code ?? 1 };
				}
			},
			process.env as Record<string, string | undefined>,
			engineFlag,
		);
	} catch (err) {
		if (isEngineOptionalCommand && !engineFlag) {
			engine = "none";
		} else {
			console.error((err as Error).message);
			process.exit(1);
		}
	}

	const ctx = createRealContext(engine, engineArgs);
	const parsed = parseResolvedArgv(cliArgv);

	process.argv = [process.argv[0] ?? "node", "subspace", ...cliArgv];

	const cli = createCLI(() => ({
		description: "Terraspace-style CLI for OpenTofu and Terraform.",
		autocompleteHint: "Run `subspace --help` to see available commands.",
	}));

	cli.command("doctor", async () => {
		const code = await runDoctor(ctx);
		if (code !== 0) process.exit(code);
	});

	cli.command("plan <stack> [env]", async () => {
		assertWorkflowCommand(parsed, "plan");
		const code = await runPlan(ctx, { stack: parsed.stack, env: parsed.env });
		if (code !== 0) process.exit(code);
	});

	cli.command("apply <stack> [env]", async () => {
		assertWorkflowCommand(parsed, "apply");
		const code = await runApply(ctx, { stack: parsed.stack, env: parsed.env });
		if (code !== 0) process.exit(code);
	});

	cli.command("destroy <stack> [env]", async () => {
		assertWorkflowCommand(parsed, "destroy");
		const code = await runDestroy(ctx, {
			stack: parsed.stack,
			env: parsed.env,
		});
		if (code !== 0) process.exit(code);
	});

	cli.command("new [generator] [name] [arg3] [arg4] [arg5]", async () => {
		assertNewCommand(parsed);
		const normalized =
			parsed.generator === "project"
				? {
						generator: parsed.generator,
						name: parsed.name,
						backend: parsed.arg3,
						region: parsed.arg4,
						provider: parsed.arg5,
					}
				: parsed.generator === "stack"
					? {
							generator: parsed.generator,
							name: parsed.name,
							provider: parsed.arg3,
							region: parsed.arg4,
						}
					: {
							generator: parsed.generator,
							name: parsed.name,
						};
		const code = await runNew(ctx, normalized);
		if (code !== 0) process.exit(code);
	});

	await cli.run();
}

type WorkflowCommandName = "plan" | "apply" | "destroy";

type ParsedArgv =
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

function parseResolvedArgv(cliArgv: string[]): ParsedArgv {
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

function assertWorkflowCommand(
	parsed: ParsedArgv,
	command: WorkflowCommandName,
): asserts parsed is Exclude<Extract<ParsedArgv, { command: WorkflowCommandName }>, undefined> {
	if (!parsed || parsed.command !== command) {
		throw new Error(`expected ${command} command`);
	}
}

function assertNewCommand(
	parsed: ParsedArgv,
): asserts parsed is Exclude<Extract<ParsedArgv, { command: "new" }>, undefined> {
	if (!parsed || parsed.command !== "new") {
		throw new Error('expected "new" command');
	}
}

function shouldPrintHelp(raw: string[]): boolean {
	return raw.length === 0 || raw[0] === "help" || raw.includes("--help") || raw.includes("-h");
}

function shouldPrintVersion(raw: string[]): boolean {
	return raw.length === 1 && (raw[0] === "--version" || raw[0] === "-V");
}

function printHelp(): void {
	console.log(`Subspace

Terraspace-style CLI for OpenTofu and Terraform.

Usage:
  subspace plan <stack> [env] [--engine tofu|terraform] -- <engineArgs...>
  subspace apply <stack> [env] [--engine tofu|terraform] -- <engineArgs...>
  subspace destroy <stack> [env] [--engine tofu|terraform] -- <engineArgs...>
  subspace new project <name> [backend] [region] [provider]
  subspace new module <name>
  subspace new stack <name> [provider] [region]
  subspace new
  subspace doctor
  subspace --version
  subspace --help`);
}

async function askQuestion(question: string): Promise<string> {
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

main();
