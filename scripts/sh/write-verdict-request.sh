#!/usr/bin/env bash
# write-verdict-request.sh — Creates an immutable verdict-request/v1 record
# (PLAN.md sec 3.1/3.2). "The orchestrator invokes it before dispatch and passes
# the resulting path and digest to the architect. A request is immutable and
# single-purpose; it is never overwritten or reused for a second verdict."
#
# USAGE
#   write-verdict-request.sh --role <arch-role> --phase <prep|verify-final> [--slug <slug>]
#
# STDOUT (success only)
#   Exactly one line: "<absolute-path> <64hex-sha256>"
#
# SUBJECT
#   --phase prep: {"kind":"plan", path=PLAN.md, sha256=plan_sha256} (subject IS the plan).
#   --phase verify-final: a fresh source-manifest/v1 artifact is generated first via
#     `git diff --name-only <base>..HEAD` (base ref: same fallback chain as
#     emit-push-proof.sh: origin/develop -> develop -> HEAD~1), written to
#     .planning/wave-<slug>/source-manifests/<request-id>.json (sibling to
#     verdict-requests/<request-id>.json); subject points at that artifact.
#
# Delegates all schema-validation + durable writing to
# verdict-evidence-contract-cli.cjs's publish-record subcommand (backed by
# verdict-artifact-store.cjs's publishNoClobber) -- this script only gathers
# flags, resolves HEAD/PLAN.md/the diff, and assembles JSON via python3 json.dump
# (env vars in, never a value string-interpolated into a JSON template).
#
# SLUG RESOLUTION (priority order via scripts/sh/lib/wave-slug.sh)
#   1. --slug <value>   explicit override
#   2. $CLAUDE_WAVE_SLUG env var
#   3. git branch name  last segment after '/'
#   4. single .planning/wave-*/PLAN.md alias
#
# EXIT CODES
#   0  success
#   1  usage / argument error
#   2  integrity violation (traversal, protected slug, unresolvable HEAD, missing
#      PLAN.md, unresolvable diff base ref, confinement failure, rejected write)
#
# Fail-CLOSED on integrity; this writer has no bypass.

set -euo pipefail

VALID_ROLES=("arch-platform" "arch-testing" "arch-integration")
VALID_PHASES=("prep" "verify-final")

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WAVE_SLUG_LIB="$SCRIPT_DIR/lib/wave-slug.sh"
if [[ ! -f "$WAVE_SLUG_LIB" ]]; then
  echo "[write-verdict-request] ERROR: wave slug helper not found: $WAVE_SLUG_LIB" >&2
  exit 2
fi
# shellcheck source=scripts/sh/lib/wave-slug.sh
source "$WAVE_SLUG_LIB"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[write-verdict-request] ERROR: python3 is required to author the request/manifest JSON but was not found on PATH." >&2
  exit 2
fi
if ! command -v node >/dev/null 2>&1; then
  echo "[write-verdict-request] ERROR: node is required (request_id generation + CLI delegation) but was not found on PATH." >&2
  exit 2
fi

CLI="$SCRIPT_DIR/../lib/verdict-evidence-contract-cli.cjs"

# ── Argument parsing ─────────────────────────────────────────────────────────

ROLE=""
PHASE=""
SLUG_OVERRIDE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --role) ROLE="${2:-}"; shift 2 ;;
    --phase) PHASE="${2:-}"; shift 2 ;;
    --slug) SLUG_OVERRIDE="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,/^$/p' "$0"; exit 0 ;;
    *) echo "[write-verdict-request] ERROR: Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$ROLE" ]]; then
  echo "[write-verdict-request] ERROR: --role is required (arch-platform|arch-testing|arch-integration)" >&2
  exit 1
fi
role_valid=0
for r in "${VALID_ROLES[@]}"; do [[ "$ROLE" == "$r" ]] && role_valid=1 && break; done
if [[ "$role_valid" -ne 1 ]]; then
  echo "[write-verdict-request] ERROR: Invalid role '$ROLE'. Must be one of: ${VALID_ROLES[*]}" >&2
  exit 2
fi

if [[ -z "$PHASE" ]]; then
  echo "[write-verdict-request] ERROR: --phase is required (prep|verify-final)" >&2
  exit 1
fi
phase_valid=0
for p in "${VALID_PHASES[@]}"; do [[ "$PHASE" == "$p" ]] && phase_valid=1 && break; done
if [[ "$phase_valid" -ne 1 ]]; then
  echo "[write-verdict-request] ERROR: Invalid phase '$PHASE'. Must be one of: ${VALID_PHASES[*]}" >&2
  exit 2
fi

# ── Repo root + slug resolution ───────────────────────────────────────────────

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

