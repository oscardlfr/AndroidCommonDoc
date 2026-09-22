#!/usr/bin/env bash
# write-verdict.sh — Thin wrapper writing a verdict/v1 JSON record bound to an
# immutable verdict-request/v1 (PLAN.md sec 3.1-3.3, 3.6, 3.8). Retains the
# familiar --role/--phase/--slug/stdin surface; stdin now carries the rationale
# text (not free Markdown). head/plan_sha256 are COPIED from the bound --request,
# never independently re-resolved -- this script no longer calls `git rev-parse
# HEAD` or hashes PLAN.md itself (see write-verdict-request.sh for where those
# get freshly resolved).
#
# USAGE
#   write-verdict.sh --role <role> --phase <prep|verify-final> [--slug <slug>]
#     --request <path> --request-sha256 <64hex>
#     --decision <approve|escalate> [--reason-code <code>]
#     [--evidence-file <path> [--evidence-schema <name>]]...
#     [--supersede --expected-current-sha256 <64hex>]
#   Rationale is read from stdin.
#
# EVIDENCE
#   Repeatable --evidence-file, each optionally followed by its own
#   --evidence-schema. This script computes each file's real sha256 itself --
#   never trusts a caller-supplied digest. --evidence-schema present ->
#   kind=json-record (+ expected_schema); absent -> kind=opaque-file.
#
# Delegates ALL schema-validation + durable writing to
# verdict-evidence-contract-cli.cjs's publish-record subcommand (backed by
# verdict-artifact-store.cjs's publishNoClobber/publishSupersede) -- this script
# gathers flags, cross-checks the bound request, and assembles JSON via python3
# json.dump (env vars in, never a value string-interpolated into a JSON template).
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
#   2  integrity violation (traversal, protected slug, request digest mismatch,
#      request role/phase/wave_slug disagreement, escalate without reason-code,
#      missing prep before verify-final, confinement failure, rejected write)
#
# Fail-CLOSED on integrity; this writer has no bypass.

set -euo pipefail

VALID_ROLES=("arch-platform" "arch-testing" "arch-integration")
VALID_PHASES=("prep" "verify-final")

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WAVE_SLUG_LIB="$SCRIPT_DIR/lib/wave-slug.sh"
if [[ ! -f "$WAVE_SLUG_LIB" ]]; then
  echo "[write-verdict] ERROR: wave slug helper not found: $WAVE_SLUG_LIB" >&2
  exit 2
fi
# shellcheck source=scripts/sh/lib/wave-slug.sh
source "$WAVE_SLUG_LIB"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[write-verdict] ERROR: python3 is required to author the verdict JSON but was not found on PATH." >&2
  exit 2
fi
if ! command -v node >/dev/null 2>&1; then
  echo "[write-verdict] ERROR: node is required (request field parsing + CLI delegation) but was not found on PATH." >&2
  exit 2
fi

CLI="$SCRIPT_DIR/../lib/verdict-evidence-contract-cli.cjs"

# ── Argument parsing ─────────────────────────────────────────────────────────

