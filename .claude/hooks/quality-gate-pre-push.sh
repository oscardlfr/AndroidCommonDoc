#!/bin/bash
# PreToolUse hook on Bash -- intercepts git push to verify quality-gate stamp is fresh and PASS.
# Reads .androidcommondoc/quality-gate.stamp (JSON). Blocks if missing, expired (>30 min), or FAIL.
# On stale stamp: emits clear error instructing how to refresh. Does NOT auto-run quality gate.
# All non-JSON output goes to stderr. Only valid JSON (or nothing) goes to stdout.
set -euo pipefail

# Read PreToolUse JSON from stdin
INPUT=$(cat)

# Extract command from tool input
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty') || exit 0
if [ -z "$COMMAND" ]; then
  exit 0
fi

# Only intercept git push commands
[[ "$COMMAND" =~ git\ push ]] || exit 0

# Determine project root
COMMON_DOC="${ANDROID_COMMON_DOC:-}"
if [ -z "$COMMON_DOC" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  COMMON_DOC="$(cd "$SCRIPT_DIR/../.." && pwd)"
fi

STAMP_FILE="$COMMON_DOC/.androidcommondoc/quality-gate.stamp"

# --- Check 1: stamp exists ---
if [ ! -f "$STAMP_FILE" ]; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Stamp stale or missing. Run /quality-gate to refresh, then re-push."
    }
  }'
  exit 0
fi

STAMP_CONTENT=$(cat "$STAMP_FILE" 2>/dev/null || true)

# --- Check 2: valid JSON ---
if ! echo "$STAMP_CONTENT" | jq empty 2>/dev/null; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Stamp stale or missing. Run /quality-gate to refresh, then re-push."
    }
  }'
  exit 0
fi

# --- Check 3: verdict is PASS ---
VERDICT=$(echo "$STAMP_CONTENT" | jq -r '.verdict // empty')
if [ "$VERDICT" != "PASS" ]; then
  jq -n --arg reason "Quality-gate stamp verdict is '${VERDICT}', not PASS. Run /quality-gate to refresh, then re-push." \
    '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: $reason
      }
    }'
  exit 0
fi

# --- Check 4: timestamp freshness (<=30 minutes) ---
TIMESTAMP=$(echo "$STAMP_CONTENT" | jq -r '.timestamp // empty')
if [ -z "$TIMESTAMP" ]; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Stamp stale or missing. Run /quality-gate to refresh, then re-push."
    }
  }'
  exit 0
fi

# Parse timestamp to epoch seconds
STAMP_EPOCH=$(date -d "$TIMESTAMP" +%s 2>/dev/null || date -jf "%Y-%m-%dT%H:%M:%SZ" "$TIMESTAMP" +%s 2>/dev/null || echo "0")
NOW_EPOCH=$(date +%s)
AGE_SECONDS=$(( NOW_EPOCH - STAMP_EPOCH ))
MAX_AGE_SECONDS=1800  # 30 minutes

if [ "$AGE_SECONDS" -gt "$MAX_AGE_SECONDS" ]; then
  AGE_MINUTES=$(( AGE_SECONDS / 60 ))
  jq -n --arg reason "Stamp stale or missing. Run /quality-gate to refresh, then re-push. (Stamp is ${AGE_MINUTES} min old.)" \
    '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: $reason
      }
    }'
  exit 0
fi

# --- All checks passed: allow with context ---
STEPS=$(echo "$STAMP_CONTENT" | jq -r '.steps_passed // "unknown"')
jq -n --arg ctx "Quality gate PASS (${STEPS} steps, ${AGE_SECONDS}s ago at ${TIMESTAMP})." \
  '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      additionalContext: $ctx
    }
  }'

exit 0
