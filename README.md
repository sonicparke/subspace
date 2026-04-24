# Subspace

Terraspace-style CLI for OpenTofu and Terraform.

Subspace wraps OpenTofu/Terraform with convention-over-configuration project structure, automatic variable layering, and per-environment state isolation. The CLI is built on [oscli](https://www.oscli.dev/) and compiles to a single binary via Bun.

## Features

- **CLI workflows:** `plan`, `apply`, `destroy`, `show`, `doctor`
- **Interactive generators:**
  - `new project` (backend + optional region)
  - `new module`
  - `new stack` (provider + optional region)
  - keyboard-navigable TUI for choice selection
- **Provider support (stack-level):** `aws`, `azure`, `gcp`, `cloudflare`
- **Backend support (project-level defaults):** `local`, `s3`, `gcs`, `azurerm`
- **Config scaffolding:** project `subspace.toml`, stack `subspace.toml`, generated `providers.tf`, and backend templates
- **Variable layering:** base, environment, local, and secret/local overlays
- **Engine selection:** `--engine`, `SUBSPACE_ENGINE`, and auto-detect (`tofu` then `terraform`)
- **Regionalized build layout (Terraspace-style):** `.subspace/build/<stack>/<region>/<env-or-noenv>/stacks/<stack>/` with a sibling `modules/` for referenced shared modules
- **State key isolation:** remote backend state paths include stack, region, and environment
- **Init-when-needed workflow:** auto-runs `init` when required and retries once on init-required failures

## Quick Start

**Prerequisites:** [Bun](https://bun.sh), and [OpenTofu](https://opentofu.org) or [Terraform](https://www.terraform.io).

```bash
bun install
bun run build       # produces dist/subspace
```

Create a stack and run your first plan:

```bash
dist/subspace new project demo
cd demo
dist/subspace new stack network
dist/subspace plan network
```

## CLI Usage

```
subspace plan    <stack> [env] [--engine tofu|terraform] -- <engineArgs...>
subspace apply   <stack> [env] [--engine tofu|terraform] -- <engineArgs...>
subspace destroy <stack> [env] [--engine tofu|terraform] -- <engineArgs...>
subspace show    <stack> [env] [--engine tofu|terraform] -- <engineArgs...>
subspace new project <name> [backend] [region]
subspace new module  <name>
subspace new stack   <name> [provider] [region]
subspace new                                  # interactive generator mode
subspace doctor
```

- **stack** is required. It maps to a directory under `app/stacks/`.
- **env** is optional. When omitted, only base-level config is used.
- Engine-specific flags (e.g. `-target`, `-var`) go after `--`.

### Examples

```bash
# Plan the "network" stack for production
subspace plan network prod

# Apply with an engine-specific target
subspace apply network staging -- -target=module.vpc

# Destroy with a specific engine
subspace destroy network dev --engine terraform

# Generate a new project scaffold
subspace new project demo

# Interactive generator prompts for missing values
subspace new
# Use arrow keys and Enter to navigate generator/backend choices

# Optional explicit backend for project scaffold
subspace new project demo s3

# Optional explicit region for s3/gcs backends
subspace new project demo s3 us-west-2

# Optional provider + region for stack scaffold
subspace new stack network aws us-west-2

# Generate a module inside a Subspace project
subspace new module vpc

# Generate a stack inside a Subspace project
subspace new stack network

# Check your local environment
subspace doctor
```

## Project Structure

```
config/terraform/
  backend.tf                  # Backend config (chosen during project generation, default local)
subspace.toml                 # Project policy (backend and defaults)
app/modules/<module>/
  main.tf
  variables.tf
  outputs.tf
app/stacks/<stack>/
  *.tf                        # Terraform/OpenTofu configuration
  backend.tf                  # Backend configuration
  providers.tf                # Provider config generated from project backend settings
  subspace.toml               # Stack policy (provider and defaults)
  tfvars/
    base.tfvars               # Always loaded
    <env>.tfvars              # Loaded when env is specified
    <env>.secrets.tfvars      # Loaded when env is specified (gitignored)
    local.tfvars              # Always loaded (gitignored)
    <env>.local.tfvars        # Loaded when env is specified (gitignored)
```

## Variable Layering

Subspace reads files from `app/stacks/<stack>/tfvars/` and writes numbered `*.auto.tfvars` files into the build directory. Later files override earlier ones.

| Source file             | Emitted as                   | Requires env? |
|-------------------------|------------------------------|---------------|
| `base.tfvars`           | `00-base.auto.tfvars`        | No            |
| `<env>.tfvars`          | `10-env.auto.tfvars`         | Yes           |
| `<env>.secrets.tfvars`  | `20-env-secrets.auto.tfvars` | Yes           |
| `local.tfvars`          | `90-local.auto.tfvars`       | No            |
| `<env>.local.tfvars`    | `95-env-local.auto.tfvars`   | Yes           |

Missing files are silently skipped.

## Backend Configuration

Subspace auto-injects `-backend-config` during `init` to isolate state per stack, region, and environment.

For remote backends, Subspace now derives a state bucket from the app directory name and backend scope (for example `demo-app-subspace-aws-state`) and injects state paths in this shape:

- `subspace/<scope>/<region>/<env>/<stack>/subspace.tfstate`
- scopes: `aws` (S3), `gcp` (GCS), `azure` (azurerm)

Write your `backend.tf` as usual -- Subspace handles the key/prefix automatically:

**S3:**
```hcl
terraform {
  backend "s3" {
    bucket = "my-tfstate"
    region = "us-east-1"
    # bucket is injected by Subspace: <app>-subspace-aws-state
    # key is injected by Subspace: subspace/aws/<region>/<env>/<stack>/subspace.tfstate
  }
}
```

**GCS:**
```hcl
terraform {
  backend "gcs" {
    bucket = "my-tfstate"
    # bucket is injected by Subspace: <app>-subspace-gcp-state
    # prefix is injected by Subspace: subspace/gcp/<region>/<env>/<stack>
  }
}
```

**Azure:**
```hcl
terraform {
  backend "azurerm" {
    resource_group_name  = "tfstate"
    storage_account_name = "tfstate"
    container_name       = "tfstate"
    # key is injected by Subspace: subspace/azure/<region>/<env>/<stack>/subspace.tfstate
  }
}
```

Local backends require no injection.

## Engine Selection

Subspace resolves which engine binary to use in this order:

1. `--engine` flag (`tofu` or `terraform`)
2. `SUBSPACE_ENGINE` environment variable
3. Auto-detect: prefers `tofu` if available, falls back to `terraform`

Run `subspace doctor` to see which engine is active.

## Build Directory

Subspace uses a Terraspace-style build layout rooted at `.subspace/build/<stack>/<region>/<env-or-noenv>/`:

```
.subspace/build/<stack>/<region>/<env-or-noenv>/
├── stacks/<stack>/          <- engine chdir target; cleaned-and-rebuilt every run
│   ├── main.tf              <- copied verbatim from app/stacks/<stack>/*.tf
│   ├── providers.tf         <- generated from subspace config
│   ├── backend.tf           <- copied if present
│   ├── 00-base.auto.tfvars  <- layered tfvars
│   ├── .terraform/          <- preserved across rebuilds
│   ├── .terraform.lock.hcl  <- preserved
│   └── terraform.tfstate*   <- preserved
└── modules/<name>/          <- sibling dir; copied fresh each run from app/modules/<name>/
```

On every invocation the `stacks/<stack>/` subdir is cleaned-and-rebuilt (all files deleted **except** `.terraform/`, `.terraform.lock.hcl`, `terraform.tfstate`, and `terraform.tfstate.backup`) then stack source files are re-copied. The `modules/` subdir is wiped and repopulated with only the modules that the stack (or any transitively referenced module) references via `source = "../../modules/<name>"`. This preserves the `stacks/<stack>/` ↔ `modules/<name>/` sibling relationship that user `.tf` files assume, without ever rewriting source.

You should never need to interact with this directory directly.

## .gitignore

The recommended `.gitignore` entries (included in this repo):

```gitignore
.subspace/
**/*.local.tfvars
**/*.secrets.tfvars
```

## Development

```bash
bun install          # Install dependencies
bun run build        # Compile to dist/subspace
bun test             # Run tests
bun run lint         # Lint with Biome
bun run format       # Format with Biome
bun run typecheck    # Type-check with tsc
```
