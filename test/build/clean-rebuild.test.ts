import { describe, expect, it } from "vitest";
import { cleanRebuild } from "../../src/build/clean-rebuild.js";
import { createMockContext } from "../helpers/mock-context.js";

const DEFAULTS = {
	buildRoot: "build/mystack/global/prod",
	stackName: "mystack",
	moduleSourceRoots: [{ path: "app/modules" }],
};

const stackWorkDir = `${DEFAULTS.buildRoot}/stacks/${DEFAULTS.stackName}`;
const modulesDir = `${DEFAULTS.buildRoot}/modules`;

describe("cleanRebuild", () => {
	it("copies stack source files into stacks/<stack>/", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/mystack/main.tf": "resource {}",
				"app/stacks/mystack/variables.tf": "variable {}",
			},
		});

		await cleanRebuild(ctx, {
			stackDir: "app/stacks/mystack",
			...DEFAULTS,
		});

		expect(ctx.files[`${stackWorkDir}/main.tf`]).toBe("resource {}");
		expect(ctx.files[`${stackWorkDir}/variables.tf`]).toBe("variable {}");
	});

	it("preserves .terraform directory inside stacks/<stack>/", async () => {
		const ctx = createMockContext({
			files: {
				[`${stackWorkDir}/.terraform/terraform.tfstate`]: '{"backend":{}}',
				[`${stackWorkDir}/old-file.tf`]: "old",
				"app/stacks/mystack/main.tf": "new",
			},
		});

		await cleanRebuild(ctx, {
			stackDir: "app/stacks/mystack",
			...DEFAULTS,
		});

		expect(ctx.files[`${stackWorkDir}/.terraform/terraform.tfstate`]).toBe(
			'{"backend":{}}',
		);
		expect(ctx.files[`${stackWorkDir}/old-file.tf`]).toBeUndefined();
		expect(ctx.files[`${stackWorkDir}/main.tf`]).toBe("new");
	});

	it("preserves .terraform.lock.hcl inside stacks/<stack>/", async () => {
		const ctx = createMockContext({
			files: {
				[`${stackWorkDir}/.terraform.lock.hcl`]: "lock content",
				"app/stacks/mystack/main.tf": "resource {}",
			},
		});

		await cleanRebuild(ctx, {
			stackDir: "app/stacks/mystack",
			...DEFAULTS,
		});

		expect(ctx.files[`${stackWorkDir}/.terraform.lock.hcl`]).toBe(
			"lock content",
		);
	});

	it("preserves terraform.tfstate and backup inside stacks/<stack>/", async () => {
		const ctx = createMockContext({
			files: {
				[`${stackWorkDir}/terraform.tfstate`]: "state",
				[`${stackWorkDir}/terraform.tfstate.backup`]: "backup",
				"app/stacks/mystack/main.tf": "resource {}",
			},
		});

		await cleanRebuild(ctx, {
			stackDir: "app/stacks/mystack",
			...DEFAULTS,
		});

		expect(ctx.files[`${stackWorkDir}/terraform.tfstate`]).toBe("state");
		expect(ctx.files[`${stackWorkDir}/terraform.tfstate.backup`]).toBe(
			"backup",
		);
	});

	it("excludes tfvars/ from copy", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/mystack/main.tf": "resource {}",
				"app/stacks/mystack/tfvars/base.tfvars": "x = 1",
			},
		});

		await cleanRebuild(ctx, {
			stackDir: "app/stacks/mystack",
			...DEFAULTS,
		});

		expect(ctx.files[`${stackWorkDir}/main.tf`]).toBe("resource {}");
		expect(ctx.files[`${stackWorkDir}/tfvars/base.tfvars`]).toBeUndefined();
	});

	it("excludes .terraform/ from source copy", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/mystack/main.tf": "resource {}",
				"app/stacks/mystack/.terraform/providers": "cached",
			},
		});

		await cleanRebuild(ctx, {
			stackDir: "app/stacks/mystack",
			...DEFAULTS,
		});

		expect(ctx.files[`${stackWorkDir}/main.tf`]).toBe("resource {}");
		expect(ctx.files[`${stackWorkDir}/.terraform/providers`]).toBeUndefined();
	});

	it("excludes .subspace/ from copy", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/mystack/main.tf": "resource {}",
				"app/stacks/mystack/.subspace/something": "data",
			},
		});

		await cleanRebuild(ctx, {
			stackDir: "app/stacks/mystack",
			...DEFAULTS,
		});

		expect(ctx.files[`${stackWorkDir}/.subspace/something`]).toBeUndefined();
	});

	it("copies subdirectories recursively", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/mystack/sub/main.tf": "sub resource",
				"app/stacks/mystack/main.tf": "root",
			},
		});

		await cleanRebuild(ctx, {
			stackDir: "app/stacks/mystack",
			...DEFAULTS,
		});

		expect(ctx.files[`${stackWorkDir}/sub/main.tf`]).toBe("sub resource");
	});

	it("stages referenced modules under <buildRoot>/modules/<name>/", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/mystack/main.tf":
					'module "key_pair" { source = "../../modules/key_pair" }',
				"app/modules/key_pair/main.tf": "key_pair resource",
				"app/modules/key_pair/variables.tf": "key_pair vars",
			},
		});

		await cleanRebuild(ctx, {
			stackDir: "app/stacks/mystack",
			...DEFAULTS,
		});

		expect(ctx.files[`${modulesDir}/key_pair/main.tf`]).toBe(
			"key_pair resource",
		);
		expect(ctx.files[`${modulesDir}/key_pair/variables.tf`]).toBe(
			"key_pair vars",
		);
	});

	it("stages a repo dir whose name normalizes to the source (e.g. key_pair on disk, key-pair in source)", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/mystack/main.tf":
					'module "key" { source = "../../modules/key-pair" }',
				"app/modules/key_pair/main.tf": "from_underscore_dir",
			},
		});

		await cleanRebuild(ctx, {
			stackDir: "app/stacks/mystack",
			...DEFAULTS,
		});

		// Staged as `key-pair/` so `../../modules/key-pair` from the stack still resolves.
		expect(ctx.files[`${modulesDir}/key-pair/main.tf`]).toBe(
			"from_underscore_dir",
		);
	});

	it("stages only referenced modules, not all of app/modules", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/mystack/main.tf":
					'module "vpc" { source = "../../modules/vpc" }',
				"app/modules/vpc/main.tf": "vpc",
				"app/modules/unused/main.tf": "unused",
			},
		});

		await cleanRebuild(ctx, {
			stackDir: "app/stacks/mystack",
			...DEFAULTS,
		});

		expect(ctx.files[`${modulesDir}/vpc/main.tf`]).toBe("vpc");
		expect(ctx.files[`${modulesDir}/unused/main.tf`]).toBeUndefined();
	});

	it("falls back to later module roots when the primary root does not contain the module", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/mystack/main.tf":
					'module "key-pair" { source = "../../modules/key-pair" }',
				"infra/vendor/key_pair/main.tf": "vendor module",
			},
		});

		await cleanRebuild(ctx, {
			stackDir: "app/stacks/mystack",
			buildRoot: DEFAULTS.buildRoot,
			stackName: DEFAULTS.stackName,
			moduleSourceRoots: [
				{ path: "app/modules" },
				{ path: "infra/vendor", recursive: true },
			],
		});

		expect(ctx.files[`${modulesDir}/key-pair/main.tf`]).toBe("vendor module");
	});

	it("finds vendor modules nested under infra/vendor/** for Terraspace migrations", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/mystack/main.tf":
					'module "key-pair" { source = "../../modules/key-pair" }',
				"infra/vendor/modules/aws/key_pair/main.tf": "nested vendor module",
			},
		});

		await cleanRebuild(ctx, {
			stackDir: "app/stacks/mystack",
			buildRoot: DEFAULTS.buildRoot,
			stackName: DEFAULTS.stackName,
			moduleSourceRoots: [
				{ path: "app/modules" },
				{ path: "infra/vendor", recursive: true },
			],
		});

		expect(ctx.files[`${modulesDir}/key-pair/main.tf`]).toBe(
			"nested vendor module",
		);
	});

	it("follows transitive module references", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/mystack/main.tf":
					'module "outer" { source = "../../modules/outer" }',
				"app/modules/outer/main.tf":
					'module "inner" { source = "../../modules/inner" }',
				"app/modules/inner/main.tf": "inner",
			},
		});

		await cleanRebuild(ctx, {
			stackDir: "app/stacks/mystack",
			...DEFAULTS,
		});

		expect(ctx.files[`${modulesDir}/outer/main.tf`]).toBe(
			'module "inner" { source = "../../modules/inner" }',
		);
		expect(ctx.files[`${modulesDir}/inner/main.tf`]).toBe("inner");
	});

	it("handles module reference cycles safely (A -> B -> A)", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/mystack/main.tf":
					'module "a" { source = "../../modules/a" }',
				"app/modules/a/main.tf":
					'module "b" { source = "../../modules/b" }',
				"app/modules/b/main.tf":
					'module "a" { source = "../../modules/a" }',
			},
		});

		await cleanRebuild(ctx, {
			stackDir: "app/stacks/mystack",
			...DEFAULTS,
		});

		expect(ctx.files[`${modulesDir}/a/main.tf`]).toBe(
			'module "b" { source = "../../modules/b" }',
		);
		expect(ctx.files[`${modulesDir}/b/main.tf`]).toBe(
			'module "a" { source = "../../modules/a" }',
		);
	});

	it("throws a clear error when a referenced module does not exist", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/mystack/main.tf":
					'module "missing" { source = "../../modules/missing" }',
			},
		});

		await expect(
			cleanRebuild(ctx, {
				stackDir: "app/stacks/mystack",
				...DEFAULTS,
			}),
		).rejects.toThrow(
			/modules\/missing.*referenced in stacks\/mystack.*tried:/,
		);
	});

	it("includes every configured module root in the missing-module error", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/mystack/main.tf":
					'module "missing" { source = "../../modules/missing" }',
			},
		});

		await expect(
			cleanRebuild(ctx, {
				stackDir: "app/stacks/mystack",
				buildRoot: DEFAULTS.buildRoot,
				stackName: DEFAULTS.stackName,
				moduleSourceRoots: [
					{ path: "app/modules" },
					{ path: "infra/vendor", recursive: true },
				],
			}),
		).rejects.toThrow(
			/tried: app\/modules\/missing\/, infra\/vendor\/\*\*\/missing\//,
		);
	});

	it("does not treat .tf under preserved .terraform/ as module graph (skip that tree)", async () => {
		const ctx = createMockContext({
			files: {
				[`${stackWorkDir}/.terraform/trap.tf`]:
					'module "ghost" { source = "../../modules/ghost" }',
				"app/stacks/mystack/main.tf":
					'module "ok" { source = "../../modules/ok" }',
				"app/modules/ok/main.tf": "ok",
			},
		});

		await cleanRebuild(ctx, {
			stackDir: "app/stacks/mystack",
			...DEFAULTS,
		});

		expect(ctx.files[`${modulesDir}/ok/main.tf`]).toBe("ok");
		expect(ctx.files[`${modulesDir}/ghost/main.tf`]).toBeUndefined();
	});

	it("discovers module refs in nested .tf under the stack (not only top-level)", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/mystack/compose/child.tf":
					'module "vpc" { source = "../../../modules/vpc" }',
				"app/stacks/mystack/main.tf": "terraform {}",
				"app/modules/vpc/main.tf": "vpc",
			},
		});

		await cleanRebuild(ctx, {
			stackDir: "app/stacks/mystack",
			...DEFAULTS,
		});

		expect(ctx.files[`${stackWorkDir}/compose/child.tf`]).toBeDefined();
		expect(ctx.files[`${modulesDir}/vpc/main.tf`]).toBe("vpc");
	});

	it("wipes modules/ between runs (no stale modules)", async () => {
		const ctx = createMockContext({
			files: {
				[`${modulesDir}/stale/main.tf`]: "old module",
				"app/stacks/mystack/main.tf":
					'module "fresh" { source = "../../modules/fresh" }',
				"app/modules/fresh/main.tf": "fresh",
			},
		});

		await cleanRebuild(ctx, {
			stackDir: "app/stacks/mystack",
			...DEFAULTS,
		});

		expect(ctx.files[`${modulesDir}/stale/main.tf`]).toBeUndefined();
		expect(ctx.files[`${modulesDir}/fresh/main.tf`]).toBe("fresh");
	});
});
