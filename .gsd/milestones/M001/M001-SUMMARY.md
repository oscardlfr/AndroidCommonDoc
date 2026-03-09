---
id: M001
provides:
  - 16 canonical skills with multi-tool adapter pipeline (Claude Code + GitHub Copilot)
  - 8 architecture pattern documents covering all KMP layers
  - 5 custom Detekt rules (AST-only, no type resolution) enforcing architecture patterns
  - 1 convention plugin for one-line Gradle adoption
  - 12 cross-platform script pairs (PowerShell + Bash) with parameter manifest
  - 5 quality gate agents for internal consistency validation
  - Claude Code hooks for real-time AI-assisted development enforcement
  - AGENTS.md universal instruction format as base layer
key_decisions:
  - Flat module naming (core-json-api not core-json:api) — AGP 9+ circular dependency avoidance
  - Dual script platform (PS1 + SH) — Windows dev + Linux/macOS CI support
  - Multi-tool support (Claude Code + Copilot + extensible) — open/closed adapter pattern
  - AST-only Detekt rules — avoid Detekt #8882 performance issue in KMP monorepos
  - Python3 for cross-platform adapters — Git Bash + Windows Python compatibility
  - Orchestrator inlines gate logic — workaround for Claude Code agent nesting limitation
patterns_established:
  - SKILL.md canonical format with frontmatter drives multi-tool generation via adapters/
  - Quality gate agents in .claude/agents/ verified by orchestrator
  - Cross-platform script pairs (ps1/ + sh/) with single parameter manifest
  - Convention plugin with opt-out DSL and afterEvaluate timing
  - Adapter pipeline: single SKILL.md source → Claude Code commands + Copilot prompts
observability_surfaces:
  - quality-gate-orchestrator produces unified pass/fail report across all gates
  - script-parity-validator checks PS1/SH behavioral equivalence
  - skill-script-alignment verifies command-to-script references
  - template-sync-validator checks Claude/Copilot semantic equivalence
  - doc-code-drift-detector checks pattern doc version reference accuracy
requirement_outcomes:
  - id: DEBT-01
    from_status: active
    to_status: validated
    proof: All consumer-facing scripts fail fast with actionable error when ANDROID_COMMON_DOC is missing (validated in M002/S01)
  - id: DEBT-02
    from_status: active
    to_status: validated
    proof: install-copilot-prompts.sh delivers generated Copilot instructions standalone (validated in M002/S01)
  - id: DEBT-03
    from_status: active
    to_status: validated
    proof: quality-gate-orchestrator delegates to individual agent files (validated in M002/S01)
  - id: DEBT-04
    from_status: active
    to_status: validated
    proof: Orphaned validate-phase01-*.sh scripts removed from repository (validated in M002/S01)
duration: pre-GSD (shipped as v1.0 before GSD workflow adoption)
verification_result: passed
completed_at: 2026-03-13
---

# M001: MVP

**Cross-platform KMP developer toolkit foundation: 16 skills, 8 pattern docs, 5 Detekt rules, convention plugin, 12 script pairs, quality gate agents, and real-time Claude Code enforcement hooks — all generated from a single source of truth.**

## What Happened

M001 is the migrated foundational milestone representing v1.0 of AndroidCommonDoc, shipped before GSD workflow adoption. The work established the core architecture that all subsequent milestones extend.

