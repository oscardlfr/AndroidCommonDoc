#!/usr/bin/env bash
# write-coordination-artifact.sh — Canonical generic writer for portable coordination artifacts
# (message, consult, result, request, approval, stop) under .planning/wave-<slug>/. One engine
# among many that can produce these files — the schema+path+validator IS the contract (ADR-001
# §4.4); any file-capable runtime may write these directly without ever invoking this script.
#
# USAGE
#   write-coordination-artifact.sh --kind {message|consult|request|approval|result|stop} \
#       --from <role> --to <role> [--file <path> ...] [--re <id>] [--slug <wave-slug>]
#   # Kind-specific body fields are read from stdin as an OPTIONAL JSON object (see BODY below).
#
# BODY (stdin, optional unless noted)
#   A JSON object of kind-specific fields, shallow-merged UNDER the auto-stamped envelope (the
#   envelope always wins on key collision — stdin can never spoof schema/wave_slug/from/to/
#   created_at/head/plan_sha256/request_id/files). Non-empty stdin that fails to parse as a JSON
#   object is exit 2. Required per kind:
#     result:   body.status ∈ {ready-for-review, done, blocked}          (required)
#     request:  body.kind (e.g. "scope-extension")                       (required)
#               body.kind == "scope-extension" ⇒ at least one --file     (required)
#     approval: body.decision ∈ {authorized, denied}                     (required)
#               body.request_kind                                        (required)
#               body.approver                                            (defaults to --from)
#     message/consult/stop: no required body fields; stdin may be empty.
#
# FIELDS WRITTEN (JSON, schema "coordination/<kind>/v1")
#   schema, wave_slug, from, to, created_at, + head + plan_sha256 for message/result/request/
#   approval (NOT consult/stop — consult is pre-PLAN, stop is presence-only), + files[] (only
#   when --file given), + request_id (request: filename stem <from>-<ts>-<uniq>; approval: --re
#   value), + whatever else the stdin body supplied.
#
# --kind consult REQUIRES --to context-provider (the only valid recipient for this kind).
# --kind approval REQUIRES --re <request_id> (there is no other way to name the linked request).
# --kind stop with NO stdin body writes a bare zero-byte presence flag (no envelope at all).
#
# --file <path>
#   Repeatable. Each value is stored repo-relative in body.files[]. Anti-traversal: rejects any
#   --file resolving outside the repository root (lexical containment check, no realpath -m
#   dependency — see _file_in_repo below, cloned from write-specialist-dispatch.sh:270-303/312-316).
#
# PLAN BINDING (message/result/request/approval only — no --plan-path override, hardcoded path,
# symmetric with write-specialist-dispatch.sh/write-verdict.sh)
#   plan_path is always .planning/wave-<slug>/PLAN.md; the file must exist on disk or the write
#   fails closed. plan_sha256 is the sha256 of its raw bytes (sha256sum, else shasum -a 256).
#
# HEAD BINDING (message/result/request/approval only)
#   head is the current `git rev-parse HEAD` (must resolve to 40-hex, else exit 2).
#
# SLUG RESOLUTION (priority order via scripts/sh/lib/wave-slug.sh)
#   1. --slug <value>   explicit override
#   2. $CLAUDE_WAVE_SLUG env var
#   3. git branch name  last segment after '/'
#   4. single .planning/wave-*/PLAN.md alias
#
# CONFINEMENT
#   Every kind's output directory is confined under .planning/wave-<slug>/ (realpath guard, with a
#   python3 fallback when the `realpath` binary is absent/non-GNU — never a silent no-op; if
#   NEITHER can resolve a canonical path the write fails closed. See write-specialist-dispatch.sh:
#   340-349 for the original single-realpath-tool precedent this hardens).
#
# COLLISION SAFETY (message/consult/result/request — timestamp-keyed kinds only)
#   A bare compact-UTC timestamp has 1s resolution, so two same-kind writes in the same second
#   would otherwise silently overwrite each other. Each attempt appends a fresh <uniq> = hex(PID)
#   + 4 hex digits of $RANDOM to the filename, and the file is created EXCLUSIVELY (never
#   overwrites); on collision the write retries (bounded) with a freshly-generated <uniq>.
#   approval (keyed by --re's request_id) and stop (keyed by --to's role) are intentionally
#   NOT collision-guarded — both are fixed, single-canonical-path-per-key artifacts meant to be
#   updatable/idempotent (re-approving the same request, re-signaling the same stop), so they
#   still open in overwrite mode.
#
# OUTPUT PATHS (per kind)
#   message   .planning/wave-<slug>/inbox/<to>/<from>-<ts>-<uniq>.json (+ outbox/<from>/ mirror, same content)
#   consult   .planning/wave-<slug>/inbox/context-provider/consult-<ts>-<uniq>.json
#   result    .planning/wave-<slug>/results/<from>/<from>-<ts>-<uniq>.json
#   request   .planning/wave-<slug>/requests/<body.kind>/<from>-<ts>-<uniq>.json
#   approval  .planning/wave-<slug>/approvals/<re-id>.json
#   stop      .planning/wave-<slug>/stop-<to>.flag
#   <ts> = compact UTC `date -u +%Y%m%dT%H%M%SZ` (never ISO with ':'). created_at body field is
#   full ISO-8601 `date -u +%Y-%m-%dT%H:%M:%SZ`.
#
# EXIT CODES
#   0  success
#   1  usage / argument error (missing required flag value, unknown flag)
#   2  integrity violation (invalid kind, traversal, protected slug, unresolvable HEAD, missing
#      PLAN.md, empty/malformed --file value, --file escapes repo root, malformed stdin JSON,
#      missing required kind-specific body field, missing python3)
#
# Fail-CLOSED on integrity; this writer has no bypass.

