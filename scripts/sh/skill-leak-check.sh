#!/usr/bin/env bash
set -euo pipefail

# skill-leak-check.sh — Level B analytics: detect skill description leakage.
#
# "Skill leak" = an agent ran a raw bash command when a skill wrapper exists
# for that operation. Examples:
#   - `./gradlew test` raw while `/test` skill exists
#   - `grep -rE "pattern" src/` raw while `/find-pattern` MCP exists
#
# Detection algorithm:
#   1. Read .androidcommondoc/tool-use-log.jsonl
#   2. For each Bash tool entry, extract command from input_summary
#   3. Cross-reference against the SKILL_MAP (command prefix → skill name)
#   4. Output: list of Bash calls with skill alternatives, grouped by agent
#
# Usage:
#   ./scripts/sh/skill-leak-check.sh --project-root <path> [options]
#
# Options:
#   --project-root <path>   Root of AndroidCommonDoc repo (required)
#   --json                  Output as JSON instead of human-readable markdown
#   --help, -h              Show this message
#
# Exit codes:
#   0 = success (leaks found or not — informational)
#   1 = bad arguments or unreadable log file

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLKIT_ROOT="${ANDROID_COMMON_DOC:-$(cd "$SCRIPT_DIR/../.." && pwd)}"

# --- Color helpers ---
if [[ -t 1 ]]; then
    YELLOW='\033[33m'
    GREEN='\033[32m'
    CYAN='\033[36m'
    RESET='\033[0m'
else
    YELLOW='' GREEN='' CYAN='' RESET=''
fi

# --- Skill map: command prefix pattern → skill name ---
# Key = regex pattern matched against bash command
# Value = skill name (with / prefix)
declare -A SKILL_MAP
SKILL_MAP["./gradlew test"]="/test"
SKILL_MAP["./gradlew.*test"]="/test"
SKILL_MAP["gradlew test"]="/test"
SKILL_MAP["gradlew.*test"]="/test"
SKILL_MAP["gradle test"]="/test"
SKILL_MAP["gradle.*test"]="/test"
SKILL_MAP["./gradlew.*coverage"]="/coverage"
SKILL_MAP["gradlew.*coverage"]="/coverage"
SKILL_MAP["grep -r"]="/find-pattern (MCP)"
SKILL_MAP["grep -rE"]="/find-pattern (MCP)"
SKILL_MAP["grep -rn"]="/find-pattern (MCP)"
SKILL_MAP["rg "]="/find-pattern (MCP)"
SKILL_MAP["git log"]="rtk git log"
SKILL_MAP["git diff"]="rtk git diff"
SKILL_MAP["git status"]="rtk git status"
SKILL_MAP["npm test"]="rtk vitest run"
SKILL_MAP["npx vitest"]="rtk vitest run"

usage() {
    sed -n '/^# skill-leak/,/^[^#]/{ /^[^#]/d; s/^# \{0,1\}//; p }' "$0"
    exit 0
}

# --- Parse args ---
PROJECT_ROOT=""
JSON_MODE=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --help|-h)
            usage
            ;;
        --project-root)
            if [[ $# -lt 2 ]]; then
                echo '{"error":"--project-root requires a value"}' >&2
                exit 1
            fi
            PROJECT_ROOT="$2"
            shift 2
            ;;
        --project-root=*)
            PROJECT_ROOT="${1#--project-root=}"
            shift
            ;;
        --json)
            JSON_MODE=true
            shift
            ;;
        *)
            echo "Unknown option: $1" >&2
            echo "Run with --help for usage." >&2
            exit 1
            ;;
    esac
done

if [[ -z "$PROJECT_ROOT" ]]; then
    echo '{"error":"--project-root is required"}' >&2
    exit 1
fi

if [[ ! -d "$PROJECT_ROOT" ]]; then
    echo "{\"error\":\"project-root not found: $PROJECT_ROOT\"}" >&2
    exit 1
fi

LOG_FILE="$PROJECT_ROOT/.androidcommondoc/tool-use-log.jsonl"

if [[ ! -f "$LOG_FILE" ]]; then
    if $JSON_MODE; then
        echo '{"leaks":[],"total_bash_calls":0,"leak_count":0,"note":"tool-use-log.jsonl not found — no data to analyze"}'
    else
        echo "## Section 4 — Skill Leak Report"
        echo ""
        echo "No tool-use-log.jsonl found at \`$PROJECT_ROOT/.androidcommondoc/\`."
        echo "Run at least one session with the MCP server active to generate log data."
    fi
    exit 0
