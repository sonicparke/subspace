# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Subspace** is a Bun-first TypeScript CLI that wraps OpenTofu and Terraform workflows with Terraspace-style ergonomics. It compiles to a single binary via `bun build --compile`.

## Tech Stack

- **Runtime / distribution**: Bun (single binary via `bun build --compile`)
- **Package manager**: pnpm
- **CLI framework**: `trpc-cli` (mmkal) + `@trpc/server` + `zod` (prefer `zod/v4`)
- **Testing**: Bun's built-in test runner (`bun test`)
- **Linting / formatting**: Biome
- **Engine support**: OpenTofu (`tofu`, preferred) with fallback to `terraform`

## Commands

```bash
pnpm install           # Install dependencies
pnpm build             # bun build src/cli.ts --compile --outfile dist/subspace
pnpm test              # bun test (run all tests)
pnpm test <pattern>    # Run a single test file or pattern
pnpm lint              # Biome lint
pnpm format            # Biome format --write .
```

> **Note:** The test runner is Bun's native test runner, not Vitest. Use `bun test` directly or `pnpm test`.

## Primary Workflows

- **Feature Completion:** Always run `pnpm build` after completing a feature to compile and install the binary to `/opt/homebrew/bin/subspace`.
- **Testing:** Verify changes with `pnpm test` before building.

## Architecture

Subspace is implemented as a **tRPC router** where each procedure maps to a CLI command.

**Entry point:** `src/cli.ts` — builds the CLI via:
```ts
createCli({ router, name: "subspace", version }).run()
```

**Command implementations** are plain functions with injected context:
- `runDoctor(ctx, input)`
- `runPlan(ctx, input)`
- `runApply(ctx, input)`
- `runDestroy(ctx, input)`
- `runNew(ctx, input)`

The `ctx` object carries side effects (`exec`, `execStream`, `fs`, `log`, `env`) and the resolved engine binary, so unit tests run without spawning real processes.

**Programming style:** Functional only — no classes or OO patterns.

## Source Layout

```
src/
├── cli.ts                    # Entry point: arg preprocessing, engine detect, CLI build
├── router.ts                 # tRPC router — one procedure per CLI command
├── context.ts                # SubspaceContext interface + real context factory
├── version.ts                # BUILD_VERSION constant (injected at build time)
├── commands/
│   ├── doctor.ts             # runDoctor()
│   ├── plan.ts               # runPlan()
│   ├── apply.ts              # runApply()
│   ├── destroy.ts            # runDestroy()
│   ├── new.ts                # runNew() — scaffold generator
│   ├── new-interactive.ts    # Interactive prompts for `new` command
│   └── workflow.ts           # runWorkflow() — shared plan/apply/destroy logic
├── engine/
│   ├── detect.ts             # detectEngine() — resolution priority logic
│   ├── invoke.ts             # invokeEngine() — init-when-needed + exec
│   └── backend.ts            # detectBackend() + buildBackendConfigFlags()
├── build/
│   ├── clean-rebuild.ts      # cleanRebuild() — emitted dir management
│   └── var-layering.ts       # writeVarLayers() — numbered auto.tfvars files
├── config/
│   ├── project.ts            # loadProjectConfig() / saveProjectConfig()
│   ├── stack.ts              # loadStackConfig()
│   ├── stack-config.ts       # Stack config file path resolution
│   ├── stack-schema.ts       # Zod schema for stack subspace.toml
│   ├── schema.ts             # Shared type definitions
│   └── toml-lite.ts          # Minimal TOML parser (not full spec)
├── domain/
│   ├── backends.ts           # BackendType, default settings, HCL rendering
│   └── providers.ts          # ProviderType, templates, backend recommendations
├── regions/
│   ├── resolve.ts            # resolveRegions()
│   └── provider-template.ts  # generateProviderHcl() per region
└── argv/
    └── preprocess.ts         # preprocessArgv() — splits cliArgv / engineArgs
```

## CLI Contract

```bash
subspace plan    <stack> [env] [--engine tofu|terraform] -- <engineArgs...>
subspace apply   <stack> [env] [--engine tofu|terraform] -- <engineArgs...>
subspace destroy <stack> [env] [--engine tofu|terraform] -- <engineArgs...>
subspace doctor
subspace new [project|module|stack] <name> [backend|provider] [region]
```

