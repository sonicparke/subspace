# Subspace Plan

This document captures the current agreed plan for Subspace.

Subspace is a Bun-first TypeScript CLI that wraps OpenTofu and Terraform workflows while providing Terraspace-style ergonomics.

## Key Decisions

- **Runtime / distribution**: Bun-first single binary (compile with `bun build --compile`).
- **Package manager / tooling**: `pnpm` + `biome` + `vitest` + `typescript`.
- **CLI framework**: `trpc-cli` (mmkal) + `@trpc/server` + `zod` (prefer `zod/v4`).
- **Programming style**: functional (no OO); commands are plain functions with injected dependencies.
- **Engine compatibility**: support **OpenTofu** (`tofu`) and **Terraform** (`terraform`).
- **Default engine**: prefer `tofu` if available; fallback to `terraform`. Overridable via `--engine` flag or `SUBSPACE_ENGINE` env var. Detection happens once at CLI startup and is passed via context.
- **Execution mode**: **emitted mode from the start**.
- **Env handling**: `ENV` only selects variable files (no Terraform/OpenTofu workspaces).
- **Engine passthrough args**: require `--` for unknown engine flags.
- **Build output strategy**: clean rebuild of emitted working directory every run (see Clean Rebuild Rules).
- **Version injection**: `version` is a compile-time string constant stamped into the binary at build time (e.g. from `$npm_package_version` or a git tag).

## CLI Contract

Workflow commands:

```bash
subspace plan    <stack> [env] [--engine tofu|terraform] -- <engineArgs...>
subspace apply   <stack> [env] [--engine tofu|terraform] -- <engineArgs...>
subspace destroy <stack> [env] [--engine tofu|terraform] -- <engineArgs...>
```

Utility commands:

```bash
subspace doctor
```

Notes:

- `STACK` is required.
- `ENV` is optional; if omitted, Subspace runs with base-only configuration.
- `ENV` is always a bare word (no leading `-`). Any second positional argument before `--` is treated as `ENV`.
- All OpenTofu/Terraform flags must go after `--` so the CLI framework doesn't treat them as unknown options.
- `--engine` overrides the auto-detected engine for a single invocation.

## Engine Detection

`--engine` is a **global CLI flag** resolved at startup before command routing. All commands (including `doctor`) see the resolved engine.

Resolution priority (highest to lowest):

1. `--engine <name>` flag — error if the specified engine is not found on `$PATH`.
2. `SUBSPACE_ENGINE` env var — same behavior as the flag; useful in CI to avoid repeating `--engine` on every command.
3. Auto-detect: check for `tofu` on `$PATH`; if found, use it. Otherwise check for `terraform`.
4. If no engine is found by any method, exit with a clear error message.

The resolved engine binary is stored in `ctx` and used for all subprocess calls in that invocation.

## Project Conventions

Source stack directory:

- `app/stacks/<stack>/`

Stack env var files:

- `app/stacks/<stack>/tfvars/`

Emitted working directory (where `tofu`/`terraform` runs):

- `.subspace/build/<stack>/<env-or-noenv>/`
- If no env is provided, Subspace uses the sentinel directory name `__noenv__`.

See `docs/stack-layout.md` for the concrete layering and file mapping.

### Missing Stack Behavior

If `app/stacks/<stack>/` does not exist, Subspace exits immediately with a clear error before attempting any file operations or engine invocations:

```
error: stack "mystack" not found (expected app/stacks/mystack/)
```

## Engine Invocation

Subspace runs the selected engine using `-chdir=<dir>` (supported by OpenTofu and Terraform):

- `tofu -chdir=.subspace/build/<stack>/<env-or-noenv> plan ...`
- `terraform -chdir=.subspace/build/<stack>/<env-or-noenv> apply ...`

### Init-Only-When-Needed

For `plan/apply/destroy`:

1. If `.subspace/build/<stack>/<env-or-noenv>/.terraform/` is missing, run `init` with auto-injected `-backend-config` flags (see Backend Configuration). Output is streamed to the user's terminal.
2. Run the requested command.
3. If the command fails with an "init required"-style error, run `init` (with output streamed) and retry once.
4. Preserve the engine exit code.

Init output is always streamed to the user's terminal so provider download progress is visible.

## Clean Rebuild Rules

On each command invocation, Subspace materializes `app/stacks/<stack>/` into `.subspace/build/<stack>/<env-or-noenv>/` as follows:

1. Delete everything inside the emitted directory **except** the following (preserved to avoid unnecessary re-inits and state loss):
   - `.terraform/` (provider cache and backend state)
   - `.terraform.lock.hcl` (dependency lock file)
   - `terraform.tfstate` (local backend state, if present)
   - `terraform.tfstate.backup` (local backend state backup, if present)
2. Recursively copy all stack source files and directories into the emitted directory.
3. Do **not** copy:
   - `.terraform/` (excluded from source copy; the preserved copy stays in place)
   - `.subspace/` (build output must not nest)
   - `tfvars/` (Subspace writes layered var files directly; source tfvars are not copied)
