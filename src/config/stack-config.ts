import type { SubspaceContext } from "../context.js";
import type { StackConfig } from "./stack-schema.js";
import { parseStackConfig, serializeStackConfig } from "./stack-schema.js";

export function stackConfigPath(stack: string): string {
	return `app/stacks/${stack}/subspace.toml`;
}

export async function loadStackConfig(
	ctx: SubspaceContext,
	stack: string,
): Promise<StackConfig | null> {
	const path = stackConfigPath(stack);
	if (!(await ctx.fs.exists(path))) return null;
	return parseStackConfig(await ctx.fs.readFile(path));
}

export async function saveStackConfig(
	ctx: SubspaceContext,
	stack: string,
	config: StackConfig,
): Promise<void> {
	await ctx.fs.writeFile(stackConfigPath(stack), serializeStackConfig(config));
}
