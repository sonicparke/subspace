# Spec: Project-Level `providers.tf` at `subspace new project`

Status: **Draft — awaiting human review**
Owner: (assign)
Related: `src/commands/new.ts`, `src/commands/workflow.ts`, `src/regions/provider-template.ts`, `src/domain/providers.ts`
Test fixtures to update: `test/commands/new.test.ts`, `test/integration/cli.test.ts`, `test/commands/plan.test.ts`

---

## Objective

`subspace new project <name>` currently scaffolds `config/terraform/backend.tf` but does **not** emit a provider file. The per-stack `providers.tf` is generated twice: once on disk by `new stack` into `app/stacks/<stack>/providers.tf`, and once in-memory at build time by `providerTfForRegion()` into `<buildRoot>/stacks/<stack>/providers.tf`. This is confusing (two sources of truth) and undermines the project-wide provider concept that already exists in `subspace.toml`'s `[project]` section.

This change makes the project-level `providers.tf` the **single authoritative template** for provider configuration across all stacks, with per-region substitution happening at build time.

### Users & success

- **Primary user**: Developer bootstrapping a new Subspace project who wants a visible, editable, version-controlled project-wide provider configuration.
- **Success**:
  1. `subspace new project demo --provider aws --region us-west-2` produces `demo/config/terraform/providers.tf` containing an AWS provider block with a region placeholder.
  2. `subspace new project demo` (no `--provider`) produces **no** `providers.tf` — today's behavior preserved for provider-agnostic projects.
  3. When `config/terraform/providers.tf` exists, `subspace plan <stack>` and `subspace apply <stack>` copy it into `<buildRoot>/stacks/<stack>/providers.tf` after region substitution, instead of generating a new file.
  4. When `config/terraform/providers.tf` is absent, the build pipeline falls back to today's in-memory generation via `providerTfForRegion()` — zero regression for existing projects.
  5. `subspace new stack` no longer writes `app/stacks/<stack>/providers.tf`. Stack source trees contain only `main.tf`, `backend.tf`, and `tfvars/`.

---

## Tech Stack

Unchanged: Bun + TypeScript + `@oscli-dev/oscli` + Biome + Bun test runner. No new dependencies.

---

## Commands

```bash
pnpm install           # install
pnpm test              # bun test — run full suite
pnpm test test/commands/new.test.ts          # focused unit tests
pnpm test test/commands/workflow             # focused build-pipeline tests
pnpm test test/integration/cli.test.ts       # end-to-end CLI scaffold test
pnpm lint              # biome lint
pnpm format            # biome format --write .
pnpm build             # compile dist/subspace + install to $HOME/.local/bin/subspace
```

Post-implementation manual check (required before marking done):

```bash
cd /tmp && rm -rf subspace-spec-demo
subspace new project subspace-spec-demo --backend local --provider aws --region us-west-2
cat subspace-spec-demo/config/terraform/providers.tf   # must exist, contain 'provider "aws"'
cat subspace-spec-demo/config/terraform/backend.tf     # unchanged
ls subspace-spec-demo/app/stacks                       # empty (.keep only)
```

---

## Project Structure

No new top-level directories. Files touched:

```
src/
├── commands/
│   ├── new.ts                  # EDIT: write config/terraform/providers.tf when provider supplied; stop writing per-stack providers.tf
│   └── workflow.ts             # EDIT: prefer config/terraform/providers.tf when present; fall back to providerTfForRegion()
├── regions/
│   └── provider-template.ts    # EDIT: add rewriteProviderTfRegion() that substitutes region in an existing providers.tf string
└── domain/
    └── providers.ts            # EDIT: add REGION_PLACEHOLDER constant ("__SUBSPACE_REGION__") and use it in renderProviderTf() when settings.region is undefined

test/
├── commands/
│   ├── new.test.ts             # EDIT: flip the "provider.tf is undefined" assertion; add positive cases
│   └── plan.test.ts            # EDIT/ADD: assert build uses config/terraform/providers.tf when present
├── regions/
│   └── provider-template.test.ts  # ADD: rewriteProviderTfRegion unit tests
└── integration/
    └── cli.test.ts             # EDIT: assert new project emits providers.tf when --provider supplied

docs/
├── specs/
│   └── project-providers-tf.md  # THIS FILE
├── stack-layout.md             # EDIT: document new build-time resolution order
└── features.md                 # EDIT: mention project-level providers.tf
```

---

## Code Style

Functional only, matches existing codebase. Example of the edit shape:

```ts
// src/commands/new.ts — new branch in generateProject()
if (provider) {
  const providerSettings = defaultProviderSettings(provider, { region });
  await ctx.fs.writeFile(
    `${name}/config/terraform/providers.tf`,
    renderProviderTf(provider, providerSettings),
  );
}
```

Key conventions preserved:

- No classes, no `this`.
- All I/O via `ctx.fs.*` and `ctx.log.*`.
- No new dependencies (no Zod, no full TOML, no HCL library).
- Region placeholder is a plain string constant, not a template engine.