ROLE=""
PHASE=""
SLUG_OVERRIDE=""
REQUEST_PATH=""
REQUEST_SHA256=""
DECISION=""
REASON_CODE=""
REASON_CODE_SET=0
SUPERSEDE=0
EXPECTED_CURRENT_SHA256=""
EVIDENCE_FILES=()
EVIDENCE_SCHEMAS=()
PUBLICATION_NONCE=""
PUBLICATION_NONCE_SET=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --role) ROLE="${2:-}"; shift 2 ;;
    --phase) PHASE="${2:-}"; shift 2 ;;
    --slug) SLUG_OVERRIDE="${2:-}"; shift 2 ;;
    --request) REQUEST_PATH="${2:-}"; shift 2 ;;
    --request-sha256) REQUEST_SHA256="${2:-}"; shift 2 ;;
    --decision) DECISION="${2:-}"; shift 2 ;;
    --reason-code) REASON_CODE="${2:-}"; REASON_CODE_SET=1; shift 2 ;;
    --evidence-file)
      EVIDENCE_FILES+=("${2:-}")
      EVIDENCE_SCHEMAS+=("")
      shift 2
      ;;
    --evidence-schema)
      if [[ "${#EVIDENCE_SCHEMAS[@]}" -eq 0 ]]; then
        echo "[write-verdict] ERROR: --evidence-schema must follow an --evidence-file" >&2
        exit 1
      fi
      EVIDENCE_SCHEMAS[${#EVIDENCE_SCHEMAS[@]}-1]="${2:-}"
      shift 2
      ;;
    --supersede) SUPERSEDE=1; shift ;;
    --expected-current-sha256) EXPECTED_CURRENT_SHA256="${2:-}"; shift 2 ;;
    --publication-nonce)
      if [[ $# -lt 2 || -z "${2:-}" ]]; then
        echo "[write-verdict] ERROR: --publication-nonce requires a non-empty value" >&2
        exit 2
      fi
      PUBLICATION_NONCE="$2"
      PUBLICATION_NONCE_SET=1
      shift 2
      ;;
    -h|--help) sed -n '2,/^$/p' "$0"; exit 0 ;;
    *) echo "[write-verdict] ERROR: Unknown argument: $1" >&2; exit 1 ;;
  esac
done

# ── Validate role/phase ────────────────────────────────────────────────────────

if [[ -z "$ROLE" ]]; then
  echo "[write-verdict] ERROR: --role is required (arch-platform|arch-testing|arch-integration)" >&2
  exit 1
fi
role_valid=0
for r in "${VALID_ROLES[@]}"; do [[ "$ROLE" == "$r" ]] && role_valid=1 && break; done
if [[ "$role_valid" -ne 1 ]]; then
  echo "[write-verdict] ERROR: Invalid role '$ROLE'. Must be one of: ${VALID_ROLES[*]}" >&2
  exit 2
fi

if [[ -z "$PHASE" ]]; then
  echo "[write-verdict] ERROR: --phase is required (prep|verify-final)" >&2
  exit 1
fi
phase_valid=0
for p in "${VALID_PHASES[@]}"; do [[ "$PHASE" == "$p" ]] && phase_valid=1 && break; done
if [[ "$phase_valid" -ne 1 ]]; then
  echo "[write-verdict] ERROR: Invalid phase '$PHASE'. Must be one of: ${VALID_PHASES[*]}" >&2
  exit 2
fi

# ── Publication-nonce legacy compat mode (narrow, explicit exception for the ──
# out-of-manifest runtime-bridge-codex caller; PLAN.md sec 8 scope note pending
# a separate amendment, tracked outside this dispatch). Retirement owner:
# whoever migrates runtime-bridge-codex's p2-prep-verdict.cjs off this
# dependency -- until then this reproduces the pre-Wave-3 legacy PREP markdown
# artifact byte-for-byte, entirely parallel to and never integrated into the
# verdict/v1 JSON contract.
if [[ "$PUBLICATION_NONCE_SET" -eq 1 ]]; then
  if [[ -n "$REQUEST_PATH" || -n "$REQUEST_SHA256" || -n "$DECISION" || "$REASON_CODE_SET" -eq 1 \
        || "${#EVIDENCE_FILES[@]}" -gt 0 || "$SUPERSEDE" -eq 1 || -n "$EXPECTED_CURRENT_SHA256" ]]; then
    echo "[write-verdict] ERROR: --publication-nonce (legacy compat mode) cannot be combined with --request/--request-sha256/--decision/--reason-code/--evidence-file/--supersede/--expected-current-sha256" >&2
    exit 2
  fi
  if [[ "$PHASE" != "prep" ]]; then
    echo "[write-verdict] ERROR: --publication-nonce is only valid with --phase prep" >&2
    exit 2
  fi
  if [[ ! "$PUBLICATION_NONCE" =~ ^[0-9a-f]{32}$ ]]; then
    echo "[write-verdict] ERROR: Invalid --publication-nonce '$PUBLICATION_NONCE'. Must match ^[0-9a-f]{32}\$" >&2
    exit 2
  fi
  NONCE_STDIN_PEEK=""
  if [[ ! -t 0 ]]; then
    NONCE_STDIN_PEEK="$(cat)"
  fi
  if [[ -n "$NONCE_STDIN_PEEK" ]]; then
    echo "[write-verdict] ERROR: --publication-nonce (legacy compat mode) does not accept stdin content" >&2
    exit 2
  fi
