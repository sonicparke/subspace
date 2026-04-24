#!/usr/bin/env bash
#
# A3 validation harness: grep target Terraspace projects for `TS_ROLE=`
# usage and report any occurrences that don't look like a bare AWS
# profile name (i.e. the design-doc mapping TS_ROLE -> [provider.settings.profile]).
#
# Usage:
#   scripts/migrate-validation/ts-role-audit.sh <path-to-terraspace-project> [...more paths]
#
# Output:
#   - Per-project: file:line snippets of every TS_ROLE= usage.
#   - Heuristic flags any value that contains characters outside [A-Za-z0-9_.-]
#     (which would suggest structural/logical roles rather than an AWS
#     profile name).
#
# Exit code:
#   0 if every TS_ROLE usage looks like a bare profile name,
#   1 if any suspicious usage was found (human must inspect).
#
# Record results in docs/ideas/subspace-terraspace-migration.md under
# "Key Assumptions to Validate" -> A3.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  cat <<EOF
usage: $(basename "$0") <path-to-terraspace-project> [...more paths]

Scans the given project paths for TS_ROLE= usages and flags any that
don't look like bare AWS profile names.
EOF
  exit 2
fi

if ! command -v rg >/dev/null 2>&1; then
  echo "error: ripgrep (rg) not installed. Install via 'brew install ripgrep'." >&2
  exit 2
fi

suspicious_total=0
usage_total=0

for path in "$@"; do
  if [[ ! -d "$path" ]]; then
    echo "warn: $path is not a directory, skipping" >&2
    continue
  fi

  echo "=== $path ==="
  usage_count=0
  suspicious_count=0

  while IFS= read -r hit; do
    [[ -z "$hit" ]] && continue
    usage_count=$((usage_count + 1))

    value="${hit#*TS_ROLE=}"
    value="${value%%[[:space:]\"\'\`\\]*}"
    value="${value%;}"
    value="${value%,}"
    value="${value#\"}"
    value="${value#\'}"
    value="${value%\"}"
    value="${value%\'}"

    if [[ -z "$value" ]]; then
      continue
    fi

    if [[ "$value" =~ ^[A-Za-z0-9_.-]+$ ]]; then
      echo "  ok         $hit"
    else
      suspicious_count=$((suspicious_count + 1))
      echo "  SUSPICIOUS $hit"
    fi
  done < <(rg --no-heading -n -uu -g '!.git' -g '!node_modules' -g '!.terraform' 'TS_ROLE=' "$path" 2>/dev/null || true)

  echo "  -- $usage_count usages, $suspicious_count suspicious"
  echo ""

  usage_total=$((usage_total + usage_count))
  suspicious_total=$((suspicious_total + suspicious_count))
done

echo "==="
echo "Total TS_ROLE= usages:      $usage_total"
echo "Suspicious (non-profile):   $suspicious_total"
echo ""

if [[ $usage_total -eq 0 ]]; then
  echo "No TS_ROLE usages found. Either the target projects don't use TS_ROLE"
  echo "or the mapping question is moot for them. Record this in the design doc."
  exit 0
fi

if [[ $suspicious_total -eq 0 ]]; then
  echo "A3 is validated: every TS_ROLE usage looks like a bare AWS profile name."
  echo "Record this in docs/ideas/subspace-terraspace-migration.md."
  exit 0
fi

echo "A3 needs manual review: $suspicious_total usages don't look like bare profile names."
echo "Inspect the SUSPICIOUS lines above and decide whether to extend the mapping."
exit 1
