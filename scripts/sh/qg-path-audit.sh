#!/usr/bin/env bash
# qg-path-audit.sh — QG declared-vs-touched verification step (BL-W47 ex-PR4 D-7).
#
# Usage: qg-path-audit.sh --wave-dir <path> --plan <path> --base <git-ref>
#        [--skip-path-audit]
#
# Exit 0: all checks pass (CLASS matches, all touched files in manifest)
# Exit 1: audit failure (CLASS mismatch or out-of-manifest touch)
# Exit 2: infrastructure error (missing required args, missing files)
#
# Checks:
#   1. Read CLASS sentinel from <wave-dir>/CLASS
#   2. Read PLAN.md ### Wave Class → **Class**: <value>
#   3. FAIL exit 1 if CLASS sentinel != PLAN.md class
#   4. Extract ### Path-Manifest file list from PLAN.md
#   5. Run: git diff --name-only <base>..HEAD (forward-slash)
#   6. FAIL exit 1 if any touched file is NOT in the manifest
#   7. FAIL exit 1 if any HARNESS-pattern path is in touched files AND declared class < HARNESS
#
# HARNESS path patterns (match pre-commit-hook.sh Gate 3):
#   ^\.claude/hooks/
#   ^scripts/
#   ^setup/agent-templates/
#   ^\.github/
#   (^|/)settings\.json$
#
# Bypass: SKIP_PATH_AUDIT=1 → exit 0 immediately (log bypass to stderr)
#
# set -euo pipefail safety: all grep captures guarded with || true (Decision B2).

set -euo pipefail

# ── Arg parsing ──────────────────────────────────────────────────────────────

WAVE_DIR=""
PLAN_FILE=""
BASE_REF=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --wave-dir)         WAVE_DIR="$2";  shift 2 ;;
    --plan)             PLAN_FILE="$2"; shift 2 ;;
    --base)             BASE_REF="$2";  shift 2 ;;
    --skip-path-audit)  SKIP_PATH_AUDIT=1; shift ;;
    *) echo "[qg-path-audit] ERROR: unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Bypass via env or flag
if [[ "${SKIP_PATH_AUDIT:-}" == "1" ]]; then
  echo "[qg-path-audit] SKIP_PATH_AUDIT=1 — bypassing audit." >&2
  exit 0
fi

# Validate required args
if [[ -z "$WAVE_DIR" || -z "$PLAN_FILE" || -z "$BASE_REF" ]]; then
  echo "[qg-path-audit] ERROR: --wave-dir, --plan, and --base are required." >&2
  echo "Usage: qg-path-audit.sh --wave-dir <path> --plan <path> --base <git-ref>" >&2
  exit 2
fi

if [[ ! -d "$WAVE_DIR" ]]; then
  echo "[qg-path-audit] ERROR: wave dir not found: $WAVE_DIR" >&2
  exit 2
fi

if [[ ! -f "$PLAN_FILE" ]]; then
  echo "[qg-path-audit] ERROR: PLAN.md not found: $PLAN_FILE" >&2
  exit 2
fi

# ── Step 1: Read CLASS sentinel ───────────────────────────────────────────────

CLASS_SENTINEL_FILE="$WAVE_DIR/CLASS"
if [[ ! -f "$CLASS_SENTINEL_FILE" ]]; then
  echo "[qg-path-audit] ERROR: CLASS sentinel not found: $CLASS_SENTINEL_FILE" >&2
  exit 2
fi

CLASS_SENTINEL="$(cat "$CLASS_SENTINEL_FILE")"
CLASS_SENTINEL="${CLASS_SENTINEL// /}"   # strip whitespace

# ── Step 2: Read PLAN.md Wave Class ──────────────────────────────────────────

PLAN_CLASS=""
PLAN_CLASS="$(grep -m1 '\*\*Class\*\*:' "$PLAN_FILE" | sed 's/.*\*\*Class\*\*:[[:space:]]*//' | tr -d '[:space:]')" || true

if [[ -z "$PLAN_CLASS" ]]; then
  echo "[qg-path-audit] ERROR: could not extract **Class**: from PLAN.md" >&2
  exit 2
fi

# ── Step 3: CLASS mismatch check ─────────────────────────────────────────────

