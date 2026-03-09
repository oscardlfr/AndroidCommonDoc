# Phase 1: Stabilize Foundation - Research

**Researched:** 2026-03-12
**Domain:** Documentation consistency, cross-platform script parameter normalization, canonical skill definitions with multi-AI-tool generation
**Confidence:** HIGH

## Summary

Phase 1 addresses three interrelated consistency problems in AndroidCommonDoc: (1) pattern docs that are incomplete or drifted between their repo copy (`docs/`) and user-level copy (`~/.claude/docs/`), (2) script parameters that use different names across PS1, SH, Claude commands, Copilot prompts, and the Makefile, and (3) the lack of a canonical skill definition format that generates equivalent output for multiple AI tools.

The existing codebase has 9 pattern docs, 16 Claude commands, 16 Copilot prompt templates, 16 wrapper templates, 4 quality gate agents, and 12 script pairs (PS1 + SH). Research confirms concrete drift: 2 of 12 PS1 scripts use `-ProjectPath` while 10 use `-ProjectRoot`; the Copilot `test.prompt.md` uses `--project-path` while the Claude `test.md` uses `--project-root`; and 6 of 8 docs have drifted between the repo and `~/.claude/docs/`. The AGENTS.md format is an open standard supported by 30+ AI tools and should serve as the universal base layer. The Agent Skills open standard (agentskills.io) provides a cross-tool SKILL.md format already supported by Claude Code, GitHub Copilot (via VS Code), Cursor, OpenAI Codex, Gemini CLI, and others.

**Primary recommendation:** Establish `docs/` in the repo as the single source of truth for pattern docs (with the install scripts copying to `~/.claude/docs/`), create a JSON parameter manifest as the canonical source for all script interfaces, and define canonical skill definitions using the Agent Skills SKILL.md format with adapter scripts that generate both Claude commands and Copilot prompt files.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Include anti-patterns in each pattern doc alongside correct patterns ("Do this" AND "Don't do this") -- helps AI agents avoid common mistakes without extra tokens
- Pin actual library versions in code samples (e.g., koin 4.1.1, compose 1.7.x) -- Phase 2 freshness tracking will flag when they go stale
- 9 existing docs in docs/ -- completeness validated against the 7 required layers (ViewModel, UI, testing, Gradle, offline-first, resources, compose resources)
- Skill definitions must capture: usage examples, behavior description (step-by-step), cross-references to pattern docs, expected output format -- plus any additional fields Claude deems necessary
- Adapter pattern for multi-tool generation: one canonical definition + one adapter per AI tool. Adding a new tool (Codex, Cursor) = write an adapter, no existing Claude/Copilot files change
- All 4 selected + Claude can create additional fields as needed
- `--project-root` wins over `--project-path` -- matches PS1 convention (-ProjectRoot) and Gradle's rootProject concept
- Canonical case is kebab-case in the manifest (project-root). Generator maps to PascalCase for PS1 (-ProjectRoot), kebab for SH (--project-root)
- Standalone parameter manifest file as single source of truth for ALL parameters across ALL skills -- skills reference parameters by name from the manifest
- Open/closed principle is a hard constraint: new AI tools must be addable without modifying any existing Claude or Copilot files

