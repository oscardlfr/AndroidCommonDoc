#!/usr/bin/env bash
# Generate all AI tool files from canonical SKILL.md definitions.
# Runs each adapter independently -- adding a new adapter is just adding a call here.
#
# NOTE: Claude adapter is deprecated (Claude Code reads skills/*/SKILL.md directly).
# Only Copilot adapters remain active.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== AndroidCommonDoc Adapter Pipeline ==="
echo ""

echo "Skipping Claude adapter (deprecated -- Claude Code reads skills directly)"
echo ""

echo "Generating Copilot prompts..."
bash "$SCRIPT_DIR/copilot-adapter.sh"
echo ""

echo "Generating Copilot instructions..."
bash "$SCRIPT_DIR/copilot-instructions-adapter.sh"
echo ""

echo "Generating Copilot instructions from CLAUDE.md..."
bash "$SCRIPT_DIR/claude-md-copilot-adapter.sh"
echo ""

echo "Generating Copilot agent templates..."
bash "$SCRIPT_DIR/copilot-agent-adapter.sh"
echo ""

echo "Done. Generated files are in setup/copilot-templates/ and setup/copilot-agent-templates/"
