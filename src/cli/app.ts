import { createCLI } from "@oscli-dev/oscli";
import { runApply } from "../commands/apply.js";
import { runDestroy } from "../commands/destroy.js";
import { runDoctor } from "../commands/doctor.js";
import { runNew } from "../commands/new.js";
import { runPlan } from "../commands/plan.js";
import type { BackendType } from "../domain/backends.js";
import {
	recommendedProviderForBackend,
	type ProviderType,
} from "../domain/providers.js";
import {
	assertNewCommand,
	assertWorkflowCommand,
	type CliRuntime,
	type ParsedArgv,
} from "./runtime.js";

type SubspaceCli = ReturnType<typeof buildCli>;
type WorkflowInput = { stack: string; env?: string };
type NewGenerator = "project" | "module" | "stack";

const GENERATOR_OPTIONS = ["project", "module", "stack"] as const;
const BACKEND_OPTIONS = ["local", "s3", "gcs", "azurerm"] as const;
const PROVIDER_OPTIONS_AWS = ["aws", "azure", "gcp", "cloudflare"] as const;
const PROVIDER_OPTIONS_AZURE = ["azure", "aws", "gcp", "cloudflare"] as const;
const PROVIDER_OPTIONS_GCP = ["gcp", "aws", "azure", "cloudflare"] as const;
const VALID_NAME = /^[A-Za-z0-9_-]+$/;
const VALID_REGION = /^[A-Za-z0-9-]+$/;

export function createSubspaceCli(runtime: CliRuntime) {
	const cli = buildCli();

	cli.command("doctor", async () => {
		await exitOnFailure(runDoctor(runtime.ctx));
	});

	registerWorkflowCommand(cli, runtime, "plan", runPlan);
	registerWorkflowCommand(cli, runtime, "apply", runApply);
	registerWorkflowCommand(cli, runtime, "destroy", runDestroy);

	cli.command("new [generator] [name] [arg3] [arg4] [arg5]", async () => {
		assertNewCommand(runtime.parsed);
		const normalized = await resolveNewInput(cli, runtime.parsed);
		await exitOnFailure(runNew(runtime.ctx, normalized));
	});

	return cli;
}

function buildCli() {
	return createCLI((b) => ({
		description: "Terraspace-style CLI for OpenTofu and Terraform.",
		autocompleteHint: "Run `subspace --help` to see available commands.",
		flags: {
			stack: b.flag().string().label("Stack").optional(),
			env: b.flag().string().label("Environment").optional(),
			generator: b.flag().string().label("Generator").optional(),
			name: b.flag().string().label("Name").optional(),
			backend: b.flag().string().label("Backend").optional(),
			provider: b.flag().string().label("Provider").optional(),
			region: b.flag().string().label("Region").optional(),
		},
		prompts: {
			generator: b
				.select({ choices: GENERATOR_OPTIONS })
				.label("Generator")
				.default("project"),
			name: b
				.text()
				.label("Name")
				.validate((value) =>
					VALID_NAME.test(value)
						? true
						: "Use letters, numbers, hyphens, or underscores.",
				),
			backend: b
				.select({ choices: BACKEND_OPTIONS })
				.label("Backend")
				.default("local"),
			projectProviderAws: b
				.select({ choices: PROVIDER_OPTIONS_AWS })
				.label("Default provider")
				.default("aws"),
			projectProviderAzure: b
				.select({ choices: PROVIDER_OPTIONS_AZURE })
				.label("Default provider")
				.default("azure"),
			projectProviderGcp: b
				.select({ choices: PROVIDER_OPTIONS_GCP })
				.label("Default provider")
				.default("gcp"),
			stackProvider: b
				.select({ choices: PROVIDER_OPTIONS_AWS })
				.label("Provider")
				.default("aws"),
			projectRegionAws: b
				.text()
				.label("Region")
				.default("us-east-1")
				.validate((value) =>
					VALID_REGION.test(value) ? true : "Use letters, numbers, and hyphens.",
				),
			projectRegionGcp: b
				.text()
				.label("Region")
				.default("us-central1")
				.validate((value) =>
					VALID_REGION.test(value) ? true : "Use letters, numbers, and hyphens.",
				),
			stackRegionAws: b
				.text()
				.label("Region")
				.default("us-east-1")
				.validate((value) =>
					VALID_REGION.test(value) ? true : "Use letters, numbers, and hyphens.",
				),
			stackRegionGcp: b
				.text()
				.label("Region")
				.default("us-central1")
				.validate((value) =>
					VALID_REGION.test(value) ? true : "Use letters, numbers, and hyphens.",
				),
		},
	}));
}

function registerWorkflowCommand(
	cli: SubspaceCli,
	runtime: CliRuntime,
	command: "plan" | "apply" | "destroy",
	handler: (
		ctx: CliRuntime["ctx"],
		input: WorkflowInput,
	) => Promise<number>,
): void {
	cli.command(`${command} [stack] [env]`, async () => {
		assertWorkflowCommand(runtime.parsed, command);
		const stack = cli.flags.stack ?? runtime.parsed.stack;
		const env = cli.flags.env ?? runtime.parsed.env;
		if (!stack) {
			cli.exit(`Missing required stack for "${command}".`, {
				code: "usage",
				hint: `Use \`subspace ${command} <stack>\` or pass \`--stack <name>\`.`,
			});
		}
		await exitOnFailure(
			handler(runtime.ctx, {
				stack,
				env,
			}),
		);
	});
}

async function exitOnFailure(result: Promise<number>): Promise<void> {
	const code = await result;
	if (code !== 0) process.exit(code);
}

