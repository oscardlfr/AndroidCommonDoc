---
scope: [workflow, ai-agents, pm, quality, docs]
sources: [androidcommondoc]
targets: [all]
slug: pm-quality-doc-pipeline
status: active
layer: L0
parent: agents-hub
category: agents
description: "PM quality gate protocol and doc pipeline: quality-gater retry rules, doc-updater mandate, CLAUDE.md pointers-only rule."
version: 1
last_updated: "2026-04"
assumes_read: quality-gate-protocol, pm-phase-execution
token_budget: 800
---

# PM Quality Gate + Doc Pipeline

Reference for PM's quality gate retry rules and mandatory doc pipeline: when to use quality-gater, doc-updater mandate, and CLAUDE.md pointers-only rule.

## Quality Gate Protocol

Phase 3 uses the quality-gater agent. See [Quality Gate Protocol](quality-gate-protocol.md) for gate steps (frontmatter → tests → coverage → benchmarks → pre-pr) and coverage investigation rules.

All gates pass → commit. Any fail → back to Phase 2. **Max 3 retries** — after 3 cycles on the same blocker, escalate to user.

## Doc Pipeline (mandatory for any documentation write)

**NEVER** use `Agent(general-purpose)` for writing docs. **ALWAYS** use `doc-updater`:

1. `SendMessage(to="doc-updater", message="Write/update {doc} with {content}")`
2. doc-updater knows: kebab-case filenames, hub structure, frontmatter requirements, README counts, line limits
3. After doc-updater completes → `Agent(subagent_type="l0-coherence-auditor")` to verify L0 compliance
4. Only commit after l0-coherence-auditor PASS

**Why**: general-purpose agents don't know L0 doc patterns. doc-updater does.

## CLAUDE.md = Pointers Only (MANDATORY)

NEVER direct doc-updater to write pattern detail into CLAUDE.md. Create docs/{category}/{slug}.md with full detail, add 1-line pointer to CLAUDE.md.
