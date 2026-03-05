# Bugs Tracker

This document tracks reported bugs, triaged issues, and fixed defects.

## Active Bugs

| ID | Reported | Severity | Status | Title |
|---|---|---|---|---|
| B-002 | 2026-03-05 | Low | Reported | Backend change requires manual clean/reconfigure |

## Fixed Bugs

| ID | Fixed | Severity | Title |
|---|---|---|---|
| B-001 | 2026-03-05 | High | New stack defaults to local backend instead of project backend |

## Bug Details

### B-001: New stack defaults to local backend
- **Fixed**: 2026-03-05
- **Symptoms**: `subspace new stack` created `backend.tf` with `local` even if `subspace.toml` specified `s3`.
- **Root Cause**: Hardcoded string in `src/commands/new.ts`.
- **Resolution**: Updated `generateStack` to use `renderBackendTf` with project-level settings.

### B-002: Backend change requires manual clean/reconfigure
- **Severity**: Low (UX)
- **Status**: Reported
- **Repro**: Change `backend.tf` in stack from `local` to `s3`, then run `plan`.
- **Expected**: Subspace handles the transition.
- **Actual**: Engine fails requesting `-reconfigure`.
- **Fix Plan**: Detect transition error in `invokeEngine` and retry with `-reconfigure` if safe, or advise user.

---
[Plan](plan.md) | [Features Tracker](features.md)