### Claude's Discretion
- Pattern doc organization: categories, ordering, internal structure per doc -- optimize for professional presentation and logical adoption sequence
- Source of truth for docs: repo docs/ vs ~/.claude/docs/ relationship -- determine best single-source approach
- Canonical skill definition file location in repo
- Skill generator trigger mechanism (manual script, setup step, or hybrid)
- AGENTS.md content scope (architecture rules, skill index, full reference -- determine optimal coverage)
- AGENTS.md authoring approach (generated, hand-authored, or hybrid)
- AGENTS.md adoption mechanism for consuming projects (copy on setup, symlink, composite build access)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PTRN-01 | All KMP architecture layers have complete pattern documentation (ViewModel, UI, testing, Gradle, offline-first, resources, compose resources) | 9 docs exist but only 7 layers are required; 2 extras (kmp-architecture, resource-management) serve supporting roles. 6 of 8 pattern docs have drifted between repo and user-level copies. All need a consistency pass with anti-patterns, pinned versions, and compilable samples. |
| PTRN-02 | Code samples in pattern docs are compilable and verified against current library versions | Pattern docs currently reference libraries but not all have pinned versions. Testing doc pins kotlinx-coroutines-test:1.10.2 and mockk:1.14.7. Gradle doc shows Kotlin 2.3.10, AGP 9.0.0, Compose 1.10.0. A validation script needs to extract version references and cross-check against the catalog. |
| SCRP-01 | All script parameters use consistent naming across PS1, SH, Claude commands, and Copilot prompts | Research found 2/12 PS1 scripts use `-ProjectPath` (run-parallel-coverage-suite, run-changed-modules-tests), 2/12 SH scripts use `--project-path` (same pair). Copilot test.prompt.md uses `--project-path` while Claude test.md uses `--project-root`. Makefile uses both. |
| SCRP-02 | Script parameter manifest exists as single source of truth for all script interfaces | No manifest exists today. Needs to be created as a structured data file (JSON recommended) with canonical kebab-case names, type info, defaults, and per-tool case mapping rules. |
| TOOL-01 | Canonical skill definition format generates tool-specific files for Claude Code, GitHub Copilot, and future tools | No canonical definitions exist today. 16 Claude commands, 16 Copilot prompts, and 16 wrapper templates are maintained independently. Agent Skills SKILL.md format (agentskills.io) is the industry standard, supported by 30+ tools. Adapter pattern maps one definition to multiple outputs. |
| TOOL-02 | AGENTS.md universal instruction format adopted as base layer for all AI tool integrations | No AGENTS.md exists in the project. The AGENTS.md standard is a simple Markdown file recognized by 20,000+ repos and 20+ AI tools. Should be generated from pattern docs and skill index as a single entry point for any AI tool. |
</phase_requirements>

## Standard Stack

### Core
| Component | Format/Tool | Purpose | Why Standard |
|-----------|-------------|---------|--------------|
| Parameter manifest | JSON (`skills/params.json`) | Single source of truth for all script parameters | Machine-parseable, supports schema validation, maps to kebab/PascalCase easily |
| Canonical skill defs | SKILL.md (Agent Skills format) | Skill definitions that generate tool-specific files | Open standard (agentskills.io) supported by Claude Code, Copilot, Codex, Cursor, Gemini CLI, 25+ others |
| AGENTS.md | Markdown | Universal AI tool base layer | Adopted by 60K+ repos, supported by all major AI coding tools |
| Pattern docs | Markdown in `docs/` | Architecture pattern documentation | Existing format, well-established in repo |

### Supporting
| Component | Format/Tool | Purpose | When to Use |
|-----------|-------------|---------|-------------|
| Adapter scripts | Node.js or Bash | Generate tool-specific files from canonical definitions | Run during setup/install or as manual generation step |
| Install scripts | PS1 + SH | Deploy generated files to consuming projects | Existing `Install-ClaudeSkills.ps1` and `install-claude-skills.sh` -- extend to support new format |
| Copilot instructions | `.github/instructions/*.instructions.md` | Path-scoped Copilot guidance with `applyTo` frontmatter | Already 4 exist in `setup/copilot-templates/instructions/` |
| Claude commands | `.claude/commands/*.md` | Claude Code slash commands | Generated output from canonical definitions |
| Copilot prompts | `.github/prompts/*.prompt.md` | Copilot reusable prompt files | Generated output from canonical definitions |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| JSON manifest | YAML manifest | YAML is more readable but JSON is stricter, less error-prone, and native to Node.js tooling |
| Agent Skills SKILL.md | Custom canonical format | Custom gives more control but Agent Skills is already the cross-tool standard and understood by multiple agents natively |
| Generated AGENTS.md | Hand-authored AGENTS.md | Hand-authored is simpler initially but drifts from pattern docs; hybrid (generated skeleton + hand-authored sections) is optimal |

## Architecture Patterns

