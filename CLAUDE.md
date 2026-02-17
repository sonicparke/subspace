# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Subspace** is a Bun-first TypeScript CLI that wraps OpenTofu and Terraform workflows with Terraspace-style ergonomics. It compiles to a single binary via `bun build --compile`.

## Tech Stack

- **Runtime / distribution**: Bun (single binary via `bun build --compile`)
- **Package manager**: pnpm
- **CLI framework**: `trpc-cli` (mmkal) + `@trpc/server` + `zod` (prefer `zod/v4`)
- **Testing**: Vitest
- **Linting / formatting**: Biome
- **Engine support**: OpenTofu (`tofu`, preferred) with fallback to `terraform`

## Commands

```bash
pnpm install           # Install dependencies
pnpm build             # bun build src/cli.ts --compile --outfile dist/subspace
pnpm test              # Run Vitest tests
pnpm test <pattern>    # Run a single test file or pattern
pnpm lint              # Biome lint
pnpm format            # Biome format
```

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

The `ctx` object carries side effects (`exec`, `fs`, `log`, `env`) and the resolved engine binary, so unit tests run without spawning real processes.

**Programming style:** Functional only — no classes or OO patterns.

## CLI Contract

```bash
subspace plan    <stack> [env] [--engine tofu|terraform] -- <engineArgs...>
subspace apply   <stack> [env] [--engine tofu|terraform] -- <engineArgs...>
subspace destroy <stack> [env] [--engine tofu|terraform] -- <engineArgs...>
subspace doctor
```

- `STACK` is required; `ENV` is optional (base-only config when omitted).
- `ENV` is always a bare word (no leading `-`). Second positional before `--` is treated as `ENV`.
- Engine-specific flags must follow `--`.
- `--engine` is a global flag that overrides engine auto-detection for a single invocation.

## Engine Detection

Resolution priority: `--engine` flag > `SUBSPACE_ENGINE` env var > auto-detect (`tofu` preferred, then `terraform`).

## Stack / Build Directory Layout

```
app/stacks/<stack>/            # Stack source (Terraform/OpenTofu files)
  tfvars/                      # Variable files (not copied to emitted dir)
    base.tfvars
    <env>.tfvars
    <env>.secrets.tfvars
    local.tfvars
    <env>.local.tfvars

.subspace/build/<stack>/<env>/ # Emitted working directory (clean rebuild each run)
  00-base.auto.tfvars          # Layered var files written by Subspace
  10-env.auto.tfvars
  20-env-secrets.auto.tfvars
  90-local.auto.tfvars
  95-env-local.auto.tfvars
```

When `ENV` is omitted, the sentinel directory name `__noenv__` is used.

**Clean rebuild** on every invocation: deletes everything in the emitted dir **except** `.terraform/`, `.terraform.lock.hcl`, `terraform.tfstate`, and `terraform.tfstate.backup`. Then re-copies stack source files recursively. `.subspace/` and `tfvars/` are never copied.

## Backend Configuration

Subspace copies the user's `backend.tf` from the stack source. During `init`, Subspace auto-injects `-backend-config` to set the state key to `subspace/<stack>/<env>/terraform.tfstate` (or `prefix` for GCS), ensuring state isolation without requiring per-env backend files.

Supported backends: local, S3, GCS, azurerm.

## Engine Invocation

Uses `-chdir` (supported by both engines):
```bash
tofu -chdir=.subspace/build/<stack>/<env-or-noenv> plan
```

**Init-only-when-needed** for `plan`/`apply`/`destroy`:
1. If `.terraform/` is missing in the emitted dir, run `init` with auto-injected `-backend-config`. Output streams to the terminal.
2. Run the requested command.
3. If it fails with an "init required" error, run `init` and retry once.
4. Preserve the engine's exit code.
