import { describe, it, expect } from "vitest";
import { runDoctor } from "../../src/commands/doctor.js";
import { createMockContext } from "../helpers/mock-context.js";

const LEGACY_MIGRATION_TOML = `[project]
backend = "s3"

[migration]
source = "terraspace"

[migration.terraspace]
bucket_template = "terraform-state-:ACCOUNT-:REGION-:ENV"
key_template = ":PROJECT/:REGION/:APP/:ROLE/:ENV/:EXTRA/:BUILD_DIR/terraform.tfstate"
project = "main"
regions = ["us-east-1"]
`;

function stsAnd(
	fallback: (
		cmd: string,
		args: string[],
	) => { stdout: string; stderr: string; exitCode: number },
) {
	return (cmd: string, args: string[]) => {
		if (cmd === "aws" && args[0] === "sts") {
			return {
				stdout: JSON.stringify({ Account: "123456789012" }),
				stderr: "",
				exitCode: 0,
			};
		}
		return fallback(cmd, args);
	};
}

describe("runDoctor", () => {
	it("reports when tofu is available", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			execHandler: (cmd, args) => {
				if (cmd === "which" && args[0] === "tofu")
					return { stdout: "/usr/bin/tofu\n", stderr: "", exitCode: 0 };
				if (cmd === "tofu" && args[0] === "--version")
					return { stdout: "OpenTofu v1.6.0\n", stderr: "", exitCode: 0 };
				if (cmd === "which" && args[0] === "terraform")
					return { stdout: "", stderr: "", exitCode: 1 };
				return { stdout: "", stderr: "", exitCode: 0 };
			},
		});

		const code = await runDoctor(ctx);

		expect(code).toBe(0);
		expect(ctx.logs.info.some((l) => l.includes("tofu") && l.includes("ok"))).toBe(true);
	});

	it("warns when tofu is not found", async () => {
		const ctx = createMockContext({
			engine: "terraform",
			execHandler: (cmd, args) => {
				if (cmd === "which" && args[0] === "tofu")
					return { stdout: "", stderr: "", exitCode: 1 };
				if (cmd === "which" && args[0] === "terraform")
					return { stdout: "/usr/bin/terraform\n", stderr: "", exitCode: 0 };
				if (cmd === "terraform" && args[0] === "--version")
					return { stdout: "Terraform v1.7.0\n", stderr: "", exitCode: 0 };
				return { stdout: "", stderr: "", exitCode: 0 };
			},
		});

		const code = await runDoctor(ctx);

		expect(code).toBe(0);
		expect(ctx.logs.info.some((l) => l.includes("tofu") && l.includes("warn"))).toBe(true);
		expect(ctx.logs.info.some((l) => l.includes("terraform") && l.includes("ok"))).toBe(true);
	});

	it("reports active engine", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			execHandler: () => ({ stdout: "", stderr: "", exitCode: 1 }),
		});

		await runDoctor(ctx);

		expect(ctx.logs.info.some((l) => l.includes("Active engine: tofu"))).toBe(true);
	});

	it("warns when app/stacks/ is missing", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			execHandler: () => ({ stdout: "", stderr: "", exitCode: 1 }),
		});

		await runDoctor(ctx);

		expect(ctx.logs.info.some((l) => l.includes("app/stacks/") && l.includes("not found"))).toBe(true);
	});

	it("--legacy reports 'No migration configured' when [migration] is absent", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			files: { "subspace.toml": '[project]\nbackend = "s3"\n' },
			execHandler: () => ({ stdout: "{}", stderr: "", exitCode: 0 }),
		});

		const code = await runDoctor(ctx, { legacy: true });

		expect(code).toBe(0);
		expect(ctx.logs.info.some((l) => /No migration configured/.test(l))).toBe(
			true,
		);
	});

	it("--legacy reports [native] when native migrated state exists for every tuple", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			files: {
				"subspace.toml": LEGACY_MIGRATION_TOML,
				"app/stacks/network/main.tf": "",
				"app/stacks/network/tfvars/prod.tfvars": "",
			},
			execHandler: stsAnd(() => ({ stdout: "{}", stderr: "", exitCode: 0 })),
		});

		const code = await runDoctor(ctx, { legacy: true });

		expect(code).toBe(0);
		expect(
			ctx.logs.info.some((l) => /\[native\].*network.*prod/.test(l)),
		).toBe(true);
	});

	it("--legacy reports [native] when the native migrated key exists", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			files: {
				"subspace.toml": LEGACY_MIGRATION_TOML,
				"app/stacks/network/main.tf": "",
				"app/stacks/network/tfvars/prod.tfvars": "",
			},
			execHandler: stsAnd((_cmd, args) => {
				if (args[0] === "s3api" && args[1] === "head-object") {
					return { stdout: "{}", stderr: "", exitCode: 0 };
				}
				return { stdout: "", stderr: "", exitCode: 0 };
			}),
		});

		await runDoctor(ctx, { legacy: true });

		expect(
			ctx.logs.info.some((l) => /\[native\].*network.*prod/.test(l)),
		).toBe(true);
	});

	it("--legacy reports [missing] when neither key exists", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			files: {
				"subspace.toml": LEGACY_MIGRATION_TOML,
				"app/stacks/network/main.tf": "",
				"app/stacks/network/tfvars/prod.tfvars": "",
			},
			execHandler: stsAnd((_cmd, args) => {
				if (args[0] === "s3api" && args[1] === "head-object") {
					return { stdout: "", stderr: "Not Found", exitCode: 255 };
				}
				return { stdout: "", stderr: "", exitCode: 0 };
			}),
		});

		await runDoctor(ctx, { legacy: true });

		expect(
			ctx.logs.info.some((l) => /\[missing\].*network.*prod/.test(l)),
		).toBe(true);
	});

	it("--legacy mixes [native] and [missing] per tuple across stacks", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			files: {
				"subspace.toml": LEGACY_MIGRATION_TOML,
				"app/stacks/network/main.tf": "",
				"app/stacks/network/tfvars/prod.tfvars": "",
				"app/stacks/compute/main.tf": "",
				"app/stacks/compute/tfvars/prod.tfvars": "",
			},
			execHandler: stsAnd((_cmd, args) => {
				if (args[0] === "s3api" && args[1] === "head-object") {
					const key =
						args.find((a) => a.startsWith("--key="))?.slice(6) ?? "";
					if (key.includes("compute")) {
						return { stdout: "", stderr: "Not Found", exitCode: 255 };
					}
					return { stdout: "{}", stderr: "", exitCode: 0 };
				}
				return { stdout: "", stderr: "", exitCode: 0 };
			}),
		});

		await runDoctor(ctx, { legacy: true });

		expect(ctx.logs.info.some((l) => /\[native\].*network/.test(l))).toBe(
			true,
		);
		expect(ctx.logs.info.some((l) => /\[missing\].*compute/.test(l))).toBe(
			true,
		);
	});

	it("lists stacks and checks for base.tfvars", async () => {
		const ctx = createMockContext({
			engine: "tofu",
			files: {
				"app/stacks/network/main.tf": "",
				"app/stacks/network/tfvars/base.tfvars": "x=1",
				"app/stacks/compute/main.tf": "",
			},
			execHandler: () => ({ stdout: "", stderr: "", exitCode: 1 }),
		});

		await runDoctor(ctx);

		expect(ctx.logs.info.some((l) => l.includes("network") && l.includes("ok"))).toBe(true);
		expect(ctx.logs.info.some((l) => l.includes("compute") && l.includes("warn"))).toBe(true);
	});
});