### Recommended Project Structure
```
AndroidCommonDoc/
├── docs/                           # Pattern docs (source of truth)
│   ├── viewmodel-state-patterns.md
│   ├── ui-screen-patterns.md
│   ├── testing-patterns.md
│   ├── gradle-patterns.md
│   ├── offline-first-patterns.md
│   ├── compose-resources-patterns.md
│   └── resource-management-patterns.md
├── skills/                         # Canonical skill definitions
│   ├── params.json                 # Parameter manifest (single source of truth)
│   ├── test/
│   │   └── SKILL.md               # Canonical definition for /test
│   ├── coverage/
│   │   └── SKILL.md               # Canonical definition for /coverage
│   └── ...                         # One directory per skill
├── adapters/                       # Tool-specific generators
│   ├── claude-adapter.js           # Generates .claude/commands/*.md
│   ├── copilot-adapter.js          # Generates .github/prompts/*.prompt.md
│   └── README.md                   # How to add a new adapter
├── .claude/
│   ├── commands/                   # GENERATED -- do not edit manually
│   │   ├── test.md
│   │   └── ...
│   └── agents/                     # Quality gate agents (hand-authored)
├── setup/
│   ├── copilot-templates/          # GENERATED -- do not edit manually
│   │   ├── test.prompt.md
│   │   └── instructions/
│   ├── templates/                  # GENERATED wrapper templates
│   └── Install-ClaudeSkills.ps1    # Updated to use canonical defs
├── scripts/
│   ├── ps1/                        # PowerShell scripts (use -ProjectRoot)
│   ├── sh/                         # Bash scripts (use --project-root)
│   └── lib/                        # Shared cross-platform utilities
├── AGENTS.md                       # Universal AI tool entry point
└── SKILLS-README.md                # Human reference for all skills
```

### Pattern 1: Canonical Skill Definition (Agent Skills Format)
**What:** Each skill lives in a `skills/<name>/SKILL.md` directory using the Agent Skills open standard. The SKILL.md contains the complete behavioral specification. Adapters read this file and generate tool-specific outputs.
**When to use:** For every skill/command in the toolkit.
**Example:**
```markdown
# skills/test/SKILL.md
---
name: test
description: Run tests for a module with intelligent retry logic and error extraction.
metadata:
  author: AndroidCommonDoc
  version: "1.0"
  params:
    - module
    - test-type
    - skip-coverage
    - coverage-tool
---

## Usage Examples

/test core:domain
/test core:data --test-type common
/test feature:home --test-type androidUnit

## Parameters

Uses parameters from `params.json`: module, test-type, skip-coverage, coverage-tool

## Behavior

1. **Detect project type** (KMP Desktop vs Android)
2. **Determine test task** based on test type
3. **Run tests** with intelligent retry:
   - Attempt 1: Fast run
   - Attempt 2: Stop daemons + Clean + Run (if daemon error detected)
4. **Generate coverage report** (unless skipped)
5. **Extract errors** if tests fail

## Implementation

### macOS / Linux
```bash
COMMON_DOC="${ANDROID_COMMON_DOC:?ANDROID_COMMON_DOC is not set}"
"$COMMON_DOC/scripts/sh/gradle-run.sh" --project-root "$(pwd)" $ARGUMENTS
```

### Windows
```powershell
$commonDoc = $env:ANDROID_COMMON_DOC
& "$commonDoc\scripts\ps1\gradle-run.ps1" -ProjectRoot (Get-Location).Path @params
```

## Expected Output

- Test results summary (passed/failed/skipped)
- Coverage percentage (unless skipped)
- If failed: actionable items with suggested fixes

## Cross-References

- Pattern: docs/testing-patterns.md
- Script: scripts/sh/gradle-run.sh, scripts/ps1/gradle-run.ps1
```

