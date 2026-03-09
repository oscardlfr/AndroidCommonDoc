# AndroidCommonDoc

## What This Is

A cross-platform developer toolkit that provides spec-driven development patterns and token-efficient AI skills for Android/KMP projects. Ships 23 architecture pattern docs, 19 canonical skills with multi-tool generation (Claude Code + GitHub Copilot), 5 custom Detekt rules + generation pipeline, Konsist architecture tests, consumer guard test templates, an MCP server with 11 tools, and real-time AI enforcement hooks — all from a single source of truth.

## Core Value

Patterns and skills must be accurate, current, and token-efficient — if a developer follows these patterns and uses these skills, their code is correct by construction and their AI agent spends tokens on logic, not boilerplate.

## Requirements

### Validated

- ✓ Pattern documentation covers all KMP layers (ViewModel, UI, testing, Gradle, offline-first, resources, compose resources) — v1.0
- ✓ Code samples in pattern docs compilable and verified against current library versions — v1.0
- ✓ Automated freshness tracking detects stale version references and deprecated API usage — v1.0
- ✓ Consistent script parameter naming across PS1, SH, Claude commands, and Copilot prompts — v1.0
- ✓ Script parameter manifest as single source of truth for all script interfaces — v1.0
- ✓ Automated parity test suite verifies PS1/SH scripts produce identical behavior — v1.0
- ✓ Custom Detekt rules enforce top architecture patterns (5 AST-only rules) — v1.0
- ✓ Convention plugin enables one-line Gradle adoption of all enforcement rules — v1.0
- ✓ Compose Rules 0.5.6 integrated for Compose-specific lint enforcement — v1.0
- ✓ Canonical skill format generates multi-tool files (Claude Code + GitHub Copilot) — v1.0
- ✓ AGENTS.md universal instruction format adopted as base layer — v1.0
- ✓ Claude Code hooks enforce patterns in real-time during AI-assisted development — v1.0
- ✓ Quality gate agents validate internal consistency (script parity, skill-alignment, template sync, doc drift) — v1.0
- ✓ Cross-surface parameter drift detection catches mismatches across Claude/Copilot/scripts — v1.0
- ✓ Token cost measurement per skill validates efficiency claims — v1.0

### Active

- [ ] L0-L1-L2 ecosystem coherence: hub+sub-doc uniformity, validate-doc-structure 0 errors across all 3 projects
- [ ] Token optimization: oversized docs split, registry.json optional_capabilities field, audit-l0 skill

### Future

- [ ] Codex adapter generates Codex-compatible skill files
- [ ] Cursor/Windsurf rule adapters when formats stabilize
- [ ] SwiftUI navigation patterns documentation
- [ ] KMP ↔ SwiftUI interop patterns
- [ ] appleMain/iosMain/macosMain source set guidance

### Out of Scope

- Business logic from DawSync, WakeTheCave, OmniTrack — generic toolkit only
- iOS/SwiftUI native patterns — future milestone, design accommodates adding them later
- Runtime libraries or SDKs — documentation + scripts + skills, not compiled code
- Opinionated CI/CD pipeline configs — provide lint rules, not pipeline definitions
- IDE plugins (Android Studio, IntelliJ) — Detekt/ktlint already integrate with IDEs
- Full project templates/scaffolding — forces structure, kills incremental adoption
- Detekt 2.0 stable rules — target 2.0.0-alpha.2; migrate when API stabilizes
- Offline mode for quality gates — all quality checks run locally already

## Completed Milestones

- **M001 (MVP / v1.0)**: Foundation — 16 skills, 8 pattern docs, 5 Detekt rules, convention plugin, 12 script pairs, quality gate agents, Claude Code hooks
- **M002 (Hardening & Intelligence / v1.1)**: Konsist tests, consumer guard tests, MCP server (11 tools), pattern registry (23 docs), doc intelligence, Obsidian vault sync, ecosystem vault expansion
- **M004 (Documentation Coherence & Context Management / v1.2)**: Doc reorganization into domain subdirs, oversized doc splitting, full frontmatter across all layers, DawSync consolidation, skill ecosystem modernization, CLAUDE.md layering, materialization engine, vault naming normalization, per-module READMEs for shared-kmp-libs

## Current Milestone: M005 — L0-L1-L2 Ecosystem Coherence & Token Optimization

**Goal:** Ensure the three-layer documentation ecosystem (L0/L1/L2) is coherent, token-efficient, and production-ready for multi-console AI workflows.

**Scope:** AndroidCommonDoc (L0) + shared-kmp-libs (L1) + DawSync (L2).

## Context

Shipped v1.0 with ~31,710 LOC across Kotlin, Python, Shell, and Markdown. Shipped v1.1 extending to 19 skills, 23 pattern docs, 11 MCP tools, Konsist tests, consumer guard templates, Obsidian vault sync. Shipped v1.2 with full doc reorganization, hub+sub-doc splitting, per-module READMEs, CLAUDE.md layering, skill materialization engine.
Tech stack: Kotlin/KMP, Detekt 2.0.0-alpha.2, Gradle 9.1.0, TypeScript MCP SDK 1.27.1 (Node 24.x), Konsist 0.17.3, Python3 adapters, Bash/PowerShell scripts.
Solo developer, designing for broader adoption including corporate environments.
Composite build pattern: consuming projects use `includeBuild("../AndroidCommonDoc")` with `ANDROID_COMMON_DOC` env var.
23 pattern docs, 19 skills, 11 MCP tools, 12 script pairs, 5 Detekt rules, 1 convention plugin, Obsidian vault sync.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Flat module naming (`core-json-api` not `core-json:api`) | AGP 9+ circular dependency bug with nested modules | ✓ Good — no issues |
| Dual script platform (PS1 + SH) | Developer works on Windows, CI/corporate may be Linux/macOS | ✓ Good — 12 script pairs with parity |
| Multi-tool support (Claude + Copilot + extensible) | Open/closed principle — don't lock into one AI tool vendor | ✓ Good — adapter pattern works |
| Scripts + lint rules for validation | Scripts for quick agentic checks, lint rules for CI enforcement | ✓ Good — both surfaces active |
| Quality gate agents in `.claude/agents/` | GSD uses these for post-execution verification | ✓ Good — 4 agents + orchestrator |
| AST-only Detekt rules (no type resolution) | Avoid Detekt #8882 performance issue in KMP monorepos | ✓ Good — fast, no false positives |
| Adapter pipeline (SKILL.md → tool-specific output) | Single source of truth for multi-tool generation | ✓ Good — 32 files regenerated from 16 SKILLs |
| Convention plugin with opt-out DSL | One-line adoption with per-concern control | ✓ Good — afterEvaluate timing resolved |
| Python3 for cross-platform adapters | Git Bash + Windows Python compatibility | ✓ Good — consistent across all adapters |
| Orchestrator inlines gate logic | Claude Code agents don't support nesting | ⚠️ Revisit — causes drift when agents updated |

## Constraints

- **Open/Closed Design**: New AI tool support must be addable without modifying existing structure
- **No App Dependencies**: Patterns from official docs and best practices, never app-specific
- **Cross-Platform Scripts**: Every script works on Windows (PowerShell) and macOS/Linux (Bash) identically
- **Token Efficiency**: Skills delegate to scripts, not inline logic — LLM context window is scarce resource

---
*Last updated: 2026-03-17 after M001 milestone close*
