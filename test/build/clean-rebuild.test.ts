import { describe, it, expect } from "vitest";
import { cleanRebuild } from "../../src/build/clean-rebuild.js";
import { createMockContext } from "../helpers/mock-context.js";

describe("cleanRebuild", () => {
	it("copies stack source files to build dir", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/mystack/main.tf": "resource {}",
				"app/stacks/mystack/variables.tf": "variable {}",
			},
		});

		await cleanRebuild(ctx, "app/stacks/mystack", "build/mystack/prod");

		expect(ctx.files["build/mystack/prod/main.tf"]).toBe("resource {}");
		expect(ctx.files["build/mystack/prod/variables.tf"]).toBe("variable {}");
	});

	it("preserves .terraform directory", async () => {
		const ctx = createMockContext({
			files: {
				"build/mystack/prod/.terraform/terraform.tfstate": '{"backend":{}}',
				"build/mystack/prod/old-file.tf": "old",
				"app/stacks/mystack/main.tf": "new",
			},
		});

		await cleanRebuild(ctx, "app/stacks/mystack", "build/mystack/prod");

		expect(ctx.files["build/mystack/prod/.terraform/terraform.tfstate"]).toBe(
			'{"backend":{}}',
		);
		expect(ctx.files["build/mystack/prod/old-file.tf"]).toBeUndefined();
		expect(ctx.files["build/mystack/prod/main.tf"]).toBe("new");
	});

	it("preserves .terraform.lock.hcl", async () => {
		const ctx = createMockContext({
			files: {
				"build/mystack/prod/.terraform.lock.hcl": "lock content",
				"app/stacks/mystack/main.tf": "resource {}",
			},
		});

		await cleanRebuild(ctx, "app/stacks/mystack", "build/mystack/prod");

		expect(ctx.files["build/mystack/prod/.terraform.lock.hcl"]).toBe("lock content");
	});

	it("preserves terraform.tfstate and backup", async () => {
		const ctx = createMockContext({
			files: {
				"build/mystack/prod/terraform.tfstate": "state",
				"build/mystack/prod/terraform.tfstate.backup": "backup",
				"app/stacks/mystack/main.tf": "resource {}",
			},
		});

		await cleanRebuild(ctx, "app/stacks/mystack", "build/mystack/prod");

		expect(ctx.files["build/mystack/prod/terraform.tfstate"]).toBe("state");
		expect(ctx.files["build/mystack/prod/terraform.tfstate.backup"]).toBe("backup");
	});

	it("excludes tfvars/ from copy", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/mystack/main.tf": "resource {}",
				"app/stacks/mystack/tfvars/base.tfvars": "x = 1",
			},
		});

		await cleanRebuild(ctx, "app/stacks/mystack", "build/mystack/prod");

		expect(ctx.files["build/mystack/prod/main.tf"]).toBe("resource {}");
		expect(ctx.files["build/mystack/prod/tfvars/base.tfvars"]).toBeUndefined();
	});

	it("excludes .terraform/ from source copy", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/mystack/main.tf": "resource {}",
				"app/stacks/mystack/.terraform/providers": "cached",
			},
		});

		await cleanRebuild(ctx, "app/stacks/mystack", "build/mystack/prod");

		expect(ctx.files["build/mystack/prod/main.tf"]).toBe("resource {}");
		// .terraform from source should NOT be copied
		expect(ctx.files["build/mystack/prod/.terraform/providers"]).toBeUndefined();
	});

	it("excludes .subspace/ from copy", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/mystack/main.tf": "resource {}",
				"app/stacks/mystack/.subspace/something": "data",
			},
		});

		await cleanRebuild(ctx, "app/stacks/mystack", "build/mystack/prod");

		expect(ctx.files["build/mystack/prod/.subspace/something"]).toBeUndefined();
	});

	it("copies subdirectories recursively", async () => {
		const ctx = createMockContext({
			files: {
				"app/stacks/mystack/modules/vpc/main.tf": "vpc resource",
				"app/stacks/mystack/main.tf": "root",
			},
		});

		await cleanRebuild(ctx, "app/stacks/mystack", "build/mystack/prod");

		expect(ctx.files["build/mystack/prod/modules/vpc/main.tf"]).toBe("vpc resource");
	});
});
