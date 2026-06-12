---
scope: [agents, hooks, branch-protection]
sources: []
targets: [all-agent-templates]
category: agents
slug: branch-guard
---

# Branch Guard Hook

> BL-W35-08 — Pre-commit local branch protection for `develop` and `master`.

## Purpose

GitHub branch protection blocks `git push` to `develop` and `master` but does NOT block local commits. An agent running `git commit`, `git merge`, or `git rebase` while already on a protected branch succeeds locally, polluting branch history before any push is attempted.

The `branch-guard` PreToolUse hook closes this gap by intercepting write-git operations at the Bash tool level and blocking them when the current branch is `develop` or `master`.

## Behavior

On every Bash tool invocation the hook:
1. Checks `tool_name === 'Bash'` — non-Bash tools pass through immediately.
2. Checks `CLAUDE_BRANCH_GUARD_DISABLED === '1'` — if set, exits 0 (allow).
3. Tokenizes the command on whitespace, checks `tokens[0] === 'git'`.
4. Checks `tokens[1]` against the blocked subcommand list.
5. Reads the current branch via `git rev-parse --abbrev-ref HEAD` (2s timeout).
6. If branch is `develop` or `master`, outputs a JSON block decision and exits 2.
7. Any error in steps 3–6 → exits 0 (fail-open).

## Protected Branches

- `develop`
- `master`

Configured as a constant `PROTECTED_BRANCHES` array in `.claude/hooks/branch-guard.js`.

## Blocked Subcommands

The following git subcommands are blocked when on a protected branch:

| Subcommand | Reason |
|---|---|
| `commit` | Creates a new commit directly on protected branch |
| `merge` | Modifies branch history (all flags including `--ff-only`, `--no-ff`) |
| `rebase` | Rewrites commit history on protected branch |
| `cherry-pick` | Creates a new commit on current branch |
| `revert` | Creates a new commit on current branch |

### Always Allowed (pass-through)

Read-only git ops (`status`, `log`, `diff`, `show`, `rev-parse`, `blame`, `reflog`), write-but-remote ops (`push`, `pull` — handled by GitHub branch protection), and branch management (`branch -D`, `stash`, `tag`, `fetch`, `remote`, `config`, `worktree`, `ls-files`, `ls-remote`).

## Detection Logic

Since BL-W47 PR-0b the hook scans COMPOUND commands segment by segment (closing the `rtk git commit` and `cd x && git commit` bypass classes found empirically in the PR-0a firing matrix §6/E3):

1. Split the command string into segments on `&&`, `||`, `;` and single `|`.
2. Per segment: trim, strip a leading `(`, then strip leading prefixes — env assignments (`VAR=x`), `rtk`, `sudo`, `command` (same stripping baseline as `wave-phase-gate.js` `isGatedCommand`, extended).
3. If the stripped segment's first token is not `git` → segment passes.
4. Resolve the git subcommand past global flags (`-C <path>`, `--work-tree`, `--git-dir` skip their argument; other `-*` flags are skipped) — so `git -C /path commit` IS detected.
5. If any segment's subcommand is in `BLOCKED_SUBCOMMANDS`: shell-out to read the current branch via `git rev-parse --abbrev-ref HEAD` (2s timeout); if the branch is in `PROTECTED_BRANCHES` → emit JSON block decision, exit 2.

Tokenized parse prevents `git commit-graph` from matching `commit` (subcommand token is `commit-graph`). Note the residual: segment-level `cd` into ANOTHER repo (`cd ../other && git commit`) is checked against THIS repo's current branch — fail-open by design (the guard protects this clone's protected branches).

Block message includes a remediation suggestion:
```
Direct git <subcommand> is blocked on '<branch>'.
Run: git checkout -b feature/<descriptive-slug> — then re-run your command.
```

## Bypass Mechanisms

**Environment variable**: `CLAUDE_BRANCH_GUARD_DISABLED=1` — checked before any subprocess is spawned (short-circuits all I/O). Intended for emergency situations where the hook must be bypassed for a single session.

**Fail-open**: any uncaught exception or branch-read failure exits 0 (allow). The hook never blocks on its own errors.

## Installation

### Registration in `.claude/settings.json`

The hook is registered in the `PreToolUse → "matcher": "Bash"` array:

```json
{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/branch-guard.js", "timeout": 5 }
```

Inserted after `architect-bash-write-gate.js` in the existing array.

### Propagation to L1/L2

`branch-guard.js` is a `.js` hook, so its FILE is propagated by `/sync-l0` (which copies `.claude/hooks/*.js` to consumers since BL-W47-prep-8; opt out per-hook via `selection.exclude_hooks` in `l0-manifest.json`). It is also copied by `setup/install-hooks.sh` (Linux/macOS) + `setup/Install-Hooks.ps1` (Windows). However, **neither mechanism registers it in `settings.json`** — `install-hooks.sh` auto-registers only `detekt-post-write.sh` + `detekt-pre-commit.sh`, so `branch-guard.js` requires manual `settings.json` registration. See [hook-manifest](hook-manifest.md) for the full per-hook propagation + registration classification.

## Test Coverage

- `scripts/tests/branch-guard.bats` — 18 bats cases covering blocked ops, allowed ops, bypass env var, fail-open, and non-git commands. Uses GIT_DIR stub approach: temp dir with a pre-written `HEAD` file sets the fake branch without spawning a full git repo.
- Vitest: T-BUG-022 regression in `mcp-server/tests/`.

## Cross-References

- [arch-topology-protocols](arch-topology-protocols.md) — §Local Branch Protection (GitHub-side protection vs local hook boundary)
- [agent-core-rules](agent-core-rules.md) — universal agent rules that this hook enforces mechanically
- `.planning/wave-bl-w35-tail/PR6-PLAN.md` — full rationale, Q1/Q2/Q3 resolution, and edge case analysis
- Related hooks: `cp-gate.js` (context-provider bypass gate), `architect-bash-write-gate.js` (verdict write protection)
