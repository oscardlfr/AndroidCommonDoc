#!/usr/bin/env bash
# Pre-commit hook: chains two consistency gates.
#
#   Gate 1 (Wave 21): skill registry hash freshness.
#     Triggered by staged skills/*/SKILL.md or skills/registry.json.
#     Runs `rehash-registry.sh --check`. Stale → block.
#
#   Gate 2 (W31.7-Phase 4 sub 3): manifest frontmatter SHA-256 drift.
#     Triggered by staged setup/agent-templates/*.md or .claude/agents/*.md.
#     Runs `generate-template.js --check --all`. Drift → block.
#
# Exit 0: no action / both gates clean
# Exit 1: stale hash or manifest drift, commit blocked
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

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Gate 1: skill registry hash freshness ─────────────────────────────────
registry_triggers=$(echo "$staged" | grep -E '(^skills/.+/SKILL\.md$|^skills/registry\.json$)' || true)
if [[ -n "$registry_triggers" ]]; then
  log "staged registry files: $registry_triggers"
  log "running rehash-registry.sh --check"

  REHASH_SCRIPT="$HOOK_DIR/rehash-registry.sh"
  if [[ ! -f "$REHASH_SCRIPT" ]]; then
    REHASH_SCRIPT="$PROJECT_ROOT/scripts/sh/rehash-registry.sh"
  fi

  if ! bash "$REHASH_SCRIPT" --project-root "$PROJECT_ROOT" --check --verbose 2>&1; then
    echo "" >&2
    echo "[REHASH] Registry hash stale." >&2
    echo "[REHASH] Run: node mcp-server/build/cli/generate-registry.js && bash scripts/sh/rehash-registry.sh --project-root \"\$(pwd)\"" >&2
    echo "[REHASH] Then re-stage skills/registry.json and retry commit." >&2
    exit 1
  fi
  log "registry rehash check clean"
fi

# ── Gate 2: manifest frontmatter SHA-256 drift ────────────────────────────
manifest_triggers=$(echo "$staged" | grep -E '(^setup/agent-templates/[^/]+\.md$|^\.claude/agents/[^/]+\.md$)' || true)
if [[ -n "$manifest_triggers" ]]; then
  log "staged agent templates: $manifest_triggers"
  log "running generate-template.js --check --all"

  GENERATE_CLI="$PROJECT_ROOT/mcp-server/build/cli/generate-template.js"
  if [[ ! -f "$GENERATE_CLI" ]]; then
    log "generate-template.js not built — skipping (run 'cd mcp-server && npm run build')"
    exit 0
  fi

  if ! GEN_OUT=$(node "$GENERATE_CLI" --check --all 2>&1); then
    echo "" >&2
    echo "[MANIFEST] Agent template frontmatter has drifted from manifest baseline." >&2
    echo "$GEN_OUT" | grep -E '^  DRIFT' | head -5 >&2
    echo "" >&2
    echo "[MANIFEST] Fix per drifted agent:" >&2
    echo "[MANIFEST]   node mcp-server/build/cli/generate-template.js <agent-name> --update-manifest-hash" >&2
    echo "[MANIFEST]   bash scripts/sh/rehash-registry.sh --project-root \"\$(pwd)\"" >&2
    echo "[MANIFEST] Then stage manifest + templates + mirrors + registry and retry commit." >&2
    exit 1
  fi
  log "manifest drift check clean"
fi

log "all pre-commit gates clean"
exit 0