### Pattern 2: Parameter Manifest (JSON)
**What:** A single JSON file that is the canonical definition of every parameter used across all scripts and skills.
**When to use:** Referenced by adapters to generate correct parameter names per tool surface.
**Example:**
```json
{
  "$schema": "./params.schema.json",
  "parameters": {
    "project-root": {
      "type": "path",
      "description": "Path to the project root directory",
      "default": "$(pwd)",
      "required": false,
      "mapping": {
        "ps1": "ProjectRoot",
        "sh": "--project-root",
        "copilot": "${input:projectRoot:Path to project root}",
        "makefile": "--project-root"
      }
    },
    "module": {
      "type": "string",
      "description": "Gradle module path (e.g., core:domain, feature:home)",
      "required": false,
      "mapping": {
        "ps1": "Module",
        "sh": "--module",
        "copilot": "${input:module:Gradle module path}",
        "makefile": "--module"
      }
    },
    "test-type": {
      "type": "enum",
      "values": ["all", "common", "androidUnit", "androidInstrumented", "desktop"],
      "default": "all",
      "description": "Test type to run",
      "mapping": {
        "ps1": "TestType",
        "sh": "--test-type",
        "copilot": "${input:testType:all|common|androidUnit|androidInstrumented|desktop}"
      }
    }
  }
}
```

### Pattern 3: Adapter Pattern (Open/Closed Principle)
**What:** Each AI tool has its own adapter script that reads canonical SKILL.md files and the parameter manifest, then generates tool-specific output files. Adding a new tool means adding a new adapter -- never modifying existing ones.
**When to use:** Every time a canonical definition changes or a new skill is added.
**Example adapter interface:**
```javascript
// adapters/claude-adapter.js
// Reads: skills/*/SKILL.md + skills/params.json
// Writes: .claude/commands/*.md

// adapters/copilot-adapter.js
// Reads: skills/*/SKILL.md + skills/params.json
// Writes: setup/copilot-templates/*.prompt.md
//         setup/copilot-templates/instructions/*.instructions.md

// Future: adapters/codex-adapter.js (v2 scope)
// Adding this file does NOT modify claude-adapter.js or copilot-adapter.js
```

### Pattern 4: AGENTS.md as Universal Entry Point
**What:** A single AGENTS.md at the repo root that any AI tool can read. Contains architecture rules, available skill index, and key patterns. Hybrid approach: generated skeleton from pattern docs + hand-authored contextual sections.
**When to use:** Read by any AI coding agent working on projects that consume AndroidCommonDoc.
**Recommended length:** Under 150 lines (per AGENTS.md best practices from analysis of 2,500+ repos).
**Recommended sections:**
1. Build/test commands
2. Architecture (the 5-layer table)
3. Key conventions (sealed UiState, CancellationException, UiText, etc.)
4. Available skills index
5. Boundaries (what NOT to do)

### Anti-Patterns to Avoid
- **Manual multi-surface editing:** Never edit Claude commands, Copilot prompts, and wrapper templates independently. Always edit the canonical SKILL.md and regenerate.
- **Duplicated pattern docs:** Never maintain the same doc in both `docs/` and `~/.claude/docs/`. Use the repo as source of truth and the install script to distribute.
- **Implicit parameter names:** Never add a new parameter to a script without adding it to `params.json` first.
- **AGENTS.md as complete documentation:** Keep it under 150 lines. Reference detailed docs, don't duplicate them.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-tool skill format | Custom skill schema | Agent Skills SKILL.md (agentskills.io) | Already supported by 30+ tools natively; Claude Code reads SKILL.md directly |
| Parameter case mapping | Per-script manual naming | JSON manifest with mapping rules | Single source of truth prevents drift; case conversion rules are mechanical |
| AGENTS.md format | Custom instruction format | Standard AGENTS.md format | Recognized by Claude Code, Copilot, Codex, Cursor, Gemini, etc. without configuration |
| Copilot custom instructions | Custom instruction delivery | `.github/copilot-instructions.md` + `.github/instructions/*.instructions.md` | Native Copilot format with `applyTo` glob support for path-scoped rules |
| Template variable substitution | Custom templating engine | Simple string replacement in adapters | The formats are simple enough (Markdown + frontmatter); a full templating engine adds unnecessary complexity |

**Key insight:** The AI tool ecosystem has converged on SKILL.md (Agent Skills) and AGENTS.md as standards. Building custom formats means maintaining format documentation and tool compatibility indefinitely, while standards are maintained by the community and tool vendors.

## Common Pitfalls

