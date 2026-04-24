# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

**Subspace** is a Bun-first TypeScript CLI that wraps OpenTofu and Terraform workflows with Terraspace-style ergonomics. It compiles to a single binary via `bun build --compile`.

## Tech Stack

- **Runtime / distribution**: Bun (single binary via `bun build --compile`)
- **Package manager**: pnpm
- **CLI framework**: `@oscli-dev/oscli` (`createCLI`) — command routing, flags, prompts
- **Testing**: Bun's built-in test runner (`bun test`). Test files use `vitest`-style imports (`describe`, `it`, `expect` from `"vitest"`); Bun's runner resolves these via its Jest-compatible API.
- **Linting / formatting**: Biome
- **Engine support**: OpenTofu (`tofu`, preferred) with fallback to `terraform`

There is no tRPC, no Zod, and no runtime schema library in the project. Types are plain TypeScript interfaces. Keep it that way unless there's a concrete reason to add one — binary size matters (single-file compile).

## Commands

```bash
pnpm install           # Install dependencies
pnpm build             # bun build src/cli.ts --compile --outfile dist/subspace, then install to $HOME/.local/bin/subspace
pnpm test              # bun test (run all tests)
pnpm test <pattern>    # Run a single test file or pattern
pnpm lint              # Biome lint
pnpm format            # Biome format --write .
```

`pnpm build` runs `pnpm run install:bin` as its last step, which copies `dist/subspace` to `$HOME/.local/bin/subspace` (mode 755). Ensure `$HOME/.local/bin` is on your `PATH`.

> **Note:** The test runner is Bun's native test runner, not Vitest. The `from "vitest"` imports in test files are resolved by Bun's compatibility shim — do not add `vitest` as a dependency.

## Primary Workflows

- **Feature Completion:** Always run `pnpm build` after completing a feature to compile and install the binary to `$HOME/.local/bin/subspace`. This is not optional — a task is not done until the binary on `$PATH` reflects the new code.
- **Sandbox note for agents:** `pnpm build` will compile `dist/subspace` inside a standard workspace sandbox, but the chained `install:bin` step writes to `$HOME/.local/bin/` which is outside the workspace. If `install -m 755 dist/subspace $HOME/.local/bin/subspace` fails with `Operation not permitted`, re-run **just `pnpm run install:bin`** with elevated permissions (`required_permissions: ["all"]`) — the compiled artifact is already valid.
- **Testing:** Verify changes with `pnpm test` before building.

## Architecture

Subspace is a thin argv parser + command dispatcher. There is no router, no tRPC, no procedure tree — just functions.

**Entry point:** `src/cli.ts` — handles `--help` / `--version` short-circuits, then:
```ts
const runtime = await resolveCliRuntime(raw);
process.argv = [process.argv[0] ?? "node", "subspace", ...runtime.oscliArgv];
await createSubspaceCli(runtime).run();
```

**Two-layer CLI (`src/cli/`):**
- `runtime.ts` — `resolveCliRuntime()` preprocesses argv (splits `--` engineArgs, strips `--engine`), detects the engine, and produces a typed `ParsedArgv` + `SubspaceContext`.
- `app.ts` — `createSubspaceCli(runtime)` registers commands via `@oscli-dev/oscli`'s `createCLI()` builder. Each command reads already-parsed values off `runtime.parsed` (or `cli.flags` for flags `oscli` handles directly) and calls the corresponding `run*()` function.

**Command implementations** are plain functions with injected context:
- `runDoctor(ctx)`
- `runPlan(ctx, input)` / `runApply(ctx, input)` / `runDestroy(ctx, input)` / `runShow(ctx, input)` — all thin wrappers around `runWorkflow(ctx, command, stack, env)`
- `runNew(ctx, input)` — scaffold generator
- `runMigrateInit(ctx, input)` — offline: scaffold `subspace.toml` with `[migration]` from a Terraspace project
- `runMigrateStack(ctx, input)` — read-only S3 probe for legacy + native state keys (see `docs/ideas/subspace-terraspace-migration.md`)

Workflow commands return `Promise<number>` (exit code). Migrate commands return a structured result with a `status` and a markdown `report`; the CLI shell (`src/cli/app.ts`) is responsible for printing the report and calling `process.exit(1)` on non-ok statuses.

The `ctx` object carries side effects and the resolved engine so unit tests run without spawning real processes.

**Programming style:** Functional only — no classes, no `this`.

## Source Layout

