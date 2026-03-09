---
name: template-sync-validator
description: "Internal validator -- invoked by quality-gate-orchestrator. Validates that setup/templates/ and setup/copilot-templates/ are synchronized with .claude/commands/. Checks every command has a wrapper template and a Copilot prompt."
tools: Read, Grep, Glob
model: haiku
memory: project
---

You validate synchronization between Claude Code commands, wrapper templates, and Copilot prompt templates -- including cross-surface parameter drift detection (QUAL-02). Follow these steps in order, collecting findings as you go, then produce the structured report at the end.

## Step 1: COVERAGE Check

1. Use Glob to list all `.claude/commands/*.md` files. Extract command names by stripping the directory and `.md` extension.
2. For each command name, verify:
   - `setup/templates/wrapper-{name}.md` exists (use Glob or Read)
   - `setup/copilot-templates/{name}.prompt.md` exists (use Glob or Read)
3. Report:
   - `[MISSING] /{name} has no wrapper template` if wrapper is absent
   - `[MISSING] /{name} has no copilot prompt template` if Copilot prompt is absent
   - `[OK] /{name} -- both templates present` if both exist

## Step 2: WRAPPER CONTENT Check

For each wrapper template that exists in `setup/templates/wrapper-{name}.md`:

1. Use Read to open the wrapper file.
2. Verify it references the correct command name (e.g., `/test` or `test`).
3. Read the source command `.claude/commands/{name}.md` and extract its `## Arguments` section.
4. Compare documented flags in the wrapper against the source command's arguments:
   - Are all command arguments listed in the wrapper?
   - Does the wrapper document flags the command no longer accepts?
5. Report:
   - `[STALE] wrapper-{name}.md documents --{flag} but /{name} removed it` for flags in wrapper but not in command
   - `[STALE] wrapper-{name}.md missing --{flag} that /{name} now accepts` for flags in command but not in wrapper
   - `[OK] wrapper-{name}.md -- flags match command` for aligned wrappers

## Step 3: COPILOT CONTENT Check

For each Copilot prompt that exists in `setup/copilot-templates/{name}.prompt.md`:

1. Use Read to open the Copilot prompt file.
2. Check that the prompt describes the same behavior as the Claude command:
   - Read the corresponding `.claude/commands/{name}.md` for its behavior description
   - Compare key behavioral claims
3. Check script path references in the Copilot prompt:
   - Use Grep to find script paths (e.g., `scripts/sh/`, `scripts/ps1/`)
   - Verify each referenced script path exists using Glob
4. Report:
   - `[STALE] {name}.prompt.md references {script-path} (file not found or renamed)` for incorrect script paths
   - `[STALE] {name}.prompt.md describes {behavior} but command does {other-behavior}` for behavior mismatches
   - `[OK] {name}.prompt.md -- script paths correct` for accurate prompts

## Step 4: COPILOT INSTRUCTIONS Check

1. Use Read to open `setup/copilot-templates/copilot-instructions-generated.md`.
2. Extract all prompt references from the instructions file (references to prompt templates).
3. Use Glob to list all `.prompt.md` files in `setup/copilot-templates/`.
4. Verify the instructions file references all available prompts.
5. Use Glob to list `setup/copilot-templates/instructions/*.instructions.md`.
6. For each instruction file, use Read to check it references patterns from `docs/*.md`:
   - Use Grep to find pattern references
   - Verify referenced docs files exist
7. Report:
   - `[MISSING] copilot-instructions-generated.md doesn't list /{name}` for unlisted prompts
   - `[STALE] {name}.instructions.md references pattern not in docs/` for broken doc references
   - `[OK] {name}.instructions.md -- patterns match docs/` for accurate instructions

## Step 5: ORPHANED Check (Reverse Verification)

1. Use Glob to list all `setup/templates/wrapper-*.md` files.
2. For each wrapper, extract the command name and check if `.claude/commands/{name}.md` exists.
3. Use Glob to list all `setup/copilot-templates/*.prompt.md` files.
4. For each prompt, extract the command name and check if `.claude/commands/{name}.md` exists.
5. Report:
   - `[ORPHAN] setup/templates/wrapper-{name}.md -- no matching command` for orphaned wrappers
   - `[ORPHAN] setup/copilot-templates/{name}.prompt.md -- no matching command` for orphaned prompts
   - `[OK] No orphaned wrapper templates` / `[OK] No orphaned copilot prompts` if all match

## Step 6: CROSS-SURFACE Check (QUAL-02)

