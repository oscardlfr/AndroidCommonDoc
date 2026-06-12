#!/usr/bin/env bash
# write-verdict.sh — Canonical two-phase verdict writer for arch-* agents.
#
# USAGE
#   write-verdict.sh --role <arch-role> --phase <prep|verify-final> [--slug <wave-slug>]
#
# PHASES
#   prep          Creates the verdict file with an APPROVED-PREP header.
#                 Fails (exit 2) if the file already exists (duplicate guard).
#   verify-final  Appends an APPROVED-FINAL block to an existing verdict file.
#                 Fails (exit 2) if no prep file is found (prevents orphan finals).
#                 Fails (exit 2) if the file contains a dual-token (both APPROVED-PREP
#                 AND APPROVED-FINAL already present — replay guard).
#
# SLUG RESOLUTION (priority order)
#   1. --slug <value>   explicit override
#   2. $CLAUDE_WAVE_SLUG env var   (NOTE: does NOT persist between Bash calls in Claude;
#                                   branch resolution below is the effective path)
#   3. git branch name  feature/<slug> → slug extracted from suffix after last '/'
#
# ANTI-TRAVERSAL
#   The verdict file path is confined to .planning/<wave-slug>/arch-<role>-verdict.md
#   within the repo root. Any traversal attempt (.. segments) causes exit 2.
#
# ROLES
#   Valid: arch-platform, arch-testing, arch-integration
#
# EXIT CODES
#   0  success
#   1  usage / argument error (non-fatal for hook chain)
#   2  integrity violation (blocked: traversal, duplicate, orphan final, dual-token)
#
# Fail-CLOSED on integrity; Fail-OPEN only for env/infrastructure issues (missing git
# is non-fatal — slug falls back gracefully).

set -euo pipefail

# ── Constants ────────────────────────────────────────────────────────────────

VALID_ROLES=("arch-platform" "arch-testing" "arch-integration")
VALID_PHASES=("prep" "verify-final")

# ── Argument parsing ─────────────────────────────────────────────────────────

ROLE=""
PHASE=""
SLUG_OVERRIDE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --role)
      ROLE="${2:-}"
      shift 2
      ;;
    --phase)
      PHASE="${2:-}"
      shift 2
      ;;
    --slug)
      SLUG_OVERRIDE="${2:-}"
      shift 2
      ;;
    -h|--help)
      sed -n '2,/^$/p' "$0"
      exit 0
      ;;
    *)
      echo "[write-verdict] ERROR: Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

# ── Validate role ─────────────────────────────────────────────────────────────

if [[ -z "$ROLE" ]]; then
  echo "[write-verdict] ERROR: --role is required (arch-platform|arch-testing|arch-integration)" >&2
  exit 1
fi

role_valid=0
for r in "${VALID_ROLES[@]}"; do
  [[ "$ROLE" == "$r" ]] && role_valid=1 && break
done
if [[ "$role_valid" -ne 1 ]]; then
  echo "[write-verdict] ERROR: Invalid role '$ROLE'. Must be one of: ${VALID_ROLES[*]}" >&2
  exit 2
fi

# ── Validate phase ────────────────────────────────────────────────────────────

if [[ -z "$PHASE" ]]; then
  echo "[write-verdict] ERROR: --phase is required (prep|verify-final)" >&2
  exit 1
fi

phase_valid=0
for p in "${VALID_PHASES[@]}"; do
  [[ "$PHASE" == "$p" ]] && phase_valid=1 && break
done
if [[ "$phase_valid" -ne 1 ]]; then
  echo "[write-verdict] ERROR: Invalid phase '$PHASE'. Must be one of: ${VALID_PHASES[*]}" >&2
  exit 2
fi

# ── Slug resolution ───────────────────────────────────────────────────────────
# Priority: --slug > $CLAUDE_WAVE_SLUG > git branch name

resolve_slug() {
  if [[ -n "$SLUG_OVERRIDE" ]]; then
    echo "$SLUG_OVERRIDE"
    return
  fi

  if [[ -n "${CLAUDE_WAVE_SLUG:-}" ]]; then
    echo "$CLAUDE_WAVE_SLUG"
    return
  fi

  # Branch-name resolution: feature/<slug> → slug after last '/'
  local branch=""
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
  if [[ -n "$branch" && "$branch" == *"/"* ]]; then
    echo "${branch##*/}"
    return
  fi

  echo "[write-verdict] ERROR: Cannot resolve wave slug. Provide --slug or ensure git branch is feature/<slug>" >&2
  exit 2
}

