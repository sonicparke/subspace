# Subspace Plan

This document captures the current authoritative state and design of Subspace. It serves as a blueprint for rebuilding the application from scratch.

Subspace is a Bun-first TypeScript CLI that wraps OpenTofu and Terraform workflows while providing Terraspace-style ergonomics.

## Key Decisions

- **Runtime / distribution**: Bun-first single binary (compile with `pnpm build`).
- **Package manager / tooling**: `pnpm` + `biome` + `vitest` + `typescript`.
- **CLI framework**: `@oscli-dev/oscli`.
- **Programming style**: functional (no OO); commands are plain functions with injected dependencies.
- **Engine compatibility**: support **OpenTofu** (`tofu`) and **Terraform** (`terraform`).
- **Default engine**: prefer `tofu` if available; fallback to `terraform`. Overridable via `--engine` flag or `SUBSPACE_ENGINE` env var.
- **Execution mode**: **emitted mode from the start**.
- **Regionalization**: All stacks run across one or more regions (default `global`).
- **Build output strategy**: clean rebuild of emitted working directory every run.
- **Version injection**: `version` is a compile-time string constant stamped into the binary.

## CLI Contract

This section defines the target public contract for the `oscli` migration. The
goal is to keep current Subspace behavior unless the contract below explicitly
changes it.

### Workflow Commands
```bash
subspace plan    <stack> [env] [--engine tofu|terraform] -- <engineArgs...>
subspace apply   <stack> [env] [--engine tofu|terraform] -- <engineArgs...>
subspace destroy <stack> [env] [--engine tofu|terraform] -- <engineArgs...>
```

Expected behavior:
- `stack` remains required.
- `env` remains optional.
- `--engine` continues to override auto-detection.
- engine passthrough after `--` remains supported during migration.
- help and validation errors should be emitted through `oscli`/Commander rather
  than custom handwritten output.
- command execution still delegates to `runPlan`, `runApply`, and `runDestroy`.

### Generator Commands
```bash
subspace new project <name> [backend] [region] [provider]
subspace new module  <name>
subspace new stack   <name> [provider] [region]
subspace new          # Interactive mode
```

Expected behavior:
- `subspace new` uses native `oscli` prompts and selection widgets instead of
  the legacy ANSI menu renderer.
- prompt defaults stay aligned with current generator logic:
  - project backend default: `local`
  - project provider default: backend-derived recommendation
  - project region default: backend-derived region when needed
  - stack provider default: `aws`
  - stack region default: provider-derived region when needed
- non-interactive execution remains supported when enough args/flags are
  supplied.
- prompt bypass via matching `oscli` flags is the preferred end state.

### Utility Commands
```bash
subspace doctor
```

Expected behavior:
- `doctor` remains non-interactive.
- output moves to `oscli` primitives and leveled logs, but the underlying checks
  stay the same.
- exit code remains `0` for advisory warnings and non-zero only for hard
  failures.

### Global UX

Expected behavior:
- `subspace --help` and `subspace --version` are handled by the CLI framework.
- command help is consistent across all commands.
- interactive prompts share a single `oscli` theme.
- machine-readable output can be added later via `oscli` JSON mode, but that is
  not required to preserve current behavior.

## Engine Detection

Priority (highest to lowest):
1. `--engine <name>` flag.
2. `SUBSPACE_ENGINE` env var.
3. Auto-detect: `tofu` on `$PATH`, then `terraform`.

## Project Conventions

Source stack directory: `app/stacks/<stack>/`
Stack env var files: `app/stacks/<stack>/tfvars/`
Emitted working directory: `.subspace/build/<stack>/<region>/<env-or-noenv>/`
- If no env is provided, Subspace uses `__noenv__`.
- If no region is provided, Subspace defaults to `global` (unless configured in `subspace.toml`).

## Engine Invocation

Uses `-chdir=<dir>`:
- `tofu -chdir=.subspace/build/<stack>/<region>/<env> plan ...`

### Init-Only-When-Needed
1. If `.terraform/` is missing in the emitted dir, run `init` with auto-injected `-backend-config`.
2. Run the requested command.
3. If it fails with an "init required" error, run `init` and retry once.

## Clean Rebuild Rules

On each invocation, Subspace materializes `app/stacks/<stack>/` into `.subspace/build/...`:
1. Delete everything in the emitted dir **except**:
   - `.terraform/`, `.terraform.lock.hcl`, `terraform.tfstate`, `terraform.tfstate.backup`.
2. Recursively copy stack source files.
3. Do **not** copy: `.terraform/`, `.subspace/`, `tfvars/`.
4. Write layered `*.auto.tfvars` files into the root.
5. Generate `providers.tf` if stack configuration requires regional injection.

## Backend Configuration

Subspace auto-injects `-backend-config` during `init` to isolate state.

### State Key Injection
- **S3**:
  - `-backend-config=bucket=<app>-subspace-aws-state`
  - `-backend-config=key=subspace/aws/<region>/<env>/<stack>/subspace.tfstate`
- **GCS**:
  - `-backend-config=bucket=<app>-subspace-gcp-state`
  - `-backend-config=prefix=subspace/gcp/<region>/<env>/<stack>`
- **azurerm**:
  - `-backend-config=key=subspace/azure/<region>/<env>/<stack>/subspace.tfstate`

Bucket names are derived from the project directory name (the "app name").

## Rebuild Checklist for Agents

To rebuild Subspace:
1. **Context**: Implement a `ctx` with `fs`, `exec`, `execStream`, `log`.
2. **Config**: Implement TOML parsing for project and stack `subspace.toml`.
3. **Scaffolding**: Implement `new` generators with `renderBackendTf` and `renderProviderTf`.
4. **Workflow**: Implement `runAcrossRegions` (fanout) and `cleanRebuild`.
5. **Engine**: Implement `detectEngine` and `invokeEngine` with init-retry logic.
6. **CLI**: Use `oscli` to register commands, prompts, flags, and shared
   output styling.

---
[Features Tracker](features.md) | [Bugs Tracker](bugs.md)
