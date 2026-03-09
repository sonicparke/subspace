import { version } from "./version.js";
import { createSubspaceCli } from "./cli/app.js";
import { resolveCliRuntime } from "./cli/runtime.js";

async function main() {
	const raw = process.argv.slice(2);
	if (shouldPrintVersion(raw)) {
		console.log(version);
		return;
	}
	if (shouldPrintHelp(raw)) {
		printHelp();
		return;
	}

	try {
		const runtime = await resolveCliRuntime(raw);
		process.argv = [process.argv[0] ?? "node", "subspace", ...runtime.cliArgv];
		await createSubspaceCli(runtime).run();
	} catch (err) {
		if ((err as Error).message === "Interrupted") {
			process.exit(130);
		}
		console.error((err as Error).message);
		process.exit(1);
	}
}

function shouldPrintHelp(raw: string[]): boolean {
	return raw.length === 0 || raw[0] === "help" || raw.includes("--help") || raw.includes("-h");
}

function shouldPrintVersion(raw: string[]): boolean {
	return raw.length === 1 && (raw[0] === "--version" || raw[0] === "-V");
}

function printHelp(): void {
	console.log(`Subspace

Terraspace-style CLI for OpenTofu and Terraform.

Usage:
  subspace plan <stack> [env] [--engine tofu|terraform] -- <engineArgs...>
  subspace apply <stack> [env] [--engine tofu|terraform] -- <engineArgs...>
  subspace destroy <stack> [env] [--engine tofu|terraform] -- <engineArgs...>
  subspace new project <name> [backend] [region] [provider]
  subspace new module <name>
  subspace new stack <name> [provider] [region]
  subspace new
  subspace doctor
  subspace --version
  subspace --help`);
}

main();
