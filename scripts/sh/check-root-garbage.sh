#!/usr/bin/env bash
# check-root-garbage.sh — CI guard: detect mangled path fragments in repo root (D1 recurrence).
#
# When Windows path strings like "Users\34645\..." are accidentally committed to the
# repo root (D1 incident), this check catches them before they accumulate.
#
# Usage: bash scripts/sh/check-root-garbage.sh [dir]
#   dir  — root directory to inspect (default: .)
#
# Exit 0: no Users* entries found at the top level.
# Exit 1: one or more Users* entries found; list printed to stdout.
# Exit 2: target root missing/unreadable or scan failed (fail-closed — a guard
#         that cannot scan must not report "clean").

set -euo pipefail

PROJECT_ROOT="${1:-.}"

if [[ ! -d "$PROJECT_ROOT" ]]; then
  echo "ERROR: Target root does not exist or is not a directory: $PROJECT_ROOT"
  exit 2
fi

# Command substitution (NOT process substitution) so a find failure propagates
# and trips the fail-closed branch — `< <(...)` exit codes are invisible to set -e.
matches_raw="$(find "$PROJECT_ROOT" -maxdepth 1 -name "Users*")" || {
  echo "ERROR: root scan failed for: $PROJECT_ROOT (fail-closed)"
  exit 2
}
matches=()
if [[ -n "$matches_raw" ]]; then
  mapfile -t matches <<< "$matches_raw"
fi

if [[ ${#matches[@]} -gt 0 ]]; then
  echo "ERROR: Mangled path fragment(s) found at repo root (D1 recurrence):"
  for entry in "${matches[@]}"; do
    echo "  $entry"
  done
  echo "Remove the above entries before pushing."
  exit 1
fi

exit 0
