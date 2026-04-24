import type { SubspaceContext } from "../../context.js";

export type DetectionResult =
	| { kind: "terraspace"; root: string; reasons: string[] }
	| { kind: "unknown"; missing: string[] };

const REQUIRED_MARKERS = ["config/app.rb"] as const;
const OPTIONAL_MARKERS = ["config/terraform/backend.tf"] as const;

export async function detectTerraspaceProject(
	ctx: SubspaceContext,
	dir: string,
): Promise<DetectionResult> {
	const reasons: string[] = [];
	const missing: string[] = [];

	for (const marker of REQUIRED_MARKERS) {
		const path = `${dir}/${marker}`;
		if (await ctx.fs.exists(path)) {
			reasons.push(marker);
		} else {
			missing.push(marker);
		}
	}

	if (missing.length > 0) {
		return { kind: "unknown", missing };
	}

	for (const marker of OPTIONAL_MARKERS) {
		const path = `${dir}/${marker}`;
		if (await ctx.fs.exists(path)) {
			reasons.push(marker);
		}
	}

	return { kind: "terraspace", root: dir, reasons };
}
