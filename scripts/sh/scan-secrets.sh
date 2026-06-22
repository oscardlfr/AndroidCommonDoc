#!/usr/bin/env bash
set -euo pipefail

# Scans a project directory for verified secrets using TruffleHog.
#
# Requires TruffleHog v3 (Go binary) to be installed:
#   curl -sSfL https://raw.githubusercontent.com/trufflesecurity/trufflehog/main/scripts/install.sh | sh -s -- -b /usr/local/bin
#   NOTE: Do NOT use `pip install trufflehog` — that installs v2 (Python) which lacks the `filesystem` subcommand.
#
# Usage:
#   ./scan-secrets.sh [project_root]
#
# Arguments:
#   $1 = project_root (default: ".")
#
# Output (when scanner is present):
#   RC=0 + empty stdout   → {"status":"PASS","reason_code":"OK"}        (clean; bare empty stdout is NEVER a legitimate clean signal)
#   RC=0 + JSONL stdout   → JSONL findings (one JSON object per finding)
#   RC!=0                 → {"status":"FAIL","reason_code":"SCANNER_ERROR"} + exit 1
#   scanner absent        → {"status":"SKIPPED","reason":"trufflehog not installed"} + exit 0
#
# Exit code:
#   0  — scanner absent (SKIPPED) or scanner ran without error (PASS or findings).
#   1  — scanner present but exited with an error (fail-closed; never silently passes).
#   Severity handling is done in the TypeScript layer.

PROJECT_ROOT="${1:-.}"

# Check if trufflehog is on PATH
if ! command -v trufflehog &> /dev/null; then
    printf '{"status":"SKIPPED","reason":"trufflehog not installed"}\n'
    exit 0
fi

# Run trufflehog in filesystem mode with verified-only JSON output.
# --no-update suppresses the update check banner on stderr.
# Capture RC explicitly — no "|| true" (fail-closed: scanner error → FAIL, exit 1).
OUT=""; RC=0
if OUT="$(trufflehog filesystem "$PROJECT_ROOT" --only-verified --json --no-update 2>/dev/null)"; then RC=0; else RC=$?; fi

if [[ $RC -ne 0 ]]; then
    printf '{"status":"FAIL","reason_code":"SCANNER_ERROR"}\n'
    exit 1
fi

if [[ -z "$OUT" ]]; then
    # Clean run — emit explicit PASS sentinel (bare empty stdout is never a clean signal)
    printf '{"status":"PASS","reason_code":"OK"}\n'
    exit 0
fi

# Findings present — emit JSONL for TypeScript layer to parse
printf '%s\n' "$OUT"
exit 0
