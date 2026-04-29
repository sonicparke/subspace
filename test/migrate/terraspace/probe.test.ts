import { describe, expect, it } from "vitest";
import { probeStateObjects } from "../../../src/migrate/terraspace/probe.js";
import type { MigrationPlan } from "../../../src/migrate/terraspace/plan.js";
import { createMockContext } from "../../helpers/mock-context.js";

function planWithEntries(
	entries: MigrationPlan["entries"],
): MigrationPlan {
	return { entries };
}

const ONE_ENTRY: MigrationPlan["entries"] = [
	{
		stack: "network",
		env: "prod",
		region: "us-east-1",
		legacy: {
			bucket: "terraform-state-123456789012-us-east-1-prod",
			key: "main/us-east-1/prod/stacks/network/terraform.tfstate",
		},
		native: {
			bucket: "my-app-subspace-aws-state",
			key: "subspace/aws/us-east-1/prod/network/subspace.tfstate",
		},
	},
];

describe("probeStateObjects()", () => {
	it("reports both legacy and native as found when AWS returns 0 for both", async () => {
		const ctx = createMockContext({
			execHandler: () => ({ stdout: "{}", stderr: "", exitCode: 0 }),
		});

		const report = await probeStateObjects(ctx, planWithEntries(ONE_ENTRY));

		expect(report.results[0].legacy.status).toBe("found");
		expect(report.results[0].native.status).toBe("found");
	});

	it("reports missing when head-object exits non-zero with 'Not Found'", async () => {
		const ctx = createMockContext({
			execHandler: () => ({
				stdout: "",
				stderr: "An error occurred (404) when calling the HeadObject operation: Not Found",
				exitCode: 255,
			}),
		});

		const report = await probeStateObjects(ctx, planWithEntries(ONE_ENTRY));

		expect(report.results[0].legacy.status).toBe("missing");
		expect(report.results[0].native.status).toBe("missing");
	});

	it("distinguishes 'missing' from 'error' (permissions, network, etc.)", async () => {
		const ctx = createMockContext({
			execHandler: () => ({
				stdout: "",
				stderr: "Unable to locate credentials. You can configure credentials by running \"aws configure\".",
				exitCode: 253,
			}),
		});

		const report = await probeStateObjects(ctx, planWithEntries(ONE_ENTRY));

		expect(report.results[0].legacy.status).toBe("error");
		expect(report.results[0].legacy.errorMessage).toMatch(/credentials/i);
	});

	it("can report legacy as found and native as missing in the same entry", async () => {
		const ctx = createMockContext({
			execHandler: (_cmd, args) => {
				const keyArg = args.find((a) => a.startsWith("--key="));
				if (keyArg?.includes("subspace/aws/")) {
					return {
						stdout: "",
						stderr: "Not Found",
						exitCode: 255,
					};
				}
				return { stdout: "{}", stderr: "", exitCode: 0 };
			},
		});

		const report = await probeStateObjects(ctx, planWithEntries(ONE_ENTRY));

		expect(report.results[0].legacy.status).toBe("found");
		expect(report.results[0].native.status).toBe("missing");
	});

	it("issues one head-object call per (entry × legacy+native)", async () => {
		const entries: MigrationPlan["entries"] = [ONE_ENTRY[0], {
			...ONE_ENTRY[0],
			stack: "compute",
			env: "dev",
		}];
		const ctx = createMockContext({
			execHandler: () => ({ stdout: "{}", stderr: "", exitCode: 0 }),
		});

		await probeStateObjects(ctx, planWithEntries(entries));

		// 2 entries * 2 probes = 4 calls
		expect(ctx.execCalls.length).toBe(4);
	});

	it("invokes aws s3api head-object with bucket and key flags", async () => {
		const ctx = createMockContext({
			execHandler: () => ({ stdout: "{}", stderr: "", exitCode: 0 }),
		});

		await probeStateObjects(ctx, planWithEntries(ONE_ENTRY));

		const firstCall = ctx.execCalls[0];
		expect(firstCall.cmd).toBe("aws");
		expect(firstCall.args).toContain("s3api");
		expect(firstCall.args).toContain("head-object");
		expect(
			firstCall.args.some((a) =>
				a.includes("terraform-state-123456789012-us-east-1-prod"),
			),
		).toBe(true);
	});

	it("passes --profile to aws s3api head-object when provided", async () => {
		const ctx = createMockContext({
			execHandler: () => ({ stdout: "{}", stderr: "", exitCode: 0 }),
		});

		await probeStateObjects(ctx, planWithEntries(ONE_ENTRY), { profile: "vnh" });

		const firstCall = ctx.execCalls[0];
		expect(firstCall.args).toContain("--profile");
		expect(firstCall.args).toContain("vnh");
	});
});
