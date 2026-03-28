---
scope: workflow
sources: [claude-code, agents, skills]
targets: [CLAUDE.md, dev-lead]
category: agents
slug: spec-driven-workflow
description: Native Claude Code workflow for spec-driven development without GSD dependency
---

# Spec-Driven Development Workflow

Native Claude Code workflow using agents, skills, Plan Mode, and worktrees.

## The Flow

```
1. Human writes SPEC.md / ROADMAP.md (goals + success criteria)
2. Human asks Claude: "implement feature X from the spec"
3. Claude enters Plan Mode → decomposes into tasks
4. Claude launches dev-lead(s) in parallel worktrees:
     Agent(dev-lead, worktree, prompt="implement task A per spec...")
     Agent(dev-lead, worktree, prompt="implement task B per spec...")
5. Each dev-lead:
     a) Reads CLAUDE.md → knows project rules
     b) Delegates research to researcher + decisions to advisor
     c) Synthesizes plan, implements code
     d) Delegates to test-specialist → audits tests
     e) Delegates to ui-specialist → audits UI (if applicable)
     f) Architect gate: arch-testing + arch-platform + arch-integration (parallel)
        - Architects detect + fix + cross-verify autonomously using MCP tools
        - All APPROVE → continue
        - Any ESCALATE → dev-lead re-plans (never codes the fix itself)
     g) Runs /pre-pr → pre-merge validation
     h) Reports result to Claude
6. Claude collects results from all dev-leads
7. Claude launches verifier → "did we meet the spec?"
8. If PASS → merge worktrees + PR
9. If FAIL → Claude adjusts and relaunches with gaps
```

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
| `dev-lead` | L1/L2 | Feature executor with delegation |
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
