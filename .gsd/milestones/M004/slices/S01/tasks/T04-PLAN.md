# T04: 13-audit-validate 04

**Slice:** S01 — **Milestone:** M004

## Description

Execute monitor-sources for freshness validation across the full consolidated corpus, then merge all four project audit manifests into a single structured audit report. This is the capstone plan that produces the final deliverables consumed by Phase 14 and Phase 15.

Purpose: Per STATE.md decision, monitor-sources runs AFTER all content is discovered (Plans 01-03 complete). The final merged manifest and executive summary provide the evidence base that drives all subsequent v1.2 work.

Output: `audit-manifest.json` (merged machine-readable manifest) + `audit-report.md` (executive summary)

## Must-Haves

- [ ] "monitor-sources executed against AndroidCommonDoc pattern docs with monitor_urls configured"
- [ ] "Version reference freshness validated across all 4 project manifests against versions-manifest.json"
- [ ] "Freshness results integrated into the merged audit manifest (per-file freshness status)"
- [ ] "Structured audit report combines consolidation manifest, L0 promotion list, gap inventory, and freshness report"
- [ ] "Executive summary has cross-project statistics (L0 candidate count, overlap count, freshness issues)"

## Files

- `.planning/phases/13-audit-validate/audit-manifest.json`
- `.planning/phases/13-audit-validate/audit-report.md`
