# Phase 13: Audit & Validate - Context

**Gathered:** 2026-03-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Map the documentation landscape across 4 projects (AndroidCommonDoc, shared-kmp-libs, DawSync, WakeTheCave) — classify every markdown file by correct L0/L1/L2 layer placement, score AI-readiness, identify gaps, validate freshness — producing an evidence-based audit report (machine-readable manifest + executive summary) that drives Phase 14 template design and Phase 15 CLAUDE.md rewrite. WakeTheCave is read-only mining. No files are modified in other projects — this phase produces reports only, with decisions taken collaboratively on stale refs.

</domain>

<decisions>
## Implementation Decisions

### WakeTheCave mining strategy
- Audit ALL 209 files equally (docs/ 199 + docs2/ 10) — no assumption about which directory is newer
- Conservative L0 promotion threshold: only promote if pattern is clearly sourced from official docs (Kotlin, Jetpack, KMP, Gradle)
- WakeTheCave-derived architectural insights stay as L2 candidates for manual review
- Produce full WakeTheCave doc health report (not just extraction) — includes advisory recommendations for WakeTheCave's own doc state
- Uniform AI-readiness scoring applied to WakeTheCave docs (same criteria as all projects, marked advisory-only since read-only)
- Preserve source directory structure in report (grouped by WakeTheCave subdirectory for review context)

### DawSync classification
- Audit ALL ~171 markdown files — docs/ (132), .claude/agents (11), .claude/commands (20+), .androidcommondoc/, root files — DawSync is the main project, nothing excluded
- Per-file output: current location, recommended layer (L0/L1/L2), AI-readiness score, action needed (promote/keep/consolidate)
- Classification is about correct layer placement, not just relevance — determine WHERE each doc belongs in L0/L1/L2
- Domain-specific knowledge (DAW capture, VST3, session management) stays L2
- Generic patterns that could become templates flagged for L0/L1 promotion
- Some DawSync patterns should override shared-kmp-libs (L2 overriding L1) — flag these explicitly
- Agents/commands get full layer classification — if a pattern like test-specialist is generic enough, flag for L0 promotion

### shared-kmp-libs (L1) audit
- Gap analysis per module: for each of the 15 modules, document what exists and what's missing
- Target documentation level: comprehensive API-level docs oriented for AI spec-driven development — public API surface, usage examples, enforced conventions — structured for token-efficient agent consumption
- Check 5 docs/ files for L0 promotion candidates (ERROR_HANDLING_PATTERN, TESTING_STRATEGY may be generic enough)
- Assess CLAUDE.md (57 lines) quality — flag gaps in module conventions, L0 references, build patterns — evidence for Phase 15
- AI-readiness scoring on all 22 markdown files, same criteria as other projects

### Audit report deliverable format
- Machine-readable manifest (JSON/YAML) with per-file entries: path, current layer, recommended layer, AI-readiness score (0-5), action, freshness status, overlaps
- Executive summary (markdown) with layer distribution + action counts per project, top findings, cross-project statistics (L0 candidate count, overlap count, freshness issues)
- All deliverables stored in .planning/phases/13-audit-validate/
- AI-readiness scoring criteria (standard 0-5): (1) has YAML frontmatter, (2) section size ≤150 lines, (3) proper subdivision by concern, (4) no stale version refs, (5) actionable content (not vague)

### monitor-sources execution scope
- Run against: AndroidCommonDoc 23 pattern docs + shared-kmp-libs 5 docs/ files + DawSync L1 pattern doc + all version refs across all 4 projects
- Freshness results integrated into the main audit manifest (per-file freshness status, not a separate report)
- Report-only — no auto-fixes. Stale refs reported and decisions taken collaboratively
- STATE.md decision honored: monitor-sources runs AFTER all content is discovered (avoid stale propagation)

### Guiding principle
- AI spec-driven optimization is the north star — all docs should be optimized for correct L0/L1/L2 placement, context management, and token cost savings
- DawSync doc audit MUST complete before Phase 14 template design (STATE.md decision — pitfall: premature abstraction)
- Uniform treatment across all 4 projects — same scoring criteria, same manifest format

