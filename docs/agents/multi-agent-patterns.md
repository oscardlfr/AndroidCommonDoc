---
scope: [workflow, ai-agents, automation, multi-agent]
sources: [anthropic-claude-code, androidcommondoc]
targets: [all]
slug: autonomous-multi-agent-workflow
status: active
layer: L0
parent: agents-hub
category: agents
description: "Multi-agent patterns: topology (chain/fan-out/orchestrator), agent design, data handoff, failure handling, cost control"
version: 2
last_updated: "2026-03"
assumes_read: guides-hub, claude-code-workflow, agent-consumption-guide
token_budget: 3800
monitor_urls:
  - url: "https://docs.anthropic.com/en/docs/claude-code/overview"
    type: doc-page
    tier: 3
---

# Autonomous Multi-Agent Workflow

How to design agent pipelines where specialized agents collaborate on a task. Covers the project-manager model, agent invocation, orchestration patterns, data handoff, failure handling, and cost control.

---

## When to Use Multi-Agent

Single-agent execution is the default. Reach for multi-agent only when:

| Signal | Example |
|--------|---------|
| Task spans multiple domains | Architecture audit + test review + security scan |
| Subtasks have independent inputs | Lint scripts in parallel across modules |
| Expert depth exceeds one prompt | Compose UI specialist + accessibility specialist |
| Output of one agent feeds another | Scout finds context → Planner designs → Worker implements |

If one agent can do the job in a single context window, one agent is better. Multi-agent adds latency, token cost, and failure surface.

---

## The Project Manager Model

See [claude-code-workflow](claude-code-workflow.md) for the full project-manager model. Key points:

- **PM NEVER codes** — all code is written by dev specialists, PM only orchestrates.
- **Simple task** → PM assigns to a single dev specialist.
- **Large task / long session** → PM orchestrates waves of devs + audits to specialists.
- **CLAUDE.md Agent Roster** is the discovery mechanism. Without it, Claude uses generic agents.

---

## Agent Topology

### Chain (Sequential Pipeline)

Each agent's output feeds the next. Use when tasks have data dependencies.

```
Scout  ──→  Planner  ──→  Worker  ──→  Reviewer
  context      plan         code        verdict
```

**Implementation** (Claude Code agent chain):
```
agent chain:
  - agent: scout,   task: "Map the auth module structure"
  - agent: planner, task: "Design OAuth migration using {previous}"
  - agent: worker,  task: "Implement the plan from {previous}"
```

`{previous}` is replaced with the prior agent's output automatically.

**When to use**: Research → plan → implement → review pipelines.

### Fan-Out / Fan-In (Parallel)

Independent subtasks run simultaneously. Results are collected and merged.

```
         ┌─ Agent A (module-1) ─┐
Input ──→├─ Agent B (module-2) ─┤──→ Aggregator
         └─ Agent C (module-3) ─┘
```

**Implementation** (Claude Code agent parallel):
```
agent parallel:
  - agent: test-specialist,  task: "Review tests in core/domain"
  - agent: test-specialist,  task: "Review tests in core/data"
  - agent: ui-specialist,    task: "Review Compose screens in feature/home"
```

All three run concurrently; results return when all complete.

**When to use**: Same check across independent modules, parallel audits.

### Orchestrator (Wave-Based)

A coordinator agent dispatches waves of work, collects results, and decides what runs next. The `/full-audit` orchestrator is the canonical example.

```
Orchestrator
  ├─ Wave 1: Scripts (fast, free)     ──→ findings[]
  │  └─ Architect gate: spot-check findings
  ├─ Wave 2: Agents (focused, paid)   ──→ findings[]
  │  └─ Architect gate: verify output + run tests
  ├─ Wave 3: Cross-cutting agents     ──→ findings[]
  │  └─ Architect gate: full verification
  └─ Deduplication + Report (only after all gates pass)
```

**When to use**: Complex workflows where later waves depend on earlier results, or where cheap checks should gate expensive ones.

### Hybrid TeamCreate (Peer Network + Sub-agents On Demand)

Orchestrators and architects as peers. Workers spawned on demand as sub-agents.

| Agent type | Communication | When created |
|------------|---------------|--------------|
| Team peer (lead, architect, shared service) | SendMessage | At team creation |
| Sub-agent (dev, guardian, specialist) | Agent() return | On demand by peers |

**Key**: Peers need ongoing coordination (cross-verify, cross-dept requests). Sub-agents are workers — they receive task, execute, return.

**Session team peers**: `context-provider`, `doc-updater`, and all 3 architects are added at session start; 4 core devs (test-specialist, ui-specialist, domain-model-specialist, data-layer-specialist) join at Phase 2 start. All 9 stay alive across phases. See [Team Topology](team-topology.md).

**3-Phase Model**: The default topology uses 3 sequential phases (Planning → Execution → Quality Gate) with 9 persistent session team peers (5 at session start + 4 core devs at Phase 2). Planner and quality-gater are temporary. See [Team Topology](team-topology.md) for the full model.

**Context management**: See [Context Rotation Guide](context-rotation-guide.md) for rotation strategies and PM-as-relay pattern.

### Architect Gate Pattern

Between waves, architect peers cross-verify via `SendMessage`. Core devs are persistent session team peers -- architects assign work directly via SendMessage:

- **arch-testing**: TDD compliance, test quality — manages `test-specialist`, `ui-specialist` via SendMessage
- **arch-platform**: KMP patterns, dependency direction — manages `domain-model-specialist`, `data-layer-specialist` via SendMessage
- **arch-integration**: compilation, DI wiring — manages `ui-specialist`, `data-layer-specialist` via SendMessage

