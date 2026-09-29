---
scope: [agents, workflow, claude-code, orchestration]
sources: [androidcommondoc, anthropic-claude-code]
targets: [all]
slug: claude-code-workflow
status: active
layer: L0
category: agents
description: "Claude Code workflow using the main conversation, dynamic topology and evidence-bound quality gates"
version: 3
last_updated: "2026-09-28"
---
# Claude Code workflow

The main conversation owns orchestration. `team-lead` is a historical name for that logical responsibility, not an installable agent profile.

## Canonical launch

1. Start Claude Code with access to both the consumer and qualified toolkit roots (`--add-dir <L0-root>` when they are siblings).
2. Invoke `/init-session --orchestrate`.
3. Let the launcher discover the consumer layer, qualified L0 commit, wave class and available registry.
4. Follow the emitted lifecycle actions. Do not combine this path with `--agent team-lead` or create a manual fixed roster.

The persistent support plane is exactly `arch-platform`, `arch-testing`, `arch-integration`, `context-provider` and `doc-updater`. Planner, `quality-gater` and implementation specialists are phase-scoped and must not be parked as permanent peers.

## Work phases

1. **Plan:** reproduce the request, bind a written plan and consult the context provider where required.
2. **Execute:** dispatch only the specialists required by the plan, with explicit file ownership.
3. **Verify:** architects inspect their owned concerns and emit evidence-bound verdicts.
4. **Quality gate:** launch `quality-gater` for the final phase; run focused tests during iteration and one complete local gate before publication.
5. **Publish:** open a PR against the repository integration branch and use independent GitHub CI as the second evidence source. Do not merge without user authority.

The control plane remains disk-backed so recovery does not depend on a live mailbox. Optional agent-team messaging accelerates coordination but does not replace persisted plans, verdicts or proof artifacts.

## Recovery modes

| Mode | Purpose | Authentication/session behavior |
|---|---|---|
| normal interactive | Persistent development session | Normal authentication, hooks and memory |
| `--safe-mode` | Diagnose startup or hook/memory interference | Preserves normal authentication while disabling optional project automation as documented by the launcher |
| `--bare` | Minimal host diagnosis | Does not use normal OAuth/keychain state; requires an explicit API key |
| `-p` / `--print` | Deterministic single-turn probe | Non-persistent; emits initialization/tool evidence suitable for certification |

If interactive startup stalls or reads unrelated memory before the requested entrypoint, stop that session and use the documented safe-mode or print probe. Never present an old idle session or a manifest bound to a previous L0 commit as current evidence.

## Instruction and agent surfaces

- `AGENTS.md` is the portable repository authority.
- `CLAUDE.md` imports it and carries only Claude-specific launch notes.
- `.claude/rules/` provides path-scoped detail.
- `.claude/agents/` contains selectable specialist profiles synchronized from the registry.
- `skills/` contains procedures loaded on demand.
- Memory is advisory and durable-only.

Agent availability is discovered from the current synchronized registry. Do not maintain a duplicate roster in startup instructions.

## Verification discipline

- Reproduce each defect independently and test both rejection and success paths.
- Keep toolkit executable roots distinct from consumer coordination roots, including linked worktrees.
- Run the expensive full local batch once on the final candidate; use GitHub CI rather than repeating it locally.
- Treat skipped platform coverage as an explicit residual risk. Do not enable new macOS CI against `develop` without authorization.

See [main-agent-orchestration-guide](main-agent-orchestration-guide.md), [wave-control-plane](wave-control-plane.md), and [instruction-memory-contract](instruction-memory-contract.md).
