---
slug: tl-verification-done-criteria
category: agents
scope: L0
sources: ['docs/agents/main-agent-orchestration-guide.md']
targets: ['L0', 'L1', 'L2']
status: active
layer: L0
description: "Verification-before-done criteria for main-agent orchestration: TDD gate, doc check, security."
---

# Verification Before Done

> Part of [main-agent-orchestration-guide](main-agent-orchestration-guide.md).

- **TDD-first for bug fixes**: (1) test-specialist writes failing test, (2) verify fails, (3) specialist fixes, (4) arch-testing verifies pass
- **No pre-existing excuse**: Bugs found during work get fixed or reported — never silently ignored
- **Documentation gate**: `/doc-check` + `doc-alignment-agent` after features
- **Security**: `privacy-auditor` (user data), `release-guardian-agent` (releases), `api-rate-limit-auditor` (HTTP)
