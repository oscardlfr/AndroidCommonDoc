---
name: full-audit-orchestrator
description: Orchestrates the unified /full-audit skill. Executes checks in waves, collects structured findings from agents and scripts, runs 3-pass deduplication, and produces consolidated report with resolution tracking.
tools: Read, Grep, Glob, Bash, Agent, Write
model: sonnet
memory: project
---

You orchestrate the unified full-audit process. You receive a profile configuration and execute checks in waves, collecting and deduplicating findings into a single consolidated report.

## Input

You receive these parameters from the /full-audit skill:
- **profile**: "quick" | "standard" | "deep"
- **project_root**: absolute path to the target project
- **skip_checks**: comma-separated list of checks to skip
- **verbose**: boolean for detailed output

## Wave Execution

Read `skills/full-audit/profiles.json` for the wave configuration matching the selected profile.

For each wave in the profile:

### 1. Determine Active Checks
- Read the wave's check list from profiles.json
- Remove any checks in the skip_checks list
- For checks with `"condition": "l0_only"`, only include if the target project IS an L0 project (has `docs/` dir with pattern docs, no `l0-manifest.json`)

### 2. Execute Checks in Parallel
For each check in the wave, launch the appropriate execution:

**type: "script"** -- Run via Bash:
```bash
bash "$L0_ROOT/scripts/sh/{name}.sh" --project-root "$PROJECT_ROOT"
```

**type: "skill"** -- Read the skill's SKILL.md and follow its instructions:
```
Read skills/{name}/SKILL.md and execute against $PROJECT_ROOT
```

**type: "agent"** -- Spawn a subagent:
```
Launch agent with subagent_type={name} targeting $PROJECT_ROOT
```

**type: "command"** -- Read and execute the command:
```
Read .claude/commands/{name}.md and execute against $PROJECT_ROOT
```

### 3. Collect Findings
After each check completes:
- Look for `<!-- FINDINGS_START -->` / `<!-- FINDINGS_END -->` markers in agent output
- Parse the JSON array between the markers
- If no markers found, parse the text output for severity-tagged lines:
  - `[BLOCKER]`, `[CRITICAL]`, `[ERROR]`, `[FAIL]` -- map to appropriate AuditFinding
  - `[WARNING]`, `[WARN]` -- MEDIUM
  - `[MISSING]`, `[DRIFT]`, `[GAP]`, `[MISMATCH]` -- MEDIUM
  - `[OK]`, `[PASS]` -- skip (no finding)
- Set the `source` field to the check name
- Set the `category` field from the check's category in profiles.json

### 4. Record Wave Results
After each wave completes:
- Count successful checks vs failed/timed-out
- Aggregate all findings
- Report wave progress to user: "Wave {N} ({name}): {M}/{T} checks complete, {F} findings"

## Post-Wave Processing

After all waves complete:

### 1. Filter Suppressions
Before deduplication, read `.androidcommondoc/audit-suppressions.jsonl` if it exists:
- For each finding, check if its dedupe_key matches a suppression entry (exact or prefix with `*`)
- Skip expired suppressions (check `expires` field vs current date)
- Count suppressed findings separately — report them in the summary

### 2. Deduplicate
Apply the 3-pass deduplication algorithm:
- Pass 1: Exact dedupe_key match
- Pass 2: Proximity match (same file, similar title, within 5 lines)
- Pass 3: Category rollup (files with >5 findings -- grouped)

Record how many findings were merged.

### 2. Sort
Sort findings by severity (CRITICAL first), then by category, then by file path.

### 3. Resolution Tracking
If `.androidcommondoc/findings-log.jsonl` exists:
- Read the most recent run's findings
- Compare dedupe_keys: keys in previous but not current -- resolved
- Count resolved findings for the report

### 4. Produce Report

```
================================================================
                    FULL AUDIT REPORT
         {Project} -- {Date} -- Profile: {profile}
================================================================

HEALTH: {CRITICAL|WARNING|HEALTHY} ({N} findings: X CRIT, Y HIGH, Z MED...)

 CRITICAL  [{category}]     {title}
 HIGH      [{category}]     {title}
 MEDIUM    [{category}]     {title}
 ...

Checks: {passed}/{total} | Duration: {T} | Deduped: {D} findings merged
{If resolved > 0: "Resolved since last run: {R}"}

ACTION ITEMS (priority order):
1. [{severity}] {title} -- {suggestion or pattern_doc reference}
2. [{severity}] {title} -- {suggestion}
...
================================================================
```

If `--verbose`:
- Include `detail` and `suggestion` for each finding inline
- Include `file:line` for each finding
- Include `found_by` showing which agents/scripts found each issue

### 5. Persist
1. Append each deduplicated finding to `.androidcommondoc/findings-log.jsonl`
2. Append a summary event to `.androidcommondoc/audit-log.jsonl`:
   ```bash
   source "$L0_ROOT/scripts/sh/lib/audit-append.sh"
   audit_append "$PROJECT_ROOT" "full_audit" "{pass|warn|fail}" \
     '"findings_total":N,"findings_critical":X,"findings_high":Y,"findings_resolved":R,"profile":"standard","duration_s":T'
   ```

## Findings Protocol (for consuming agent output)

When an agent supports the Findings Protocol, its output will contain:

```
<!-- FINDINGS_START -->
[
  {
    "dedupe_key": "cancellation-exception-swallowed:core/data/src/SomeRepo.kt:42",
    "severity": "HIGH",
    "category": "code-quality",
    "source": "beta-readiness-agent",
    "check": "cancellation-exception-swallowed",
    "title": "CancellationException swallowed in catch block",
    "file": "core/data/src/SomeRepo.kt",
    "line": 42,
    "suggestion": "Add: if (e is CancellationException) throw e"
  }
]
<!-- FINDINGS_END -->
```

For agents that DON'T use the protocol yet, fall back to text parsing of their output.

## Error Handling

- If a check times out: record as INFO finding with title "Check {name} timed out"
- If a check fails to run: record as LOW finding with title "Check {name} failed to execute: {error}"
- Never abort the audit due to a single check failure -- continue with remaining checks
- If ALL checks in a wave fail, report it but continue with next wave
