# Spec: Native State Migration for Terraspace Projects

Status: **Draft — awaiting human review**
Owner: (assign)
Related:

- `src/commands/migrate-stack.ts`
- `src/migrate/terraspace/plan.ts`
- `src/migrate/terraspace/key.ts`
- `src/migrate/terraspace/probe.ts`
- `src/migrate/terraspace/copy.ts`
- `src/engine/backend.ts`
- `src/engine/invoke.ts`

Test fixtures to update:

- `test/commands/migrate-stack.test.ts`
- `test/migrate/terraspace/plan.test.ts`
- `test/migrate/terraspace/key.test.ts`
- `test/migrate/terraspace/probe.test.ts`
- `test/migrate/terraspace/copy.test.ts`
- `test/cli/migrate-argv.test.ts`
- `test/engine/backend.test.ts`
- `test/engine/invoke.test.ts`

---

## Objective

Subspace migration currently treats the legacy Terraspace S3 key as both the source and the destination. That keeps Terraspace path shape alive after migration and forces users to keep caring about legacy-only concepts like `:APP`, stack instances, and irregular key ordering.

Build a migration flow where Terraspace-specific hints are used only to locate the legacy object, then state is copied into a clean native Subspace path. Future `plan`/`apply` commands should use the native path and should not require Terraspace lookup flags.

### Users & success

- **Primary users**: Engineers migrating existing Terraspace S3 state into Subspace.
- **Secondary users**: Teams automating repeatable migrations in CI.
- **Success**:
  1. `subspace migrate cost-engine-ecs qa --app costengine --instance costengine --profile vnh` can find legacy state at:
     `s3://terraform-state-733734425040-us-east-1-qa/main/us-east-1/qa/costengine/stacks/cost-engine-ecs.costengine/terraform.tfstate`
  2. The same command copies it to native state at:
     `s3://terraform-state-733734425040-us-east-1-qa/main/us-east-1/stacks/cost-engine-ecs/costengine/terraform.tfstate`
  3. Native keys do **not** repeat env in the key when the bucket is already env-scoped.
  4. Native keys do **not** preserve Terraspace `app`, `role`, or `instance` layout except as a normalized state `<name>`.
  5. Multiple logical states for one stack are represented as:
     `main/<region>/stacks/<stack>/<name>/terraform.tfstate`
  6. Legacy state is copied, not deleted. Pruning is a separate explicit follow-up command.

---

## Tech Stack

Unchanged:

- Runtime/build: Bun + TypeScript
- CLI framework: `@oscli-dev/oscli`
- Tests: Bun test runner with `vitest`-style imports
- Lint/format: Biome
- Engine: OpenTofu/Terraform
- External state probe/copy: AWS CLI via injected `SubspaceContext.exec`

No new runtime dependencies. Do not add a full HCL parser, TOML parser, Zod, or an AWS SDK dependency for this scope.

---

## Commands

Development:

```bash
pnpm install
pnpm test
pnpm test test/commands/migrate-stack.test.ts
pnpm test test/migrate/terraspace/plan.test.ts
pnpm test test/migrate/terraspace/key.test.ts
pnpm test test/migrate/terraspace/probe.test.ts
pnpm test test/migrate/terraspace/copy.test.ts
pnpm test test/engine/invoke.test.ts
pnpm lint
pnpm format
pnpm build
```

User-facing target commands:

```bash
# Preview: probe legacy and native addresses, do not copy.
subspace migrate cost-engine-ecs qa \
  --app costengine \
  --instance costengine \
  --profile vnh \
  --dry-run

# Apply: copy legacy state to native state, never delete legacy.
subspace migrate cost-engine-ecs qa \
  --app costengine \
  --instance costengine \
  --profile vnh

# Explicit native state name, useful for no-env or ambiguous instance stacks.
subspace migrate key-pair \
  --name vnh \
  --profile vnh
```

Interactive target behavior:

```text
Multiple legacy states found for key-pair.
Which native state name should this become?
  vnh
  deploy
  ops
  custom...
```

Non-interactive target behavior:

```text
Multiple legacy states found for key-pair. Re-run with --name <name>.
```

---

## Project Structure

No new top-level directories. Expected source changes:

```text
src/
├── cli/
│   ├── app.ts                  # add --name flag wiring for migrate
│   └── runtime.ts              # parse --name / --name=<value>
├── commands/
│   └── migrate-stack.ts        # build legacy+native plan, prompt for name if needed, copy to native
├── engine/
│   ├── backend.ts              # native migrated S3 backend key support
│   └── invoke.ts               # use native migrated backend location after migration
└── migrate/
    └── terraspace/
        ├── plan.ts             # split legacy source and native destination derivation
        ├── key.ts              # keep Terraspace expansion for legacy only
        ├── probe.ts            # probe candidate legacy/native objects
        └── copy.ts             # copy legacy -> native with overwrite guard

test/
├── cli/
├── commands/
├── engine/
└── migrate/terraspace/
```

