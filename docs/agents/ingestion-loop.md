---
scope: [workflow, ai-agents, context-provider, doc-updater, pm, docs]
sources: [androidcommondoc]
targets: [all]
slug: ingestion-loop
status: active
layer: L0
parent: agents-hub
category: agents
description: "External-source → L0 docs ingestion loop: context-provider flags gap → team-lead gates with user approval → doc-updater runs ingest-content. Closes T-BUG-005 (half-landed prior to Wave 25)."
version: 1
last_updated: "2026-04-21"
assumes_read: team-topology, context-rotation-guide
token_budget: 1200
---

# Ingestion Loop (External → L0)

How patterns that context-provider fetches from Context7 or WebFetch become permanent L0 pattern docs. Wave 25 closed this loop — previously the flag existed but no path-to-ingestion was wired.

## Why this exists

Context-provider's Answer Pipeline (see `context-provider.md` template) can source patterns from Context7 or WebFetch when internal MCP + local files don't cover a query. Before Wave 25, the template only flagged those sources and told team-lead to notify doc-updater "somehow" — the actual ingestion path was prose. `mcp__androidcommondoc__ingest-content` existed as a tool but no agent declared it in its frontmatter. Wave 25 makes the flow mechanical and user-gated.

## Protocol (end-to-end)

```
context-provider                team-lead                        doc-updater
---------------                 ------                    -----------
(gap detected, Context7/WebFetch used)
 | ingestion-request →           |
 | (payload: source_type,        |
 |  library/url, date, topic,    |
 |  proposed_slug,               |
 |  proposed_category,           |
 |  content_snippet)             |
 |                               |
 |                               | (user-approval gate)
 |                               | "Approve ingestion? y/n/modify"
 |                               |
 |                               | user: yes       ─────►  |
 |                               | approved ingestion      |
 |                               | (adds approved_by: user |
 |                               |  + full content)        |
 |                               |                         | search-docs (existing?)
 |                               |                         | ingest-content
 |                               |                         | validate-doc-update
 |                               |                         | Write docs/{cat}/{slug}.md
 |                               |                         | audit-docs
 |                               |                         |
 |                               | ◄─────── doc report     |
 | ◄──── ingestion-result ────── |                         |
```

## Agent responsibilities

### context-provider

- Detects internal gap, fetches from Context7 or WebFetch.
- Appends the external citation to its Context Report: `"Not in our docs — sourced from Context7 [{library}]. Ingestion-request sent to team-lead."`
- Sends structured `summary="ingestion-request: {topic}"` SendMessage to team-lead with the full payload shape defined in the context-provider template.
- Does NOT SendMessage doc-updater directly — team-lead approval is mandatory.

### team-lead

- Receives `ingestion-request: {topic}` SendMessage from context-provider.
- Presents the request to the user: topic, source, proposed location, 500-char snippet preview, action choice (approve / decline / modify-slug / modify-category).
- On approval: forwards to doc-updater with `approved_by: user` stamp and full content.
- On decline: replies to context-provider with `ingestion-rejected`, no write.
- Never forwards to doc-updater without the approval stamp.

### doc-updater (Ingestion Handler — §5 of doc-updater template)

- Rejects payloads without `approved_by: user`.
- Runs `mcp__androidcommondoc__search-docs` first to confirm no existing doc covers the topic (prevents duplicate ingests).
- Runs `mcp__androidcommondoc__ingest-content` to normalize the payload.
- Assembles the final doc under `docs/{proposed_category}/{proposed_slug}.md` with `sources: [{source_type}:{library_or_url}@{date}]` in frontmatter.
- Runs `mcp__androidcommondoc__validate-doc-update` — FIXABLE auto-fixes, REJECTED escalates.
- Writes the file + updates hub if category has one.
- Runs `mcp__androidcommondoc__audit-docs` for coherence.
- Reports back to team-lead with `{written_file, audit_status, follow_ups}`.

## User-approval gate

The user-approval step is **load-bearing**. It is the single consent point for adding external content to L0 docs. Without it:

- External content could silently ship into the canonical pattern catalog.
- License/attribution requirements (Context7 citations, WebFetch source URLs) could be skipped.
- User preference for slug/category naming could be bypassed.

team-lead's template (`setup/agent-templates/team-lead.md` §Ingestion-Request Handler) enforces this gate — see Wave 25 PR/commit for the concrete SendMessage + user prompt patterns.

## Rejection cases (all surface back to team-lead)

| Case | Trigger | Action |
|------|---------|--------|
| Missing approval stamp | `approved_by ≠ "user"` | doc-updater REJECTS; reports protocol violation |
| Existing doc covers topic | `search-docs` returns a match | doc-updater suggests UPDATE path (not ingest) |
| Validation fails | `validate-doc-update` REJECTED after auto-fix | Escalate to team-lead with validator output |
| Line limit breached | Content exceeds L0 limits and cannot be split cleanly | Escalate; doc needs hub + sub-doc planning |

## Graceful degradation

If Context7 is unavailable → context-provider falls back to WebFetch. If WebFetch is blocked → context-provider uses training knowledge + MCP tools ONLY and marks the answer "uncited". **Uncited content is never eligible for ingestion** — no ingestion-request is sent.

## Frontmatter declarations (Wave 25 wiring)

Agents in this loop must declare the relevant MCP tools in their `tools:` frontmatter — prose references alone don't load the harness schemas:

| Agent | Required MCP tools |
|-------|-------------------|
| `context-provider` | `search-docs`, `find-pattern`, `suggest-docs`, Context7 resolve-library-id + query-docs |
| `team-lead` | `audit-docs` (for post-ingest coherence checks) |
| `doc-updater` | `ingest-content`, `search-docs`, `validate-doc-update`, `audit-docs` |

See the canonical templates in `setup/agent-templates/` for the full `tools:` lines.

## Cross-references

- `setup/agent-templates/context-provider.md` — ingestion-request sender
- `setup/agent-templates/team-lead.md` — approval gate + user prompt
- `setup/agent-templates/doc-updater.md` — ingestion handler §5
- `mcp-server/src/tools/ingest-content.ts` — the underlying MCP tool
- [Context Rotation Guide](context-rotation-guide.md) — why the loop is stateless per-query (Context7 is stateless)
- [team-lead Quality Doc Pipeline](tl-quality-doc-pipeline.md) — doc-updater mandate (non-ingestion path)