### Pitfall 1: Circular Source of Truth
**What goes wrong:** Pattern docs reference canonical definitions which reference pattern docs, creating confusion about which to edit.
**Why it happens:** Unclear ownership between `docs/`, `skills/`, and generated output.
**How to avoid:** Strict hierarchy: `docs/` owns patterns, `skills/` owns behavior, `params.json` owns parameters. Generated files are always output, never input.
**Warning signs:** Finding yourself editing a generated file directly.

### Pitfall 2: Adapter Output Drift During Development
**What goes wrong:** Editing canonical definitions but forgetting to regenerate outputs, so generated files fall out of sync.
**Why it happens:** No automated trigger for regeneration.
**How to avoid:** Include a generation step in the install scripts. Add a quality gate agent that checks generated files match their canonical sources. Mark generated files with a header comment (`<!-- GENERATED -- DO NOT EDIT MANUALLY -->`).
**Warning signs:** Diff between running the generator and the committed generated files.

### Pitfall 3: Copilot Variable Syntax Mismatch
**What goes wrong:** Copilot prompt files use `${input:name}` syntax for variables, Claude commands use `$ARGUMENTS`. Mixing these up produces broken files.
**Why it happens:** Similar-looking syntax with different semantics.
**How to avoid:** Adapters handle all syntax mapping. Canonical definitions use a neutral format (plain parameter names); adapters map to tool-specific syntax.
**Warning signs:** `${input:...}` appearing in Claude commands or `$ARGUMENTS` in Copilot prompts.

### Pitfall 4: AGENTS.md Bloat
**What goes wrong:** AGENTS.md grows to 500+ lines trying to be comprehensive, diluting signal and wasting agent context tokens.
**Why it happens:** Temptation to include everything; multiple contributors adding sections.
**How to avoid:** Hard 150-line limit. Include references to detailed docs. Focus on commands, architecture table, key conventions, skill index, and boundaries.
**Warning signs:** AGENTS.md exceeding 150 lines.

### Pitfall 5: Ignoring the Existing 4 Quality Gate Agents
**What goes wrong:** Creating new validation without leveraging the existing quality gate agents (doc-code-drift-detector, script-parity-validator, skill-script-alignment, template-sync-validator).
**Why it happens:** Not realizing they already exist and define the validation surface.
**How to avoid:** Update existing agents to work with the new canonical format rather than replacing them. They define the validation categories Phase 2 will automate.
**Warning signs:** Building ad-hoc validation that duplicates what agents already check.

### Pitfall 6: Docs Dual-Copy Drift
**What goes wrong:** Pattern docs in `docs/` and `~/.claude/docs/` diverge. Developers get different guidance depending on which surface they read.
**Why it happens:** Currently 6 of 8 docs have drifted between the two locations. No sync mechanism exists.
**How to avoid:** `docs/` in the repo is the single source of truth. The install script copies to `~/.claude/docs/`. Never edit the user-level copies directly.
**Warning signs:** `diff docs/*.md ~/.claude/docs/*.md` shows differences.

## Code Examples

### Verified Pattern Doc Structure (recommended internal format)
```markdown
# [Layer] Patterns

> **Status**: Active
> **Last Updated**: [Month Year] (v[N] - [Change description])
> **Aligned with**: [Reference projects]
> **Platforms**: [Platform list]
> **Library Versions**: [Pinned versions]

---

## Overview

[Description of what this doc covers and core principles]

## [N]. [Topic]

### [N.1] [Subtopic]

**Why:** [Rationale]

**DO (Correct):**
```kotlin
// Source: [reference]
[compilable code with pinned version imports]
```

**DON'T (Anti-pattern):**
```kotlin
// BAD: [explanation of why this is wrong]
[code showing the anti-pattern]
```

**Key insight:** [One-liner takeaway]
```

### Parameter Manifest Schema (JSON Schema)
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "parameters": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "required": ["type", "description", "mapping"],
        "properties": {
          "type": { "enum": ["string", "path", "boolean", "enum", "number"] },
          "description": { "type": "string" },
          "required": { "type": "boolean", "default": false },
          "default": {},
          "values": { "type": "array", "items": { "type": "string" } },
          "mapping": {
            "type": "object",
            "properties": {
              "ps1": { "type": "string" },
              "sh": { "type": "string" },
              "copilot": { "type": "string" },
              "makefile": { "type": "string" }
            }
          }
        }
      }
    }
  }
}
```

### AGENTS.md Recommended Structure
```markdown
# AndroidCommonDoc