WAVE_SLUG="$(resolve_slug)"

if [[ -z "$WAVE_SLUG" ]]; then
  echo "[write-verdict] ERROR: Resolved slug is empty." >&2
  exit 2
fi

# ── Anti-traversal check on slug ──────────────────────────────────────────────

if [[ "$WAVE_SLUG" == *".."* || "$WAVE_SLUG" == *"/"* || "$WAVE_SLUG" == *"\\"* ]]; then
  echo "[write-verdict] ERROR: Traversal attempt detected in slug '$WAVE_SLUG'" >&2
  exit 2
fi

# ── Repo root + verdict path (confinement) ────────────────────────────────────

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
PLANNING_DIR="$REPO_ROOT/.planning"
WAVE_DIR="$PLANNING_DIR/wave-$WAVE_SLUG"
VERDICT_FILE="$WAVE_DIR/arch-${ROLE#arch-}-verdict.md"

# Re-derive via realpath to prevent symlink traversal (if available)
if command -v realpath >/dev/null 2>&1; then
  # Only resolve the parent (wave dir may not exist yet for prep)
  canon_planning="$(realpath -m "$PLANNING_DIR" 2>/dev/null || echo "$PLANNING_DIR")"
  canon_verdict="$(realpath -m "$VERDICT_FILE" 2>/dev/null || echo "$VERDICT_FILE")"
  # Verify the verdict path stays inside .planning/
  if [[ "$canon_verdict" != "$canon_planning"* ]]; then
    echo "[write-verdict] ERROR: Traversal guard: verdict path escapes .planning/ confinement" >&2
    exit 2
  fi
fi

# ── Timestamp ─────────────────────────────────────────────────────────────────

NOW="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# ── Phase: prep ───────────────────────────────────────────────────────────────

run_prep() {
  if [[ -f "$VERDICT_FILE" ]]; then
    echo "[write-verdict] ERROR: Verdict file already exists (duplicate prep guard): $VERDICT_FILE" >&2
    exit 2
  fi

  mkdir -p "$WAVE_DIR"

  cat > "$VERDICT_FILE" <<EOF
# $ROLE verdict — wave-$WAVE_SLUG

**Phase**: PREP
**Timestamp**: $NOW
**Status**: APPROVED-PREP

EOF

  echo "[write-verdict] PREP written: $VERDICT_FILE" >&2
}

# ── Phase: verify-final ───────────────────────────────────────────────────────

run_verify_final() {
  if [[ ! -f "$VERDICT_FILE" ]]; then
    echo "[write-verdict] ERROR: No prep verdict found — run --phase prep first: $VERDICT_FILE" >&2
    exit 2
  fi

  local content
  content="$(cat "$VERDICT_FILE")"

  # Dual-token guard: block if BOTH tokens already present (replay prevention)
  local has_prep=0 has_final=0
  [[ "$content" == *"APPROVED-PREP"* ]] && has_prep=1
  [[ "$content" == *"APPROVED-FINAL"* ]] && has_final=1

  if [[ "$has_prep" -eq 1 && "$has_final" -eq 1 ]]; then
    echo "[write-verdict] ERROR: Verdict file already contains both APPROVED-PREP and APPROVED-FINAL (dual-token replay guard): $VERDICT_FILE" >&2
    exit 2
  fi

  # Legacy heredoc dual-token detection: if the content looks like it was written
  # via the old heredoc route with both tokens in the body, warn on stderr but do NOT
  # block — this is a migration path warning only.
  if [[ "$has_prep" -eq 0 && "$content" == *"APPROVED-FINAL"* ]]; then
    echo "[write-verdict] WARN: Verdict file has APPROVED-FINAL but no APPROVED-PREP header — possible legacy heredoc write. Proceeding." >&2
  fi

  cat >> "$VERDICT_FILE" <<EOF

---

**Phase**: VERIFY-FINAL
**Timestamp**: $NOW
**Status**: APPROVED-FINAL

EOF

  echo "[write-verdict] VERIFY-FINAL appended: $VERDICT_FILE" >&2
}

# ── Dispatch ──────────────────────────────────────────────────────────────────

case "$PHASE" in
  prep)         run_prep ;;
  verify-final) run_verify_final ;;
esac
