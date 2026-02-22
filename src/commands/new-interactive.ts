const GENERATOR_OPTIONS = [
	"project",
	"module",
	"stack",
] as const;
const VALID_GENERATORS = new Set(GENERATOR_OPTIONS);
const VALID_NAME = /^[A-Za-z0-9_-]+$/;
const BACKEND_OPTIONS = [
	"local",
	"s3",
	"gcs",
	"azurerm",
] as const;
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

function isGenerator(value: string): value is (typeof GENERATOR_OPTIONS)[number] {
	return VALID_GENERATORS.has(value as (typeof GENERATOR_OPTIONS)[number]);
}

export async function resolveNewArgsInteractive(
	cliArgv: string[],
	io: PromptIO,
): Promise<string[]> {
	if (cliArgv[0] !== "new") return cliArgv;

	let generator = cliArgv[1];
	let name = cliArgv[2];
	let backend = cliArgv[3];
	let region = cliArgv[4];

	if (
		generator &&
		name &&
		(generator !== "project" ||
			(backend &&
				(!backendNeedsRegion(backend as (typeof BACKEND_OPTIONS)[number]) ||
					Boolean(region))))
	) {
		return cliArgv;
	}
	if (!io.isTTY) {
		if (!generator || !name) {
			throw new Error(
				'missing required arguments for "new". Run interactively or pass <generator> <name>.',
			);
		}
		if (generator === "project" && !backend) {
			return ["new", generator, name, "local"];
		}
		if (
			generator === "project" &&
			backend &&
			backendNeedsRegion(backend as (typeof BACKEND_OPTIONS)[number]) &&
			!region
		) {
			region = defaultRegionForBackend(
				backend as (typeof BACKEND_OPTIONS)[number],
			);
		}
		return backend
			? region
				? ["new", generator, name, backend, region]
				: ["new", generator, name, backend]
			: ["new", generator, name];
	}

	if (!generator || !isGenerator(generator)) {
		generator = await promptGenerator(io);
	}
	if (!name || !VALID_NAME.test(name)) {
		name = await promptName(io);
	}
	if (generator === "project" && !backend) {
		backend = await promptBackend(io);
	}
	if (
		generator === "project" &&
		backend &&
		backendNeedsRegion(backend as (typeof BACKEND_OPTIONS)[number]) &&
		(!region || !VALID_REGION.test(region))
	) {
		region = await promptRegion(
			io,
			defaultRegionForBackend(backend as (typeof BACKEND_OPTIONS)[number]),
		);
	}

	return backend
		? region
			? ["new", generator, name, backend, region]
			: ["new", generator, name, backend]
		: ["new", generator, name];
}

async function promptGenerator(io: PromptIO): Promise<string> {
	return io.select("Select generator", GENERATOR_OPTIONS, 0);
}

async function promptName(io: PromptIO): Promise<string> {
	while (true) {
		const value = (await io.ask("\x1b[36mName:\x1b[0m ")).trim();
		if (VALID_NAME.test(value)) return value;
	}
}

async function promptBackend(io: PromptIO): Promise<string> {
	return io.select("Select backend", BACKEND_OPTIONS, 0);
}

async function promptRegion(io: PromptIO, fallback: string): Promise<string> {
	while (true) {
		const value = (await io.ask(
			`\x1b[36mRegion\x1b[0m [${fallback}]: `,
		)).trim();
		const result = value || fallback;
		if (VALID_REGION.test(result)) return result;
	}
}

function backendNeedsRegion(
	backend: (typeof BACKEND_OPTIONS)[number],
): boolean {
	return backend === "s3" || backend === "gcs";
}

function defaultRegionForBackend(
	backend: (typeof BACKEND_OPTIONS)[number],
): string {
	return backend === "s3" ? "us-east-1" : "us-central1";
}
