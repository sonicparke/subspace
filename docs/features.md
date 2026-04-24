# Features Tracker

This document tracks new feature requests and completed enhancements for Subspace.

## Feature Requests

| ID | Title | Requested | Status | Priority | Why |
|---|---|---|---|---|---|
| F-001 | Regional build layout | 2026-03-05 | Done | High | Support multi-region deployments with isolated build dirs. |
| F-002 | App-name bucket derivation | 2026-03-05 | Done | High | Auto-generate state buckets based on project name. |
| F-003 | Regional Provider Generation | 2026-03-05 | Done | High | Auto-inject `providers.tf` per region. |
| F-004 | Parallel Region Fanout | 2026-03-05 | Done | Medium | Speed up multi-region plans/applies. |
| F-005 | Backend reconfiguration flags | 2026-03-05 | Done | Medium | Auto-add `-reconfigure` when backend config changes; surface `-migrate-state` errors (deliberately not auto-applied). |
| F-006 | Terraform-best-practice build layout | 2026-04-23 | Done | High | `<buildRoot>/stacks/<stack>/` + sibling `<buildRoot>/modules/` so user `source = "../../modules/<name>"` resolves without rewriting. |

## Feature Details

### F-002: App-name bucket derivation
- **Status**: Done
- **Scope**: `src/engine/backend.ts`, `src/engine/invoke.ts`
- **Acceptance**: `init` flags include `-backend-config=bucket=<cwd-basename>-subspace-<scope>-state`.

### F-005: Backend reconfiguration flags
- **Status**: Done (2026-04-23)
- **Why**: Changing backend type (e.g. local -> s3) used to fail `init` asking for `-reconfigure`.
- **Scope**: [src/engine/invoke.ts](../src/engine/invoke.ts) detects "Backend configuration changed" / "reinitialization required" on both `init` and command failures, and auto-retries `init` with `-reconfigure`. `-migrate-state` is deliberately NOT auto-applied (risk of unintended state merges); instead the error is surfaced with guidance.
- **Tests**: [test/engine/invoke.test.ts](../test/engine/invoke.test.ts) covers: reconfigure on post-init command failure, reconfigure on init itself, refuses to auto-migrate-state, no infinite retry loop.

### F-006: Terraform-best-practice build layout
- **Status**: Done (2026-04-23)
- **Why**: Before this change, `cleanRebuild` produced a flat `.subspace/build/<stack>/<region>/<env>/` and never staged referenced modules — any stack using `source = "../../modules/<name>"` failed at `tofu init` (see [B-003](bugs.md)).
- **Scope**:
  - [src/commands/workflow.ts](../src/commands/workflow.ts): introduced `buildRootFor`, `stackWorkingDir`, `modulesStagingDir` helpers; engine `chdir` now targets the per-stack working dir.
  - [src/build/clean-rebuild.ts](../src/build/clean-rebuild.ts): rebuilt around the new layout; wipes `modules/` between runs; copies only referenced modules; follows transitive references; safe under cycles; fails fast on missing modules.
  - [src/build/module-discovery.ts](../src/build/module-discovery.ts): pure helper that extracts module names from `.tf` sources via `source = "(./|../)+modules/<name>"`.
- **Rationale**: HashiCorp Standard Module Structure + OpenTofu [Module Sources](https://opentofu.org/docs/language/modules/sources/) require local module `source` paths to resolve relative to the `.tf` file's directory. The only robust way to make `../../modules/<name>` work without rewriting user source is to preserve the `stacks/<stack>/` ↔ `modules/<name>/` sibling relationship in the staged dir, as Terraspace does. Module copies are per-stack (Terragrunt isolation) rather than shared to avoid concurrent-mutation hazards.
- **Tests**: [test/build/clean-rebuild.test.ts](../test/build/clean-rebuild.test.ts) (new layout, transitive refs, cycle safety, missing-module error), [test/build/module-discovery.test.ts](../test/build/module-discovery.test.ts) (regex edge cases), [test/engine/invoke.test.ts](../test/engine/invoke.test.ts) (dual-read + chdir coupling regression).

---
[Plan](plan.md) | [Bugs Tracker](bugs.md)
