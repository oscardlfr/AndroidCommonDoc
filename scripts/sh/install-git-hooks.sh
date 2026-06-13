#!/bin/bash
# Install git hooks for local development.
# These replicate the Claude Code PostToolUse/PreToolUse enforcement
# for developers using terminal or IDE git directly.
#
# Usage:
#   bash scripts/sh/install-git-hooks.sh            # install into current repo (.git/hooks/)
#   bash scripts/sh/install-git-hooks.sh /path/repo # install into target repo (P1b: CWD-robust)
#
# The optional $1 arg allows bats tests to pass a tmp repo dir without cd-ing into it.
# Source scripts are always resolved relative to this script's own directory, so the
# script works from any CWD.

set -euo pipefail

# Resolve source script directory (CWD-independent).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Optional target repo dir (default: current directory).
TARGET_REPO="${1:-.}"
HOOKS_DIR="$TARGET_REPO/.git/hooks"

echo "Installing git hooks..."

# Pre-commit: registry hash gate + pattern-lint (sourced from pre-commit-hook.sh)
cp "$SCRIPT_DIR/pre-commit-hook.sh" "$HOOKS_DIR/pre-commit"
chmod +x "$HOOKS_DIR/pre-commit"

# Commit-msg: validate Conventional Commits format + scope whitelist
# Uses the versioned script (DRY + testable) rather than an inline heredoc.
cp "$SCRIPT_DIR/commit-msg-hook.sh" "$HOOKS_DIR/commit-msg"
chmod +x "$HOOKS_DIR/commit-msg"

# Pre-push: two-stamp gate (quality-gate.stamp + pre-pr.stamp, <=30 min, sha match).
# Git-layer backstop below Claude hooks — fires for every push incl. rtk git push.
# ACDOC-PRE-PUSH-GATE marker in pre-push-hook.sh is detected by push-authorization-gate.js.
cp "$SCRIPT_DIR/pre-push-hook.sh" "$HOOKS_DIR/pre-push"
chmod +x "$HOOKS_DIR/pre-push"

echo "Installed: pre-commit (registry-rehash, manifest-drift), commit-msg (format + scope whitelist), pre-push (two-stamp gate)"
echo "   To uninstall: rm $HOOKS_DIR/pre-commit $HOOKS_DIR/commit-msg $HOOKS_DIR/pre-push"
