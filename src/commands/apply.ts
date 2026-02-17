import type { SubspaceContext } from "../context.js";
import { runWorkflow } from "./workflow.js";

export async function runApply(
	ctx: SubspaceContext,
	input: { stack: string; env?: string },
): Promise<number> {
	return runWorkflow(ctx, "apply", input.stack, input.env);
}