**Pattern validation chain**: devs ask their architect for patterns; architects query context-provider. Devs NEVER contact context-provider directly.

**Dynamic scaling**: when a core dev is busy, architects request extra devs from PM. Extras are named but have no team_name -- they die after architect verification.

Each architect produces APPROVE or ESCALATE. ALL must APPROVE before the next wave. On ESCALATE, the PM re-plans (never codes the fix itself).

---

## Agent Design Rules

### 1. Single Responsibility

Each agent owns one domain. An agent that does "architecture review AND test generation AND security scanning" will do all three poorly. Split into three agents.

### 2. Typed Contract

Define the input/output contract explicitly in the agent's frontmatter or system prompt:

```yaml
# Input: path to module root, coverage threshold (percentage)
# Output: structured findings as JSON between FINDINGS_START/FINDINGS_END markers
```

Structured output enables machine parsing. Free-form prose blocks aggregation.

### 3. Read-Only by Default

Agents report — they don't modify code unless explicitly designed to. A `test-specialist` that finds gaps should list them, not auto-generate tests. A separate `auto-cover` agent handles generation.

This separation prevents conflicting writes from parallel agents.

### 4. Graceful Degradation

Use the [capability detection pattern](capability-detection.md) for optional tools. An agent that requires Context7 but gets invoked without it should fall back to training knowledge, not crash.

### 5. Bounded Context Window

Each agent starts with a clean context. It receives only:
- Its system prompt (the `.md` file)
- The task description (from the orchestrator)
- `{previous}` output (in chain mode)

It does NOT inherit the parent's conversation history, open files, or tool state. Design agents to be self-sufficient: they discover what they need via `read`, `rg`, `lsp`.

---

## Data Handoff

See [Data Handoff Patterns](data-handoff-patterns.md) for structured markers, severity conventions, and prose fallback.

---

## Failure Handling

### Agent Timeout

Set timeouts per agent. If an agent exceeds its budget, the orchestrator:
1. Records the timeout as a finding (`severity: INFO, title: "Agent X timed out"`)
2. Continues with remaining agents
3. Never retries automatically — timeouts usually indicate a scope problem

### Agent Crash

If an agent errors out (tool failure, API error):
1. Capture the error message
2. Record as a finding (`severity: MEDIUM, title: "Agent X failed: {error}"`)
3. Continue — one agent's failure should not abort the pipeline

### Partial Results

A chain where step 2 fails: the orchestrator reports steps 1 and 3 (if independent) and marks step 2 as failed. Fan-out collects whatever completes.

**Anti-pattern**: Retrying a failed agent with the same input. If it failed once, it will likely fail again. Surface the failure and let a human decide.

---

## Cost Control

### Wave Gating

Run free checks (scripts, grep, file-existence) before paid checks (agents). If Wave 1 finds blockers, skip Wave 2+. The `/full-audit` profiles implement this:

| Profile | Waves | Estimated cost |
|---------|-------|----------------|
| `quick` | 1–2 | ~$0.05 |
| `standard` | 1–3 | ~$0.30 |
| `deep` | 1–4 | ~$1.00+ |

### Token Budget per Agent

Agents should declare `token_budget` in their design. An agent that needs 50K tokens of context is doing too much — split it.

### Script-First Principle

Before creating an agent for a check, apply the [script vs agent decision framework](script-vs-agent-decision.md). If a regex can do it, a regex should do it.

---

## Example: Full Audit Pipeline

The `/full-audit` skill demonstrates the complete pattern:

```
Wave 1 (scripts, free, ~10s)
  ├─ pattern-lint.sh, verify-kmp.sh, rehash-registry.sh
Wave 2 (focused agents, ~30s, ~$0.10)
  ├─ test-specialist, ui-specialist, doc-alignment-agent
Wave 3 (cross-cutting agents, ~60s, ~$0.15)
  ├─ cross-platform-validator, release-guardian-agent, privacy-auditor
Aggregation
  └─ 3-pass deduplication → consolidated report
```

---

## Creating a New Multi-Agent Workflow

1. **Define the problem** — what decisions need multiple viewpoints?
2. **Choose topology** — chain, fan-out, or orchestrated waves?
3. **Design each agent** — single responsibility, typed contract, read-only
4. **Define the handoff** — structured markers between agents
5. **Set failure policy** — timeout, crash handling, partial results
6. **Gate by cost** — free checks first, expensive checks gated
7. **Test in isolation** — each agent should work standalone before wiring into a pipeline
8. **Wire the orchestrator** — agent chain/parallel, or a dedicated orchestrator agent

---

## Related Docs

- [Team Topology](team-topology.md) — 3-phase team model (Planning → Execution → Quality Gate)
- [Data Handoff Patterns](data-handoff-patterns.md) — structured markers, severity, prose fallback
- [Claude Code Workflow](claude-code-workflow.md) — single-agent skill and workflow patterns
- [Agent Consumption Guide](agent-consumption-guide.md) — how agents load and use documentation
- [Script vs Agent Decision](script-vs-agent-decision.md) — when to use a script instead of an agent
- [Capability Detection](capability-detection.md) — graceful degradation for optional tools
- [Context Rotation Guide](context-rotation-guide.md) — context window management for TeamCreate teams
- [Quality Gate Protocol](quality-gate-protocol.md) — sequential verification before commit
