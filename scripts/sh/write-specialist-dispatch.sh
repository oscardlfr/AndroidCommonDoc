#!/usr/bin/env bash
# write-specialist-dispatch.sh — Canonical dispatch-artifact writer: architect -> specialist
# authorization (disk-first specialist<->architect binding).
#
# USAGE
#   write-specialist-dispatch.sh --architect <arch-role> --specialist <spec-role> \
#       --file <path> [--file <path> ...] [--slug <wave-slug>] [--summary <text>] [--bash-only]
#   # Task body is read from stdin (required, non-empty).
#
# FIELDS WRITTEN (JSON, schema "specialist-dispatch/v1")
#   schema, wave_slug, architect, specialist, head, plan_path, plan_sha256,
#   files[], bash_only, allowed_tools[], summary, task, created_at
#
# ARCHITECTS (--architect)
#   Valid: arch-platform, arch-testing, arch-integration
#
# SPECIALISTS (--specialist)
#   Valid: test-specialist, toolkit-specialist, ui-specialist, domain-model-specialist,
#          data-layer-specialist
#   doc-updater is intentionally REJECTED here — it is PREP-gated only and needs no
#   dispatch artifact (D4).
#
# --bash-only
#   Authorizes execution-Bash for the specialist with NO Write/Edit file targets. Records
#   bash_only:true + allowed_tools:["Bash"] in the JSON and permits an empty files[].
#   MUTUALLY EXCLUSIVE with --file (a bash-only dispatch must carry no files[]; combining
#   them is exit 2). Without --bash-only, at least one --file is required (empty files[] -> exit 2).
#
# --file <path>
#   Repeatable. Each value is stored repo-relative in files[]. allowed_tools[] is
#   informational-only in v1 — the gate authorizes Write/Edit purely via files[] membership.
#
# PLAN BINDING (no --plan-path override — hardcoded, symmetric with write-verdict.sh)
#   plan_path is always .planning/wave-<slug>/PLAN.md; the file must exist on disk or the
#   dispatch fails closed. plan_sha256 is the sha256 of its raw bytes (sha256sum, else
#   shasum -a 256) — matches the Node crypto Buffer-based hash used by the gate.
#
# HEAD BINDING
#   head is the current `git rev-parse HEAD` (must resolve to 40-hex, else exit 2 —
#   fail-closed; a dispatch can never be written against an unresolvable HEAD).
#
# SLUG RESOLUTION (priority order via scripts/sh/lib/wave-slug.sh)
#   1. --slug <value>   explicit override
#   2. $CLAUDE_WAVE_SLUG env var
#   3. git branch name  last segment after '/'
#   4. single .planning/wave-*/PLAN.md alias
#
# ANTI-TRAVERSAL
#   The dispatch file is confined to
#   .planning/<wave-slug>/specialist-dispatches/<specialist>/ within the repo root. Any
#   traversal attempt (.. segments) in the slug causes exit 2.
#
# OUTPUT
#   .planning/wave-<slug>/specialist-dispatches/<specialist>/<architect>-<YYYYMMDDTHHMMSSZ>.json
#
# EXIT CODES
#   0  success
#   1  usage / argument error (missing required flag value, unknown flag)
#   2  integrity violation (blocked: invalid architect/specialist incl. doc-updater,
#      traversal, protected slug, unresolvable HEAD, missing PLAN.md, unreadable PLAN.md,
#      empty/malformed --file value, empty files[] without --bash-only, empty task body,
#      missing python3)
#
# Fail-CLOSED on integrity; this writer has no bypass.

set -euo pipefail

# ── Constants ────────────────────────────────────────────────────────────────

VALID_ARCHITECTS=("arch-platform" "arch-testing" "arch-integration")
VALID_SPECIALISTS=("test-specialist" "toolkit-specialist" "ui-specialist" "domain-model-specialist" "data-layer-specialist")

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WAVE_SLUG_LIB="$SCRIPT_DIR/lib/wave-slug.sh"
if [[ ! -f "$WAVE_SLUG_LIB" ]]; then
  echo "[write-specialist-dispatch] ERROR: wave slug helper not found: $WAVE_SLUG_LIB" >&2
  exit 2
fi
# shellcheck source=scripts/sh/lib/wave-slug.sh
source "$WAVE_SLUG_LIB"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[write-specialist-dispatch] ERROR: python3 is required to author the dispatch JSON but was not found on PATH." >&2
  exit 2
fi

# ── Argument parsing ─────────────────────────────────────────────────────────

