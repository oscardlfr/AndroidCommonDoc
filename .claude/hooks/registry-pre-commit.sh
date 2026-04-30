#!/bin/bash
# PreToolUse hook on Bash — intercepts git commit to auto-rehash registry when relevant files change.
# Only fires when staged files include skills/, .claude/agents/, or .claude/commands/.
# All non-JSON output goes to stderr. Only valid JSON (or nothing) goes to stdout.
set -euo pipefail

# Read PreToolUse JSON from stdin
INPUT=$(cat /dev/stdin)

# Extract command from tool input
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty') || exit 0
if [ -z "$COMMAND" ]; then
  exit 0
fi

# Only intercept git commit commands
[[ "$COMMAND" =~ git\ commit ]] || exit 0

# Check if any staged files are registry-relevant
STAGED=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null || true)
if [ -z "$STAGED" ]; then
  exit 0
fi

# Filter to relevant paths
RELEVANT=$(echo "$STAGED" | grep -E '^(skills/|\.claude/agents/|\.claude/commands/)' || true)
if [ -z "$RELEVANT" ]; then
  exit 0
fi

echo "Registry-relevant files staged — checking hashes" >&2

# Determine toolkit root
COMMON_DOC="${ANDROID_COMMON_DOC:-}"
if [ -z "$COMMON_DOC" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  COMMON_DOC="$(cd "$SCRIPT_DIR/../.." && pwd)"
fi

REHASH_SCRIPT="$COMMON_DOC/scripts/sh/rehash-registry.sh"
if [ ! -f "$REHASH_SCRIPT" ]; then
  echo "rehash-registry.sh not found — skipping" >&2
  exit 0
fi

# Run in check mode first
CHECK_RESULT=$(bash "$REHASH_SCRIPT" --project-root "$COMMON_DOC" --check 2>/dev/null) || true
STALE_COUNT=$(echo "$CHECK_RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('updated',0))" 2>/dev/null || echo "0")

if [ "$STALE_COUNT" -eq 0 ]; then
  echo "Registry hashes are current" >&2
  exit 0
fi

echo "Found $STALE_COUNT stale registry hash(es) — auto-rehashing" >&2

# Auto-rehash
bash "$REHASH_SCRIPT" --project-root "$COMMON_DOC" >/dev/null 2>&1

# Stage the updated registry
git add "$COMMON_DOC/skills/registry.json" 2>/dev/null || true

echo "Registry rehashed and staged ($STALE_COUNT entries updated)" >&2

# Emit context for the agent
jq -n --arg ctx "Auto-rehashed $STALE_COUNT stale registry entries and staged skills/registry.json." \
  '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      additionalContext: $ctx
    }
  }'

exit 0
