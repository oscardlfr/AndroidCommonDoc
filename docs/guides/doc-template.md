---
scope: [documentation, template]
sources: [androidcommondoc]
targets: [all]
version: 1
last_updated: "2026-03"
monitor_urls:
  - url: "https://docs.anthropic.com/en/docs/claude-code/overview"
    type: doc-page
    tier: 3
assumes_read: guides-hub
token_budget: 2303
description: "Standard documentation template for the KMP ecosystem -- defines mandatory frontmatter, section structure, and size limits for all L0/L1/L2 pattern docs"
slug: doc-template
status: active
layer: L0
parent: guides-hub
category: guides
---

# Documentation Template

## Overview

This is the canonical template for all pattern documentation across the KMP ecosystem (AndroidCommonDoc L0, your shared library L1, app-specific L2). Every doc must follow this structure for consistent AI agent consumption and human readability.

**Core Principles**:
1. Every doc is self-contained -- loadable without its parent hub
2. Frontmatter drives discovery, filtering, and tooling (MCP registry, vault sync, monitor-sources)
3. Rules-first content ordering -- actionable patterns before context
4. Size limits enforce token-efficient loading for AI agents

---

## Frontmatter Reference

### Mandatory Fields

Every pattern doc MUST have these YAML frontmatter fields:

```yaml
---
scope: [domain1, domain2]           # What this doc covers (used for search/filtering)
sources: [library-name, framework]  # Upstream dependencies this doc tracks
targets: [android, desktop, ios]    # Target platforms (used for platform-scoped loading)
version: 1                          # Increment on content changes
last_updated: "2026-03"             # Year-month of last revision
description: "One-line summary"     # What this doc provides (shown in search results)
slug: my-pattern-name               # Unique identifier (filename without .md)
status: active                      # active | deprecated | draft
---
```

### Optional Fields

```yaml
layer: L0                           # L0 (generic) | L1 (ecosystem) | L2 (app-specific)
parent: hub-slug                    # For sub-docs: slug of the parent hub doc
project: my-shared-libs            # For L1/L2: which project this belongs to
monitor_urls:                       # Upstream sources to track for freshness
  - url: "https://github.com/org/repo/releases"
    type: github-releases           # github-releases | maven-central | doc-page | changelog
    tier: 1                         # 1 (critical) | 2 (important) | 3 (nice-to-have)
rules:                              # Detekt rule definitions (for enforceable patterns)
  - id: rule-name
    type: banned-import             # See RuleType in registry/types.ts
    message: "Why this matters"
    detect: { ... }
excludable_sources: [lib-name]      # Sources that can be excluded per-project
```

---

## Section Structure

### Standalone Doc (max 300 lines)

```
1. Frontmatter (YAML)
2. Title (H1)
3. Overview (2-3 paragraphs, core principles as numbered list)
4. Rules (DO/DON'T format, actionable patterns)
   - Anti-patterns inline with rules, not separate section
5. Code Examples (platform-split when differences exist)
6. Platform Notes (only when platform-specific behavior exists)
7. Related Patterns (cross-references to other docs)
8. References (external links)
```

### Hub Doc (max 100 lines)

Hub docs are navigation aids for topic clusters. They provide overview + links to sub-docs.

```
1. Frontmatter (YAML)
2. Title (H1)
3. Overview (1-2 paragraphs, key rules as bullet list)
4. Sub-documents (list with description per sub-doc)
5. Quick Reference (most common patterns, copy-paste ready)
6. Related Documentation (cross-references)
7. References (external links)
```

### Sub-doc

Sub-docs follow the standalone format with one addition: the `parent` frontmatter field linking back to the hub. Every sub-doc is independently loadable -- it must include enough context to be useful without loading the hub first.

---

## Size Limits

| Scope | Limit | Action |
|-------|-------|--------|
| Section (H2) | 150 lines | Split into sub-sections or extract to sub-doc |
| Standalone doc | 300 lines | Warn: consider splitting into hub + sub-docs |
| Absolute max | 500 lines | Error: must split |

---

## Rules

### DO

- Lead with actionable rules before explanatory context
- Use code examples that are copy-paste ready with real types and imports
- Include platform-specific examples only when behavior differs
- Keep `scope` arrays focused (2-4 items) for precise filtering
- Add `monitor_urls` for any doc tracking upstream library versions
- Use `parent` field in sub-docs so tooling can reconstruct the hub relationship

### DON'T

