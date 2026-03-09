# Phase 4: Audit Tech Debt Cleanup - Research

**Researched:** 2026-03-13
**Domain:** File editing, JSON manipulation, YAML frontmatter, shell script surgery
**Confidence:** HIGH

## Summary

Phase 4 is a hardening phase that closes 4 non-critical integration findings (INT-01 through INT-04) from the v1.0 milestone audit, updates ROADMAP.md admin items, and backfills SUMMARY metadata. All changes are text edits to existing files -- no new libraries, no new architecture, no builds. The risk is low and the scope is well-defined by the audit report.

The research found that all 11 SUMMARY files already have populated `requirements-completed` frontmatter fields, contradicting the audit report's claim that they are "missing." This means the SUMMARY metadata backfill task is already complete and needs only verification, not implementation. The remaining 5 items (INT-01 through INT-04 plus ROADMAP admin) are straightforward text and JSON edits with exact target locations identified.

**Primary recommendation:** Execute all fixes in a single plan with clear task sequencing -- INT-01 (settings.json) first (as it is the most structurally complex), then INT-02/INT-03/INT-04 (text replacements), then ROADMAP admin, then SUMMARY verification.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- `setup-toolkit.sh` owns the `.github/copilot-instructions.md` write -- it copies `copilot-instructions-generated.md` (the adapter output, canonical per Phase 1)
- Remove copilot-instructions.md handling entirely from `install-copilot-prompts.sh` -- that script keeps handling individual `.prompt.md` files only
- Single write path eliminates the "second write silently wins" problem
- Add hook entries to AndroidCommonDoc's own `.claude/settings.json` so contributors get real-time Detekt enforcement
- Hook scripts already exist at `.claude/hooks/` (detekt-post-write.sh, detekt-pre-commit.sh)
- Exact hook configuration (PostToolUse + PreToolUse, or PostToolUse only) at Claude's discretion -- determine what makes sense for a toolkit repo vs app repo
- Change Step 4 in `.claude/agents/template-sync-validator.md` to reference `copilot-instructions-generated.md` instead of `copilot-instructions.md`
- Change `gradle-patterns.md` Library Versions from "Compose Multiplatform 1.10.0" to "Compose Gradle Plugin 1.10.0"
- Must also verify `check-doc-freshness.sh` no longer flags it as [STALE] after fix
- Check Plan 03-04 checkbox in ROADMAP.md (already executed and verified)
- Update Phase 3 status to Complete if not already reflected
- Populate `requirements_completed` field across all 11 SUMMARY.md files
- Format: YAML list of requirement IDs only -- `[PTRN-01, PTRN-02]` -- compact and machine-parseable
- Mapping derived from VERIFICATION.md evidence and REQUIREMENTS.md traceability table
- Descriptions live in REQUIREMENTS.md -- no duplication in frontmatter

### Claude's Discretion
- Hook configuration scope for AndroidCommonDoc (PostToolUse + PreToolUse, or PostToolUse only)
- Requirement-to-plan mapping for SUMMARY backfill (derive from VERIFICATION.md)
- Order of fixes within the plan (dependency-aware sequencing)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

## Standard Stack

No new libraries or tools are introduced in this phase. All changes use existing project infrastructure:

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| python3 | system | JSON manipulation for settings.json | Established pattern from Phases 1-3 for safe JSON merging |
| bash | system | Script editing verification | Freshness script runs via bash |
| Text editing | N/A | Direct file modifications | All changes are deterministic text replacements |

### Supporting
No supporting libraries needed.

### Alternatives Considered
None -- this phase uses only direct file editing.

## Architecture Patterns

### Target File Map

All changes target existing files with known locations:

```
.claude/settings.json                               # INT-01: Add hooks section
.claude/agents/template-sync-validator.md            # INT-02: Fix Step 4 reference
setup/install-copilot-prompts.sh                     # INT-03: Remove copilot-instructions.md handling
docs/gradle-patterns.md                              # INT-04: Fix version label
.planning/ROADMAP.md                                 # Admin: Check 03-04 checkbox
.planning/phases/*/XX-SUMMARY.md (11 files)          # Metadata: Verify requirements_completed
```

### Pattern 1: JSON Merge for settings.json (INT-01)

**What:** Add `hooks` section with PostToolUse and PreToolUse entries to AndroidCommonDoc's own `.claude/settings.json`
**When to use:** Self-registration of hooks for the toolkit repo itself
**Current state of `.claude/settings.json`:**
```json
{
  "permissions": {
    "deny": [
      "Bash(rm -rf *)",
      "Bash(git push --force *)",
      "Bash(git clean -f *)",
      "Bash(git merge *)",
      "Bash(git checkout main)"
    ]
  }
}
```

