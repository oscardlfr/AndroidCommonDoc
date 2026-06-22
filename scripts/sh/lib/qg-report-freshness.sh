#!/usr/bin/env bash
# qg-report-freshness.sh — Fail-closed step-reason freshness validator for QG reports.
#
# Usage:
#   qg-report-freshness.sh --report <path> --head <sha> --bats-count <n> --repo-root <path>
#
# Exit codes:
#   0  All step reasons are fresh (or carry metadata valid)
#   1  Stale reason detected (fail-closed); one [qg-freshness] FAIL: line written to stderr per violation
#
# Three invariants checked per step (all skipped when step.carried === true — carry validated instead):
#
#   A  Foreign-HEAD: any SHA in "HEAD context" must equal/prefix --head
#      Regex: (?:(?<!\w)HEAD(?!\w)[=:\s]+|@\s{0,2})([0-9a-f]{40}|[0-9a-f]{7,12})\b
#      Full 40-hex must equal --head; short 7-12-hex must be a prefix of --head.
#      Does NOT match BASE_HEAD=<sha> (lookbehind ensures HEAD is standalone word).
#
#   B  Count-coherence: any integer in "bats context" must equal --bats-count
#      Regex: \bbats\b.{0,20}?\b(\d{3,})\b
#      Does NOT match vitest/Detekt counts (no 'bats' keyword in range).
#
#   C  Reason/result coherence: FAIL/ERROR steps must not contain PASS-semantics words
#      Words: pass|passed|green|ok|success|succeeded (whole-word only; 'bats_ok' does NOT match)
#
# Carry validation (when step.carried === true):
#   Requires source_head, current_head, and non-empty files[] array.
#   current_head must equal --head.
#   Each files[] entry: repo-relative (no leading /), no .. segment, no leading :, no glob chars.
#   git ls-files --error-unmatch <file> must succeed (git-tracked).
#   git diff --quiet <source_head> <current_head> -- <files...> must exit 0 (byte-identical).
#
# Output protocol:
#   On failure: one "[qg-freshness] FAIL: step=<id> reason=<msg>" line to stderr; exits 1.
#   On success: no output; exits 0.
#
# Follows naming/header convention of manifest-digest.sh and audit-append.sh.

set -euo pipefail

# ── Argument parsing ──────────────────────────────────────────────────────────
REPORT_PATH=""
CURRENT_HEAD=""
BATS_COUNT=""
REPO_ROOT=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --report)
            REPORT_PATH="$2"
            shift 2
            ;;
        --head)
            CURRENT_HEAD="$2"
            shift 2
            ;;
        --bats-count)
            BATS_COUNT="$2"
            shift 2
            ;;
        --repo-root)
            REPO_ROOT="$2"
            shift 2
            ;;
        --help|-h)
            sed -n '2,/^$/p' "$0"
            exit 0
            ;;
        *)
            echo "[qg-freshness] ERROR: unknown argument: $1" >&2
            exit 1
            ;;
    esac
done

# ── Validate required args ────────────────────────────────────────────────────
if [[ -z "$REPORT_PATH" || -z "$CURRENT_HEAD" || -z "$BATS_COUNT" || -z "$REPO_ROOT" ]]; then
    echo "[qg-freshness] ERROR: --report, --head, --bats-count, and --repo-root are all required" >&2
    exit 1
fi

if [[ ! -f "$REPORT_PATH" ]]; then
    echo "[qg-freshness] ERROR: report file not found: $REPORT_PATH" >&2
    exit 1
fi

# ── Run all checks via Python3 (JSON parsing + regex) ────────────────────────
python3 - "$REPORT_PATH" "$CURRENT_HEAD" "$BATS_COUNT" "$REPO_ROOT" << 'PYEOF'
import json
import re
import subprocess
import sys

report_path   = sys.argv[1]
current_head  = sys.argv[2]
bats_count    = int(sys.argv[3])
repo_root     = sys.argv[4]

# Load report
try:
    with open(report_path, encoding='utf-8') as f:
        report = json.load(f)
except Exception as e:
    print(f"[qg-freshness] FAIL: step=<report> reason=failed to parse report JSON: {e}", file=sys.stderr)
    sys.exit(1)

steps = report.get("steps", [])
exit_code = 0

def fail(step_id, msg):
    global exit_code
    print(f"[qg-freshness] FAIL: step={step_id} reason={msg}", file=sys.stderr)
    exit_code = 1

