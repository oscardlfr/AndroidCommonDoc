# Deferred Items - Phase 05

## Pre-existing: install-copilot-prompts.sh ((INSTALLED++)) exits under set -e

- **Found during:** 05-01 Task 2 verification
- **Issue:** `((INSTALLED++))` when INSTALLED=0 returns exit code 1, which triggers `set -e` to abort the script. Affects dry-run mode for the first template in each project.
- **Scope:** Pre-existing bug, not caused by this task's changes.
- **Fix:** Replace `((INSTALLED++))` with `((INSTALLED++)) || true` throughout the script.
