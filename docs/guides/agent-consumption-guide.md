---
scope: [documentation, ai-agents, context-management]
sources: [androidcommondoc]
targets: [android, desktop, ios, jvm]
version: 1
last_updated: "2026-03"
assumes_read: guides-hub
token_budget: 2044
description: "How AI agents should load, navigate, and use the L0/L1/L2 documentation ecosystem"
slug: agent-consumption-guide
status: active
layer: L0

monitor_urls:
  - url: "https://github.com/anthropics/anthropic-cookbook"
    type: github-releases
    tier: 3
parent: guides-hub
category: guides
---

# Agent Consumption Guide

---

## Overview

The documentation ecosystem is organized in 3 layers, each adding project-specific context. AI agents should load the minimum context needed for their current task -- never load all docs at once.

**Core Principles**:
1. Load the narrowest layer that covers your task -- L0 for generic patterns, add L1/L2 only when working on a specific project
2. Use frontmatter fields (`scope`, `targets`, `layer`) to filter which docs to load
3. Each doc is self-contained and under 300 lines (~4000 tokens) -- designed for token-efficient agent consumption
4. Hub docs are navigation aids (~100 lines); sub-docs contain the detailed patterns

---

## Layer Architecture

### L0 -- Generic KMP/Android Patterns (AndroidCommonDoc)

Location: `AndroidCommonDoc/docs/`

Generic patterns applicable to ANY Kotlin Multiplatform or Android project. Framework-agnostic, not tied to any specific project's modules or domain. Approximately 25-30 docs covering architecture, testing, UI, navigation, DI, error handling, Gradle, and resources.

**Examples:** KMP source set hierarchy, ViewModel state patterns, Compose resource configuration, testing with coroutines, Navigation3 patterns.

**When to load:** Always. L0 is the foundation for all KMP/Android development.

### L1 -- Ecosystem Conventions (your shared library)

Location: `your-shared-libs/docs/`

Ecosystem-level conventions specific to the shared KMP library collection. Module API documentation, inter-module dependency rules, version catalog authority, API exposure patterns.

**Examples:** Module catalog, storage module decision tree, security module usage, error mapper templates.

**When to load:** When working on the shared library itself OR any app that consumes it.

### L2 -- App-Specific Patterns (per-app)

Location: App's `docs/` directory and `.androidcommondoc/` directory.

Project-specific patterns, domain logic, architectural decisions, and overrides. Contains domain models, feature workflows, app-specific testing strategies, deployment configurations.

**Examples:** Offline-first sync strategy, automation domain model, app-specific CLAUDE.md rules.

**When to load:** When working on that specific app.

---

## Loading Strategy

### Task-Based Filtering

| Task Type | Load | Token Budget |
|-----------|------|-------------|
| Generic KMP work (new module, library) | L0 docs matching task scope | ~8K-16K tokens |
| Shared library work | L0 + L1 docs matching task scope | ~16K-32K tokens |
| App feature work | L0 + L1 + L2 docs matching task scope | ~24K-48K tokens |
| Architecture review | L0 architecture + L1 module catalog | ~12K-20K tokens |
| Testing work | L0 testing hub + relevant sub-docs | ~8K-12K tokens |

### Scope-Based Filtering

Use the `scope` frontmatter field to find relevant docs:

- Working on testing? Load docs where `scope` includes `testing`
- Working on navigation? Load docs where `scope` includes `navigation`
- Working on storage? Load docs where `scope` includes `storage`

### Target-Based Filtering

Use the `targets` frontmatter field to filter by platform:

- iOS-only work? Load docs where `targets` includes `ios`
- Android + Desktop? Load docs where `targets` includes `android` or `desktop`

### Hub-First Loading

For topic clusters (testing, UI, offline-first), load the hub doc first (~100 lines). The hub provides an overview and lists sub-docs. Then load only the specific sub-docs you need.

```
1. Load testing-patterns.md (hub, ~80 lines)
2. Need coroutine testing? Load testing-patterns-coroutines.md
3. Need fakes? Load testing-patterns-fakes.md
4. Skip testing-patterns-coverage.md if not relevant
```