# Invariant A regex — negative lookbehind ensures HEAD is a standalone word.
# Matches: HEAD=<sha>, HEAD:<sha>, HEAD <sha>, @ <sha>
# Does NOT match: BASE_HEAD=<sha> (lookbehind blocks it), merge-base: <sha>
HEAD_CONTEXT_RE = re.compile(
    r'(?:(?<!\w)HEAD(?!\w)[=:\s]+|@\s{0,2})([0-9a-f]{40}|[0-9a-f]{7,12})\b',
    re.IGNORECASE
)

# Invariant B regex — bats keyword within 20 chars before a 3+ digit integer
BATS_COUNT_RE = re.compile(
    r'\bbats\b.{0,20}?\b(\d{3,})\b',
    re.IGNORECASE
)

# Invariant C — PASS-semantics whole words (only for FAIL/ERROR steps)
PASS_SEMANTICS_RE = re.compile(
    r'\bpass\b|\bpassed\b|\bgreen\b|\bok\b|\bsuccess\b|\bsucceeded\b',
    re.IGNORECASE
)

for step in steps:
    step_id = step.get("step", "<unknown>")

    # ── Carry validation ──────────────────────────────────────────────────────
    if step.get("carried") is True:
        source_head      = step.get("source_head")
        current_head_val = step.get("current_head")
        files            = step.get("files")

        # All three fields required
        if not source_head or not current_head_val or not files:
            fail(step_id, "carry=true but missing source_head/current_head/files")
            continue

        # files must be a non-empty list
        if not isinstance(files, list) or len(files) == 0:
            fail(step_id, "carry files[] must be a non-empty list")
            continue

        # current_head must match --head
        if current_head_val != current_head:
            fail(step_id, f"carry current_head={current_head_val!r} does not match git HEAD={current_head!r}")
            continue

        # Per-file hardening
        files_ok = True
        for f in files:
            if f.startswith('/'):
                fail(step_id, f"carry files[] entry is absolute path: {f!r}")
                files_ok = False
                break
            if '..' in f.split('/'):
                fail(step_id, f"carry files[] entry contains path traversal: {f!r}")
                files_ok = False
                break
            if f.startswith(':'):
                fail(step_id, f"carry files[] entry has pathspec magic (leading ':'): {f!r}")
                files_ok = False
                break
            if re.search(r'[*?\[\]]', f):
                fail(step_id, f"carry files[] entry contains glob chars: {f!r}")
                files_ok = False
                break
            # Verify git-tracked
            rc = subprocess.run(
                ["git", "ls-files", "--error-unmatch", f],
                cwd=repo_root,
                capture_output=True
            )
            if rc.returncode != 0:
                fail(step_id, f"carry files[] entry is not git-tracked: {f!r}")
                files_ok = False
                break

        if not files_ok:
            continue

        # Byte-identical diff check
        rc = subprocess.run(
            ["git", "diff", "--quiet", source_head, current_head_val, "--"] + files,
            cwd=repo_root,
            capture_output=True
        )
        if rc.returncode != 0:
            fail(step_id, "carry files[] not byte-identical between source_head and current_head")

        # Carry validated — skip invariants A/B/C
        continue

    # ── Invariant A: Foreign-HEAD ─────────────────────────────────────────────
    reason = step.get("reason", "")
    for match in HEAD_CONTEXT_RE.finditer(reason):
        sha_in_reason = match.group(1)
        if len(sha_in_reason) >= 40:
            if sha_in_reason.lower() != current_head.lower():
                fail(step_id, f"foreign HEAD SHA in reason: {sha_in_reason!r} != HEAD={current_head!r}")
                break
        else:
            if not current_head.lower().startswith(sha_in_reason.lower()):
                fail(step_id, f"foreign HEAD prefix in reason: {sha_in_reason!r} not prefix of HEAD={current_head!r}")
                break

    # ── Invariant B: Count-coherence ──────────────────────────────────────────
    for match in BATS_COUNT_RE.finditer(reason):
        count_in_reason = int(match.group(1))
        if count_in_reason != bats_count:
            fail(step_id, f"bats count mismatch in reason: {count_in_reason} != authoritative {bats_count}")
            break

    # ── Invariant C: Reason/result coherence ─────────────────────────────────
    result = step.get("result", "")
    if result in ("FAIL", "ERROR"):
        if PASS_SEMANTICS_RE.search(reason):
            fail(step_id, f"PASS-semantics word found in reason for {result} step: {reason!r}")

sys.exit(exit_code)
PYEOF
