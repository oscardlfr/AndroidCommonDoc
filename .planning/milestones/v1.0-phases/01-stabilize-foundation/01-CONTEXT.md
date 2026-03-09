# Phase 1: Stabilize Foundation - Context

**Gathered:** 2026-03-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Make every pattern doc, script parameter, and skill definition internally consistent and follow a single canonical format. Claude Code and GitHub Copilot receive identical guidance from the same source. Eliminates multi-surface drift that compounds with every new feature.

Requirements covered: PTRN-01, PTRN-02, SCRP-01, SCRP-02, TOOL-01, TOOL-02

</domain>

<decisions>
## Implementation Decisions

### Pattern doc depth & gaps
- Include anti-patterns in each pattern doc alongside correct patterns ("Do this" AND "Don't do this") — helps AI agents avoid common mistakes without extra tokens
- Pin actual library versions in code samples (e.g., koin 4.1.1, compose 1.7.x) — Phase 2 freshness tracking will flag when they go stale
- 9 existing docs in docs/ — completeness validated against the 7 required layers (ViewModel, UI, testing, Gradle, offline-first, resources, compose resources)

### Canonical skill definition
- Skill definitions must capture: usage examples, behavior description (step-by-step), cross-references to pattern docs, expected output format — plus any additional fields Claude deems necessary
- Adapter pattern for multi-tool generation: one canonical definition + one adapter per AI tool. Adding a new tool (Codex, Cursor) = write an adapter, no existing Claude/Copilot files change
- All 4 selected + Claude can create additional fields as needed

### Parameter naming resolution
- `--project-root` wins over `--project-path` — matches PS1 convention (-ProjectRoot) and Gradle's rootProject concept
- Canonical case is kebab-case in the manifest (project-root). Generator maps to PascalCase for PS1 (-ProjectRoot), kebab for SH (--project-root)
- Standalone parameter manifest file as single source of truth for ALL parameters across ALL skills — skills reference parameters by name from the manifest

### Claude's Discretion
- Pattern doc organization: categories, ordering, internal structure per doc — optimize for professional presentation and logical adoption sequence
- Source of truth for docs: repo docs/ vs ~/.claude/docs/ relationship — determine best single-source approach
- Canonical skill definition file location in repo
- Skill generator trigger mechanism (manual script, setup step, or hybrid)
- AGENTS.md content scope (architecture rules, skill index, full reference — determine optimal coverage)
- AGENTS.md authoring approach (generated, hand-authored, or hybrid)
- AGENTS.md adoption mechanism for consuming projects (copy on setup, symlink, composite build access)

</decisions>

<specifics>
## Specific Ideas

- User wants docs organized "more professionally" — categories, logical ordering, consistent internal structure
- Enterprise proposal (propuesta-integracion-enterprise.md) is separate from pattern docs — it's adoption/marketing material
- Existing confirmed drift: Claude command test.md uses `--project-root`, Copilot test.prompt.md uses `--project-path` — this is the exact problem Phase 1 solves
- Open/closed principle is a hard constraint: new AI tools must be addable without modifying any existing Claude or Copilot files

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- 9 pattern docs in `docs/` — base content exists, needs completion and consistency pass
- 16 Claude commands in `.claude/commands/` — current generated output to reverse-engineer canonical format from
- 16 Copilot prompt templates in `setup/copilot-templates/` — second generated surface, shows current drift
- 16 wrapper templates in `setup/templates/` — third surface
- 4 quality gate agents in `.claude/agents/` (doc-code-drift-detector, script-parity-validator, skill-script-alignment, template-sync-validator)
- Install scripts exist: `Install-ClaudeSkills.ps1`, `Install-CopilotPrompts.ps1`, `install-claude-skills.sh`, `install-copilot-prompts.sh`

### Established Patterns
- Scripts split into `scripts/ps1/` and `scripts/sh/` with shared `scripts/lib/`
- Claude commands are markdown with implementation sections per platform (macOS/Linux bash, Windows PowerShell)
- Copilot templates use frontmatter (mode: agent, description) with `${input:name}` variable syntax
- PS1 uses splatting (`@params`) with PascalCase parameter names
- All scripts depend on `$ANDROID_COMMON_DOC` env var pointing to this repo

### Integration Points
- Consuming projects use `includeBuild("../AndroidCommonDoc")` or `$ANDROID_COMMON_DOC` env var
- CLAUDE.md in consuming projects references patterns from this repo
- No AGENTS.md exists yet — needs to be created as universal AI tool entry point

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-stabilize-foundation*
*Context gathered: 2026-03-12*