set -euo pipefail

# ── Constants ────────────────────────────────────────────────────────────────

VALID_KINDS=("message" "consult" "request" "approval" "result" "stop")

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WAVE_SLUG_LIB="$SCRIPT_DIR/lib/wave-slug.sh"
if [[ ! -f "$WAVE_SLUG_LIB" ]]; then
  echo "[write-coordination-artifact] ERROR: wave slug helper not found: $WAVE_SLUG_LIB" >&2
  exit 2
fi
# shellcheck source=scripts/sh/lib/wave-slug.sh
source "$WAVE_SLUG_LIB"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[write-coordination-artifact] ERROR: python3 is required to author the artifact JSON but was not found on PATH." >&2
  exit 2
fi

# ── Argument parsing ─────────────────────────────────────────────────────────

KIND=""
FROM=""
TO=""
SLUG_OVERRIDE=""
RE_ID=""
FILES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --kind)
      KIND="${2:-}"
      shift 2
      ;;
    --from)
      FROM="${2:-}"
      shift 2
      ;;
    --to)
      TO="${2:-}"
      shift 2
      ;;
    --file)
      FILES+=("${2:-}")
      shift 2
      ;;
    --re)
      RE_ID="${2:-}"
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
      echo "[write-coordination-artifact] ERROR: Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

# ── Validate --kind ────────────────────────────────────────────────────────────

if [[ -z "$KIND" ]]; then
  echo "[write-coordination-artifact] ERROR: --kind is required (message|consult|request|approval|result|stop)" >&2
  exit 1
fi

kind_valid=0
for k in "${VALID_KINDS[@]}"; do
  [[ "$KIND" == "$k" ]] && kind_valid=1 && break
done
if [[ "$kind_valid" -ne 1 ]]; then
  echo "[write-coordination-artifact] ERROR: Invalid kind '$KIND'. Must be one of: ${VALID_KINDS[*]}" >&2
  exit 2
fi

# ── Validate --from / --to (safe path segments — they become directory/filename components) ──

if [[ -z "$FROM" ]] || ! _validate_slug "$FROM"; then
  echo "[write-coordination-artifact] ERROR: --from is required and must be a safe segment (got '$FROM')" >&2
  exit 1
fi
if [[ -z "$TO" ]] || ! _validate_slug "$TO"; then
  echo "[write-coordination-artifact] ERROR: --to is required and must be a safe segment (got '$TO')" >&2
  exit 1
fi

if [[ "$KIND" == "consult" && "$TO" != "context-provider" ]]; then
  echo "[write-coordination-artifact] ERROR: --kind consult requires --to context-provider (got '$TO')" >&2
  exit 2
fi
if [[ "$KIND" == "approval" && -z "$RE_ID" ]]; then
  echo "[write-coordination-artifact] ERROR: --kind approval requires --re <request_id> (the request being approved)" >&2
  exit 2
