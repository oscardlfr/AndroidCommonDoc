#!/usr/bin/env bash
# write-verdict.sh — Canonical two-phase verdict writer for arch-* agents.
#
# USAGE
#   write-verdict.sh --role <arch-role> --phase <prep|verify-final> [--slug <wave-slug>]
#                    [--supersede] [--publication-nonce <32-lower-hex>]
#
# PHASES
#   prep          Creates the verdict file with an APPROVED-PREP header.
#                 Fails (exit 2) if the file already exists (duplicate guard).
#   verify-final  Reads architect verdict from stdin, then appends it plus an
#                 APPROVED-VERIFY-FINAL closing block to the existing prep file.
#                 The block is wrapped in delimiter comments:
#                   <!-- BEGIN VERIFY-FINAL -->
#                   ...
#                   <!-- END VERIFY-FINAL -->
#                 Fails (exit 2) if no prep file is found (prevents orphan finals).
#                 Fails (exit 2) if the file contains a dual-token (both APPROVED-PREP
#                 AND APPROVED-VERIFY-FINAL already present — replay guard).
#                 With --supersede: replaces an existing VERIFY-FINAL block instead of
#                 failing (opt-in; the replay guard is UNCHANGED on the non-flag path).
#
# --supersede (verify-final only, OPT-IN)
#   Allows re-running --phase verify-final when commits have landed since the last
#   VERIFY-FINAL write (e.g. after a fixup commit).
#   - Current HEAD must resolve to 40-hex or ABORT (fail-closed).
#   - Delimited block present, stored HEAD == current HEAD → idempotent NO-OP (exit 0).
#   - Delimited block present, stored HEAD != current HEAD → excise entire delimited
#     block (<!-- BEGIN VERIFY-FINAL --> … <!-- END VERIFY-FINAL -->), append fresh block.
#   - Legacy un-delimited block present (APPROVED-VERIFY-FINAL exists, no BEGIN delimiter)
#     → excise from first **HEAD**: line through EOF, append fresh delimited block.
#   - No VERIFY-FINAL block present → normal first-append (with delimiters).
#   APPROVED-PREP is NEVER removed or altered. NO token forgery, NO bypass.
#   After supersede: file has EXACTLY ONE **HEAD**: line (current HEAD) and still
#   contains APPROVED-VERIFY-FINAL.
#
# SLUG RESOLUTION (priority order via scripts/sh/lib/wave-slug.sh)
#   1. --slug <value>   explicit override
#   2. $CLAUDE_WAVE_SLUG env var
#   3. git branch name  last segment after '/'
#   4. single .planning/wave-*/PLAN.md alias
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WAVE_SLUG_LIB="$SCRIPT_DIR/lib/wave-slug.sh"
if [[ ! -f "$WAVE_SLUG_LIB" ]]; then
  echo "[write-verdict] ERROR: wave slug helper not found: $WAVE_SLUG_LIB" >&2
  exit 2
fi
# shellcheck source=scripts/sh/lib/wave-slug.sh
source "$WAVE_SLUG_LIB"

# ── Argument parsing ─────────────────────────────────────────────────────────

