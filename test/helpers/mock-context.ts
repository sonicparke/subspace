import type { SubspaceContext, ExecResult, StreamResult, SubspaceFs } from "../../src/context.js";
import type { Stats } from "node:fs";

type MockExecHandler = (cmd: string, args: string[]) => ExecResult | Promise<ExecResult>;

type MockStreamHandler = (cmd: string, args: string[]) => StreamResult | number | Promise<StreamResult | number>;

export interface MockContextOptions {
	engine?: string;
	engineArgs?: string[];
	env?: Record<string, string | undefined>;
	cwd?: string;
	files?: Record<string, string>;
	execHandler?: MockExecHandler;
	streamHandler?: MockStreamHandler;
}

/**
 * Create a mock SubspaceContext for unit testing.
 * Uses an in-memory filesystem and stub exec.
 */
export function createMockContext(opts: MockContextOptions = {}): SubspaceContext & {
	files: Record<string, string>;
	logs: { info: string[]; warn: string[]; error: string[] };
	execCalls: Array<{ cmd: string; args: string[] }>;
	streamCalls: Array<{ cmd: string; args: string[] }>;
} {
	const files: Record<string, string> = { ...opts.files };
	const logs = { info: [] as string[], warn: [] as string[], error: [] as string[] };
	const execCalls: Array<{ cmd: string; args: string[] }> = [];
	const streamCalls: Array<{ cmd: string; args: string[] }> = [];

	const defaultExecHandler: MockExecHandler = () => ({
		stdout: "",
		stderr: "",
		exitCode: 0,
	});

	const defaultStreamHandler: MockStreamHandler = () => ({ exitCode: 0, stderr: "" });

	const execHandler = opts.execHandler ?? defaultExecHandler;
	const streamHandler = opts.streamHandler ?? defaultStreamHandler;

	const normalizePath = (p: string): string => {
		// Remove trailing slashes, normalize double slashes
		return p.replace(/\/+/g, "/").replace(/\/$/, "");
	};

	const fs: SubspaceFs = {
		readFile: async (path) => {
			const p = normalizePath(path);
			if (p in files) return files[p];
			throw new Error(`ENOENT: ${p}`);
		},
		writeFile: async (path, content) => {
			files[normalizePath(path)] = content;
		},
		readdir: async (path) => {
			const dir = normalizePath(path);
			const entries = new Set<string>();
			const prefix = `${dir}/`;
			for (const key of Object.keys(files)) {
				if (key.startsWith(prefix)) {
					const rest = key.slice(prefix.length);
					const firstSegment = rest.split("/")[0];
					entries.add(firstSegment);
				}
			}
			if (entries.size === 0) {
				// Check if any file equals the path (it's a file, not a dir)
				if (dir in files) throw new Error(`ENOTDIR: ${dir}`);
				// Check if the dir itself doesn't exist at all
				const parentExists = Object.keys(files).some(
					(k) => k === dir || k.startsWith(prefix),
				);
				if (!parentExists) throw new Error(`ENOENT: ${dir}`);
			}
			return Array.from(entries).sort();
		},
		stat: async (path) => {
			const p = normalizePath(path);
			// Check if it's a file
			if (p in files) {
				return {
					isDirectory: () => false,
					isFile: () => true,
				} as Stats;
			}
			// Check if it's a directory (any file starts with p/)
			const prefix = `${p}/`;
			const isDir = Object.keys(files).some((k) => k.startsWith(prefix));
			if (isDir) {
				return {
					isDirectory: () => true,
					isFile: () => false,
				} as Stats;
			}
			throw new Error(`ENOENT: ${p}`);
		},
		exists: async (path) => {
			const p = normalizePath(path);
			if (p in files) return true;
			const prefix = `${p}/`;
			return Object.keys(files).some((k) => k.startsWith(prefix));
		},
		mkdir: async () => {
			// No-op for in-memory fs (dirs are implicit)
		},
		rm: async (path) => {
			const p = normalizePath(path);
			// Remove exact match and all children
			const prefix = `${p}/`;
			for (const key of Object.keys(files)) {
				if (key === p || key.startsWith(prefix)) {
					delete files[key];
				}
			}
		},
		cp: async (src, dest) => {
			const srcNorm = normalizePath(src);
			const destNorm = normalizePath(dest);
			const prefix = `${srcNorm}/`;
			// Copy file
			if (srcNorm in files) {
				files[destNorm] = files[srcNorm];
				return;
			}
			// Copy directory recursively
			for (const key of Object.keys(files)) {
				if (key.startsWith(prefix)) {
					const relPath = key.slice(srcNorm.length);
					files[destNorm + relPath] = files[key];
				}
			}
		},
	};

	return {
		exec: async (cmd, args) => {
			execCalls.push({ cmd, args });
			return execHandler(cmd, args);
		},
		execStream: async (cmd, args) => {
			streamCalls.push({ cmd, args });
			const result = await streamHandler(cmd, args);
			if (typeof result === "number") return { exitCode: result, stderr: "" };
			return result;
		},
		fs,
		log: {
			info: (msg) => logs.info.push(msg),
			warn: (msg) => logs.warn.push(msg),
			error: (msg) => logs.error.push(msg),
		},
		env: opts.env ?? {},
		cwd: opts.cwd ?? "/test",
		engine: opts.engine ?? "tofu",
		engineArgs: opts.engineArgs ?? [],
		files,
		logs,
		execCalls,
		streamCalls,
	};
}
