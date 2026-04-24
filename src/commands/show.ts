import type { SubspaceContext } from "../context.js";
import { runWorkflow } from "./workflow.js";

export async function runShow(
	ctx: SubspaceContext,
	input: { stack: string; env?: string },
): Promise<number> {
	return runWorkflow(ctx, "show", input.stack, input.env);
}
