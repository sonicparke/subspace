# Features Tracker

This document tracks new feature requests and completed enhancements for Subspace.

## Feature Requests

| ID | Title | Requested | Status | Priority | Why |
|---|---|---|---|---|---|
| F-001 | Regional build layout | 2026-03-05 | Done | High | Support multi-region deployments with isolated build dirs. |
| F-002 | App-name bucket derivation | 2026-03-05 | Done | High | Auto-generate state buckets based on project name. |
| F-003 | Regional Provider Generation | 2026-03-05 | Done | High | Auto-inject `providers.tf` per region. |
| F-004 | Parallel Region Fanout | 2026-03-05 | Done | Medium | Speed up multi-region plans/applies. |
| F-005 | Backend reconfiguration flags | 2026-03-05 | Proposed | Medium | Auto-add `-reconfigure` or `-migrate-state` when backend type changes. |

## Feature Details

### F-002: App-name bucket derivation
- **Status**: Done
- **Scope**: `src/engine/backend.ts`, `src/engine/invoke.ts`
- **Acceptance**: `init` flags include `-backend-config=bucket=<cwd-basename>-subspace-<scope>-state`.

### F-005: Backend reconfiguration flags
- **Status**: Proposed
- **Why**: Currently, changing backend type (e.g. local -> s3) causes `init` to fail asking for flags.
- **Scope**: `src/engine/invoke.ts` to detect "Backend configuration changed" and either prompt or retry with flags.

---
[Plan](plan.md) | [Bugs Tracker](bugs.md)
