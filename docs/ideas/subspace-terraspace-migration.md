# Subspace × Terraspace: Compatibility Without Compromise

## Problem Statement
How might we let Terraspace users adopt Subspace without rewriting their
Terraform, re-importing their state, or carrying Terraspace's conceptual
debt into their new home?

## Core Principle: Terraspace Compatibility Is Strictly Opt-In

A user adopting Subspace on a fresh Terraform project must never
encounter Terraspace concepts in normal operation. Every legacy code
path must be gated behind an explicit config field or explicit
command flag. Concretely:

- Dual-read backend lookups only fire when `[migration]` is present
  in `subspace.toml` with an explicit `terraspace_legacy = true`.
- `subspace migrate` refuses to run against projects that don't look
  like Terraspace projects and points the user at `subspace new project`.
- Terraspace variables (`:PROJECT`, `:APP`, `:ROLE`, `:EXTRA`, etc.)
  never leak into the native `subspace.toml` schema. They live only
  inside the opt-in `[migration]` section.
- The main README never mentions Terraspace in quick-start or core
  workflow sections. Migration docs live in a separate
  `docs/migrate-from-terraspace.md`.
- No auto-detection of Terraspace artifacts. Auto-detection means
  "I looked," and that cost should not be borne by pure-TF users.

**Test of the principle:** a pure Terraform user should be able to
read the Subspace README, run the quick-start, and ship a stack to
prod without ever encountering the word "Terraspace."

## Migration Config Schema (Locked)

The `[migration]` section in `subspace.toml` uses **per-source
sub-tables**, not prefixed field names. A single `source` field
selects exactly one migration origin per project.

```toml
[migration]
source = "terraspace"   # required; one of: "terraspace", "terragrunt" (future)

[migration.terraspace]
key_template    = ":PROJECT/:REGION/:APP/:ROLE/:ENV/:EXTRA/:BUILD_DIR/terraform.tfstate"
bucket_template = "terraform-state-:ACCOUNT-:REGION-:ENV"
# project, app, role, extra: optional static overrides when the old
# TS_* env vars are not discoverable from the project files
project = "main"
```

When Terragrunt support lands, it follows the same shape:

```toml
[migration]
source = "terragrunt"

[migration.terragrunt]
# fields TBD when Terragrunt migration is designed
```

**Why this shape:**
- `source` is a single required value; multi-source hybrids are out
  of scope (revisit only with evidence).
- Sub-tables namespace source-specific fields cleanly; adding
  Terragrunt fields later cannot collide with Terraspace fields.
- Consumers (dual-read, probe, `migrate`) switch on `source` and
  call the matching source module. No forced shared interface.

## Source Layout (Locked)

Migration code is organized per source, with a thin `common/` folder
for source-agnostic primitives:

```
src/migrate/
  terraspace/
    key.ts          # Terraspace template expansion (ported from Ruby)
    backend-tf.ts   # regex extractor for ERB templates (future)
    detect.ts       # "does this look like a Terraspace project?" (future)
  terragrunt/       # future; parallel shape
  common/           # future; source-agnostic dual-read, plan, report
```

Each source module exposes its own `deriveLegacyKey()` signature.
Consumers dispatch on `[migration].source` rather than conforming
to a shared interface — Terraspace and Terragrunt compute keys
fundamentally differently (template expansion vs. directory walk +
HCL resolution).

## Recommended Direction

Subspace absorbs Terraspace's migration surface through three narrow,
well-defined seams — and refuses to absorb anything else.

1. **Input adapters, not compatibility.** `TS_ENV` maps to the `env`
   positional. `TS_ROLE` maps to `[provider.settings.profile]` in the
   stack's `subspace.toml`. `TS_EXTRA` maps to a typed `extras[]` list
   consumed as tfvars. These mappings are honored *only* by
   `subspace migrate` when reading legacy projects. They are not
   runtime env vars that Subspace commands respect. Old CI pipelines
   do not magically work; the migration tool rewrites them.

