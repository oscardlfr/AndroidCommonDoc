---
scope: l0
sources: CLAUDE.md
targets: l0
category: agents
slug: workflow-orchestration
status: active
layer: L0
description: "Plan mode, agent delegation table, verification, and autonomous execution rules (extracted from CLAUDE.md prep-6)"
---

> For agent topology and dispatch patterns, see [main-agent-orchestration-guide](main-agent-orchestration-guide.md)

# Workflow Orchestration

> **W31.6 Canonical Pattern**: The main agent IS the orchestrator — see `docs/agents/main-agent-orchestration-guide.md` for session protocol. Canonical flat-spawning is preferred over nested team-lead subagent model.

## 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural impact)
- Changing vault sync (`moc-generator.ts`, `transformer.ts`, `wikilink-generator.ts`) → plan mode — graph impact
- Adding a new pattern doc → check hub doc size first; may need hub restructure
- Changing L0→L1/L2 propagation → plan mode — blast radius is every consumer

## 2. Agent Delegation (mandatory)
- **ALWAYS delegate domain audits to specialized agents** — never do them inline
- Launch agents in parallel when they cover independent domains

| Agent | Domain | MUST delegate when |
|-------|--------|-------------------|
| `test-specialist` | Testing | After implementation — pattern review, coverage gaps, write tests |
| `ui-specialist` | Compose UI | ANY change to Compose code — accessibility, Material3 |
| `doc-alignment-agent` | Doc accuracy | After code changes — verify docs match implementation |
| `release-guardian-agent` | Release safety | Before ANY publish — debug flags, secrets, dev URLs |
| `full-audit-orchestrator` | Quality audit | `/full-audit` — wave execution, specialized agents, 3-pass dedup |
| `quality-gate-orchestrator` | Consistency | Quality gate runs — all 5 validators + pass/fail report |
| `debugger` | Bug investigation | Systematic bugs needing hypothesis testing — `/debug` |
| `verifier` | Goal verification | After feature completion — verify spec is met — `/verify` |
| `advisor` | Technical decisions | Choosing between approaches/libraries — `/decide` |
| `researcher` | Domain research | Pre-implementation exploration — `/research` |
| `codebase-mapper` | Architecture analysis | First-time repo analysis — `/map-codebase` |

**Dev scope gates**: specialty default + architect-authorized override. test-specialist aligned with other core devs 2026-04-22 (BL-W27-02).

**Agent-template `.md` edits**: doc-updater owns by default; a core dev may own when the template change is domain-specific (e.g., test-specialist template → test-specialist self-edits). Formalized 2026-04-22 (BL-W27-03).

## 3. Verification Before Done
- MCP tool change → full Vitest suite + verify with `sync-vault`
- New skill → `validate-skills`; new doc → `validate-doc-structure`
- Vault fix → confirm graph in Obsidian before done
- Doc changes → `cd mcp-server && npm test` + Detekt + Konsist
- **Before any PR → `/pre-pr`**

## 4. Autonomous Execution
- Use L0 skills: `/test`, `/readme-audit`, `/validate-patterns`, `/extract-errors`
- MCP server is Node.js TypeScript, tested with Vitest — `cd mcp-server && npm test`
