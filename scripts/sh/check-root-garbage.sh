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

set -euo pipefail

PROJECT_ROOT="${1:-.}"

mapfile -t matches < <(find "$PROJECT_ROOT" -maxdepth 1 -name "Users*" 2>/dev/null || true)

if [[ ${#matches[@]} -gt 0 ]]; then
  echo "ERROR: Mangled path fragment(s) found at repo root (D1 recurrence):"
  for entry in "${matches[@]}"; do
    echo "  $entry"
  done
  echo "Remove the above entries before pushing."
  exit 1
fi

exit 0
