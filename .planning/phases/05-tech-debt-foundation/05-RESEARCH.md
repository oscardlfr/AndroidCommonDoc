# Phase 5: Tech Debt Foundation - Research

**Researched:** 2026-03-13
**Domain:** Shell scripting (Bash/PowerShell), Claude Code agent architecture, file cleanup
**Confidence:** HIGH

## Summary

Phase 5 is a pure codebase hygiene phase -- no new libraries, no new frameworks, no build changes. The work touches four areas: (1) adding `ANDROID_COMMON_DOC` env var guards to 4 consumer-facing setup scripts and their PS1 counterparts, (2) making `install-copilot-prompts.sh` deliver `copilot-instructions-generated.md` standalone (currently only `setup-toolkit.sh` handles this), (3) refactoring `quality-gate-orchestrator.md` to reference individual agent `.md` files instead of inlining their logic, and (4) deleting 5 orphaned `validate-phase01-*.sh` scripts.

All four requirements are low-risk, localized changes. The scripts follow established patterns (colored logging, `set -euo pipefail`, `--dry-run`/`--force`/`--projects` flags). The main technical challenge is DEBT-03 -- the orchestrator currently duplicates 535 lines of logic from 4 individual agents (131+139+156+112 lines) rather than referencing them, and Claude Code agent `.md` files cannot literally `source` other `.md` files at runtime. The delegation must happen through the agent's instructions telling it to _read_ the individual agents' instructions and follow them.

