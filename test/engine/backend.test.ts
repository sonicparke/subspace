import { describe, it, expect } from "vitest";
import { detectBackend, backendConfigFlags } from "../../src/engine/backend.js";
import { createMockContext } from "../helpers/mock-context.js";

describe("detectBackend", () => {
	it("detects s3 backend", async () => {
		const ctx = createMockContext({
			files: {
				"build/backend.tf": `
terraform {
  backend "s3" {
    bucket = "my-bucket"
  }
}`,
			},
		});
		const result = await detectBackend(ctx, "build");
		expect(result).toBe("s3");
	});

	it("detects gcs backend", async () => {
		const ctx = createMockContext({
			files: {
				"build/backend.tf": `
terraform {
  backend "gcs" {
    bucket = "my-bucket"
  }
}`,
			},
		});
		const result = await detectBackend(ctx, "build");
		expect(result).toBe("gcs");
	});

	it("detects azurerm backend", async () => {
		const ctx = createMockContext({
			files: {
				"build/backend.tf": `
terraform {
  backend "azurerm" {
    resource_group_name = "my-rg"
  }
}`,
			},
		});
		const result = await detectBackend(ctx, "build");
		expect(result).toBe("azurerm");
	});

	it("detects local backend", async () => {
		const ctx = createMockContext({
			files: {
				"build/backend.tf": `
terraform {
  backend "local" {}
}`,
			},
		});
		const result = await detectBackend(ctx, "build");
		expect(result).toBe("local");
	});

	it("returns null when no backend found", async () => {
		const ctx = createMockContext({
			files: {
				"build/main.tf": `resource "null_resource" "test" {}`,
			},
		});
		const result = await detectBackend(ctx, "build");
		expect(result).toBeNull();
	});

	it("detects backend from backend.tf.json", async () => {
		const ctx = createMockContext({
			files: {
				"build/backend.tf.json": JSON.stringify({
					terraform: {
						backend: {
							s3: {
								bucket: "my-bucket",
							},
						},
					},
				}),
			},
		});
		const result = await detectBackend(ctx, "build");
		expect(result).toBe("s3");
	});

	it("detects backend from terraform array in tf.json", async () => {
		const ctx = createMockContext({
			files: {
				"build/backend.tf.json": JSON.stringify({
					terraform: [
						{
							backend: {
								gcs: {
									bucket: "my-bucket",
								},
							},
						},
					],
				}),
			},
		});
		const result = await detectBackend(ctx, "build");
		expect(result).toBe("gcs");
	});

	it("returns null for invalid backend.tf.json", async () => {
		const ctx = createMockContext({
			files: {
				"build/backend.tf.json": "{ invalid json",
			},
		});
		const result = await detectBackend(ctx, "build");
		expect(result).toBeNull();
	});

	it("returns null when dir does not exist", async () => {
		const ctx = createMockContext();
		const result = await detectBackend(ctx, "nonexistent");
		expect(result).toBeNull();
	});
});

describe("backendConfigFlags", () => {
	it("generates s3 key flag", () => {
		const flags = backendConfigFlags("s3", "mystack", "prod", "us-east-1");
		expect(flags).toEqual([
			"-backend-config=key=subspace/mystack/us-east-1/prod/terraform.tfstate",
		]);
	});

	it("generates gcs prefix flag", () => {
		const flags = backendConfigFlags("gcs", "mystack", "prod", "us-west-2");
		expect(flags).toEqual(["-backend-config=prefix=subspace/mystack/us-west-2/prod"]);
	});

	it("generates azurerm key flag", () => {
		const flags = backendConfigFlags("azurerm", "mystack", "staging", "global");
		expect(flags).toEqual([
			"-backend-config=key=subspace/mystack/global/staging/terraform.tfstate",
		]);
	});

	it("uses __noenv__ when env is empty", () => {
		const flags = backendConfigFlags("s3", "mystack", "", "us-east-1");
		expect(flags).toEqual([
			"-backend-config=key=subspace/mystack/us-east-1/__noenv__/terraform.tfstate",
		]);
	});

	it("returns empty for local backend", () => {
		expect(backendConfigFlags("local", "mystack", "prod", "global")).toEqual([]);
	});

	it("returns empty for null backend", () => {
		expect(backendConfigFlags(null, "mystack", "prod", "global")).toEqual([]);
	});
});
