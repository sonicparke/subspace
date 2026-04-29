import { describe, expect, it } from "vitest";
import { parseResolvedArgv } from "../../src/cli/runtime.js";

describe("parseResolvedArgv() — doctor", () => {
	it("parses bare `doctor` with legacy=false", () => {
		const parsed = parseResolvedArgv(["doctor"]);
		expect(parsed).toEqual({ command: "doctor", legacy: false });
	});

	it("parses `doctor --legacy`", () => {
		const parsed = parseResolvedArgv(["doctor", "--legacy"]);
		expect(parsed).toEqual({ command: "doctor", legacy: true });
	});
});

describe("parseResolvedArgv() — migrate init", () => {
	it("parses `migrate init <path>`", () => {
		const parsed = parseResolvedArgv(["migrate", "init", "./legacy"]);
		expect(parsed).toEqual({
			command: "migrate",
			subcommand: "init",
			legacyPath: "./legacy",
			out: undefined,
			regions: undefined,
			appName: undefined,
			role: undefined,
			profile: undefined,
			force: false,
			dryRun: false,
		});
	});

	it("parses bare `migrate init` with no path", () => {
		const parsed = parseResolvedArgv(["migrate", "init"]);
		expect(parsed).toMatchObject({
			command: "migrate",
			subcommand: "init",
			legacyPath: undefined,
		});
	});

	it("parses `migrate init --dry-run` (no path, flag only)", () => {
		const parsed = parseResolvedArgv(["migrate", "init", "--dry-run"]);
		expect(parsed).toMatchObject({
			subcommand: "init",
			legacyPath: undefined,
			dryRun: true,
		});
	});

	it("parses `migrate init <path> --dry-run`", () => {
		const parsed = parseResolvedArgv([
			"migrate",
			"init",
			"./legacy",
			"--dry-run",
		]);
		expect(parsed).toMatchObject({
			subcommand: "init",
			legacyPath: "./legacy",
			dryRun: true,
		});
	});

	it("parses `migrate init <path> --out <dir>`", () => {
		const parsed = parseResolvedArgv([
			"migrate",
			"init",
			"./legacy",
			"--out",
			"newproj",
		]);
		expect(parsed).toMatchObject({
			subcommand: "init",
			legacyPath: "./legacy",
			out: "newproj",
		});
	});

	it("parses `migrate init <path> --regions us-east-1,us-west-2`", () => {
		const parsed = parseResolvedArgv([
			"migrate",
			"init",
			"./legacy",
			"--regions",
			"us-east-1,us-west-2",
		]);
		expect(parsed).toMatchObject({
			subcommand: "init",
			regions: ["us-east-1", "us-west-2"],
		});
	});

	it("parses `migrate init <path> --app-name <name>`", () => {
		const parsed = parseResolvedArgv([
			"migrate",
			"init",
			"./legacy",
			"--app-name",
			"my-app",
		]);
		expect(parsed).toMatchObject({
			subcommand: "init",
			appName: "my-app",
		});
	});

	it("parses `--force` for init", () => {
		const parsed = parseResolvedArgv([
			"migrate",
			"init",
			"./legacy",
			"--force",
		]);
		expect(parsed).toMatchObject({ subcommand: "init", force: true });
	});

	it("parses `--role` for init", () => {
		const parsed = parseResolvedArgv([
			"migrate",
			"init",
			"./legacy",
			"--role",
			"cost",
		]);
		expect(parsed).toMatchObject({ subcommand: "init", role: "cost" });
	});
});