if [[ "$CLASS_SENTINEL" != "$PLAN_CLASS" ]]; then
  echo "[qg-path-audit] FAIL: CLASS mismatch — sentinel='$CLASS_SENTINEL' PLAN.md='$PLAN_CLASS'"
  echo "[qg-path-audit] FAIL: CLASS mismatch — sentinel='$CLASS_SENTINEL' PLAN.md='$PLAN_CLASS'" >&2
  exit 1
fi

echo "[qg-path-audit] CLASS check: $CLASS_SENTINEL == $PLAN_CLASS OK" >&2

# ── Step 4: Extract Path-Manifest file list ───────────────────────────────────
# Lines between ### Path-Manifest header and next ### header.
# Strip leading "- `" or "- " and trailing "`" + any parenthetical.

MANIFEST_FILES=()
IN_MANIFEST=0
while IFS= read -r line; do
  if [[ "$line" =~ ^###[[:space:]]+Path-Manifest ]]; then
    IN_MANIFEST=1
    continue
  fi
  if [[ $IN_MANIFEST -eq 1 && "$line" =~ ^###[[:space:]] ]]; then
    break
  fi
  if [[ $IN_MANIFEST -eq 1 ]]; then
    # Strip leading "- `" or "- " prefix
    stripped="${line#- \`}"
    stripped="${stripped#- }"
    # Strip trailing "`" and any trailing parenthetical
    stripped="${stripped%%\`*}"
    stripped="${stripped%% (*}"
    # Strip all whitespace (forward-slash paths have none, but be safe)
    stripped="$(printf '%s' "$stripped" | tr -d ' ')"
    if [[ -n "$stripped" ]]; then
      MANIFEST_FILES+=("$stripped")
    fi
  fi
done < "$PLAN_FILE"

echo "[qg-path-audit] Manifest has ${#MANIFEST_FILES[@]} entries." >&2

# ── Step 5: Get touched files ─────────────────────────────────────────────────
# Derive project root from wave dir: <proj>/.planning/wave-<slug> → 2 levels up.
PROJ_ROOT="$(cd "$WAVE_DIR/../.." && pwd)"

TOUCHED_FILES=()
while IFS= read -r f; do
  # Normalize to forward-slash (Windows safety)
  f="${f//\\//}"
  [[ -n "$f" ]] && TOUCHED_FILES+=("$f")
done < <(git -C "$PROJ_ROOT" diff --name-only "${BASE_REF}..HEAD" 2>/dev/null || true)

echo "[qg-path-audit] Touched files: ${#TOUCHED_FILES[@]}" >&2

# ── Step 6: Out-of-manifest check ────────────────────────────────────────────

FAIL=0
for touched in "${TOUCHED_FILES[@]}"; do
  IN_MAN=0
  for manifest_entry in "${MANIFEST_FILES[@]+"${MANIFEST_FILES[@]}"}"; do
    if [[ "$touched" == "$manifest_entry" ]]; then
      IN_MAN=1
      break
    fi
  done
  if [[ $IN_MAN -eq 0 ]]; then
    echo "[qg-path-audit] FAIL: out-of-manifest touched file: $touched"
    echo "[qg-path-audit] FAIL: out-of-manifest touched file: $touched" >&2
    FAIL=1
  fi
done

# ── Step 7: Under-declared class check ───────────────────────────────────────
# If any touched file matches a HARNESS pattern AND declared class is NOT HARNESS → fail.

HARNESS_PATTERNS=(
  '^\.claude/hooks/'
  '^scripts/'
  '^setup/agent-templates/'
  '^\.github/'
  '(^|/)settings\.json$'
)

if [[ "$CLASS_SENTINEL" != "HARNESS" ]]; then
  for touched in "${TOUCHED_FILES[@]+"${TOUCHED_FILES[@]}"}"; do
    for pattern in "${HARNESS_PATTERNS[@]}"; do
      matches=0
      echo "$touched" | grep -qE "$pattern" && matches=1 || true
      if [[ $matches -eq 1 ]]; then
        echo "[qg-path-audit] FAIL: HARNESS-pattern path '$touched' touched but declared class is '$CLASS_SENTINEL'"
        echo "[qg-path-audit] FAIL: HARNESS-pattern path '$touched' touched but declared class is '$CLASS_SENTINEL'" >&2
        FAIL=1
      fi
    done
  done
fi

if [[ $FAIL -ne 0 ]]; then
  exit 1
fi

echo "[qg-path-audit] PASS: all checks passed (CLASS=$CLASS_SENTINEL, ${#TOUCHED_FILES[@]} touched, all in manifest)."
exit 0
