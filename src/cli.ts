import { createCli } from "trpc-cli";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";
import { router } from "./router.js";
import { version } from "./version.js";
import { preprocessArgv } from "./argv/preprocess.js";
import { detectEngine } from "./engine/detect.js";
import { createRealContext } from "./context.js";
import { resolveNewArgsInteractive } from "./commands/new-interactive.js";

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

	const cli = createCli({ router, name: "subspace", version, context: ctx });

	// Patch Commander so help text shows "apply" instead of "_apply".
	// The tRPC router uses "_apply" to avoid the reserved word "apply",
	// but Commander's renamed command accepts "apply" from the user.
	// trpc-cli's internal procedurePath stays "_apply" for caller resolution.
	const program = cli.buildProgram() as unknown as import("commander").Command;
	const applyCmd = program.commands.find((c) => c.name() === "_apply");
	if (applyCmd) (applyCmd as unknown as { _name: string })._name = "apply";
	program.description(program.description().replace("_apply", "apply"));

	await program.parseAsync(cliArgv, { from: "user" });
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