describe("parseResolvedArgv() — migrate <stack> [env]", () => {
	it("parses `migrate <stack>` (no env)", () => {
		const parsed = parseResolvedArgv(["migrate", "network"]);
		expect(parsed).toEqual({
			command: "migrate",
			subcommand: "stack",
			stack: "network",
			env: undefined,
			role: undefined,
			app: undefined,
			instance: undefined,
			name: undefined,
			profile: undefined,
			dryRun: false,
			reportFile: undefined,
			regions: undefined,
		});
	});

	it("parses `migrate <stack> <env>`", () => {
		const parsed = parseResolvedArgv(["migrate", "network", "prod"]);
		expect(parsed).toMatchObject({
			subcommand: "stack",
			stack: "network",
			env: "prod",
		});
	});

	it("parses `migrate <stack> <env> --dry-run`", () => {
		const parsed = parseResolvedArgv([
			"migrate",
			"network",
			"prod",
			"--dry-run",
		]);
		expect(parsed).toMatchObject({
			subcommand: "stack",
			stack: "network",
			env: "prod",
			dryRun: true,
		});
	});

	it("parses `--report-file <path>`", () => {
		const parsed = parseResolvedArgv([
			"migrate",
			"network",
			"prod",
			"--dry-run",
			"--report-file",
			"report.md",
		]);
		expect(parsed).toMatchObject({ reportFile: "report.md" });
	});

	it("parses `--report-file=<path>` (equals form)", () => {
		const parsed = parseResolvedArgv([
			"migrate",
			"network",
			"prod",
			"--report-file=out.md",
		]);
		expect(parsed).toMatchObject({ reportFile: "out.md" });
	});

	it("parses `--regions us-east-1,us-west-2`", () => {
		const parsed = parseResolvedArgv([
			"migrate",
			"network",
			"prod",
			"--regions",
			"us-east-1,us-west-2",
		]);
		expect(parsed).toMatchObject({ regions: ["us-east-1", "us-west-2"] });
	});

	it("parses `--role` for legacy key :ROLE (Terraspace TS_ROLE)", () => {
		const parsed = parseResolvedArgv([
			"migrate",
			"key-pair",
			"k6-lnp",
			"--dry-run",
			"--role",
			"cost",
		]);
		expect(parsed).toMatchObject({
			subcommand: "stack",
			stack: "key-pair",
			env: "k6-lnp",
			role: "cost",
		});
	});

	it("parses `--profile` for AWS CLI calls", () => {
		const parsed = parseResolvedArgv([
			"migrate",
			"cost-engine-ecs",
			"--profile",
			"vnh",
		]);
		expect(parsed).toMatchObject({
			subcommand: "stack",
			stack: "cost-engine-ecs",
			profile: "vnh",
		});
	});

	it("parses `--profile=<name>` for AWS CLI calls", () => {
		const parsed = parseResolvedArgv([
			"migrate",
			"cost-engine-ecs",
			"--profile=vnh",
		]);
		expect(parsed).toMatchObject({
			subcommand: "stack",
			stack: "cost-engine-ecs",
			profile: "vnh",
		});
	});

	it("parses `--instance` for Terraspace stack instances", () => {
		const parsed = parseResolvedArgv([
			"migrate",
			"cost-engine-ecs",
			"qa",
			"--app",
			"costengine",
			"--instance",
			"costengine",
		]);
		expect(parsed).toMatchObject({
			subcommand: "stack",
			stack: "cost-engine-ecs",
			env: "qa",
			app: "costengine",
			instance: "costengine",
		});
	});

	it("parses `--name` for native state identity", () => {
		const parsed = parseResolvedArgv([
			"migrate",
			"key-pair",
			"--name",
			"vnh",
		]);
		expect(parsed).toMatchObject({
			subcommand: "stack",
			stack: "key-pair",
			name: "vnh",
		});
	});

	it("parses `--name=<value>` for native state identity", () => {
		const parsed = parseResolvedArgv([
			"migrate",
			"key-pair",
			"--name=vnh",
		]);
		expect(parsed).toMatchObject({
			subcommand: "stack",
			stack: "key-pair",
			name: "vnh",
		});
	});

	it("does not mistake `init`-as-stack-name for the init subcommand", () => {
		// Edge case: `init` is reserved as a subcommand. Users cannot have a
		// stack literally called `init`. This is an acceptable trade-off.
		const parsed = parseResolvedArgv(["migrate", "init"]);
		expect(parsed).toMatchObject({ subcommand: "init", legacyPath: undefined });
	});
});
