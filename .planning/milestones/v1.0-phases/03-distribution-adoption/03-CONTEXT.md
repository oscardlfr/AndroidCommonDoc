# Phase 3: Distribution and Adoption - Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

<domain>
## Phase Boundary

A consuming project adopts the full toolkit (Detekt rules, Compose rules, pattern enforcement) with a single Gradle plugin application — and gets real-time feedback during AI-assisted development via Claude Code hooks and GitHub Copilot instruction files that enforce the same patterns.

Requirements covered: LINT-02, TOOL-03

</domain>

<decisions>
## Implementation Decisions

### Convention plugin
- Full toolkit bundle: single `androidcommondoc.toolkit` plugin configures Detekt + custom rules JAR + Compose Rules 0.5.6 + test configuration + version alignment + all toolkit concerns
- Lives in `AndroidCommonDoc/build-logic/` — consuming projects include via composite build (`includeBuild("../AndroidCommonDoc/build-logic")`)
- Per-concern opt-out DSL: everything enabled by default, but consuming projects can disable individual concerns (detektRules, composeRules, testConfig) via extension block — essential for corporate adoption where teams control what they adopt
- Coexists with consuming project's own `build-logic/` — Gradle composite builds support multiple build-logic sources, no conflict

### Claude Code hooks
- Pre-commit trigger — fires before code is committed, catches violations before they enter git history
- Runs actual Detekt with custom rules JAR on changed files — same engine as CI, guaranteed consistency, no false negatives
- Configurable severity per project: default is block commit, but consuming projects can set warn-only mode via `--mode=block|warn` flag — allows gradual adoption in corporate environments
- Hook configuration distributed via setup script — existing install scripts extended to configure hooks in consuming project's `.claude/settings.json`

### Copilot parity
- Generated from canonical source using Phase 1 adapter pattern — same skill/pattern definitions generate both Claude hooks and Copilot instruction files
- Target location: `.github/copilot-instructions.md` in consuming project — standard GitHub Copilot custom instructions location
- Generator implemented as script pair (PS1/SH) consistent with Phase 1 adapter architecture — called by install-copilot-prompts script during setup
- Hooks ↔ instructions parity verification: Claude's discretion on whether to extend existing template-sync-validator or create separate mechanism

### Adoption flow
- Both unified and individual setup: `setup-toolkit.sh --project-root ../MyApp` for full setup, individual scripts (install-claude-skills, install-copilot-prompts, etc.) for selective adoption
- Setup scripts auto-modify consuming project's build files (settings.gradle.kts for includeBuild, module build.gradle.kts for plugin application) — idempotent, backs up before modifying
- Discovery: keep existing `$ANDROID_COMMON_DOC` env var pattern + `--project-root` flag for consuming project location
- Composite build approach for coexistence — consuming project's own build-logic/ and AndroidCommonDoc's build-logic/ both work as separate composite builds

### Claude's Discretion
- Hooks ↔ Copilot instructions sync validation approach (extend template-sync-validator vs separate)
- Convention plugin internal implementation details (extension DSL design, task registration)
- Detekt CLI invocation details in hook scripts (classpath, caching strategy)
- Copilot instruction content structure and formatting
- Backup strategy for auto-modified build files
- Setup script error handling and rollback behavior

</decisions>

<specifics>
## Specific Ideas

- Corporate adoption is a key concern — no tool or rule should be forced on teams; opt-out must be available at every level
- Convention plugin DSL should feel natural to Gradle users: `androidCommonDoc { detektRules { enabled = false } }`
- Setup script should print a summary of what was configured after completion
- Existing install scripts (Install-ClaudeSkills.ps1, install-claude-skills.sh, Install-CopilotPrompts.ps1, install-copilot-prompts.sh) are the base to extend, not replace

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `detekt-rules/` module: standalone Kotlin/JVM project with 5 architecture rules, Detekt 2.0.0-alpha.2, ready to be packaged as JAR dependency
- `setup/` directory: 4 install scripts (PS1/SH for Claude skills and Copilot prompts) — base for extension
- `setup/copilot-templates/`: 16 existing Copilot prompt templates — existing surface to augment
- `setup/templates/`: 16 wrapper templates — existing adapter output
- `skills/params.json`: canonical parameter manifest — setup scripts should reference for consistency
- `.claude/settings.json`: exists with deny rules — hooks configuration will extend this

### Established Patterns
- PS1/SH script pairs in `scripts/ps1/` and `scripts/sh/` with shared `scripts/lib/` — new scripts follow this pattern
- Adapter pattern from Phase 1: canonical definitions → per-tool generated files — Copilot instructions follow this
- `$ANDROID_COMMON_DOC` env var for toolkit location — setup scripts use this
- Claude commands as markdown with per-platform implementation blocks

### Integration Points
- Consuming projects use `includeBuild("../AndroidCommonDoc")` — will add `includeBuild("../AndroidCommonDoc/build-logic")` for convention plugin
- `.claude/settings.json` in consuming projects — hooks config added here
- `.github/copilot-instructions.md` in consuming projects — generated instruction file lives here
- `detekt-rules/build/libs/detekt-rules-1.0.0.jar` — convention plugin references this JAR

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-distribution-adoption*
*Context gathered: 2026-03-13*