**Primary recommendation:** Implement in dependency order: DEBT-01 (env guards) first since DEBT-02 depends on it, then DEBT-02 (copilot standalone delivery), DEBT-03 (orchestrator delegation), DEBT-04 (orphan cleanup last since it's the simplest and benefits from post-change quality gate validation).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Env var enforcement (DEBT-01):** Fail hard (exit 1) when ANDROID_COMMON_DOC is missing. Guard only in consumer-facing setup/install scripts: setup-toolkit.sh, install-copilot-prompts.sh, install-claude-skills.sh, install-hooks.sh. Internal validation scripts resolve paths from SCRIPT_DIR already -- no guard needed. Error message: show the error + exact `export` command to fix it -- no README links. Also validate the path exists (directory check) -- catch typos and stale paths with a distinct error message.
- **Copilot standalone delivery (DEBT-02):** install-copilot-prompts.sh delivers everything: .prompt.md files, .instructions.md files, AND copilot-instructions-generated.md. If copilot-instructions-generated.md doesn't exist: warn and skip (suggest running the adapter first), don't fail the whole script.
- **Orchestrator delegation (DEBT-03):** Orchestrator references individual agent .md files as source of truth -- reads them at runtime, no inlined logic. If an individual agent is updated, orchestrator picks it up automatically -- eliminates drift. Keep unified report format. Individual agents remain invocable on their own for debugging specific gates. Token Cost Summary section stays inline in orchestrator (informational, only useful in unified report).
- **Orphan cleanup (DEBT-04):** Delete the 5 validate-phase01-*.sh scripts from scripts/sh/. Leave archived v1.0 planning docs untouched. Verify zero active references (non-archived) before deleting. Audit both platforms: check scripts/ps1/ for orphaned validate-phase01-*.ps1 too.

### Claude's Discretion
- setup-toolkit.sh Step 4: whether to delegate fully to install-copilot-prompts.sh or keep inline with reduced duplication
- install-copilot-prompts.sh naming: keep current name or rename to install-copilot.sh based on reference impact
- Env var guard implementation pattern (inline guard function vs shared snippet)
- Orchestrator's exact mechanism for sourcing individual agent logic

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DEBT-01 | Setup scripts fail fast with clear instructions when ANDROID_COMMON_DOC env var is missing | Env Guard Pattern section below -- guard function, two-check pattern (existence + directory validation), 4 SH + 4 PS1 scripts identified |
| DEBT-02 | install-copilot-prompts.sh delivers generated Copilot instructions to consuming project | Copilot Standalone Delivery section -- copilot-instructions-generated.md delivery logic already in setup-toolkit.sh lines 331-353, needs extraction to install-copilot-prompts.sh |
| DEBT-03 | Quality-gate-orchestrator delegates to individual agent files instead of inlining logic | Orchestrator Delegation section -- agent .md read-and-follow pattern, report format preservation |
| DEBT-04 | Orphaned validate-phase01-*.sh scripts removed from repository | Orphan Cleanup section -- 5 SH scripts confirmed, zero PS1 counterparts, zero active references outside .planning/ |
</phase_requirements>

## Standard Stack

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| Bash (set -euo pipefail) | N/A | All .sh scripts follow this strict mode | Established project convention, catches errors early |
| PowerShell ($ErrorActionPreference = "Stop") | 5.1+ | All .ps1 scripts follow this strict mode | Established project convention |
| Colored logging functions | N/A | log_info/log_ok/log_warn/log_err pattern | Used in ALL 4 install scripts -- must be consistent |
| Claude Code agents (.md) | N/A | Agent instructions as Markdown with YAML frontmatter | The .claude/agents/ directory convention |

### Supporting
| Tool | Purpose | When to Use |
|------|---------|-------------|
| python3 | JSON merging in install-hooks.sh, relative path calc in setup-toolkit.sh | Already a dependency; do NOT introduce new python3 usage |
| sed | Variable substitution in install-copilot-prompts.sh | Already used; keep pattern |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline guard in each script | Shared guard.sh sourced via `source` | Shared snippet adds a dependency and complexity for 4 scripts. Inline is simpler and self-contained for this small count. Recommend inline. |
| Keep orchestrator name | Rename to quality-gate.md | No benefit, existing references would break |

## Architecture Patterns

### Current Repository Structure (Relevant to Phase 5)
```
setup/
  setup-toolkit.sh             # Unified setup (SH) -- Steps 1-6
  setup-toolkit.ps1            # Unified setup (PS1) -- Steps 1-6
  install-claude-skills.sh     # Sub-installer (SH)
  install-copilot-prompts.sh   # Sub-installer (SH) -- DEBT-02 target
  install-hooks.sh             # Sub-installer (SH)
  Install-ClaudeSkills.ps1     # Sub-installer (PS1)
  Install-CopilotPrompts.ps1   # Sub-installer (PS1) -- DEBT-02 PS1 counterpart
  Install-Hooks.ps1            # Sub-installer (PS1)
  copilot-templates/
    *.prompt.md                # 16 prompt templates
    instructions/*.instructions.md  # 4 instruction templates
    copilot-instructions.md    # Template with {{}} placeholders
    copilot-instructions-generated.md  # Generated (no placeholders)
scripts/
  sh/
    validate-phase01-*.sh      # 5 ORPHANED scripts (DEBT-04)
    validate-phase03-*.sh      # 4 active validation scripts
    validate-phase04-*.sh      # 1 active validation script
    ...                        # Other active scripts
  ps1/
    ...                        # No validate-phase01-*.ps1 exist
.claude/
  agents/
    quality-gate-orchestrator.md  # 274 lines, inlines all gate logic (DEBT-03)
    script-parity-validator.md    # 131 lines
    skill-script-alignment.md     # 139 lines
    template-sync-validator.md    # 156 lines
    doc-code-drift-detector.md    # 112 lines
```

### Pattern 1: Env Var Guard (DEBT-01)

**What:** Two-phase validation -- check env var exists, then check the path is a valid directory.
**When to use:** At the top of each consumer-facing script, before any work begins.

**Bash pattern:**
```bash
# --- ANDROID_COMMON_DOC env var guard ---
if [ -z "${ANDROID_COMMON_DOC:-}" ]; then
    log_err "ANDROID_COMMON_DOC environment variable is not set."
    log_err "Set it to the path of your AndroidCommonDoc checkout:"
    log_err ""
    log_err "  export ANDROID_COMMON_DOC=\"/path/to/AndroidCommonDoc\""
    log_err ""
    exit 1
fi

if [ ! -d "$ANDROID_COMMON_DOC" ]; then
    log_err "ANDROID_COMMON_DOC points to a path that does not exist or is not a directory:"
    log_err "  $ANDROID_COMMON_DOC"
    log_err ""
    log_err "Check for typos or update the variable:"
    log_err ""
    log_err "  export ANDROID_COMMON_DOC=\"/path/to/AndroidCommonDoc\""
    log_err ""
    exit 1
fi
```

**PowerShell pattern:**
```powershell
# --- ANDROID_COMMON_DOC env var guard ---
if (-not $env:ANDROID_COMMON_DOC) {
    Write-Host "[ERROR] ANDROID_COMMON_DOC environment variable is not set." -ForegroundColor Red
    Write-Host "[ERROR] Set it to the path of your AndroidCommonDoc checkout:" -ForegroundColor Red
    Write-Host ""
    Write-Host '  $env:ANDROID_COMMON_DOC = "C:\path\to\AndroidCommonDoc"' -ForegroundColor Red
    Write-Host ""
    exit 1
}

if (-not (Test-Path $env:ANDROID_COMMON_DOC -PathType Container)) {
    Write-Host "[ERROR] ANDROID_COMMON_DOC points to a path that does not exist or is not a directory:" -ForegroundColor Red
    Write-Host "  $env:ANDROID_COMMON_DOC" -ForegroundColor Red
    Write-Host ""
    Write-Host "[ERROR] Check for typos or update the variable:" -ForegroundColor Red
    Write-Host '  $env:ANDROID_COMMON_DOC = "C:\path\to\AndroidCommonDoc"' -ForegroundColor Red
    Write-Host ""
    exit 1
}
```

**Important nuance:** The 4 consumer-facing scripts currently resolve COMMON_DOC from SCRIPT_DIR (lines like `COMMON_DOC="$(cd "$SCRIPT_DIR/.." && pwd)"`). This works when scripts are run from within the AndroidCommonDoc checkout. However, the guard is needed for the case where scripts are run standalone from a consuming project or when env var is expected. The guard should be placed BEFORE argument parsing and BEFORE any path resolution logic that assumes the env var exists.

**Which scripts need guards (8 total):**
1. `setup/setup-toolkit.sh` + `setup/setup-toolkit.ps1`
2. `setup/install-claude-skills.sh` + `setup/Install-ClaudeSkills.ps1`
3. `setup/install-copilot-prompts.sh` + `setup/Install-CopilotPrompts.ps1`
4. `setup/install-hooks.sh` + `setup/Install-Hooks.ps1`

**Context decision:** The user said "Guard only in consumer-facing setup/install scripts" and "Internal validation scripts (scripts/sh/*.sh, scripts/ps1/*.ps1) resolve paths from SCRIPT_DIR already -- no guard needed." This is correct -- the internal scripts use `SCRIPT_DIR` to derive paths, not ANDROID_COMMON_DOC.

**Critical observation:** The 4 SH install scripts currently derive COMMON_DOC from SCRIPT_DIR:
```bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMON_DOC="$(cd "$SCRIPT_DIR/.." && pwd)"
```
This means ANDROID_COMMON_DOC is NOT currently used as a path source in these scripts -- it's only referenced as something to set in the shell profile (`--set-env` flag) or shown in "Next Steps" output. The guard validates the env var exists and is a valid directory as a prerequisite for downstream tools (wrapper templates, copilot prompts in consuming projects use `$ANDROID_COMMON_DOC`), not because the setup scripts themselves need it to find files.

### Pattern 2: Copilot Standalone Delivery (DEBT-02)

**What:** Move the copilot-instructions-generated.md delivery logic from setup-toolkit.sh into install-copilot-prompts.sh so the standalone script is self-sufficient.
**When to use:** When install-copilot-prompts.sh is invoked directly (not via setup-toolkit.sh).

**Current state:**
- `install-copilot-prompts.sh` delivers: .prompt.md files and .instructions.md files
- `setup-toolkit.sh` Step 4 does TWO things: (a) calls install-copilot-prompts.sh, (b) copies copilot-instructions-generated.md to `.github/copilot-instructions.md`
- The copilot-instructions-generated.md copy logic is ONLY in setup-toolkit.sh (lines 331-353) and setup-toolkit.ps1 (lines 318-341)

**Target state:**
- `install-copilot-prompts.sh` delivers ALL three: .prompt.md files, .instructions.md files, AND copilot-instructions-generated.md
- `setup-toolkit.sh` Step 4 can then delegate fully to install-copilot-prompts.sh (removing its inline copilot-instructions-generated.md logic)
- Same for PS1 counterparts

**Delivery details for copilot-instructions-generated.md:**
- Source: `setup/copilot-templates/copilot-instructions-generated.md` (exists, 60+ lines, no {{}} placeholders)
- Target: `{project_root}/.github/copilot-instructions.md`
- Behavior: If source file doesn't exist, warn and skip (don't fail)
- Respects --force/--dry-run like other files
- Creates `.github/` directory if needed
- Creates `.bak` backup of existing file

