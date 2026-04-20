#!/usr/bin/env bash
# Pre-commit hook: validates skill registry hash consistency when SKILL.md or registry.json is staged.
# Exit 0: no action / fresh hash
# Exit 1: stale hash, commit blocked
# Exit 2: infrastructure error

set -euo pipefail

PROJECT_ROOT="${1:-$(pwd)}"
VERBOSE="${VERBOSE:-0}"

# --verbose flag support
[[ "${1:-}" == "--verbose" ]] && { VERBOSE=1; PROJECT_ROOT="$(pwd)"; }
[[ "${2:-}" == "--verbose" ]] && VERBOSE=1

log() { [[ "$VERBOSE" == "1" ]] && echo "[pre-commit-hook] $*" >&2 || true; }

# Check staged files — git diff --cached --name-only
staged=$(git -C "$PROJECT_ROOT" diff --cached --name-only 2>/dev/null || true)
[[ -z "$staged" ]] && { log "no staged files"; exit 0; }

# Filter for SKILL.md or skills/registry.json
triggers=$(echo "$staged" | grep -E '(^skills/.+/SKILL\.md$|^skills/registry\.json$)' || true)
[[ -z "$triggers" ]] && { log "no SKILL.md or registry.json staged"; exit 0; }

log "staged registry files: $triggers"
log "running rehash-registry.sh --check"

# Resolve rehash script — prefer sibling of this hook, fall back to PROJECT_ROOT
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REHASH_SCRIPT="$HOOK_DIR/rehash-registry.sh"
if [[ ! -f "$REHASH_SCRIPT" ]]; then
  REHASH_SCRIPT="$PROJECT_ROOT/scripts/sh/rehash-registry.sh"
fi

# Run the check
if ! bash "$REHASH_SCRIPT" --project-root "$PROJECT_ROOT" --check --verbose 2>&1; then
  echo "" >&2
  echo "[REHASH] Registry hash stale." >&2
  echo "[REHASH] Run: node mcp-server/build/cli/generate-registry.js && bash scripts/sh/rehash-registry.sh --project-root \"\$(pwd)\"" >&2
  echo "[REHASH] Then re-stage skills/registry.json and retry commit." >&2
  exit 1
fi

log "rehash check clean"
exit 0
