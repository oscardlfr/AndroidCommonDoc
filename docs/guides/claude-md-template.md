---
scope: [claude-md, template, context-management]
sources: [anthropic-claude-code]
targets: [all]
slug: claude-md-template
status: active
layer: L0
parent: guides-hub
category: guides
description: Standard template for CLAUDE.md files across the KMP ecosystem with L0/L1/L2 delegation
version: "1.0.0"
last_updated: "2026-03-16"
monitor_urls:
  - url: "https://docs.anthropic.com/en/docs/claude-code/overview"
    type: doc-page
    tier: 3
assumes_read: guides-hub
token_budget: 2081
---

# CLAUDE.md Template Reference

Standard template for all CLAUDE.md files in the KMP ecosystem. Every file follows this structure to ensure consistent context loading, layer delegation, and rule compliance.

## Budget Constraints

| Metric | Limit |
|--------|-------|
| Lines per file | < 150 |
| Tokens per project initial load | < 4000 |
| Developer Context section | User-scoped, clearly marked for corporate replacement |

## Section 1: Identity Header (MANDATORY)

Every CLAUDE.md starts with this block. It tells the AI agent immediately what project it is in, what layer of the ecosystem it belongs to, and what it inherits.

```markdown
# {Project Name} Project Rules

> **Layer:** L{0|1|2} ({Type: Generic KMP | Ecosystem Library | Application})
> **Inherits:** {inheritance chain}
> **Purpose:** {one-line description}

{Delegation statement}
{Scope statement}
```

### Layer-Specific Examples

**L0 Global** (`~/.claude/CLAUDE.md`):
```markdown
# Shared KMP Development Rules

> **Layer:** L0 (Generic KMP)
> **Inherits:** None (root)
> **Purpose:** Shared behavioral rules for all KMP projects

This file is auto-loaded by Claude Code for every project.
```

**L0 Toolkit** (AndroidCommonDoc):
```markdown
# AndroidCommonDoc Project Rules

> **Layer:** L0 (Pattern Toolkit)
> **Inherits:** L0 Generic (via ~/.claude/CLAUDE.md, auto-loaded)
> **Purpose:** L0 pattern toolkit providing docs, skills, MCP server, validation

Shared KMP rules in ~/.claude/CLAUDE.md (auto-loaded by Claude Code).
This file contains ONLY rules specific to AndroidCommonDoc as the L0 toolkit.
```

**L1** (your shared library):
```markdown
# my-shared-libs Project Rules

> **Layer:** L1 (Ecosystem Library)
> **Inherits:** L0 Generic (via ~/.claude/CLAUDE.md, auto-loaded)
> **Purpose:** Foundation KMP library suite consumed by all apps via composite builds

Shared KMP rules in ~/.claude/CLAUDE.md (auto-loaded by Claude Code).
This file contains ONLY my-shared-libs module-specific rules.
```

**L2** (your app):
```markdown
# MyApp Project Rules

> **Layer:** L2 (Application)
> **Inherits:** L0 Generic (via ~/.claude/CLAUDE.md, auto-loaded), L1 (shared library conventions)
> **Purpose:** [Your app description here]

Shared KMP rules in ~/.claude/CLAUDE.md (auto-loaded by Claude Code).
This file contains ONLY MyApp-specific rules and context.
```

## Section 2: Critical Rules / Key Architecture Decisions

The most important behavioral rules for this project. Keep concise -- these are the rules an AI agent must never violate.

- **L0 Global:** Architecture table, error handling, ViewModel rules, source set rules
- **L0 Toolkit:** Layer model, MCP server identity, skill/agent system
- **L1:** API/-impl separation, version authority, coverage target
- **L2:** Project-specific decisions (DO NOT DISTURB, Producer/Consumer, SSOT, Feature Gates)

## Section 3: Domain-Specific Sections

Layer-dependent content that provides project context:

| Layer | Typical Sections |
|-------|-----------------|
| L0 Global | Source Sets, Module Naming, File Naming, Testing, DI, Navigation, Compose Resources, Build Patterns |
| L0 Toolkit | MCP Server, Skills & Agents, Pattern Docs, Development Rules, Vault Sync |
| L1 | Module Catalog (Foundation, I/O, Storage, Security, Error Mappers), How to Add a Module |
| L2 | Module Structure, Mandatory Doc Consultation, Key Dependencies, Test Coverage |

## Section 4: Build Commands

Essential build/test/run commands in a fenced code block. Keep to 3-5 commands maximum.

