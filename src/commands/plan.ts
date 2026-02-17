import type { SubspaceContext } from "../context.js";
import { runWorkflow } from "./workflow.js";

export async function runPlan(
	ctx: SubspaceContext,
	input: { stack: string; env?: string },
): Promise<number> {
	return runWorkflow(ctx, "plan", input.stack, input.env);
}