KMP/Android developer toolkit. Patterns, scripts, and AI skills for Kotlin Multiplatform projects.

## Commands

- `./scripts/sh/gradle-run.sh --project-root . core:domain test` -- run module tests
- `./scripts/sh/verify-kmp-packages.sh --project-root .` -- validate KMP architecture
- `./scripts/sh/check-version-sync.sh` -- compare version catalogs

## Architecture

| Layer | Contains | Depends On |
|-------|----------|-----------|
| UI | Compose Screens, SwiftUI Views | ViewModel |
| ViewModel | UiState, event handling | UseCases |
| Domain | UseCases, Repository interfaces | Model |
| Data | Repository impls, DataSources | Domain + Platform |
| Model | Data classes, enums, sealed types | Nothing |

## Key Conventions

- UiState: ALWAYS sealed interface, NEVER data class with boolean flags
- Always rethrow CancellationException in catch blocks
- Use Result<T> for all fallible operations
- UiText for user-facing strings (never raw strings in ViewModels)
- StateFlow with stateIn(WhileSubscribed(5_000))
- MutableSharedFlow for ephemeral events (never Channel)
- State-driven navigation (never Channel-based)

## Available Skills

[Index of /test, /coverage, /verify-kmp, etc. with one-line descriptions]

## Boundaries

- Never add platform dependencies (Context, Resources, UIKit) to ViewModels
- Never use Channel for UI events or navigation
- Never duplicate code across androidMain + desktopMain -- use jvmMain
- Never put resources in custom source sets -- use commonMain/composeResources/
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-tool manual skill files | Agent Skills SKILL.md standard (agentskills.io) | Late 2025 | Skills work across Claude Code, Copilot, Codex, Cursor, Gemini CLI, and 25+ tools |
| `.claude/commands/` only | `.claude/skills/` with SKILL.md (commands still work) | Late 2025 | Skills support directories with supporting files, frontmatter control, auto-discovery |
| No universal format | AGENTS.md open standard | 2025 | 60K+ repos, 20+ tools recognize AGENTS.md |
| Copilot instructions only | Copilot prompt files (`.prompt.md`) + instructions (`.instructions.md`) | 2025 | Prompt files have frontmatter (agent, tools, model), variable syntax, file references |

**Deprecated/outdated:**
- `.claude/commands/*.md` without frontmatter: Still works but `.claude/skills/<name>/SKILL.md` is the recommended structure for new skills
- Copilot prompts without `agent` frontmatter: The `agent` field (introduced 2025) enables specifying which agent runs the prompt

## Discretion Recommendations

### Source of Truth for Docs
**Recommendation:** `docs/` in the AndroidCommonDoc repo is the single source of truth. The install scripts (`Install-ClaudeSkills.ps1` / `install-claude-skills.sh`) should be updated to also copy `docs/*.md` to `~/.claude/docs/` during installation. This eliminates the current 6-of-8 drift and creates a clear one-way flow: edit in repo, distribute via script.

### Canonical Skill Definition Location
**Recommendation:** `skills/<name>/SKILL.md` at the repo root, following the Agent Skills standard directory convention. The `skills/` directory also contains `params.json`. This keeps canonical definitions separate from generated output (`.claude/commands/`, `setup/copilot-templates/`).

### Skill Generator Trigger
**Recommendation:** Manual script (`generate-skills.sh` / `Generate-Skills.ps1`) that reads `skills/*/SKILL.md` + `skills/params.json` and runs all adapters. The install scripts should call the generator as a first step. This is simpler than file watchers and explicit enough for a documentation toolkit.

### AGENTS.md Content Scope
**Recommendation:** Hybrid -- compact (under 150 lines) with references to detailed docs. Include: commands, architecture table, key conventions (5-6 most important rules), skill index, and boundaries. Do NOT include full pattern documentation.