- `STACK` is required; `ENV` is optional (base-only config when omitted).
- `ENV` is always a bare word (no leading `-`). Second positional before `--` is treated as `ENV`.
- Engine-specific flags must follow `--`.
- `--engine` is a global flag that overrides engine auto-detection for a single invocation.
- Commands that don't need an engine (`doctor`, `new`, `help`, `--version`) skip engine detection.

## Engine Detection

Resolution priority: `--engine` flag > `SUBSPACE_ENGINE` env var > auto-detect (`tofu` preferred, then `terraform`).

Supported engine values: `tofu`, `terraform`.

## Argument Preprocessing (`src/argv/preprocess.ts`)

Before tRPC CLI parses args, `preprocessArgv()` splits raw `process.argv` into:
- `cliArgv`: Everything before `--`, with `--engine <val>` stripped out
- `engineFlag`: The value of `--engine` (if present)
- `engineArgs`: Everything after `--`

This allows `--engine` to work as a true global flag and keeps engine-specific args isolated.

## Stack / Build Directory Layout

```
app/stacks/<stack>/            # Stack source (Terraform/OpenTofu files)
  tfvars/                      # Variable files (not copied to emitted dir)
    base.tfvars
    <env>.tfvars
    <env>.secrets.tfvars
    local.tfvars
    <env>.local.tfvars
  subspace.toml                # Optional per-stack config (provider, regions, backend)

.subspace/build/<stack>/<region>/<env>/ # Emitted working directory (clean rebuild each run)
  00-base.auto.tfvars          # Layered var files written by Subspace
  10-env.auto.tfvars
  20-env-secrets.auto.tfvars
  90-local.auto.tfvars
  95-env-local.auto.tfvars
```

When `ENV` is omitted, the sentinel directory name `__noenv__` is used.

**Clean rebuild** on every invocation: deletes everything in the emitted dir **except** `.terraform/`, `.terraform.lock.hcl`, `terraform.tfstate`, and `terraform.tfstate.backup`. Then re-copies stack source files recursively. `.subspace/` and `tfvars/` are never copied.

## Variable Layering

Files are written in order; later files take precedence (Terraform loads `.auto.tfvars` alphabetically):

| Source file              | Emitted as                  | Requires env? |
|--------------------------|-----------------------------|---------------|
| `base.tfvars`            | `00-base.auto.tfvars`       | No            |
| `<env>.tfvars`           | `10-env.auto.tfvars`        | Yes           |
| `<env>.secrets.tfvars`   | `20-env-secrets.auto.tfvars`| Yes           |
| `local.tfvars`           | `90-local.auto.tfvars`      | No            |
| `<env>.local.tfvars`     | `95-env-local.auto.tfvars`  | Yes           |

Missing source files are silently skipped.

## Backend Configuration

Subspace copies the user's `backend.tf` from the stack source. During `init`, Subspace auto-injects `-backend-config` to set the state key to `subspace/<scope>/<region>/<env>/<stack>/subspace.tfstate` (or `prefix` for GCS), ensuring state isolation without requiring per-env backend files.

Supported backends: `local`, `s3`, `gcs`, `azurerm`.

Backend detection scans `.tf` / `.tf.json` files in the emitted build directory for a `backend "<type>"` block.

## Engine Invocation

Uses `-chdir` (supported by both engines):
```bash
tofu -chdir=.subspace/build/<stack>/<region>/<env-or-noenv> plan
```

**Init-only-when-needed** for `plan`/`apply`/`destroy`:
1. If `.terraform/` is missing in the emitted dir, run `init` with auto-injected `-backend-config`. Output streams to the terminal.
2. Run the requested command.
3. If it fails with an "init required" error, run `init` and retry once.
4. Preserve the engine's exit code.

## Configuration Files

### Project config: `subspace.toml` (project root)

Parsed by `src/config/project.ts`. Sections:
- `[project]` — project-level metadata
- `[backend]` — default backend type and settings
- `[policy]` — policy settings

### Stack config: `app/stacks/<stack>/subspace.toml`