fi

# ── Validate request/decision flags (skipped entirely in --publication-nonce ──
# legacy compat mode above, which never uses these) ────────────────────────────

if [[ "$PUBLICATION_NONCE_SET" -ne 1 ]]; then
if [[ -z "$REQUEST_PATH" ]]; then
  echo "[write-verdict] ERROR: --request is required" >&2
  exit 1
fi
if [[ -z "$REQUEST_SHA256" ]]; then
  echo "[write-verdict] ERROR: --request-sha256 is required" >&2
  exit 1
fi
if [[ -z "$DECISION" ]]; then
  echo "[write-verdict] ERROR: --decision is required (approve|escalate)" >&2
  exit 1
fi
if [[ "$DECISION" != "approve" && "$DECISION" != "escalate" ]]; then
  echo "[write-verdict] ERROR: Invalid --decision '$DECISION'. Must be approve or escalate." >&2
  exit 2
fi
if [[ "$DECISION" == "escalate" && "$REASON_CODE_SET" -ne 1 ]]; then
  echo "[write-verdict] ERROR: --decision escalate requires --reason-code" >&2
  exit 2
fi
if [[ "$SUPERSEDE" -eq 1 && -z "$EXPECTED_CURRENT_SHA256" ]]; then
  echo "[write-verdict] ERROR: --supersede requires --expected-current-sha256" >&2
  exit 1
fi
fi

# ── Repo root + slug resolution ───────────────────────────────────────────────

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

resolve_slug() {
  if [[ -n "$SLUG_OVERRIDE" ]]; then
    if ! _validate_slug "$SLUG_OVERRIDE"; then
      if [[ "$SLUG_OVERRIDE" == *".."* || "$SLUG_OVERRIDE" == *"/"* || "$SLUG_OVERRIDE" == *"\\"* ]]; then
        echo "[write-verdict] ERROR: Traversal attempt detected in slug '$SLUG_OVERRIDE'" >&2
      else
        echo "[write-verdict] ERROR: Invalid slug '$SLUG_OVERRIDE'." >&2
      fi
      exit 2
    fi
    echo "$SLUG_OVERRIDE"
    return
  fi

  local slug=""
  slug="$(get_wave_slug "$REPO_ROOT" || true)"
  if [[ -z "$slug" ]]; then
    echo "[write-verdict] ERROR: Cannot resolve wave slug. Provide --slug or use CLAUDE_WAVE_SLUG, a non-protected branch, or a single .planning/wave-*/PLAN.md alias." >&2
    exit 2
  fi
  echo "$slug"
}

WAVE_SLUG="$(resolve_slug)"
if [[ -z "$WAVE_SLUG" ]]; then
  echo "[write-verdict] ERROR: Resolved slug is empty." >&2
  exit 2
fi

if [[ "$WAVE_SLUG" == *".."* || "$WAVE_SLUG" == *"/"* || "$WAVE_SLUG" == *"\\"* ]]; then
  echo "[write-verdict] ERROR: Traversal attempt detected in slug '$WAVE_SLUG'" >&2
  exit 2
fi

if [[ "$WAVE_SLUG" =~ ^(develop|master|main|HEAD)$ ]]; then
  echo "[write-verdict] ERROR: Slug '$WAVE_SLUG' is a protected branch name and cannot be used as a wave slug." >&2
  exit 2
fi

# ── Path layout ────────────────────────────────────────────────────────────────

PLANNING_DIR="$REPO_ROOT/.planning"
WAVE_DIR="$PLANNING_DIR/wave-$WAVE_SLUG"
VERDICT_FILE="$WAVE_DIR/arch-${ROLE#arch-}-verdict-${PHASE}.json"
PREP_VERDICT_FILE="$WAVE_DIR/arch-${ROLE#arch-}-verdict-prep.json"

