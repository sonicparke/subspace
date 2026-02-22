# Subspace

Terraspace-style CLI for OpenTofu and Terraform.

Subspace wraps OpenTofu/Terraform with convention-over-configuration project structure, automatic variable layering, and per-environment state isolation. It compiles to a single binary via Bun.

## Quick Start

**Prerequisites:** [Bun](https://bun.sh), [pnpm](https://pnpm.io), and [OpenTofu](https://opentofu.org) or [Terraform](https://www.terraform.io).

```bash
pnpm install
pnpm build          # produces dist/subspace
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
subspace new     <project|module|stack> <name> [backend] [region]
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
app/modules/<module>/
  main.tf
  variables.tf
  outputs.tf
app/stacks/<stack>/
  *.tf                        # Terraform/OpenTofu configuration
  backend.tf                  # Backend configuration
  providers.tf                # Provider config generated from project backend settings
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

Subspace auto-injects `-backend-config` during `init` to isolate state per stack and environment. The state key follows the pattern `subspace/<stack>/<env>/terraform.tfstate`.

Write your `backend.tf` as usual -- Subspace handles the key/prefix automatically:

**S3:**
```hcl
terraform {
  backend "s3" {
    bucket = "my-tfstate"
    region = "us-east-1"
    # key is injected by Subspace: subspace/<stack>/<env>/terraform.tfstate
  }
}
```

**GCS:**
```hcl
terraform {
  backend "gcs" {
    bucket = "my-tfstate"
    # prefix is injected by Subspace: subspace/<stack>/<env>
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
    # key is injected by Subspace: subspace/<stack>/<env>/terraform.tfstate
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

Subspace uses `.subspace/build/<stack>/<env>/` as the working directory for engine commands. On every invocation it performs a clean rebuild: all files are deleted **except** `.terraform/`, `.terraform.lock.hcl`, `terraform.tfstate`, and `terraform.tfstate.backup`, then stack source files are re-copied.

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
pnpm install         # Install dependencies
pnpm build           # Compile to dist/subspace
pnpm test            # Run tests
pnpm lint            # Lint with Biome
pnpm format          # Format with Biome
pnpm typecheck       # Type-check with tsc
```
