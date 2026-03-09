import { createCLI } from "@oscli-dev/oscli";
import { runApply } from "../commands/apply.js";
import { runDestroy } from "../commands/destroy.js";
import { runDoctor } from "../commands/doctor.js";
import { runNew } from "../commands/new.js";
import { runPlan } from "../commands/plan.js";
import {
	assertNewCommand,
	assertWorkflowCommand,
	type CliRuntime,
} from "./runtime.js";

type SubspaceCli = ReturnType<typeof buildCli>;

export function createSubspaceCli(runtime: CliRuntime) {
	const cli = buildCli();

	cli.command("doctor", async () => {
		await exitOnFailure(runDoctor(runtime.ctx));
	});

	registerWorkflowCommand(cli, runtime, "plan", runPlan);
	registerWorkflowCommand(cli, runtime, "apply", runApply);
	registerWorkflowCommand(cli, runtime, "destroy", runDestroy);

	cli.command("new [generator] [name] [arg3] [arg4] [arg5]", async () => {
		assertNewCommand(runtime.parsed);
		const normalized =
			runtime.parsed.generator === "project"
				? {
						generator: runtime.parsed.generator,
						name: runtime.parsed.name,
						backend: runtime.parsed.arg3,
						region: runtime.parsed.arg4,
						provider: runtime.parsed.arg5,
					}
				: runtime.parsed.generator === "stack"
					? {
							generator: runtime.parsed.generator,
							name: runtime.parsed.name,
							provider: runtime.parsed.arg3,
							region: runtime.parsed.arg4,
						}
					: {
							generator: runtime.parsed.generator,
							name: runtime.parsed.name,
						};
		await exitOnFailure(runNew(runtime.ctx, normalized));
	});

	return cli;
}

function buildCli() {
	return createCLI((b) => ({
		description: "Terraspace-style CLI for OpenTofu and Terraform.",
		autocompleteHint: "Run `subspace --help` to see available commands.",
		flags: {
			stack: b.flag().string().label("Stack").optional(),
			env: b.flag().string().label("Environment").optional(),
		},
	}));
}

function registerWorkflowCommand(
	cli: SubspaceCli,
	runtime: CliRuntime,
	command: "plan" | "apply" | "destroy",
	handler: (
		ctx: CliRuntime["ctx"],
		input: { stack: string; env?: string },
	) => Promise<number>,
): void {
	cli.command(`${command} [stack] [env]`, async () => {
		assertWorkflowCommand(runtime.parsed, command);
		const stack = cli.flags.stack ?? runtime.parsed.stack;
		const env = cli.flags.env ?? runtime.parsed.env;
		if (!stack) {
			cli.exit(`Missing required stack for "${command}".`, {
				code: "usage",
				hint: `Use \`subspace ${command} <stack>\` or pass \`--stack <name>\`.`,
			});
		}
		await exitOnFailure(
			handler(runtime.ctx, {
				stack,
				env,
			}),
		);
	});
}

async function exitOnFailure(result: Promise<number>): Promise<void> {
	const code = await result;
	if (code !== 0) process.exit(code);
}
