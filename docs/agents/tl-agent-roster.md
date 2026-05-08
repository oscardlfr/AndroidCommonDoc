---
slug: tl-agent-roster
category: agents
scope: L0
sources: ['docs/agents/main-agent-orchestration-guide.md']
targets: ['L0', 'L1', 'L2']
status: active
layer: L0
description: "Agent roster and specialist ownership map for the main-agent orchestration model."
---

# Agent Roster + Specialist Ownership Map

> Part of [main-agent-orchestration-guide](main-agent-orchestration-guide.md).

## Core Team Agents

| Role | Agents | Managed by |
|------|--------|------------|
| **Architects** | `arch-testing`, `arch-platform`, `arch-integration` | main agent (session team peers) |
| **Specialists** | `test-specialist`, `ui-specialist`, `data-layer-specialist`, `domain-model-specialist`, `toolkit-specialist` | Architects (session team peers for core; main agent spawns extras) |
| **Guardians** | `release-guardian-agent`, `cross-platform-validator`, `privacy-auditor`, `api-rate-limit-auditor`, `doc-alignment-agent` | Architects, main agent |
| **Cross-cutting** | `context-provider`, `doc-updater` | main agent (session team peers) |
| **Quality Gate** | `quality-gater` | team-lead (session team peer, Phase 3) |
| **Planning** | `planner` | main agent (Planning Team peer) |
| **Support** | `debugger`, `verifier`, `advisor`, `researcher`, `codebase-mapper` | main agent (direct invocation) |
| **Business** | `{{product-strategist}}`, `{{content-creator}}`, `{{landing-page-strategist}}` | team-lead (sub-agents for cross-dept) |

{{CUSTOMIZE: Add project-specific specialists and guardians here}}

## Specialist Ownership Map

| Specialist | Surface | Reports to |
|-----------|---------|------------|
| `test-specialist` | `mcp-server/tests/**`, `scripts/tests/*.bats`, all vitest/bats files | `arch-testing` |
| `ui-specialist` | Compose UI, Material3, accessibility | `arch-testing` |
| `domain-model-specialist` | Domain interfaces, use cases, domain models | `arch-platform` |
| `data-layer-specialist` | Repositories, database, network, caching | `arch-platform`, `arch-integration` |
| `toolkit-specialist` | `mcp-server/src/**`, `.claude/hooks/**`, `scripts/sh/*.sh`, `scripts/ps1/*.ps1` | `arch-platform` |

**Routing for TS/hooks/scripts work:** edits to `mcp-server/src/**`, `.claude/hooks/**.js`, `scripts/sh/*.sh`, or `scripts/ps1/*.ps1` → `toolkit-specialist`. Vitest cases under `mcp-server/tests/**` or bats cases under `scripts/tests/*.bats` → `test-specialist` (dispatched by arch-testing as usual). A TS source change requiring a test follows: toolkit-specialist edits src → messages arch-testing → arch-testing dispatches test-specialist for the test.
