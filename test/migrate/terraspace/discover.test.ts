import { describe, expect, it } from "vitest";
import {
	discoverTerraspaceEnvs,
	discoverTerraspaceEnvsForStack,
	discoverTerraspaceStacks,
} from "../../../src/migrate/terraspace/discover.js";
import { createMockContext } from "../../helpers/mock-context.js";

describe("discoverTerraspaceStacks()", () => {
	it("lists stack directory names under app/stacks/", async () => {
		const ctx = createMockContext({
			files: {
				"proj/app/stacks/network/main.tf": "",
				"proj/app/stacks/network/outputs.tf": "",
				"proj/app/stacks/compute/main.tf": "",
				"proj/app/stacks/storage/main.tf": "",
			},
		});

		const stacks = await discoverTerraspaceStacks(ctx, "proj");

		expect(stacks).toEqual(["compute", "network", "storage"]);
	});

	it("returns empty array when app/stacks/ does not exist", async () => {
		const ctx = createMockContext({ files: {} });

		const stacks = await discoverTerraspaceStacks(ctx, "proj");

		expect(stacks).toEqual([]);
	});

	it("ignores stray files at the app/stacks/ level", async () => {
		const ctx = createMockContext({
			files: {
				"proj/app/stacks/README.md": "stuff",
				"proj/app/stacks/network/main.tf": "",
			},
		});

		const stacks = await discoverTerraspaceStacks(ctx, "proj");

		expect(stacks).toEqual(["network"]);
	});
});

describe("discoverTerraspaceEnvs()", () => {
	it("derives envs from tfvars filenames in config/terraform/tfvars/", async () => {
		const ctx = createMockContext({
			files: {
				"proj/config/terraform/tfvars/base.tfvars": "x=1",
				"proj/config/terraform/tfvars/dev.tfvars": "x=2",
				"proj/config/terraform/tfvars/prod.tfvars": "x=3",
			},
		});

		const envs = await discoverTerraspaceEnvs(ctx, "proj");

		// `base` is not an env — it applies to all envs.
		expect(envs).toEqual(["dev", "prod"]);
	});

	it("derives envs from tfvars filenames under app/stacks/<stack>/tfvars/", async () => {
		const ctx = createMockContext({
			files: {
				"proj/app/stacks/network/tfvars/base.tfvars": "",
				"proj/app/stacks/network/tfvars/staging.tfvars": "",
				"proj/app/stacks/compute/tfvars/prod.tfvars": "",
			},
		});

		const envs = await discoverTerraspaceEnvs(ctx, "proj");

		expect(envs).toEqual(["prod", "staging"]);
	});

	it("derives envs from config/stacks/<stack>/tfvars/", async () => {
		const ctx = createMockContext({
			files: {
				"proj/config/stacks/network/tfvars/base.tfvars": "",
				"proj/config/stacks/network/tfvars/qa.tfvars": "",
			},
		});

		const envs = await discoverTerraspaceEnvs(ctx, "proj");

		expect(envs).toEqual(["qa"]);
	});

	it("merges and deduplicates envs found across all three tfvars locations", async () => {
		const ctx = createMockContext({
			files: {
				"proj/config/terraform/tfvars/dev.tfvars": "",
				"proj/app/stacks/network/tfvars/dev.tfvars": "",
				"proj/app/stacks/network/tfvars/prod.tfvars": "",
				"proj/config/stacks/network/tfvars/staging.tfvars": "",
			},
		});

		const envs = await discoverTerraspaceEnvs(ctx, "proj");

		expect(envs).toEqual(["dev", "prod", "staging"]);
	});

	it("ignores non-tfvars files and the base.tfvars sentinel", async () => {
		const ctx = createMockContext({
			files: {
				"proj/config/terraform/tfvars/base.tfvars": "",
				"proj/config/terraform/tfvars/README.md": "",
				"proj/config/terraform/tfvars/dev.tfvars": "",
			},
		});

		const envs = await discoverTerraspaceEnvs(ctx, "proj");

		expect(envs).toEqual(["dev"]);
	});

	it("strips secrets and local suffixes from env names", async () => {
		// Terraspace supports dev.tfvars, dev.secrets.tfvars, etc. The
		// underlying env is still "dev" — the suffix is metadata.
		const ctx = createMockContext({
			files: {
				"proj/config/terraform/tfvars/dev.tfvars": "",
				"proj/config/terraform/tfvars/dev.secrets.tfvars": "",
				"proj/config/terraform/tfvars/dev.local.tfvars": "",
			},
		});

		const envs = await discoverTerraspaceEnvs(ctx, "proj");

		expect(envs).toEqual(["dev"]);
	});

	it("returns empty array when no tfvars exist anywhere", async () => {
		const ctx = createMockContext({
			files: { "proj/config/app.rb": "" },
		});

		const envs = await discoverTerraspaceEnvs(ctx, "proj");

		expect(envs).toEqual([]);
	});
});

describe("discoverTerraspaceEnvsForStack()", () => {
	it("merges only app/stacks/<stack>/tfvars and config/stacks/<stack>/tfvars", async () => {
		const ctx = createMockContext({
			files: {
				"proj/config/terraform/tfvars/base.tfvars": "",
				"proj/config/terraform/tfvars/z-global-only.tfvars": "",
				"proj/app/stacks/network/tfvars/prod.tfvars": "",
				"proj/config/stacks/network/tfvars/staging.tfvars": "",
				"proj/app/stacks/compute/tfvars/qa.tfvars": "",
			},
		});

		const forNetwork = await discoverTerraspaceEnvsForStack(
			ctx,
			"proj",
			"network",
		);
		const forCompute = await discoverTerraspaceEnvsForStack(
			ctx,
			"proj",
			"compute",
		);

		expect(forNetwork).toEqual(["prod", "staging"]);
		expect(forCompute).toEqual(["qa"]);
	});

	it("ignores config/terraform/tfvars when the stack has no stack-level per-env files", async () => {
		const ctx = createMockContext({
			files: {
				"proj/config/terraform/tfvars/staging.tfvars": "",
			},
		});

		const envs = await discoverTerraspaceEnvsForStack(
			ctx,
			"proj",
			"network",
		);

		expect(envs).toEqual([]);
	});

	it("does not pull in other stacks' envs when this stack has only base.tfvars", async () => {
		const ctx = createMockContext({
			files: {
				"proj/app/stacks/network/tfvars/base.tfvars": "",
				"proj/app/stacks/other/tfvars/dev.tfvars": "",
				"proj/app/stacks/another/tfvars/prod.tfvars": "",
			},
		});

		const envs = await discoverTerraspaceEnvsForStack(
			ctx,
			"proj",
			"network",
		);

		expect(envs).toEqual([]);
	});

	it("returns empty when no envs exist anywhere in the project", async () => {
		const ctx = createMockContext({
			files: {
				"proj/app/stacks/network/tfvars/base.tfvars": "",
			},
		});

		const envs = await discoverTerraspaceEnvsForStack(
			ctx,
			"proj",
			"network",
		);

		expect(envs).toEqual([]);
	});
});