resolve_slug() {
  if [[ -n "$SLUG_OVERRIDE" ]]; then
    if ! _validate_slug "$SLUG_OVERRIDE"; then
      if [[ "$SLUG_OVERRIDE" == *".."* || "$SLUG_OVERRIDE" == *"/"* || "$SLUG_OVERRIDE" == *"\\"* ]]; then
        echo "[write-verdict-request] ERROR: Traversal attempt detected in slug '$SLUG_OVERRIDE'" >&2
      else
        echo "[write-verdict-request] ERROR: Invalid slug '$SLUG_OVERRIDE'." >&2
      fi
      exit 2
    fi
    echo "$SLUG_OVERRIDE"
    return
  fi

  local slug=""
  slug="$(get_wave_slug "$REPO_ROOT" || true)"
  if [[ -z "$slug" ]]; then
    echo "[write-verdict-request] ERROR: Cannot resolve wave slug. Provide --slug or use CLAUDE_WAVE_SLUG, a non-protected branch, or a single .planning/wave-*/PLAN.md alias." >&2
    exit 2
  fi
  echo "$slug"
}

WAVE_SLUG="$(resolve_slug)"
if [[ -z "$WAVE_SLUG" ]]; then
  echo "[write-verdict-request] ERROR: Resolved slug is empty." >&2
  exit 2
fi

if [[ "$WAVE_SLUG" == *".."* || "$WAVE_SLUG" == *"/"* || "$WAVE_SLUG" == *"\\"* ]]; then
  echo "[write-verdict-request] ERROR: Traversal attempt detected in slug '$WAVE_SLUG'" >&2
  exit 2
fi

if [[ "$WAVE_SLUG" =~ ^(develop|master|main|HEAD)$ ]]; then
  echo "[write-verdict-request] ERROR: Slug '$WAVE_SLUG' is a protected branch name and cannot be used as a wave slug." >&2
  exit 2
fi

# ── Path layout ────────────────────────────────────────────────────────────────

PLANNING_DIR="$REPO_ROOT/.planning"
WAVE_DIR="$PLANNING_DIR/wave-$WAVE_SLUG"
PLAN_PATH="$WAVE_DIR/PLAN.md"
PLAN_PATH_REL="PLAN.md"
REQUESTS_DIR="$WAVE_DIR/verdict-requests"
MANIFESTS_DIR="$WAVE_DIR/source-manifests"

# ── Confinement (realpath guard with pure-shell fallback -- mirrors every sibling) ──

