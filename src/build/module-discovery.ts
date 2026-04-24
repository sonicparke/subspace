/**
 * Pure helpers for discovering module references in Terraform/OpenTofu
 * source code.
 *
 * Subspace stages user stacks into a build dir with a Terraspace-style
 * layout: `<buildRoot>/stacks/<stack>/` as the chdir target with a
 * sibling `<buildRoot>/modules/<name>/`. Users write their module calls
 * as `source = "../../modules/<name>"` in `app/stacks/<stack>/*.tf`.
 * To make that relative path resolve inside the build dir without any
 * source rewriting, Subspace must copy every referenced `<name>` from
 * `app/modules/<name>/` into `<buildRoot>/modules/<name>/`.
 *
 * This module is pure: no I/O, no side effects. Call `findReferencedModules`
 * with an array of `.tf` file contents to get a sorted, de-duplicated list
 * of module names referenced via `../../modules/<name>` or deeper.
 *
 * Rationale: do not rewrite user `.tf` files (HashiCorp + Terragrunt guidance);
 * copy only what's referenced, not all of `app/modules/` (Terragrunt issue
 * #5643 copy-root philosophy).
 */

/**
 * Matches `source = "<prefix>modules/<name>[/subpath]"` where `<prefix>`
 * is one or more `./` or `../` segments. Captures `<name>`.
 *
 * Examples matched:
 *   source = "../../modules/key_pair"
 *   source = '../../modules/key_pair'   (single-quoted)
 *   source = "../../modules/key_pair/nested"
 *   source  =  "./modules/foo"
 *
 * Examples not matched (intentionally):
 *   source = "modules/foo"                  (no ./ or ../ prefix)
 *   source = "../../other/key_pair"         (not `modules/`)
 *   source = "git::https://..."             (remote)
 *   source = "/abs/path/modules/foo"        (absolute)
 */
/** Double- or single-quoted local module sources (HCL allows both). */
const MODULE_SOURCE_PATTERN_DOUBLE =
	/source\s*=\s*"((?:\.{1,2}\/)+)modules\/([^"/\s]+)(?:\/[^"]*)?"/g;
const MODULE_SOURCE_PATTERN_SINGLE =
	/source\s*=\s*'((?:\.{1,2}\/)+)modules\/([^'/\s]+)(?:\/[^']*)?'/g;

/**
 * Inline `#` or `//` comment-start detection. HCL supports both.
 * A match on the same line *before* `source` means the `source =`
 * assignment is commented out and should be ignored.
 */
const LINE_COMMENT_START = /(^|\s)(#|\/\/)/;

/**
 * Extract distinct module names referenced by any of the given `.tf`
 * source strings. Commented-out lines are ignored. The returned list is
 * sorted alphabetically for determinism.
 */
export function findReferencedModules(tfSources: string[]): string[] {
	const names = new Set<string>();
	for (const source of tfSources) {
		for (const name of findInOneFile(source)) {
			names.add(name);
		}
	}
	return Array.from(names).sort();
}

function findInOneFile(tfSource: string): string[] {
	const names: string[] = [];
	const lines = tfSource.split(/\r?\n/);
	for (const line of lines) {
		if (isCommentedOut(line)) continue;
		for (const re of [MODULE_SOURCE_PATTERN_DOUBLE, MODULE_SOURCE_PATTERN_SINGLE]) {
			re.lastIndex = 0;
			for (const match of line.matchAll(re)) {
				const name = match[2];
				if (name) names.push(name);
			}
		}
	}
	return names;
}

/**
 * True if the `source =` assignment on this line is preceded by an HCL
 * comment marker. This is a pragmatic, line-level check; we do not
 * attempt to parse multi-line block comments (`/* ... *\/`) because
 * they are extremely rare in stack definitions.
 */
function isCommentedOut(line: string): boolean {
	const sourceIdx = line.indexOf("source");
	if (sourceIdx < 0) return false;
	const before = line.slice(0, sourceIdx);
	return LINE_COMMENT_START.test(before);
}