### Pattern 3: Orchestrator Delegation (DEBT-03)

**What:** Refactor the quality-gate-orchestrator.md to reference individual agent files instead of inlining their logic.

**The current problem:**
The orchestrator (274 lines) manually replicates the checking logic of all 4 individual agents. When an agent is updated (e.g., adding a new check to script-parity-validator.md), the orchestrator must be manually updated to match. This has already caused drift.

**The constraint:** Claude Code agent `.md` files are plain Markdown with YAML frontmatter. They cannot `source` or `import` other files programmatically. They are instructions that tell the AI what to do.

**Recommended delegation mechanism:**
The orchestrator's instructions should tell the agent to:
1. Read each individual agent's `.md` file at runtime using the Read tool
2. Execute the checks described in each agent file
3. Collect results into the unified report format

**Revised orchestrator structure:**
```markdown
---
name: quality-gate-orchestrator
description: Unified quality gate -- delegates to individual gate agents and produces consolidated report.
tools: Read, Grep, Glob, Bash
model: sonnet
memory: project
---

You are the unified quality gate orchestrator. You delegate to individual gate agents
and produce a single consolidated report.

## Execution

For each gate below:
1. Read the agent file using the Read tool
2. Follow its instructions exactly as written
3. Collect the results for the unified report

### Gate 1: Script Parity
Read `.claude/agents/script-parity-validator.md` and execute all steps described there.
Record section status (PASS/FAIL) and findings.

### Gate 2: Skill-Script Alignment
Read `.claude/agents/skill-script-alignment.md` and execute all steps described there.
Record section status (PASS/FAIL) and findings.

### Gate 3: Template Sync
Read `.claude/agents/template-sync-validator.md` and execute all steps described there.
Record section status (PASS/FAIL) and findings.

### Gate 4: Doc-Code Drift
Read `.claude/agents/doc-code-drift-detector.md` and execute all steps described there.
Record section status (PASS/FAIL) and findings.

## Token Cost Summary
[Keep inline -- only meaningful in unified report context]

## Report Format
[Keep existing consolidated report format]
```

