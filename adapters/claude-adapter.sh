#!/usr/bin/env bash
# DEPRECATED: Claude Code reads skills/*/SKILL.md directly since 2026-03-15.
# This script is retained only for historical reference.
#
# Previously: Generated .claude/commands/*.md from skills/*/SKILL.md
# Now: Claude Code discovers skills natively -- no intermediate command
# generation needed. The 16 generated commands were removed in Phase 14.3
# Plan 04 (adapter simplification).
#
# The Copilot adapters (copilot-adapter.sh, copilot-instructions-adapter.sh)
# remain active for enterprise Microsoft support.

echo "DEPRECATED: Claude Code reads skills/*/SKILL.md directly."
echo "No command generation needed. See skills/ directory."
echo ""
echo "For Copilot adapters, run:"
echo "  bash adapters/copilot-adapter.sh"
echo "  bash adapters/copilot-instructions-adapter.sh"
exit 0
