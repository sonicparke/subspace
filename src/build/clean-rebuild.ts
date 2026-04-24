import type { SubspaceContext } from "../context.js";
import { findReferencedModules } from "./module-discovery.js";

/** Files/dirs preserved across rebuilds (inside the stack working dir) */
const PRESERVED = new Set([
	".terraform",
	".terraform.lock.hcl",
	"terraform.tfstate",
	"terraform.tfstate.backup",
]);

/** Dirs excluded from source copy */
const EXCLUDED_DIRS = new Set([".terraform", ".subspace", "tfvars"]);

export interface CleanRebuildInput {
	/** Source directory holding the user's stack files (e.g. `app/stacks/<name>`). */
	stackDir: string;
	/**
	 * Build root containing `stacks/<stack>/` and `modules/` as siblings
	 * (e.g. `.subspace/build/<stack>/<region>/<env>`).
	 */
	buildRoot: string;
	/** The stack name (matches the trailing segment of `stackDir`). */
	stackName: string;
	/**
	 * Directories holding shared modules, searched in order
	 * (e.g. `app/modules`, then `infra/vendor` for Terraspace migrations).
	 */
	moduleSourceRoots: ModuleSourceRoot[];
}

export interface ModuleSourceRoot {
	path: string;
	/** Search nested descendants for `<name>/` directories under this root. */
	recursive?: boolean;
}

/**
 * Stage a stack for engine execution.
 *
 * Produces the Terraspace-style layout:
 *   <buildRoot>/stacks/<stackName>/  - clean-rebuilt from stackDir (preserves
 *                                      .terraform/, lockfile, tfstate files)
 *   <buildRoot>/modules/<name>/      - one per module referenced by the stack
 *                                      (or by any transitively referenced
 *                                      module), copied fresh from appModulesDir
 *
 * Module discovery is relative-path-based: any `source = "(./|../)+modules/<name>"`
 * in the staged stack or module source is resolved and copied. References are
 * followed transitively; cycles are safe (a module that references itself or
 * a peer already queued is skipped).
 *
 * If a referenced module does not exist on disk, throws with a clear error.
 */
export async function cleanRebuild(
	ctx: SubspaceContext,
	input: CleanRebuildInput,
): Promise<void> {
	const { stackDir, buildRoot, stackName, moduleSourceRoots } = input;
	const stackWorkDir = `${buildRoot}/stacks/${stackName}`;
	const modulesDir = `${buildRoot}/modules`;

	await ctx.fs.mkdir(stackWorkDir, { recursive: true });
	await cleanStackWorkDir(ctx, stackWorkDir);
	await copyStackSource(ctx, stackDir, stackWorkDir);

	await ctx.fs.rm(modulesDir, { recursive: true, force: true });
	await stageReferencedModules(ctx, {
		seedDir: stackWorkDir,
		sourceRef: `stacks/${stackName}`,
		modulesDir,
		moduleSourceRoots,
	});
}

/**
 * Delete everything in the stack working dir except the preserved set
 * (`.terraform/`, lockfile, tfstate files). Mirrors the pre-refactor
 * semantics, just scoped one level deeper (inside `stacks/<stack>/`).
 */
async function cleanStackWorkDir(
	ctx: SubspaceContext,
	stackWorkDir: string,
): Promise<void> {
	let entries: string[];
	try {
		entries = await ctx.fs.readdir(stackWorkDir);
	} catch {
		return;
	}

	for (const entry of entries) {
		if (PRESERVED.has(entry)) continue;
		await ctx.fs.rm(`${stackWorkDir}/${entry}`, {
			recursive: true,
			force: true,
		});
	}
}

async function copyStackSource(
	ctx: SubspaceContext,
	stackDir: string,
	destDir: string,
): Promise<void> {
	const entries = await ctx.fs.readdir(stackDir);

	for (const entry of entries) {
		if (EXCLUDED_DIRS.has(entry)) continue;

		const srcPath = `${stackDir}/${entry}`;
		const destPath = `${destDir}/${entry}`;
		const stat = await ctx.fs.stat(srcPath);

		if (stat.isDirectory()) {
			await ctx.fs.cp(srcPath, destPath, { recursive: true });
		} else {
			const content = await ctx.fs.readFile(srcPath);
			await ctx.fs.writeFile(destPath, content);
		}
	}
}

/**
 * All distinct on-disk name variants to try under `app/modules/` for a
 * `source = ".../modules/<name>"` segment. Common in Terraspace: the path
 * uses `key-pair` (DNS style) while the directory is `key_pair`.
 */
function candidateAppModuleDirNames(nameFromSource: string): string[] {
	const s = nameFromSource.trim();
	const hy = s.replaceAll("_", "-");
	const us = s.replaceAll("-", "_");
	const out = [s, us, hy].filter(
		(v, i, a) => a.indexOf(v) === i && v.length > 0,
	);
	return out;
}

/**
 * Resolves the real shared-module path to copy from, or `null` if none of the
 * candidate on-disk variants exist under any configured module root.
 */