**This pattern ensures:**
- Individual agents are the single source of truth for their checks
- Orchestrator automatically picks up any agent updates
- Individual agents remain independently invocable
- Unified report format is preserved
- Token Cost Summary stays inline (user decision)

**Size reduction:** Orchestrator shrinks from ~274 lines to ~80-100 lines (report format + delegation instructions + Token Cost Summary inline).

### Pattern 4: Safe Orphan Deletion (DEBT-04)

**What:** Delete 5 orphaned scripts after verifying zero active references.

**Scripts to delete (confirmed):**
1. `scripts/sh/validate-phase01-pattern-docs.sh`
2. `scripts/sh/validate-phase01-param-manifest.sh`
3. `scripts/sh/validate-phase01-skill-pipeline.sh`
4. `scripts/sh/validate-phase01-agents-md.sh`
5. `scripts/sh/validate-phase01-param-drift.sh`

**Reference audit (COMPLETE):**
- `scripts/ps1/`: Zero `validate-phase01-*.ps1` files -- confirmed no PS1 counterparts to audit
- `.claude/agents/`: Zero references to `validate-phase01` -- confirmed
- `.claude/commands/`: Not checked explicitly but orchestrator has zero references (checked above)
- `scripts/sh/` (other scripts): `validate-phase01-param-drift.sh` references itself (line 72) -- will be deleted
- `.planning/`: Multiple references in archived v1.0 docs (01-VALIDATION.md, v1.0-MILESTONE-AUDIT.md, PITFALLS.md, etc.) -- these are archived history, user decided to leave untouched
- Root-level files: Zero references

**Deletion is safe.** No active code or configuration references these scripts.