**Target state (PostToolUse + PreToolUse):**
```json
{
  "permissions": {
    "deny": [
      "Bash(rm -rf *)",
      "Bash(git push --force *)",
      "Bash(git clean -f *)",
      "Bash(git merge *)",
      "Bash(git checkout main)"
    ]
  },
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/detekt-post-write.sh",
            "timeout": 30
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/detekt-pre-commit.sh",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```

**Recommendation on hook scope (Claude's Discretion):** Use BOTH PostToolUse and PreToolUse. The toolkit repo contains Kotlin files in `detekt-rules/` and `build-logic/` that should follow the same architecture patterns the toolkit enforces on consuming projects. "Eat your own dogfood" principle. The hook scripts already handle graceful degradation (skip when detekt-cli not available), so there is no risk of breaking non-Kotlin file edits.

**Source:** This exact JSON structure comes from `setup/install-hooks.sh` lines 191-206 which is the established pattern for consuming projects. The self-registration uses the same structure.

### Pattern 2: Script Section Removal (INT-03)

**What:** Remove the copilot-instructions.md handling block from `install-copilot-prompts.sh`
**Current location:** Lines 132-233 of `install-copilot-prompts.sh` (the `# Check for copilot-instructions.md` section through the closing `fi` of the `# Install copilot-instructions.md` block)

**Precise lines to remove:** Lines 132-137 (HAS_COPILOT_INSTRUCTIONS variable check), and lines 216-233 (the "Install copilot-instructions.md" block inside the project loop). The script should continue to handle `.prompt.md` files and `instructions/*.instructions.md` files -- only the `copilot-instructions.md` master file is removed.

**Sections to remove (verified from current source):**

1. Lines 132-137: Detection of copilot-instructions.md template
```bash
# Check for copilot-instructions.md
HAS_COPILOT_INSTRUCTIONS=false
if [ -f "$TEMPLATES_DIR/copilot-instructions.md" ]; then
    HAS_COPILOT_INSTRUCTIONS=true
    log_info "Found copilot-instructions.md template"
fi
```

2. Lines 216-233: Installation of copilot-instructions.md per project
```bash
    # Install copilot-instructions.md
    if [ "$HAS_COPILOT_INSTRUCTIONS" = true ]; then
        copilot_instructions_target="$github_dir/copilot-instructions.md"
        ...
        fi
    fi
```

**`setup-toolkit.sh` already handles this:** Lines 331-352 of `setup-toolkit.sh` copy `copilot-instructions-generated.md` to consuming project's `.github/copilot-instructions.md`. This is the single consolidated path.

### Pattern 3: Text Replacement (INT-02, INT-04)

**What:** Simple string replacements in known files
**INT-02:** In `.claude/agents/template-sync-validator.md`, line 55:
- Change: `setup/copilot-templates/copilot-instructions.md`
- To: `setup/copilot-templates/copilot-instructions-generated.md`

**INT-04:** In `docs/gradle-patterns.md`, line 7:
- Change: `Compose Multiplatform 1.10.0`
- To: `Compose Gradle Plugin 1.10.0`

### Anti-Patterns to Avoid
- **Editing generated files:** Do NOT touch files with `GENERATED` headers (`.claude/commands/*.md`, `setup/copilot-templates/*.prompt.md`). Only edit source files.
- **Running scripts during implementation:** The freshness script should be checked AFTER the version label fix, not before. The plan should verify the fix would resolve the [STALE] flag by checking the library mapping logic in the script.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON editing | Manual string manipulation of settings.json | python3 `json.load`/`json.dump` or direct Write tool | JSON is fragile -- one missing comma breaks the file |
| YAML frontmatter editing | Regex on frontmatter | Read the file, identify the field, write the updated content | YAML has edge cases with colons and brackets |

## Common Pitfalls

### Pitfall 1: Breaking settings.json Format
**What goes wrong:** Manual JSON editing introduces syntax errors (trailing commas, missing quotes)
**Why it happens:** JSON is strict about syntax; hand-editing is error-prone
**How to avoid:** Use python3 for JSON manipulation (established project pattern) OR use the Write tool to write a complete, well-formed JSON file
**Warning signs:** Claude Code stops working due to invalid settings.json

### Pitfall 2: Removing Wrong Lines from install-copilot-prompts.sh
**What goes wrong:** Removing too much or too little from the script breaks either the prompt installation or the remaining functionality
**Why it happens:** The copilot-instructions.md handling is interleaved with the main installation loop
**How to avoid:** Target two specific regions: (1) the HAS_COPILOT_INSTRUCTIONS detection block at lines 132-137, and (2) the "Install copilot-instructions.md" block at lines 216-233. Verify prompt file and instruction file installation still works after removal.
**Warning signs:** Script fails when run with `bash -n` (syntax check)

### Pitfall 3: Version Label Fix Not Resolving Freshness Check
**What goes wrong:** Changing "Compose Multiplatform" to "Compose Gradle Plugin" but the freshness script still flags as [STALE]
**Why it happens:** The library name mapping in check-doc-freshness.sh must map the new label to the correct manifest key
**How to avoid:** The freshness script LIB_MAP already contains `"compose gradle plugin": "compose-gradle-plugin"` (line 85). The manifest has `"compose-gradle-plugin": "1.10.0"`. So "Compose Gradle Plugin 1.10.0" maps to key `compose-gradle-plugin` with value `1.10.0` -- exact match. This WILL resolve the [STALE] flag.
**Warning signs:** N/A -- verified this will work by tracing the mapping logic

### Pitfall 4: SUMMARY Backfill Already Complete
**What goes wrong:** Planning work to populate `requirements_completed` in all 11 SUMMARYs when the field is already populated
**Why it happens:** The audit was performed at a point in time; the field was populated sometime after audit but before this phase
**How to avoid:** Research confirmed via grep that ALL 11 SUMMARY files already have populated `requirements-completed` fields. The planner should make this a VERIFICATION task, not an implementation task. Simply verify the existing values match VERIFICATION.md evidence.
**Warning signs:** Editing files that don't need changes

## Code Examples

### settings.json Hook Structure (from install-hooks.sh)
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/detekt-post-write.sh",
            "timeout": 30
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/detekt-pre-commit.sh",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```
Source: `setup/install-hooks.sh` lines 191-206

### SUMMARY Frontmatter requirements-completed Field
```yaml
requirements-completed: [PTRN-01, PTRN-02]
```
Source: `.planning/phases/01-stabilize-foundation/01-01-SUMMARY.md` line 45

## Current State of All 11 SUMMARY Files

Research verified via grep that all 11 SUMMARY files already have `requirements-completed` populated:

| File | Current Value | Expected (from VERIFICATION.md) | Match? |
|------|---------------|--------------------------------|--------|
| 01-01-SUMMARY.md | `[PTRN-01, PTRN-02]` | PTRN-01, PTRN-02 (01-VERIFICATION Requirements) | YES |
| 01-02-SUMMARY.md | `[SCRP-01, SCRP-02]` | SCRP-01, SCRP-02 (01-VERIFICATION Requirements) | YES |
| 01-03-SUMMARY.md | `[TOOL-01]` | TOOL-01 (01-VERIFICATION: TOOL-01 source plan 01-03) | YES |
| 01-04-SUMMARY.md | `[TOOL-01, TOOL-02]` | TOOL-01, TOOL-02 (01-VERIFICATION: TOOL-01 source plan 01-03/01-04, TOOL-02 source plan 01-04) | YES |
| 02-01-SUMMARY.md | `[LINT-01, LINT-03]` | LINT-01, LINT-03 (02-VERIFICATION Requirements) | YES |
| 02-02-SUMMARY.md | `[PTRN-03]` | PTRN-03 (02-VERIFICATION Requirements) | YES |
| 02-03-SUMMARY.md | `[SCRP-03, QUAL-01, QUAL-02, QUAL-03]` | SCRP-03, QUAL-01, QUAL-02, QUAL-03 (02-VERIFICATION Requirements) | YES |
| 03-01-SUMMARY.md | `[LINT-02]` | LINT-02 (03-VERIFICATION: source plan 03-01) | YES |
| 03-02-SUMMARY.md | `[TOOL-03]` | TOOL-03 (03-VERIFICATION: source plan 03-02) | YES |
| 03-03-SUMMARY.md | `[LINT-02, TOOL-03]` | LINT-02, TOOL-03 (03-VERIFICATION: source plan 03-03) | YES |
| 03-04-SUMMARY.md | `[LINT-02, TOOL-03]` | LINT-02, TOOL-03 (03-VERIFICATION: source plan 03-04) | YES |

**Conclusion:** All 11 SUMMARY files already have correct `requirements-completed` values matching VERIFICATION.md evidence. The SUMMARY metadata backfill success criterion (#6) is already satisfied. The plan should include a VERIFICATION step, not an implementation step.

## ROADMAP.md Current State

Verified from ROADMAP.md lines 73-74:
```markdown
- [ ] 03-04-PLAN.md -- Gap closure: fix testConfig opt-out timing (wrap in afterEvaluate)
```

This checkbox needs to be checked: `- [x]`.

Phase 3 status line (ROADMAP.md line 101):
```markdown
| 3. Distribution and Adoption | 4/4 | Complete | 2026-03-13 |
```

Phase 3 already shows "Complete" in the progress table. But the phase checkbox on line 19 says:
```markdown
- [x] **Phase 3: Distribution and Adoption** ...
```

This is already checked. The only ROADMAP fix needed is checking the Plan 03-04 checkbox on line 73.

## Verification Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Bash script execution (check-doc-freshness.sh) |
| Config file | None (standalone scripts) |
| Quick run command | `bash scripts/sh/check-doc-freshness.sh` |
| Full suite command | `bash -n setup/install-copilot-prompts.sh && bash scripts/sh/check-doc-freshness.sh` |

### Phase Requirements to Test Map

No new requirements -- this phase hardens existing deliverables. Verification is based on the 6 success criteria:

| Criterion | Behavior | Test Type | Automated Command | File Exists? |
|-----------|----------|-----------|-------------------|-------------|
| SC-1 | settings.json has hook entries | smoke | `python3 -c "import json; d=json.load(open('.claude/settings.json')); assert 'PostToolUse' in d['hooks'] and 'PreToolUse' in d['hooks']"` | N/A |
| SC-2 | template-sync-validator Step 4 references generated file | smoke | `grep 'copilot-instructions-generated.md' .claude/agents/template-sync-validator.md` | N/A |
| SC-3 | install-copilot-prompts.sh no longer writes copilot-instructions.md | smoke | `grep -c 'copilot-instructions.md' setup/install-copilot-prompts.sh` (should return only comment references) | N/A |
| SC-4 | gradle-patterns.md says Compose Gradle Plugin and freshness passes | smoke | `bash scripts/sh/check-doc-freshness.sh` exits 0 | N/A |
| SC-5 | ROADMAP Plan 03-04 checkbox checked | smoke | `grep '\[x\] 03-04-PLAN' .planning/ROADMAP.md` | N/A |
| SC-6 | All 11 SUMMARYs have requirements_completed | smoke | `grep -c 'requirements-completed:' .planning/phases/*/*.md` equals 11 | N/A |

### Sampling Rate
- **Per task commit:** Verify each success criterion affected by that task
- **Phase gate:** All 6 success criteria green

### Wave 0 Gaps
None -- existing infrastructure covers all phase verification needs.

## Open Questions

1. **install-copilot-prompts.sh: How many lines reference copilot-instructions.md?**
   - What we know: Lines 132-137 (detection) and lines 216-233 (installation) are the two blocks
   - What's unclear: Whether there are additional references elsewhere in the script
   - Recommendation: Use grep to find all occurrences before editing. Research found references at lines 132, 133, 134, 136 (detection block) and lines 217-232 (install block). No other references found.

## Sources

### Primary (HIGH confidence)
- `.claude/settings.json` -- read directly, current state confirmed (12 lines, permissions only)
- `.claude/agents/template-sync-validator.md` -- read directly, Step 4 at line 55 confirmed referencing `copilot-instructions.md`
- `setup/install-copilot-prompts.sh` -- read directly, all 282 lines, copilot-instructions.md handling identified at lines 132-137 and 216-233
- `setup/setup-toolkit.sh` -- read directly, all 440 lines, copilot-instructions-generated.md handling at lines 331-352
- `docs/gradle-patterns.md` -- read directly, line 7 confirmed "Compose Multiplatform 1.10.0"
- `scripts/sh/check-doc-freshness.sh` -- read directly, LIB_MAP at line 85 confirms "compose gradle plugin" -> "compose-gradle-plugin"
- `versions-manifest.json` -- read directly, "compose-gradle-plugin": "1.10.0" confirmed
- `setup/install-hooks.sh` -- read directly, JSON structure for hook entries at lines 191-206
- All 11 SUMMARY.md files -- grep confirmed all have populated `requirements-completed` fields
- All 3 VERIFICATION.md files -- read directly, requirements-to-plan mapping confirmed
- `.planning/ROADMAP.md` -- read directly, Plan 03-04 unchecked at line 73, Phase 3 status already Complete
- `.planning/v1.0-MILESTONE-AUDIT.md` -- read directly, all 9 tech debt items catalogued

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new tools, all file editing
- Architecture: HIGH -- all target files read and exact edit locations identified
- Pitfalls: HIGH -- all edge cases traced through actual code (library mapping, JSON structure)

**Research date:** 2026-03-13
**Valid until:** Indefinite -- this is a one-time cleanup phase with no external dependencies
