#!/bin/bash
# PreToolUse hook on Bash -- intercepts git commit commands to validate staged Kotlin files.
# Supports configurable severity via ANDROID_COMMON_DOC_MODE env var (block|warn).
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

echo "Found staged Kotlin files for pre-commit check" >&2

# Determine AndroidCommonDoc location
COMMON_DOC="${ANDROID_COMMON_DOC:-}"
if [ -z "$COMMON_DOC" ]; then
  # Resolve from script location: .claude/hooks/ -> repo root
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  COMMON_DOC="$(cd "$SCRIPT_DIR/../.." && pwd)"
fi

# Verify custom rules JAR exists
RULES_JAR="$COMMON_DOC/detekt-rules/build/libs/detekt-rules-1.0.0.jar"
if [ ! -f "$RULES_JAR" ]; then
  echo "Rules JAR not found at $RULES_JAR -- skipping pre-commit check" >&2
  exit 0
fi

# Verify config exists
CONFIG="$COMMON_DOC/detekt-rules/src/main/resources/config/config.yml"
if [ ! -f "$CONFIG" ]; then
  echo "Detekt config not found at $CONFIG -- skipping pre-commit check" >&2
  exit 0
fi

# Resolve Detekt CLI JAR (same caching logic as post-write hook)
CACHE_DIR="$COMMON_DOC/.cache"
DETEKT_CLI_VERSION="2.0.0-alpha.2"
DETEKT_CLI_JAR=""

if [ -f "$COMMON_DOC/detekt-rules/build/libs/detekt-cli-${DETEKT_CLI_VERSION}-all.jar" ]; then
  DETEKT_CLI_JAR="$COMMON_DOC/detekt-rules/build/libs/detekt-cli-${DETEKT_CLI_VERSION}-all.jar"
elif [ -f "$CACHE_DIR/detekt-cli-${DETEKT_CLI_VERSION}-all.jar" ]; then
  DETEKT_CLI_JAR="$CACHE_DIR/detekt-cli-${DETEKT_CLI_VERSION}-all.jar"
else
  mkdir -p "$CACHE_DIR" 2>/dev/null || true
  MAVEN_URL="https://repo1.maven.org/maven2/dev/detekt/detekt-cli/${DETEKT_CLI_VERSION}/detekt-cli-${DETEKT_CLI_VERSION}-all.jar"
  echo "Downloading Detekt CLI from $MAVEN_URL ..." >&2
  if curl -fsSL -o "$CACHE_DIR/detekt-cli-${DETEKT_CLI_VERSION}-all.jar" "$MAVEN_URL" 2>/dev/null; then
    DETEKT_CLI_JAR="$CACHE_DIR/detekt-cli-${DETEKT_CLI_VERSION}-all.jar"
    echo "Detekt CLI downloaded to $DETEKT_CLI_JAR" >&2
  else
    echo "Could not download Detekt CLI -- skipping pre-commit check" >&2
    rm -f "$CACHE_DIR/detekt-cli-${DETEKT_CLI_VERSION}-all.jar" 2>/dev/null
    exit 0
  fi
fi

# Configurable severity: block (default) or warn
MODE="${ANDROID_COMMON_DOC_MODE:-block}"

# Build comma-separated file list for Detekt --input
FILE_LIST=$(echo "$STAGED_KT" | tr '\n' ',' | sed 's/,$//')
echo "Running Detekt on staged files: $FILE_LIST" >&2

# Run Detekt CLI on all staged Kotlin files
DETEKT_RESULT=""
DETEKT_EXIT=0
DETEKT_RESULT=$(java -jar "$DETEKT_CLI_JAR" \
  --input "$FILE_LIST" \
  --config "$CONFIG" \
  --plugins "$RULES_JAR" \
  2>&1) || DETEKT_EXIT=$?

if [ "$DETEKT_EXIT" -ne 0 ] && [ -n "$DETEKT_RESULT" ]; then
  if [ "$MODE" = "block" ]; then
    # Block mode: deny the commit
    jq -n --arg reason "Pattern violations in staged Kotlin files. Fix these before committing:
$DETEKT_RESULT" \
      '{
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: $reason
        }
      }'
  else
    # Warn mode: allow the commit but attach warning context
    jq -n --arg ctx "WARNING: Pattern violations found in staged Kotlin files (warn-only mode):
$DETEKT_RESULT" \
      '{
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          additionalContext: $ctx
        }
      }'
  fi
  exit 0
fi

# Clean -- no output means allow
exit 0