### Anti-Patterns to Avoid
- **Partial env var guard:** Do NOT check only for env var existence without also checking the path exists. A stale/typo'd path produces confusing downstream errors.
- **README links in error messages:** User explicitly said no README links. Show the exact command to fix.
- **Modifying archived planning docs:** User explicitly said leave v1.0 planning docs untouched.
- **Failing the entire copilot install if generated instructions are missing:** User said warn and skip, don't fail.
- **Inline copilot-instructions-generated.md logic in BOTH setup-toolkit.sh and install-copilot-prompts.sh:** This creates the exact kind of duplication we're fixing. Move it to install-copilot-prompts.sh only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON merging for settings.json | Custom bash jq parsing | python3 (already used) | install-hooks.sh already uses python3 for JSON merging; keep consistent |
| Colored output | ANSI escape sequences directly | log_info/log_ok/log_warn/log_err functions | Already standardized across all scripts |
| PS1/SH env var check | Different patterns per script | Same guard block copy-pasted consistently | 4 scripts is small enough that a shared include adds unnecessary complexity |

## Common Pitfalls

### Pitfall 1: Guard Placement in Scripts That Resolve COMMON_DOC from SCRIPT_DIR
**What goes wrong:** Adding the ANDROID_COMMON_DOC guard but leaving the COMMON_DOC derivation from SCRIPT_DIR means the script works without the env var being set (since it finds files via SCRIPT_DIR). The guard becomes a false requirement.
**Why it happens:** The install scripts currently derive paths from their own location, not from the env var.
**How to avoid:** The guard validates the env var as a prerequisite for the *consuming project's* tooling (wrapper templates use `$ANDROID_COMMON_DOC`), not for the setup script's own operation. This is correct as-is -- the guard ensures the env var is set BEFORE installing files that depend on it. Document this rationale in a comment.
**Warning signs:** Tests that unset ANDROID_COMMON_DOC but the script still completes successfully (because it uses SCRIPT_DIR). This is expected -- the guard is a precondition check, not a path resolution dependency.

### Pitfall 2: setup-toolkit.sh Step 4 Duplication After DEBT-02
**What goes wrong:** After moving copilot-instructions-generated.md delivery into install-copilot-prompts.sh, forgetting to remove the duplicate logic from setup-toolkit.sh (lines 331-353) and setup-toolkit.ps1 (lines 318-341).
**Why it happens:** The existing logic works, so it's easy to add to install-copilot-prompts.sh without removing from setup-toolkit.sh.
**How to avoid:** Part of the same task -- remove inline logic from setup-toolkit.sh/ps1 Step 4 when adding to install-copilot-prompts.sh/ps1.
**Warning signs:** Running setup-toolkit.sh and seeing copilot-instructions.md copied twice (once by the sub-script, once by the inline logic).

### Pitfall 3: Orchestrator Agent Not Actually Reading Files
**What goes wrong:** The refactored orchestrator says "read the agent file" but the AI model might summarize or skip detailed instructions from the read file.
**Why it happens:** Agent instructions are suggestive, not programmatic. The model might interpret "follow its instructions" loosely.
**How to avoid:** Be explicit in the orchestrator: "Read the file using the Read tool, then execute EVERY step and sub-step described in it. Do not summarize or skip steps." Also preserve the specific report format instructions in the orchestrator so the model knows exactly what output structure to produce.
**Warning signs:** Orchestrator report has fewer findings than running individual agents separately.

### Pitfall 4: Forgetting PS1 Counterparts
**What goes wrong:** Updating only the .sh scripts and forgetting the .ps1 counterparts for DEBT-01 and DEBT-02.
**Why it happens:** Developer works on Linux/macOS and doesn't test PowerShell.
**How to avoid:** DEBT-01 requires guards in 8 files (4 SH + 4 PS1). DEBT-02 requires delivery logic in both install-copilot-prompts.sh and Install-CopilotPrompts.ps1, and removal from both setup-toolkit.sh and setup-toolkit.ps1. Track explicitly.
**Warning signs:** Script parity validator reports [MISSING] or [MISMATCH] after changes.

### Pitfall 5: Breaking --set-env Flag Behavior
**What goes wrong:** The env var guard fires before the --set-env flag is processed, preventing users from using --set-env to set the very variable being checked.
**Why it happens:** Guard is placed at top of script, before argument parsing.
**How to avoid:** Place the guard AFTER argument parsing and AFTER --set-env processing (if applicable). The --set-env flag should be able to set the env var before the guard checks it. Alternatively, skip the guard when --set-env is provided (since the purpose is to set up the env var).
**Warning signs:** `install-copilot-prompts.sh --set-env` fails with "ANDROID_COMMON_DOC not set" before it can set it.