---

## Design

### Today's state (before this change)

1. `new project` → writes `config/terraform/backend.tf` only.
2. `new stack` → writes `app/stacks/<stack>/providers.tf` (per-stack, per-provider, no region substitution).
3. Build pipeline (`workflow.ts:86`) → always regenerates `<buildRoot>/stacks/<stack>/providers.tf` in-memory via `providerTfForRegion()`, which reads stack-level `subspace.toml` + region overrides.

Two sources of truth (on-disk + in-memory); per-stack file is immediately overwritten at build time.

### Target state

1. `new project --provider <p> [--region <r>]` → writes `config/terraform/providers.tf` containing a provider block with either a concrete region (if `--region` supplied) or the literal token `__SUBSPACE_REGION__`.
2. `new project` without `--provider` → does **not** write `providers.tf`. Behavior identical to today.
3. `new stack` → no longer writes `app/stacks/<stack>/providers.tf`.
4. Build pipeline resolution order at `workflow.ts:86`:
  - **If** `config/terraform/providers.tf` exists: read it, substitute `__SUBSPACE_REGION__` with the target region (from per-region overrides or `providerTfForRegion()`'s region logic), write to `<buildRoot>/stacks/<stack>/providers.tf`.
  - **Else**: fall back to today's behavior — in-memory generation via `providerTfForRegion()`.
5. Per-stack `app/stacks/<stack>/providers.tf` is intentionally **not** supported as a source. If a user creates one manually, it is copied by the clean-rebuild step but then **overwritten** by the build pipeline's providers.tf emission. This is the same overwrite relationship that exists today; we only change what feeds the emission.

### Region substitution contract

- The placeholder is the literal string `__SUBSPACE_REGION__`.
- It is only used when `renderProviderTf()` is called with `settings.region === undefined` (i.e., the project was scaffolded without `--region`).
- If the user later edits the file and types a real region, the placeholder disappears and region substitution becomes a no-op (safe by design — `String.prototype.replace` on a missing substring is a no-op).
- The placeholder is chosen to be obviously non-AWS/non-GCP/non-terraform-keyword; grep-safe; all-caps with underscores.
- Per-region overrides from stack-level `subspace.toml` (`provider.region_overrides.<region>`) continue to apply via `providerTfForRegion()`'s merge logic, but only in the fallback path. When the project-level file is authoritative, **region is the only field substituted**. Other overrides (e.g., `project` for GCP) require the user to edit `config/terraform/providers.tf` directly.

### Why not copy the file verbatim?

Because Subspace fans out across regions (`.subspace/build/<stack>/<region>/<env>/...`), a literal copy would force every stack to run in one region, defeating multi-region fanout. The templated region is the minimum viable regionalization for an on-disk authoritative file without introducing a full templating engine.

### Why keep the fallback path?

Backward compatibility. Projects created before this change have no `config/terraform/providers.tf` and must continue to work. This also preserves the "provider-agnostic project" case (`new project` with no `--provider`).

---

## Testing Strategy

### Test framework & location

Unchanged: `bun test`, `test/` mirrors `src/`, `createMockContext()` for all I/O.

### Unit tests (required)

`**test/commands/new.test.ts`** — edit and add:

- FLIP: "creates project scaffold with selected backend" — remove the assertion `ctx.files["demo/config/terraform/provider.tf"]).toBeUndefined()`. Leave the file absent when `--provider` is not passed; add a new assertion that `ctx.files["demo/config/terraform/providers.tf"]` is `undefined` (note plural).
- ADD: "creates project scaffold with providers.tf when provider supplied"
  - Input: `{ generator: "project", name: "demo", backend: "s3", region: "us-west-2", provider: "aws" }`
  - Assert: `ctx.files["demo/config/terraform/providers.tf"]` contains `provider "aws"` and `region = "us-west-2"`.
- ADD: "creates project providers.tf with region placeholder when no region supplied"
  - Input: `{ generator: "project", name: "demo", provider: "aws" }`
  - Assert: file contains `region = "__SUBSPACE_REGION__"`.
- FLIP: "creates a stack scaffold" — remove the assertion that `app/stacks/network/providers.tf` is written. Assert it is `undefined`.
- KEEP: "creates provider config in stack for s3 backend from project config" — repurpose: rename the test, now assert the **project-level** file was written by a prior `new project` call (or seed it via `files:`) and the **build-pipeline test** (below) exercises the copy.

`**test/regions/provider-template.test.ts`** — add:

- `rewriteProviderTfRegion("...region = \"__SUBSPACE_REGION__\"...", "us-east-1")` returns a string with `region = "us-east-1"`.
- Idempotent when no placeholder present.
- Does not modify unrelated `region =` occurrences (e.g., inside `backend "s3" { region = ... }` blocks would not appear in a providers.tf, but guard anyway).

`**test/commands/plan.test.ts` / new `test/commands/workflow.test.ts**` — add:

- When `config/terraform/providers.tf` is seeded in the mock fs, `runPlan` (or the underlying `runWorkflow`) writes that file (with region substituted) into the emitted build dir, and does **not** call `providerTfForRegion()`.
- When the project-level file is absent, the current in-memory generation path is used (behavior unchanged from today).

### Integration test

`**test/integration/cli.test.ts`** — extend:

- `subspace new project demo --provider aws --region us-west-2` produces a `providers.tf` at `demo/config/terraform/providers.tf`.

### Coverage expectations

- New branches in `src/commands/new.ts` (provider supplied / not supplied): both covered.
- New branches in `src/commands/workflow.ts` (project file present / absent): both covered.
- `rewriteProviderTfRegion()`: placeholder present, placeholder absent, multiple occurrences (deterministic).

---

## Boundaries

**Always do:**

- Run `pnpm test` before declaring any phase complete.
- Run `pnpm build` after implementation — per `CLAUDE.md`, the binary at `$HOME/.local/bin/subspace` is part of "done."
- Preserve today's fallback behavior when `config/terraform/providers.tf` is absent. No regressions for pre-existing projects.
- Keep the change to four files in `src/` or fewer (`new.ts`, `workflow.ts`, `provider-template.ts`, `providers.ts`).
- Update `docs/stack-layout.md` and `docs/features.md` alongside the code change.

**Ask first:**

- Renaming the placeholder token (`__SUBSPACE_REGION__`) — it becomes a user-facing string once written to disk.
- Extending this to per-stack overrides of `project` (GCP) or other non-region fields — out of scope for this spec.
- Adding a migration for existing projects (scanning `app/stacks/*/providers.tf` and hoisting to `config/terraform/providers.tf`) — out of scope; can be a follow-up.
- Introducing a templating library (Handlebars, Mustache, etc.) — rejected; binary size.
- Changing `subspace.toml` schema.

**Never do:**

- Add Zod, tRPC, or any runtime schema library.
- Add a full TOML parser (the `toml-lite.ts` constraint stands).
- Read the placeholder from env or config — it's a compile-time constant in `src/domain/providers.ts`.
- Write `config/terraform/providers.tf` when `--provider` is not supplied (respects the "opt-in" answer to Question 2).
- Leave `app/stacks/<stack>/providers.tf` in stack source after `new stack` — that file's existence is what created the two-sources-of-truth bug.

---

## Success Criteria

Concrete, testable:

1. `pnpm test` passes with the edited + new tests above.
2. `pnpm lint` and `pnpm format --check .` (or `pnpm format` producing no diff) pass.
3. Manual integration check (command block in the **Commands** section) produces:
  - A file at `subspace-spec-demo/config/terraform/providers.tf` containing `provider "aws"` and `region = "us-west-2"`.
  - No file at `subspace-spec-demo/app/stacks/` beyond `.keep`.
4. In a project with `config/terraform/providers.tf` present, running a plan (mocked or real) writes the project-level content (with region substituted) into `.subspace/build/<stack>/<region>/<env>/stacks/<stack>/providers.tf`. Verified by a unit test asserting `ctx.fs.writeFile` was called with the expected content, not by `providerTfForRegion()`.
5. In a project with `config/terraform/providers.tf` absent, plan behavior is byte-identical to today's output. Verified by running the existing `test/commands/plan.test.ts` unchanged.
6. `subspace --help` / `subspace new project --help` output is unchanged (no new flags — `--provider` and `--region` already exist).

---

## Open Questions

None remaining after the two clarifying rounds. Answers received:

- **Role of `config/terraform/providers.tf`**: authoritative (per-stack file removed, build pipeline copies project file).
- **When to write it**: only when `--provider` is supplied via CLI / chosen via prompt.
- **Missing-file behavior at build time**: fall back to today's `providerTfForRegion()` in-memory generation.
- **Region handling**: templated — placeholder rewritten per-region at build time; per-region overrides from stack `subspace.toml` still apply in the fallback path only.

If implementation reveals a new ambiguity, update this spec and flag it before coding further.

---

## Implementation Plan (for Phase 2 — PLAN)

Not part of this spec. After the human approves this document, generate a plan broken into the four edits listed in **Project Structure** with explicit ordering, then break each into tasks (Phase 3) before implementing (Phase 4).

Proposed ordering (for the PLAN phase to refine):

1. `src/domain/providers.ts` — add `REGION_PLACEHOLDER` constant and teach `renderProviderTf()` to emit it when `settings.region` is undefined. **No behavior change yet** — existing callers still pass concrete regions.
2. `src/regions/provider-template.ts` — add `rewriteProviderTfRegion()`. Unit test it.
3. `src/commands/workflow.ts` — add the "read `config/terraform/providers.tf` if present" branch at the `providers.tf` emission site. Fallback preserved.
4. `src/commands/new.ts` — (a) write `config/terraform/providers.tf` in `generateProject()` when `provider` is defined; (b) stop writing `providers.tf` in `generateStack()`.
5. Tests + docs in the same commits as the code they cover (per `git-workflow-and-versioning` guidance).
6. `pnpm build` last.
