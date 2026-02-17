import { createCli } from "trpc-cli";
import { router } from "./router.js";
import { version } from "./version.js";
import { preprocessArgv } from "./argv/preprocess.js";
import { detectEngine } from "./engine/detect.js";
import { createRealContext } from "./context.js";

async function main() {
	const raw = process.argv.slice(2);
	const { cliArgv, engineFlag, engineArgs } = preprocessArgv(raw);

	// Determine if this is the doctor command (needs graceful engine handling)
	const isDoctor = cliArgv[0] === "doctor";

	let engine: string;
	try {
		engine = await detectEngine(
			async (cmd, args) => {
				const { exec: execCb } = await import("node:child_process");
				const { promisify } = await import("node:util");
				const execAsync = promisify(execCb);
				try {
					const { stdout, stderr } = await execAsync(
						[cmd, ...args].join(" "),
					);
					return { stdout, stderr, exitCode: 0 };
				} catch (err: unknown) {
					const e = err as { stdout: string; stderr: string; code: number };
					return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: e.code ?? 1 };
				}
			},
			process.env as Record<string, string | undefined>,
			engineFlag,
		);
	} catch (err) {
		if (isDoctor) {
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

main();
