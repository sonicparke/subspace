import { expandBackendKey } from "./key.js";

export interface MigrationPlanInput {
	stacks: string[];
	envs: string[];
	regions: string[];
	templates: { bucket: string; key: string };
	account: string;
	project: string;
	appName?: string;
	app?: string;
	role?: string;
	extra?: string;
}

export interface MigrationPlanEntry {
	stack: string;
	env: string;
	region: string;
	legacy: { bucket: string; key: string };
	native: { bucket: string; key: string };
}

export interface MigrationPlan {
	entries: MigrationPlanEntry[];
}

export function buildMigrationPlan(input: MigrationPlanInput): MigrationPlan {
	const entries: MigrationPlanEntry[] = [];

	for (const stack of input.stacks) {
		for (const env of input.envs) {
			for (const region of input.regions) {
				entries.push(buildEntry(input, stack, env, region));
			}
		}
	}

	return { entries };
}

function buildEntry(
	input: MigrationPlanInput,
	stack: string,
	env: string,
	region: string,
): MigrationPlanEntry {
	const vars = {
		project: input.project,
		app: input.app ?? "",
		role: input.role ?? "",
		extra: input.extra ?? "",
		env,
		region,
		account: input.account,
		type: "stack",
		type_dir: "stacks",
		mod_name: stack,
	};

	const legacyBucket = expandBackendKey(input.templates.bucket, vars);
	const legacyKey = expandBackendKey(input.templates.key, vars);

	return {
		stack,
		env,
		region,
		legacy: { bucket: legacyBucket, key: legacyKey },
		// Terraspace migration preserves the existing remote state location.
		// "native" here means the backend Subspace will use after repo migration,
		// which intentionally remains the same S3 object.
		native: { bucket: legacyBucket, key: legacyKey },
	};
}