4. Write layered `*.auto.tfvars` files into the emitted directory root.

Note: concurrent runs against the same stack+env combination are unsupported and may corrupt state.

## Backend Configuration

Subspace supports configuring the Terraform/OpenTofu backend via `app/stacks/<stack>/backend.tf` (or `backend.tf.json`), which is copied into the emitted directory as part of the clean rebuild.

### Automatic State Key Injection

Terraform and OpenTofu do not allow variables in `backend` blocks, so Subspace automatically injects the state key during `init` using `-backend-config`. This ensures state isolation across stacks and environments without requiring per-env backend files.

During `init`, Subspace passes backend config derived from the app name (cwd basename), stack, region, and env:

- **S3**:
  - `-backend-config=bucket=<app>-subspace-aws-state`
  - `-backend-config=key=subspace/aws/<region>/<env>/<stack>/subspace.tfstate`
- **GCS**:
  - `-backend-config=bucket=<app>-subspace-gcp-state`
  - `-backend-config=prefix=subspace/gcp/<region>/<env>/<stack>`
- **azurerm**:
  - `-backend-config=key=subspace/azure/<region>/<env>/<stack>/subspace.tfstate`

When `ENV` is omitted, `<env>` is replaced with `__noenv__`.

The user's `backend.tf` should define the backend type and non-path settings (bucket, region, etc.). The `key`/`prefix` can be omitted or set to a placeholder — Subspace overrides it at init time.

### Supported Backends

**Local** (default if no `backend.tf` is present):

```hcl
terraform {
  backend "local" {}
}
```

State is stored at `.subspace/build/<stack>/<env-or-noenv>/terraform.tfstate`. Not recommended beyond local development.

**S3 (AWS)**:

```hcl
terraform {
  backend "s3" {
    bucket         = "my-tfstate-bucket"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "my-tfstate-lock"
  }
}
```

Subspace injects:

- `-backend-config=bucket=<app>-subspace-aws-state`
- `-backend-config=key=subspace/aws/<region>/<env>/<stack>/subspace.tfstate`

**GCS (Google Cloud)**:

```hcl
terraform {
  backend "gcs" {
    bucket = "my-tfstate-bucket"
  }
}
```

Subspace injects:

- `-backend-config=bucket=<app>-subspace-gcp-state`
- `-backend-config=prefix=subspace/gcp/<region>/<env>/<stack>`

**Azure Blob Storage (`azurerm`)**:

```hcl
terraform {
  backend "azurerm" {
    resource_group_name  = "my-rg"
    storage_account_name = "mytfstateaccount"
    container_name       = "tfstate"
  }
}
```

Subspace injects: `-backend-config=key=subspace/azure/<region>/<env>/<stack>/subspace.tfstate`

### Re-init on Backend Changes

If you change `backend.tf` (e.g. switch from S3 to GCS), the preserved `.terraform/` directory may contain stale backend config. Terraform/OpenTofu may fail with a confusing error rather than a clean "init required" message. To force re-init, delete the emitted directory:

```bash
rm -rf .subspace/build/<stack>/<env>/
```

## Gitignore Strategy

The following files must be in `.gitignore`:

```
# Subspace build output
.subspace/

# Local and secret tfvars (never commit)
**/*.local.tfvars
**/*.secrets.tfvars
```

Source-controlled tfvars (`base.tfvars`, `<env>.tfvars`) are committed normally.

## Doctor Command

`subspace doctor` checks the local environment and reports the status of each item:

- `tofu` on `$PATH` — version if found, warning if not
- `terraform` on `$PATH` — version if found, info if not (not required if `tofu` present)
- Active engine (which one Subspace would use by default)
- `app/stacks/` directory exists
- For each discovered stack: whether `tfvars/base.tfvars` is present

Output is human-readable, not machine-parseable. Each check is either `ok`, `warn`, or `error`.

## Implementation Architecture

Subspace is defined as a tRPC router where each procedure is a CLI command.

- Entry point builds the CLI via `createCli({ router, name: "subspace", version }).run()`.
- Each command calls a functional implementation:
  - `runDoctor(ctx, input)`
  - `runPlan(ctx, input)`
  - `runApply(ctx, input)`
  - `runDestroy(ctx, input)`

The `ctx` is a plain object with injected side effects (`exec`, `fs`, `log`, `env`) so unit tests can run without spawning real processes. The resolved engine binary is also part of `ctx`.

## Build + Release

- Local build: `bun build src/cli.ts --compile --outfile dist/subspace`
- Version is stamped at build time from `$npm_package_version` or a `VERSION` env var.
- Initial target: macOS arm64.
- Releases: GitHub Releases with:
  - `subspace_darwin_arm64`
  - `SHA256SUMS`

## Installation

Two install methods:

1. **curl installer**: downloads the correct release asset, verifies checksum, installs `subspace` to `~/.local/bin` by default.
2. **Homebrew**: via a tap formula that downloads the release asset and installs the `subspace` binary.
