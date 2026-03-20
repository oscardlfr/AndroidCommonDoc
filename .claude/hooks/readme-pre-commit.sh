#!/bin/bash
# PreToolUse hook on Bash — intercepts git commit to verify README counts are current.
# All non-JSON output goes to stderr. Only valid JSON (or nothing) goes to stdout.
set -euo pipefail

INPUT=$(cat /dev/stdin)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty') || exit 0
[ -z "$COMMAND" ] && exit 0
[[ "$COMMAND" =~ git\ commit ]] || exit 0

COMMON_DOC="${ANDROID_COMMON_DOC:-}"
if [ -z "$COMMON_DOC" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  COMMON_DOC="$(cd "$SCRIPT_DIR/../.." && pwd)"
fi

README="$COMMON_DOC/README.md"
[ -f "$README" ] || exit 0

FAIL=0
STALE=""

check() {
  local label="$1" value="$2"
  [ "$value" = "skip" ] && return
  if ! grep -qE "\b${value}\b" "$README"; then
    STALE="${STALE}  ${label}: actual=${value} not in README\n"
    FAIL=1
  fi
}

# Gather counts
SKILLS=$(ls "$COMMON_DOC/skills/" 2>/dev/null | grep -vE "registry|params|schema" | wc -l | tr -d ' ')
AGENTS=$(ls "$COMMON_DOC/.claude/agents/" 2>/dev/null | wc -l | tr -d ' ')
RULES=$(ls "$COMMON_DOC/detekt-rules/src/main/kotlin/com/androidcommondoc/detekt/rules/"*.kt 2>/dev/null | grep -v generated | wc -l | tr -d ' ')
MCP_TOOLS=$(ls "$COMMON_DOC/mcp-server/src/tools/"*.ts 2>/dev/null | wc -l | tr -d ' ')
REUSABLE_WF=$(ls "$COMMON_DOC/.github/workflows/reusable-"*.yml 2>/dev/null | wc -l | tr -d ' ')
REGISTRY=$(python3 -c "import json; d=json.load(open('$COMMON_DOC/skills/registry.json')); print(len(d.get('skills', d.get('entries', []))))" 2>/dev/null || echo "skip")
COMMANDS=$(ls "$COMMON_DOC/.claude/commands/" 2>/dev/null | wc -l | tr -d ' ')

check "Skills" "$SKILLS"
check "Agents" "$AGENTS"
check "Rules" "$RULES"
check "MCP tools" "$MCP_TOOLS"
check "Workflows" "$REUSABLE_WF"
check "Registry" "$REGISTRY"
check "Commands" "$COMMANDS"

if [ "$FAIL" -eq 1 ]; then
  MSG="README.md has stale counts:\n${STALE}Run /readme-audit --fix to update."
  echo -e "$MSG" >&2
  jq -n --arg reason "$(echo -e "$MSG")" \
    '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: $reason
      }
    }'
  exit 0
fi

exit 0