async function resolveNewInput(
	cli: SubspaceCli,
	parsed: Exclude<Extract<ParsedArgv, { command: "new" }>, undefined>,
): Promise<
	| {
			generator: "project";
			name: string;
			backend?: string;
			provider?: string;
			region?: string;
	  }
	| {
			generator: "module" | "stack";
			name: string;
			provider?: string;
			region?: string;
	  }
> {
	const isTTY = process.stdin.isTTY && process.stdout.isTTY;
	const generator = await resolveGenerator(cli, parsed, isTTY);
	const name = await resolveName(cli, parsed, isTTY);

	if (generator === "project") {
		const backend = await resolveProjectBackend(cli, parsed, isTTY);
		const region = await resolveProjectRegion(cli, parsed, isTTY, backend);
		const provider = await resolveProjectProvider(cli, parsed, isTTY, backend);
		return { generator, name, backend, region, provider };
	}

	if (generator === "stack") {
		const provider = await resolveStackProvider(cli, parsed, isTTY);
		const region = await resolveStackRegion(cli, parsed, isTTY, provider);
		return { generator, name, provider, region };
	}

	return { generator, name };
}

async function resolveGenerator(
	cli: SubspaceCli,
	parsed: Exclude<Extract<ParsedArgv, { command: "new" }>, undefined>,
	isTTY: boolean,
): Promise<NewGenerator> {
	const fromInput = cli.flags.generator ?? parsed.generator;
	if (isGenerator(fromInput)) return fromInput;
	if (!isTTY) {
		cli.exit('missing required arguments for "new".', {
			code: "usage",
			hint: 'Run interactively or pass "new <generator> <name>".',
		});
	}
	return cli.prompt.generator();
}

async function resolveName(
	cli: SubspaceCli,
	parsed: Exclude<Extract<ParsedArgv, { command: "new" }>, undefined>,
	isTTY: boolean,
): Promise<string> {
	const fromInput = cli.flags.name ?? parsed.name;
	if (fromInput && VALID_NAME.test(fromInput)) return fromInput;
	if (!isTTY) {
		cli.exit('missing required arguments for "new".', {
			code: "usage",
			hint: 'Run interactively or pass "new <generator> <name>".',
		});
	}
	return cli.prompt.name();
}

async function resolveProjectBackend(
	cli: SubspaceCli,
	parsed: Exclude<Extract<ParsedArgv, { command: "new" }>, undefined>,
	isTTY: boolean,
): Promise<BackendType> {
	const fromInput = cli.flags.backend ?? parsed.arg3;
	if (isBackend(fromInput)) return fromInput;
	if (!isTTY) return "local";
	return cli.prompt.backend();
}

async function resolveProjectProvider(
	cli: SubspaceCli,
	parsed: Exclude<Extract<ParsedArgv, { command: "new" }>, undefined>,
	isTTY: boolean,
	backend: BackendType,
): Promise<ProviderType> {
	const fromInput = cli.flags.provider ?? parsed.arg5;
	if (isProvider(fromInput)) return fromInput;
	if (!isTTY) return recommendedProviderForBackend(backend);
	if (backend === "azurerm") return cli.prompt.projectProviderAzure();
	if (backend === "gcs") return cli.prompt.projectProviderGcp();
	return cli.prompt.projectProviderAws();
}

async function resolveProjectRegion(
	cli: SubspaceCli,
	parsed: Exclude<Extract<ParsedArgv, { command: "new" }>, undefined>,
	isTTY: boolean,
	backend: BackendType,
): Promise<string | undefined> {
	if (!backendNeedsRegion(backend)) return undefined;
	const fromInput = cli.flags.region ?? parsed.arg4;
	if (fromInput && VALID_REGION.test(fromInput)) return fromInput;
	if (!isTTY) return backend === "s3" ? "us-east-1" : "us-central1";
	return backend === "s3"
		? cli.prompt.projectRegionAws()
		: cli.prompt.projectRegionGcp();
}

async function resolveStackProvider(
	cli: SubspaceCli,
	parsed: Exclude<Extract<ParsedArgv, { command: "new" }>, undefined>,
	isTTY: boolean,
): Promise<ProviderType> {
	const fromInput = cli.flags.provider ?? parsed.arg3;
	if (isProvider(fromInput)) return fromInput;
	if (!isTTY) return "aws";
	return cli.prompt.stackProvider();
}

async function resolveStackRegion(
	cli: SubspaceCli,
	parsed: Exclude<Extract<ParsedArgv, { command: "new" }>, undefined>,
	isTTY: boolean,
	provider: ProviderType,
): Promise<string | undefined> {
	if (!providerNeedsRegion(provider)) return undefined;
	const fromInput = cli.flags.region ?? parsed.arg4;
	if (fromInput && VALID_REGION.test(fromInput)) return fromInput;
	if (!isTTY) return undefined;
	return provider === "aws"
		? cli.prompt.stackRegionAws()
		: cli.prompt.stackRegionGcp();
}

function isGenerator(value: string | undefined): value is NewGenerator {
	return value === "project" || value === "module" || value === "stack";
}

function isBackend(value: string | undefined): value is BackendType {
	return value === "local" || value === "s3" || value === "gcs" || value === "azurerm";
}

function isProvider(value: string | undefined): value is ProviderType {
	return (
		value === "aws" ||
		value === "azure" ||
		value === "gcp" ||
		value === "cloudflare"
	);
}

function backendNeedsRegion(backend: BackendType): boolean {
	return backend === "s3" || backend === "gcs";
}

function providerNeedsRegion(provider: ProviderType): boolean {
	return provider === "aws" || provider === "gcp";
}
