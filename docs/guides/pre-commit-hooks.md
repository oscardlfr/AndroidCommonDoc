---
scope: [git, hooks, pre-commit, registry, rehash, commit-scope]
sources: [androidcommondoc]
targets: [android, desktop, ios, jvm]
slug: pre-commit-hooks
status: active
layer: L0
category: guides
description: "Git hooks: registry rehash + manifest drift on commit, Conventional Commits scope whitelist, two-stamp + QG-proof push gate (fail-closed), clone-bootstrap verification"
version: 4
last_updated: "2026-07-11"
---

# Pre-Commit Hooks Guide

Git hooks enforce local quality gates before a commit reaches CI.

## Overview

Three hooks are managed by `scripts/sh/install-git-hooks.sh`:

| Hook | Script | Purpose |
|------|--------|---------|
| `pre-commit` | `scripts/sh/pre-commit-hook.sh` | Block commits with a stale registry hash |
| `commit-msg` | `scripts/sh/commit-msg-hook.sh` | Enforce Conventional Commits format + scope whitelist |
| `pre-push` | `scripts/sh/pre-push-hook.sh` | Fail-CLOSED push gate: (1) two-stamp validation — quality-gate.stamp + pre-pr.stamp PASS, ≤30 min, matching the pushed commit; (2) QG-proof verification — `emit-push-proof.sh --subcommand verify-proof --pushed-sha $sha` checks push-proof.json schema, HEAD match, freshness, manifest-version, step coverage, and report digest. Missing proof or absent verifier → BLOCK (no fallback path). Bypass: `SKIP_PUSH_GATE=1` (explicit user authorization only — logged to push-proof.log). See [qg-proof-push-gate](../agents/qg-proof-push-gate.md) |

