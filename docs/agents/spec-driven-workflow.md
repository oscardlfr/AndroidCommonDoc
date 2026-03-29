---
scope: workflow
sources: [claude-code, agents, skills]
targets: [CLAUDE.md, project-manager]
category: agents
slug: spec-driven-workflow
description: Native Claude Code workflow for spec-driven development without GSD dependency
---

# Spec-Driven Development Workflow

Native Claude Code workflow using agents, skills, Plan Mode, and worktrees.

## Multi-Session Departments

| Session | Command | Orchestrator |
|---------|---------|-------------|
| Development | `claude --agent project-manager` | PM → architects → devs + guardians |
| Marketing | `claude --agent marketing-lead` | ML → content-creator, landing-page |
| Product | `claude --agent product-lead` | PL → product-strategist, prioritizer |

All sessions share context via `context-provider` agent and sync documentation via `doc-updater`.

## How to Start Work

```bash
# Option 1: /work routes to project-manager automatically
/work implement feature X from the spec

# Option 2: Direct PM invocation
@project-manager implement feature X per SPEC.md
```

All delegation uses the `Agent` tool. Never Bash + `claude` CLI.

## The Flow (3-Phase Model)

```
1. Human writes SPEC.md / ROADMAP.md (goals + success criteria)
2. Human asks Claude: "/work implement feature X" or "@project-manager ..."
3. PM orchestrates 3 sequential teams per task:

   Phase 1 — Planning Team (planner + context-provider):
     planner gathers context, produces structured plan → PM collects

   Phase 2 — Execution Team (3 architects + context-provider + doc-updater):
     Architects detect → PM dispatches devs → architects cross-verify
     All 3 APPROVE → team dissolved

   Phase 3 — Quality Gate Team (quality-gater + context-provider):
     quality-gater runs: frontmatter → tests → coverage → benchmarks → pre-pr
     PASS → PM commits. FAIL → back to Phase 2

4. For parallel worktrees, each PM runs its own 3-phase cycle
5. Claude launches verifier → "did we meet the spec?"
6. If PASS → merge worktrees + PR
7. If FAIL → Claude adjusts and relaunches with gaps
```

See [Team Topology](team-topology.md) for full details on each phase.

## Persistence (Native Claude Code)

| What | Where | Replaces (GSD) |
|------|-------|----------------|
| Decisions | Memory (project type) | .gsd/DECISIONS.md |
| Progress | Tasks (native) | .planning/STATE.md |
| Lessons | Memory (feedback type) | .gsd/KNOWLEDGE.md |
| Plans | Plan Mode (ephemeral) | .planning/phases/XX-PLAN.md |
| Roadmap | SPEC.md in repo (human-maintained) | .planning/ROADMAP.md |

## Agent Ecosystem

### L0 Generic Agents (propagated via /sync-l0)

| Agent | Role | Invoked by |
|-------|------|------------|
| `codebase-mapper` | Analyze repo architecture | `/map-codebase` |
| `debugger` | Scientific bug investigation | `/debug` |
| `verifier` | Goal-backward verification | `/verify` |
| `advisor` | Technical decision comparison | `/decide` |
| `researcher` | Ad-hoc technical research | `/research` |
| `test-specialist` | Test quality auditing | CLAUDE.md delegation |
| `ui-specialist` | Compose/UI auditing | CLAUDE.md delegation |
| `doc-alignment-agent` | Documentation drift detection | CLAUDE.md delegation |
| `release-guardian-agent` | Pre-release safety scan | CLAUDE.md delegation |
| `arch-testing` | Test quality verification gate | Architect gate after each wave |
| `arch-platform` | KMP/architecture verification gate | Architect gate after each wave |
| `arch-integration` | Wiring/compilation verification gate | Architect gate after each wave |

> Agents use official Anthropic skills when installed (tdd-workflow, webapp-testing, systematic-debugging, etc.). See `/setup --check-skills`.

### L1/L2 Project-Specific Agents (from templates)

| Template | Layer | Role |
|----------|-------|------|
| `project-manager` | L1/L2 | Orchestrator — assigns code to devs, launches gates |
| `platform-auditor` | L1 | Cross-module architecture |
| `module-lifecycle` | L1 | Module creation/deprecation |
| `product-strategist` | L2 | Feature prioritization (ICE) |
| `content-creator` | L2 | Marketing content drafting |
| `feature-domain-specialist` | L2 | Domain-specific auditing |

## Layer Independence

Each layer manages itself:
- **L0**: Toolkit evolution — agents, skills, Detekt rules, MCP tools
- **L1**: Library evolution — API contracts, module health
- **L2**: Product features — user stories, feature gates

No layer depends on another for workflow. `/sync-l0` propagates tools, not workflow state.
