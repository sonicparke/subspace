/**
 * Terraspace backend-key template expansion.
 *
 * Ports Terraspace's `Terraspace::Plugin::Expander::Interface#expansion`
 * semantics so Subspace can derive legacy S3 keys for migration.
 *
 * Reference: https://github.com/boltops-tools/terraspace/blob/master/lib/terraspace/plugin/expander/interface.rb
 *
 * Expansion rules (in order):
 *   1. Replace every `:VAR` token with the matching variable value.
 *      Missing variables collapse to empty string.
 *   2. Strip trailing `/+`.
 *   3. Preserve `://` sequences so URLs remain intact.
 *   4. Collapse runs of `/+` into a single `/`.
 *   5. Strip leading and trailing `-`.
 *
 * This module is pure: it performs no I/O and is safe to call in any
 * context. All external values (account id, region, env, etc.) must
 * be supplied by the caller.
 */

export interface TerraspaceVars {
	project?: string;
	app?: string;
	role?: string;
	env?: string;
	extra?: string;
	region?: string;
	account?: string;
	mod_name?: string;
	type?: string;
	type_dir?: string;
	type_extra?: string;
	build_dir?: string;
	instance?: string;
	[custom: string]: string | undefined;
}

export interface ExpandOptions {
	template: string;
	vars: TerraspaceVars;
}

const URL_SCHEME_SENTINEL = "\u0000TS_KEEP_HTTP\u0000";

export function expand({ template, vars }: ExpandOptions): string {
	let out = template.replace(/:(\w+)/g, (_, name: string) => resolve(vars, name));
	out = strip(out);
	return out;
}

function resolve(vars: TerraspaceVars, name: string): string {
	const key = name.toLowerCase();
	const direct = vars[key];
	if (direct !== undefined && direct !== "") return direct;
	const upper = vars[name];
	if (upper !== undefined && upper !== "") return upper;
	return "";
}

function strip(value: string): string {
	let v = value;
	v = v.replace(/\/+$/, "");
	v = v.replace(/:\/\//g, URL_SCHEME_SENTINEL);
	v = v.replace(/\/+/g, "/");
	v = v.replaceAll(URL_SCHEME_SENTINEL, "://");
	v = v.replace(/^-+/, "").replace(/-+$/, "");
	return v;
}

/**
 * Convenience builder: derive the conventional :BUILD_DIR value from
 * (type_dir, mod_name, instance?) when the caller has not supplied it.
 */
export function buildDirOf(
	typeDir: string | undefined,
	modName: string | undefined,
	instance?: string,
): string {
	const parts = [typeDir, modName].filter((p): p is string => Boolean(p));
	const base = parts.join("/");
	if (!instance) return base;
	return `${base}-${instance}`;
}

/**
 * Fills in derived variables (:BUILD_DIR, :TYPE_EXTRA) from the
 * explicit inputs, unless the caller has already supplied them.
 */
export function withDerivedVars(vars: TerraspaceVars): TerraspaceVars {
	const out: TerraspaceVars = { ...vars };
	if (!out.build_dir) {
		out.build_dir = buildDirOf(out.type_dir, out.mod_name, out.instance);
	}
	if (!out.type_extra && out.type) {
		out.type_extra = out.extra
			? `${out.type}-${out.extra}`
			: out.type;
	}
	return out;
}

/**
 * High-level helper: expand a Terraspace backend key template given a
 * set of Subspace-native inputs, auto-deriving BUILD_DIR and TYPE_EXTRA.
 */
export function expandBackendKey(
	template: string,
	vars: TerraspaceVars,
): string {
	return expand({ template, vars: withDerivedVars(vars) });
}
