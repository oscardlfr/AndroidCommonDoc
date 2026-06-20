#!/usr/bin/env bash
# qg-registry-integrity.sh — Shared registry integrity check (QG mint + CI parity).
#
# Replicates the EXACT logic of the l0-ci.yml `skill-registry` job so that
# local QG and CI are green/red together (parity-by-construction).
#
# Checks (in order):
#   1. Hash drift  — rehash-registry.sh --check (CRLF->LF whole-file sha256)
#   2. Count compare — filesystem vs registry entries[].type tallies
#   3. SKILL.md presence — every skills/*/ has SKILL.md
#
# Writes .androidcommondoc/registry-hash-report.json with a 3-state result:
#   "clean"  — all checks pass; exit 0
#   "drift"  — one or more checks fail; exit 2 (fail-closed)
#   "n/a"    — no skills/registry.json and --require-registry not set; exit 0
#
# NEVER writes or mutates skills/registry.json (check-only; no side effects).
#
# Usage:
#   qg-registry-integrity.sh [--project-root <dir>] [--require-registry] [--help]
#
# Options:
#   --project-root <dir>   Project root to validate (default: ANDROID_COMMON_DOC or script parent)
#   --require-registry     Missing skills/registry.json is exit 2, not n/a
#   --help                 Show this message

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Defaults ─────────────────────────────────────────────────────────────────
ROOT="${ANDROID_COMMON_DOC:-$(cd "$DIR/../.." && pwd)}"
REQUIRE_REGISTRY=false

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --help|-h)
            sed -n '2,/^$/p' "$0"
            exit 0
            ;;
        --project-root)
            ROOT="$2"
            shift 2
            ;;
        --require-registry)
            REQUIRE_REGISTRY=true
            shift
            ;;
        *)
            echo "[qg-registry-integrity] ERROR: unknown argument: $1" >&2
            exit 1
            ;;
    esac
done

REGISTRY="$ROOT/skills/registry.json"
SKILLS_DIR="$ROOT/skills"
AGENTS_DIR="$ROOT/.claude/agents"
COMMANDS_DIR="$ROOT/.claude/commands"
REPORT_DIR="$ROOT/.androidcommondoc"
REPORT_PATH="$REPORT_DIR/registry-hash-report.json"

# ── Helper: write report and exit ─────────────────────────────────────────────
write_report_and_exit() {
    local result="$1"
    local exit_code="$2"
    local payload="$3"
    mkdir -p "$REPORT_DIR"
    printf '%s\n' "$payload" > "$REPORT_PATH"
    if [[ "$result" == "clean" ]]; then
        echo "[qg-registry-integrity] PASS: registry integrity clean" >&2
    elif [[ "$result" == "n/a" ]]; then
        echo "[qg-registry-integrity] INFO: no skills/registry.json — result n/a" >&2
    else
        echo "[qg-registry-integrity] FAIL: registry drift detected" >&2
    fi
    exit "$exit_code"
}

# ── Early exit: no registry ───────────────────────────────────────────────────
if [[ ! -f "$REGISTRY" ]]; then
    if [[ "$REQUIRE_REGISTRY" == "true" ]]; then
        write_report_and_exit "drift" 2 \
            '{"result":"drift","reason":"skills/registry.json missing and --require-registry is set"}'
    else
        write_report_and_exit "n/a" 0 \
            '{"result":"n/a","reason":"skills/registry.json not present; --require-registry not set"}'
    fi
fi

# ── Check 1: Hash drift (rehash --check, NEVER write-mode) ───────────────────
HASH_REPORT_TMP="/tmp/qg-registry-hash-check-$$.json"
HASH_EXIT=0
bash "$DIR/rehash-registry.sh" --project-root "$ROOT" --check --verbose \
    > "$HASH_REPORT_TMP" 2>&1 || HASH_EXIT=$?
HASH_OUTPUT="$(cat "$HASH_REPORT_TMP" 2>/dev/null || echo '{}')"
rm -f "$HASH_REPORT_TMP"

HASH_STALE_LIST="[]"
if [[ $HASH_EXIT -ne 0 ]]; then
    # Parse stale list from the JSON output (rehash --check emits JSON to stdout)
    HASH_STALE_LIST="$(python3 -c "
import json, sys
try:
    d = json.loads(sys.argv[1])
    stale = d.get('stale', [])
    print(json.dumps(stale))
except Exception:
    print('[]')
" "$HASH_OUTPUT" 2>/dev/null || echo '[]')"
fi

# ── Check 2: Count compare (EXACT CI logic — same exclusions) ─────────────────
COUNT_FAIL=0
COUNT_DELTA=""

if [[ -d "$SKILLS_DIR" ]]; then
    FS_SKILLS=$(ls "$SKILLS_DIR" | grep -vE "registry|params|schema" | wc -l | tr -d ' ')
else
    FS_SKILLS=0
fi

if [[ -d "$AGENTS_DIR" ]]; then
    FS_AGENTS=$(ls "$AGENTS_DIR" | wc -l | tr -d ' ')
else
    FS_AGENTS=0
fi

if [[ -d "$COMMANDS_DIR" ]]; then
    FS_COMMANDS=$(ls "$COMMANDS_DIR" | wc -l | tr -d ' ')
else
    FS_COMMANDS=0
fi