2. **Native state after migration.** Subspace derives the legacy
   Terraspace key only to find the old state object. `subspace migrate`
   then copies that object to a native migrated key:
   `main/<region>/stacks/<stack>/<name>/terraform.tfstate` in the same
   env-scoped S3 bucket. Terraform thereafter writes exclusively to the
   native key. The legacy object is preserved until an explicit prune
   command removes it.
   No `terraform import`. No resource churn.

3. **`subspace migrate` follows Subspace's native `<stack> [env]` shape.**
   The verb splits into two subcommands so that scaffolding (one-shot,
   project-level) and probing (per-stack, repeatable) stay separate:

   ```
   subspace migrate init <legacy-path>     # one-shot: extract templates
       [--out <dir>]                       # from backend.tf, discover
       [--regions us-east-1,us-west-2]     # stacks/envs, write
       [--app-name my-app]                 # subspace.toml with
       [--force]                           # [migration].source = "terraspace"

   subspace migrate <stack> [env]          # per-stack: read [migration]
       [--dry-run]                         # from cwd subspace.toml,
       [--report-file <path>]              # build a single-row plan,
       [--regions ...]                     # probe legacy + native S3 keys
       [--name <state_name>]               # native state identity
   ```

   `migrate init` is offline (no AWS calls). It writes `subspace.toml`
   into cwd (or `--out`) and never touches `.tf` files. `migrate <stack>`
   reads `[migration].terraspace.{bucket_template,key_template,project,
   regions,app_name}` and dispatches to the per-source key derivation.
   This rhymes with `subspace plan <stack> [env]` and friends — zero
   new vocabulary for users who already know Subspace.

The source tree stays flat — no `live/`, no per-env directories, no
Terragrunt HCL. All DRY happens at build time, materialized into
`.subspace/build/<stack>/<region>/<env>/stacks/<stack>/` (with a sibling `modules/` for referenced shared modules) as a self-contained, stock
Terraform working directory. A developer without Subspace installed
can still `cd app/stacks/<stack> && tofu init && tofu plan` with the
right flags and get a working result.

## Key Assumptions to Validate

Status legend: `[ ]` = open; `[x]` = validated; `[>]` = tooling ready,
awaiting a human to run it against real projects (see
[scripts/migrate-validation/](../../scripts/migrate-validation/)).

- [>] **Legacy key scheme is derivable.** Terraspace's state-key format
      is predictable from `config/app.rb` + env + stack name. Validate
      by pointing a read-only dual-read prototype at a real Terraspace
      S3 bucket and confirming every expected state object is reachable.
      Harness: `scripts/migrate-validation/probe-all.sh`. Record
      coverage percentage and any `:EXTRA`/non-default `:BUILD_DIR`
      exceptions below this list when done.
- [x] **S3 object copy is atomic enough.** `aws s3 cp` (or the SDK
      `CopyObject` API) within a single region is effectively atomic
      for tfstate-sized objects. Validated: AWS documents `CopyObject`
      as a single atomic server-side operation with strong
      read-after-write consistency for S3 objects (post-Dec 2020
      consistency model). A tfstate file fits comfortably in the 5 GB
      single-part copy limit. Subspace uses `aws s3 cp` via `ctx.exec`;
      concurrent writer protection comes from the native-key
      `head-object` guard (refuse to copy if native already exists),
      not from the copy primitive itself. Mocked property test:
      `test/migrate/terraspace/copy.property.test.ts`.
- [>] **`TS_ROLE` really is always an AWS profile in scope.** You said
      this about your own projects. Validate by grepping every
      Terraspace project you plan to migrate for `TS_ROLE=` usages
      and confirming none of them encode structural/logical roles.
      Harness: `scripts/migrate-validation/ts-role-audit.sh`. Record
      totals and any suspicious hits below this list when done.
