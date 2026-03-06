import type { BackendType } from "../domain/backends.js";
import {
	type ProviderType,
	recommendedProviderForBackend,
} from "../domain/providers.js";

const GENERATOR_OPTIONS = ["project", "module", "stack"] as const;
const BACKEND_OPTIONS = ["local", "s3", "gcs", "azurerm"] as const;
const PROVIDER_OPTIONS = ["aws", "azure", "gcp", "cloudflare"] as const;
const VALID_NAME = /^[A-Za-z0-9_-]+$/;
const VALID_REGION = /^[A-Za-z0-9-]+$/;

export interface PromptIO {
	isTTY: boolean;
	ask(question: string): Promise<string>;
	select(
		title: string,
		options: readonly string[],
		defaultIndex: number,
	): Promise<string>;
}

export async function resolveNewArgsInteractive(
	cliArgv: string[],
	io: PromptIO,
): Promise<string[]> {
	if (cliArgv[0] !== "new") return cliArgv;

	let generator = cliArgv[1];
	let name = cliArgv[2];
	const arg3 = cliArgv[3];
	const arg4 = cliArgv[4];
	const arg5 = cliArgv[5];

	if (isComplete(generator, name, arg3, arg4, arg5)) return cliArgv;

	if (!io.isTTY) {
		if (!generator || !name) {
			throw new Error(
				'missing required arguments for "new". Run interactively or pass <generator> <name>.',
			);
		}
		if (generator === "project") {
			const backend = arg3 ?? "local";
			const region = backendNeedsRegion(backend)
				? (arg4 ?? defaultRegionForBackend(backend))
				: undefined;
			const provider = arg5 ?? recommendedProviderForBackend(backend);
			const args = ["new", generator, name, backend];
			if (region) args.push(region);
			else if (arg4) args.push(arg4); // keep it if it was passed
			if (provider) args.push(provider);
			return args;
		}
		if (generator === "stack") {
			const provider = arg3 ?? "aws";
			return ["new", generator, name, provider];
		}
		return ["new", generator, name];
	}

	if (!generator || !GENERATOR_OPTIONS.includes(generator as never)) {
		generator = await io.select("Select generator", GENERATOR_OPTIONS, 0);
	}
	if (!name || !VALID_NAME.test(name)) {
		name = await promptName(io);
	}

	if (generator === "project") {
		const backend =
			arg3 && BACKEND_OPTIONS.includes(arg3 as never)
				? (arg3 as BackendType)
				: ((await io.select(
						"Select backend",
						BACKEND_OPTIONS,
						0,
					)) as BackendType);
		const region = backendNeedsRegion(backend as string)
			? await promptRegion(io, defaultRegionForBackend(backend as string), arg4)
			: undefined;
		const provider =
			arg5 && PROVIDER_OPTIONS.includes(arg5 as never)
				? (arg5 as ProviderType)
				: ((await io.select(
						"Select default provider",
						PROVIDER_OPTIONS,
						0,
					)) as ProviderType);

		const args = ["new", generator, name, backend];
		if (region) args.push(region);
		else if (arg4) args.push(arg4); // keep it if it was passed
		if (provider) args.push(provider);
		return args;
	}

	if (generator === "stack") {
		const provider =
			arg3 && PROVIDER_OPTIONS.includes(arg3 as never)
				? arg3
				: await io.select("Select provider", PROVIDER_OPTIONS, 0);
		const region =
			providerNeedsRegion(provider) && !arg4
				? await promptRegion(io, defaultRegionForProvider(provider), arg4)
				: arg4;
		return region
			? ["new", generator, name, provider, region]
			: ["new", generator, name, provider];
	}

	return ["new", generator, name];
}

function isComplete(
	generator: string | undefined,
	name: string | undefined,
	arg3: string | undefined,
	arg4: string | undefined,
	arg5: string | undefined,
): boolean {
	if (!generator || !name) return false;
	if (generator === "project") {
		if (!arg3) return false;
		if (backendNeedsRegion(arg3) && !arg4) return false;
		if (!arg5) return false;
		return true;
	}
	if (generator === "stack") {
		if (!arg3) return false;
		return true;
	}
	return true;
}

async function promptName(io: PromptIO): Promise<string> {
	while (true) {
		const value = (await io.ask("\x1b[36mName:\x1b[0m ")).trim();
		if (VALID_NAME.test(value)) return value;
	}
}

async function promptRegion(
	io: PromptIO,
	fallback: string,
	initial: string | undefined,
): Promise<string> {
	if (initial && VALID_REGION.test(initial)) return initial;
	while (true) {
		const value = (
			await io.ask(`\x1b[36mRegion\x1b[0m [${fallback}]: `)
		).trim();
		const result = value || fallback;
		if (VALID_REGION.test(result)) return result;
	}
}

function backendNeedsRegion(backend: string): boolean {
	return backend === "s3" || backend === "gcs";
}

function providerNeedsRegion(provider: string): boolean {
	return provider === "aws" || provider === "gcp";
}

function defaultRegionForBackend(backend: string): string {
	return backend === "s3" ? "us-east-1" : "us-central1";
}

function defaultRegionForProvider(provider: string): string {
	return provider === "aws" ? "us-east-1" : "us-central1";
}