fi
if [[ -n "$RE_ID" ]] && ! _validate_slug "$RE_ID"; then
  echo "[write-coordination-artifact] ERROR: --re '$RE_ID' is not a safe segment" >&2
  exit 2
fi

# ── Repo root + slug resolution (identical priority/anti-traversal to write-specialist-dispatch.sh) ──

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

resolve_slug() {
  if [[ -n "$SLUG_OVERRIDE" ]]; then
    if ! _validate_slug "$SLUG_OVERRIDE"; then
      if [[ "$SLUG_OVERRIDE" == *".."* || "$SLUG_OVERRIDE" == *"/"* || "$SLUG_OVERRIDE" == *"\\"* ]]; then
        echo "[write-coordination-artifact] ERROR: Traversal attempt detected in slug '$SLUG_OVERRIDE'" >&2
      else
        echo "[write-coordination-artifact] ERROR: Invalid slug '$SLUG_OVERRIDE'." >&2
      fi
      exit 2
    fi
    echo "$SLUG_OVERRIDE"
    return
  fi

  local slug=""
  slug="$(get_wave_slug "$REPO_ROOT" || true)"
  if [[ -z "$slug" ]]; then
    echo "[write-coordination-artifact] ERROR: Cannot resolve wave slug. Provide --slug or use CLAUDE_WAVE_SLUG, a non-protected branch, or a single .planning/wave-*/PLAN.md alias." >&2
    exit 2
  fi

  echo "$slug"
}

WAVE_SLUG="$(resolve_slug)"

if [[ -z "$WAVE_SLUG" ]]; then
  echo "[write-coordination-artifact] ERROR: Resolved slug is empty." >&2
  exit 2
fi

if [[ "$WAVE_SLUG" == *".."* || "$WAVE_SLUG" == *"/"* || "$WAVE_SLUG" == *"\\"* ]]; then
  echo "[write-coordination-artifact] ERROR: Traversal attempt detected in slug '$WAVE_SLUG'" >&2
  exit 2
fi

if [[ "$WAVE_SLUG" =~ ^(develop|master|main|HEAD)$ ]]; then
  echo "[write-coordination-artifact] ERROR: Slug '$WAVE_SLUG' is a protected branch name and cannot be used as a wave slug." >&2
  exit 2
fi

# ── Path layout ────────────────────────────────────────────────────────────────

PLANNING_DIR="$REPO_ROOT/.planning"
WAVE_DIR="$PLANNING_DIR/wave-$WAVE_SLUG"
PLAN_PATH="$WAVE_DIR/PLAN.md"

# ── HEAD + PLAN binding (message/result/request/approval only — consult is pre-PLAN, stop is presence-only) ──

NEEDS_PLAN=0
case "$KIND" in
  message|result|request|approval) NEEDS_PLAN=1 ;;
esac

HEAD_SHA=""
PLAN_SHA256=""
if [[ "$NEEDS_PLAN" -eq 1 ]]; then
  HEAD_SHA="$(git rev-parse HEAD 2>/dev/null || true)"
  if [[ ! "$HEAD_SHA" =~ ^[0-9a-f]{40}$ ]]; then
    echo "[write-coordination-artifact] ERROR: git rev-parse HEAD failed or returned non-hex '$HEAD_SHA'. Aborting — resolve HEAD before writing a $KIND artifact." >&2
    exit 2
  fi
  if [[ ! -f "$PLAN_PATH" ]]; then
    echo "[write-coordination-artifact] ERROR: Plan file not found: $PLAN_PATH. A $KIND artifact requires an existing wave PLAN.md." >&2
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
    echo "[write-coordination-artifact] ERROR: Failed to compute sha256 of $PLAN_PATH (sha256sum/shasum unavailable or read error)." >&2
    exit 2
  fi
fi

# ── Validate + normalize --file (F1 anti-traversal, cloned verbatim from write-specialist-dispatch.sh:270-303) ──

