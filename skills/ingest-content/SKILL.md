---
name: ingest-content
description: "Analyze external content and extract patterns for routing to docs. Use when asked to ingest an article, URL, or pasted content."
intent: [ingest, content, article, url, extract, patterns, docs]
allowed-tools: [Bash, Read, Write, Edit, Grep, Glob]
disable-model-invocation: true
copilot: true
copilot-template-type: behavioral
---

## Usage Examples

```
/ingest-content https://medium.com/@author/kotlin-coroutines-best-practices
/ingest-content https://developer.android.com/topic/architecture
/ingest-content
```

## Parameters

Uses parameters from `params.json`:
- `project-root` -- Path to the AndroidCommonDoc toolkit root directory.

Additional skill-specific arguments (not in params.json):
- A URL as the first positional argument (optional). If provided, the tool attempts to fetch the content.
- If no URL is provided, the user is prompted to paste the content directly.

## Canonical Runtime Entrypoint

After explicit user approval, the write request enters the shared product flow:

```bash
node scripts/lib/runtime-collaboration-entrypoints.cjs execute --entrypoint ingest-content --project-root <absolute> --intent <base64url canonical JSON>
```

The Bash call must be one standalone direct Node command. Replace `<absolute>` with the literal absolute project path before invoking it. Never use `$(pwd)`, `$PWD`, `cd`, shell variables, command substitution, pipes, redirects, or command separators in this authenticated entrypoint call.

The decoded intent is exactly `{"request_ref":"request:<sha256>","approval_ref":"approval:<sha256>"}`. An empty approval is `BLOCKED`; only a correlated `COMPLETED` result with canonical result, acceptance, and acknowledgement evidence confirms ingestion. Exact repeats deduplicate.

## Behavior

1. **URL provided:**
   - Pass the URL to the `ingest-content` MCP tool.
   - If the URL is fetchable (HTTP 200): the tool analyzes the fetched content.
   - If the URL is unfetchable (paywall, auth-wall, 403, timeout): the tool returns a structured response indicating the URL could not be fetched and suggests pasting the content manually.
2. **URL unfetchable or no URL provided:**
   - Prompt the user to paste the content (text, code snippets, article text).
   - Pass the pasted content to the `ingest-content` MCP tool with the `content` parameter.
3. **Content analysis:**
   - The tool scans the content for keyword matches against existing pattern doc metadata (scope, sources, targets fields).
   - It identifies version references, library mentions, API recommendations, and best practices.
   - Results are grouped by which pattern doc each finding relates to.
4. **Display suggestions** for each matched pattern doc:
   - Target doc name and slug.
   - Relevance explanation.
   - Extracted patterns and recommendations.
   - Recommended action: `update` (modify existing doc), `review` (manual review needed), or `new_doc` (suggest creating a new pattern doc).
5. For each suggestion the user can:
   - **Accept** -- Confirm the extracted patterns as guidance for the target pattern doc.
   - **Skip** -- Move to the next suggestion.
6. Handle images and diagrams in pasted content by describing their visual content and referencing them in the pattern doc update.
7. Content ingestion NEVER auto-applies changes. All suggestions require explicit user review and approval.
8. Once the user has approved one or more suggestions, apply them: if the invoking agent IS `doc-updater`, use `Read`/`Write`/`Edit` directly. Otherwise, route the approved update through the shared role-lifecycle manager — ensure/reuse `doc-updater` (and `context-provider` if pattern validation is needed), publish a durable `request/v1 kind:"ingestion"` carrying the target doc, extracted patterns, and the user's approval, and wait for `doc-updater`'s correlated `result/v1` (disposition `written|deduplicated|blocked`). A live message may accelerate the wake, but the correlated disk result is what confirms completion.

## Implementation

This skill is an orchestration workflow using the AI agent's built-in tools, plus the shared role-lifecycle manager for the actual document write when the invoking agent isn't `doc-updater`.

The agent performs the following steps:
1. If URL provided: call the `ingest-content` MCP tool with the `url` parameter.
2. If URL unfetchable: inform the user and ask them to paste the content.
3. If content provided (pasted or from step 1): call the `ingest-content` MCP tool with the `content` parameter.
4. Parse the structured JSON response with suggestions.
5. Display suggestions grouped by target pattern doc.
6. For each accepted suggestion:
   - If the invoking agent is `doc-updater`: `Read` the target pattern doc, then `Write`/`Edit` the user-approved update directly.
   - Otherwise: `ensureRoles`/`notify` to wake or reuse `doc-updater` through the shared lifecycle manager, publish the durable ingestion request with the user's approval already captured, and await the correlated result — never call `Write`/`Edit` on a pattern doc from a non-`doc-updater` agent.

## Expected Output

```
Analyzing content from https://medium.com/@author/kotlin-coroutines-best-practices...

Content fetched successfully (2,450 words).

SUGGESTIONS (3):

  [1] Target: viewmodel-state-patterns (viewmodel-state-patterns.md)
      Relevance: Article discusses ViewModel coroutine scope management
      Extracted patterns:
        - "Use viewModelScope.launch for ViewModel-scoped coroutines"
        - "Prefer structured concurrency over GlobalScope"
      Recommended action: REVIEW
      Action: [Accept] [Skip]

  [2] Target: coroutine-patterns (coroutine-patterns.md)
      Relevance: Article covers SupervisorJob and exception handling
      Extracted patterns:
        - "Use SupervisorJob for independent child failure isolation"
        - "CoroutineExceptionHandler at top-level scope only"
      Recommended action: UPDATE
      Action: [Accept] [Skip]

  [3] Target: (no matching doc)
      Relevance: Article introduces Flow testing patterns not covered by existing docs
      Extracted patterns:
        - "Use Turbine library for Flow testing assertions"
        - "Test hot flows with backgroundScope subscription"
      Recommended action: NEW_DOC
      Action: [Accept] [Skip]

Content preview (first 500 chars):
  "Kotlin Coroutines have become the standard for asynchronous programming
   in Android development. In this article, we explore best practices for..."
```

When a URL is unfetchable:

```
Attempting to fetch https://medium.com/@author/private-article...

URL could not be fetched (HTTP 403 - possible paywall or auth-wall).

Please paste the article content below. You can copy-paste text, code
snippets, or the full article. Images can be described in text.

Waiting for pasted content...
```

## Cross-References

- MCP tool: `ingest-content` (content analysis and pattern extraction)
- Registry: `mcp-server/src/registry/scanner.ts` (pattern doc metadata for matching)
- Pattern docs: `docs/*.md` (target docs for content routing)
- Related: `docs/agents/runtime-messaging-cp-writer.md` (the PATTERN-GAP -> approval -> doc-updater loop this skill's non-doc-updater path reuses)
- Related: `/monitor-docs` (automated upstream monitoring vs. manual content ingestion)
- Related: `/validate-patterns` (validates code against patterns that ingestion helps maintain)
