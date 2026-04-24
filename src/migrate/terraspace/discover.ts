import path from "node:path";
import type { SubspaceContext } from "../../context.js";

/** Joins project root with path segments; normalizes `.` so `./a` and `a` match. */
function joinRoot(root: string, ...segments: string[]): string {
	return path.join(root, ...segments);
}

/**
 * Lists Terraspace stack names by enumerating directories under
 * `<root>/app/stacks/`. Stray files at that level are ignored.
 */
export async function discoverTerraspaceStacks(
	ctx: SubspaceContext,
	root: string,
): Promise<string[]> {
	const stacksDir = joinRoot(root, "app", "stacks");
	if (!(await ctx.fs.exists(stacksDir))) return [];

	const entries = await ctx.fs.readdir(stacksDir);
	const stacks: string[] = [];
	for (const entry of entries) {
		const stat = await ctx.fs.stat(joinRoot(stacksDir, entry));
		if (stat.isDirectory()) stacks.push(entry);
	}
	return stacks.sort();
}

/**
 * Discovers env names by scanning tfvars filenames across the three
 * conventional Terraspace locations:
 *
 *   - `<root>/config/terraform/tfvars/`
 *   - `<root>/app/stacks/<stack>/tfvars/`
 *   - `<root>/config/stacks/<stack>/tfvars/`
 *
 * Filenames like `dev.tfvars`, `dev.secrets.tfvars`, and
 * `dev.local.tfvars` all contribute the env `dev`. The `base.tfvars`
 * sentinel is not an env.
 */
export async function discoverTerraspaceEnvs(
	ctx: SubspaceContext,
	root: string,
): Promise<string[]> {
	const envs = new Set<string>();

	await collectEnvsFromDir(
		ctx,
		joinRoot(root, "config", "terraform", "tfvars"),
		envs,
	);

	const appStacksDir = joinRoot(root, "app", "stacks");
	if (await ctx.fs.exists(appStacksDir)) {
		for (const stack of await ctx.fs.readdir(appStacksDir)) {
			await collectEnvsFromDir(
				ctx,
				joinRoot(appStacksDir, stack, "tfvars"),
				envs,
			);
		}
	}

	const configStacksDir = joinRoot(root, "config", "stacks");
	if (await ctx.fs.exists(configStacksDir)) {
		for (const stack of await ctx.fs.readdir(configStacksDir)) {
			await collectEnvsFromDir(
				ctx,
				joinRoot(configStacksDir, stack, "tfvars"),
				envs,
			);
		}
	}

	return Array.from(envs).sort();
}

/**
 * Env names for **this stack only**: `app/stacks/<stack>/tfvars/` and
 * `config/stacks/<stack>/tfvars/`. Other stacks' tfvars are ignored so
 * `migrate <stack>` does not expand to the whole org's env list.
 *
 * `base.tfvars` is not an env (Terraspace layer). If the directory only has
 * base files, this returns an empty list — use an explicit
 * `subspace migrate <stack> <env>`, and/or add `envs` under
 * `[migration.terraspace]` in `subspace.toml` (e.g. for `TS_ENV=...` only).
 */
export async function discoverTerraspaceEnvsForStack(
	ctx: SubspaceContext,
	root: string,
	stack: string,
): Promise<string[]> {
	const envs = new Set<string>();

	await collectEnvsFromDir(
		ctx,
		joinRoot(root, "app", "stacks", stack, "tfvars"),
		envs,
	);
	await collectEnvsFromDir(
		ctx,
		joinRoot(root, "config", "stacks", stack, "tfvars"),
		envs,
	);

	return Array.from(envs).sort();
}

async function collectEnvsFromDir(
	ctx: SubspaceContext,
	dir: string,
	out: Set<string>,
): Promise<void> {
	if (!(await ctx.fs.exists(dir))) return;
	const entries = await ctx.fs.readdir(dir);
	for (const entry of entries) {
		const env = envFromFilename(entry);
		if (env) out.add(env);
	}
}

function envFromFilename(filename: string): string | null {
	if (!filename.endsWith(".tfvars")) return null;
	const base = filename.slice(0, -".tfvars".length);
	const head = base.split(".")[0];
	if (head === "base") return null;
	if (!head) return null;
	return head;
}
