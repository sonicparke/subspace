export interface PreprocessedArgv {
	/** Argv to pass to trpc-cli (before `--`, with `--engine` stripped) */
	cliArgv: string[];
	/** Engine override from `--engine` flag, if provided */
	engineFlag: string | undefined;
	/** Args after `--` to pass through to the engine */
	engineArgs: string[];
}

/**
 * Splits raw argv (process.argv.slice(2)) into CLI args, engine flag, and passthrough args.
 *
 * - Extracts `--engine <value>` or `--engine=<value>` from before `--`
 * - Everything after `--` becomes engineArgs
 * - Remaining args before `--` become cliArgv
 */
export function preprocessArgv(raw: string[]): PreprocessedArgv {
	const dashDashIndex = raw.indexOf("--");
	const beforeDash = dashDashIndex === -1 ? raw : raw.slice(0, dashDashIndex);
	const engineArgs = dashDashIndex === -1 ? [] : raw.slice(dashDashIndex + 1);

	let engineFlag: string | undefined;
	const cliArgv: string[] = [];

	for (let i = 0; i < beforeDash.length; i++) {
		const arg = beforeDash[i];

		if (arg === "--engine") {
			engineFlag = beforeDash[++i];
		} else if (arg.startsWith("--engine=")) {
			engineFlag = arg.slice("--engine=".length);
		} else {
			cliArgv.push(arg);
		}
	}

	return { cliArgv, engineFlag, engineArgs };
}
