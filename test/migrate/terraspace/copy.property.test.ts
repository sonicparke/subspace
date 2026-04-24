import { describe, expect, it } from "vitest";
import { createMockContext } from "../../helpers/mock-context.js";

/**
 * A2 validation: prove that the copy-then-verify pattern Subspace will
 * use for dual-read is deterministic under a well-behaved CopyObject
 * (strong read-after-write consistency, single atomic server-side
 * operation for objects ≤ 5 GB).
 *
 * This is a property test over 1000 iterations. It does not hit real
 * S3 — the mock here stands in for AWS's documented CopyObject
 * semantics. Real-S3 validation lives in the design doc's citation of
 * the AWS consistency model (post-Dec 2020).
 *
 * The test fails if, under a mocked-atomic CopyObject, the pattern we
 * plan to use in I1 (`aws s3 cp` via `ctx.exec`, followed by
 * `aws s3api head-object` to verify) could produce drift.
 *
 * See scripts/migrate-validation/probe-all.sh for the A1 real-world
 * complement to this property.
 */

type MockS3 = {
	objects: Map<string, string>;
	copyCount: number;
	headCount: number;
};

function mockS3(): MockS3 {
	return { objects: new Map(), headCount: 0, copyCount: 0 };
}

function simulateAtomicAwsCli(s3: MockS3) {
	return (cmd: string, args: string[]) => {
		if (cmd !== "aws") {
			return { stdout: "", stderr: "unexpected command", exitCode: 2 };
		}

		if (args[0] === "s3" && args[1] === "cp") {
			const src = args[2];
			const dst = args[3];
			if (!src || !dst) {
				return { stdout: "", stderr: "usage", exitCode: 2 };
			}
			const srcKey = src.replace(/^s3:\/\//, "");
			const dstKey = dst.replace(/^s3:\/\//, "");
			const payload = s3.objects.get(srcKey);
			if (payload === undefined) {
				return {
					stdout: "",
					stderr: "NoSuchKey",
					exitCode: 1,
				};
			}
			s3.objects.set(dstKey, payload);
			s3.copyCount += 1;
			return { stdout: "", stderr: "", exitCode: 0 };
		}

		if (args[0] === "s3api" && args[1] === "head-object") {
			s3.headCount += 1;
			const bucketFlag = args.find((a) => a.startsWith("--bucket=")) ?? "";
			const keyFlag = args.find((a) => a.startsWith("--key=")) ?? "";
			const bucket = bucketFlag.slice("--bucket=".length);
			const key = keyFlag.slice("--key=".length);
			const full = `${bucket}/${key}`;
			if (s3.objects.has(full)) {
				return {
					stdout: JSON.stringify({ ContentLength: s3.objects.get(full)?.length }),
					stderr: "",
					exitCode: 0,
				};
			}
			return { stdout: "", stderr: "Not Found", exitCode: 255 };
		}

		return { stdout: "", stderr: "", exitCode: 0 };
	};
}

/**
 * Inline copy-then-verify primitive matching the shape I1 will export.
 * Kept local so this test exercises the pattern without depending on
 * I1 being implemented yet.
 */
async function copyAndVerify(
	ctx: ReturnType<typeof createMockContext>,
	legacy: { bucket: string; key: string },
	native: { bucket: string; key: string },
): Promise<"ok" | "copy-failed" | "verify-missing"> {
	const cpResult = await ctx.exec("aws", [
		"s3",
		"cp",
		`s3://${legacy.bucket}/${legacy.key}`,
		`s3://${native.bucket}/${native.key}`,
	]);
	if (cpResult.exitCode !== 0) return "copy-failed";

	const headResult = await ctx.exec("aws", [
		"s3api",
		"head-object",
		`--bucket=${native.bucket}`,
		`--key=${native.key}`,
		"--output=json",
	]);
	if (headResult.exitCode !== 0) return "verify-missing";
	return "ok";
}

describe("A2: S3 CopyObject atomicity property", () => {
	it("copy-then-verify yields ok 1000 times against a fresh atomic S3 model", async () => {
		const s3 = mockS3();
		const ctx = createMockContext({ execHandler: simulateAtomicAwsCli(s3) });

		let ok = 0;
		let failed = 0;

		for (let i = 0; i < 1000; i++) {
			s3.objects.clear();
			s3.objects.set(
				"legacy-bucket/main/us-east-1/prod/stacks/network/terraform.tfstate",
				`tfstate-version-${i}-${"x".repeat(128)}`,
			);

			const outcome = await copyAndVerify(
				ctx,
				{
					bucket: "legacy-bucket",
					key: "main/us-east-1/prod/stacks/network/terraform.tfstate",
				},
				{
					bucket: "subspace-aws-state",
					key: `subspace/aws/us-east-1/prod/network/subspace.tfstate`,
				},
			);

			if (outcome === "ok") ok += 1;
			else failed += 1;
		}

		expect(ok).toBe(1000);
		expect(failed).toBe(0);
		expect(s3.copyCount).toBe(1000);
		expect(s3.headCount).toBe(1000);
	});

	it("copied bytes equal source bytes on every iteration (no drift)", async () => {
		const s3 = mockS3();
		const ctx = createMockContext({ execHandler: simulateAtomicAwsCli(s3) });

		for (let i = 0; i < 1000; i++) {
			s3.objects.clear();
			const payload = `state-i=${i}-${"A".repeat(200)}-${"B".repeat(200)}`;
			s3.objects.set("legacy-bucket/legacy-key", payload);

			await copyAndVerify(
				ctx,
				{ bucket: "legacy-bucket", key: "legacy-key" },
				{ bucket: "native-bucket", key: "native-key" },
			);

			const srcBytes = s3.objects.get("legacy-bucket/legacy-key");
			const dstBytes = s3.objects.get("native-bucket/native-key");

			expect(dstBytes).toBe(srcBytes);
		}
	});

	it("returns copy-failed when legacy object does not exist (NoSuchKey is not swallowed)", async () => {
		const s3 = mockS3();
		const ctx = createMockContext({ execHandler: simulateAtomicAwsCli(s3) });

		const outcome = await copyAndVerify(
			ctx,
			{ bucket: "legacy-bucket", key: "missing-key" },
			{ bucket: "native-bucket", key: "native-key" },
		);

		expect(outcome).toBe("copy-failed");
		expect(s3.copyCount).toBe(0);
	});

	it("head-object after successful cp never reports the native key as missing", async () => {
		const s3 = mockS3();
		const ctx = createMockContext({ execHandler: simulateAtomicAwsCli(s3) });
		s3.objects.set("legacy-bucket/legacy-key", "payload");

		for (let i = 0; i < 1000; i++) {
			const outcome = await copyAndVerify(
				ctx,
				{ bucket: "legacy-bucket", key: "legacy-key" },
				{ bucket: "native-bucket", key: `native-${i}` },
			);
			expect(outcome).toBe("ok");
		}
	});
});
