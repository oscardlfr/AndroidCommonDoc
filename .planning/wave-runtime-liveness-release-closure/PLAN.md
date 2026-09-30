# Runtime liveness release closure

### Wave Class

**Class**: HARNESS

## Objective

Publish the audited runtime-consumer hardening branch from one exact final HEAD after live L1/L2 validation. Preserve portable sync, Claude 2.1.x patch compatibility, strict generation-scoped WAITING/BUSY resume semantics, worktree isolation, current operational documentation, and generated adapter parity.

### Path-Manifest

- .claude/hooks/runtime-host-boundary.js
- .claude/hooks/subagent-start-context-bundle.js
- .planning/wave-runtime-liveness-release-approved/CLASS
- .planning/wave-runtime-liveness-release-approved/PLAN.md
- .planning/wave-runtime-liveness-release-closure/CLASS
- .planning/wave-runtime-liveness-release-closure/PLAN.md
- .planning/wave-runtime-liveness-release-final/CLASS
- .planning/wave-runtime-liveness-release-final/PLAN.md
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
- Current-schema WAITING and consumed BUSY resume records validate target scope before historical filtering; malformed target records fail closed without mutating bindings.
- Stopped, waiting, busy, fenced, ambiguous, and generation-stale actors never produce false READY or duplicate roles.
- Live consumer acceptance uses supported runtime entrypoints without absolute hook bridges.
- Runtime code, tests, hooks, documentation, and generated contracts remain synchronized.
- One complete local six-shard Bats aggregate passes on the exact final HEAD; required GitHub CI is the independent merge authority.

