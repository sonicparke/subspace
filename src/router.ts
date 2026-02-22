import { initTRPC } from "@trpc/server";
import { z } from "zod/v4";
import type { SubspaceContext } from "./context.js";
import { runDoctor } from "./commands/doctor.js";
import { runPlan } from "./commands/plan.js";
import { runApply } from "./commands/apply.js";
import { runDestroy } from "./commands/destroy.js";
import { runNew } from "./commands/new.js";

const t = initTRPC.context<SubspaceContext>().create();

const workflowInput = z.object({
	stack: z.string().describe("Stack name").meta({ positional: true }),
	env: z.string().optional().describe("Environment name").meta({ positional: true }),
});
const newInput = z.object({
	generator: z.enum(["project", "module", "stack"]).describe("Generator type").meta({ positional: true }),
	name: z.string().describe("Resource name").meta({ positional: true }),
	arg3: z
		.string()
		.optional()
		.describe("Generator-specific third positional argument")
		.meta({ positional: true }),
	arg4: z
		.string()
		.optional()
		.describe("Generator-specific fourth positional argument")
		.meta({ positional: true }),
});

export const router = t.router({
	doctor: t.procedure
		.meta({ description: "Check local environment and report status" })
		.mutation(async ({ ctx }) => {
			const code = await runDoctor(ctx);
			if (code !== 0) process.exit(code);
		}),

	plan: t.procedure
		.meta({ description: "Run plan for a stack" })
		.input(workflowInput)
		.mutation(async ({ ctx, input }) => {
			const code = await runPlan(ctx, input);
			if (code !== 0) process.exit(code);
		}),

	// "apply" is a JS reserved property name in tRPC routers.
	// We use _apply internally and remap it in cli.ts.
	_apply: t.procedure
		.meta({ description: "Run apply for a stack" })
		.input(workflowInput)
		.mutation(async ({ ctx, input }) => {
			const code = await runApply(ctx, input);
			if (code !== 0) process.exit(code);
		}),

	destroy: t.procedure
		.meta({ description: "Run destroy for a stack" })
		.input(workflowInput)
		.mutation(async ({ ctx, input }) => {
			const code = await runDestroy(ctx, input);
			if (code !== 0) process.exit(code);
		}),

	new: t.procedure
		.meta({ description: "Generate project, module, or stack scaffolding" })
		.input(newInput)
		.mutation(async ({ ctx, input }) => {
			const normalized =
				input.generator === "project"
					? {
						generator: input.generator,
						name: input.name,
						backend: input.arg3,
						region: input.arg4,
					}
					: input.generator === "stack"
						? {
							generator: input.generator,
							name: input.name,
							provider: input.arg3,
							region: input.arg4,
						}
						: {
							generator: input.generator,
							name: input.name,
						};
			const code = await runNew(ctx, normalized);
			if (code !== 0) process.exit(code);
		}),
});

export type AppRouter = typeof router;
