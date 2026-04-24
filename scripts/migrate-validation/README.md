# Migration Validation Harnesses

Small scripts that validate the Phase 1 assumptions in
[docs/ideas/subspace-terraspace-migration.md](../../docs/ideas/subspace-terraspace-migration.md).

They are not shipped in the `subspace` binary and are not exercised by
`pnpm test`. They exist to be run by a human, once, against real
Terraspace projects before dual-read state copy ships.

## `probe-all.sh` — A1: legacy key scheme is derivable

Runs `subspace migrate <stack> <env> --dry-run` for every (stack, env)
tuple discovered under `app/stacks/*/tfvars/*.tfvars` in the current
project, and summarizes legacy/native probe outcomes.

```bash
# From the root of a Terraspace project with subspace.toml already scaffolded:
subspace migrate init .        # one-shot, offline
scripts/migrate-validation/probe-all.sh --role <ts_role>
```

Per-tuple reports land in `.subspace/migrate-validation/<stack>-<env>.md`.

**A1 is validated** when every stack you intend to migrate reports
`legacy=FOUND` for every real env. Record the coverage percentage and
any exceptions in the design doc.

## `ts-role-audit.sh` — A3: TS_ROLE is always an AWS profile

Greps one or more Terraspace project checkouts for `TS_ROLE=` and flags
any usage whose value contains characters outside `[A-Za-z0-9_.-]`.

```bash
scripts/migrate-validation/ts-role-audit.sh ~/src/infra ~/src/platform
```

Requires `ripgrep` (`brew install ripgrep`).

**A3 is validated** when the script exits 0 against every target
project. If the suspicious count is non-zero, inspect the flagged lines
and decide whether the `TS_ROLE -> [provider.settings.profile]` mapping
needs extending before implementing state copy.

## Why shell, not TypeScript?

These are one-shot manual validation tools, not part of the product.
Keeping them as shell avoids dragging a second build artifact into the
repo and makes it obvious they are not exercised by the test suite.
