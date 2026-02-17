import type { SubspaceContext } from "../context.js";
import { runWorkflow } from "./workflow.js";

export async function runDestroy(
	ctx: SubspaceContext,
	input: { stack: string; env?: string },
): Promise<number> {
	return runWorkflow(ctx, "destroy", input.stack, input.env);
}
