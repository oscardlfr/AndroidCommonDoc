---
paths:
  - ".claude/agents/**"
  - ".claude/hooks/**"
  - ".claude/registry/**"
  - ".claude/runtime/**"
  - "scripts/lib/runtime-*/**"
  - "scripts/lib/wave-control-plane.cjs"
  - "scripts/tests/runtime-*"
  - "setup/agent-templates/**"
  - "skills/init-session/**"
  - "skills/resume-work/**"
  - "docs/agents/**"
---

# Runtime and agent rules

- The primary conversation owns orchestration; `team-lead` is a historical role name, never an installable persistent peer.
- Use the qualified L0 root for executable code and the consumer root for coordination/evidence.
- Every action must remain bound to its persisted request and exact canonical bootstrap message. Never document manual message rewriting as recovery.
- Support-plane readiness requires genuine role-specific evidence. A process existing or a prompt being sent is not readiness.
- Planner and runtime must share one documented PLAN grammar; fixtures must use the canonical producer form.
- Retirement is permanent policy: known legacy artifacts may be removed only by exact provenance/hash, while modified or ambiguous files fail closed.
- Rich Claude/Codex transports are accelerators over the portable disk contract, not separate semantics.
