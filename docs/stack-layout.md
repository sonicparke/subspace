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

Subspace always runs OpenTofu/Terraform from an emitted directory:

```
.subspace/build/<stack>/<region>/<env-or-noenv>/
```

If `ENV` is omitted, Subspace uses the sentinel directory:

```
.subspace/build/<stack>/<region>/__noenv__/
```

Subspace performs a clean rebuild of the emitted directory on each command invocation.

## Clean Rebuild Rules (v0)

When materializing `app/stacks/<stack>` into `.subspace/build/...`:

1. Delete everything inside the emitted directory **except** the following (preserved across rebuilds):
   - `.terraform/` (provider cache and backend state)
   - `.terraform.lock.hcl` (dependency lock file)
   - `terraform.tfstate` (local backend state, if present)
   - `terraform.tfstate.backup` (local backend state backup, if present)
2. Recursively copy all stack source files and directories into the emitted dir.
3. Do **not** copy:
   - `.terraform/` (excluded from source copy; the preserved copy stays in place)
   - `.subspace/` (build output must not nest)
   - `tfvars/` (Subspace writes layered var files into the emitted root module)
4. Write layered `*.auto.tfvars` files into the emitted directory root.

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
tofu -chdir=.subspace/build/<stack>/<region>/<env-or-noenv> plan
terraform -chdir=.subspace/build/<stack>/<region>/<env-or-noenv> apply
```

Engine-specific args are always passed after `--` at the Subspace CLI level.
