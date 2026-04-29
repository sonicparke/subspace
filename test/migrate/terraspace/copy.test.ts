import { describe, expect, it } from "vitest";
import { copyLegacyToNative } from "../../../src/migrate/terraspace/copy.js";
import { createMockContext } from "../../helpers/mock-context.js";

const LEGACY = {
	bucket: "terraform-state-123456789012-us-east-1-prod",
	key: "main/us-east-1/prod/stacks/network/terraform.tfstate",
};
const NATIVE = {
	bucket: "my-app-subspace-aws-state",
	key: "subspace/aws/us-east-1/prod/network/subspace.tfstate",
};

type HeadLookup = Record<string, "found" | "missing" | "error">;

function execHandlerFor(heads: HeadLookup, cpExitCode = 0, cpStderr = "") {
	return (cmd: string, args: string[]) => {
		if (cmd !== "aws") {
			return { stdout: "", stderr: "unexpected command", exitCode: 2 };
		}
		if (args[0] === "s3api" && args[1] === "head-object") {
			const bucket =
				args
					.find((a) => a.startsWith("--bucket="))
					?.slice("--bucket=".length) ?? "";
			const key =
				args
					.find((a) => a.startsWith("--key="))
					?.slice("--key=".length) ?? "";
			const state = heads[`${bucket}/${key}`] ?? "missing";
			if (state === "found") {
				return { stdout: "{}", stderr: "", exitCode: 0 };
			}
			if (state === "missing") {
				return { stdout: "", stderr: "Not Found", exitCode: 255 };
			}
			return {
				stdout: "",
				stderr: "Access Denied",
				exitCode: 1,
			};
		}
		if (args[0] === "s3" && args[1] === "cp") {
			return { stdout: "", stderr: cpStderr, exitCode: cpExitCode };
		}
		return { stdout: "", stderr: "", exitCode: 0 };
	};
}