fi

# --- JSON field extractor: jq when available, python3 fallback ---
# Handles embedded quotes in values (e.g., grep -rE "pattern" src/).
# Usage: json_field <json_line> <key>
HAS_JQ=false
if command -v jq &>/dev/null; then HAS_JQ=true; fi

json_field() {
    local json="$1" key="$2"
    if $HAS_JQ; then
        echo "$json" | jq -r --arg k "$key" '.[$k] // empty' 2>/dev/null
    else
        echo "$json" | python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    v = d.get('$key', '')
    print(v if v else '', end='')
except Exception:
    pass
" 2>/dev/null
    fi
}

# --- Parse log and detect leaks ---
declare -a LEAK_LINES=()
TOTAL_BASH=0
LEAK_COUNT=0

while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" ]] && continue

    tool_name=$(json_field "$line" "tool_name")
    [[ "$tool_name" != "Bash" ]] && continue
    TOTAL_BASH=$((TOTAL_BASH + 1))

    # Prefer input_summary; fall back to command field
    cmd=$(json_field "$line" "input_summary")
    if [[ -z "$cmd" ]]; then
        cmd=$(json_field "$line" "command")
    fi
    [[ -z "$cmd" ]] && continue

    agent=$(json_field "$line" "agent_name")
    [[ -z "$agent" ]] && agent="unknown"

    ts=$(json_field "$line" "timestamp")

    # Check against skill map
    for pattern in "${!SKILL_MAP[@]}"; do
        if echo "$cmd" | grep -qE "$pattern" 2>/dev/null; then
            skill="${SKILL_MAP[$pattern]}"
            # Build JSON entry safely to handle embedded quotes in cmd/skill values.
            # Values are passed via stdin as NUL-delimited to avoid MSYS2 path mangling.
            entry=$(printf '%s\0%s\0%s\0%s\0' "$agent" "$cmd" "$skill" "$ts" | \
                python3 -c "
import json, sys
parts = sys.stdin.read().split('\x00')
print(json.dumps({'agent': parts[0], 'command': parts[1], 'skill': parts[2], 'timestamp': parts[3]}))" \
                2>/dev/null || \
                echo "{\"agent\":\"$agent\",\"command\":\"${cmd//\"/\\\"}\",\"skill\":\"${skill//\"/\\\"}\",\"timestamp\":\"$ts\"}")
            LEAK_LINES+=("$entry")
            LEAK_COUNT=$((LEAK_COUNT + 1))
            break
        fi
    done
done < "$LOG_FILE"

# --- Output ---
if $JSON_MODE; then
    echo -n '{"leaks":['
    first=true
    for entry in "${LEAK_LINES[@]}"; do
        if $first; then first=false; else echo -n ','; fi
        echo -n "$entry"
    done
    echo "],\"total_bash_calls\":$TOTAL_BASH,\"leak_count\":$LEAK_COUNT}"
else
    echo "## Section 4 — Skill Leak Report"
    echo ""
    echo "Analyzed \`$LOG_FILE\`"
    echo ""
    echo "| Metric | Value |"
    echo "|--------|-------|"
    echo "| Total Bash calls in log | $TOTAL_BASH |"
    echo "| Skill leaks detected | $LEAK_COUNT |"
    echo ""

    if [[ $LEAK_COUNT -eq 0 ]]; then
        printf "%b" "${GREEN}No skill leaks detected.${RESET}\n"
    else
        printf "%b" "${YELLOW}Warning: $LEAK_COUNT skill leak(s) detected.${RESET}\n"
        echo ""
        echo "### Leaks by Agent"
        echo ""

        current_agent=""
        for entry in "${LEAK_LINES[@]}"; do
            agent=$(json_field "$entry" "agent")
            cmd=$(json_field "$entry" "command")
            skill=$(json_field "$entry" "skill")
            ts=$(json_field "$entry" "timestamp")

            if [[ "$agent" != "$current_agent" ]]; then
                echo "#### $agent"
                current_agent="$agent"
            fi
            echo "- \`$cmd\` → use \`$skill\` instead$([ -n "$ts" ] && echo " [$ts]" || true)"
        done
    fi
fi

exit 0