The milestone delivered a microkernel + adapter architecture with four independent capability surfaces. First, the **canonical skill format**: 16 SKILL.md files with YAML frontmatter serve as the single source of truth for AI tool instructions. The adapter pipeline (Python3) generates Claude Code slash commands and GitHub Copilot prompt files from these canonical sources — adding support for a new AI tool requires only a new adapter, not modifying any skill. Second, the **Detekt enforcement layer**: 5 AST-only custom rules enforce the documented architecture patterns (sealed UiState, no Context in ViewModels, CancellationException rethrow, StateFlow exposure pattern, SharedFlow for events). AST-only was a deliberate choice to avoid the Detekt #8882 performance regression with type resolution in KMP monorepos. Third, the **convention plugin**: consuming projects adopt all enforcement rules with `id("com.grinx.androidcommondoc")` in their build.gradle.kts; the `afterEvaluate` timing ensures compatibility with AGP configuration ordering. Fourth, the **quality gate system**: 5 `.claude/agents/` files (script-parity-validator, skill-script-alignment, template-sync-validator, doc-code-drift-detector, quality-gate-orchestrator) provide automated consistency verification. The orchestrator inlines gate logic as a workaround for Claude Code's agent nesting limitation — this is a known fragility documented for future refactoring.

The 8 pattern documents (later expanded to 23 in M002) cover all KMP architectural layers: ViewModel state management, ephemeral event handling, state-driven navigation, Compose screen structure, testing with coroutines, KMP Gradle configuration, offline-first architecture, and Compose resource management. All documents were validated against current library versions at time of writing and include YAML frontmatter for registry scanning.

The 12 cross-platform script pairs follow a strict convention: every `.ps1` script has an identical-behavior `.sh` counterpart, with the `scripts/params-manifest.json` file as the single source of truth for parameter naming. The script-parity-validator quality gate enforces this invariant.

The four slices (Stabilize Foundation, Quality Gates and Enforcement, Distribution and Adoption, Audit Tech Debt Cleanup) represent the logical grouping of this foundational work. Because M001 was migrated from pre-GSD history, the slice plans are minimal templates — the actual implementation predates the GSD tracking system.

## Cross-Slice Verification

M001's success criteria are verified by the state of the repository at v1.0 release and the CHANGELOG.md entry:

- **Pattern documentation covers all KMP layers**: ✓ 8 pattern docs shipped covering ViewModel, UI, testing, Gradle, offline-first, resources, compose resources. All layers from the PROJECT.md architecture table are represented.
- **Code samples compilable against current library versions**: ✓ Documented in CHANGELOG.md v1.0 features section; versions-manifest.json tracks current versions.
- **Consistent script parameter naming**: ✓ scripts/params-manifest.json exists as single source of truth; script-parity-validator agent enforces behavioral equivalence.
- **Automated parity test suite**: ✓ script-parity-validator quality gate agent validates PS1/SH behavioral parity.
- **Custom Detekt rules enforce architecture patterns**: ✓ 5 AST-only rules in detekt-rules/ module; convention plugin integrates them.
- **Convention plugin enables one-line Gradle adoption**: ✓ build-logic/ convention plugin with opt-out DSL validated in consuming projects.
- **Canonical skill format generates multi-tool output**: ✓ adapters/ pipeline generates Claude Code commands + Copilot prompts from 16 SKILL.md sources.
- **AGENTS.md format adopted as base layer**: ✓ AGENTS.md exists at project root with 19 skills cataloged.
- **Claude Code hooks enforce real-time patterns**: ✓ .claude/hooks/ configuration for post-write and pre-commit Detekt enforcement.
- **Quality gate agents validate internal consistency**: ✓ 5 agents in .claude/agents/ covering script parity, skill alignment, template sync, doc drift, and orchestration.

The tech debt items (DEBT-01 through DEBT-04) listed in M001's scope were addressed in M002/S01 (Tech Debt Foundation), which is the correct sequencing — the foundation was built in M001, the cleanup happened in the first slice of M002.

## Requirement Changes

The following requirements transitioned from active to validated during and immediately after M001:

- **DEBT-01**: active → validated — Scripts fail fast with ANDROID_COMMON_DOC guard (M002/S01 env var implementation)
- **DEBT-02**: active → validated — install-copilot-prompts.sh delivers generated instructions standalone (M002/S01)
- **DEBT-03**: active → validated — quality-gate-orchestrator delegates to individual agent files (M002/S01)
- **DEBT-04**: active → validated — Orphaned validate-phase01-*.sh scripts removed (M002/S01)

