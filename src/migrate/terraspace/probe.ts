import type { SubspaceContext } from "../../context.js";
import type { MigrationPlan, MigrationPlanEntry } from "./plan.js";

export type ProbeStatus = "found" | "missing" | "error";

export interface ProbeOutcome {
	status: ProbeStatus;
	errorMessage?: string;
}

export interface ProbeResult {
	entry: MigrationPlanEntry;
	legacy: ProbeOutcome;
	native: ProbeOutcome;
}

export interface ProbeReport {
	results: ProbeResult[];
}

export async function probeStateObjects(
	ctx: SubspaceContext,
	plan: MigrationPlan,
): Promise<ProbeReport> {
	const results: ProbeResult[] = [];
	for (const entry of plan.entries) {
		const [legacy, native] = await Promise.all([
			headObject(ctx, entry.legacy.bucket, entry.legacy.key),
			headObject(ctx, entry.native.bucket, entry.native.key),
		]);
		results.push({ entry, legacy, native });
	}
	return { results };
}

export async function headObject(
	ctx: SubspaceContext,
	bucket: string,
	key: string,
): Promise<ProbeOutcome> {
	const result = await ctx.exec("aws", [
		"s3api",
		"head-object",
		`--bucket=${bucket}`,
		`--key=${key}`,
		"--output=json",
	]);
	if (result.exitCode === 0) return { status: "found" };
	if (isNotFound(result.stderr)) return { status: "missing" };
	return { status: "error", errorMessage: result.stderr.trim() };
}

function isNotFound(stderr: string): boolean {
	return /\b404\b|\bNot Found\b|\bNoSuchKey\b/i.test(stderr);
}