- [x] **Users accept "migrate is one-way."** The permanent-shim option
      is off the table in this design. Both the probe-only and
      dry-run report footers in `src/commands/migrate-stack.ts` now
      include an explicit one-way sentence; tests pin this in
      `test/commands/migrate-stack.test.ts`.

## MVP Scope

**In (all shipped):**
- [x] `subspace migrate init <path-to-terraspace-project>` — reads
  legacy project, writes `subspace.toml` with a `[migration]` block,
  never touches `.tf` files or state. Offline.
  ([src/commands/migrate-init.ts](../../src/commands/migrate-init.ts))
- [x] `subspace migrate <stack> [env] --dry-run` — reads `[migration]`
  from cwd `subspace.toml`, derives legacy and native S3 keys,
  probes both with `aws s3api head-object`, prints a markdown
  report. Read-only.
  ([src/commands/migrate-stack.ts](../../src/commands/migrate-stack.ts))
- [x] Native migrated backend injection: after `subspace migrate`
  records the native state name in stack config, `plan`/`apply` init
  uses the native migrated key directly.
  ([src/engine/invoke.ts](../../src/engine/invoke.ts),
  [src/migrate/terraspace/copy.ts](../../src/migrate/terraspace/copy.ts))
- [x] `subspace doctor` gains a `--legacy` mode that lists which stacks
  are still reading from legacy keys vs. native keys.
  ([src/commands/doctor.ts](../../src/commands/doctor.ts))
- [x] S3 backend only. GCS/azurerm dual-read deferred; `migrate <stack>`
  returns `non-s3-backend` and `invokeEngine` emits a warn-and-continue
  message when a migration config is paired with a non-S3 backend.

**Out (deliberately):**
- Multi-unit stacks. One stack = one deployable.
- Runtime `TS_*` env var honoring. Migrate-time only.
- Terragrunt-style `live/` directory. Flat `app/stacks/` stays.
- `subspace state prune`. Ships in a follow-up, post-verification
  window.
- Projection manifests, permanent shims, or any design that keeps
  legacy keys as a long-term read path.

## Not Doing (and Why)

- **No `TS_*` env vars at runtime.** Carrying them forward makes
  Subspace a Terraspace superset. You explicitly want clarity over
  compatibility. Adapter-only.
- **No `unit` concept at MVP.** Adding `unit` to the build-dir
  schema, CLI, and config is weeks of work with no user demand
  in your target population. Revisit only if a migration surfaces
  real multi-unit usage.
- **No Terragrunt-style directory layout.** The flat `app/stacks/`
  layout plus build-time synthesis gives you DRY without
  vendor-locking the repo. You get Terragrunt's rigor without
  Terragrunt's tax.
- **No state prune at MVP.** Pruning before users have verified
  Subspace in production for their workload is the one thing that
  could destroy real infrastructure. Ship it as a separate,
  explicit, gated command once dual-read has bedded in.
- **No config/app.rb continued support.** Migration reads it once
  and translates. Subspace never executes Ruby.

## Open Questions

- What's the legacy key format you need to support? (AWS S3 path
  template used by your Terraspace install — exact shape.)
- Does `subspace migrate` need to handle multiple backends in one
  project, or is S3-only acceptable for v1?
- Should `migrate` be idempotent (re-runnable against an
  already-migrated repo) or strictly one-shot-with-guard?
- How does dual-read interact with `-backend-config` overrides a
  user might pass via `--` engine args? (Precedence needs spelling
  out.)

## Follow-Up: `subspace state prune`

Ships after MVP bakes in production. Requirements:

- Verifies the native state key exists in the remote backend.
- Verifies the native key's `serial` is >= the legacy key's `serial`.
- Verifies a dry-run `plan` against the native key produces no diff.
- Only then deletes the legacy S3 object (with an S3 version marker
  retained for 30 days as a safety net).
- Requires `--confirm` and prints the exact objects to be deleted
  before acting.
