#!/bin/bash
# PostToolUse hook for Write|Edit -- runs Detekt on written/edited Kotlin files.
# Returns blocking JSON decision if pattern violations are found.
# All non-JSON output goes to stderr. Only valid JSON (or nothing) goes to stdout.
set -euo pipefail

# Read PostToolUse JSON from stdin
INPUT=$(cat /dev/stdin)

# Extract file path from tool input
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty') || exit 0
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only check Kotlin files
[[ "$FILE_PATH" =~ \.kt$ ]] || exit 0

# Skip if file doesn't exist (deleted or moved)
[ -f "$FILE_PATH" ] || exit 0

# Skip files >500 lines to avoid hook timeout (Pitfall #4)
LINE_COUNT=$(wc -l < "$FILE_PATH" 2>/dev/null || echo "0")
if [ "$LINE_COUNT" -gt 500 ]; then
  echo "Skipping large file ($LINE_COUNT lines): $FILE_PATH" >&2
  exit 0
fi

# Determine AndroidCommonDoc location
COMMON_DOC="${ANDROID_COMMON_DOC:-}"
if [ -z "$COMMON_DOC" ]; then
  # Resolve from script location: .claude/hooks/ -> repo root
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  COMMON_DOC="$(cd "$SCRIPT_DIR/../.." && pwd)"
fi

# Verify custom rules JAR exists (if not built yet, don't block development)
RULES_JAR="$COMMON_DOC/detekt-rules/build/libs/detekt-rules-1.0.0.jar"
if [ ! -f "$RULES_JAR" ]; then
  echo "Rules JAR not found at $RULES_JAR -- skipping check" >&2
  exit 0
fi

# Verify config exists
CONFIG="$COMMON_DOC/detekt-rules/src/main/resources/config/config.yml"
if [ ! -f "$CONFIG" ]; then
  echo "Detekt config not found at $CONFIG -- skipping check" >&2
  exit 0
fi

# Resolve Detekt CLI JAR (the custom rules JAR is NOT the CLI)
CACHE_DIR="$COMMON_DOC/.cache"
DETEKT_CLI_VERSION="2.0.0-alpha.2"
DETEKT_CLI_JAR=""

# Check local build directory first
if [ -f "$COMMON_DOC/detekt-rules/build/libs/detekt-cli-${DETEKT_CLI_VERSION}-all.jar" ]; then
  DETEKT_CLI_JAR="$COMMON_DOC/detekt-rules/build/libs/detekt-cli-${DETEKT_CLI_VERSION}-all.jar"
# Check cache directory
elif [ -f "$CACHE_DIR/detekt-cli-${DETEKT_CLI_VERSION}-all.jar" ]; then
  DETEKT_CLI_JAR="$CACHE_DIR/detekt-cli-${DETEKT_CLI_VERSION}-all.jar"
else
  # Attempt to download from Maven Central
  mkdir -p "$CACHE_DIR" 2>/dev/null || true
  MAVEN_URL="https://repo1.maven.org/maven2/dev/detekt/detekt-cli/${DETEKT_CLI_VERSION}/detekt-cli-${DETEKT_CLI_VERSION}-all.jar"
  echo "Downloading Detekt CLI from $MAVEN_URL ..." >&2
  if curl -fsSL -o "$CACHE_DIR/detekt-cli-${DETEKT_CLI_VERSION}-all.jar" "$MAVEN_URL" 2>/dev/null; then
    DETEKT_CLI_JAR="$CACHE_DIR/detekt-cli-${DETEKT_CLI_VERSION}-all.jar"
    echo "Detekt CLI downloaded to $DETEKT_CLI_JAR" >&2
  else
    echo "Could not download Detekt CLI -- skipping check" >&2
    rm -f "$CACHE_DIR/detekt-cli-${DETEKT_CLI_VERSION}-all.jar" 2>/dev/null
    exit 0
  fi
fi

# Run Detekt CLI on the single file
echo "Running Detekt on $FILE_PATH ..." >&2
DETEKT_RESULT=""
DETEKT_EXIT=0
DETEKT_RESULT=$(java -jar "$DETEKT_CLI_JAR" \
  --input "$FILE_PATH" \
  --config "$CONFIG" \
  --plugins "$RULES_JAR" \
  2>&1) || DETEKT_EXIT=$?

if [ "$DETEKT_EXIT" -ne 0 ] && [ -n "$DETEKT_RESULT" ]; then
  # Emit blocking JSON decision -- only JSON to stdout
  jq -n --arg reason "AndroidCommonDoc pattern violations found. Fix these before proceeding:
$DETEKT_RESULT" \
    '{ decision: "block", reason: $reason }'
  exit 0
fi

# Clean -- no output means allow
exit 0
