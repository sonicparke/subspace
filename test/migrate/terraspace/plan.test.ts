import { describe, expect, it } from "vitest";
import { buildMigrationPlan } from "../../../src/migrate/terraspace/plan.js";

describe("buildMigrationPlan()", () => {
	it("produces one entry per (stack, env, region) tuple", () => {
		const plan = buildMigrationPlan({
			stacks: ["network", "compute"],
			envs: ["dev", "prod"],
			regions: ["us-east-1"],
			templates: {
				bucket: "tfstate-:ACCOUNT-:REGION-:ENV",
				key: ":ENV/:REGION/:BUILD_DIR/terraform.tfstate",
			},
			account: "123456789012",
			project: "main",
		});

		expect(plan.entries).toHaveLength(4);
	});

	it("derives the legacy bucket and key for each entry from the templates", () => {
		const plan = buildMigrationPlan({
			stacks: ["network"],
			envs: ["prod"],
			regions: ["us-east-1"],
			templates: {
				bucket: "terraform-state-:ACCOUNT-:REGION-:ENV",
				key: ":PROJECT/:REGION/:APP/:ROLE/:ENV/:EXTRA/:BUILD_DIR/terraform.tfstate",
			},
			account: "123456789012",
			project: "main",
		});

		expect(plan.entries[0].legacy.bucket).toBe(
			"terraform-state-123456789012-us-east-1-prod",
		);
		expect(plan.entries[0].legacy.key).toBe(
			"main/us-east-1/prod/stacks/network/terraform.tfstate",
		);
	});

	it("derives a native backend location for each entry", () => {
		const plan = buildMigrationPlan({
			stacks: ["network"],
			envs: ["prod"],
			regions: ["us-east-1"],
			templates: {
				bucket: "terraform-state-:ACCOUNT-:REGION-:ENV",
				key: ":PROJECT/:REGION/:ENV/:BUILD_DIR/terraform.tfstate",
			},
			account: "123456789012",
			project: "main",
			name: "default",
		});

		expect(plan.entries[0].legacy.key).toBe(
			"main/us-east-1/prod/stacks/network/terraform.tfstate",
		);
		expect(plan.entries[0].native.key).toBe(
			"main/us-east-1/stacks/network/default/terraform.tfstate",
		);
		expect(plan.entries[0].native.bucket).toBe(plan.entries[0].legacy.bucket);
	});

	it("expands the cartesian product across multiple stacks, envs, and regions", () => {
		const plan = buildMigrationPlan({
			stacks: ["a", "b"],
			envs: ["dev", "prod"],
			regions: ["us-east-1", "us-west-2"],
			templates: { bucket: ":ENV", key: ":ENV/:REGION/:BUILD_DIR" },
			account: "0",
			project: "main",
		});

		expect(plan.entries).toHaveLength(8);
		const tuples = plan.entries.map(
			(e) => `${e.stack}/${e.env}/${e.region}`,
		);
		expect(tuples).toContain("a/dev/us-east-1");
		expect(tuples).toContain("b/prod/us-west-2");
	});

	it("preserves stack/env/region values verbatim on each entry", () => {
		const plan = buildMigrationPlan({
			stacks: ["network"],
			envs: ["prod"],
			regions: ["us-east-1"],
			templates: { bucket: "x", key: "y" },
			account: "0",
			project: "main",
		});

		expect(plan.entries[0].stack).toBe("network");
		expect(plan.entries[0].env).toBe("prod");
		expect(plan.entries[0].region).toBe("us-east-1");
		expect(plan.entries[0].name).toBe("default");
	});

	it("returns an empty plan when no stacks are provided", () => {
		const plan = buildMigrationPlan({
			stacks: [],
			envs: ["dev"],
			regions: ["us-east-1"],
			templates: { bucket: "x", key: "y" },
			account: "0",
			project: "main",
		});

		expect(plan.entries).toEqual([]);
	});

	it("keeps the native bucket aligned with the legacy env-scoped bucket", () => {
		const plan = buildMigrationPlan({
			stacks: ["network"],
			envs: ["prod"],
			regions: ["us-east-1"],
			templates: {
				bucket: "terraform-state-:ACCOUNT-:REGION-:ENV",
				key: "legacy",
			},
			account: "0",
			project: "main",
		});

		expect(plan.entries[0].native.bucket).toBe(
			"terraform-state-0-us-east-1-prod",
		);
	});

	it("derives cost-engine-ecs instance state paths", () => {
		const plan = buildMigrationPlan({
			stacks: ["cost-engine-ecs"],
			envs: ["qa"],
			regions: ["us-east-1"],
			templates: {
				bucket: "terraform-state-:ACCOUNT-:REGION-:ENV",
				key: ":PROJECT/:REGION/:ENV/:APP/:BUILD_DIR/terraform.tfstate",
			},
			account: "733734425040",
			project: "main",
			app: "costengine",
			instance: "costengine",
			name: "costengine",
		});

		expect(plan.entries[0].legacy.bucket).toBe(
			"terraform-state-733734425040-us-east-1-qa",
		);
		expect(plan.entries[0].legacy.key).toBe(
			"main/us-east-1/qa/costengine/stacks/cost-engine-ecs.costengine/terraform.tfstate",
		);
		expect(plan.entries[0].native.key).toBe(
			"main/us-east-1/stacks/cost-engine-ecs/costengine/terraform.tfstate",
		);
		expect(plan.entries[0].name).toBe("costengine");
	});

	it("derives named native state paths for no-env style stacks", () => {
		const plan = buildMigrationPlan({
			stacks: ["key-pair"],
			envs: ["qa"],
			regions: ["us-east-1"],
			templates: {
				bucket: "terraform-state-:ACCOUNT-:REGION-:ENV",
				key: ":PROJECT/:REGION/no-env/:BUILD_DIR/terraform.tfstate",
			},
			account: "733734425040",
			project: "main",
			name: "vnh",
		});

		expect(plan.entries[0].native.key).toBe(
			"main/us-east-1/stacks/key-pair/vnh/terraform.tfstate",
		);
	});
});
