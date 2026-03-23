---
scope: [guides, validation, upstream]
sources: [androidcommondoc]
targets: [android, desktop, ios, jvm]
slug: upstream-validation-guide
status: active
layer: L0
category: guides
description: "How to add validate_upstream assertions to pattern docs for automated upstream content validation"
version: 1
last_updated: "2026-03"
---

# Upstream Validation Guide

Add `validate_upstream` to pattern doc frontmatter to verify your patterns still match official upstream documentation.

## Quick Start

```yaml
# In your pattern doc frontmatter, before the closing ---
validate_upstream:
  - url: "https://developer.android.com/kotlin/flow/stateflow-and-sharedflow"
    assertions:
      - type: api_present
        value: "stateIn"
        context: "Our WhileSubscribed pattern depends on stateIn"
      - type: deprecation_scan
        value: "StateFlow"
        context: "StateFlow is our core state primitive"
    on_failure: HIGH
```

Run: `/audit-docs --with-upstream` or `node mcp-server/build/cli/audit-docs.js --with-upstream`

## Assertion Types

| Type | What it checks | When to use |
|------|---------------|-------------|
| `api_present` | API name exists in upstream | Core API your pattern depends on |
| `api_absent` | API name NOT in upstream | API you explicitly avoid |
| `keyword_absent` | Keyword not near qualifier | Pattern you teach against |
| `keyword_present` | Keyword appears in upstream | Concept your doc assumes exists |
| `pattern_match` | Regex matches in upstream | Complex API signatures |
| `deprecation_scan` | No deprecation keywords near API | API must not be deprecated |

## Writing Good Assertions

**Do:**
- Point to the specific page that contains the API (not a hub/overview page)
- Use `context` to explain WHY this assertion matters
- Keep 3-5 assertions per doc (focused, not exhaustive)
- Use `deprecation_scan` for critical APIs

**Don't:**
- Assert against JS-rendered pages with `api_present` (raw fallback can't extract)
- Use `keyword_absent` without `qualifier` (too many false positives)
- Assert generic words like "function" or "class"

## URL Selection

Jina Reader handles JS-rendered pages. Raw HTTP fallback only works for static HTML.

| Source | Works with Jina | Works with raw |
|--------|----------------|----------------|
| kotlinlang.org | ✅ | ✅ |
| developer.android.com | ✅ | ❌ (JS-rendered) |
| jetbrains.com/help | ✅ | ❌ (JS-rendered) |
| insert-koin.io | ✅ | ❌ (JS-rendered) |
| GitHub repos | ✅ | ✅ |

## Severity Guide

- `on_failure: HIGH` — Critical API dependency (stateIn, Room, CancellationException)
- `on_failure: MEDIUM` — Important but not breaking (keyword presence, DI patterns)
- `on_failure: LOW` — Informational (terminology changes)