## Code Examples

### Guard Placement Relative to --set-env (Bash)
```bash
# Parse arguments FIRST
while [[ $# -gt 0 ]]; do
    case "$1" in
        --set-env) SET_ENV=true; shift ;;
        # ... other flags
    esac
done

# Process --set-env BEFORE the guard
if [ "$SET_ENV" = true ]; then
    # ... set env var in shell profile ...
fi

# THEN validate ANDROID_COMMON_DOC
if [ -z "${ANDROID_COMMON_DOC:-}" ]; then
    log_err "ANDROID_COMMON_DOC environment variable is not set."
    # ...
    exit 1
fi
```

Note: setup-toolkit.sh does NOT have --set-env, so its guard can go right after argument parsing. The 3 install scripts (skills, copilot, hooks) -- only skills and copilot have --set-env. Hooks does not.

### copilot-instructions-generated.md Delivery (Bash)
```bash
# --- Deliver copilot-instructions-generated.md ---
GENERATED_INSTRUCTIONS="$COMMON_DOC/setup/copilot-templates/copilot-instructions-generated.md"

if [ -f "$GENERATED_INSTRUCTIONS" ]; then
    for project in "${PROJECT_LIST[@]}"; do
        project_dir="$PARENT_DIR/$project"
        [ ! -d "$project_dir" ] && continue

        target_github_dir="$project_dir/.github"
        target_file="$target_github_dir/copilot-instructions.md"

        if [ -f "$target_file" ] && [ "$FORCE" = false ]; then
            log_info "copilot-instructions.md already exists in $project (use --force to overwrite)"
        elif [ "$DRY_RUN" = true ]; then
            log_info "[DRY RUN] Would copy copilot-instructions-generated.md -> $project/.github/copilot-instructions.md"
        else
            mkdir -p "$target_github_dir"
            [ -f "$target_file" ] && cp "$target_file" "${target_file}.bak"
            cp "$GENERATED_INSTRUCTIONS" "$target_file"
            log_ok "Installed copilot-instructions.md in $project"
            ((INSTALLED++))
        fi
    done
else
    log_warn "copilot-instructions-generated.md not found -- run adapters/generate-all.sh first"
fi
```

## Discretion Recommendations

The CONTEXT.md lists four areas at Claude's discretion. Here are recommendations:

### 1. setup-toolkit.sh Step 4 Delegation
**Recommendation: Fully delegate to install-copilot-prompts.sh.**
Rationale: After DEBT-02, install-copilot-prompts.sh handles ALL copilot deliverables. Having setup-toolkit.sh Step 4 do anything beyond calling the sub-script creates duplication. Remove lines 331-353 from setup-toolkit.sh and lines 318-341 from setup-toolkit.ps1. Step 4 becomes a clean delegation identical to Steps 3 and 5.

### 2. install-copilot-prompts.sh Naming
**Recommendation: Keep the current name `install-copilot-prompts.sh`.**
Rationale: The name is referenced in setup-toolkit.sh (line 314), setup-toolkit.ps1 (line 303 via Install-CopilotPrompts.ps1), and the "Selective Adoption" help text. Renaming provides marginal clarity but requires updating multiple references. The current name accurately describes what the script does -- even with copilot-instructions-generated.md, it's still "copilot prompts and related files."

### 3. Env Var Guard Implementation Pattern
**Recommendation: Inline guard block in each script (not a shared snippet).**
Rationale: Only 4 SH + 4 PS1 scripts need the guard. A shared `guard.sh` would add a sourcing dependency and another file to maintain. The guard block is ~15 lines -- small enough to inline. Copy-paste is acceptable for this size.

