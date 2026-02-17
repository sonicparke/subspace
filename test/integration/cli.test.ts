import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TSX = join(PROJECT_ROOT, "node_modules/.bin/tsx");
const CLI = join(PROJECT_ROOT, "src/cli.ts");

const run = async (args: string, opts: { cwd: string }) => {
	const argv = args.split(/\s+/).filter(Boolean);
	try {
		const { stdout, stderr } = await execFileAsync(
			TSX,
			[CLI, ...argv],
			{ cwd: opts.cwd, env: { ...process.env, SUBSPACE_ENGINE: "tofu" } },
		);
		return { stdout, stderr, exitCode: 0 };
	} catch (err: unknown) {
		const e = err as { stdout: string; stderr: string; code: number };
		return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: e.code ?? 1 };
	}
};

describe("CLI integration", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "subspace-test-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("--version prints dev version", async () => {
		const result = await run("--version", { cwd: tmpDir });
		expect(result.stdout.trim()).toBe("0.0.0-dev");
	});

	it("--help shows all commands", async () => {
		const result = await run("--help", { cwd: tmpDir });
		expect(result.stdout).toContain("doctor");
		expect(result.stdout).toContain("plan");
		expect(result.stdout).toContain("apply");
		expect(result.stdout).toContain("destroy");
	});

	it("doctor runs successfully", async () => {
		const result = await run("doctor", { cwd: tmpDir });
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Subspace Doctor");
		expect(result.stdout).toContain("Active engine:");
	});

	it("plan errors for missing stack", async () => {
		const result = await run("plan nonexistent", { cwd: tmpDir });
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain('stack "nonexistent" not found');
	});

	it("plan materializes build directory", async () => {
		// Create a minimal stack
		const stackDir = join(tmpDir, "app/stacks/teststack");
		await mkdir(stackDir, { recursive: true });
		await writeFile(
			join(stackDir, "main.tf"),
			'resource "null_resource" "test" {}',
		);

		const tfvarsDir = join(stackDir, "tfvars");
		await mkdir(tfvarsDir, { recursive: true });
		await writeFile(join(tfvarsDir, "base.tfvars"), "# base\n");

		await run("plan teststack", { cwd: tmpDir });

		// Check build dir was created
		const buildDir = join(tmpDir, ".subspace/build/teststack/__noenv__");
		const entries = await readdir(buildDir);
		expect(entries).toContain("main.tf");
		expect(entries).toContain("00-base.auto.tfvars");
		// tfvars/ should NOT be copied
		expect(entries).not.toContain("tfvars");
	});

	it("plan with env creates correct build path", async () => {
		const stackDir = join(tmpDir, "app/stacks/mystack");
		await mkdir(stackDir, { recursive: true });
		await writeFile(join(stackDir, "main.tf"), "# empty");

		const tfvarsDir = join(stackDir, "tfvars");
		await mkdir(tfvarsDir, { recursive: true });
		await writeFile(join(tfvarsDir, "base.tfvars"), "base = true\n");
		await writeFile(join(tfvarsDir, "prod.tfvars"), "env = true\n");

		await run("plan mystack prod", { cwd: tmpDir });

		const buildDir = join(tmpDir, ".subspace/build/mystack/prod");
		const entries = await readdir(buildDir);
		expect(entries).toContain("main.tf");
		expect(entries).toContain("00-base.auto.tfvars");
		expect(entries).toContain("10-env.auto.tfvars");

		const envVars = await readFile(join(buildDir, "10-env.auto.tfvars"), "utf-8");
		expect(envVars).toBe("env = true\n");
	});

	it("apply command works (via alias)", async () => {
		const stackDir = join(tmpDir, "app/stacks/mystack");
		await mkdir(stackDir, { recursive: true });
		await writeFile(
			join(stackDir, "main.tf"),
			'resource "null_resource" "test" {}',
		);

		const result = await run("apply mystack -- -auto-approve", { cwd: tmpDir });
		// Should succeed (init + apply with null resource)
		expect(result.exitCode).toBe(0);
	});

	it("doctor lists stacks and checks base.tfvars", async () => {
		const stack1 = join(tmpDir, "app/stacks/network/tfvars");
		const stack2 = join(tmpDir, "app/stacks/compute");
		await mkdir(stack1, { recursive: true });
		await mkdir(stack2, { recursive: true });
		await writeFile(join(tmpDir, "app/stacks/network/main.tf"), "");
		await writeFile(join(stack1, "base.tfvars"), "");
		await writeFile(join(stack2, "main.tf"), "");

		const result = await run("doctor", { cwd: tmpDir });
		expect(result.stdout).toContain("network");
		expect(result.stdout).toContain("compute");
		// network has base.tfvars so should be ok, compute is missing it
		expect(result.stdout).toMatch(/\[ok\].*network/);
		expect(result.stdout).toMatch(/\[warn\].*compute/);
	});

	it("--engine flag overrides detection", async () => {
		const result = await run("--engine nonexistent plan mystack", { cwd: tmpDir });
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain("not found");
	});
});