Parsed by `src/config/stack.ts` using the Zod schema in `src/config/stack-schema.ts`. Fields:
- `stack.provider` — provider type (`aws`, `azure`, `gcp`, `cloudflare`)
- `regions.values` — list of regions; `regions.default` — default region
- `backend.type` — backend override for this stack
- `provider.settings` — provider-level settings (region, project, etc.)
- `provider.region_overrides.<region>` — per-region provider setting overrides

### TOML parser

`src/config/toml-lite.ts` is a minimal custom parser. It does **not** implement the full TOML spec — only sections, key-value pairs, and simple arrays. Do not add complex TOML features without extending the parser or switching to a full library.

## Domain Models

### Backends (`src/domain/backends.ts`)
- `BackendType`: `"local" | "s3" | "gcs" | "azurerm"`
- Default settings per backend type
- HCL `backend {}` block template rendering

### Providers (`src/domain/providers.ts`)
- `ProviderType`: `"aws" | "azure" | "gcp" | "cloudflare"`
- Recommended backend for each provider
- Recommended provider for each backend
- HCL `provider {}` block template rendering

## `new` Command — Scaffold Generator

`subspace new [project|module|stack] <name> [backend|provider] [region]`

Generates project scaffolding, modules, and stacks. When arguments are missing, the CLI falls back to an interactive arrow-key menu (`src/commands/new-interactive.ts`).

Supported combinations:
- `new project <name> <backend>` — scaffold a new Subspace project
- `new stack <name> <provider> [region]` — add a new stack
- `new module <name>` — add a new module

## Context Interface

```typescript
interface SubspaceContext {
  exec(cmd: string, args: string[]): Promise<ExecResult>        // capture stdout/stderr
  execStream(cmd: string, args: string[]): Promise<StreamResult> // stream to terminal
  fs: SubspaceFs          // readFile, writeFile, readdir, stat, exists, mkdir, rm, cp
  log: { info, warn, error }
  env: Record<string, string | undefined>
  cwd: string
  engine: string          // resolved engine binary ("tofu" or "terraform")
  engineArgs: string[]    // args after "--" on command line
}
```

The real context (`src/context.ts`) wraps Node.js `child_process` and `fs/promises`. Tests use a mock context (`test/helpers/mock-context.ts`) with an in-memory filesystem and stubbed exec handlers.

## Testing Conventions

- **Runner**: `bun test` (Bun's native test runner, Jest-compatible API)
- **Location**: `test/` directory mirrors `src/` structure
- **Mock context**: Always use `makeMockContext()` from `test/helpers/mock-context.ts` — never mock individual modules
- **No real processes**: Tests must not spawn `tofu`/`terraform`; stub `ctx.exec` / `ctx.execStream` instead
- **In-memory fs**: Seed mock files via `ctx.fs` helpers before calling command functions

Test categories:
```
test/
├── helpers/mock-context.ts   # Shared mock factory
├── commands/                 # Unit tests per command
├── engine/                   # Engine detection + invocation
├── build/                    # Clean rebuild + var layering
├── config/                   # Config parsing
├── argv/                     # Argument preprocessing
├── regions/                  # Region resolution
└── integration/              # End-to-end workflow tests
```

## Key Conventions

1. **Functional only** — no classes, no `this`. All state via function arguments and return values.
2. **Context injection** — all side effects go through `SubspaceContext`. Never import `fs` or spawn processes directly in command/engine/build modules.
3. **Zod v4** — use `zod/v4` imports, not legacy `zod`.
4. **Exit codes** — commands call `process.exit(code)` to propagate engine exit codes. Tests assert on thrown errors rather than process.exit directly.
5. **`__noenv__` sentinel** — when no env is provided, the string `"__noenv__"` is used as the build directory segment. Never use an empty string for the env slot.
6. **No full TOML library** — the custom `toml-lite.ts` parser is intentional for binary size. Extend it carefully if needed.
7. **Biome over ESLint/Prettier** — use `pnpm lint` and `pnpm format` (Biome), not eslint/prettier.
8. **`-chdir` not `cd`** — engine invocation always uses the `-chdir` flag; never `cd` into the build directory.