REGISTRY_COUNTS="$(python3 -c "
import json, sys
try:
    d = json.load(open(sys.argv[1], encoding='utf-8'))
    entries = d.get('skills', d.get('entries', []))
    skills   = sum(1 for e in entries if e.get('type') == 'skill')
    agents   = sum(1 for e in entries if e.get('type') == 'agent')
    commands = sum(1 for e in entries if e.get('type') == 'command')
    total    = len(entries)
    print(f'{skills} {agents} {commands} {total}')
except Exception as e:
    print('ERROR', file=__import__(\"sys\").stderr)
    raise
" "$REGISTRY" 2>/dev/null || echo "0 0 0 0")"

read -r REG_SKILLS REG_AGENTS REG_COMMANDS REG_TOTAL <<< "$REGISTRY_COUNTS"

DELTA_PARTS=()
if [[ "$FS_SKILLS" != "$REG_SKILLS" ]]; then
    COUNT_FAIL=1
    DELTA_PARTS+=("\"skills_fs\":$FS_SKILLS,\"skills_reg\":$REG_SKILLS")
fi
if [[ "$FS_AGENTS" != "$REG_AGENTS" ]]; then
    COUNT_FAIL=1
    DELTA_PARTS+=("\"agents_fs\":$FS_AGENTS,\"agents_reg\":$REG_AGENTS")
fi
if [[ "$FS_COMMANDS" != "$REG_COMMANDS" ]]; then
    COUNT_FAIL=1
    DELTA_PARTS+=("\"commands_fs\":$FS_COMMANDS,\"commands_reg\":$REG_COMMANDS")
fi

if [[ ${#DELTA_PARTS[@]} -gt 0 ]]; then
    # Join with comma
    COUNT_DELTA=$(printf '%s,' "${DELTA_PARTS[@]}")
    COUNT_DELTA="{${COUNT_DELTA%,}}"
else
    COUNT_DELTA="{}"
fi

# ── Check 3: SKILL.md presence (same exclusions as CI) ───────────────────────
SKILL_MD_FAIL=0
MISSING_SKILL_MD="[]"

if [[ -d "$SKILLS_DIR" ]]; then
    MISSING_LIST="$(python3 -c "
import os, json, sys, re

skills_dir = sys.argv[1]
# Exclusion pattern must match the count check: grep -vE 'registry|params|schema'
# (substring/regex match, same as the CI count logic).
EXCLUDE_PAT = re.compile(r'registry|params|schema')
missing = []
try:
    for name in sorted(os.listdir(skills_dir)):
        if EXCLUDE_PAT.search(name):
            continue
        full = os.path.join(skills_dir, name)
        if not os.path.isdir(full):
            continue
        skill_md = os.path.join(full, 'SKILL.md')
        if not os.path.isfile(skill_md):
            missing.append(name)
except Exception:
    pass
print(json.dumps(missing))
" "$SKILLS_DIR" 2>/dev/null || echo '[]')"

    if [[ "$MISSING_LIST" != "[]" ]]; then
        SKILL_MD_FAIL=1
        MISSING_SKILL_MD="$MISSING_LIST"
    fi
fi

# ── Aggregate result ──────────────────────────────────────────────────────────
if [[ $HASH_EXIT -ne 0 || $COUNT_FAIL -ne 0 || $SKILL_MD_FAIL -ne 0 ]]; then
    TIMESTAMP="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    REPORT_JSON="$(python3 -c "
import json, sys

result = 'drift'
timestamp = sys.argv[1]
stale_list = json.loads(sys.argv[2])
count_delta = json.loads(sys.argv[3])
missing_skill_md = json.loads(sys.argv[4])
hash_exit = int(sys.argv[5])
count_fail = int(sys.argv[6])
skill_md_fail = int(sys.argv[7])

report = {
    'result': result,
    'timestamp': timestamp,
    'checks': {
        'hash_drift': {
            'passed': hash_exit == 0,
            'stale_entries': stale_list,
        },
        'count_compare': {
            'passed': count_fail == 0,
            'deltas': count_delta,
        },
        'skill_md_presence': {
            'passed': skill_md_fail == 0,
            'missing': missing_skill_md,
        },
    },
}
print(json.dumps(report, indent=2))
" "$TIMESTAMP" "$HASH_STALE_LIST" "$COUNT_DELTA" "$MISSING_SKILL_MD" \
  "$HASH_EXIT" "$COUNT_FAIL" "$SKILL_MD_FAIL" 2>/dev/null || \
  echo '{"result":"drift","reason":"report serialization failed"}')"

    write_report_and_exit "drift" 2 "$REPORT_JSON"
fi

# ── All checks passed ─────────────────────────────────────────────────────────
TIMESTAMP="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
CLEAN_REPORT="$(python3 -c "
import json, sys

timestamp = sys.argv[1]
reg_skills = int(sys.argv[2])
reg_agents = int(sys.argv[3])
reg_commands = int(sys.argv[4])
reg_total = int(sys.argv[5])

report = {
    'result': 'clean',
    'timestamp': timestamp,
    'checks': {
        'hash_drift': {'passed': True, 'stale_entries': []},
        'count_compare': {
            'passed': True,
            'counts': {
                'skills': reg_skills,
                'agents': reg_agents,
                'commands': reg_commands,
                'total': reg_total,
            },
        },
        'skill_md_presence': {'passed': True, 'missing': []},
    },
}
print(json.dumps(report, indent=2))
" "$TIMESTAMP" "$REG_SKILLS" "$REG_AGENTS" "$REG_COMMANDS" "$REG_TOTAL" 2>/dev/null || \
  echo '{"result":"clean"}')"

write_report_and_exit "clean" 0 "$CLEAN_REPORT"
