#!/usr/bin/env bash
set -euo pipefail

# Scans a project directory for verified secrets using TruffleHog.
#
# Requires TruffleHog to be installed:
#   macOS/Linux: curl -sSfL https://raw.githubusercontent.com/trufflesecurity/trufflehog/main/scripts/install.sh | sh -s -- -b /usr/local/bin
#   pip:         pip install trufflehog
#
# Usage:
#   ./scan-secrets.sh [project_root]
#
# Arguments:
#   $1 = project_root (default: ".")
#
# Output:
#   JSONL lines from trufflehog (one JSON object per finding), or
#   a single JSON object: {"status":"SKIPPED","reason":"trufflehog not installed"}
#
# Exit code: always 0 — severity handling is done in the TypeScript layer.

PROJECT_ROOT="${1:-.}"

# Check if trufflehog is on PATH
if ! command -v trufflehog &> /dev/null; then
    printf '{"status":"SKIPPED","reason":"trufflehog not installed"}\n'
    exit 0
fi

# Run trufflehog in filesystem mode with verified-only JSON output.
# --no-update suppresses the update check banner on stderr.
# The "|| true" ensures we always exit 0 regardless of findings.
trufflehog filesystem "$PROJECT_ROOT" --only-verified --json --no-update 2>/dev/null || true
