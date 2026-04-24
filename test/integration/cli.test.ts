import { execFile as execFileCb } from "node:child_process";
import {
	chmod,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFileCb);

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const CLI = join(PROJECT_ROOT, "src/cli.ts");
const FAKE_BIN_DIR = ".subspace-test-bin";
const FAKE_TOFU = "tofu";
const ENGINE_LOG = ".subspace-engine.log";
const FAKE_TOFU_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
if [[ -n "\${SUBSPACE_TEST_ENGINE_LOG:-}" ]]; then
  printf '%s\n' "$*" >> "\${SUBSPACE_TEST_ENGINE_LOG}"
fi
if [[ "\${1:-}" == "--version" ]]; then
  echo "OpenTofu v0.0.0-test"
  exit 0
fi
exit 0
`;

const ensureFakeTofu = async (cwd: string) => {
	const binDir = join(cwd, FAKE_BIN_DIR);
	await mkdir(binDir, { recursive: true });
	const tofuPath = join(binDir, FAKE_TOFU);
	await writeFile(tofuPath, FAKE_TOFU_SCRIPT, "utf-8");
	await chmod(tofuPath, 0o755);
	return binDir;
};

const run = async (args: string, opts: { cwd: string }) => {
	const fakeBin = await ensureFakeTofu(opts.cwd);
	const argv = args.split(/\s+/).filter(Boolean);
	const engineLog = join(opts.cwd, ENGINE_LOG);
	try {
		const { stdout, stderr } = await execFileAsync("bun", [CLI, ...argv], {
			cwd: opts.cwd,
			env: {
				...process.env,
				SUBSPACE_ENGINE: "tofu",
				SUBSPACE_TEST_ENGINE_LOG: engineLog,
				PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
			},
		});
		return { stdout, stderr, exitCode: 0 };
	} catch (err: unknown) {
		const e = err as { stdout: string; stderr: string; code: number };
		return {
			stdout: e.stdout ?? "",
			stderr: e.stderr ?? "",
			exitCode: e.code ?? 1,
		};
	}
};

const normalizeBucketPart = (value: string): string =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "");

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
		expect(result.stdout).toContain("new");
	});

	it("new project creates scaffold", async () => {
		const result = await run("new project demo", { cwd: tmpDir });
		expect(result.exitCode).toBe(0);

		const projectDirEntries = await readdir(join(tmpDir, "demo"));
		expect(projectDirEntries).toContain("app");
		expect(projectDirEntries).toContain("config");
		expect(projectDirEntries).toContain("README.md");
	});

	it("new module and stack create scaffolds in a project", async () => {
		await run("new project demo", { cwd: tmpDir });

		const projectDir = join(tmpDir, "demo");
		const moduleResult = await run("new module vpc", { cwd: projectDir });
		const stackResult = await run("new stack network", { cwd: projectDir });
		expect(moduleResult.exitCode).toBe(0);
		expect(stackResult.exitCode).toBe(0);

		const moduleMain = await readFile(
			join(projectDir, "app/modules/vpc/main.tf"),
			"utf-8",
		);
		const stackBase = await readFile(
			join(projectDir, "app/stacks/network/tfvars/base.tfvars"),
			"utf-8",
		);
		const stackProviders = await readFile(
			join(projectDir, "app/stacks/network/providers.tf"),
			"utf-8",
		);
		expect(moduleMain).toContain("Module resources");
		expect(stackBase).toContain("Base vars");
		expect(stackProviders).toContain('required_version = ">= 1.6.0"');
	});

	it("new project with backend and region writes region-specific templates", async () => {
		const result = await run("new project demo s3 us-west-2", { cwd: tmpDir });
		expect(result.exitCode).toBe(0);
		const stackResult = await run("new stack network", {
			cwd: join(tmpDir, "demo"),
		});
		expect(stackResult.exitCode).toBe(0);

		const backendTf = await readFile(
			join(tmpDir, "demo/config/terraform/backend.tf"),
			"utf-8",
		);
		const providerTf = await readFile(
			join(tmpDir, "demo/app/stacks/network/providers.tf"),
			"utf-8",
		);
		expect(backendTf).toContain('backend "s3"');
		expect(backendTf).toContain('region = "us-west-2"');
		expect(providerTf).toContain('provider "aws"');
		expect(providerTf).toContain('region = "us-west-2"');
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

		const buildDir = join(
			tmpDir,
			".subspace/build/teststack/global/__noenv__/stacks/teststack",
		);
		const entries = await readdir(buildDir);
		expect(entries).toContain("main.tf");
		expect(entries).toContain("00-base.auto.tfvars");
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

		const buildDir = join(
			tmpDir,
			".subspace/build/mystack/global/prod/stacks/mystack",
		);
		const entries = await readdir(buildDir);
		expect(entries).toContain("main.tf");
		expect(entries).toContain("00-base.auto.tfvars");
		expect(entries).toContain("10-env.auto.tfvars");

		const envVars = await readFile(
			join(buildDir, "10-env.auto.tfvars"),
			"utf-8",
		);
		expect(envVars).toBe("env = true\n");
	});

	it("plan accepts oscli flags for stack and env", async () => {
		const stackDir = join(tmpDir, "app/stacks/flagstack");
		await mkdir(stackDir, { recursive: true });
		await writeFile(join(stackDir, "main.tf"), "# empty");

		const tfvarsDir = join(stackDir, "tfvars");
		await mkdir(tfvarsDir, { recursive: true });
		await writeFile(join(tfvarsDir, "base.tfvars"), "base = true\n");
		await writeFile(join(tfvarsDir, "prod.tfvars"), "env = true\n");

		const result = await run("plan --stack flagstack --env prod", { cwd: tmpDir });
		expect(result.exitCode).toBe(0);

		const buildDir = join(
			tmpDir,
			".subspace/build/flagstack/global/prod/stacks/flagstack",
		);
		const entries = await readdir(buildDir);
		expect(entries).toContain("main.tf");
		expect(entries).toContain("10-env.auto.tfvars");
	});

	it("plan injects derived backend bucket and key path", async () => {
		const stackDir = join(tmpDir, "app/stacks/mystack");
		await mkdir(stackDir, { recursive: true });
		await writeFile(join(stackDir, "main.tf"), "# empty");
		await writeFile(
			join(stackDir, "backend.tf"),
			`terraform {
  backend "s3" {
    bucket = "placeholder"
    region = "us-east-1"
  }
}
`,
		);

		const tfvarsDir = join(stackDir, "tfvars");
		await mkdir(tfvarsDir, { recursive: true });
		await writeFile(join(tfvarsDir, "base.tfvars"), "base = true\n");

		const result = await run("plan mystack prod", { cwd: tmpDir });
		expect(result.exitCode).toBe(0);

		const logContent = await readFile(join(tmpDir, ENGINE_LOG), "utf-8");
		const normalizedApp = normalizeBucketPart(basename(tmpDir));
		expect(logContent).toContain(
			`-backend-config=bucket=${normalizedApp}-subspace-aws-state`,
		);
		expect(logContent).toContain(
			"-backend-config=key=subspace/aws/global/prod/mystack/subspace.tfstate",
		);
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
		const result = await run("--engine nonexistent plan mystack", {
			cwd: tmpDir,
		});
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain("Unsupported engine");
	});
});
