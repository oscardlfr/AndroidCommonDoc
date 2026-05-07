---
scope: [hooks, bypass, gates, wave-execution]
sources: [androidcommondoc]
targets: [android, desktop, ios, jvm]
slug: hook-bypass-recursive-pattern
status: active
layer: L0
category: guides
description: "Bypass env vars for PreToolUse gate hooks: when gate-blocking strings appear legitimately in commit messages, PR bodies, or CHANGELOG entries. Covers kmp-test-runner-gate, architect-bash-write-gate, and wave-phase-gate."
version: 1
last_updated: "2026-05"
---

# Hook Bypass — Recursive-Bootstrap Pattern

Substring-matching gate hooks block Bash commands whose string representation contains a blocked pattern — regardless of whether that pattern is in execution position or embedded as quoted prose. When a wave ships, modifies, or documents a gate hook, the wave's own commit messages, PR bodies, CHANGELOG entries, and architect verdicts will reference the blocked substring by definition. This is the recursive-bootstrap scenario.

## What Is Recursive-Bootstrap?

A gate hook that blocks `gradlew test` will also fire when an agent runs:

```bash
gh pr create --body "ships kmp-test-runner enforcement that blocks gradlew test"
```

The command string contains `gradlew test` in the PR body argument — the gate has no way to distinguish prose from execution. This is a design property of substring-based gates (fail-safe over context-aware), not a bug.

The same pattern applies to any gate using `command.includes()` or `grep` against the full Bash invocation string.

## Affected Gates

| Gate file | Blocked substrings | Bypass mechanism |
|-----------|-------------------|-----------------|
| `.claude/hooks/kmp-test-runner-gate.js` | `gradlew test`, `gradle test`, `:module:test` | `KMP_TEST_RUNNER_BYPASS=1` env var OR `[KMP_TEST_RUNNER_BYPASS]` inline marker in command |
| `.claude/hooks/quality-gate-pre-commit.sh` | triggers on `git commit` when stamp missing/stale/FAIL | No env bypass — re-run `/pre-pr` or quality-gater to refresh stamp before committing |
| `.claude/hooks/architect-bash-write-gate.js` | heredoc/redirect write patterns in Bash | `BASH_WRITE_GATE_BYPASS=1` (introduced BL-W43 PR1 for meta-recursive waves that edit hook files) |
| `.claude/hooks/wave-phase-gate.js` | `git push`, `gh pr create` (command-start only — body prose exempt after BL-W44 PR4) | `WAVE_PHASE_GATE_BYPASS=1` env var |

## When You Must Use Bypass

Set the bypass before any Bash command whose string representation will contain a blocked pattern as prose:

| Scenario | Gate triggered | Action |
|----------|---------------|--------|
| Writing CHANGELOG entry referencing `gradlew test` enforcement | `kmp-test-runner-gate.js` | Set `KMP_TEST_RUNNER_BYPASS=1` |
| `gh pr create --body` containing blocked pattern | `kmp-test-runner-gate.js` | Set `KMP_TEST_RUNNER_BYPASS=1` or add `[KMP_TEST_RUNNER_BYPASS]` to body |
| Architect verdict describing `gradlew test` gate behavior | `kmp-test-runner-gate.js` | Add `[KMP_TEST_RUNNER_BYPASS]` inline marker |
| Wave ships a new gate hook; PR title/body mentions it | hook being shipped | Set that hook's bypass env var |
| Creating PR for wave-phase-gate changes | `wave-phase-gate.js` | Set `WAVE_PHASE_GATE_BYPASS=1` |

**Canonical incident**: BL-W42 PR5 — `gh pr create` for the kmp-test-runner enforcement PR was blocked because the PR body described the very pattern being enforced. Resolution: `KMP_TEST_RUNNER_BYPASS=1 gh pr create ...`. Documented in memory `project_wave_bl_w42_pr5_shipped.md`.

## Bypass Usage

### kmp-test-runner-gate.js

```bash
# Env var bypass (preferred for gh pr create / gh pr merge)
KMP_TEST_RUNNER_BYPASS=1 gh pr create --title "..." --body "$(cat <<'EOF'
ships kmp-test-runner enforcement that blocks gradlew test
EOF
)"

# Inline marker bypass (preferred for single commands or when env var not available)
gh pr create --body "[KMP_TEST_RUNNER_BYPASS] ships enforcement..."
```

Unset or scope the env var immediately after — do not leave it set across unrelated commands.

### wave-phase-gate.js

Rule A gates `git push` and `gh pr create` when they appear as the leading command token.
After BL-W44 PR4, body prose is no longer matched — only actual command invocations trigger.

```bash
# Env var bypass (required when creating a PR about wave-phase-gate itself)
WAVE_PHASE_GATE_BYPASS=1 gh pr create --title "fix(scripts): narrow wave-phase-gate Rule A" --body "$(cat <<EOF
ships isGatedCommand() prefix match for gh pr create and git push
EOF
)"
```

Canonical scenario: shipping PR4 (wave-phase-gate changes) requires bypassing the gate
because the gh pr create command itself triggers Rule A. Set `WAVE_PHASE_GATE_BYPASS=1`
for the duration of that single command, then unset.

### quality-gate-pre-commit.sh

No env-var bypass exists. If the quality-gate stamp is expired (30-minute window), re-run the quality gate before committing:

```
/pre-pr
```

The recursive-bootstrap risk here is prose-only: the gate fires on the Bash `git commit` call itself (not the message). Writing commit message content via heredoc or Write tool does not trigger it.

## Why This Pattern Is by Design

Substring matching is fail-safe: it blocks any command that could plausibly execute the banned pattern. Context-aware parsing (AST, quoted-string detection) would be more precise but far more fragile across shell quoting variants. The bypass mechanism is the documented escape hatch — it is explicit, traceable, and must be used consciously.

Bypass discipline: every bypass usage is auditable. `KMP_TEST_RUNNER_BYPASS=1` is a visible env assignment in the command history. Wave-close reviews check for unexplained bypass usage.

## Cross-References

| Resource | Relevance |
|----------|-----------|
| [`pre-commit-hooks.md`](pre-commit-hooks.md) | Git hook `--no-verify` bypass (different mechanism — git hooks, not PreToolUse hooks) |
| [`scope-extension-protocol.md`](../agents/scope-extension-protocol.md) | Companion hook table including `architect-bash-write-gate.js` exempt targets |
| `.claude/hooks/kmp-test-runner-gate.js` | Source of truth for bypass var name and inline marker syntax |
| Memory: `project_wave_bl_w42_pr5_shipped.md` | Canonical incident — BL-W42 PR5 recursive-bootstrap hit |