# ── Publication-nonce legacy compat mode: short-circuits here, before any of ──
# the new request/store machinery, at the legacy .md path -- definitionally
# disjoint from VERDICT_FILE/PREP_VERDICT_FILE above (different extension,
# different pattern, no collision). Self-contained (own sha256/HEAD
# resolution) so it has no ordering dependency on _sha256_file, defined later
# in this file for the new-path-only flow below.
if [[ "$PUBLICATION_NONCE_SET" -eq 1 ]]; then
  LEGACY_VERDICT_FILE="$WAVE_DIR/arch-${ROLE#arch-}-verdict.md"

  if [[ -f "$LEGACY_VERDICT_FILE" ]]; then
    echo "[write-verdict] ERROR: Verdict file already exists (duplicate prep guard): $LEGACY_VERDICT_FILE" >&2
    exit 2
  fi

  LEGACY_HEAD_SHA="$(git rev-parse HEAD 2>/dev/null || true)"
  if [[ ! "$LEGACY_HEAD_SHA" =~ ^[0-9a-f]{40}$ ]]; then
    echo "[write-verdict] ERROR: git rev-parse HEAD failed or returned non-hex '$LEGACY_HEAD_SHA'. Aborting prep — resolve HEAD before writing the verdict." >&2
    exit 2
  fi

  LEGACY_PLAN_PATH="$WAVE_DIR/PLAN.md"
  if [[ ! -f "$LEGACY_PLAN_PATH" ]]; then
    echo "[write-verdict] ERROR: Plan file not found: $LEGACY_PLAN_PATH. PREP fails closed when the plan cannot be resolved." >&2
    exit 2
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    LEGACY_PLAN_SHA256="$(sha256sum "$LEGACY_PLAN_PATH" | awk '{print $1}')"
  else
    LEGACY_PLAN_SHA256="$(shasum -a 256 "$LEGACY_PLAN_PATH" | awk '{print $1}')"
  fi
  if [[ -z "$LEGACY_PLAN_SHA256" ]]; then
    echo "[write-verdict] ERROR: Failed to compute sha256 of $LEGACY_PLAN_PATH (sha256sum/shasum unavailable or read error)." >&2
    exit 2
  fi

  mkdir -p "$WAVE_DIR"
  umask 077

  {
    cat <<EOF
# $ROLE verdict — wave-$WAVE_SLUG

**Phase**: PREP
**Timestamp**: $(date -u '+%Y-%m-%dT%H:%M:%SZ')
**Status**: APPROVED-PREP
**PREP-HEAD**: $LEGACY_HEAD_SHA
**PLAN_SHA256**: $LEGACY_PLAN_SHA256
EOF
    printf '**PUBLICATION-NONCE**: %s\n' "$PUBLICATION_NONCE"
    printf '\n'
  } > "$LEGACY_VERDICT_FILE"

  echo "[write-verdict] PREP written: $LEGACY_VERDICT_FILE" >&2
  exit 0
fi

# ── Confinement (delegates to verdict-artifact-store.cjs's assertConfinedAncestry -- ──
# the ONLY mechanism in this codebase with PROVEN Windows-junction defeat (P1,
# verdict-artifact-store.test.cjs) AND confirmed MSYS-vs-drive-letter namespace
# convergence (path.resolve bridges both forms on this machine, empirically verified
# 2026-09-21) -- replaces the prior bash-only realpath/python3 string-prefix compare,
# which never bridged MSYS-style (/tmp/...) vs git-derived drive-letter-style
# (C:/Users/...) paths for the same physical location, false-rejecting every legitimate
# externally-supplied --request path on native Windows (task #18).

STORE_LIB="$SCRIPT_DIR/../lib/verdict-artifact-store.cjs"

_confine_under_wave() {
  local target="$1"
  local include_leaf="${2:-false}"
  if ! node -e '
    const store = require(process.argv[1]);
    try {
      store.assertConfinedAncestry(process.argv[2], process.argv[3], process.argv[4] === "true");
      process.exit(0);
    } catch (err) {
      process.exit(2);
    }
  ' "$STORE_LIB" "$WAVE_DIR" "$target" "$include_leaf" 2>/dev/null; then
    echo "[write-verdict] ERROR: Traversal guard: path escapes active wave confinement (or an ancestor is a symlink/reparse point): $target" >&2
    exit 2
  fi
}

