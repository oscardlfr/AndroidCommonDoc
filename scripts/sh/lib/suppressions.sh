#!/usr/bin/env bash
# suppressions.sh — Read and check audit suppressions
#
# Suppressions file: <project>/.androidcommondoc/audit-suppressions.jsonl
#
# Format (one JSON object per line):
#   {"dedupe_key":"pattern","reason":"why","suppressed_by":"who","suppressed_at":"ISO-8601","expires":"ISO-8601 or never"}
#
# dedupe_key supports prefix matching: "readme-audit:count:*" matches any count finding.
# Use exact key for specific suppressions: "pattern-lint:cancellation-rethrow:core/data/SomeRepo.kt:42"
#
# Usage:
#   source "$SCRIPT_DIR/lib/suppressions.sh"
#   if is_suppressed "$PROJECT_ROOT" "readme-audit:count:MCP tools"; then
#     echo "suppressed"
#   fi
#
# Also: load_suppressions "$PROJECT_ROOT" (preloads for batch checking)

_SUPPRESSIONS_LOADED=""
_SUPPRESSIONS_KEYS=()
_SUPPRESSIONS_PATTERNS=()

# Load suppressions file into memory for fast batch checking.
# Call once, then use is_suppressed_fast for each check.
load_suppressions() {
  local project_root="$1"
  local file="$project_root/.androidcommondoc/audit-suppressions.jsonl"
  
  _SUPPRESSIONS_KEYS=()
  _SUPPRESSIONS_PATTERNS=()
  _SUPPRESSIONS_LOADED="$file"
  
  [ -f "$file" ] || return 0
  
  local now_epoch
  now_epoch=$(date +%s 2>/dev/null || echo "0")
  
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    # Skip comments (lines starting with //)
    [[ "$line" == //* ]] && continue
    
    # Extract dedupe_key and expires using lightweight parsing
    local key expires
    key=$(echo "$line" | grep -oE '"dedupe_key"\s*:\s*"[^"]*"' | sed 's/"dedupe_key"\s*:\s*"//;s/"$//')
    expires=$(echo "$line" | grep -oE '"expires"\s*:\s*"[^"]*"' | sed 's/"expires"\s*:\s*"//;s/"$//')
    
    [ -z "$key" ] && continue
    
    # Check expiry
    if [ -n "$expires" ] && [ "$expires" != "never" ]; then
      local exp_epoch
      exp_epoch=$(date -d "$expires" +%s 2>/dev/null || date -jf "%Y-%m-%dT%H:%M:%SZ" "$expires" +%s 2>/dev/null || echo "0")
      [ "$exp_epoch" -gt 0 ] && [ "$now_epoch" -gt "$exp_epoch" ] && continue
    fi
    
    # Store: if key ends with *, it's a pattern; otherwise exact match
    if [[ "$key" == *"*" ]]; then
      _SUPPRESSIONS_PATTERNS+=("${key%\*}")
    else
      _SUPPRESSIONS_KEYS+=("$key")
    fi
  done < "$file"
}

# Check if a dedupe_key is suppressed. Loads file on first call.
is_suppressed() {
  local project_root="$1"
  local dedupe_key="$2"
  
  # Lazy load
  if [ "$_SUPPRESSIONS_LOADED" != "$project_root/.androidcommondoc/audit-suppressions.jsonl" ]; then
    load_suppressions "$project_root"
  fi
  
  # Exact match
  for key in "${_SUPPRESSIONS_KEYS[@]}"; do
    [ "$key" = "$dedupe_key" ] && return 0
  done
  
  # Prefix match (pattern)
  for prefix in "${_SUPPRESSIONS_PATTERNS[@]}"; do
    [[ "$dedupe_key" == "$prefix"* ]] && return 0
  done
  
  return 1
}