ARCHITECT=""
SPECIALIST=""
SLUG_OVERRIDE=""
SUMMARY=""
BASH_ONLY=0
FILES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --architect)
      ARCHITECT="${2:-}"
      shift 2
      ;;
    --specialist)
      SPECIALIST="${2:-}"
      shift 2
      ;;
    --file)
      FILES+=("${2:-}")
      shift 2
      ;;
    --slug)
      SLUG_OVERRIDE="${2:-}"
      shift 2
      ;;
    --summary)
      SUMMARY="${2:-}"
      shift 2
      ;;
    --bash-only)
      BASH_ONLY=1
      shift
      ;;
    -h|--help)
      sed -n '2,/^$/p' "$0"
      exit 0
      ;;
    *)
      echo "[write-specialist-dispatch] ERROR: Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

# ── Validate architect ────────────────────────────────────────────────────────

if [[ -z "$ARCHITECT" ]]; then
  echo "[write-specialist-dispatch] ERROR: --architect is required (arch-platform|arch-testing|arch-integration)" >&2
  exit 1
fi

architect_valid=0
for a in "${VALID_ARCHITECTS[@]}"; do
  [[ "$ARCHITECT" == "$a" ]] && architect_valid=1 && break
done
if [[ "$architect_valid" -ne 1 ]]; then
  echo "[write-specialist-dispatch] ERROR: Invalid architect '$ARCHITECT'. Must be one of: ${VALID_ARCHITECTS[*]}" >&2
  exit 2
fi

# ── Validate specialist ───────────────────────────────────────────────────────

if [[ -z "$SPECIALIST" ]]; then
  echo "[write-specialist-dispatch] ERROR: --specialist is required (test-specialist|toolkit-specialist|ui-specialist|domain-model-specialist|data-layer-specialist)" >&2
  exit 1
fi

specialist_valid=0
for s in "${VALID_SPECIALISTS[@]}"; do
  [[ "$SPECIALIST" == "$s" ]] && specialist_valid=1 && break
done
if [[ "$specialist_valid" -ne 1 ]]; then
  echo "[write-specialist-dispatch] ERROR: Invalid specialist '$SPECIALIST' (doc-updater is exempt from the dispatch requirement and is rejected here — D4). Must be one of: ${VALID_SPECIALISTS[*]}" >&2
  exit 2
fi

# ── Repo root + slug resolution ───────────────────────────────────────────────

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Priority: --slug > shared resolver ($CLAUDE_WAVE_SLUG > git branch > alias scan).

resolve_slug() {
  if [[ -n "$SLUG_OVERRIDE" ]]; then
    if ! _validate_slug "$SLUG_OVERRIDE"; then
      if [[ "$SLUG_OVERRIDE" == *".."* || "$SLUG_OVERRIDE" == *"/"* || "$SLUG_OVERRIDE" == *"\\"* ]]; then
        echo "[write-specialist-dispatch] ERROR: Traversal attempt detected in slug '$SLUG_OVERRIDE'" >&2
      else
        echo "[write-specialist-dispatch] ERROR: Invalid slug '$SLUG_OVERRIDE'." >&2
      fi
      exit 2
    fi
    echo "$SLUG_OVERRIDE"
    return
  fi

  local slug=""
  slug="$(get_wave_slug "$REPO_ROOT" || true)"
  if [[ -z "$slug" ]]; then
    echo "[write-specialist-dispatch] ERROR: Cannot resolve wave slug. Provide --slug or use CLAUDE_WAVE_SLUG, a non-protected branch, or a single .planning/wave-*/PLAN.md alias." >&2
    exit 2
  fi

  echo "$slug"
}

WAVE_SLUG="$(resolve_slug)"

if [[ -z "$WAVE_SLUG" ]]; then
  echo "[write-specialist-dispatch] ERROR: Resolved slug is empty." >&2
  exit 2
fi

# ── Anti-traversal check on slug ──────────────────────────────────────────────

if [[ "$WAVE_SLUG" == *".."* || "$WAVE_SLUG" == *"/"* || "$WAVE_SLUG" == *"\\"* ]]; then
  echo "[write-specialist-dispatch] ERROR: Traversal attempt detected in slug '$WAVE_SLUG'" >&2
  exit 2
fi

# ── Reject protected branch names (applies to ALL slug sources including --slug) ──

if [[ "$WAVE_SLUG" =~ ^(develop|master|main|HEAD)$ ]]; then
  echo "[write-specialist-dispatch] ERROR: Slug '$WAVE_SLUG' is a protected branch name and cannot be used as a wave slug." >&2
  exit 2
