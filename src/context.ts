import type { Stats } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { spawn } from "node:child_process";

const execAsync = promisify(execCb);

export interface ExecResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export interface SubspaceFs {
	readFile(path: string): Promise<string>;
	writeFile(path: string, content: string): Promise<void>;
	readdir(path: string): Promise<string[]>;
	stat(path: string): Promise<Stats>;
	exists(path: string): Promise<boolean>;
	mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
	rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
	cp(src: string, dest: string, options?: { recursive?: boolean }): Promise<void>;
}

export interface StreamResult {
	exitCode: number;
	stderr: string;
}

export interface SubspaceContext {
	exec(cmd: string, args: string[]): Promise<ExecResult>;
	execStream(cmd: string, args: string[]): Promise<StreamResult>;
	fs: SubspaceFs;
	log: {
		info(msg: string): void;
		warn(msg: string): void;
		error(msg: string): void;
	};
	env: Record<string, string | undefined>;
	cwd: string;
	engine: string;
	engineArgs: string[];
}

export function createRealContext(
	engine: string,
	engineArgs: string[],
): SubspaceContext {
	const cwd = process.cwd();
	return {
		exec: async (cmd, args) => {
			try {
				const { stdout, stderr } = await execAsync(
					[cmd, ...args].map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" "),
					{ cwd },
				);
				return { stdout, stderr, exitCode: 0 };
			} catch (err: unknown) {
				const e = err as { stdout: string; stderr: string; code: number };
				return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: e.code ?? 1 };
			}
		},
		execStream: (cmd, args) =>
			new Promise((resolve) => {
				const child = spawn(cmd, args, {
					cwd,
					stdio: ["inherit", "inherit", "pipe"],
				});
				let stderr = "";
				child.stderr?.on("data", (chunk: Buffer) => {
					const text = chunk.toString();
					stderr += text;
					process.stderr.write(text);
				});
				child.on("close", (code) => resolve({ exitCode: code ?? 1, stderr }));
				// Forward signals
				const onSignal = (sig: NodeJS.Signals) => child.kill(sig);
				process.on("SIGINT", onSignal);
				process.on("SIGTERM", onSignal);
				child.on("close", () => {
					process.removeListener("SIGINT", onSignal);
					process.removeListener("SIGTERM", onSignal);
				});
			}),
		fs: {
			readFile: (p) => fs.readFile(path.resolve(cwd, p), "utf-8"),
			writeFile: (p, content) => fs.writeFile(path.resolve(cwd, p), content, "utf-8"),
			readdir: (p) => fs.readdir(path.resolve(cwd, p)),
			stat: (p) => fs.stat(path.resolve(cwd, p)),
			exists: (p) =>
				fs.stat(path.resolve(cwd, p)).then(
					() => true,
					() => false,
				),
			mkdir: (p, opts) => fs.mkdir(path.resolve(cwd, p), opts).then(() => undefined),
			rm: (p, opts) => fs.rm(path.resolve(cwd, p), opts),
			cp: (src, dest, opts) =>
				fs.cp(path.resolve(cwd, src), path.resolve(cwd, dest), opts),
		},
		log: {
			info: (msg) => console.log(msg),
			warn: (msg) => console.warn(`warn: ${msg}`),
			error: (msg) => console.error(`error: ${msg}`),
		},
		env: process.env as Record<string, string | undefined>,
		cwd,
		engine,
		engineArgs,
	};
}
