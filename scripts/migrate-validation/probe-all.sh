#!/usr/bin/env bash
#
# A1 validation harness: probe every (stack, env) tuple in the current
# Terraspace/Subspace project and report legacy-FOUND coverage.
#
# Assumes cwd has a `subspace.toml` with a [migration.terraspace] block
# and that `subspace` is on $PATH. Run this from the root of a project
# you intend to migrate, with AWS credentials already available.
#
# Usage:
#   scripts/migrate-validation/probe-all.sh [--role <ts_role>] [--app <ts_app>]
#
# Output:
#   - One line per (stack, env) tuple: STACK/ENV: legacy=FOUND|MISSING native=FOUND|MISSING
#   - A summary at the end with totals.
#   - Per-tuple full markdown reports written to .subspace/migrate-validation/<stack>-<env>.md
#
# Exit code: 0 if every (stack, env) probed successfully (report generated),
# non-zero if any probe errored (ie. the CLI itself failed, not a MISSING key).

set -euo pipefail

ROLE_ARG=()
APP_ARG=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --role)
      ROLE_ARG=(--role "$2")
      shift 2
      ;;
    --app)
      APP_ARG=(--app "$2")
      shift 2
      ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

if ! command -v subspace >/dev/null 2>&1; then
  echo "error: subspace not on PATH. Run pnpm build first." >&2
  exit 2
fi

if [[ ! -f subspace.toml ]]; then
  echo "error: no subspace.toml in cwd. Run from the project root." >&2
  exit 2
fi

if [[ ! -d app/stacks ]]; then
  echo "error: no app/stacks/ in cwd. Run from a Terraspace/Subspace project root." >&2
  exit 2
fi

OUT_DIR=".subspace/migrate-validation"
mkdir -p "$OUT_DIR"

total=0
legacy_found=0
legacy_missing=0
probe_errors=0

for stack_dir in app/stacks/*/; do
  stack="$(basename "$stack_dir")"
  tfvars_dir="${stack_dir}tfvars"
  [[ -d "$tfvars_dir" ]] || continue

  envs=()
  while IFS= read -r envfile; do
    base="$(basename "$envfile" .tfvars)"
    head="${base%%.*}"
    [[ "$head" == "base" || -z "$head" ]] && continue
    envs+=("$head")
  done < <(find "$tfvars_dir" -maxdepth 1 -name '*.tfvars' 2>/dev/null | sort -u)

  if [[ ${#envs[@]} -eq 0 ]]; then
    echo "$stack/(no-envs): skipped (no <env>.tfvars discovered; add envs to [migration.terraspace] if needed)"
    continue
  fi

  uniq_envs=($(printf '%s\n' "${envs[@]}" | sort -u))

  for env in "${uniq_envs[@]}"; do
    total=$((total + 1))
    report_path="${OUT_DIR}/${stack}-${env}.md"
    if ! subspace migrate "$stack" "$env" --dry-run "${ROLE_ARG[@]}" "${APP_ARG[@]}" \
         --report-file "$report_path" >/dev/null 2>&1; then
      probe_errors=$((probe_errors + 1))
      echo "$stack/$env: PROBE_ERROR (see $report_path if written)"
      continue
    fi

    legacy_line="$(grep -m1 '^- legacy:' "$report_path" || true)"
    native_line="$(grep -m1 '^- native:' "$report_path" || true)"

    legacy_status="UNKNOWN"
    native_status="UNKNOWN"
    case "$legacy_line" in
      *FOUND*)   legacy_status="FOUND"; legacy_found=$((legacy_found + 1)) ;;
      *MISSING*) legacy_status="MISSING"; legacy_missing=$((legacy_missing + 1)) ;;
    esac
    case "$native_line" in
      *FOUND*)   native_status="FOUND" ;;
      *MISSING*) native_status="MISSING" ;;
    esac

    echo "$stack/$env: legacy=$legacy_status native=$native_status  ($report_path)"
  done
done

echo ""
echo "---"
echo "Probed $total (stack, env) tuples"
echo "  legacy FOUND:   $legacy_found"
echo "  legacy MISSING: $legacy_missing"
echo "  probe errors:   $probe_errors"
echo ""

if [[ $total -eq 0 ]]; then
  echo "No tuples probed. Either no <env>.tfvars files exist under app/stacks/*/tfvars/," \
       "or every stack is base-only (set envs in [migration.terraspace] to probe those)."
  exit 0
fi

if [[ $probe_errors -ne 0 ]]; then
  exit 1
fi

coverage_pct=$(( (legacy_found * 100) / total ))
echo "Legacy coverage: ${coverage_pct}% ($legacy_found/$total)"
echo ""
echo "A1 is validated when coverage is 100% for every stack you intend to migrate."
echo "Record the result in docs/ideas/subspace-terraspace-migration.md."