The 15 core v1.0 requirements listed in PROJECT.md under Validated (pattern docs coverage, compilable samples, freshness tracking, script parameter consistency, parity tests, Detekt rules, convention plugin, Compose Rules integration, multi-tool skills, AGENTS.md format, Claude hooks, quality gate agents, cross-surface drift detection, token cost measurement) all transitioned from active to validated at v1.0 ship. These predate GSD requirement IDs and are reflected in PROJECT.md's Validated section.

## Forward Intelligence

### What the next milestone should know
- The adapter pipeline is stable but the adapters/ directory contains both Python scripts and generated output — future milestones should distinguish between source adapters (Python) and generated artifacts (`.claude/commands/`, `.github/`)
- The orchestrator inlining is a known tech debt item. When it is refactored, the correct approach is to extract validation logic into scripts that both the orchestrator and individual agents call — not to make agents call agents (Claude Code doesn't support nesting)
- The convention plugin uses `afterEvaluate` for AGP compatibility — any additions to the plugin must respect this timing constraint
- The `versions-manifest.json` file is the freshness tracking anchor; any new library additions to pattern docs should get a corresponding entry here
- skills/registry.json is the discovery mechanism — keep it in sync when adding or removing skills

### What's fragile
- **Orchestrator inlining** — quality-gate-orchestrator inlines the same logic as individual agents. When individual agents are updated, the orchestrator drifts. This was fixed in M002/S01 but was a known issue at M001 close.
- **Adapter-generated file staleness** — if SKILL.md files are updated without re-running `adapters/generate-all.sh`, the generated Claude Code commands and Copilot prompts go stale. The template-sync-validator catches this but only when explicitly run.
- **Konsist tests not yet present** — v1.0 has no cross-file architecture tests. The Detekt rules catch single-file violations only. Cross-module layer violations (e.g., a ViewModel importing a Data class directly) are not caught until Konsist is added in M002.

### Authoritative diagnostics
- `CHANGELOG.md` — canonical record of what shipped in each version; use as ground truth for feature presence
- `versions-manifest.json` — authoritative source for current library versions tracked by the toolkit
- `scripts/params-manifest.json` — single source of truth for script parameter naming across all surfaces
- `.claude/agents/quality-gate-orchestrator.md` — entry point for understanding the full quality gate system

### What assumptions changed
- **Orchestrator can delegate to agents**: Originally assumed Claude Code agents could call sub-agents. This is false — agents cannot nest. The workaround (inlining logic) ships in v1.0 and is replaced by script delegation in M002.
- **8 pattern docs covers all KMP layers**: Correct at v1.0, but M002 reveals that large docs (>400 lines) need splitting for token efficiency. 8 docs → 23 docs in M002 by splitting oversized files into hub+sub-doc pairs.

## Files Created/Modified

- `docs/` — 8 pattern documents covering all KMP architectural layers
- `skills/` — 16 SKILL.md canonical skill definitions
- `adapters/` — Python3 adapter pipeline for multi-tool generation
- `.claude/commands/` — Generated Claude Code slash commands (32 files from 16 skills)
- `.github/prompts/` — Generated GitHub Copilot prompt files
- `detekt-rules/` — 5 AST-only custom Detekt rules
- `build-logic/` — Convention plugin for one-line Gradle adoption
- `scripts/` — 12 cross-platform script pairs (ps1/ + sh/) + params-manifest.json
- `.claude/agents/` — 5 quality gate agents + orchestrator
- `.claude/hooks/` — Post-write and pre-commit enforcement hooks
- `versions-manifest.json` — Library version freshness tracking
- `AGENTS.md` — Universal AI instruction format (base layer)
- `CLAUDE.md` — Project-specific Claude Code instructions
- `README.md` — Public-facing toolkit documentation
- `CHANGELOG.md` — Version history starting at v1.0
