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
	instance?: string;
	name?: string;
}

export interface MigrationPlanEntry {
	stack: string;
	env: string;
	region: string;
	name: string;
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
		instance: input.instance,
	};

	const legacyBucket = expandBackendKey(input.templates.bucket, vars);
	const legacyKey = expandBackendKey(input.templates.key, vars);
	const name = input.name ?? input.instance ?? "default";
	const nativeKey = nativeStateKey({
		project: input.project,
		region,
		stack,
		name,
	});

	return {
		stack,
		env,
		region,
		name,
		legacy: { bucket: legacyBucket, key: legacyKey },
		native: { bucket: legacyBucket, key: nativeKey },
	};
}

export function nativeStateKey(input: {
	project: string;
	region: string;
	stack: string;
	name: string;
}): string {
	return `${input.project}/${input.region}/stacks/${input.stack}/${input.name}/terraform.tfstate`;
}
