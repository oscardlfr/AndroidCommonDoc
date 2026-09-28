#!/usr/bin/env bash
# Generate all AI tool files from canonical SKILL.md definitions.
# Runs each adapter independently -- adding a new adapter is just adding a call here.
#
# Usage:
#   generate-all.sh          Regenerate tracked adapter outputs in place.
#   generate-all.sh --check  Regenerate in an isolated temporary tree and fail
#                            if the tracked outputs differ. Never mutates source.
#
# NOTE: Claude adapter is deprecated (Claude Code reads skills/*/SKILL.md directly).
# Only Copilot adapters remain active.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

CHECK=false
if [[ $# -gt 1 ]]; then
  echo "Usage: $0 [--check]" >&2
  exit 64
fi
if [[ $# -eq 1 ]]; then
  if [[ "$1" != "--check" ]]; then
    echo "Unknown option: $1" >&2
    echo "Usage: $0 [--check]" >&2
    exit 64
  fi
  CHECK=true
fi

if [[ "$CHECK" == true ]]; then
  CHECK_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/androidcommondoc-adapter-check.XXXXXX")"
  trap 'rm -rf -- "$CHECK_ROOT"' EXIT HUP INT TERM
  STAGED_ROOT="$CHECK_ROOT/repo"
  mkdir -p "$STAGED_ROOT/setup"

  # Copy only canonical inputs, adapter programs, and the two generated trees.
  # The real checkout is never an output target in check mode.
  cp -R "$REPO_ROOT/adapters" "$STAGED_ROOT/adapters"
  cp -R "$REPO_ROOT/skills" "$STAGED_ROOT/skills"
  cp -R "$REPO_ROOT/docs" "$STAGED_ROOT/docs"
  cp -R "$REPO_ROOT/setup/agent-templates" "$STAGED_ROOT/setup/agent-templates"
  cp -R "$REPO_ROOT/setup/copilot-templates" "$STAGED_ROOT/setup/copilot-templates"
  cp -R "$REPO_ROOT/setup/copilot-agent-templates" "$STAGED_ROOT/setup/copilot-agent-templates"
  cp "$REPO_ROOT/AGENTS.md" "$STAGED_ROOT/AGENTS.md"
  cp "$REPO_ROOT/CLAUDE.md" "$STAGED_ROOT/CLAUDE.md"

  CHECK_LOG="$CHECK_ROOT/generate.log"
  # Regenerate every repository-deterministic adapter output. Generated files
  # must depend only on checked-in inputs, never on a maintainer's home folder.
  if ! {
    bash "$STAGED_ROOT/adapters/copilot-adapter.sh" --project-root "$STAGED_ROOT" --clean
    bash "$STAGED_ROOT/adapters/copilot-instructions-adapter.sh"
    bash "$STAGED_ROOT/adapters/claude-md-copilot-adapter.sh"
    bash "$STAGED_ROOT/adapters/copilot-agent-adapter.sh" --l0-root "$STAGED_ROOT"
  } >"$CHECK_LOG" 2>&1; then
    cat "$CHECK_LOG" >&2
    echo "Adapter check failed: staged generation did not complete." >&2
    exit 1
  fi

  drift=0
  if ! diff -qr "$REPO_ROOT/setup/copilot-templates" "$STAGED_ROOT/setup/copilot-templates"; then
    drift=1
  fi
  if ! diff -qr "$REPO_ROOT/setup/copilot-agent-templates" "$STAGED_ROOT/setup/copilot-agent-templates"; then
    drift=1
  fi
  if [[ "$drift" -ne 0 ]]; then
    echo "Adapter drift detected. Run: bash adapters/generate-all.sh" >&2
    exit 1
  fi

  echo "Adapter check passed: generated outputs are current."
  exit 0
fi

echo "=== AndroidCommonDoc Adapter Pipeline ==="
echo ""

echo "Skipping Claude adapter (deprecated -- Claude Code reads skills directly)"
echo ""

echo "Generating Copilot prompts..."
bash "$SCRIPT_DIR/copilot-adapter.sh" --clean
echo ""

echo "Generating Copilot instructions..."
bash "$SCRIPT_DIR/copilot-instructions-adapter.sh"
echo ""

echo "Generating Copilot instructions from portable agent contract..."
bash "$SCRIPT_DIR/claude-md-copilot-adapter.sh"
echo ""

echo "Generating Copilot agent templates..."
bash "$SCRIPT_DIR/copilot-agent-adapter.sh"
echo ""

echo "Done. Generated files are in setup/copilot-templates/ and setup/copilot-agent-templates/"
