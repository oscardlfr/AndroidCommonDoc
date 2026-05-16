#!/usr/bin/env bash
# agentskills-validate.sh — local parity for agentskills-pilot.yml CI step
# Runs skills-ref validate for every skills/*/ dir. Exit 0 always (WARN-only, Fase A).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SKILLS_DIR="$REPO_ROOT/skills"

if [ ! -d "$SKILLS_DIR" ]; then
  echo "ERROR: skills/ directory not found at $SKILLS_DIR" >&2
  exit 0
fi

PASS=0
FAIL=0

for skill_dir in "$SKILLS_DIR"/*/; do
  skill_name="$(basename "$skill_dir")"
  output="$(uvx --from "git+https://github.com/agentskills/agentskills#subdirectory=skills-ref" skills-ref validate "$skill_dir" 2>&1)"
  exit_code=$?
  if [ "$exit_code" -eq 0 ]; then
    PASS=$((PASS + 1))
    echo "  PASS  $skill_name"
  else
    FAIL=$((FAIL + 1))
    echo "  WARN  $skill_name"
    echo "$output" | sed 's/^/        /'
  fi
done

TOTAL=$((PASS + FAIL))
echo ""
echo "Summary: $PASS/$TOTAL skills pass agentskills.io spec validation."
if [ "$FAIL" -gt 0 ]; then
  echo "Failures are advisory only (Fase A). See docs/skills/agentskills-pilot.md for context."
fi

exit 0