_shell_physical_resolve() {
  local p="$1"
  case "$p" in
    /*) : ;;
    [A-Za-z]:/*) : ;;
    *)  p="$PWD/$p" ;;
  esac
  local tail="" cur="$p" base parent
  while [[ ! -e "$cur" ]]; do
    base="$(basename "$cur")"
    if [[ -z "$tail" ]]; then tail="$base"; else tail="$base/$tail"; fi
    parent="$(dirname "$cur")"
    if [[ "$parent" == "$cur" ]]; then
      cur="$parent"
      break
    fi
    cur="$parent"
  done
  local physical
  physical="$(cd "$cur" 2>/dev/null && pwd -P)" || return 1
  if [[ -n "$tail" ]]; then
    printf '%s/%s' "$physical" "$tail"
  else
    printf '%s' "$physical"
  fi
}

_realpath_resolve() {
  local p="$1" r=""
  if command -v realpath >/dev/null 2>&1; then
    r="$(realpath -m "$p" 2>/dev/null || true)"
  fi
  if [[ -z "$r" ]]; then
    r="$(_shell_physical_resolve "$p" 2>/dev/null || true)"
  fi
  if [[ -z "$r" ]] && command -v python3 >/dev/null 2>&1; then
    r="$(python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "$p" 2>/dev/null || true)"
  fi
  printf '%s' "$r"
}

_confine_under_planning() {
  local target="$1"
  local canon_planning canon_target
  canon_planning="$(_realpath_resolve "$PLANNING_DIR")"
  canon_target="$(_realpath_resolve "$target")"
  if [[ -z "$canon_planning" || -z "$canon_target" ]]; then
    echo "[write-verdict-request] ERROR: Traversal guard: unable to resolve a canonical path for the confinement check — failing closed." >&2
    exit 2
  fi
  if [[ "$canon_target" != "$canon_planning" && "$canon_target" != "$canon_planning"/* ]]; then
    echo "[write-verdict-request] ERROR: Traversal guard: path escapes .planning/ confinement" >&2
    exit 2
  fi
}

_confine_under_planning "$REQUESTS_DIR"
_confine_under_planning "$MANIFESTS_DIR"

_sha256_file() {
  local f="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$f" | awk '{print $1}'
  else
    shasum -a 256 "$f" | awk '{print $1}'
  fi
}

# ── HEAD (fail-closed) ────────────────────────────────────────────────────────

HEAD_SHA="$(git rev-parse HEAD 2>/dev/null || true)"
if [[ ! "$HEAD_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "[write-verdict-request] ERROR: git rev-parse HEAD failed or returned non-hex '$HEAD_SHA'. Aborting — resolve HEAD before writing a request." >&2
  exit 2
fi

# ── PLAN.md (fail-closed) ─────────────────────────────────────────────────────

if [[ ! -f "$PLAN_PATH" ]]; then
  echo "[write-verdict-request] ERROR: Plan file not found: $PLAN_PATH. A verdict request requires an existing wave PLAN.md." >&2
  exit 2
fi
PLAN_SHA256="$(_sha256_file "$PLAN_PATH" 2>/dev/null || true)"
if [[ -z "$PLAN_SHA256" ]]; then
  echo "[write-verdict-request] ERROR: Failed to compute sha256 of $PLAN_PATH (sha256sum/shasum unavailable or read error)." >&2
  exit 2
fi

mkdir -p "$REQUESTS_DIR"
mkdir -p "$MANIFESTS_DIR"

REQUEST_ID="$(node -e "process.stdout.write(require('crypto').randomBytes(16).toString('hex'))")"
NOW="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
REQ_FILE="$REQUESTS_DIR/$REQUEST_ID.json"

# ── Subject ────────────────────────────────────────────────────────────────────

if [[ "$PHASE" == "prep" ]]; then
  SUBJECT_KIND="plan"
  SUBJECT_PATH="$PLAN_PATH_REL"
  SUBJECT_SHA256="$PLAN_SHA256"
else
  BASE_REF="$(git merge-base HEAD origin/develop 2>/dev/null || git merge-base HEAD develop 2>/dev/null || git rev-parse HEAD~1 2>/dev/null || true)"
  if [[ -z "$BASE_REF" ]]; then
    echo "[write-verdict-request] ERROR: Could not resolve a base ref for the source-manifest diff (no origin/develop, develop, or HEAD~1 available)." >&2
    exit 2
  fi
  MANIFEST_FILE="$MANIFESTS_DIR/$REQUEST_ID.json"
  MR_FILES_ENV="$(git diff --name-only "$BASE_REF"..HEAD | sort)"
  MR_FILES="$MR_FILES_ENV" python3 -c '
import json, os, sys
files_raw = os.environ.get("MR_FILES", "")
files = [f for f in files_raw.split("\n") if f != ""]
json.dump({"schema": "source-manifest/v1", "files": files}, sys.stdout, separators=(",", ":"))
sys.stdout.write("\n")
' | node "$CLI" publish-record --path "$MANIFEST_FILE" >/dev/null

  SUBJECT_KIND="source-manifest"
  SUBJECT_PATH="source-manifests/$REQUEST_ID.json"
  SUBJECT_SHA256="$(_sha256_file "$MANIFEST_FILE")"
fi

# ── Assemble + publish the request (safe JSON: env vars -> python3 json.dump, ──
# never a value string-interpolated into a JSON template) ─────────────────────

RQ_SCHEMA="verdict-request/v1" \
RQ_REQUEST_ID="$REQUEST_ID" \
RQ_ROLE="$ROLE" \
RQ_PHASE="$PHASE" \
RQ_WAVE_SLUG="$WAVE_SLUG" \
RQ_PLAN_SHA256="$PLAN_SHA256" \
RQ_HEAD="$HEAD_SHA" \
RQ_SUBJECT_KIND="$SUBJECT_KIND" \
RQ_SUBJECT_PATH="$SUBJECT_PATH" \
RQ_SUBJECT_SHA256="$SUBJECT_SHA256" \
RQ_CREATED_AT="$NOW" \
python3 -c '
import json, os, sys
payload = {
    "schema": os.environ["RQ_SCHEMA"],
    "request_id": os.environ["RQ_REQUEST_ID"],
    "role": os.environ["RQ_ROLE"],
    "phase": os.environ["RQ_PHASE"],
    "wave_slug": os.environ["RQ_WAVE_SLUG"],
    "plan_sha256": os.environ["RQ_PLAN_SHA256"],
    "head": os.environ["RQ_HEAD"],
    "subject": {
        "kind": os.environ["RQ_SUBJECT_KIND"],
        "path": os.environ["RQ_SUBJECT_PATH"],
        "sha256": os.environ["RQ_SUBJECT_SHA256"],
    },
    "created_at": os.environ["RQ_CREATED_AT"],
}
json.dump(payload, sys.stdout, separators=(",", ":"))
sys.stdout.write("\n")
' | node "$CLI" publish-record --kind request --path "$REQ_FILE" >/dev/null

REQ_DIGEST="$(_sha256_file "$REQ_FILE")"
echo "[write-verdict-request] request written: $REQ_FILE" >&2
printf '%s %s\n' "$REQ_FILE" "$REQ_DIGEST"