```
src/
├── cli.ts                       # Entry point: --help/--version, resolve runtime, run CLI
├── cli/
│   ├── runtime.ts               # resolveCliRuntime(), parseResolvedArgv(), ParsedArgv types
│   └── app.ts                   # createSubspaceCli() — oscli command registration
├── context.ts                   # SubspaceContext interface + createRealContext()
├── version.ts                   # BUILD_VERSION constant (injected at build time)
├── commands/
│   ├── doctor.ts                # runDoctor()
│   ├── plan.ts                  # runPlan()
│   ├── apply.ts                 # runApply()
│   ├── destroy.ts               # runDestroy()
│   ├── show.ts                  # runShow()
│   ├── new.ts                   # runNew() — scaffold generator
│   ├── workflow.ts              # runWorkflow() — shared plan/apply/destroy/show logic
│   ├── migrate-init.ts          # runMigrateInit() — offline scaffold of [migration]
│   └── migrate-stack.ts         # runMigrateStack() — read-only legacy/native S3 probe
├── engine/
│   ├── detect.ts                # detectEngine() — resolution priority logic
│   ├── invoke.ts                # invokeEngine() — init-when-needed + exec
│   └── backend.ts               # detectBackend() + buildBackendConfigFlags()
├── build/
│   ├── clean-rebuild.ts         # cleanRebuild() — emitted dir management
│   └── var-layering.ts          # writeVarLayers() — numbered auto.tfvars files
├── config/
│   ├── project.ts               # loadProjectConfig() / saveProjectConfig()
│   ├── stack.ts                 # loadStackConfig()
│   ├── stack-config.ts          # Stack config file path resolution
│   ├── stack-schema.ts          # Stack subspace.toml types + parse/serialize
│   ├── schema.ts                # Shared ProjectConfig / StackConfig types
│   └── toml-lite.ts             # Minimal TOML parser (not full spec)
├── domain/
│   ├── backends.ts              # BackendType, default settings, HCL rendering
│   └── providers.ts              # ProviderType, templates, backend recommendations
├── regions/
│   ├── resolve.ts               # resolveTargetRegions() / validateRegions()
│   ├── fanout.ts                # runAcrossRegions()
│   └── provider-template.ts     # providerTfForRegion() per-region provider.tf
├── migrate/
│   ├── config.ts                # parseMigrationConfig() / loadMigrationConfig()
│   └── terraspace/              # Terraspace-specific migration source
│       ├── detect.ts            # detectTerraspaceProject()
│       ├── discover.ts          # discoverTerraspaceStacks/Envs[ForStack]()
│       ├── backend-tf.ts        # extractTemplates() — regex over ERB backend.tf
│       ├── key.ts               # deriveLegacyKey() — template expansion
│       ├── plan.ts              # buildMigrationPlan()
│       ├── probe.ts              # probeStateObjects() — aws s3api head-object
│       └── scaffold.ts          # scaffoldSubspaceToml()
└── argv/
    └── preprocess.ts            # preprocessArgv() — splits cliArgv / engineArgs
```

## CLI Contract

```bash
subspace plan    <stack> [env] [--engine tofu|terraform] -- <engineArgs...>
subspace apply   <stack> [env] [--engine tofu|terraform] -- <engineArgs...>
subspace destroy <stack> [env] [--engine tofu|terraform] -- <engineArgs...>
subspace show    <stack> [env] [--engine tofu|terraform] -- <engineArgs...>
subspace doctor
subspace new [project|module|stack] <name> [backend|provider] [region]
subspace migrate init <legacy-path> [--out <dir>] [--regions <csv>] [--app-name <name>] [--force] [--dry-run]
subspace migrate <stack> [env] [--dry-run] [--report-file <path>] [--regions <csv>] [--role <ts_role>] [--app <ts_app>]
```

- `STACK` is required; `ENV` is optional (base-only config when omitted).
- `ENV` is always a bare word (no leading `-`). Second positional before `--` is treated as `ENV`.
- Engine-specific flags must follow `--`.
- `--engine` is a global flag that overrides engine auto-detection for a single invocation.
- Commands that don't need an engine (`doctor`, `new`, `migrate`, `help`, `--version`) skip engine detection.

### `migrate` framing

- `migrate <stack> [env]` is **probe-only** in this release. Without `--dry-run` it reports `# Migration report (probe-only)`; with `--dry-run` it reports `# Migration report (dry-run)`. The underlying operation (read-only S3 probe) is the same either way until state copy lands.
- Actual legacy → native state copy is planned to happen at `subspace plan`/`apply` init time (dual-read), not inside `migrate`. See `docs/ideas/subspace-terraspace-migration.md`.

