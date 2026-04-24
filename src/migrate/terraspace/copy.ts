import type { SubspaceContext } from "../../context.js";
import { headObject } from "./probe.js";

/**
 * One-shot legacy -> native state copy primitive for Subspace's
 * Terraspace migration path. See
 * `docs/ideas/subspace-terraspace-migration.md` for design.
 *
 * Guarantees:
 *   - Never overwrites an existing native object. A fresh `head-object`
 *     is issued immediately before the copy, inside this function, and
 *     a FOUND result short-circuits with `native-exists`. Callers
 *     CANNOT bypass this guard by passing a stale probe.
 *   - No-op-returns (`native-exists`, `legacy-missing`) are
 *     success-shaped: the calling engine path should proceed with
 *     normal `init`.
 *   - Surface-level errors (transient AWS failures, credentials, etc.)
 *     come back as `{ status: "error" }` with the stderr text, so
 *     callers can log and decide whether to bail.
 */

export type CopyObjectRef = {
	bucket: string;
	key: string;
};

export type CopyLegacyToNativeInput = {
	legacy: CopyObjectRef;
	native: CopyObjectRef;
};

export type CopyLegacyToNativeResult =
	| { status: "same-location" }
	| { status: "copied" }
	| { status: "native-exists" }
	| { status: "legacy-missing" }
	| { status: "error"; errorMessage: string };

export async function copyLegacyToNative(
	ctx: SubspaceContext,
	{ legacy, native }: CopyLegacyToNativeInput,
): Promise<CopyLegacyToNativeResult> {
	if (legacy.bucket === native.bucket && legacy.key === native.key) {
		return { status: "same-location" };
	}

	const nativeProbe = await headObject(ctx, native.bucket, native.key);
	if (nativeProbe.status === "found") {
		return { status: "native-exists" };
	}
	if (nativeProbe.status === "error") {
		return {
			status: "error",
			errorMessage:
				nativeProbe.errorMessage ??
				"unknown error probing native state object",
		};
	}

	const legacyProbe = await headObject(ctx, legacy.bucket, legacy.key);
	if (legacyProbe.status === "missing") {
		return { status: "legacy-missing" };
	}
	if (legacyProbe.status === "error") {
		return {
			status: "error",
			errorMessage:
				legacyProbe.errorMessage ??
				"unknown error probing legacy state object",
		};
	}

	const cp = await ctx.exec("aws", [
		"s3",
		"cp",
		`s3://${legacy.bucket}/${legacy.key}`,
		`s3://${native.bucket}/${native.key}`,
	]);
	if (cp.exitCode !== 0) {
		return {
			status: "error",
			errorMessage: cp.stderr.trim() || `aws s3 cp exited ${cp.exitCode}`,
		};
	}

	return { status: "copied" };
}
