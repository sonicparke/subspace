import { describe, expect, it } from "vitest";
import { detectTerraspaceProject } from "../../../src/migrate/terraspace/detect.js";
import { createMockContext } from "../../helpers/mock-context.js";

describe("detectTerraspaceProject()", () => {
	it("identifies a project with both config/app.rb and config/terraform/backend.tf", async () => {
		const ctx = createMockContext({
			files: {
				"proj/config/app.rb": "Terraspace.configure { }",
				"proj/config/terraform/backend.tf": "terraform { backend \"s3\" {} }",
			},
		});

		const result = await detectTerraspaceProject(ctx, "proj");

		expect(result.kind).toBe("terraspace");
	});

	it("identifies a project with only config/app.rb", async () => {
		// app.rb is the strongest signal of a Terraspace project; backend.tf
		// might be missing if the user uses local state.
		const ctx = createMockContext({
			files: { "proj/config/app.rb": "Terraspace.configure { }" },
		});

		const result = await detectTerraspaceProject(ctx, "proj");

		expect(result.kind).toBe("terraspace");
	});

	it("rejects a directory with no Terraspace markers", async () => {
		const ctx = createMockContext({
			files: { "proj/main.tf": "resource \"aws_vpc\" \"x\" {}" },
		});

		const result = await detectTerraspaceProject(ctx, "proj");

		expect(result.kind).toBe("unknown");
		if (result.kind === "unknown") {
			expect(result.missing).toContain("config/app.rb");
		}
	});

	it("rejects a directory that does not exist", async () => {
		const ctx = createMockContext({ files: {} });

		const result = await detectTerraspaceProject(ctx, "nonexistent");

		expect(result.kind).toBe("unknown");
	});

	it("returns the project root path when detected", async () => {
		const ctx = createMockContext({
			files: { "my-app/config/app.rb": "Terraspace.configure { }" },
		});

		const result = await detectTerraspaceProject(ctx, "my-app");

		expect(result.kind).toBe("terraspace");
		if (result.kind === "terraspace") {
			expect(result.root).toBe("my-app");
		}
	});
});