### AGENTS.md Authoring Approach
**Recommendation:** Hybrid. Hand-author the structure and contextual sections (commands, architecture, boundaries). Generate the skill index section from `skills/*/SKILL.md` descriptions. This keeps the prose natural while the skill index stays in sync.

### AGENTS.md Adoption for Consuming Projects
**Recommendation:** Copy on setup via the install scripts. The install scripts already copy to consuming projects; extend them to also copy AGENTS.md. Symlinks don't work cross-platform (Windows). Composite build access is for Gradle dependencies, not Markdown files.

### Pattern Doc Organization
**Recommendation:** Organize the 7 required pattern docs in adoption sequence:
1. `kmp-architecture.md` (foundation -- source set hierarchy)
2. `gradle-patterns.md` (build setup -- needed before coding)
3. `viewmodel-state-patterns.md` (core business logic patterns)
4. `ui-screen-patterns.md` (presentation layer)
5. `testing-patterns.md` (verification)
6. `compose-resources-patterns.md` (resources for Compose targets)
7. `offline-first-patterns.md` (advanced data layer)

Supporting docs (not in the 7 required layers but still valuable):
- `resource-management-patterns.md` (desktop-specific focus management)
- `propuesta-integracion-enterprise.md` (enterprise adoption material, not a pattern doc)

## Inventory of Drift (Verified)

### Parameter Name Drift
| Surface | `--project-root` | `--project-path` |
|---------|-------------------|-------------------|
| PS1 scripts | 10/12 (`-ProjectRoot`) | 2/12 (`-ProjectPath`: run-parallel-coverage-suite, run-changed-modules-tests) |
| SH scripts | 10/12 (`--project-root`) | 2/12 (`--project-path`: run-parallel-coverage-suite, run-changed-modules-tests) |
| Claude commands | `test.md` uses `--project-root` | -- |
| Copilot prompts | -- | `test.prompt.md` uses `--project-path` |
| Makefile | test, verify-kmp, build-run, sbom use `--project-root` | coverage, coverage-report use `--project-path` |

### Pattern Doc Drift (repo docs/ vs ~/.claude/docs/)
| Doc | Status |
|-----|--------|
| kmp-architecture.md | MATCH |
| compose-resources-patterns.md | DRIFTED |
| gradle-patterns.md | DRIFTED |
| offline-first-patterns.md | DRIFTED |
| resource-management-patterns.md | DRIFTED |
| testing-patterns.md | DRIFTED |
| ui-screen-patterns.md | DRIFTED |
| viewmodel-state-patterns.md | DRIFTED |
| propuesta-integracion-enterprise.md | NOT IN ~/.claude/docs/ (correct -- not a pattern doc) |

### Skill-Template Coverage (all 16 skills)
| Skill | Claude Cmd | Copilot Prompt | Wrapper Template |
|-------|-----------|---------------|-----------------|
| test | Yes | Yes | Yes |
| test-full | Yes | Yes | Yes |
| test-full-parallel | Yes | Yes | Yes |
| test-changed | Yes | Yes | Yes |
| coverage | Yes | Yes | Yes |
| coverage-full | Yes | Yes | Yes |
| auto-cover | Yes | Yes | Yes |
| extract-errors | Yes | Yes | Yes |
| run | Yes | Yes | Yes |
| android-test | Yes | Yes | Yes |
| verify-kmp | Yes | Yes | Yes |
| sync-versions | Yes | Yes | Yes |
| validate-patterns | Yes | Yes | Yes |
| sbom | Yes | Yes | Yes |
| sbom-scan | Yes | Yes | Yes |
| sbom-analyze | Yes | Yes | Yes |

