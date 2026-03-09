# AndroidCommonDoc

## What This Is

A cross-platform developer toolkit that provides spec-driven development patterns and token-efficient AI skills for Android/KMP projects. Ships 8 standardized pattern docs, 16 canonical skills with multi-tool generation (Claude Code + GitHub Copilot), 5 custom Detekt architecture rules, a convention plugin for one-line Gradle adoption, and real-time AI enforcement hooks — all from a single source of truth.

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

- [ ] Konsist architecture tests enforce structural rules as unit tests
- [ ] Architecture guard tests for consuming projects (dependency direction, layer violations)
- [ ] MCP server exposes toolkit capabilities as tool endpoints
- [ ] Tech debt: quality-gate-orchestrator delegates to individual agents instead of inlining
- [ ] Tech debt: remove 5 orphaned validate-phase01-*.sh scripts
- [ ] Tech debt: install-copilot-prompts.sh standalone delivers generated instructions
- [ ] Tech debt: ANDROID_COMMON_DOC env var enforced at setup time

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

## Current Milestone: v1.2 Documentation Coherence & Context Management

**Goal:** Establish a coherent, navigable documentation structure across the KMP ecosystem with standard templates, consolidated content, and interconnected CLAUDE.md files that enable context delegation between L0/L1/L2 layers.

**Scope:** AndroidCommonDoc + shared-kmp-libs + DawSync (OmniSound/WakeTheCave deferred).

**Target features:**
- Standard doc structure template by domain sections (architecture, testing, UI, data, cross-cutting) — human-readable, spec-driven, context-window-aware
- DawSync doc audit & consolidation (docs/ cleanup, archive exclusion, identify L0 promotion candidates)
- CLAUDE.md rewrite across AndroidCommonDoc, shared-kmp-libs, DawSync — aligned with current roadmap and project state
- L0→L1→L2 context delegation in CLAUDE.md files — cross-references between layers for ecosystem-aware AI agents
- Vault sync updated to reflect consolidated documentation structure

## Context

Shipped v1.0 with ~31,710 LOC across Kotlin, Python, Shell, and Markdown.
Tech stack: Kotlin/KMP, Detekt 2.0.0-alpha.2, Gradle 9.1.0, Python3 adapters, Bash/PowerShell scripts.
Solo developer, designing for broader adoption including corporate environments.
Composite build pattern: consuming projects use `includeBuild("../AndroidCommonDoc")` with `ANDROID_COMMON_DOC` env var.
8 pattern docs, 16 skills, 12 script pairs, 5 Detekt rules, 1 convention plugin.

**Known issues:**
- quality-gate-orchestrator inlines gate logic (drifts when individual agents are fixed)
- 5 orphaned validate-phase01-*.sh scripts produce noise in quality gate runs
- install-copilot-prompts.sh standalone doesn't deliver generated instructions
- ANDROID_COMMON_DOC env var required but not enforced at setup time

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
*Last updated: 2026-03-14 after v1.2 milestone start*
