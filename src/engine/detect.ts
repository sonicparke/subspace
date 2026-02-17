import type { SubspaceContext } from "../context.js";

type ExecFn = SubspaceContext["exec"];
type EnvMap = SubspaceContext["env"];

/**
 * Resolve which engine binary to use.
 * Priority: --engine flag > SUBSPACE_ENGINE env var > auto-detect (tofu > terraform).
 */
export async function detectEngine(
	exec: ExecFn,
	env: EnvMap,
	engineFlag: string | undefined,
): Promise<string> {
	if (engineFlag) {
		await assertEngineExists(exec, engineFlag);
		return engineFlag;
	}

	const envEngine = env.SUBSPACE_ENGINE;
	if (envEngine) {
		await assertEngineExists(exec, envEngine);
		return envEngine;
	}

	// Auto-detect: prefer tofu, fall back to terraform
	if (await isOnPath(exec, "tofu")) return "tofu";
	if (await isOnPath(exec, "terraform")) return "terraform";

	throw new Error(
		"No engine found. Install OpenTofu (tofu) or Terraform, or specify --engine.",
	);
}

async function isOnPath(exec: ExecFn, name: string): Promise<boolean> {
	const { exitCode } = await exec("which", [name]);
	return exitCode === 0;
}

async function assertEngineExists(exec: ExecFn, name: string): Promise<void> {
	if (!(await isOnPath(exec, name))) {
		throw new Error(`Engine "${name}" not found on $PATH.`);
	}
}