All 16 skills have all 3 surfaces -- but content drift exists between surfaces (confirmed for test skill).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Quality gate agents (`.claude/agents/*.md`) + manual validation scripts |
| Config file | None -- agents are prompt-based, not test-framework-based |
| Quick run command | Run individual quality gate agent via Claude Code |
| Full suite command | Run all 4 quality gate agents sequentially |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PTRN-01 | All 7 layer docs complete with anti-patterns | manual review + doc-code-drift-detector agent | Run doc-code-drift-detector agent | Yes (agent exists) |
| PTRN-02 | Code samples compilable, versions pinned | manual review + grep for version references | `grep -rn "version" docs/*.md` | Partial (agent checks versions) |
| SCRP-01 | Parameter names consistent across surfaces | script-parity-validator + skill-script-alignment agents | Run both agents | Yes (agents exist) |
| SCRP-02 | Parameter manifest exists and is referenced | manual verification | Check `skills/params.json` exists and is valid JSON | No -- Wave 0 |
| TOOL-01 | Canonical skill defs generate tool-specific files | template-sync-validator agent (updated) | Run adapter + diff generated vs committed | Partial (agent checks sync) |
| TOOL-02 | AGENTS.md exists and is adopted | manual verification | Check `AGENTS.md` exists at repo root | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** Run relevant quality gate agent for the task's domain
- **Per wave merge:** Run all 4 quality gate agents
- **Phase gate:** All agents report clean + manual review of AGENTS.md + parameter manifest validation

### Wave 0 Gaps
- [ ] `skills/params.json` -- parameter manifest (new file)
- [ ] `AGENTS.md` -- universal AI tool entry point (new file)
- [ ] `skills/test/SKILL.md` -- first canonical skill definition (new file, template for others)
- [ ] Update quality gate agents to understand new canonical format (adaptation of existing files)

## Open Questions

1. **Adapter implementation language**
   - What we know: Node.js is natural (JSON parsing, file I/O), but the project currently uses PS1/SH/Python
   - What's unclear: Whether to add Node.js as a dependency or stick with Bash+Python
   - Recommendation: Use Bash for the adapter scripts since the project already has Bash infrastructure and the string manipulation is simple enough. Reserve Node.js for if the adapters become complex.

2. **Should generated files be committed?**
   - What we know: Currently, `.claude/commands/` and `setup/copilot-templates/` contain hand-written files that would become generated
   - What's unclear: Whether to commit generated files or regenerate on-the-fly during install
   - Recommendation: Commit generated files. They serve as documentation and allow consuming projects to reference them without running generators. The quality gate agents verify they stay in sync.

3. **Existing `.claude/skills/` vs `skills/` at root**
   - What we know: Claude Code auto-discovers from `.claude/skills/`. The Agent Skills standard expects a `skills/` directory.
   - What's unclear: Whether to use `.claude/skills/` (native discovery) or root `skills/` (standard location + adapter input)
   - Recommendation: Use root `skills/` for canonical definitions (adapter input). Do NOT use `.claude/skills/` for these because Claude Code would try to load them directly, but they contain cross-tool metadata that isn't optimized for Claude Code. The generated `.claude/commands/*.md` files remain the Claude Code interface.

## Sources

### Primary (HIGH confidence)
- Agent Skills specification: https://agentskills.io/specification -- SKILL.md format, frontmatter fields, directory structure
- Claude Code skills docs: https://code.claude.com/docs/en/skills -- commands/skills format, frontmatter reference, $ARGUMENTS syntax
- GitHub Copilot custom instructions: https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot -- `.instructions.md` format, `applyTo` frontmatter
- VS Code Copilot prompt files: https://code.visualstudio.com/docs/copilot/customization/prompt-files -- `.prompt.md` format, frontmatter fields, variable syntax

### Secondary (MEDIUM confidence)
- AGENTS.md best practices from 2,500+ repos: https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/ -- six content areas, 150-line recommendation
- AGENTS.md spec: https://agents.md/ -- placement rules, monorepo support, 60K+ adoption

### Tertiary (LOW confidence)
- None -- all findings verified against primary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Agent Skills and AGENTS.md are verified open standards with broad adoption
- Architecture: HIGH -- based on direct examination of all 70+ existing files in the repo and verified format specifications
- Pitfalls: HIGH -- based on actual drift discovered in the codebase (not theoretical)
- Parameter inventory: HIGH -- grep-verified across all surfaces
- Adapter pattern details: MEDIUM -- implementation specifics (Bash vs Node.js) are recommendations, not verified patterns

**Research date:** 2026-03-12
**Valid until:** 2026-04-12 (stable domain -- doc formats and AI tool specs don't change rapidly)
