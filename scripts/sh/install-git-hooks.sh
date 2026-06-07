#!/bin/bash
# Install git hooks for local development.
# These replicate the Claude Code PostToolUse/PreToolUse enforcement
# for developers using terminal or IDE git directly.
#
# Usage: bash scripts/sh/install-git-hooks.sh

set -euo pipefail

HOOKS_DIR=".git/hooks"

echo "Installing git hooks..."

# Pre-commit: registry hash gate + pattern-lint (sourced from pre-commit-hook.sh)
cp "scripts/sh/pre-commit-hook.sh" "$HOOKS_DIR/pre-commit"
chmod +x "$HOOKS_DIR/pre-commit"

# Commit-msg: validate Conventional Commits format + scope whitelist
# Uses the versioned script (DRY + testable) rather than an inline heredoc.
cp "scripts/sh/commit-msg-hook.sh" "$HOOKS_DIR/commit-msg"
chmod +x "$HOOKS_DIR/commit-msg"

echo "Installed: pre-commit (registry-rehash, manifest-drift), commit-msg (format + scope whitelist)"
echo "   To uninstall: rm .git/hooks/pre-commit .git/hooks/commit-msg"
