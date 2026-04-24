import type { SubspaceContext } from "../context.js";
import { parseTomlLite } from "../config/toml-lite.js";

export type MigrationSource = "terraspace";

export interface TerraspaceMigrationConfig {
	bucketTemplate: string;
	keyTemplate: string;
	project: string;
	regions: string[];
	/** Extra env names (e.g. only set via `TS_ENV=`, no `<env>.tfvars` anywhere). */
	envs?: string[];
	/** Terraspace `TS_ROLE` for legacy `:ROLE` in the key template. */
	role?: string;
	/** Terraspace `TS_APP` (or similar) for legacy `:APP` in the key template. */
	app?: string;
	appName?: string;
}

export interface MigrationConfig {
	source: MigrationSource;
	terraspace?: TerraspaceMigrationConfig;
}

const SUBSPACE_TOML_PATH = "subspace.toml";
const SUPPORTED_SOURCES: ReadonlySet<string> = new Set(["terraspace"]);

export async function loadMigrationConfig(
	ctx: SubspaceContext,
): Promise<MigrationConfig | null> {
	if (!(await ctx.fs.exists(SUBSPACE_TOML_PATH))) return null;
	const content = await ctx.fs.readFile(SUBSPACE_TOML_PATH);
	return parseMigrationConfig(content);
}

export function parseMigrationConfig(content: string): MigrationConfig | null {
	const parsed = parseTomlLite(content);
	const block = parsed.migration;
	if (!block) return null;

	const source = block.source as string | undefined;
	if (!source) {
		throw new Error(
			"[migration] is missing required field `source` (e.g. source = \"terraspace\").",
		);
	}
	if (!SUPPORTED_SOURCES.has(source)) {
		throw new Error(
			`Unsupported migration source "${source}". Supported: ${Array.from(SUPPORTED_SOURCES).join(", ")}.`,
		);
	}

	if (source === "terraspace") {
		const ts = parsed["migration.terraspace"];
		if (!ts) {
			throw new Error(
				'[migration].source = "terraspace" requires a [migration.terraspace] section.',
			);
		}
		const bucketTemplate = ts.bucket_template as string | undefined;
		const keyTemplate = ts.key_template as string | undefined;
		if (!bucketTemplate || !keyTemplate) {
			throw new Error(
				"[migration.terraspace] requires both bucket_template and key_template.",
			);
		}
		const regionsRaw = ts.regions;
		const regions = Array.isArray(regionsRaw) ? regionsRaw : [];
		const project = (ts.project as string | undefined) ?? "main";
		const appName = ts.app_name as string | undefined;
		const role = optionalNonEmptyString(ts.role);
		const app = optionalNonEmptyString(ts.app);
		const envsRaw = ts.envs;
		const envs = normalizeStringList(envsRaw);

		return {
			source: "terraspace",
			terraspace: {
				bucketTemplate,
				keyTemplate,
				project,
				regions,
				envs: envs.length ? envs : undefined,
				role,
				app,
				appName,
			},
		};
	}

	return { source: source as MigrationSource };
}

function optionalNonEmptyString(value: unknown): string | undefined {
	if (typeof value !== "string" || !value.trim()) return undefined;
	return value.trim();
}

function normalizeStringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	for (const v of value) {
		if (typeof v === "string" && v.trim()) out.push(v.trim());
	}
	return out;
}
