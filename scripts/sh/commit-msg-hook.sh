#!/usr/bin/env bash
# commit-msg-hook.sh — Git commit-msg hook: Conventional Commits format + scope whitelist.
#
#   Validates two things in order:
#     1. FORMAT: first line matches `type(scope)?!?: description` (Conventional Commits).
#        Merge commits ("Merge ...") are skipped — they pass unconditionally.
#     2. SCOPE (if present): scope must be in `valid_scopes` from .commitlintrc.json.
#        Compound scopes (e.g. core-error-sdk) pass if the FIRST segment (core) is valid —
#        matches the semantics of .claude/hooks/commit-scope-validation-gate.js.
#
#   Fail-open policy (exit 0, never block):
#     - .commitlintrc.json missing or malformed
#     - No scope in the commit message (scope is optional per Conventional Commits)
#     - Merge commit first line
#
#   On invalid scope: print informative message listing valid scopes + exit 1 (block).
#   On invalid format: print usage hint + exit 1 (block).
#
# Usage (installed as .git/hooks/commit-msg by install-git-hooks.sh):
#   commit-msg-hook.sh <path-to-commit-msg-file>
#
# Can also be tested directly:
#   echo "docs(readme): update" > /tmp/cmsg && bash scripts/sh/commit-msg-hook.sh /tmp/cmsg

set -euo pipefail

COMMIT_MSG_FILE="${1:?Usage: commit-msg-hook.sh <commit-msg-file>}"

# Read the first line only
first_line=$(head -1 "$COMMIT_MSG_FILE")

# ── Merge commit fast-pass ──────────────────────────────────────────────────
# git generates "Merge branch '...' into ..." — always valid, skip further checks.
if echo "$first_line" | grep -qE '^Merge '; then
  exit 0
fi

# ── Conventional Commits FORMAT check ──────────────────────────────────────
# type(scope)?!?: description
# Types mirror commitlint @commitlint/config-conventional defaults.
CC_PATTERN='^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?: .+'
if ! echo "$first_line" | grep -qE "$CC_PATTERN"; then
  echo "[commit-msg-hook] BLOCKED: commit message does not match Conventional Commits format." >&2
  echo "  Expected: <type>(<scope>)?: <description>" >&2
  echo "  Types: feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert" >&2
  echo "  Got: $first_line" >&2
  exit 1
fi

# ── SCOPE presence check ────────────────────────────────────────────────────
# Extract scope from type(scope)?: ...
# If no scope present, fail-open (scope is optional in Conventional Commits).
raw_scope=$(echo "$first_line" | sed -nE 's/^[a-z]+\(([^)]+)\).*/\1/p')
if [[ -z "$raw_scope" ]]; then
  exit 0
fi

# ── Resolve .commitlintrc.json from repo root ───────────────────────────────
# Use git rev-parse to find the repo root — cwd-independent, works from any
# subdirectory or hook invocation path (lesson from testing-hub anchor paths).
if git_root=$(git rev-parse --show-toplevel 2>/dev/null); then
  COMMITLINT_CONFIG="$git_root/.commitlintrc.json"
else
  # Fallback: navigate from BASH_SOURCE to find the project root
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # scripts/sh/ -> scripts/ -> project root
  COMMITLINT_CONFIG="$(dirname "$(dirname "$SCRIPT_DIR")")/.commitlintrc.json"
fi

# ── Fail-open: missing or malformed .commitlintrc.json ─────────────────────
if [[ ! -f "$COMMITLINT_CONFIG" ]]; then
  # Can't validate — do not block
  exit 0
fi

valid_scopes_json=$(python3 -c "
import json, sys
try:
    cfg = json.load(open('$COMMITLINT_CONFIG'))
    scopes = cfg.get('valid_scopes', [])
    if isinstance(scopes, list) and scopes:
        print(' '.join(scopes))
    else:
        sys.exit(1)
except Exception:
    sys.exit(1)
" 2>/dev/null) || {
  # Malformed JSON or missing key — fail-open
  exit 0
}

# ── SCOPE whitelist check ───────────────────────────────────────────────────
# Compound scopes (core-error-sdk) pass if the FIRST segment (core) is in valid_scopes.
# This mirrors commit-scope-validation-gate.js semantics exactly.
first_segment="${raw_scope%%-*}"  # split on first '-' and take the left side

found=0
for scope in $valid_scopes_json; do
  if [[ "$scope" == "$raw_scope" ]] || [[ "$scope" == "$first_segment" ]]; then
    found=1
    break
  fi
done

if [[ "$found" -eq 0 ]]; then
  echo "[commit-msg-hook] BLOCKED: scope \"($raw_scope)\" is not in valid_scopes." >&2
  echo "  Valid scopes (from .commitlintrc.json): $valid_scopes_json" >&2
  echo "  Compound scopes like \"core-error-sdk\" are valid when \"core\" is in the list." >&2
  exit 1
fi

exit 0