# WV-16: a --request path escaping .planning/ is rejected before it is ever read.
# REQUEST_PATH must already exist (about to be read directly, bypassing the store)
# -> include_leaf=true. VERDICT_FILE is the first-publish write target and may not
# exist yet, plus gets properly re-confined by the store downstream regardless
# -> include_leaf=false.
_confine_under_wave "$REQUEST_PATH" true
_confine_under_wave "$VERDICT_FILE" false

_relative_to_wave() {
  node -e '
    const path = require("path");
    const root = path.resolve(process.argv[1]);
    const target = path.resolve(process.argv[2]);
    process.stdout.write(path.relative(root, target).split(path.sep).join("/"));
  ' "$WAVE_DIR" "$1"
}
REQUEST_REF_PATH="$(_relative_to_wave "$REQUEST_PATH")"

_sha256_file() {
  local f="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$f" | awk '{print $1}'
  else
    shasum -a 256 "$f" | awk '{print $1}'
  fi
}

# ── Bind + cross-check the request (WV-18/WV-19) ──────────────────────────────

if [[ ! -f "$REQUEST_PATH" ]]; then
  echo "[write-verdict] ERROR: --request file not found: $REQUEST_PATH" >&2
  exit 2
fi
ACTUAL_REQUEST_SHA256="$(_sha256_file "$REQUEST_PATH" 2>/dev/null || true)"
if [[ -z "$ACTUAL_REQUEST_SHA256" || "$ACTUAL_REQUEST_SHA256" != "$REQUEST_SHA256" ]]; then
  echo "[write-verdict] ERROR: --request-sha256 does not match the actual digest of $REQUEST_PATH" >&2
  exit 2
fi

REQUEST_ROLE=""
REQUEST_PHASE=""
REQUEST_WAVE_SLUG=""
REQUEST_HEAD=""
REQUEST_PLAN_SHA256=""
REQUEST_ID=""
read -r REQUEST_ROLE REQUEST_PHASE REQUEST_WAVE_SLUG REQUEST_HEAD REQUEST_PLAN_SHA256 REQUEST_ID <<< "$(node -e "
try {
  const r = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
  console.log([r.role, r.phase, r.wave_slug, r.head, r.plan_sha256, r.request_id].join(' '));
} catch (e) { console.log(''); }
" "$REQUEST_PATH")"

if [[ "$REQUEST_ROLE" != "$ROLE" || "$REQUEST_PHASE" != "$PHASE" || "$REQUEST_WAVE_SLUG" != "$WAVE_SLUG" ]]; then
  echo "[write-verdict] ERROR: bound --request role/phase/wave_slug does not match this invocation's --role/--phase/resolved-slug" >&2
  exit 2
fi

# head/plan_sha256 are COPIED from the request, never independently re-resolved (WV-13/14).
VERDICT_HEAD="$REQUEST_HEAD"
VERDICT_PLAN_SHA256="$REQUEST_PLAN_SHA256"

# ── verify-final workflow-sanity guard (WV-21, not a security boundary) ──────

if [[ "$PHASE" == "verify-final" && ! -f "$PREP_VERDICT_FILE" ]]; then
  echo "[write-verdict] ERROR: No published PREP verdict found for role=$ROLE wave=$WAVE_SLUG: $PREP_VERDICT_FILE" >&2
  exit 2
fi

# ── Rationale from stdin ──────────────────────────────────────────────────────

RATIONALE=""
if [[ ! -t 0 ]]; then
  RATIONALE="$(cat)"
fi

# ── Evidence (WV: this script computes each file's real sha256 itself) ───────

