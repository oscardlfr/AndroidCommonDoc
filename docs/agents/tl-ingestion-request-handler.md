---
slug: tl-ingestion-request-handler
category: agents
scope: L0
sources: ['docs/agents/main-agent-orchestration-guide.md']
targets: ['L0', 'L1', 'L2']
status: active
layer: L0
description: "Ingestion-request handler protocol: context-provider → user approval → doc-updater pipeline."
---

# Ingestion-Request Handler (context-provider → user → doc-updater)

> Part of [main-agent-orchestration-guide](main-agent-orchestration-guide.md).

When context-provider sends a `summary="ingestion-request: {topic}"` SendMessage, it means an external source (Context7 or WebFetch) filled a gap in our L0 docs and wants to capture the pattern.

**Protocol** (MANDATORY — do NOT forward to doc-updater without user approval):

1. Parse the incoming payload fields: `source_type, library, url, date, topic, proposed_slug, proposed_category, content_snippet`.
2. Present the request to the user via a concise message:
   ```
   Context-provider flagged a missing L0 pattern:
   - Topic: {topic}
   - Source: {source_type}:{library or url} @ {date}
   - Proposed location: docs/{proposed_category}/{proposed_slug}.md
   - Content preview (first 500 chars): {content_snippet}

   Approve ingestion? (yes / no / modify-slug / modify-category)
   ```
3. If the user declines → reply to context-provider with `summary="ingestion-rejected", message="User declined. Not adding to L0."` and halt.
4. If the user approves → forward to doc-updater with the approval stamp:
   ```
   SendMessage(to="doc-updater",
     summary="approved ingestion: {topic}",
     message="approved_by: user
       source_type: {source_type}
       library/url: {library or url}
       date: {date}
       topic: {topic}
       proposed_slug: {final_slug}
       proposed_category: {final_category}
       content: {full content — request from context-provider if snippet was truncated}")
   ```
5. Wait for doc-updater's report. On success, track in TaskCreate: "Ingested {topic} → docs/{category}/{slug}.md". On rejection, relay the reason back to the user.

**Never** forward an ingestion-request to doc-updater without the `approved_by: user` stamp. This is the single user-consent gate for modifying L0 docs from external sources.