### 4. Orchestrator Delegation Mechanism
**Recommendation: "Read and follow" pattern.**
The orchestrator explicitly instructs the AI to: (a) Read each agent .md file using the Read tool, (b) Execute every step described in that file, (c) Collect results into the unified report. This is the only viable mechanism since Claude Code agents cannot programmatically source other files. See the Pattern 3 section above for the specific structure.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Manual validation (shell script changes, no automated test suite for scripts) |
| Config file | None -- scripts are tested by execution |
| Quick run command | `bash setup/install-copilot-prompts.sh --dry-run --projects TestProject` |
| Full suite command | Run quality-gate-orchestrator agent after all changes |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DEBT-01 | Setup scripts fail fast when ANDROID_COMMON_DOC is unset | manual + smoke | `unset ANDROID_COMMON_DOC && bash setup/setup-toolkit.sh --project-root /tmp/test 2>&1 \| head -5` | N/A -- behavioral |
| DEBT-01 | Setup scripts fail when ANDROID_COMMON_DOC points to nonexistent dir | manual + smoke | `ANDROID_COMMON_DOC=/nonexistent bash setup/setup-toolkit.sh --project-root /tmp/test 2>&1 \| head -5` | N/A -- behavioral |
| DEBT-02 | install-copilot-prompts.sh delivers copilot-instructions-generated.md standalone | manual + smoke | `bash setup/install-copilot-prompts.sh --dry-run --projects TestProject 2>&1 \| grep copilot-instructions` | N/A -- behavioral |
| DEBT-03 | Orchestrator produces identical results to individual agents | manual | Invoke orchestrator agent, then invoke each individual agent separately, compare findings | N/A -- agent behavior |
| DEBT-04 | Orphaned scripts removed, zero references | smoke | `ls scripts/sh/validate-phase01-* 2>&1` (should show "No such file") | N/A -- deletion |
| DEBT-04 | No active references to orphaned scripts | smoke | `grep -r "validate-phase01" --include="*.sh" --include="*.ps1" --include="*.md" . \| grep -v ".planning/"` | N/A -- reference check |

### Sampling Rate
- **Per task commit:** Dry-run the affected scripts
- **Per wave merge:** Run quality-gate-orchestrator to verify no regressions
- **Phase gate:** Full quality gate green + manual env var guard smoke tests

### Wave 0 Gaps
None -- this phase modifies existing scripts and agent files. No test framework setup needed. Validation is behavioral (smoke tests) and via the existing quality gate agents.

## Open Questions

1. **Guard vs --set-env interaction**
   - What we know: install-copilot-prompts.sh and install-claude-skills.sh have --set-env flags that SET the env var in shell profile
   - What's unclear: Should the guard be skipped when --set-env is provided? The flag adds the var to the profile but doesn't `export` it into the current session.
   - Recommendation: Place guard AFTER --set-env processing. If --set-env was used but ANDROID_COMMON_DOC is still not in the current environment, show a message suggesting `source ~/.bashrc` (or equivalent) and then re-run. This is cleaner than skipping the guard.

2. **setup-toolkit.sh guard placement vs SCRIPT_DIR derivation**
   - What we know: setup-toolkit.sh derives COMMON_DOC from SCRIPT_DIR (line 22), not from ANDROID_COMMON_DOC
   - What's unclear: Should the guard replace the SCRIPT_DIR derivation, or coexist?
   - Recommendation: Coexist. The guard validates the env var. The script continues to use SCRIPT_DIR for its own file resolution. The env var is validated because downstream wrapper templates and consuming project tooling depend on it.

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection of all 13 affected files
- `quality-gate-orchestrator.md` -- 274 lines, full logic analysis
- 4 individual agent files -- 131+139+156+112 lines, full structure analysis
- `setup-toolkit.sh` -- 440 lines, Step 4 delegation analysis
- `setup-toolkit.ps1` -- 429 lines, PS1 counterpart analysis
- 3 install scripts (SH) -- 256+211+277 lines, full flag and structure analysis
- 3 install scripts (PS1) -- confirmed existence at setup/Install-*.ps1

### Secondary (MEDIUM confidence)
- Reference audit via grep -- confirmed zero active references to validate-phase01 outside .planning/
- PS1 orphan audit -- confirmed zero validate-phase01-*.ps1 files exist

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all patterns observed directly in codebase
- Architecture: HIGH -- pure refactoring of existing files, no architectural changes
- Pitfalls: HIGH -- identified from direct code analysis and user decisions

**Research date:** 2026-03-13
**Valid until:** 2026-04-13 (stable -- no external dependency changes expected)
