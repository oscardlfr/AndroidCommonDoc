# Phase 17: Documentation Structural Homogeneity - Context

**Gathered:** 2026-03-16
**Status:** Ready for planning
**Source:** Direct conversation — user rejected Phase 16 checkpoint after visual vault inspection

<domain>
## Phase Boundary

Fix all vault sync bugs, restructure ALL source docs across L0/L1/L2 for structural homogeneity (hub->sub-doc, naming, frontmatter), build cross-layer validation tooling, align CLAUDE.md files to Boris Cherny style, and perform a validated vault resync. The vault must be clean, deduplicated, navigable, and structurally homogeneous when complete.

</domain>

<decisions>
## Implementation Decisions

### Vault Sync Bugs (LOCKED)
- vault-config.json MUST exclude `.planning/codebase/**` and `.planning/research/**` from DawSync collection — these leak UPPERCASE duplicates
- Transformer MUST NOT produce both UPPERCASE_SNAKE and lowercase-kebab versions of the same file — one canonical naming only (lowercase-kebab-case)
- Subproject naming in vault must be normalized (no "DawSyncWeb" vs "web" duplication)
- Deduplication check must run BEFORE vault materialization — reject sync if duplicates detected

### Hub->Sub-doc Pattern (LOCKED)
- ALL docs across L0/L1/L2 must follow hub->sub-doc pattern where applicable
- Hub docs: <100 lines, summarize + link to sub-docs
- Sub-docs: <300 lines, focused on single topic
- L0 gaps: compose/ needs hub file, storage/ needs hub file, guides/ needs reorganization
- L1 gaps: 54 scattered module READMEs need consolidation with 31 docs/ files into unified structure
- L2 gaps: archive/ bloat cleanup, .planning/ overlap removal

### Cross-Layer Validation Tooling (LOCKED)
- Build MCP tools that detect: duplicates across vault, structural homogeneity violations, broken L2->L1->L0 references, missing wikilinks
- Validation must run before vault sync and flag issues
- Each layer must observe the layer below correctly (L2 refs L1, L1 refs L0)

### CLAUDE.md Alignment (LOCKED)
- Follow Boris Cherny's CLAUDE.md style: concise, categorized sections (Workflow, Tasks, Principles), actionable rules, no fluff
- All 4 CLAUDE.md files (L0 global, L0 toolkit, L1, L2) must be restructured
- Context budget: <150 lines per CLAUDE.md

### Source Doc Restructuring Scope (LOCKED)
- L0 (AndroidCommonDoc): Fix hub gaps (compose, storage, guides), ensure all 14 categories have consistent hub->sub-doc structure
- L1 (shared-kmp-libs): Consolidate module docs into coherent structure, enforce hub->sub-doc in all 10 categories
- L2 (DawSync): Clean archive (21 root + CODEX_AUDITY + superseded), remove .planning/ content overlap, normalize subproject docs (DawSyncWeb, SessionRecorder-VST3)
- File naming: ALL files must be lowercase-kebab-case across all layers

### Final Vault Resync (LOCKED)
- Run ALL validation tools before sync
- Vault must have: 0 duplicates, 0 orphans, consistent naming, working wikilinks
- Human checkpoint: user verifies Obsidian graph view, MOC navigation, wikilink connectivity

### Claude's Discretion
- Internal implementation of MCP validation tools (test structure, assertion patterns)
- Specific hub doc content for L0 compose/ and storage/ hubs
- Archive cleanup strategy details (what to keep vs. delete in DawSync archive)
- Wikilink injection heuristics refinement

</decisions>

<specifics>
## Specific Ideas

- Boris Cherny CLAUDE.md reference: ## Workflow Orchestration (Plan Mode Default, Subagent Strategy, Self-Improvement Loop, Verification Before Done, Demand Elegance, Autonomous Bug Fixing), ## Task Management (Plan First, Verify Plan, Track Progress, Explain Changes, Document Results, Capture Lessons), ## Core Principles (Simplicity First, No Laziness, Minimal Impact)
- User quote: "cada L0 L1 L2 deberian de estar estructurados a nivel de archivos y optimizados por igual"
- User quote: "los patterns estan agrupados excesivamente y no has hecho sub patrones con not to do etc"
- User wants master documents optimized for token consumption — agents load hub first, sub-docs on demand
- Vault duplication root cause: .planning/codebase/ has ARCHITECTURE.md, CONCERNS.md, CONVENTIONS.md, INTEGRATIONS.md, STACK.md, STRUCTURE.md, TESTING.md — all overlap with docs/ content
- DawSync architecture/ shows: PATTERNS.md + patterns-offline-first.md (duplicate pair), SYSTEM_ARCHITECTURE.md + system-architecture.md, etc.

</specifics>

<deferred>
## Deferred Ideas

- OmniSound documentation (no docs/ directory yet — too early stage)
- WakeTheCave documentation alignment (not in active scope)
- Command promotion to skills (from Phase 14.2.1 decision — 11 commands recommended)

</deferred>

---

*Phase: 17-documentation-structural-homogeneity*
*Context gathered: 2026-03-16 from user conversation + vault inspection*