# _file_in_repo <path> — return 0 if <path> resolves inside REPO_ROOT, 1 otherwise.
# PORTABLE (macOS/BSD + bash 3.2 + set -euo pipefail safe): collapses '.' and '..' segments
# PURELY LEXICALLY with NO realpath dependency — see write-specialist-dispatch.sh:270-277 for the
# full rationale (macOS/BSD realpath has no -m flag and fails open on non-existent paths).
_file_in_repo() {
  local f="$1" abs norm seg rest
  case "$f" in
    /*) abs="$f" ;;
    *)  abs="$REPO_ROOT/$f" ;;
  esac
  norm=""
  rest="$abs"
  while [[ -n "$rest" ]]; do
    seg="${rest%%/*}"
    if [[ "$rest" == */* ]]; then rest="${rest#*/}"; else rest=""; fi
    case "$seg" in
      ''|.) : ;;
      ..)   norm="${norm%/*}" ;;
      *)    norm="$norm/$seg" ;;
    esac
  done
  if [[ -z "$norm" ]]; then norm="/"; fi
  if [[ "$norm" != "$REPO_ROOT" && "$norm" != "$REPO_ROOT"/* ]]; then
    return 1
  fi
  return 0
}

NORMALIZED_FILES=()
if [[ "${#FILES[@]}" -gt 0 ]]; then
  for f in "${FILES[@]}"; do
    if [[ -z "$f" ]]; then
      echo "[write-coordination-artifact] ERROR: --file requires a non-empty path argument." >&2
      exit 2
    fi
    if ! _file_in_repo "$f"; then
      echo "[write-coordination-artifact] ERROR: --file '$f' resolves outside the repository root ($REPO_ROOT)." >&2
      exit 2
    fi
    if [[ "$f" == "$REPO_ROOT"/* ]]; then
      f="${f#"$REPO_ROOT"/}"
    fi
    f="${f#./}"
    NORMALIZED_FILES+=("$f")
  done
fi

if [[ "$KIND" == "request" && "${#NORMALIZED_FILES[@]}" -eq 0 ]]; then
  : # files[] requirement (scope-extension only) is enforced later, once body.kind is known
fi

# ── Body from stdin (optional; must be valid JSON object if non-empty) ───────────────────────

BODY_RAW=""
if [[ ! -t 0 ]]; then
  BODY_RAW="$(cat)"
fi

# ── request kind: the body's OWN "kind" sub-field selects the requests/<kind>/ subdirectory. ──
# Extracted + sanitized BEFORE the main authoring call so path confinement stays bash-side
# (mirrors write-specialist-dispatch.sh's division of labor: bash owns paths, python3 owns JSON).
REQUEST_SUBKIND=""
if [[ "$KIND" == "request" ]]; then
  if [[ -z "$BODY_RAW" ]]; then
    echo "[write-coordination-artifact] ERROR: --kind request requires a JSON body on stdin with a non-empty \"kind\" field (e.g. scope-extension)." >&2
    exit 2
  fi
  set +e
  REQUEST_SUBKIND="$(WD_BODY="$BODY_RAW" python3 -c '
import json, os, sys
try:
    body = json.loads(os.environ.get("WD_BODY", ""))
except Exception:
    sys.stderr.write("[write-coordination-artifact] ERROR: stdin body is not valid JSON.\n")
    sys.exit(2)
if not isinstance(body, dict) or not isinstance(body.get("kind"), str) or not body["kind"]:
    sys.stderr.write("[write-coordination-artifact] ERROR: request body must have a non-empty string \"kind\" field.\n")
    sys.exit(2)
sys.stdout.write(body["kind"])
')"
  subkind_status=$?
  set -e
  if [[ "$subkind_status" -ne 0 ]]; then
    exit 2
  fi
  if ! _validate_slug "$REQUEST_SUBKIND"; then
    echo "[write-coordination-artifact] ERROR: request body \"kind\" field '$REQUEST_SUBKIND' is not a safe path segment." >&2
    exit 2
  fi
  if [[ "$REQUEST_SUBKIND" == "scope-extension" && "${#NORMALIZED_FILES[@]}" -eq 0 ]]; then
    echo "[write-coordination-artifact] ERROR: request body.kind=scope-extension requires at least one --file." >&2
    exit 2
  fi
fi

# ── Output directory routing (directory only — the filename is generated per-attempt below,
#    since 4 of the 6 kinds embed a collision-avoidance token in it) ──────────────────────────

OUT_DIR=""
MIRROR_DIR=""
case "$KIND" in
  message)
    OUT_DIR="$WAVE_DIR/inbox/$TO"
    MIRROR_DIR="$WAVE_DIR/outbox/$FROM"
    ;;
  consult)
    OUT_DIR="$WAVE_DIR/inbox/context-provider"
    ;;
  result)
    OUT_DIR="$WAVE_DIR/results/$FROM"
    ;;
  request)
    OUT_DIR="$WAVE_DIR/requests/$REQUEST_SUBKIND"
    ;;
  approval)
    OUT_DIR="$WAVE_DIR/approvals"
    ;;
  stop)
    OUT_DIR="$WAVE_DIR"
    ;;
esac

# ── Confine output dir under .planning/ (realpath guard with a python3 fallback — Codex-hardened;
#    the ORIGINAL single-tool-or-skip form silently ran NO check when `realpath` was absent. Now:
#    try realpath first, fall back to python3 (already a hard dependency of this script) if it's
#    missing OR fails to resolve either side, and FAIL CLOSED if neither can resolve — never a
#    silent no-op). Applied uniformly to every kind's target dir. ──

_realpath_resolve() {
  local p="$1" r=""
  if command -v realpath >/dev/null 2>&1; then
    r="$(realpath -m "$p" 2>/dev/null || true)"
  fi
  if [[ -z "$r" ]]; then
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
    echo "[write-coordination-artifact] ERROR: Traversal guard: unable to resolve a canonical path for the confinement check (neither realpath nor the python3 fallback succeeded) — failing closed." >&2
    exit 2
  fi
  if [[ "$canon_target" != "$canon_planning"* ]]; then
    echo "[write-coordination-artifact] ERROR: Traversal guard: output path escapes .planning/ confinement" >&2
    exit 2
  fi
}

_confine_under_planning "$OUT_DIR"
mkdir -p "$OUT_DIR"
if [[ -n "$MIRROR_DIR" ]]; then
  _confine_under_planning "$MIRROR_DIR"
  mkdir -p "$MIRROR_DIR"
fi

# ── stop with no body: bare zero-byte presence flag, no python3/envelope/collision-guard involved
#    (fixed canonical path, intentionally overwriteable — see COLLISION SAFETY in the header). ──

if [[ "$KIND" == "stop" && -z "$BODY_RAW" ]]; then
  OUT_PATH="$OUT_DIR/stop-${TO}.flag"
  : > "$OUT_PATH"
  echo "[write-coordination-artifact] Artifact written: $OUT_PATH (kind=stop presence-only, no body)" >&2
  exit 0
fi

# ── Author JSON via python3 (safe escaping — never string-interpolated), collision-safe ──────
#
# message/consult/result/request open EXCLUSIVELY ('x' mode — never overwrites) and embed a fresh
# <uniq> = hex(PID) + 4 hex digits of $RANDOM in the filename; on a same-path collision python3
# exits 3 (a distinct signal from exit-2 genuine failures) and this loop retries with a freshly
# regenerated <uniq>, bounded so it can never spin forever. approval/stop open in overwrite ('w')
# mode and so never signal a collision — for them this loop always resolves on the first pass.

DISPATCH_FILES_ENV=""
if [[ "${#NORMALIZED_FILES[@]}" -gt 0 ]]; then
  DISPATCH_FILES_ENV="$(printf '%s\n' "${NORMALIZED_FILES[@]}")"
fi

MAX_COLLISION_ATTEMPTS=5
attempt=0
while :; do
  attempt=$((attempt + 1))
  NOW="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  TS_COMPACT="$(date -u '+%Y%m%dT%H%M%SZ')"
  UNIQ="$(printf '%x' "$$")$(printf '%04x' "$RANDOM")"

  case "$KIND" in
    message)  OUT_PATH="$OUT_DIR/${FROM}-${TS_COMPACT}-${UNIQ}.json" ;;
    consult)  OUT_PATH="$OUT_DIR/consult-${TS_COMPACT}-${UNIQ}.json" ;;
    result)   OUT_PATH="$OUT_DIR/${FROM}-${TS_COMPACT}-${UNIQ}.json" ;;
    request)  OUT_PATH="$OUT_DIR/${FROM}-${TS_COMPACT}-${UNIQ}.json" ;;
    approval) OUT_PATH="$OUT_DIR/${RE_ID}.json" ;;
    stop)     OUT_PATH="$OUT_DIR/stop-${TO}.flag" ;;
  esac

  REQUEST_ID_VALUE=""
  if [[ "$KIND" == "request" ]]; then
    REQUEST_ID_VALUE="$(basename "$OUT_PATH" .json)"
  elif [[ "$KIND" == "approval" ]]; then
    REQUEST_ID_VALUE="$RE_ID"
  fi

  set +e
  WD_KIND="$KIND" \
  WD_SCHEMA="coordination/$KIND/v1" \
  WD_WAVE_SLUG="$WAVE_SLUG" \
  WD_FROM="$FROM" \
  WD_TO="$TO" \
  WD_HEAD="$HEAD_SHA" \
  WD_PLAN_SHA256="$PLAN_SHA256" \
  WD_FILES="$DISPATCH_FILES_ENV" \
  WD_REQUEST_ID="$REQUEST_ID_VALUE" \
  WD_BODY="$BODY_RAW" \
  WD_CREATED_AT="$NOW" \
  WD_OUT_PATH="$OUT_PATH" \
  python3 - <<'PYEOF'
import json
import os
import sys

body_raw = os.environ.get("WD_BODY", "")
if body_raw.strip():
    try:
        body = json.loads(body_raw)
    except Exception:
        sys.stderr.write("[write-coordination-artifact] ERROR: stdin body is not valid JSON.\n")
        sys.exit(2)
    if not isinstance(body, dict):
        sys.stderr.write("[write-coordination-artifact] ERROR: stdin body must be a JSON object.\n")
        sys.exit(2)
else:
    body = {}

kind = os.environ["WD_KIND"]

payload = dict(body)
payload["schema"] = os.environ["WD_SCHEMA"]
payload["wave_slug"] = os.environ["WD_WAVE_SLUG"]
payload["from"] = os.environ["WD_FROM"]
payload["to"] = os.environ["WD_TO"]
payload["created_at"] = os.environ["WD_CREATED_AT"]

head = os.environ.get("WD_HEAD", "")
plan_sha256 = os.environ.get("WD_PLAN_SHA256", "")
if head:
    payload["head"] = head
if plan_sha256:
    payload["plan_sha256"] = plan_sha256

files_raw = os.environ.get("WD_FILES", "")
if files_raw:
    payload["files"] = [f for f in files_raw.split("\n") if f != ""]

request_id = os.environ.get("WD_REQUEST_ID", "")
if request_id:
    payload["request_id"] = request_id

if kind == "result":
    if payload.get("status") not in ("ready-for-review", "done", "blocked"):
        sys.stderr.write("[write-coordination-artifact] ERROR: --kind result requires body.status in {ready-for-review,done,blocked}.\n")
        sys.exit(2)
elif kind == "approval":
    if payload.get("decision") not in ("authorized", "denied"):
        sys.stderr.write("[write-coordination-artifact] ERROR: --kind approval requires body.decision in {authorized,denied}.\n")
        sys.exit(2)
    if not payload.get("request_kind"):
        sys.stderr.write("[write-coordination-artifact] ERROR: --kind approval requires body.request_kind.\n")
        sys.exit(2)
    if not payload.get("approver"):
        payload["approver"] = payload["from"]

# Collision-safe kinds open EXCLUSIVELY ('x' — raises FileExistsError if the path already
# exists); approval/stop open in overwrite ('w') mode (fixed canonical path, idempotent by design).
EXCLUSIVE_KINDS = ("message", "consult", "result", "request")
mode = "x" if kind in EXCLUSIVE_KINDS else "w"

try:
    fh = open(os.environ["WD_OUT_PATH"], mode, encoding="utf-8")
except FileExistsError:
    sys.stderr.write("[write-coordination-artifact] COLLISION: output path already exists; caller should retry with a new filename.\n")
    sys.exit(3)

with fh:
    json.dump(payload, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
PYEOF
  py_status=$?
  set -e

  if [[ "$py_status" -eq 0 ]]; then
    break
  elif [[ "$py_status" -eq 3 ]]; then
    if [[ "$attempt" -ge "$MAX_COLLISION_ATTEMPTS" ]]; then
      echo "[write-coordination-artifact] ERROR: could not allocate a unique output filename after $MAX_COLLISION_ATTEMPTS attempts (persistent collision at $OUT_PATH)." >&2
      exit 2
    fi
    continue
  else
    exit 2
  fi
done

if [[ "$KIND" == "message" ]]; then
  cp "$OUT_PATH" "$MIRROR_DIR/$(basename "$OUT_PATH")"
fi

echo "[write-coordination-artifact] Artifact written: $OUT_PATH (kind=$KIND from=$FROM to=$TO)" >&2
