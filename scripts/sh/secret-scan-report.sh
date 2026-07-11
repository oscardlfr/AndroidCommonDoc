#!/usr/bin/env bash
# secret-scan-report.sh — QG required-step producer: fail-closed honest secret scanner.
#
# Usage: secret-scan-report.sh [PROJECT_ROOT]
#   PROJECT_ROOT  Directory to scan (default: current directory)
#
# Output artifact: .androidcommondoc/secret-scan-report.json
#   {"status":"PASS|FAIL","reason_code":"OK|SCANNER_UNAVAILABLE|SCANNER_ERROR|SECRETS_FOUND",
#    "tool":"<basename>|none","version":"<string>|unknown","count":<int>}
#
# Exit codes:
#   0  PASS — scanner ran, exit 0, zero verified findings
#   1  FAIL — scanner unavailable, scanner error, or secrets found
#
# CONTRACT: This is the QG required-step producer for secret scanning.
#   - Absent or erroring scanner  → FAIL (exit 1), NEVER PASS, NEVER SKIPPED
#   - SKIPPED is reserved exclusively for /pre-pr's scan-secrets.sh
#   - This script does NOT depend on or call scan-secrets.sh
#
# Scanner resolution order (first executable wins):
#   1. $TRUFFLEHOG_BIN  (if set and executable)
#   2. command -v trufflehog
#   3. $HOME/.local/bin/trufflehog
#   4. $HOME/.local/bin/trufflehog.exe
#   If none found → FAIL with reason_code SCANNER_UNAVAILABLE
#
# set -euo pipefail safety: scanner exit code captured via if/else, never bare substitution.

set -euo pipefail

# ── Arg parsing ──────────────────────────────────────────────────────────────

PROJECT_ROOT="${1:-.}"

# ── Envelope metadata (additive on every write-site below) ───────────────────
# head/generated_at let the QG mint's generic artifact-binding loop (required_
# steps[] entries with kind=="automatable" + artifact + no evidence sub-object +
# not mint_rederived) confirm this receipt is HEAD-bound and fresh before trusting
# its status. Computed once, reused across every possible exit path.

HEAD_SHA="$(git -C "$PROJECT_ROOT" rev-parse HEAD 2>/dev/null || echo "unknown")"
GENERATED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# ── Setup ─────────────────────────────────────────────────────────────────────

mkdir -p .androidcommondoc
REPORT=".androidcommondoc/secret-scan-report.json"

# ── Scanner resolution ────────────────────────────────────────────────────────

BIN=""

if [[ -n "${TRUFFLEHOG_BIN:-}" && -x "${TRUFFLEHOG_BIN}" ]]; then
  BIN="${TRUFFLEHOG_BIN}"
elif command -v trufflehog >/dev/null 2>&1; then
  BIN="$(command -v trufflehog)"
elif [[ -x "${HOME}/.local/bin/trufflehog" ]]; then
  BIN="${HOME}/.local/bin/trufflehog"
elif [[ -x "${HOME}/.local/bin/trufflehog.exe" ]]; then
  BIN="${HOME}/.local/bin/trufflehog.exe"
fi

# ── No scanner available → FAIL ───────────────────────────────────────────────

if [[ -z "$BIN" ]]; then
  echo "[secret-scan-report] ERROR: no trufflehog executable found — SCANNER_UNAVAILABLE." >&2
  echo "[secret-scan-report] Checked: \$TRUFFLEHOG_BIN, PATH trufflehog, ~/.local/bin/trufflehog{,.exe}" >&2
  printf '{"status":"FAIL","reason_code":"SCANNER_UNAVAILABLE","tool":"none","version":"unknown","count":0,"head":"%s","generated_at":"%s"}\n' \
    "$HEAD_SHA" "$GENERATED_AT" > "$REPORT"
  exit 1
fi

TOOL_NAME="$(basename "$BIN")"

# ── Version (informational; failure here is non-fatal) ───────────────────────

RAW_VERSION="$("$BIN" --version 2>&1 | head -n1 || true)"
# Sanitize for JSON: strip CR, replace double-quotes, cap at 120 chars
VERSION="${RAW_VERSION//$'\r'/}"
VERSION="${VERSION//\"/\'}"
VERSION="${VERSION:0:120}"
if [[ -z "$VERSION" ]]; then
  VERSION="unknown"
fi

# ── Run scan — capture exit code explicitly ───────────────────────────────────
# CRUX: do NOT use || true — that would mask scanner errors and produce a false PASS.

OUT=""
RC=0
if OUT="$("$BIN" filesystem "$PROJECT_ROOT" --only-verified --json --no-update 2>/dev/null)"; then
  RC=0
else
  RC=$?
fi

# ── Evaluate result ───────────────────────────────────────────────────────────

if [[ $RC -ne 0 ]]; then
  echo "[secret-scan-report] ERROR: scanner exited $RC — SCANNER_ERROR." >&2
  printf '{"status":"FAIL","reason_code":"SCANNER_ERROR","tool":"%s","version":"%s","count":0,"head":"%s","generated_at":"%s"}\n' \
    "$TOOL_NAME" "$VERSION" "$HEAD_SHA" "$GENERATED_AT" > "$REPORT"
  exit 1
fi

# RC == 0: count non-empty finding lines (one JSON object per verified secret)
COUNT=0
COUNT="$(printf '%s' "$OUT" | grep -c . || true)"

if [[ "$COUNT" -eq 0 ]]; then
  echo "[secret-scan-report] PASS: 0 verified secrets found." >&2
  printf '{"status":"PASS","reason_code":"OK","tool":"%s","version":"%s","count":0,"head":"%s","generated_at":"%s"}\n' \
    "$TOOL_NAME" "$VERSION" "$HEAD_SHA" "$GENERATED_AT" > "$REPORT"
  exit 0
else
  echo "[secret-scan-report] FAIL: $COUNT verified secret(s) found — SECRETS_FOUND." >&2
  printf '{"status":"FAIL","reason_code":"SECRETS_FOUND","tool":"%s","version":"%s","count":%s,"head":"%s","generated_at":"%s"}\n' \
    "$TOOL_NAME" "$VERSION" "$COUNT" "$HEAD_SHA" "$GENERATED_AT" > "$REPORT"
  exit 1
fi