---

## Frontmatter Fields Reference

### Discovery Fields

| Field | Type | Purpose | Example |
|-------|------|---------|---------|
| `scope` | array | Topic categories for search/filtering | `[testing, coroutines]` |
| `sources` | array | Libraries/frameworks this doc covers | `[kotlinx-coroutines-test, junit5]` |
| `targets` | array | Target platforms | `[android, desktop, ios, jvm]` |
| `slug` | string | Unique identifier, matches filename | `testing-patterns-coroutines` |

### Classification Fields

| Field | Type | Purpose | Example |
|-------|------|---------|---------|
| `layer` | string | L0, L1, or L2 | `L0` |
| `parent` | string | Hub doc slug (sub-docs only) | `testing-patterns` |
| `project` | string | Project name (L1/L2 only) | `my-shared-libs` |
| `status` | string | active, deprecated, or draft | `active` |

### Versioning Fields

| Field | Type | Purpose | Example |
|-------|------|---------|---------|
| `version` | number | Content version, increment on changes | `3` |
| `last_updated` | string | Year-month of last revision | `"2026-03"` |
| `monitor_urls` | array | Upstream sources to track for freshness | See doc-template.md |

### Enforcement Fields

| Field | Type | Purpose | Example |
|-------|------|---------|---------|
| `rules` | array | Detekt rule definitions for automated enforcement | See doc-template.md |
| `excludable_sources` | array | Sources that can be excluded per-project | `[firebase-analytics]` |

---

## Override Mechanism

L1 can override L0 docs by matching the `slug`. L2 can override L0 or L1 docs. Overrides use **full replacement semantics** -- the entire doc is replaced, not merged.

### How Overrides Work

1. Agent requests doc by `slug` (e.g., `testing-patterns`)
2. Resolver checks L2 project's `.androidcommondoc/docs/` for a doc with matching slug
3. If found, L2 version is served (full replacement)
4. If not found, checks L1 project's `docs/`
5. If not found, serves L0 from AndroidCommonDoc

### Override File Location

Place override docs in the consuming project's `.androidcommondoc/docs/` directory:

```
my-app/
  .androidcommondoc/
    docs/
      testing-patterns.md    # L2 override of L0 testing-patterns
  docs/
    my-app-architecture.md   # L2 app-specific doc (not an override)
```

**Key rule:** Override docs MUST have the same `slug` as the doc they replace and must be self-contained (include all content, not just diffs).

---

## MCP Integration

The documentation ecosystem is served via an MCP server with these capabilities:

- **`docs://` URI scheme**: Load any doc by slug -- `docs://testing-patterns`
- **`find-pattern` tool**: Search docs by frontmatter metadata (scope, targets, layer)
- **`sync-vault` tool**: Sync docs to an Obsidian vault for browsing
- **`monitor-sources` tool**: Check upstream URLs for version changes
- **Registry scanner**: Auto-discovers docs from configured directories, parses frontmatter, builds searchable index

---

## Token Budget Guidelines

| Metric | Value |
|--------|-------|
| Standalone doc | Under 300 lines (~4000 tokens) |
| Hub doc | Under 100 lines (~1300 tokens) |
| Sub-doc | Under 300 lines (~4000 tokens) |
| CLAUDE.md | Under 150 lines (~2000 tokens) |

**Rule:** Never load all docs at once. A typical task needs 3-5 docs. Use scope/target filtering to select the right ones. Hub-first loading prevents loading sub-docs you do not need.

---

## Related Patterns

- [Documentation Template](doc-template.md) -- Canonical template all docs must follow
- [KMP Architecture](../architecture/kmp-architecture.md) -- Source set hierarchy referenced across L0 docs

---

## References

- [MCP Registry Types](../../mcp-server/src/registry/types.ts) -- `PatternMetadata` interface
- [Layer Resolver](../../mcp-server/src/registry/resolver.ts) -- L0/L1/L2 resolution logic

---

**Status**: Active -- All AI agents consuming the doc ecosystem should follow this guide.
**Last Validated**: March 2026
