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

export function createSubspaceCli(runtime: CliRuntime) {
	const cli = createCLI(() => ({
		description: "Terraspace-style CLI for OpenTofu and Terraform.",
		autocompleteHint: "Run `subspace --help` to see available commands.",
	}));

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

function registerWorkflowCommand(
	cli: ReturnType<typeof createCLI>,
	runtime: CliRuntime,
	command: "plan" | "apply" | "destroy",
	handler: (
		ctx: CliRuntime["ctx"],
		input: { stack: string; env?: string },
	) => Promise<number>,
): void {
	cli.command(`${command} <stack> [env]`, async () => {
		assertWorkflowCommand(runtime.parsed, command);
		await exitOnFailure(
			handler(runtime.ctx, {
				stack: runtime.parsed.stack,
				env: runtime.parsed.env,
			}),
		);
	});
}

async function exitOnFailure(result: Promise<number>): Promise<void> {
	const code = await result;
	if (code !== 0) process.exit(code);
}
