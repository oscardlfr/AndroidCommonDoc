#!/bin/bash
# PreToolUse hook on Bash -- blocks git commits that stage .kt files containing
# patterns that cause compile failures (error(), TODO() with no arg, etc.).
# BL-W30-07: W17 MED #16.
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

# Get staged Kotlin files (Added, Copied, Modified -- exclude Deleted)
STAGED_KT=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null | grep '\.kt$' || true)
if [ -z "$STAGED_KT" ]; then
  exit 0
fi

echo "compile-fail-pre-commit: checking staged .kt files for compile-fail patterns" >&2

# Patterns that indicate intentional compile failures left in staged code:
#   error("...")        — throws compilation error marker
#   TODO("...")         — compile-fail marker when used as expression without body
#   @Suppress("UNCHECKED_CAST") without allowlist — covered by separate hook
# We block: lines matching bare `error("` that aren't inside a comment
COMPILE_FAIL_RE='^\s*error\s*\('

VIOLATIONS=""
while IFS= read -r kt_file; do
  [ -f "$kt_file" ] || continue
  while IFS= read -r line_data; do
    line_num="${line_data%%:*}"
    line_content="${line_data#*:}"
    # Skip comment lines
    trimmed="${line_content#"${line_content%%[![:space:]]*}"}"
    [[ "$trimmed" == //* ]] && continue
    [[ "$trimmed" == \** ]] && continue
    VIOLATIONS="${VIOLATIONS}${kt_file}:${line_num}: ${line_content}
"
  done < <(grep -nE "$COMPILE_FAIL_RE" "$kt_file" 2>/dev/null || true)
done <<< "$STAGED_KT"

if [ -n "$VIOLATIONS" ]; then
  jq -n --arg reason "compile-fail-pre-commit: staged .kt files contain error() patterns that cause compile failures. Fix or remove before committing:
${VIOLATIONS}" \
    '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: $reason
      }
    }'
  exit 0
fi

# Clean -- allow
exit 0