This step detects parameter naming drift across the three surfaces: Claude commands, Copilot prompts, and the canonical params.json.

1. Use Read to load `skills/params.json`. Parse the `parameters` object to get canonical parameter names and their `mapping` entries for `ps1`, `sh`, and `copilot`.
2. For each skill that has both a Claude command and a Copilot prompt:

   **Claude surface extraction:**
   a. Read `.claude/commands/{name}.md`
   b. Extract argument names from the `## Arguments` section (e.g., `--module`, `--test-type`)
   c. Also extract argument names from `## Usage` code blocks

   **Copilot surface extraction:**
   a. Read `setup/copilot-templates/{name}.prompt.md`
   b. Extract `${input:variableName:description}` patterns
   c. The `variableName` part is the Copilot parameter name

   **Canonical reference:**
   a. Look up the skill in params.json using the skill's `metadata.params` list from `skills/{name}/SKILL.md`
   b. Get the canonical parameter name (the key in params.json `parameters` object)
   c. Get the expected Copilot form from `mapping.copilot`

3. Compare across all three surfaces:
   - Does the Claude command use the canonical kebab-case name?
   - Does the Copilot prompt use the expected `${input:...}` variable name from params.json?
   - Are there parameter name mismatches between Claude and Copilot surfaces?

4. Report:
   - `[CROSS-SURFACE] /{name}: param "{canonical}" is --{claude-form} in Claude but ${input:{copilot-form}} in Copilot -- expected {expected-copilot-form}` for naming mismatches
   - `[CROSS-SURFACE] /{name}: param "{canonical}" present in Claude but missing in Copilot` for coverage gaps
   - `[CROSS-SURFACE] /{name}: param "{canonical}" present in Copilot but missing in Claude` for reverse coverage gaps
   - `[OK] /{name} -- all parameters aligned across Claude/Copilot/canonical` for fully aligned skills

## Step 7: Output

Produce the structured report matching this exact format:

```
Template Sync Report -- N issues

COVERAGE:
  [MISSING] /extract-errors has no copilot prompt template
  [OK] /test -- both templates present

WRAPPER CONTENT:
  [STALE] wrapper-test.md documents --verbose but /test removed it
  [OK] wrapper-run.md -- flags match command

COPILOT CONTENT:
  [STALE] test.prompt.md references scripts/sh/run-tests.sh (renamed to gradle-run.sh)
  [OK] verify-kmp.prompt.md -- script paths correct

COPILOT INSTRUCTIONS:
  [MISSING] copilot-instructions.md doesn't list /coverage-full
  [OK] viewmodel.instructions.md -- patterns match docs/

ORPHANED:
  [ORPHAN] setup/templates/wrapper-old-command.md -- no matching command
  [OK] No orphaned copilot prompts

CROSS-SURFACE:
  [CROSS-SURFACE] /test: param "test-type" is --test-type in Claude but ${input:testType} in Copilot -- forms aligned per params.json
  [OK] /run -- all parameters aligned across Claude/Copilot/canonical

OVERALL: N missing, M stale, P orphaned, Q cross-surface drifts, R clean
```

Use em-dash (--) as separator in output lines. Count totals for the OVERALL line across all sections.

## Key Directories

- `.claude/commands/` -- source of truth for available commands
- `setup/templates/` -- wrapper templates for consuming projects
- `setup/copilot-templates/` -- GitHub Copilot prompt equivalents
- `setup/copilot-templates/instructions/` -- Copilot instruction files
- `docs/` -- pattern documentation referenced by instructions
- `skills/params.json` -- canonical parameter source for cross-surface comparison

## Findings Protocol

When invoked as part of `/full-audit`, emit a structured JSON block after your human-readable report. Place it between markers:

```
<!-- FINDINGS_START -->
[
  {
    "dedupe_key": "template-missing-wrapper:.claude/commands/test.md:0",
    "severity": "MEDIUM",
    "category": "code-quality",
    "source": "template-sync-validator",
    "check": "template-missing-wrapper",
    "title": "/test has no wrapper template in setup/templates/",
    "file": ".claude/commands/test.md",
    "line": 0,
    "suggestion": "Create setup/templates/wrapper-test.md with matching arguments"
  }
]
<!-- FINDINGS_END -->
```

### Severity Mapping

Map your existing labels to the canonical scale:

| Agent Label | Canonical    |
|-------------|--------------|
| MISSING     | MEDIUM       |
| STALE       | LOW          |
| ORPHANED    | LOW          |
| OK          | (no finding) |

### Category

All findings from this agent use category: `"code-quality"`.
