#!/bin/bash
# Install git hooks for local development.
# These replicate the Claude Code PostToolUse/PreToolUse enforcement
# for developers using terminal or IDE git directly.
#
# Usage: bash scripts/sh/install-git-hooks.sh

set -euo pipefail

HOOKS_DIR=".git/hooks"

echo "Installing git hooks..."

# Pre-commit: run pattern-lint on staged .kt files
cat > "$HOOKS_DIR/pre-commit" << 'HOOK'
#!/bin/bash
# Auto-installed by install-git-hooks.sh
# Runs pattern-lint on staged Kotlin files

staged_kt=$(git diff --cached --name-only --diff-filter=ACM | grep '\.kt$' || true)
[ -z "$staged_kt" ] && exit 0

if [ -f "scripts/sh/pattern-lint.sh" ]; then
  bash scripts/sh/pattern-lint.sh --project-root "$(pwd)" 2>&1
  exit $?
fi
HOOK
chmod +x "$HOOKS_DIR/pre-commit"

# Commit-msg: validate conventional commits
cat > "$HOOKS_DIR/commit-msg" << 'HOOK'
#!/bin/bash
# Auto-installed by install-git-hooks.sh
# Validates commit message against Conventional Commits

msg=$(cat "$1")
pattern='^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?!?: .+'

if ! echo "$msg" | head -1 | grep -qE "$pattern"; then
  echo "❌ Commit message does not match Conventional Commits format."
  echo "   Expected: <type>(scope): description"
  echo "   Got: $(head -1 "$1")"
  exit 1
fi
HOOK
chmod +x "$HOOKS_DIR/commit-msg"

echo "✅ Installed: pre-commit (pattern-lint), commit-msg (conventional commits)"
echo "   To uninstall: rm .git/hooks/pre-commit .git/hooks/commit-msg"