## Engine Detection

Resolution priority: `--engine` flag > `SUBSPACE_ENGINE` env var > auto-detect (`tofu` preferred, then `terraform`).

Supported engine values: `tofu`, `terraform`.

## Argument Preprocessing (`src/argv/preprocess.ts`)

Before command dispatch, `preprocessArgv()` splits raw `process.argv` into:
- `cliArgv`: Everything before `--`, with `--engine <val>` stripped out
- `engineFlag`: The value of `--engine` (if present)
- `engineArgs`: Everything after `--`

This allows `--engine` to work as a true global flag and keeps engine-specific args isolated.

`src/cli/runtime.ts` then takes `cliArgv`, runs `parseResolvedArgv()` to produce a typed `ParsedArgv` union, and — for workflow commands — builds `oscliArgv` with `--stack`/`--env` lifted to flag form so that `@oscli-dev/oscli`'s builder sees a consistent shape.

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

.subspace/build/<stack>/<region>/<env>/           # Build root (contains stacks/ + modules/ siblings)
  stacks/<stack>/                                  # Engine chdir target; clean rebuild each run
    00-base.auto.tfvars                            # Layered var files written by Subspace
    10-env.auto.tfvars
    20-env-secrets.auto.tfvars
    90-local.auto.tfvars
    95-env-local.auto.tfvars
    providers.tf                                   # Generated from subspace config
    main.tf, variables.tf, etc.                    # Copied from app/stacks/<stack>/
  modules/<name>/                                  # Wiped+repopulated each run
                                                   # Only modules referenced via
                                                   # source = "../../modules/<name>"
