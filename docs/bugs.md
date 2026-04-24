# Bugs Tracker

This document tracks reported bugs, triaged issues, and fixed defects.

## Active Bugs

| ID | Reported | Severity | Status | Title |
|---|---|---|---|---|

## Fixed Bugs

| ID | Fixed | Severity | Title |
|---|---|---|---|
| B-001 | 2026-03-05 | High | New stack defaults to local backend instead of project backend |
| B-002 | 2026-04-23 | Low | Backend change requires manual clean/reconfigure |
| B-003 | 2026-04-23 | High | Stacks referencing `../../modules/<name>` fail at `tofu init` because `app/modules/` was never staged into the build dir |

## Bug Details

### B-001: New stack defaults to local backend
- **Fixed**: 2026-03-05
- **Symptoms**: `subspace new stack` created `backend.tf` with `local` even if `subspace.toml` specified `s3`.
- **Root Cause**: Hardcoded string in `src/commands/new.ts`.
- **Resolution**: Updated `generateStack` to use `renderBackendTf` with project-level settings.

### B-002: Backend change requires manual clean/reconfigure
- **Severity**: Low (UX)
- **Status**: Fixed (2026-04-23)
- **Repro**: Change `backend.tf` in stack from `local` to `s3`, then run `plan`.
- **Root Cause**: `invokeEngine` only retried on "init required" patterns, not on "Backend configuration changed".
- **Resolution**: Added reconfigure-required matcher in [src/engine/invoke.ts](../src/engine/invoke.ts); on match, auto-retries `init` with `-reconfigure`. `-migrate-state` is NOT auto-applied — surfaces the error with guidance to run manually.
- **Related feature**: F-005.

### B-003: Stacks referencing `../../modules/<name>` fail at `tofu init`
- **Severity**: High (blocker for any multi-module project)
- **Status**: Fixed (2026-04-23)
- **Repro**: A stack contains `module "x" { source = "../../modules/x" }`; run `subspace plan <stack> [env]`. `tofu init` fails with `Error: Unreadable module directory / Unable to evaluate directory symlink: lstat ../../modules: no such file or directory`.
- **Root Cause**: `cleanRebuild` copied `app/stacks/<stack>/` into a flat `.subspace/build/<stack>/<region>/<env>/` but never copied `app/modules/`. OpenTofu resolves `source` relative to the `.tf` file's directory, so `../../modules` resolved to `.subspace/build/<stack>/`, which had no `modules/` sibling.
- **Resolution**: Refactored the build layout to the Terraspace-style `<buildRoot>/stacks/<stack>/` + `<buildRoot>/modules/` sibling shape. `cleanRebuild` now parses each staged `.tf` for `source = "(./|../)+modules/<name>"`, copies the referenced `<name>` from `app/modules/<name>/` into `<buildRoot>/modules/<name>/`, and recurses into each copied module for transitive refs. Engine `chdir` targets `<buildRoot>/stacks/<stack>/`, so `../../modules/<name>` resolves to the sibling `<buildRoot>/modules/<name>/` without any source rewriting.
- **Related feature**: F-006.

---
[Plan](plan.md) | [Features Tracker](features.md)