fi

# ── Path layout ────────────────────────────────────────────────────────────────

PLANNING_DIR="$REPO_ROOT/.planning"
WAVE_DIR="$PLANNING_DIR/wave-$WAVE_SLUG"
PLAN_PATH="$WAVE_DIR/PLAN.md"
PLAN_PATH_REL=".planning/wave-$WAVE_SLUG/PLAN.md"
DISPATCH_DIR="$WAVE_DIR/specialist-dispatches/$SPECIALIST"

# ── Resolve HEAD (fail-closed, D5) ────────────────────────────────────────────

HEAD_SHA="$(git rev-parse HEAD 2>/dev/null || true)"
if [[ ! "$HEAD_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "[write-specialist-dispatch] ERROR: git rev-parse HEAD failed or returned non-hex '$HEAD_SHA'. Aborting — resolve HEAD before writing a dispatch." >&2
  exit 2
fi

# ── Plan binding (F4 — hardcoded path, no --plan-path override) ──────────────

if [[ ! -f "$PLAN_PATH" ]]; then
  echo "[write-specialist-dispatch] ERROR: Plan file not found: $PLAN_PATH. A specialist dispatch requires an existing wave PLAN.md." >&2
  exit 2
fi

_sha256_file() {
  local f="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$f" | awk '{print $1}'
  else
    shasum -a 256 "$f" | awk '{print $1}'
  fi
}

PLAN_SHA256="$(_sha256_file "$PLAN_PATH" 2>/dev/null || true)"
if [[ -z "$PLAN_SHA256" ]]; then
  echo "[write-specialist-dispatch] ERROR: Failed to compute sha256 of $PLAN_PATH (sha256sum/shasum unavailable or read error)." >&2
  exit 2
fi

# ── Validate + normalize files[] ──────────────────────────────────────────────

# --bash-only is mutually exclusive with --file: a bash-only dispatch authorizes
# execution-Bash ONLY and must carry no Write/Edit targets (P2). Rejecting the combination
# keeps the invariant bash_only <=> empty files[] so the gate cannot be tricked into
# authorizing Write/Edit via a bash_only dispatch's files[].
if [[ "$BASH_ONLY" -eq 1 && "${#FILES[@]}" -gt 0 ]]; then
  echo "[write-specialist-dispatch] ERROR: --bash-only cannot be combined with --file. A bash-only dispatch authorizes execution-Bash only (no Write/Edit targets); omit --file." >&2
  exit 2
fi

if [[ "${#FILES[@]}" -eq 0 && "$BASH_ONLY" -ne 1 ]]; then
  echo "[write-specialist-dispatch] ERROR: --file is required at least once (or pass --bash-only to authorize execution-only Bash with no Write/Edit targets)." >&2
  exit 2
fi

# _file_in_repo <path> — return 0 if <path> resolves inside REPO_ROOT, 1 otherwise.
# Lexical checks first (work without realpath); realpath -m confirms mid-path (a/../../b) escapes.
_file_in_repo() {
  local f="$1" abs repo_canon
  if [[ "$f" == /* && "$f" != "$REPO_ROOT" && "$f" != "$REPO_ROOT"/* ]]; then
    return 1  # absolute path not under REPO_ROOT
  fi
  if [[ "$f" == ".." || "$f" == ../* ]]; then
    return 1  # relative path escaping upward
  fi
  if command -v realpath >/dev/null 2>&1; then
    repo_canon="$(realpath -m -- "$REPO_ROOT" 2>/dev/null || echo "$REPO_ROOT")"
    case "$f" in
      /*) abs="$(realpath -m -- "$f" 2>/dev/null || echo "$f")" ;;
      *)  abs="$(realpath -m -- "$REPO_ROOT/$f" 2>/dev/null || echo "$REPO_ROOT/$f")" ;;
    esac
    if [[ "$abs" != "$repo_canon" && "$abs" != "$repo_canon"/* ]]; then
      return 1  # realpath-resolved target escapes the repo
    fi
  fi
  return 0
}

NORMALIZED_FILES=()
if [[ "${#FILES[@]}" -gt 0 ]]; then
  for f in "${FILES[@]}"; do
    if [[ -z "$f" ]]; then
      echo "[write-specialist-dispatch] ERROR: --file requires a non-empty path argument." >&2
      exit 2
    fi
    # Reject --file targets resolving OUTSIDE the repo root (absolute-outside or ../-escape).
    # A dispatch files[] entry must be an in-repo Write/Edit target; out-of-tree work uses Bash.
    # Closes the P1 escape where a listed out-of-repo path would authorize an out-of-repo Write.
    if ! _file_in_repo "$f"; then
      echo "[write-specialist-dispatch] ERROR: --file '$f' resolves outside the repository root ($REPO_ROOT). files[] entries must be in-repo targets; use Bash for out-of-tree work." >&2
      exit 2
    fi
    # Normalize to repo-relative form. The gate re-normalizes both sides the same way.
    if [[ "$f" == "$REPO_ROOT"/* ]]; then
      f="${f#"$REPO_ROOT"/}"
    fi
    f="${f#./}"
    NORMALIZED_FILES+=("$f")
  done
fi

# ── Task body from stdin (required, non-empty) ────────────────────────────────

TASK_BODY=""
if [[ ! -t 0 ]]; then
  TASK_BODY="$(cat)"
fi

if [[ -z "$TASK_BODY" ]]; then
  echo "[write-specialist-dispatch] ERROR: Task body is required on stdin and must be non-empty." >&2
  exit 2
fi

# ── Confine output dir under .planning/ (realpath guard, symlink-traversal safe) ──

if command -v realpath >/dev/null 2>&1; then
  canon_planning="$(realpath -m "$PLANNING_DIR" 2>/dev/null || echo "$PLANNING_DIR")"
  canon_dispatch_dir="$(realpath -m "$DISPATCH_DIR" 2>/dev/null || echo "$DISPATCH_DIR")"
  if [[ "$canon_dispatch_dir" != "$canon_planning"* ]]; then
    echo "[write-specialist-dispatch] ERROR: Traversal guard: dispatch path escapes .planning/ confinement" >&2
    exit 2
  fi
fi

mkdir -p "$DISPATCH_DIR"

# ── Timestamp + output filename ───────────────────────────────────────────────

NOW="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
TS_COMPACT="$(date -u '+%Y%m%dT%H%M%SZ')"
DISPATCH_FILE="$DISPATCH_DIR/${ARCHITECT}-${TS_COMPACT}.json"

# ── Author JSON via python3 (safe escaping — never string-interpolated) ──────

DISPATCH_FILES_ENV=""
if [[ "${#NORMALIZED_FILES[@]}" -gt 0 ]]; then
  DISPATCH_FILES_ENV="$(printf '%s\n' "${NORMALIZED_FILES[@]}")"
fi

WD_SCHEMA="specialist-dispatch/v1" \
WD_WAVE_SLUG="$WAVE_SLUG" \
WD_ARCHITECT="$ARCHITECT" \
WD_SPECIALIST="$SPECIALIST" \
WD_HEAD="$HEAD_SHA" \
WD_PLAN_PATH="$PLAN_PATH_REL" \
WD_PLAN_SHA256="$PLAN_SHA256" \
WD_FILES="$DISPATCH_FILES_ENV" \
WD_BASH_ONLY="$BASH_ONLY" \
WD_SUMMARY="$SUMMARY" \
WD_TASK="$TASK_BODY" \
WD_CREATED_AT="$NOW" \
WD_OUT_PATH="$DISPATCH_FILE" \
python3 - <<'PYEOF'
import json
import os

files_raw = os.environ.get("WD_FILES", "")
files = [f for f in files_raw.split("\n") if f != ""]
bash_only = os.environ.get("WD_BASH_ONLY", "0") == "1"

payload = {
    "schema": os.environ["WD_SCHEMA"],
    "wave_slug": os.environ["WD_WAVE_SLUG"],
    "architect": os.environ["WD_ARCHITECT"],
    "specialist": os.environ["WD_SPECIALIST"],
    "head": os.environ["WD_HEAD"],
    "plan_path": os.environ["WD_PLAN_PATH"],
    "plan_sha256": os.environ["WD_PLAN_SHA256"],
    "files": files,
    "bash_only": bash_only,
    "allowed_tools": ["Bash"] if bash_only else [],
    "summary": os.environ.get("WD_SUMMARY", ""),
    "task": os.environ["WD_TASK"],
    "created_at": os.environ["WD_CREATED_AT"],
}

with open(os.environ["WD_OUT_PATH"], "w", encoding="utf-8") as fh:
    json.dump(payload, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
PYEOF

echo "[write-specialist-dispatch] Dispatch written: $DISPATCH_FILE (architect=$ARCHITECT specialist=$SPECIALIST head=${HEAD_SHA:0:12} bash_only=$BASH_ONLY files=${#NORMALIZED_FILES[@]})" >&2