Documentation updates:

```text
docs/specs/native-state-migration.md       # this spec
docs/ideas/subspace-terraspace-migration.md # update or supersede stale "preserve legacy state" language
CLAUDE.md / AGENTS.md                       # update CLI contract if --name ships
```

---

## Code Style

Functional only. All side effects go through `SubspaceContext`. Keep legacy and native address derivation explicit, with no classes and no global mutable state.

Example target shape:

```ts
interface MigrationPlanEntry {
  stack: string;
  env: string;
  region: string;
  name: string;
  legacy: { bucket: string; key: string };
  native: { bucket: string; key: string };
}

function nativeStateKey(input: {
  project: string;
  region: string;
  stack: string;
  name: string;
}): string {
  return `${input.project}/${input.region}/stacks/${input.stack}/${input.name}/terraform.tfstate`;
}
```

Key conventions:

- `legacy` means "where Terraspace wrote state."
- `native` means "where Subspace will use state after migration."
- Legacy key derivation may use `app`, `role`, `instance`, `extra`, and `key_template`.
- Native key derivation must not use Terraspace `app`, `role`, or `instance` directly.
- Native `<name>` is the logical state identity.
- Do not silently overwrite native state.

---

## Design

### Current behavior

`buildMigrationPlan()` currently derives one S3 location from the Terraspace templates and assigns that same object to both `legacy` and `native`.

That produces reports like:

```text
legacy: s3://.../main/us-east-1/qa/costengine/stacks/cost-engine-ecs.costengine/terraform.tfstate
native: s3://.../main/us-east-1/qa/costengine/stacks/cost-engine-ecs.costengine/terraform.tfstate
action: UNCHANGED
```

This is not a migration. It is a compatibility shim.

### Target behavior

`buildMigrationPlan()` must derive two addresses:

1. **Legacy source address**
   - Bucket from `bucket_template`, usually `terraform-state-:ACCOUNT-:REGION-:ENV`.
   - Key from `key_template`, using Terraspace hints:
     - `project`
     - `env`
     - `region`
     - `app`
     - `role`
     - `extra`
     - `instance`
     - `BUILD_DIR`

2. **Native destination address**
   - Same env-scoped bucket as the legacy source for MVP.
   - Key:
     `:PROJECT/:REGION/stacks/:STACK/:NAME/terraform.tfstate`

Concrete example:

```text
legacy bucket:
terraform-state-733734425040-us-east-1-qa

legacy key:
main/us-east-1/qa/costengine/stacks/cost-engine-ecs.costengine/terraform.tfstate

native bucket:
terraform-state-733734425040-us-east-1-qa

native key:
main/us-east-1/stacks/cost-engine-ecs/costengine/terraform.tfstate
```

### Name resolution

`name` is the native state identity.

Resolution order:

1. Explicit `--name <name>` wins.
2. If exactly one legacy instance is discovered, use that instance as `name`.
   - `stacks/cost-engine-ecs.costengine/terraform.tfstate` -> `name = "costengine"`
3. If exactly one non-instanced legacy state is discovered, use `default`.
   - `stacks/network/terraform.tfstate` -> `name = "default"`
4. If multiple candidate names exist:
   - In a TTY, prompt the user.
   - In non-interactive mode, return a usage-style error requiring `--name <name>`.

For base/no-env stacks like `key-pair`, `--name` creates a native key like:

```text
main/us-east-1/stacks/key-pair/vnh/terraform.tfstate
```

No env appears in the native key. Env remains represented by the bucket name.

### Copy semantics

Dry-run:

- Probe legacy source.
- Probe native destination.
- Print report.
- Do not write state.

Apply:

- Probe native destination immediately before copy.
- If native exists, skip copy and report `native-exists`.
- If legacy is missing, skip copy and report `legacy-missing`.
- If native is missing and legacy exists, copy legacy -> native.
- Never delete legacy.
- Never overwrite native.

### Backend behavior after migration

For migrated S3 projects, engine init should use the native migrated key:

```text
main/<region>/stacks/<stack>/<name>/terraform.tfstate
```

not:

```text
subspace/aws/<region>/<env>/<stack>/subspace.tfstate
```

and not the old Terraspace key.

This likely requires storing or deriving the selected `name` after migration. Options:

1. Persist per-stack/env migration mapping in `subspace.toml`.
2. Write a Subspace migration manifest under `.subspace/`.
3. Require future workflow commands to pass `--name` for migrated multi-state stacks.

Option 1 is the cleanest for long-term CLI ergonomics, but changes project config. This should be decided before implementation.

---

## Testing Strategy

### Unit tests

`test/migrate/terraspace/plan.test.ts`

- Builds a plan where legacy source is:
  `main/us-east-1/qa/costengine/stacks/cost-engine-ecs.costengine/terraform.tfstate`
- Asserts native destination is:
  `main/us-east-1/stacks/cost-engine-ecs/costengine/terraform.tfstate`
