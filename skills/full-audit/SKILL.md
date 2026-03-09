---
name: full-audit
description: Run a unified audit across all quality dimensions — architecture, code quality, testing, security, docs, and release readiness. Consolidates findings from multiple agents and scripts into a single deduplicated report.
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Agent
  - Write
---

# /full-audit

Unified project audit that orchestrates scripts and agents in waves, deduplicates findings, and produces a consolidated report.

## Usage

```
/full-audit                        # standard profile (default)
/full-audit --profile quick        # fast, no Gradle
/full-audit --profile deep         # everything including beta-readiness
/full-audit --verbose              # detailed inline findings
/full-audit --output report.md     # save report to file
/full-audit --project-root PATH    # target project (default: cwd)
/full-audit --skip coverage,sbom   # skip specific checks
```

## Profiles

| Profile | Waves | Gradle | Agents | Estimated Time |
|---------|-------|--------|--------|----------------|
| `quick` | 1-2 | No | No beta-readiness | ~5 min |
| `standard` | 1-3 | Yes (coverage) | No beta-readiness | ~15 min |
| `deep` | 1-4 | Yes (full) | All | ~45 min |

## Procedure

### Step 1: Resolve Configuration

1. Parse arguments: `--profile` (default: standard), `--verbose`, `--output`, `--project-root`, `--skip`
2. Read `skills/full-audit/profiles.json` for wave definitions
3. If `$PROJECT_ROOT/l0-manifest.json` exists, check for `full_audit` overrides:
   - `extra_agents`: additional agents to include
   - `custom_profiles`: profile overrides
   - `skip_checks`: checks to always skip

### Step 2: Execute Waves

Delegate to the full-audit-orchestrator agent, passing:
- Profile name and wave configuration
- Project root path
- Skip list
- Verbose flag

The orchestrator will:
1. Execute each wave's checks in parallel where possible
2. Collect findings using the `<!-- FINDINGS_START -->` / `<!-- FINDINGS_END -->` protocol from agents
3. Run the 3-pass deduplication engine on all collected findings
4. Track resolution against previous `findings-log.jsonl` entries

### Step 3: Produce Report

The orchestrator produces the consolidated report in this format:

```
================================================================
                    FULL AUDIT REPORT
         {Project} -- {Date} -- Profile: {profile}
================================================================

HEALTH: {CRITICAL|WARNING|HEALTHY} ({N} findings: X CRIT, Y HIGH...)

 CRITICAL  [security]       OAuth tokens in SQLite plaintext
 CRITICAL  [architecture]   java.time.* in commonMain (4 files)
 HIGH      [code-quality]   CancellationException swallowed (3 repos)
 MEDIUM    [documentation]  3 pattern docs with stale versions
 ...

Checks: {N}/{M} | Duration: {T} | Deduped: {D} findings merged

ACTION ITEMS (priority order):
1. [CRITICAL] Encrypt token storage -- Art. 32 compliance
2. [CRITICAL] Replace java.time with kotlinx-datetime
3. [HIGH]     Add rethrow in catch blocks -- /auto-cover can help
================================================================
```

### Step 4: Persist & Output

1. Append findings to `.androidcommondoc/findings-log.jsonl` using the findings-append helper
2. Append a `full_audit` event to `.androidcommondoc/audit-log.jsonl` using audit-append helper
3. If `--output` specified, write report to file
4. Display report to user

## Constraints

- NEVER re-run Gradle if `--profile quick` is selected
- NEVER run beta-readiness-agent unless `--profile deep`
- Respect `--skip` list -- silently skip named checks
- All agents must emit findings using the structured protocol
- The report must be <=200 lines (truncate detail section if needed, keep action items)