### Claude's Discretion
- Technical approach for handling docs without monitor_urls frontmatter (flag + suggest URLs vs skip vs auto-add — whatever enables v1.2 cleanly without losing valuable documentation)
- Exact manifest schema (JSON vs YAML, field naming, nesting structure)
- Audit execution order across projects (DawSync first given it's most current, or parallel)
- How to detect content overlaps between projects (text similarity, topic matching, manual cross-reference)
- WakeTheCave docs/ subdirectory structure analysis depth (how deep to trace the 01-architecture/patterns/ tree)
- shared-kmp-libs per-module doc plan format (what the gap analysis entries look like)
- Freshness severity classification (what's HIGH vs MEDIUM vs LOW for stale version refs)

</decisions>

<specifics>
## Specific Ideas

- User emphasized: "EVERYTHING — this is our main project" about DawSync scope — no files excluded from audit
- User knows DawSync has patterns that should override shared-kmp-libs (L2>L1) — the audit must surface these
- User wants "the cleanest, most professional, solid, clean, maintainable enterprise approach" — consistent across all prior phases
- All documentation must be oriented towards AI spec-driven development — token-efficient, concise, structured for agent consumption
- WakeTheCave started as a pure Android app — has Android-specific knowledge that could be valuable as L0 patterns in AndroidCommonDoc
- shared-kmp-libs module docs should be comprehensive API-level documentation but structured for AI spec-driven consumption
- User wants to take freshness decisions together (collaborative) — no auto-fixing stale refs
- The audit is evidence-gathering for Phase 14 template design — must produce actionable data, not just inventory

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `mcp-server/src/tools/monitor-sources.ts`: Source monitoring tool — run against expanded corpus for AUDIT-05 freshness validation
- `mcp-server/src/cli/monitor-sources.ts`: CLI entrypoint for monitor-sources — can be invoked directly for audit
- `mcp-server/src/tools/check-freshness.ts`: Legacy freshness check — may overlap with monitor-sources
- `mcp-server/src/registry/scanner.ts`: Dynamic directory scanner with frontmatter parsing — reuse for auditing frontmatter presence/quality across projects
- `mcp-server/src/registry/frontmatter.ts`: YAML frontmatter parser — use for AI-readiness scoring (criterion 1: has frontmatter)
- `mcp-server/src/registry/resolver.ts`: L0/L1/L2 layer resolution — reference model for layer classification logic
- `mcp-server/src/registry/project-discovery.ts`: Auto-discover consumer projects — use to find all projects to audit

### Established Patterns
- L0>L1>L2 full replacement semantics in resolver (Phase 9) — classification model for the audit
- YAML frontmatter with scope/sources/targets (Phase 9-10) — AI-readiness criterion 1
- Dynamic registry scan, no hardcoded lists (Phase 9) — audit should discover, not hardcode
- Token-efficient doc format: ≤150 lines per section, frontmatter, proper subdivision (project core value)
- SHA-256 content hashing (Phase 11) — could detect near-duplicate content across projects

### Integration Points
- `docs/*.md` (23 files): AndroidCommonDoc pattern docs — audit target + freshness check
- `C:/Users/34645/AndroidStudioProjects/shared-kmp-libs/`: L1 ecosystem — 22 markdown files to audit
- `C:/Users/34645/AndroidStudioProjects/DawSync/`: Main project — ~171 markdown files to audit
- `C:/Users/34645/AndroidStudioProjects/WakeTheCave/WakeTheCave/`: Read-only mining — 209 markdown files
- `~/.androidcommondoc/vault-config.json`: Project paths and configuration — source for project locations

</code_context>

<deferred>
## Deferred Ideas

- **Standard doc template design** — User wants all projects to use a standard AI-optimized doc pattern. This is Phase 14 (STRUCT-01, STRUCT-02) — the audit provides evidence, Phase 14 designs the template
- **Auto-fixing stale version refs** — Discussed and explicitly deferred to collaborative decision-making after the audit report
- **OmniSound audit** — Explicitly out of scope per v1.2 requirements (deferred to future milestone)
- **WakeTheCave doc restructuring** — WakeTheCave is read-only for Phase 13; any restructuring would be WakeTheCave's own initiative

</deferred>

---

*Phase: 13-audit-validate*
*Context gathered: 2026-03-14*
