#!/usr/bin/env bash
set -euo pipefail

# verdict-pre-execute-check.sh -- pre-execute lint for arch-platform verdict files.
#
# Runs 6 checks covering: cross-file pins, commit scope, gitignored paths,
# new-doc frontmatter, amendment enumeration, and cap escalation.
#
# Usage: verdict-pre-execute-check.sh <verdict-file>
# Exit: 0 = all pass, 1 = violation(s) found, 2 = arg/file error

verdict_file="${1:-}"

if [[ -z "$verdict_file" ]]; then
  echo "Usage: $0 <verdict-file>" >&2
  exit 2
fi

if [[ ! -f "$verdict_file" ]]; then
  echo "ERROR: verdict file not found: $verdict_file" >&2
  exit 2
fi

content="$(cat "$verdict_file")"

# Extract sections G and H — match both ## and ### header depths
section_g="$(echo "$content" | sed -n '/^#\{2,3\} G\./,/^#\{2,3\} H\./p' | head -n -1)"
section_h="$(echo "$content" | sed -n '/^#\{2,3\} H\./,/^#\{2,3\} I\./p' | head -n -1)"

violations=0

# ── Check 1: cross-file pins ──────────────────────────────────────────────
check_cross_file_pins() {
  if echo "$section_g" | grep -qE 'template_version.*->'; then
    if ! echo "$section_h" | grep -qF ".claude/registry/agents.manifest.yaml"; then
      echo "check_cross_file_pins: FAIL: section G bumps template_version but section H is missing .claude/registry/agents.manifest.yaml" >&2
      violations=$((violations + 1))
    else
      echo "check_cross_file_pins: PASS"
    fi
  else
    echo "check_cross_file_pins: PASS"
  fi
}

# ── Check 2: commit scope ─────────────────────────────────────────────────
check_commit_scope() {
  # Extract scope from conventional commit pattern (feat/fix/chore/docs/ci/refactor/test)
  local scope=""
  local commit_line=""
  commit_line="$(echo "$content" | grep -E '(feat|fix|chore|docs|ci|refactor|test)\([^)]+\):' | head -1 || true)"
  if [[ -z "$commit_line" ]]; then
    echo "check_commit_scope: PASS (no conventional commit subject found — no scope to validate)"
    return
  fi
  scope="$(echo "$commit_line" | sed -E 's/.*(feat|fix|chore|docs|ci|refactor|test)\(([^)]+)\):.*/\2/')"

  # Source whitelist from l0-ci.yml at runtime — no hardcoded list
  local whitelist_raw
  whitelist_raw="$(grep -E '^\s+valid_scopes:' .github/workflows/l0-ci.yml | head -1 | sed -E 's/.*"([^"]+)".*/\1/')"
  local found=0
  IFS=',' read -ra scopes <<< "$whitelist_raw"
  for s in "${scopes[@]}"; do
    if [[ "$s" == "$scope" ]]; then
      found=1
      break
    fi
  done
  if [[ $found -eq 0 ]]; then
    echo "check_commit_scope: FAIL: scope '($scope)' is not in commitlint whitelist: $whitelist_raw" >&2
    violations=$((violations + 1))
  else
    echo "check_commit_scope: PASS"
  fi
}

# ── Check 3: section H gitignored paths ──────────────────────────────────
check_section_h_gitignored() {
  local fail=0
  while IFS= read -r line; do
    # Match lines that look like filesystem paths (no leading spaces, contains a dot or slash)
    if [[ "$line" =~ ^[a-zA-Z0-9._/-]+\.[a-zA-Z]+ ]]; then
      # Strip any trailing whitespace
      local path="${line%%[[:space:]]*}"
      if git check-ignore --no-index -q "$path" 2>/dev/null; then
        echo "check_section_h_gitignored: FAIL: path '$path' in section H is gitignored" >&2
        violations=$((violations + 1))
        fail=1
      fi
    fi
  done <<< "$section_h"
  if [[ $fail -eq 0 ]]; then
    echo "check_section_h_gitignored: PASS"
  fi
}

# ── Check 4: new doc frontmatter ──────────────────────────────────────────
check_new_doc_frontmatter() {
  local fail=0
  local required_fields=("scope:" "sources:" "targets:" "slug:" "category:")
  while IFS= read -r line; do
    if [[ "$line" =~ ^docs/.*\.md$ ]]; then
      local doc_path="${line%%[[:space:]]*}"
      local missing_fields=()
      for field in "${required_fields[@]}"; do
        if ! echo "$content" | grep -qF "$field"; then
          missing_fields+=("$field")
        fi
      done
      if [[ ${#missing_fields[@]} -gt 0 ]]; then
        echo "check_new_doc_frontmatter: FAIL: '$doc_path' is missing frontmatter fields: ${missing_fields[*]}" >&2
        violations=$((violations + 1))
        fail=1
      fi
    fi
  done <<< "$section_h"
  if [[ $fail -eq 0 ]]; then
    echo "check_new_doc_frontmatter: PASS"
  fi
}

# ── Check 5: amendment count line ─────────────────────────────────────────
check_amendment_count() {
  if echo "$content" | grep -qiE 'Pending amendments:'; then
    echo "check_amendment_count: PASS"
  else
    echo "check_amendment_count: FAIL: no 'Pending amendments:' line found in verdict" >&2
    violations=$((violations + 1))
  fi
}

# ── Check 6: cap escalation ───────────────────────────────────────────────
check_cap_escalation() {
  if ! echo "$section_h" | grep -qE 'setup/agent-templates/.*\.md'; then
    echo "check_cap_escalation: PASS (no agent template in section H)"
    return
  fi

  # Agent template referenced — check pre_edit_lines and post_edit_estimate are present
  if ! echo "$content" | grep -qE 'pre_edit_lines:'; then
    echo "check_cap_escalation: FAIL: agent template in section H but 'pre_edit_lines:' missing" >&2
    violations=$((violations + 1))
    return
  fi
  if ! echo "$content" | grep -qE 'post_edit_estimate:'; then
    echo "check_cap_escalation: FAIL: agent template in section H but 'post_edit_estimate:' missing" >&2
    violations=$((violations + 1))
    return
  fi

  # Extract post_edit_estimate value
  local post_est
  post_est="$(echo "$content" | grep -E 'post_edit_estimate:' | head -1 | sed -E 's/.*post_edit_estimate:\s*([0-9]+).*/\1/')"

  if [[ -z "$post_est" || ! "$post_est" =~ ^[0-9]+$ ]]; then
    echo "check_cap_escalation: PASS (post_edit_estimate value not a plain integer — skipping threshold check)"
    return
  fi

  if [[ $post_est -ge 391 ]]; then
    if ! echo "$content" | grep -qE 'requires_extraction:\s*true'; then
      echo "check_cap_escalation: FAIL: post_edit_estimate=$post_est (>=391) but 'requires_extraction: true' is absent" >&2
      violations=$((violations + 1))
      return
    fi
  fi
  echo "check_cap_escalation: PASS"
}

# ── Run all checks ────────────────────────────────────────────────────────
check_cross_file_pins
check_commit_scope
check_section_h_gitignored
check_new_doc_frontmatter
check_amendment_count
check_cap_escalation

# ── Final summary ─────────────────────────────────────────────────────────
if [[ $violations -gt 0 ]]; then
  echo "verdict-pre-execute-check: $violations violation(s)" >&2
  exit 1
fi

echo "verdict-pre-execute-check: OK"
exit 0
