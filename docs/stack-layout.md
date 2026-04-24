# Stack Layout and Var Layering

This document defines how Subspace maps stacks and env var files into an emitted working directory.

## Stack Source Layout

Subspace expects stack sources under:

```
app/stacks/<stack>/
```

Subspace expects stack variable files under:

```
app/stacks/<stack>/tfvars/
```

## Emitted Working Directory

Subspace always runs OpenTofu/Terraform from an emitted per-stack working directory. The build root contains `stacks/` and `modules/` as siblings (Terraspace-style), so that user `source = "../../modules/<name>"` references resolve without any source rewriting.

```
.subspace/build/<stack>/<region>/<env-or-noenv>/       <- build root
├── stacks/<stack>/                                    <- engine chdir target
└── modules/<name>/                                    <- only modules referenced by this stack
```

If `ENV` is omitted, Subspace uses the sentinel directory name `__noenv__`:

```
.subspace/build/<stack>/<region>/__noenv__/stacks/<stack>/
```

Subspace performs a clean rebuild of the per-stack working directory and a full wipe+repopulate of `modules/` on each command invocation.

## Clean Rebuild Rules

When materializing `app/stacks/<stack>` + referenced `app/modules/<name>/` into `.subspace/build/...`:

1. Under `<buildRoot>/stacks/<stack>/`, delete everything **except** the following (preserved across rebuilds):
   - `.terraform/` (provider cache and backend state)
   - `.terraform.lock.hcl` (dependency lock file)
   - `terraform.tfstate` (local backend state, if present)
   - `terraform.tfstate.backup` (local backend state backup, if present)
2. Recursively copy all stack source files and directories into `<buildRoot>/stacks/<stack>/`.
3. Do **not** copy:
   - `.terraform/` (excluded from source copy; the preserved copy stays in place)
   - `.subspace/` (build output must not nest)
   - `tfvars/` (Subspace writes layered var files into the emitted root module)
4. Write layered `*.auto.tfvars` into `<buildRoot>/stacks/<stack>/`, then emit `providers.tf` by one of:
   - **Project file present**: copy `config/terraform/providers.tf` verbatim, substituting every occurrence of the literal `__SUBSPACE_REGION__` with the current target region. The project file is authoritative.
   - **Project file absent, stack `subspace.toml` present**: generate in-memory via `providerTfForRegion()` from the stack config (provider, region, per-region overrides). This is the pre-authoritative fallback path.
   - **Neither present**: no `providers.tf` is written; the engine relies on whatever the user placed in `app/stacks/<stack>/`.
5. Wipe `<buildRoot>/modules/` and copy each distinct module referenced by any `.tf` file in the staged stack (or any transitively referenced module) from `app/modules/<name>/` into `<buildRoot>/modules/<name>/`.
   - Module discovery matches `source = "(./|../)+modules/<name>"` (line-level; `#` and `//` commented-out lines are ignored).
   - A referenced module that does not exist at `app/modules/<name>/` causes a fast-fail error.

Note: concurrent runs against the same stack+env combination are unsupported.

## Var Layering

Subspace loads variables by generating `*.auto.tfvars` files inside the emitted directory.

Source files (if present) are applied in this order:

1. `tfvars/base.tfvars`
2. If `ENV` is provided: `tfvars/<env>.tfvars`
3. If `ENV` is provided: `tfvars/<env>.secrets.tfvars`
4. `tfvars/local.tfvars`
5. If `ENV` is provided: `tfvars/<env>.local.tfvars`

## Mapping to Emitted Auto-Loaded Files

Subspace writes the layered values into the emitted directory as these files:

- `00-base.auto.tfvars`
- `10-env.auto.tfvars`
- `20-env-secrets.auto.tfvars`
- `90-local.auto.tfvars`
- `95-env-local.auto.tfvars`

Notes:

- This avoids needing `-var-file` flags and keeps the emitted directory self-contained.
- When `ENV` is omitted, only `00-base.auto.tfvars` and `90-local.auto.tfvars` are eligible.

## Engine Execution

Subspace runs the engine with `-chdir`:

```bash
tofu -chdir=.subspace/build/<stack>/<region>/<env-or-noenv>/stacks/<stack> plan
terraform -chdir=.subspace/build/<stack>/<region>/<env-or-noenv>/stacks/<stack> apply
```

Engine-specific args are always passed after `--` at the Subspace CLI level.
