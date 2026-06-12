#!/usr/bin/env bash
# write-bundle.sh — Write a context bundle for a named agent role (BL-W47 ex-PR2).
#
# Usage:
#   bash scripts/sh/write-bundle.sh --role <name> --plan-id <ref> [--slug <wave-slug>] <<'BODY'
#   ## Patterns
#   - ...
#
#   ## Status Snapshot
#   - ...
#   BODY
#
# Reads the bundle body from stdin (heredoc). Writes a markdown file with YAML
# frontmatter to .planning/wave-{slug}/context-bundles/{role}.md, creating
# directories as needed.
#
# Required flags:
#   --role <name>     Canonical agent name (e.g. test-specialist, arch-platform).
#   --plan-id <ref>   PLAN.md task reference (e.g. wave-bl-w47-bundles/PLAN.md#T4).
#
# Optional flags:
#   --slug <value>    Explicit wave slug override.
#
# Slug resolution order (mirrors hook layer):
#   1. --slug flag
#   2. CLAUDE_WAVE_SLUG environment variable
#   3. git branch: extract {slug} from feature/{slug} pattern
#   Unresolvable slug => error, exit non-zero (never guessed).
#
# Output: .planning/wave-{slug}/context-bundles/{role}.md
#
# Error messages go to stderr. A single success line goes to stdout.
# Fails CLOSED on missing required flags or unresolvable slug.

set -euo pipefail

# -- 1. Parse flags -------------------------------------------------------------
ROLE=""
PLAN_ID=""
SLUG_FLAG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --role)
      [[ -z "${2:-}" ]] && { echo "[write-bundle] ERROR: --role requires a value" >&2; exit 1; }
      ROLE="$2"; shift 2 ;;
    --plan-id)
      [[ -z "${2:-}" ]] && { echo "[write-bundle] ERROR: --plan-id requires a value" >&2; exit 1; }
      PLAN_ID="$2"; shift 2 ;;
    --slug)
      [[ -z "${2:-}" ]] && { echo "[write-bundle] ERROR: --slug requires a value" >&2; exit 1; }
      SLUG_FLAG="$2"; shift 2 ;;
    *)
      echo "[write-bundle] ERROR: unknown flag: $1" >&2
      exit 1 ;;
  esac
done

# -- 2. Validate required flags -------------------------------------------------
if [[ -z "$ROLE" ]]; then
  echo "[write-bundle] ERROR: --role is required" >&2
  exit 1
fi

if [[ -z "$PLAN_ID" ]]; then
  echo "[write-bundle] ERROR: --plan-id is required" >&2
  exit 1
fi

# Validate PLAN_ID format (YAML injection prevention).
if [[ ! "$PLAN_ID" =~ ^[A-Za-z0-9][A-Za-z0-9/#._-]*$ ]]; then
  echo "[write-bundle] ERROR: --plan-id value is invalid: '${PLAN_ID}' — must match ^[A-Za-z0-9][A-Za-z0-9/#._-]*\$" >&2
  exit 1
fi

# -- 3. Resolve wave slug -------------------------------------------------------
WAVE_SLUG=""

if [[ -n "$SLUG_FLAG" ]]; then
  WAVE_SLUG="$SLUG_FLAG"
elif [[ -n "${CLAUDE_WAVE_SLUG:-}" ]]; then
  WAVE_SLUG="$CLAUDE_WAVE_SLUG"
else
  # Attempt to extract {slug} from feature/{slug} branch name
  BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  if [[ "$BRANCH" =~ ^feature/(.+)$ ]]; then
    WAVE_SLUG="${BASH_REMATCH[1]}"
  else
    echo "[write-bundle] ERROR: slug unresolvable — no --slug flag, no CLAUDE_WAVE_SLUG env var, and current branch ('${BRANCH:-unknown}') is not feature/{slug}" >&2
    exit 1
  fi
fi

# -- 4. Validate resolved values (format check, path traversal confinement) ----
# Validate ROLE: only lowercase alphanum segments joined by hyphens.
if [[ ! "$ROLE" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "[write-bundle] ERROR: --role value is invalid: '${ROLE}' — must match ^[a-z0-9]+(-[a-z0-9]+)*\$" >&2
  exit 1
fi

# Validate WAVE_SLUG (resolved): lowercase alphanum, hyphens, dots; must start with alphanum.
if [[ ! "$WAVE_SLUG" =~ ^[a-z0-9][a-z0-9.-]*$ ]]; then
  echo "[write-bundle] ERROR: resolved slug is invalid: '${WAVE_SLUG}' — must match ^[a-z0-9][a-z0-9.-]*\$" >&2
  exit 1
fi

# -- 5. Read body from stdin ---------------------------------------------------
BODY="$(cat)"

# Enforce body line-count limit (schema Content Rule 3: body ≤ 60 lines HARD).
LINE_COUNT="$(printf '%s\n' "$BODY" | wc -l | tr -d ' ')"
if (( LINE_COUNT > 60 )); then
  echo "[write-bundle] ERROR: bundle body is ${LINE_COUNT} lines — exceeds 60-line limit (schema Content Rule 3). Reduce body and retry." >&2
  exit 1
fi

# -- 6. Compute output path ----------------------------------------------------
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
BUNDLE_DIR="$REPO_ROOT/.planning/wave-${WAVE_SLUG}/context-bundles"
BUNDLE_FILE="$BUNDLE_DIR/${ROLE}.md"

mkdir -p "$BUNDLE_DIR"

# -- 7. Write frontmatter + body -----------------------------------------------
CREATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat > "$BUNDLE_FILE" <<FRONTMATTER
---
bundle_role: ${ROLE}
wave_slug: ${WAVE_SLUG}
plan_id: ${PLAN_ID}
created_at: ${CREATED_AT}
written_by: context-provider via scripts/sh/write-bundle.sh
schema_version: 1
---

${BODY}
FRONTMATTER

echo "[write-bundle] OK: bundle written to $BUNDLE_FILE"
