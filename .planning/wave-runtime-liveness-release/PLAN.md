# Runtime liveness release closure

### Wave Class

**Class**: HARNESS

## Objective

Close the public runtime-consumer hardening and agent-modernization branch on one exact final HEAD. Preserve portable L1/L2 sync, patch-compatible Claude 2.1.x host admission, live role liveness and resume semantics, deterministic worktree isolation, current operational documentation, and the repository's generated adapter parity. Publish only after one complete local six-shard Bats aggregate and required GitHub CI pass.

### Path-Manifest

- .claude/hooks/runtime-host-boundary.js
- .claude/hooks/subagent-start-context-bundle.js
- .planning/wave-runtime-liveness-release/CLASS
- .planning/wave-runtime-liveness-release/PLAN.md
- README.md
- docs/guides/runtime-consumer-operations.md
- scripts/lib/runtime-role-lifecycle.cjs
- scripts/lib/runtime-role-lifecycle/claude-liveness-probe.cjs
- scripts/lib/runtime-role-lifecycle/claude-resume-delivery.cjs
- scripts/lib/runtime-role-lifecycle/claude-resume-lifecycle.cjs
- scripts/lib/runtime-role-lifecycle/claude-resume-record.cjs
- scripts/lib/runtime-role-lifecycle/cli-rootsource-handlers.cjs
- scripts/lib/runtime-role-lifecycle/ensure-active-routing.cjs
- scripts/lib/runtime-role-lifecycle/ensure-handler.cjs
- scripts/tests/runtime-host-boundary.test.js
- scripts/tests/runtime-ready-active-probe.test.js
- scripts/tests/runtime-role-lifecycle-handlers.test.js
- scripts/tests/runtime-role-lifecycle-module-boundaries.test.js
- scripts/tests/runtime-stale-ready-liveness.test.js

### Acceptance

- Clean runtime sync and launch remain portable across L1 and L2 consumers and linked worktrees.
- Stopped, waiting, busy, fenced, ambiguous, and generation-stale actors never produce a false READY or duplicate role.
- Live L1 and L2 acceptance exercises the same supported runtime entrypoints without absolute hook bridges.
- Agent, Claude, Codex, hook, skill, generated adapter, documentation, and backlog contracts remain synchronized.
- One complete local six-shard Bats aggregate passes on the exact final HEAD; required GitHub CI is the independent merge authority.