ROLE=""
PHASE=""
SLUG_OVERRIDE=""
SUPERSEDE=0
PUBLICATION_NONCE=""
PUBLICATION_NONCE_SET=0

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
    --supersede)
      SUPERSEDE=1
      shift
      ;;
    --publication-nonce)
      if [[ $# -lt 2 || -z "${2:-}" ]]; then
        echo "[write-verdict] ERROR: --publication-nonce requires a non-empty value" >&2
        exit 2
      fi
      PUBLICATION_NONCE="$2"
      PUBLICATION_NONCE_SET=1
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

# ── Validate publication nonce (P2 GREEN-B) ───────────────────────────────────

if [[ "$PUBLICATION_NONCE_SET" -eq 1 ]]; then
  if [[ "$PHASE" != "prep" ]]; then
    echo "[write-verdict] ERROR: --publication-nonce is only valid with --phase prep" >&2
    exit 2
  fi
  if [[ ! "$PUBLICATION_NONCE" =~ ^[0-9a-f]{32}$ ]]; then
    echo "[write-verdict] ERROR: Invalid --publication-nonce '$PUBLICATION_NONCE'. Must match ^[0-9a-f]{32}\$" >&2
    exit 2
  fi
fi

# ── Repo root + slug resolution ───────────────────────────────────────────────

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Priority: --slug > shared resolver ($CLAUDE_WAVE_SLUG > git branch > alias scan).
# Explicit --slug remains first so architect commands can pin a wave in ambiguous
# sessions while still using the shared validation contract.

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

PLANNING_DIR="$REPO_ROOT/.planning"
WAVE_DIR="$PLANNING_DIR/wave-$WAVE_SLUG"
VERDICT_FILE="$WAVE_DIR/arch-${ROLE#arch-}-verdict.md"

# ── Confine verdict path under .planning/ (realpath guard with a pure-shell fallback — ports
#    write-coordination-artifact.sh's Codex-hardened _realpath_resolve()/_confine_under_planning(),
#    the same helper pair now also ported into write-specialist-dispatch.sh's sibling Check-2 block
#    (identical bug, identical fix, applied independently in each file's own confinement block).
#    The original single-tool-or-skip form silently ran NO check when `realpath` was absent
#    (BSD/macOS realpath also lacks -m and no-ops). Resolution order: (1) `realpath -m` (GNU), (2) a
#    pure-shell physical-pwd fallback (peel to the deepest EXISTING ancestor, `cd` + `pwd -P` to
#    resolve symlinks physically, re-append the non-existent tail — no external tool needed, works
#    on macOS/BSD), (3) python3 `os.path.realpath` as a final, now-optional fallback. FAIL CLOSED
#    if none resolve — never a silent no-op.
#    NOTE (dependency, corrected): on macOS/BSD, step (1) `realpath -m` always fails (no -m flag),
#    so step (2) — pure bash, no external tool — is what actually resolves paths here in practice;
#    step (3) is a genuine last-resort that normal operation never reaches. CodeRabbit flagged the
#    prior two-step form (realpath -> python3 only) as making python3 a DE FACTO hard dependency on
#    macOS, since realpath -m never succeeds there and this script previously had zero python3
#    usage. That's fixed now: python3 is truly optional. ──

# _shell_physical_resolve <path> — pure-bash (no realpath/python3) canonicalization. Finds the
# deepest EXISTING ancestor of <path>, resolves IT physically via `cd` + `pwd -P` (follows
# symlinks), then re-appends the non-existent tail components peeled off along the way. Mirrors
# `realpath -m`'s semantics (a path that may not fully exist yet still resolves) without requiring
# GNU realpath or python3. Prints the resolved path and returns 0 on success; returns 1 (prints
# nothing) if even the nearest existing ancestor can't be entered (e.g. permission denied).
_shell_physical_resolve() {
  local p="$1"
  case "$p" in
    /*) : ;;
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
    echo "[write-verdict] ERROR: Traversal guard: unable to resolve a canonical path for the confinement check (neither realpath nor the python3 fallback succeeded) — failing closed." >&2
    exit 2
  fi
  # Exact-or-strictly-under check: the old bare "$canon_planning"* glob has no trailing
  # separator, so a resolved SIBLING like ".planning-evil" satisfies ".planning*" and would
  # wrongly pass. Require canon_target to equal canon_planning exactly OR sit under
  # "canon_planning/".
  if [[ "$canon_target" != "$canon_planning" && "$canon_target" != "$canon_planning"/* ]]; then
    echo "[write-verdict] ERROR: Traversal guard: verdict path escapes .planning/ confinement" >&2
    exit 2
  fi
}

_confine_under_planning "$VERDICT_FILE"

# ── Timestamp ─────────────────────────────────────────────────────────────────

NOW="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# ── Portable sha256 helper (WS-2 — mirrors write-specialist-dispatch.sh) ──────
# Matches the Node crypto Buffer-based hash used by premature-execution-gate.js (F2):
# raw file bytes, no encoding/newline normalization.

_sha256_file() {
  local f="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$f" | awk '{print $1}'
  else
    shasum -a 256 "$f" | awk '{print $1}'
  fi
}

# ── Phase: prep ───────────────────────────────────────────────────────────────

run_prep() {
  if [[ -f "$VERDICT_FILE" ]]; then
    echo "[write-verdict] ERROR: Verdict file already exists (duplicate prep guard): $VERDICT_FILE" >&2
    exit 2
  fi

  # PREP-HEAD binding (WS-2): resolve HEAD fail-closed before writing any content.
  local head_sha=""
  head_sha="$(git rev-parse HEAD 2>/dev/null || true)"
  if [[ ! "$head_sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "[write-verdict] ERROR: git rev-parse HEAD failed or returned non-hex '$head_sha'. Aborting prep — resolve HEAD before writing the verdict." >&2
    exit 2
  fi

  # PLAN_SHA256 binding (WS-2): PREP fails closed when the plan cannot be resolved.
  local plan_path="$WAVE_DIR/PLAN.md"
  if [[ ! -f "$plan_path" ]]; then
    echo "[write-verdict] ERROR: Plan file not found: $plan_path. PREP fails closed when the plan cannot be resolved." >&2
    exit 2
  fi
  local plan_sha256=""
  plan_sha256="$(_sha256_file "$plan_path" 2>/dev/null || true)"
  if [[ -z "$plan_sha256" ]]; then
    echo "[write-verdict] ERROR: Failed to compute sha256 of $plan_path (sha256sum/shasum unavailable or read error)." >&2
    exit 2
  fi

  mkdir -p "$WAVE_DIR"

  # PREP verdicts are later consumed through the fd-bound durable classifier,
  # whose canonical owner-confined mode is exactly 0600.
  umask 077

  {
    cat <<EOF
# $ROLE verdict — wave-$WAVE_SLUG

**Phase**: PREP
**Timestamp**: $NOW
**Status**: APPROVED-PREP
**PREP-HEAD**: $head_sha
**PLAN_SHA256**: $plan_sha256
EOF
    if [[ "$PUBLICATION_NONCE_SET" -eq 1 ]]; then
      printf '**PUBLICATION-NONCE**: %s\n' "$PUBLICATION_NONCE"
    fi
    printf '\n'
  } > "$VERDICT_FILE"

  echo "[write-verdict] PREP written: $VERDICT_FILE" >&2
}

# ── Delimiter constants ────────────────────────────────────────────────────────
# These exact strings are used by --supersede to identify and excise old blocks.
# test-specialist's VS-* bats cases must match these verbatim.

DELIM_BEGIN="<!-- BEGIN VERIFY-FINAL -->"
DELIM_END="<!-- END VERIFY-FINAL -->"

# ── Phase: verify-final ───────────────────────────────────────────────────────

# _sanitize_stdin — strip reserved delimiter / token lines from piped body content.
# Emits WARN to stderr for each stripped line. Returns sanitized content via stdout.
# B1 fix: prevents injected stdin body from poisoning stored_head extraction or
# confusing the idempotent check via a fake **HEAD**: line.
_sanitize_stdin() {
  local raw="$1"
  local sanitized=""
  local warned=0
  while IFS= read -r line; do
    if [[ "$line" == "$DELIM_BEGIN"* || "$line" == "$DELIM_END"* ]]; then
      echo "[write-verdict] WARN: stdin body contained reserved delimiter line (stripped): $line" >&2
      warned=1
    elif [[ "$line" == "**HEAD**:"* ]]; then
      echo "[write-verdict] WARN: stdin body contained reserved **HEAD**: line (stripped): $line" >&2
      warned=1
    elif [[ "$line" == "**Status**: APPROVED-VERIFY-FINAL"* ]]; then
      echo "[write-verdict] WARN: stdin body contained reserved APPROVED-VERIFY-FINAL line (stripped): $line" >&2
      warned=1
    else
      sanitized="${sanitized}${sanitized:+$'\n'}${line}"
    fi
  done <<< "$raw"
  printf '%s' "$sanitized"
}

# _render_delimited_block — build a fresh delimited VERIFY-FINAL block and print
# it to stdout, WITHOUT writing anywhere. The sole rendering primitive shared by
# both the direct-append path and --supersede's content-equality comparison /
# atomic rewrite (Sequence 68/69 Defect 3) -- never two independently
# hand-maintained block-shape implementations.
# Args: $1=head_sha, $2=raw stdin_content (may be empty), $3=now_ts
# B1 fix: sanitizes stdin_content before rendering to prevent reserved-line injection.
_render_delimited_block() {
  local head_sha="$1"
  local stdin_content
  # Sanitize raw stdin body before write (B1 fix).
  if [[ -n "$2" ]]; then
    stdin_content="$(_sanitize_stdin "$2")"
  else
    stdin_content=""
  fi
  local now_ts="$3"
  printf '%s\n' "$DELIM_BEGIN"
  if [[ -n "$stdin_content" ]]; then
    printf '%s\n' "$stdin_content"
    printf '\n---\n\n'
  fi
  printf '**HEAD**: %s\n' "$head_sha"
  printf '**Phase**: VERIFY-FINAL\n'
  printf '**Timestamp**: %s\n' "$now_ts"
  printf '**Status**: APPROVED-VERIFY-FINAL\n\n'
  printf '%s\n' "$DELIM_END"
}

# _append_delimited_block — write a fresh delimited VERIFY-FINAL block to VERDICT_FILE.
# Args: $1=head_sha, $2=raw stdin_content (may be empty), $3=now_ts
_append_delimited_block() {
  _render_delimited_block "$1" "$2" "$3" >> "$VERDICT_FILE"
}

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

  # B2 fix: --supersede on a file with no APPROVED-PREP is a bypass attempt — fail-closed.
  # Must fire regardless of has_final (catches orphan-final + no-block cases alike).
  if [[ "$SUPERSEDE" -eq 1 && "$has_prep" -eq 0 ]]; then
    echo "[write-verdict] ERROR: --supersede requires APPROVED-PREP in verdict file — cannot supersede an orphan VERIFY-FINAL: $VERDICT_FILE" >&2
    exit 2
  fi

  if [[ "$has_prep" -eq 1 && "$has_final" -eq 1 ]]; then
    # --supersede opt-in: replace the existing VERIFY-FINAL block instead of failing.
    if [[ "$SUPERSEDE" -eq 1 ]]; then
      # Resolve HEAD fail-closed.
      local head_sha=""
      head_sha="$(git rev-parse HEAD 2>/dev/null || true)"
      if [[ ! "$head_sha" =~ ^[0-9a-f]{40}$ ]]; then
        echo "[write-verdict] ERROR: git rev-parse HEAD failed or returned non-hex '$head_sha'. Aborting verify-final --supersede — resolve HEAD before writing the verdict." >&2
        exit 2
      fi

      # Read stdin before any file modification.
      local stdin_content=""
      if [[ ! -t 0 ]]; then
        stdin_content="$(cat)"
      fi

      # B4 fix: use LAST-block anchor with exact-line grep so PREP prose mentioning
      # the delimiter as a substring is never matched. grep -n "^$DELIM_BEGIN$" + tail -1.
      local begin_line=""
      begin_line="$(grep -n "^${DELIM_BEGIN}$" "$VERDICT_FILE" | tail -1 | cut -d: -f1)" || true

      # Sequence 68/69 Defect 3: a mismatched BEGIN/END delimiter count is an
      # unterminated/malformed block structure -- fail CLOSED before any
      # mutation (never truncate through to EOF and report success).
      local begin_count end_count
      begin_count="$(grep -c "^${DELIM_BEGIN}$" "$VERDICT_FILE" || true)"
      end_count="$(grep -c "^${DELIM_END}$" "$VERDICT_FILE" || true)"
      if [[ -n "$begin_line" && "$begin_count" != "$end_count" ]]; then
        echo "[write-verdict] ERROR: malformed VERIFY-FINAL block structure — $begin_count BEGIN delimiter(s) but $end_count END delimiter(s) in $VERDICT_FILE (unterminated/mismatched block); refusing to mutate a corrupt file." >&2
        exit 2
      fi

      # tmp_file holds the COMPLETE new file content; a single atomic mv replaces
      # VERDICT_FILE at the very end, never a truncate-then-append window.
      local tmp_file=""
      tmp_file="$(mktemp)"

      if [[ -n "$begin_line" ]]; then
        # Find the END delimiter following this BEGIN (first END after begin_line).
        local end_line=""
        end_line="$(awk -v start="$begin_line" \
          'NR > start && /^<!-- END VERIFY-FINAL -->$/ { print NR; exit }' \
          "$VERDICT_FILE")"

        if [[ -z "$end_line" ]]; then
          rm -f "$tmp_file"
          echo "[write-verdict] ERROR: malformed VERIFY-FINAL block — BEGIN delimiter at line $begin_line has no matching END delimiter after it: $VERDICT_FILE (unterminated block); refusing to mutate a corrupt file." >&2
          exit 2
        fi

        # B1a fix: extract stored HEAD from LAST **HEAD**: line in the block (tail -1).
        # The block writes HEAD after any stdin body, so tail -1 is the real record.
        local stored_head=""
        stored_head="$(sed -n "${begin_line},${end_line}p" "$VERDICT_FILE" \
          | grep '^\*\*HEAD\*\*: ' | tail -1 | sed 's/^\*\*HEAD\*\*: //')" || true

        if [[ "$begin_count" -eq 1 && "$stored_head" == "$head_sha" ]]; then
          # Sequence 68/69 Defect 3: same HEAD alone no longer proves the block
          # is genuinely unchanged -- compare the FULL rendered block (Timestamp
          # excluded, since it legitimately differs run to run) against what THIS
          # invocation's stdin would produce. Only a byte-for-byte content match
          # is a true idempotent no-op; any difference (a hand-corrupted or stale
          # body, or genuinely new architect content) must be repaired, never
          # silently left in place.
          local existing_block rendered_new
          existing_block="$(sed -n "${begin_line},${end_line}p" "$VERDICT_FILE" | grep -v '^\*\*Timestamp\*\*:' || true)"
          rendered_new="$(_render_delimited_block "$head_sha" "$stdin_content" "$NOW" | grep -v '^\*\*Timestamp\*\*:' || true)"
          if [[ "$existing_block" == "$rendered_new" ]]; then
            rm -f "$tmp_file"
            echo "[write-verdict] VERIFY-FINAL --supersede: stored HEAD == current HEAD ($head_sha) and content unchanged — no-op." >&2
            exit 0
          fi
        fi

        # Different HEAD, different content, or multiple blocks: excise ALL
        # delimited blocks via awk (handles VS-12/VS-13's own multi-block
        # normalization; safe now every BEGIN above already proved a matching
        # END via the count/end_line checks), into tmp_file only -- nothing is
        # written to VERDICT_FILE itself yet.
        awk '
          /^<!-- BEGIN VERIFY-FINAL -->$/ { skip=1 }
          !skip { print }
          /^<!-- END VERIFY-FINAL -->$/ { skip=0 }
        ' "$VERDICT_FILE" > "$tmp_file"
      else
        # Legacy fallback: un-delimited VERIFY-FINAL block present (pre-wave file).
        # Excise from the first **HEAD**: line through EOF, into tmp_file only.
        local head_line_num=""
        head_line_num="$(awk '/^\*\*HEAD\*\*: /{ print NR; exit }' "$VERDICT_FILE")"
        if [[ -n "$head_line_num" ]]; then
          # B3 fix: warn before truncation, naming the line range being excised.
          local total_lines=""
          total_lines="$(wc -l < "$VERDICT_FILE" | tr -d ' \r')"
          if [[ "$head_line_num" -le "$total_lines" ]]; then
            echo "[write-verdict] WARN: --supersede legacy fallback: excising lines ${head_line_num}-${total_lines} from $VERDICT_FILE (content in that range will be replaced by fresh delimited block)" >&2
          fi
          head -n "$((head_line_num - 1))" "$VERDICT_FILE" > "$tmp_file"
        else
          # No **HEAD**: line found — keep the whole file (nothing to excise).
          cp "$VERDICT_FILE" "$tmp_file"
        fi
      fi

      # Single atomic replacement: the excised existing content plus the fresh
      # block are both already/about-to-be in tmp_file before the one mv.
      _render_delimited_block "$head_sha" "$stdin_content" "$NOW" >> "$tmp_file"
      mv "$tmp_file" "$VERDICT_FILE"
      echo "[write-verdict] VERIFY-FINAL --supersede: replaced with HEAD=$head_sha: $VERDICT_FILE" >&2
      return
    fi

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

  # Resolve HEAD fail-closed: never write UNKNOWN into the verdict file,
  # because the emitter's step 3b rejects any HEAD != final HEAD (including UNKNOWN).
  local head_sha=""
  head_sha="$(git rev-parse HEAD 2>/dev/null || true)"
  if [[ ! "$head_sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "[write-verdict] ERROR: git rev-parse HEAD failed or returned non-hex '$head_sha'. Aborting verify-final — resolve HEAD before writing the verdict." >&2
    exit 2
  fi

  # --supersede with no existing VERIFY-FINAL block: normal first-append (with delimiters).
  # Also handles the standard (non-supersede) path — both emit a delimited block.
  _append_delimited_block "$head_sha" "$stdin_content" "$NOW"

  echo "[write-verdict] VERIFY-FINAL appended: $VERDICT_FILE" >&2
}

# ── Dispatch ──────────────────────────────────────────────────────────────────

case "$PHASE" in
  prep)         run_prep ;;
  verify-final) run_verify_final ;;
esac