async function resolveAppModuleSourceDir(
	ctx: SubspaceContext,
	moduleSourceRoots: ModuleSourceRoot[],
	nameFromSource: string,
): Promise<string | null> {
	for (const root of moduleSourceRoots) {
		for (const candidate of candidateAppModuleDirNames(nameFromSource)) {
			const p = `${root.path}/${candidate}`;
			if (await ctx.fs.exists(p)) return p;
			if (!root.recursive) continue;
			const nested = await findNestedModuleDir(ctx, root.path, candidate);
			if (nested) return nested;
		}
	}
	return null;
}

interface StageModulesInput {
	/** Directory whose `.tf` files we scan for module references. */
	seedDir: string;
	/** Human-readable reference to `seedDir` for error messages. */
	sourceRef: string;
	/** Destination directory (e.g. `<buildRoot>/modules`). */
	modulesDir: string;
	/** Source-of-truth roots for module copies, searched in order. */
	moduleSourceRoots: ModuleSourceRoot[];
}

/**
 * Walk the `.tf` files in `seedDir`, collect every referenced module name,
 * copy each from `appModulesDir/<name>/` to `modulesDir/<name>/`, then
 * recurse into each newly-copied module to pick up transitive references.
 *
 * Cycles are safe: a module already staged is not restaged.
 */
async function stageReferencedModules(
	ctx: SubspaceContext,
	input: StageModulesInput,
): Promise<void> {
	const { modulesDir, moduleSourceRoots } = input;
	const staged = new Set<string>();
	const queue: Array<{ dir: string; ref: string }> = [
		{ dir: input.seedDir, ref: input.sourceRef },
	];

	while (queue.length > 0) {
		const current = queue.shift();
		if (!current) break;

		const tfSources = await readAllTfFilesRecursive(ctx, current.dir);
		const refs = findReferencedModules(tfSources);

		for (const name of refs) {
			if (staged.has(name)) continue;
			const resolved = await resolveAppModuleSourceDir(
				ctx,
				moduleSourceRoots,
				name,
			);
			if (!resolved) {
				const tried = candidateAppModuleDirNames(name)
					.flatMap((n) =>
						moduleSourceRoots.map((root) =>
							root.recursive ? `${root.path}/**/${n}/` : `${root.path}/${n}/`,
						),
					)
					.join(", ");
				throw new Error(
					`module path "modules/${name}" referenced in ${current.ref} but no matching directory under any configured module root (tried: ${tried})`,
				);
			}
			// Staged dir name must match the `source` path segment in user .tf (e.g. `key-pair`), even if the repo uses `key_pair/`.
			const dest = `${modulesDir}/${name}`;
			await ctx.fs.cp(resolved, dest, { recursive: true });
			staged.add(name);
			queue.push({ dir: dest, ref: `modules/${name}` });
		}
	}
}

async function findNestedModuleDir(
	ctx: SubspaceContext,
	rootDir: string,
	targetDirName: string,
): Promise<string | null> {
	const queue = [rootDir];

	while (queue.length > 0) {
		const dir = queue.shift();
		if (!dir) break;

		let entries: string[];
		try {
			entries = await ctx.fs.readdir(dir);
		} catch {
			continue;
		}

		for (const entry of entries) {
			if (SKIP_SUBDIRS_FOR_MODULE_SCAN.has(entry)) continue;
			const p = `${dir}/${entry}`;
			let stat: { isDirectory: () => boolean; isFile: () => boolean };
			try {
				stat = await ctx.fs.stat(p);
			} catch {
				continue;
			}
			if (!stat.isDirectory()) continue;
			if (entry === targetDirName) return p;
			queue.push(p);
		}
	}

	return null;
}

/** Do not scan these dirs for `module` blocks (avoids .terraform/provider cache). */
const SKIP_SUBDIRS_FOR_MODULE_SCAN = new Set([
	".terraform",
	".terragrunt-cache",
	"node_modules",
]);

/**
 * Recursively read every `.tf` file under `dir` and return their contents.
 * Skips `SKIP_SUBDIRS_FOR_MODULE_SCAN` so we do not pick up copies under
 * `.terraform/modules/`. Stacks may place `module` blocks in nested dirs
 * (e.g. `stacks/<name>/lib/main.tf`); top-level-only reads miss those and
 * leave `../../modules` unresolved in the build dir.
 */
async function readAllTfFilesRecursive(
	ctx: SubspaceContext,
	dir: string,
): Promise<string[]> {
	const sources: string[] = [];
	let entries: string[];
	try {
		entries = await ctx.fs.readdir(dir);
	} catch {
		return [];
	}

	for (const entry of entries) {
		if (SKIP_SUBDIRS_FOR_MODULE_SCAN.has(entry)) continue;
		const p = `${dir}/${entry}`;
		let stat: { isDirectory: () => boolean; isFile: () => boolean };
		try {
			stat = await ctx.fs.stat(p);
		} catch {
			continue;
		}
		if (stat.isDirectory()) {
			sources.push(...(await readAllTfFilesRecursive(ctx, p)));
			continue;
		}
		if (!entry.endsWith(".tf")) continue;
		try {
			sources.push(await ctx.fs.readFile(p));
		} catch {
			// skip unreadable
		}
	}
	return sources;
}
