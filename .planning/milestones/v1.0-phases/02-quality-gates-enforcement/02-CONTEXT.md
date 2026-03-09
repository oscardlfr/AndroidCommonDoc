# Phase 2: Quality Gates and Enforcement - Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Automated systems that catch pattern violations, documentation staleness, script divergence, and cross-surface drift between Claude Code and GitHub Copilot — so correctness and tool parity are verified continuously, not just when someone remembers to check.

Requirements covered: PTRN-03, SCRP-03, LINT-01, LINT-03, QUAL-01, QUAL-02, QUAL-03

</domain>

<decisions>
## Implementation Decisions

### Detekt rule enforcement
- All 5 architecture patterns enforced: sealed UiState, CancellationException rethrow, no platform deps in ViewModels, WhileSubscribed(5000) timeout, no Channel for UI events
- All 5 ship in v1 — enforcement matches what docs already promise
- Claude's discretion on severity defaults (error vs warning) and distribution approach (standalone JAR vs convention plugin vs hybrid)
- Compose Rules (mrmans0n 0.5.6) integration approach at Claude's discretion — determine best way to run alongside custom Detekt rules without conflicts
- NOTE: STATE.md blocker — research Detekt type resolution performance in KMP monorepos (known issue #8882) before committing to type-resolution-dependent rules

### Quality gate orchestration
- Quality gates remain as Claude Code agents in `.claude/agents/`
- Both unified orchestrator AND individual gate invocation — unified for full check, individual for debugging
- Unified report format: structured markdown text with sections per gate, pass/fail per check, overall status
- Cross-surface semantic drift detection (QUAL-02) folded into existing template-sync-validator agent — one agent handles all cross-surface sync concerns

### Freshness & drift detection
- Version manifest comparison approach — maintain a versions source of truth, compare doc version refs against it, flag mismatches. Deterministic, no network needed
- Both agent (doc-code-drift-detector for comprehensive check) AND lightweight script pair (PS1/SH for CI quick-check)
- Claude's discretion on whether to also check deprecated API usage in code samples, or version numbers only
- Script parity testing (SCRP-03): static analysis — parse PS1 param blocks and SH getopts/case to compare flags, exit codes, output patterns. No execution needed

### Token cost measurement
- Claude's discretion on cost metric (prompt+response tokens, skill definition size, or hybrid)
- Token cost data included as section in unified quality gate report — computed on each run, no separate persistence
- All 18 skills measured — automated anyway, marginal cost of all vs some is near zero
- Claude's discretion on whether to include manual baseline comparison

### Claude's Discretion
- Detekt rule severity defaults (error vs warning per rule)
- Detekt rule distribution mechanism (standalone JAR, convention plugin, or hybrid)
- Compose Rules 0.5.6 integration approach with Detekt
- Deprecated API detection scope (versions only vs versions + APIs)
- Token cost metric definition and baseline comparison approach
- Quality gate agent internal implementation details
- Script parity test framework and output format

</decisions>

<specifics>
## Specific Ideas

- Phase 1 pinned versions in doc headers (Koin 4.1.1, Kotlin 2.3.10, AGP 9.0.0) — freshness tracking should check exactly these references
- 4 agent specs already exist in `.claude/agents/` with detailed output format specs — implementation should match those formats
- params.json from Phase 1 is the canonical parameter source — script parity validation should cross-reference it
- Success criteria #5 requires "single pass/fail status" — unified orchestrator must produce this

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- 4 quality gate agent specs in `.claude/agents/` — detailed check descriptions and output formats already defined
- `skills/params.json` — canonical parameter manifest for cross-referencing script flags
- 18 SKILL.md files in `skills/` — subjects for token cost measurement
- 12 PS1/SH script pairs in `scripts/` — subjects for parity testing
- 8 pattern docs in `docs/` with pinned version numbers — subjects for freshness tracking

### Established Patterns
- Agent specs use YAML frontmatter (name, description, tools, model, memory) + markdown body
- Scripts split into `scripts/ps1/` and `scripts/sh/` with shared `scripts/lib/`
- PS1 uses `param()` blocks with PascalCase; SH uses getopts/case with kebab-case
- Claude commands in `.claude/commands/` have implementation blocks per platform

### Integration Points
- Consuming projects add Detekt rule JAR via `detektPlugins` dependency
- Quality gate agents invoked via Claude Code agent system
- Freshness script pair would join existing `scripts/ps1/` and `scripts/sh/` directories
- Version manifest derived from or aligned with shared-kmp-libs version catalog

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-quality-gates-enforcement*
*Context gathered: 2026-03-13*