describe("copyLegacyToNative()", () => {
	it("returns 'same-location' when the source and destination are identical", async () => {
		const ctx = createMockContext();

		const out = await copyLegacyToNative(ctx, {
			legacy: LEGACY,
			native: LEGACY,
		});

		expect(out).toEqual({ status: "same-location" });
		expect(ctx.execCalls).toHaveLength(0);
	});

	it("returns 'native-exists' when the native key is already present and never calls s3 cp", async () => {
		const ctx = createMockContext({
			execHandler: execHandlerFor({
				[`${NATIVE.bucket}/${NATIVE.key}`]: "found",
				[`${LEGACY.bucket}/${LEGACY.key}`]: "found",
			}),
		});

		const out = await copyLegacyToNative(ctx, {
			legacy: LEGACY,
			native: NATIVE,
		});

		expect(out).toEqual({ status: "native-exists" });
		const cpCalls = ctx.execCalls.filter(
			(c) => c.args[0] === "s3" && c.args[1] === "cp",
		);
		expect(cpCalls.length).toBe(0);
	});

	it("returns 'legacy-missing' when native is missing and legacy is missing, without copying", async () => {
		const ctx = createMockContext({
			execHandler: execHandlerFor({
				[`${NATIVE.bucket}/${NATIVE.key}`]: "missing",
				[`${LEGACY.bucket}/${LEGACY.key}`]: "missing",
			}),
		});

		const out = await copyLegacyToNative(ctx, {
			legacy: LEGACY,
			native: NATIVE,
		});

		expect(out).toEqual({ status: "legacy-missing" });
		const cpCalls = ctx.execCalls.filter(
			(c) => c.args[0] === "s3" && c.args[1] === "cp",
		);
		expect(cpCalls.length).toBe(0);
	});

	it("returns 'copied' when native is missing and legacy is found and s3 cp succeeds", async () => {
		const ctx = createMockContext({
			execHandler: execHandlerFor({
				[`${NATIVE.bucket}/${NATIVE.key}`]: "missing",
				[`${LEGACY.bucket}/${LEGACY.key}`]: "found",
			}),
		});

		const out = await copyLegacyToNative(ctx, {
			legacy: LEGACY,
			native: NATIVE,
		});

		expect(out).toEqual({ status: "copied" });
		const cpCall = ctx.execCalls.find(
			(c) => c.args[0] === "s3" && c.args[1] === "cp",
		);
		expect(cpCall).toBeDefined();
		expect(cpCall?.args).toContain(`s3://${LEGACY.bucket}/${LEGACY.key}`);
		expect(cpCall?.args).toContain(`s3://${NATIVE.bucket}/${NATIVE.key}`);
	});

	it("returns 'error' when s3 cp itself fails, surfacing stderr", async () => {
		const ctx = createMockContext({
			execHandler: execHandlerFor(
				{
					[`${NATIVE.bucket}/${NATIVE.key}`]: "missing",
					[`${LEGACY.bucket}/${LEGACY.key}`]: "found",
				},
				1,
				"AccessDenied: s3:PutObject on native bucket",
			),
		});

		const out = await copyLegacyToNative(ctx, {
			legacy: LEGACY,
			native: NATIVE,
		});

		expect(out.status).toBe("error");
		if (out.status === "error") {
			expect(out.errorMessage).toMatch(/AccessDenied/);
		}
	});

	it("re-probes the native key inside the function, not via the caller's stale probe", async () => {
		const ctx = createMockContext({
			execHandler: execHandlerFor({
				[`${NATIVE.bucket}/${NATIVE.key}`]: "found",
				[`${LEGACY.bucket}/${LEGACY.key}`]: "found",
			}),
		});

		await copyLegacyToNative(ctx, { legacy: LEGACY, native: NATIVE });

		const headCalls = ctx.execCalls.filter(
			(c) => c.args[0] === "s3api" && c.args[1] === "head-object",
		);
		const nativeHead = headCalls.find((c) =>
			c.args.some((a) => a === `--key=${NATIVE.key}`),
		);
		expect(nativeHead).toBeDefined();
	});

	it("returns 'error' when the native probe errors (credentials, permissions)", async () => {
		const ctx = createMockContext({
			execHandler: execHandlerFor({
				[`${NATIVE.bucket}/${NATIVE.key}`]: "error",
			}),
		});

		const out = await copyLegacyToNative(ctx, {
			legacy: LEGACY,
			native: NATIVE,
		});

		expect(out.status).toBe("error");
		if (out.status === "error") {
			expect(out.errorMessage).toMatch(/Access Denied/);
		}
	});

	it("short-circuits on native-exists without ever head-probing legacy", async () => {
		const ctx = createMockContext({
			execHandler: execHandlerFor({
				[`${NATIVE.bucket}/${NATIVE.key}`]: "found",
				[`${LEGACY.bucket}/${LEGACY.key}`]: "found",
			}),
		});

		await copyLegacyToNative(ctx, { legacy: LEGACY, native: NATIVE });

		const legacyHead = ctx.execCalls.filter(
			(c) =>
				c.args[0] === "s3api" &&
				c.args[1] === "head-object" &&
				c.args.some((a) => a === `--key=${LEGACY.key}`),
		);
		expect(legacyHead.length).toBe(0);
	});

	it("only issues one s3 cp call on the happy path (not retried internally)", async () => {
		const ctx = createMockContext({
			execHandler: execHandlerFor({
				[`${NATIVE.bucket}/${NATIVE.key}`]: "missing",
				[`${LEGACY.bucket}/${LEGACY.key}`]: "found",
			}),
		});

		await copyLegacyToNative(ctx, { legacy: LEGACY, native: NATIVE });

		const cpCalls = ctx.execCalls.filter(
			(c) => c.args[0] === "s3" && c.args[1] === "cp",
		);
		expect(cpCalls.length).toBe(1);
	});

	it("passes --profile to head-object and s3 cp calls when provided", async () => {
		const ctx = createMockContext({
			execHandler: execHandlerFor({
				[`${NATIVE.bucket}/${NATIVE.key}`]: "missing",
				[`${LEGACY.bucket}/${LEGACY.key}`]: "found",
			}),
		});

		await copyLegacyToNative(
			ctx,
			{ legacy: LEGACY, native: NATIVE },
			{ profile: "vnh" },
		);

		for (const call of ctx.execCalls) {
			expect(call.args).toContain("--profile");
			expect(call.args).toContain("vnh");
		}
	});
});
