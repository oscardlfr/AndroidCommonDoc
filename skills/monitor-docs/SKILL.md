---
name: monitor-docs
description: "Monitor upstream doc sources for version drift and deprecations. Use when asked to check for outdated dependencies or doc freshness."
allowed-tools: [Bash, Read, Write, Edit, Grep, Glob]
disable-model-invocation: true
---

## Usage Examples

```
/monitor-docs
/monitor-docs --tier 1
/monitor-docs --tier 2
/monitor-docs --review
```

## Parameters

Uses parameters from `params.json`:
- `project-root` -- Path to the AndroidCommonDoc toolkit root directory.

Additional skill-specific arguments (not in params.json):
- `--tier 1|2|3` -- Filter monitoring to a specific tier (1=critical version checks, 2=important doc pages, 3=informational community content). Default: all tiers.
- `--review` -- Include previously reviewed findings in the output (default: only new findings).

## Behavior

1. Run the `monitor-sources` MCP tool (or the CLI entrypoint directly) to check upstream documentation sources against the versions manifest and content hashes.
2. Display new findings grouped by severity:
   - **HIGH** -- Deprecation detected in upstream source, or critical version drift.
   - **MEDIUM** -- Version drift between upstream and manifest, or doc page content changed.
   - **LOW** -- Informational changes in community content.
3. For each finding, offer the user three actions:
   - **Accept** -- Auto-bump `versions-manifest.json` and update the relevant pattern doc. See auto-bump flow below.
   - **Reject** -- Dismiss the finding permanently. It will not re-surface in future runs.
   - **Defer** -- Snooze the finding for 90 days (configurable). It will re-surface after the TTL expires as a "stale deferral."
4. On accept (version-drift finding):
   a. Call `bumpManifestVersion(key, newVersion, manifestPath)` from `mcp-server/src/monitoring/manifest-bumper.ts` — updates `versions[key]` + all `profiles.*.key` entries atomically.
   b. Call `resolveCoupledVersions(key, manifest)` — if any coupled keys are returned (e.g. bumping `kotlin` returns `["ksp"]`), notify the user: *"ksp is coupled to kotlin — update ksp version manually before committing."*
   c. Update the pattern doc frontmatter `version` field and `last_updated`.
   d. Generate conventional commit message: `chore(versions): bump <key> <old> → <new>` and present for approval.
5. On accept (doc-content-changed finding): update `content_hashes[url]` in `versions-manifest.json` with the new hash, then update the pattern doc if content changed.
6. Save review state to `.androidcommondoc/monitoring-state.json` so subsequent runs only surface new findings.

## Implementation

This skill is an orchestration workflow using the AI agent's built-in tools.

The agent performs the following steps:
1. Call the `monitor-sources` MCP tool with the specified tier and review options.
2. Parse the structured JSON response containing findings and severity counts.
3. Present findings to the user grouped by severity.
4. For each finding the user accepts:
   - **version-drift**: call `bumpManifestVersion(key, newVersion, manifestPath)` via `mcp-server/src/monitoring/manifest-bumper.ts`. Then call `resolveCoupledVersions` and warn if any coupled keys need manual review (e.g. ksp after kotlin bump).
   - **doc-content-changed**: update `content_hashes[url]` in `versions-manifest.json`.
   - In both cases: use `Edit` to update the affected pattern doc frontmatter (`version`, `last_updated`). Generate and present commit message for approval.
5. For rejected/deferred findings: update the review state via `saveReviewState`.

## Expected Output

```
Monitoring upstream sources...

Tier 1 (Critical): 3 sources checked
Tier 2 (Important): 5 sources checked
Tier 3 (Informational): 0 sources checked

NEW FINDINGS (2):

  [HIGH] Deprecation detected in kotlinx-coroutines releases
         Source: https://github.com/Kotlin/kotlinx.coroutines/releases
         Pattern doc: viewmodel-state-patterns
         Detail: Content contains deprecation keyword "deprecated"
         Action: [Accept] [Reject] [Defer]

  [MEDIUM] Version drift: compose-multiplatform 1.8.0 -> 1.9.0
           Source: https://github.com/JetBrains/compose-multiplatform/releases
           Pattern doc: compose-navigation-patterns
           Detail: Upstream version 1.9.0 differs from manifest 1.8.0
           Action: [Accept] [Reject] [Defer]

Stale Deferrals (0): None

Summary:
  Sources checked: 8
  New findings: 2 (1 HIGH, 1 MEDIUM, 0 LOW)
  Errors: 0
```

## Cross-References

- MCP tool: `monitor-sources` (on-demand monitoring with tier filtering and review-aware output)
- CLI: `mcp-server/src/cli/monitor-sources.ts` (CI entrypoint for scheduled monitoring)
- CI workflow: `.github/workflows/doc-monitor.yml` (weekly cron schedule)
- Config: `versions-manifest.json` (canonical version truth)
- State: `.androidcommondoc/monitoring-state.json` (review state persistence)
- Related: `/validate-patterns` (code validation against pattern standards)