EV_PATHS_ENV=""
EV_SHA_ENV=""
EV_SCHEMA_ENV=""
if [[ "${#EVIDENCE_FILES[@]}" -gt 0 ]]; then
  EV_SHAS=()
  for ef in "${EVIDENCE_FILES[@]}"; do
    _confine_under_wave "$ef" true
    if [[ ! -f "$ef" ]]; then
      echo "[write-verdict] ERROR: --evidence-file not found: $ef" >&2
      exit 2
    fi
    EV_SHAS+=("$(_sha256_file "$ef")")
  done
  EV_REL_PATHS=()
  for ef in "${EVIDENCE_FILES[@]}"; do EV_REL_PATHS+=("$(_relative_to_wave "$ef")"); done
  EV_PATHS_ENV="$(printf '%s\n' "${EV_REL_PATHS[@]}")"
  EV_SHA_ENV="$(printf '%s\n' "${EV_SHAS[@]}")"
  EV_SCHEMA_ENV="$(printf '%s\n' "${EVIDENCE_SCHEMAS[@]}")"
fi

NOW="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# ── Assemble + publish the verdict (safe JSON: env vars -> python3 json.dump, ──
# never a value string-interpolated into a JSON template) ─────────────────────

PUBLISH_ARGS=(publish-record --kind verdict --path "$VERDICT_FILE")
if [[ "$SUPERSEDE" -eq 1 ]]; then
  PUBLISH_ARGS+=(--supersede --expected-current-sha256 "$EXPECTED_CURRENT_SHA256")
fi

WV_ROLE="$ROLE" \
WV_WAVE_SLUG="$WAVE_SLUG" \
WV_PHASE="$PHASE" \
WV_DECISION="$DECISION" \
WV_RATIONALE="$RATIONALE" \
WV_HEAD="$VERDICT_HEAD" \
WV_PLAN_SHA256="$VERDICT_PLAN_SHA256" \
WV_IN_REPLY_TO="$REQUEST_ID" \
WV_REQUEST_REF_PATH="$REQUEST_REF_PATH" \
WV_REQUEST_REF_SHA256="$REQUEST_SHA256" \
WV_CREATED_AT="$NOW" \
WV_SUPERSEDE="$SUPERSEDE" \
WV_EXPECTED_CURRENT_SHA256="$EXPECTED_CURRENT_SHA256" \
WV_REASON_CODE="$REASON_CODE" \
WV_EV_PATHS="$EV_PATHS_ENV" \
WV_EV_SHA="$EV_SHA_ENV" \
WV_EV_SCHEMA="$EV_SCHEMA_ENV" \
python3 -c '
import json, os, sys

decision = os.environ["WV_DECISION"]

def split_lines(raw):
    return raw.split("\n") if raw != "" else []

paths = split_lines(os.environ.get("WV_EV_PATHS", ""))
shas = split_lines(os.environ.get("WV_EV_SHA", ""))
schemas = split_lines(os.environ.get("WV_EV_SCHEMA", ""))

evidence = []
for i in range(len(paths)):
    schema = schemas[i] if i < len(schemas) else ""
    entry = {"kind": "json-record" if schema != "" else "opaque-file", "path": paths[i], "sha256": shas[i]}
    if schema != "":
        entry["expected_schema"] = schema
    evidence.append(entry)

supersede = os.environ.get("WV_SUPERSEDE", "0") == "1"

payload = {
    "schema": "verdict/v1",
    "role": os.environ["WV_ROLE"],
    "wave_slug": os.environ["WV_WAVE_SLUG"],
    "phase": os.environ["WV_PHASE"],
    "decision": decision,
    "rationale": os.environ["WV_RATIONALE"],
    "evidence": evidence,
    "head": os.environ["WV_HEAD"],
    "plan_sha256": os.environ["WV_PLAN_SHA256"],
    "in_reply_to": os.environ["WV_IN_REPLY_TO"],
    "request_ref": {"path": os.environ["WV_REQUEST_REF_PATH"], "sha256": os.environ["WV_REQUEST_REF_SHA256"]},
    "created_at": os.environ["WV_CREATED_AT"],
    "supersedes": {"sha256": os.environ["WV_EXPECTED_CURRENT_SHA256"]} if supersede else None,
}
if decision == "escalate":
    payload["reason_code"] = os.environ["WV_REASON_CODE"]

json.dump(payload, sys.stdout, separators=(",", ":"))
sys.stdout.write("\n")
' | node "$CLI" "${PUBLISH_ARGS[@]}"

echo "[write-verdict] $PHASE written: $VERDICT_FILE" >&2
