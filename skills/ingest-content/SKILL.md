---
name: ingest-content
description: "Analyze external content and extract patterns for routing to docs. Use when asked to ingest an article, URL, or pasted content."
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
   - **Accept** -- Open the target pattern doc for editing with the extracted patterns as guidance.
   - **Skip** -- Move to the next suggestion.
6. Handle images and diagrams in pasted content by describing their visual content and referencing them in the pattern doc update.
7. Content ingestion NEVER auto-applies changes. All suggestions require explicit user review and approval.

## Implementation

This skill is an orchestration workflow using the AI agent's built-in tools.

The agent performs the following steps:
1. If URL provided: call the `ingest-content` MCP tool with the `url` parameter.
2. If URL unfetchable: inform the user and ask them to paste the content.
3. If content provided (pasted or from step 1): call the `ingest-content` MCP tool with the `content` parameter.
4. Parse the structured JSON response with suggestions.
5. Display suggestions grouped by target pattern doc.
6. For each accepted suggestion:
   - Use `Read` to load the target pattern doc.
   - Present the extracted patterns as recommendations for the user to incorporate.
   - Use `Write` or `Edit` to apply user-approved updates.

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
- Related: `/monitor-docs` (automated upstream monitoring vs. manual content ingestion)
- Related: `/validate-patterns` (validates code against patterns that ingestion helps maintain)
