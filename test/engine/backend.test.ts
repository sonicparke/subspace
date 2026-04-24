import { describe, expect, it } from "vitest";
import { backendConfigFlags, detectBackend } from "../../src/engine/backend.js";
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
		const flags = backendConfigFlags(
			"s3",
			"mystack",
			"prod",
			"us-east-1",
			"demo-app",
		);
		expect(flags).toEqual([
			"-backend-config=bucket=demo-app-subspace-aws-state",
			"-backend-config=key=subspace/aws/us-east-1/prod/mystack/subspace.tfstate",
		]);
	});

	it("generates gcs prefix flag", () => {
		const flags = backendConfigFlags(
			"gcs",
			"mystack",
			"prod",
			"us-west-2",
			"demo-app",
		);
		expect(flags).toEqual([
			"-backend-config=bucket=demo-app-subspace-gcp-state",
			"-backend-config=prefix=subspace/gcp/us-west-2/prod/mystack",
		]);
	});

	it("generates azurerm key flag", () => {
		const flags = backendConfigFlags(
			"azurerm",
			"mystack",
			"staging",
			"global",
			"demo-app",
		);
		expect(flags).toEqual([
			"-backend-config=key=subspace/azure/global/staging/mystack/subspace.tfstate",
		]);
	});

	it("uses __noenv__ when env is empty", () => {
		const flags = backendConfigFlags(
			"s3",
			"mystack",
			"",
			"us-east-1",
			"demo-app",
		);
		expect(flags).toEqual([
			"-backend-config=bucket=demo-app-subspace-aws-state",
			"-backend-config=key=subspace/aws/us-east-1/__noenv__/mystack/subspace.tfstate",
		]);
	});

	it("allows the s3 backend location to be overridden", () => {
		const flags = backendConfigFlags(
			"s3",
			"mystack",
			"prod",
			"us-east-1",
			"demo-app",
			{
				bucket: "terraform-state-123456789012-us-east-1-prod",
				key: "main/us-east-1/prod/stacks/mystack/terraform.tfstate",
			},
		);
		expect(flags).toEqual([
			"-backend-config=bucket=terraform-state-123456789012-us-east-1-prod",
			"-backend-config=key=main/us-east-1/prod/stacks/mystack/terraform.tfstate",
		]);
	});

	it("returns empty for local backend", () => {
		expect(
			backendConfigFlags("local", "mystack", "prod", "global", "demo-app"),
		).toEqual([]);
	});

	it("returns empty for null backend", () => {
		expect(
			backendConfigFlags(null, "mystack", "prod", "global", "demo-app"),
		).toEqual([]);
	});
});