- Don't create docs without frontmatter -- the MCP registry will skip them
- Don't exceed 500 lines -- split into hub + sub-docs instead
- Don't duplicate content across docs -- cross-reference with Related Patterns
- Don't include project-specific code in L0 docs -- L0 is framework-agnostic
- Don't use L1/L2 project names in L0 doc content (frontmatter `project` field is fine)

---

## Code Examples

### Frontmatter for a hub doc

```yaml
---
scope: [testing, coroutines]
sources: [kotlinx-coroutines-test, junit5]
targets: [android, desktop, ios, jvm]
version: 3
last_updated: "2026-03"
description: "Hub doc: Testing patterns for KMP projects"
slug: testing-patterns
status: active
layer: L0
monitor_urls:
  - url: "https://github.com/Kotlin/kotlinx.coroutines/releases"
    type: github-releases
    tier: 1
---
```

### Frontmatter for a sub-doc

```yaml
---
scope: [testing, coroutines, virtual-time]
sources: [kotlinx-coroutines-test]
targets: [android, desktop, ios, jvm]
version: 2
last_updated: "2026-03"
description: "Coroutine test patterns: runTest, TestScope, virtual time, StateFlow collection"
slug: testing-patterns-coroutines
status: active
layer: L0
parent: testing-patterns
---
```

### Frontmatter for an L1 doc

```yaml
---
scope: [security, crypto]
sources: [tink, android-keystore]
targets: [android, ios]
version: 1
last_updated: "2026-03"
description: "Encryption module API and usage patterns for my-shared-libs"
slug: core-crypto-api
status: active
layer: L1
project: my-shared-libs
---
```

---

## Recommended Subdirectory Structure

Docs directories are organized into category-based subdirectories. Each file's `category` frontmatter field determines which subdirectory it belongs in. The `validate-doc-structure` MCP tool enforces this mapping.

### L0 Core Categories (12)

| Category | Description |
|----------|-------------|
| architecture | Architecture patterns, layer rules, module organization |
| testing | Test patterns, coroutine testing, fakes, coverage |
| error-handling | Error types, exception mappers, Result patterns |
| ui | ViewModel state, screen patterns, UI event handling |
| gradle | Build system, convention plugins, publishing, Kover |
| offline-first | Offline-first patterns, sync strategies |
| compose | Compose Multiplatform, resources, theming |
| resources | Compose Resources, localization, asset management |
| di | Dependency injection (Koin, Dagger/Hilt) |
| navigation | Navigation3, route patterns, platform-specific nav |
| storage | Storage patterns, encryption, secure storage |
| guides | Templates, workflows, agent consumption guides |

### L1 Ecosystem Additions (6)

| Category | Description |
|----------|-------------|
| security | Encryption modules, key management, secure storage |
| oauth | OAuth 1a, OAuth browser, token management |
| domain | Domain-specific utilities, billing, GDPR |
| firebase | Firebase integration modules |
| foundation | Foundation/core modules, system utilities |
| io | Network, JSON, IO modules, error mappers |

### L2 App Additions (5)

| Category | Description |
|----------|-------------|
| business | Business models, pricing, partnerships |
| product | Product requirements, feature specs |
| legal | Licensing, terms, privacy policies |
| tech | Tech specs, platform-specific implementation |
| references | External references, cheatsheets |

### Archive Policy

- Archived files go in `archive/` subdirectory within docs/
- Archived files MUST have `status: archived` and `archived_date: YYYY-MM-DD` in frontmatter
- Archive directory is excluded from registry scanning and vault collection
- Archive files keep their original filenames for reference

### Auto-generated README

Run `validate-doc-structure --generate-index` to auto-generate `docs/README.md` with:
- Category sections with file listings
- Key entry points for quick AI agent orientation
- File counts per category

---

## Related Patterns

- [Testing Patterns](../testing/testing-patterns.md) -- Example hub doc following this template
- [ViewModel State Patterns](../ui/viewmodel-state-patterns.md) -- Example hub with Detekt rules in frontmatter
- [Compose Resources Patterns](../compose/compose-resources-patterns.md) -- Example compact hub doc

---

## References

- [MCP Registry Types](../../mcp-server/src/registry/types.ts) -- `PatternMetadata` interface defining all frontmatter fields
- [Scanner](../../mcp-server/src/registry/scanner.ts) -- How frontmatter is extracted and validated
- [Phase 13 Audit Report](../../.planning/phases/13-audit-validate/audit-report.md) -- Evidence that informed this template

---

**Status**: Active -- All ecosystem docs (L0/L1/L2) must follow this template.
**Last Validated**: March 2026
