#!/usr/bin/env bash
# write-verdict.sh — Canonical two-phase verdict writer for arch-* agents.
#
# USAGE
#   write-verdict.sh --role <arch-role> --phase <prep|verify-final> [--slug <wave-slug>]
#
# PHASES
#   prep          Creates the verdict file with an APPROVED-PREP header.
#                 Fails (exit 2) if the file already exists (duplicate guard).
#   verify-final  Reads architect verdict from stdin, then appends it plus an
#                 APPROVED-VERIFY-FINAL closing block to the existing prep file.
#                 Fails (exit 2) if no prep file is found (prevents orphan finals).
#                 Fails (exit 2) if the file contains a dual-token (both APPROVED-PREP
#                 AND APPROVED-VERIFY-FINAL already present — replay guard).
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
# Priority: --slug > $CLAUDE_WAVE_SLUG > git branch last-segment
# P2b fix: always extract last segment so non-feature branches (codex/*, hotfix/*)
# resolve correctly. develop/master/main/HEAD are rejected unconditionally.

resolve_slug() {
  if [[ -n "$SLUG_OVERRIDE" ]]; then
    echo "$SLUG_OVERRIDE"
    return
  fi

  if [[ -n "${CLAUDE_WAVE_SLUG:-}" ]]; then
    echo "$CLAUDE_WAVE_SLUG"
    return
  fi

  # Branch-name resolution: always take last segment (works for feature/* AND codex/* etc.)
  # Use symbolic-ref as primary: works on empty repos (no commits yet) and detached HEAD alike.
  # Fall back to abbrev-ref for worktrees and other edge cases.
  local branch=""
  local slug=""
  branch="$(git symbolic-ref --short HEAD 2>/dev/null || git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
  slug="${branch##*/}"

  # Reject protected branch names and empty slug
  if [[ -z "$slug" || "$slug" =~ ^(develop|master|main|HEAD)$ ]]; then
    echo "[write-verdict] ERROR: Cannot resolve wave slug from branch '$branch'. Provide --slug or use a non-protected branch (slug = last path segment)." >&2
    exit 2
  fi

  echo "$slug"
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

# ── Reject protected branch names (P2b: applies to ALL slug sources including --slug) ──

if [[ "$WAVE_SLUG" =~ ^(develop|master|main|HEAD)$ ]]; then
  echo "[write-verdict] ERROR: Slug '$WAVE_SLUG' is a protected branch name and cannot be used as a wave slug." >&2
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

  # Dual-token guard: block if BOTH tokens already present (replay prevention).
  # Matching is LINE-ANCHORED — prose that mentions a token does NOT trigger the guard.
  # Accepted forms for APPROVED-PREP:
  #   - "**Status**: APPROVED-PREP"    (script-written prep)
  #   - "APPROVED-PREP"                (bare line, manually written by arch)
  #   - "**Verdict: APPROVED-PREP**"   (bold form used in L3 manual verdicts)
  # Accepted forms for APPROVED-VERIFY-FINAL:
  #   - "**Status**: APPROVED-VERIFY-FINAL"  (script-written verify-final)
  #   - "APPROVED-VERIFY-FINAL"              (bare line, manually written)
  local has_prep=0 has_final=0
  grep -qE '^\*\*Status\*\*: APPROVED-PREP$|^APPROVED-PREP$|^\*\*Verdict: APPROVED-PREP\*\*$' "$VERDICT_FILE" && has_prep=1
  grep -qE '^\*\*Status\*\*: APPROVED-VERIFY-FINAL$|^APPROVED-VERIFY-FINAL$' "$VERDICT_FILE" && has_final=1

  if [[ "$has_prep" -eq 1 && "$has_final" -eq 1 ]]; then
    echo "[write-verdict] ERROR: Verdict file already contains both APPROVED-PREP and APPROVED-VERIFY-FINAL (dual-token replay guard): $VERDICT_FILE" >&2
    exit 2
  fi

  # Legacy heredoc dual-token detection: warn if APPROVED-FINAL (old token) appears on
  # its own line but no APPROVED-PREP line is found. Warn only — do not block.
  if [[ "$has_prep" -eq 0 ]] && grep -qE '^\*\*Status\*\*: APPROVED-FINAL$|^APPROVED-FINAL$' "$VERDICT_FILE"; then
    echo "[write-verdict] WARN: Verdict file has APPROVED-FINAL but no APPROVED-PREP line — possible legacy heredoc write. Proceeding." >&2
  fi

  # Read architect verdict content from stdin (the body written by the architect)
  local stdin_content=""
  if [[ -t 0 ]]; then
    # stdin is a terminal — no piped content (e.g. direct shell invocation without pipe)
    stdin_content=""
  else
    stdin_content="$(cat)"
  fi

  {
    if [[ -n "$stdin_content" ]]; then
      printf '%s\n' "$stdin_content"
      printf '\n---\n\n'
    fi
    printf '**Phase**: VERIFY-FINAL\n'
    printf '**Timestamp**: %s\n' "$NOW"
    printf '**Status**: APPROVED-VERIFY-FINAL\n\n'
  } >> "$VERDICT_FILE"

  echo "[write-verdict] VERIFY-FINAL appended: $VERDICT_FILE" >&2
}

# ── Dispatch ──────────────────────────────────────────────────────────────────

case "$PHASE" in
  prep)         run_prep ;;
  verify-final) run_verify_final ;;
esac