> **Hooks are not versioned by git.** `git clone` never copies `.git/hooks/` content — every fresh clone starts with NO hooks installed. Run `bash scripts/sh/install-git-hooks.sh` (or `make install-git-hooks`) once per clone; verify with `bash scripts/sh/verify-git-hooks.sh` (or `make verify-git-hooks`), which confirms the pre-push hook is installed, executable, and byte-identical (CRLF-normalized) to the canonical `scripts/sh/pre-push-hook.sh` source. See [Troubleshooting](#troubleshooting) below.

### Push Gate: 3-Layer Authoritative Table

Same layering discipline as the [commit-scope table](#three-layer-commit-scope-enforcement) below (wave `push-authority-bootstrap`):

| Layer | Mechanism | Coverage | Authoritative? |
|-------|-----------|----------|----------------|
| **PreToolUse** `push-authorization-gate.js` | Claude Code hook — fires on `git push`-shaped Bash calls | Claude-only; best-effort command-string detection (known evasion class stays open — see `BACKLOG.md`'s CRITICAL entry) | No — for the main orchestrator it delegates to `verify-git-hooks.sh`; peers/subagents are hard-blocked outright |
| **git `pre-push`** `pre-push-hook.sh` | Git hook — fires for every push in the clone | Universal for the clone, but only **once installed** (git never auto-installs hooks) | **Yes, once installed** — reads real git refs, cannot be evaded by command spelling |
| **CI / branch protection** | GitHub Actions + branch rules | All PRs, all pushers | Backstop |

**Bootstrap note**: a fresh, never-bootstrapped clone has no git-layer gate at all. Wave `push-authority-bootstrap` (H1) closes the practical gap this leaves: the QG mint (`emit-push-proof.sh run-qg`) and any Claude push the JS gate actually detects both now fail closed if `verify-git-hooks.sh` reports the hook absent, non-executable, unmarked, or drifted. See [qg-proof-push-gate](../agents/qg-proof-push-gate.md) for the full mechanism.

## Installation

Run from the repository root:

```bash
bash scripts/sh/install-git-hooks.sh
```

Or via Make (L0 self-bootstrap): `make install-git-hooks`.

This copies `scripts/sh/pre-commit-hook.sh` into `.git/hooks/pre-commit`, installs `scripts/sh/commit-msg-hook.sh` as `.git/hooks/commit-msg`, installs `scripts/sh/pre-push-hook.sh` as `.git/hooks/pre-push`, and installs the shared slug resolver at `.git/hooks/lib/wave-slug.sh` for the pre-commit wave-class gate. Hook resolution honors `core.hooksPath` and worktrees (via `git rev-parse --git-path hooks`) rather than a hardcoded `.git/hooks/`.

To verify hooks are installed:

```bash
ls -la .git/hooks/pre-commit .git/hooks/commit-msg .git/hooks/pre-push .git/hooks/lib/wave-slug.sh
```

Or, specifically for the pre-push hook's install-and-canonical state: `bash scripts/sh/verify-git-hooks.sh` (or `make verify-git-hooks`) — on success, exits 0 and writes an `OK:` confirmation to stderr (stdout stays empty); on failure, exits non-zero and prints one of 5 reason codes (`canonical-source-missing`, `hook-absent`, `hook-not-executable`, `hook-marker-missing`, `hook-drifted`) to stdout plus a fix instruction to stderr.

## Three-Layer Commit-Scope Enforcement

Valid commit scopes are defined once in `.commitlintrc.json` (`valid_scopes` field). Three layers enforce this:

| Layer | Mechanism | Coverage | Authoritative? |
|-------|-----------|----------|----------------|
| **PreToolUse** `commit-scope-validation-gate.js` | Claude Code hook — fires on `git commit` tool calls | **Main orchestrator only** — does NOT cover team peers or direct `git` CLI usage | No |
| **git `commit-msg`** `commit-msg-hook.sh` | Git hook — fires for every `git commit` in the clone | **Universal** — all committers, all branches, all tools | **Yes** |
| **CI** `reusable-commit-lint.yml` | Workflow — runs on every PR | All branches, PR-time backstop | Backstop |

> **Known limitation of the PreToolUse hook**: `commit-scope-validation-gate.js` only intercepts commits made by the main orchestrator agent. Team peers that commit directly bypass it. The git `commit-msg` hook closes this gap — it fires universally regardless of who or what triggers the commit.

### What `commit-msg-hook.sh` validates

1. **Format**: first line matches `type(scope)?!?: description` (Conventional Commits). Merge commits skip all checks.
2. **Scope whitelist** (if scope present): scope must appear in `valid_scopes` from `.commitlintrc.json`. Compound scopes (e.g. `core-error-sdk`) pass if the first segment (`core`) is valid — matches `commit-scope-validation-gate.js` semantics exactly.
3. **Fail-open**: missing/malformed `.commitlintrc.json`, or no scope in message → passes through.

### Example: blocked commit

```
$ git commit -m "docs(invalid-scope): update"
[commit-msg-hook] BLOCKED: scope "(invalid-scope)" is not in valid_scopes.
  Valid scopes (from .commitlintrc.json): core data ui feature ci deps release docs detekt mcp skills scripts agents archive di guides tests tools
  Compound scopes like "core-error-sdk" are valid when "core" is in the list.
```

### Example: passing commit

```bash
git commit -m "docs: update pre-commit-hooks guide"   # no scope — passes
git commit -m "docs(guides): update pre-commit-hooks"  # valid scope — passes
git commit -m "feat(core-error-sdk): add new error"    # compound — passes (core is valid)
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

## The Manifest Drift Gate (W31.7 Phase 4 sub 3)

Every active agent template under `setup/agent-templates/<name>.md` and its mirror at `.claude/agents/<name>.md` has a SHA-256 hash recorded in `.claude/registry/agents.manifest.yaml` (`template_frontmatter_sha256`). When either file is staged, the hook validates that the recorded hash is current.

### How it works

1. Hook detects staged `setup/agent-templates/<name>.md` or `.claude/agents/<name>.md`
2. If no agent template is staged → Gate 2 not invoked
3. If a template is staged → runs `node mcp-server/build/cli/generate-template.js --check --all`
4. If 0 drift → exit 0, commit proceeds
5. If drift detected → exit 1, commit blocked with `[MANIFEST]` error and remediation hint

If the MCP server is not yet built, Gate 2 logs a notice and exits 0 (graceful skip — covered by bats test `(g)`). Run `cd mcp-server && npm run build` to enable Gate 2.

### Commit blocked (manifest drift)

```
$ git add setup/agent-templates/advisor.md .claude/agents/advisor.md
$ git commit -m "feat(agents): tweak advisor description"

[MANIFEST] Agent template frontmatter has drifted from manifest baseline.
  DRIFT  advisor — drift detected (template aligned: false, mirror aligned: false)

[MANIFEST] Fix per drifted agent:
[MANIFEST]   node mcp-server/build/cli/generate-template.js <agent-name> --update-manifest-hash
[MANIFEST]   bash scripts/sh/rehash-registry.sh --project-root "$(pwd)"
[MANIFEST] Then stage manifest + templates + mirrors + registry and retry commit.
```

### Fixing manifest drift

```bash
# 1. Regenerate the template AND bake the manifest hash atomically
node mcp-server/build/cli/generate-template.js advisor --update-manifest-hash

# 2. Propagate to skills/registry.json (separate hash system)
bash scripts/sh/rehash-registry.sh --project-root "$(pwd)"

# 3. Verify both clean
node mcp-server/build/cli/generate-template.js --check --all
bash scripts/sh/rehash-registry.sh --project-root "$(pwd)" --check

# 4. Stage all 4 surfaces and retry commit
git add setup/agent-templates/advisor.md .claude/agents/advisor.md \
        .claude/registry/agents.manifest.yaml skills/registry.json
git commit -m "feat(agents): tweak advisor description"
```

This gate complements the `manifest-drift-warn` CI job (now in BLOCK mode after PR #82) — local pre-commit catches drift before push, CI catches it as a backstop.

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

Verify the fix: `bash scripts/sh/verify-git-hooks.sh` (or `make verify-git-hooks`).

**`rehash-registry.sh: not found`**

Run from the repository root, not a subdirectory. The hook resolves paths relative to `PROJECT_ROOT` (defaults to `pwd`).

**`node mcp-server/build/cli/generate-registry.js` fails**

The MCP server CLI must be built first:

```bash
cd mcp-server && npm install && npm run build
```

**Hash still stale after rehash**

Confirm `skills/registry.json` is staged after the rehash step — the hook reads staged content, not working-tree content.