- Asserts bucket is unchanged:
  `terraform-state-733734425040-us-east-1-qa`
- Covers no-env/name case:
  `main/us-east-1/stacks/key-pair/vnh/terraform.tfstate`

`test/migrate/terraspace/key.test.ts`

- Keeps legacy Terraspace `BUILD_DIR` expansion tests.
- Adds parser/normalizer tests for instance extraction from:
  - `stacks/cost-engine-ecs.costengine/terraform.tfstate`
  - `stacks/network/terraform.tfstate`

`test/commands/migrate-stack.test.ts`

- Dry-run report includes distinct legacy and native S3 URIs.
- Non-dry-run copies from legacy to native.
- Native exists guard prevents overwrite.
- Multiple candidate names prompts in TTY mode.
- Multiple candidate names fails in non-TTY mode with `--name` guidance.
- `--name` bypasses prompt.

`test/migrate/terraspace/copy.test.ts`

- Existing copy safety tests continue to pass.
- Assert `aws s3 cp` source is legacy and destination is native.

`test/engine/backend.test.ts` and `test/engine/invoke.test.ts`

- Backend config for migrated S3 project uses native migrated key.
- Plan/apply no longer use Terraspace legacy key after migration.

### Integration-style checks

Mocked report output should show:

```text
- legacy: FOUND — s3://terraform-state-733734425040-us-east-1-qa/main/us-east-1/qa/costengine/stacks/cost-engine-ecs.costengine/terraform.tfstate
- native: MISSING — s3://terraform-state-733734425040-us-east-1-qa/main/us-east-1/stacks/cost-engine-ecs/costengine/terraform.tfstate
- action: COPIED — legacy -> native
```

### Verification commands

```bash
pnpm test test/migrate/terraspace/plan.test.ts
pnpm test test/commands/migrate-stack.test.ts
pnpm test test/engine/invoke.test.ts
pnpm test
pnpm lint
pnpm build
```

---

## Boundaries

### Always do

- Keep Terraspace compatibility strictly behind `[migration]`.
- Keep `migrate init` offline.
- Preserve legacy state during migrate.
- Refuse to overwrite native state.
- Show both source and destination in reports.
- Use `createMockContext()` in tests.
- Run `pnpm test`, `pnpm lint`, and `pnpm build` before declaring done.

### Ask first

- Changing `subspace.toml` schema to persist per-stack/env `name` mappings.
- Adding a native key template setting.
- Making `plan`/`apply` prompt for state names.
- Deleting or moving legacy state.
- Supporting non-S3 backends.

### Never do

- Never delete legacy state as part of `subspace migrate`.
- Never silently choose among multiple native names.
- Never auto-overwrite an existing native state object.
- Never require Terraspace flags after migration for normal `plan`/`apply`.
- Never add AWS SDK or schema dependencies for this scope.

---

## Success Criteria

1. `subspace migrate cost-engine-ecs qa --app costengine --instance costengine --name costengine --profile vnh --dry-run` reports:
   - legacy source:
     `s3://terraform-state-733734425040-us-east-1-qa/main/us-east-1/qa/costengine/stacks/cost-engine-ecs.costengine/terraform.tfstate`
   - native destination:
     `s3://terraform-state-733734425040-us-east-1-qa/main/us-east-1/stacks/cost-engine-ecs/costengine/terraform.tfstate`
2. Running the same command without `--dry-run` copies legacy -> native when native is missing and legacy exists.
3. Re-running migrate does not overwrite native state.
4. `subspace migrate key-pair --name vnh --profile vnh --dry-run` reports native destination:
   `s3://terraform-state-733734425040-us-east-1-qa/main/us-east-1/stacks/key-pair/vnh/terraform.tfstate`
5. Multiple candidate names prompt in TTY mode and fail with guidance in CI/non-TTY mode.
6. After migration, `subspace plan <stack> [env]` uses the native migrated state path without needing `--app`, `--instance`, or `--name`.
7. Full validation passes:
   - `pnpm test`
   - `pnpm lint`
   - `pnpm build`

---

## Open Questions

1. Where should the selected native `name` be persisted so future `plan`/`apply` do not need `--name`?
2. Should native migrated keys be hardcoded as `main/<region>/stacks/<stack>/<name>/terraform.tfstate`, or should `project` remain configurable from `[migration.terraspace].project`?
3. For non-instanced single-state stacks, should the default native name be `default`, the stack name, or omitted? Current recommendation: `default`.
4. How should `doctor --legacy` report migrated stacks: by comparing legacy vs native object existence, or by reading a persisted migration manifest?

---

## Assumptions

1. S3 is the only backend in scope.
2. Bucket names remain env-scoped for migrated Terraspace projects.
3. Native keys should not repeat env in the key.
4. Native keys use a name segment for all migrated state, including single-state stacks.
5. Copying state is acceptable during `subspace migrate`; deleting state is not.
6. Interactive prompting is acceptable for humans, but CI must be deterministic.