```markdown
## Build Commands

\```bash
./gradlew test                    # All tests
./gradlew :core-result:test       # Specific module
\```
```

## Section 5: L0 Overrides (OPTIONAL)

Only present when a project explicitly overrides L0 defaults. Uses rule IDs from `canonical-rules.json`.

```markdown
## L0 Overrides

| L0 Rule ID | Override | Reason |
|------------|----------|--------|
| DI-01 | Dagger/Hilt 2.52 | Corporate standard |
| NAV-01 | Voyager 1.1.0 | Legacy project migration |
```

validate-claude-md checks that override IDs reference valid rules in canonical-rules.json and that overridden rules have `overridable: true`.

## Section 6: Temporal Context (OPTIONAL)

Time-bounded project context that will be removed when no longer relevant. Clearly marked as temporal.

```markdown
## Wave 1: Parallel Pre-Cloud Tracks (Active)

6 parallel tracks using git worktrees:
| Track | Branch | Modules |
|-------|--------|---------|
| A | feature/precloud-data-resilience | core/data, core/database |
...
```

Use this for: active sprints, parallel tracks, release phases, migration periods.

## Section 7: Team/Agent Rules (OPTIONAL -- L0 Global Only)

Git flow, worktree rules, agent file ownership. Lives in L0 Global since it applies to all projects. Not repeated in L1/L2.

## Delegation Model

### How Context Loads

1. `~/.claude/CLAUDE.md` (L0 Global) auto-loads via Claude Code's native mechanism for **every** project
2. `{project}/CLAUDE.md` (L1/L2) auto-loads per-project by Claude Code
3. Agent sees combined L0 + project context automatically
4. No explicit @import needed for L0 inheritance

### Reference Rules

- **No cross-project @import:** Do not use `@~/.claude/file.md` or `@../other-project/file.md` -- known reliability issues (GitHub issue #8765)
- **Local @import allowed:** `@docs/file.md` within the same project is fine
- **Direction is always downward:** L0 never references L1/L2; L1 never references L2
- **validate-claude-md enforces** structure, direction, and consistency programmatically

### Override Mechanism

When L1/L2 needs to deviate from L0:
1. Add an `## L0 Overrides` section with the rule ID, override value, and reason
2. validate-claude-md verifies the rule ID exists and is marked `overridable: true`
3. Non-overridable rules (architecture, error handling, ViewModel patterns) cannot be overridden -- they are ecosystem invariants

## Anti-Patterns

| Anti-Pattern | Why It Fails | Instead |
|-------------|-------------|---------|
| Duplicating L0 rules in L1/L2 | Rules drift when L0 is updated | L0 auto-loads; add only project-specific rules |
| L0 referencing project names in generic rules | Breaks corporate portability | Keep generic; project names only in Developer Context (user-scoped) |
| Upward references (L1 -> L2, L0 -> L1) | Circular dependencies, broken resolution | Direction is always downward |
| Files > 150 lines | Claude loses rules in long sessions | Split to hub+sub-doc or trim to essentials |
| Version numbers in multiple layers | Version drift across files | Version in exactly one layer (shared deps in L0, ecosystem in L1, project in L2) |
| Using @import for L0 inheritance | Known bugs with tilde paths | Rely on Claude Code's native auto-loading |

## Canonical Rule Reference

Rule IDs referenced in L0 Overrides and validate-claude-md come from `docs/guides/canonical-rules.json`. Categories:

| Prefix | Category | Example |
|--------|----------|---------|
| ARCH | Architecture | ARCH-01: 5-layer architecture |
| VM | ViewModel | VM-01: Sealed interface UiState |
| TEST | Testing | TEST-01: Fakes over mocks |
| ERR | Error Handling | ERR-01: Result<T> for all operations |
| BUILD | Build Patterns | BUILD-01: Composite builds |
| DI | Dependency Injection | DI-01: Koin 4.1.1 |
| NAV | Navigation | NAV-01: Navigation3 |
| NAME | Naming | NAME-01: Flat module names |
| SRC | Source Sets | SRC-01: Default hierarchy template |
| COMP | Compose | COMP-01: composeResources/ path |
| TEAM | Team/Agent | TEAM-01: Feature branch per teammate |
| TK | Toolkit | TK-01: L0 pattern toolkit identity |
| MOD | Module Catalog | MOD-01: Version authority (L1, per project) |
| APP | App Domain | APP-01: App-specific domain rules (L2, per project) |