```

When `ENV` is omitted, the sentinel directory name `__noenv__` is used.

**Why `stacks/` + `modules/` siblings?** User stacks reference shared modules via `source = "../../modules/<name>"`. OpenTofu resolves `source` relative to the `.tf` file's directory, so the staged layout must preserve the sibling relationship without rewriting source. This matches Terraspace's `.terraspace-cache/<region>/<env>/stacks/` and `.../modules/` layout.

**Clean rebuild** on every invocation:
- `stacks/<stack>/` — deletes everything **except** `.terraform/`, `.terraform.lock.hcl`, `terraform.tfstate`, and `terraform.tfstate.backup`, then re-copies stack source files recursively. `.subspace/` and `tfvars/` are never copied.
- `modules/` — wiped entirely and repopulated with only the modules referenced (transitively) by this stack. Missing referenced modules fail fast with a clear error.

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

Uses `-chdir` (supported by both engines), pointed at the per-stack working dir (not the build root):
```bash
tofu -chdir=.subspace/build/<stack>/<region>/<env-or-noenv>/stacks/<stack> plan
```

**Init-only-when-needed** for `plan`/`apply`/`destroy`:
1. If `.terraform/` is missing in the emitted dir, run `init` with auto-injected `-backend-config`. Output streams to the terminal.
2. Run the requested command.
3. If it fails with an "init required" error, run `init` and retry once.
4. Preserve the engine's exit code.

## Configuration Files

### Project config: `subspace.toml` (project root)

Parsed by `src/config/project.ts`. Sections:
- `[project]` — `backend` (required), `provider` (optional)
- `[backend]` — default backend settings (region, bucket, resource_group_name, storage_account_name, container_name)
- `[policy]` — optional `allowed_providers` list

Opt-in migration block (parsed separately by `src/migrate/config.ts`):
- `[migration]` — `source = "terraspace"` (only supported source today)
- `[migration.terraspace]` — `bucket_template`, `key_template`, `project`, `regions`, and optional `app_name`, `role`, `app`, `envs`

The migration section is **strictly opt-in**. Pure-Terraform users never encounter it. See `docs/ideas/subspace-terraspace-migration.md`.

### Stack config: `app/stacks/<stack>/subspace.toml`

Parsed by `src/config/stack-schema.ts` (no Zod — plain TS types + hand-rolled validation). Fields:
- `stack.name` — optional display name
- `stack.provider` — provider type (`aws`, `azure`, `gcp`, `cloudflare`)
- `regions.values` — list of regions; `regions.default` — default region
- `backend.type` — backend override for this stack
- `backend.settings.*` — per-stack backend settings (region, bucket, etc.)
- `provider.region` / `provider.project` — provider-level settings
- `provider.region_overrides.<region>` — per-region provider setting overrides

### TOML parser

`src/config/toml-lite.ts` is a minimal custom parser. It does **not** implement the full TOML spec — only sections, key-value pairs, and simple arrays. Dotted section headers (e.g. `[migration.terraspace]`, `[provider.region_overrides.us-east-1]`) are stored as flat keys on the root object. Do not add complex TOML features without extending the parser or switching to a full library (binary-size cost).

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

Generates project scaffolding, modules, and stacks. When arguments are missing and the process is running in a TTY, the CLI falls back to interactive `@oscli-dev/oscli` prompts defined inline in `src/cli/app.ts` (`buildCli()`).

Supported combinations:
- `new project <name> <backend> [region] [provider]` — scaffold a new Subspace project
- `new stack <name> <provider> [region]` — add a new stack
- `new module <name>` — add a new module

Prompt resolution in non-TTY contexts uses sensible defaults (e.g. `backend = local`, provider defaulted from backend via `recommendedProviderForBackend()`).

## Context Interface

```typescript
interface SubspaceContext {
  exec(cmd: string, args: string[]): Promise<ExecResult>         // capture stdout/stderr
  execStream(cmd: string, args: string[]): Promise<StreamResult>  // stream to terminal
  fs: SubspaceFs          // readFile, writeFile, readdir, stat, exists, mkdir, rm, cp
  log: { info, warn, error }
  env: Record<string, string | undefined>
  cwd: string
  engine: string          // resolved engine binary ("tofu" or "terraform")
  engineArgs: string[]    // args after "--" on command line
}
```

The real context (`src/context.ts`) wraps Node.js `child_process` and `fs/promises`. Tests use a mock context (`test/helpers/mock-context.ts`, exported as `createMockContext()`) with an in-memory filesystem and stubbed exec handlers.

## Testing Conventions

- **Runner**: `bun test` (Bun's native test runner, Jest-compatible API)
- **Location**: `test/` directory mirrors `src/` structure
- **Mock context**: Always use `createMockContext()` from `test/helpers/mock-context.ts` — never mock individual modules
- **No real processes**: Tests must not spawn `tofu`/`terraform`; stub `ctx.exec` / `ctx.execStream` instead
- **In-memory fs**: Seed mock files via `opts.files` when calling `createMockContext({ files: { "subspace.toml": "..." } })`

Test categories:
```
test/
├── helpers/mock-context.ts      # Shared mock factory (createMockContext)
├── commands/                    # Unit tests per command (plan, apply, destroy, show, new, doctor, migrate-*)
├── cli/                         # CLI-level argv parsing (migrate-argv.test.ts)
├── engine/                      # Engine detection + invocation + backend
├── build/                       # Clean rebuild + var layering
├── config/                      # Config parsing (stack-schema, stack-config)
├── argv/                        # preprocessArgv()
├── regions/                     # Region resolution + fanout + provider template
├── migrate/                     # Migration config + Terraspace source adapters
│   ├── config.test.ts
│   └── terraspace/              # detect, discover, backend-tf, key, plan, probe, scaffold
└── integration/                 # End-to-end CLI tests
```

## Key Conventions

1. **Functional only** — no classes, no `this`. All state via function arguments and return values.
2. **Context injection** — all side effects go through `SubspaceContext`. Never import `fs` or spawn processes directly in command/engine/build modules. The one exception is `src/context.ts` itself, which is the adapter.
3. **No runtime schema libraries** — no Zod, no tRPC. Use plain TypeScript interfaces and hand-written validation. Binary size matters.
4. **Exit codes** — workflow command functions (`runPlan`, `runApply`, etc.) return `Promise<number>`. The CLI shell in `src/cli/app.ts` is the only place that calls `process.exit()`. Tests assert on returned numbers (or on the `status` field of migrate results), never on `process.exit` side effects.
5. **`__noenv__` sentinel** — when no env is provided, the string `"__noenv__"` is used as the build directory segment (`src/commands/workflow.ts`) and for backend key derivation (`src/engine/backend.ts`). Never use an empty string for the env slot.
6. **No full TOML library** — the custom `toml-lite.ts` parser is intentional for binary size. Extend it carefully if needed; dotted headers are flattened to string keys on the root object.
7. **Biome over ESLint/Prettier** — use `pnpm lint` and `pnpm format` (Biome), not eslint/prettier.
8. **`-chdir` not `cd`** — engine invocation always uses the `-chdir` flag; never `cd` into the build directory.
9. **Terraspace compatibility is strictly opt-in** — the main README and core commands must never mention Terraspace concepts. All legacy code paths live under `src/migrate/` and are gated behind an explicit `[migration]` section in `subspace.toml`. See `docs/ideas/subspace-terraspace-migration.md`.
