---
scope: [workflow, ai-agents, pm, quality, docs]
sources: [androidcommondoc]
targets: [all]
slug: tl-quality-doc-pipeline
status: active
layer: L0
parent: agents-hub
category: agents
description: "team-lead quality gate protocol and doc pipeline: quality-gater retry rules, doc-updater mandate, CLAUDE.md pointers-only rule."
version: 1
last_updated: "2026-04"
assumes_read: quality-gate-protocol, tl-phase-execution
token_budget: 800
---

# team-lead Quality Gate + Doc Pipeline

Reference for team-lead's quality gate retry rules and mandatory doc pipeline: when to use quality-gater, doc-updater mandate, and CLAUDE.md pointers-only rule.

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

## Ingestion Handler (Wave 25 — `ingest-content` loop)

When **context-provider** flags an external source (Context7 or WebFetch) filling an internal-doc gap, it SendMessages team-lead with `summary="ingestion-request: {topic}"`. team-lead is the user-approval gate for L0 ingestion — see the full protocol in [Ingestion Loop](ingestion-loop.md).

Summary:

1. Receive `ingestion-request` from context-provider.
2. Present summary to user (topic + source + proposed path + 500-char snippet) and ask: approve / decline / modify-slug / modify-category.
3. On approval, forward to doc-updater with `approved_by: user` stamp.
4. doc-updater's Ingestion Handler (§5 of its template) runs `mcp__androidcommondoc__ingest-content` + validates + writes + audits.
5. Relay result back to user.

**Never** forward to doc-updater without the user-approval stamp. This is the single consent gate for writing external content into L0 docs.
