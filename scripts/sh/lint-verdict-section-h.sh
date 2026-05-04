#!/usr/bin/env bash
set -euo pipefail

# lint-verdict-section-h.sh -- validate arch-platform verdict Section H authoring rules.
#
# Rule 1: if section G contains a template_version bump, section H MUST include BOTH
#         .claude/registry/agents.manifest.yaml AND skills/registry.json as literal paths.
# Rule 2: section H entries must be literal filesystem paths (no angle-bracket placeholders).
#
# Usage: lint-verdict-section-h.sh <verdict-file>
# Exit: 0 = valid, 1 = violation(s) found

verdict_file="${1:-}"

if [[ -z "$verdict_file" ]]; then
  echo "Usage: $0 <verdict-file>" >&2
  exit 1
fi

if [[ ! -f "$verdict_file" ]]; then
  echo "ERROR: verdict file not found: $verdict_file" >&2
  exit 1
fi

content="$(cat "$verdict_file")"

# Extract section G and section H content
# Section G is between "## G." and "## H."
section_g="$(echo "$content" | sed -n '/^## G\./,/^## H\./p' | head -n -1)"
# Section H is between "## H." and "## I." (or end of file)
section_h="$(echo "$content" | sed -n '/^## H\./,/^## I\./p' | head -n -1)"

violations=0

# Rule 1: check for template_version bumps in section G
if echo "$section_g" | grep -q "template_version"; then
  # section G bumps at least one template_version — both registry files required in H
  if ! echo "$section_h" | grep -qF ".claude/registry/agents.manifest.yaml"; then
    echo "VIOLATION Rule 1: section G bumps template_version but section H is missing .claude/registry/agents.manifest.yaml" >&2
    violations=$((violations + 1))
  fi
  if ! echo "$section_h" | grep -qF "skills/registry.json"; then
    echo "VIOLATION Rule 1: section G bumps template_version but section H is missing skills/registry.json" >&2
    violations=$((violations + 1))
  fi
fi

# Rule 2: no angle-bracket placeholders in section H
if echo "$section_h" | grep -qE '<[^>]+>'; then
  echo "VIOLATION Rule 2: section H contains placeholder(s) — literal filesystem paths required" >&2
  violations=$((violations + 1))
fi

if [[ $violations -gt 0 ]]; then
  echo "lint-verdict-section-h: $violations violation(s) found" >&2
  exit 1
fi

echo "lint-verdict-section-h: OK"
exit 0
