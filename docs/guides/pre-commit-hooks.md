---
scope: [git, hooks, pre-commit, registry, rehash]
sources: [androidcommondoc]
targets: [android, desktop, ios, jvm]
slug: pre-commit-hooks
status: active
layer: L0
category: guides
description: "Pre-commit hooks: pattern-lint on staged Kotlin files, registry rehash check on staged SKILL.md/registry.json"
version: 1
last_updated: "2026-04"
---

# Pre-Commit Hooks Guide

Git hooks enforce local quality gates before a commit reaches CI. This guide covers installation and the registry hash gate introduced in Wave 21.

## Overview

Two hooks are managed by `scripts/sh/install-git-hooks.sh`:

| Hook | Script | Purpose |
|------|--------|---------|
| `pre-commit` | `scripts/sh/pre-commit-hook.sh` | Block commits with a stale registry hash |
| `commit-msg` | inline heredoc | Enforce Conventional Commits format |

## Installation

Run from the repository root:

```bash
bash scripts/sh/install-git-hooks.sh
```

This copies `scripts/sh/pre-commit-hook.sh` into `.git/hooks/pre-commit` and sets the commit-msg hook.

To verify hooks are installed:

```bash
ls -la .git/hooks/pre-commit .git/hooks/commit-msg
```

## The Registry Hash Gate

Every `skills/*/SKILL.md` and `skills/registry.json` file has a SHA-256 hash recorded in `skills/registry.json`. When either file is staged for commit, the hook validates that the recorded hash is current.

### How it works

1. Hook reads staged file list via `git diff --cached --name-only`
2. If no `skills/*/SKILL.md` or `skills/registry.json` is staged → exit 0 (no-op)
3. If a registry file is staged → runs `bash scripts/sh/rehash-registry.sh --check`
4. If hash is fresh → exit 0, commit proceeds
5. If hash is stale → exit 1, commit blocked with `[REHASH]` error message

### Normal commit flow (no SKILL.md staged)

```
$ git commit -m "feat(core): add new util"
[main abc1234] feat(core): add new util
```

### Commit blocked (stale hash)

```
$ git add skills/my-skill/SKILL.md skills/registry.json
$ git commit -m "docs(skills): update my-skill description"

[REHASH] Registry hash stale.
[REHASH] Run: node mcp-server/build/cli/generate-registry.js && bash scripts/sh/rehash-registry.sh --project-root "$(pwd)"
[REHASH] Then re-stage skills/registry.json and retry commit.
```

### Fixing a stale hash

```bash
# 1. Regenerate the registry
node mcp-server/build/cli/generate-registry.js

# 2. Update the hashes
bash scripts/sh/rehash-registry.sh --project-root "$(pwd)"

# 3. Verify the hash is clean
bash scripts/sh/rehash-registry.sh --project-root "$(pwd)" --check

# 4. Re-stage registry.json and commit
git add skills/registry.json
git commit -m "docs(skills): update my-skill description"
```

See `scripts/sh/rehash-registry.sh` for hash algorithm details.

## `--verbose` flag

To see hook decision logging on stderr:

```bash
VERBOSE=1 git commit -m "feat: something"
# or
bash scripts/sh/pre-commit-hook.sh --verbose
```

Verbose output uses the `[pre-commit-hook]` prefix and goes to stderr only — it does not affect commit output.

## Bypassing the hook

Use `--no-verify` only for emergency commits when you cannot regenerate the registry (e.g., mcp-server build is broken):

```bash
git commit --no-verify -m "chore: emergency fix"
```

**Warning**: bypassing leaves the registry stale. You MUST run the rehash sequence and commit `registry.json` in a follow-up commit immediately after.

## Troubleshooting

**Hook not running after clone**

Hooks are not versioned by git. Re-run installation:

```bash
bash scripts/sh/install-git-hooks.sh
```

**`rehash-registry.sh: not found`**

Run from the repository root, not a subdirectory. The hook resolves paths relative to `PROJECT_ROOT` (defaults to `pwd`).

**`node mcp-server/build/cli/generate-registry.js` fails**

The MCP server CLI must be built first:

```bash
cd mcp-server && npm install && npm run build
```

**Hash still stale after rehash**

Confirm `skills/registry.json` is staged after the rehash step — the hook reads staged content, not working-tree content.
