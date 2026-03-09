# S01: Audit Validate

**Goal:** Mine all 209 WakeTheCave markdown files (docs/ 199 + docs2/ 10) for reusable KMP patterns sourced from official documentation.
**Demo:** Mine all 209 WakeTheCave markdown files (docs/ 199 + docs2/ 10) for reusable KMP patterns sourced from official documentation.

## Must-Haves


## Tasks

- [x] **T01: 13-audit-validate 01**
  - Mine all 209 WakeTheCave markdown files (docs/ 199 + docs2/ 10) for reusable KMP patterns sourced from official documentation. Produce a per-file audit manifest with L0 promotion candidates, AI-readiness scores, and advisory doc health recommendations -- without modifying WakeTheCave.

Purpose: WakeTheCave started as a pure Android app and contains Android/KMP patterns potentially sourced from official Kotlin, Jetpack, KMP, and Gradle documentation. Mining these surfaces L0 promotion candidates for AndroidCommonDoc's pattern library and builds evidence for Phase 14 template design.

Output: `audit-manifest-wakethecave.json` -- machine-readable per-file manifest with layer classifications, AI-readiness scores, L0 promotion candidates, and advisory recommendations.
- [x] **T02: 13-audit-validate 02**
  - Audit all DawSync markdown files (~291 excluding worktrees and .planning/) -- classify each as ACTIVE (still relevant), SUPERSEDED (content exists elsewhere), or UNIQUE (irreplaceable context). Produce a consolidation manifest with per-file layer classification, AI-readiness scores, and action recommendations.

Purpose: DawSync is the main project with the largest documentation corpus. The audit provides evidence for Phase 14's consolidation work (STRUCT-03) and identifies patterns that should be promoted to L0/L1 or flagged as L2>L1 overrides.

Output: `audit-manifest-dawsync.json` -- machine-readable per-file manifest covering docs/, .claude/agents, .claude/commands, .agents/skills, .androidcommondoc/, agent-memory, and root markdown files.
- [x] **T03: 13-audit-validate 03**
  - Audit shared-kmp-libs modules for documentation gaps (per-module doc plan) and review all 23 AndroidCommonDoc pattern docs for completeness and accuracy. Produce two audit manifests that identify what documentation exists, what is missing, and where gaps exist relative to the consolidated corpus.

Purpose: shared-kmp-libs has 51 module directories but only 14 with README.md files -- the gap analysis tells Phase 14 exactly what to write. AndroidCommonDoc's 23 pattern docs need review against findings from all 4 projects to identify coverage holes.

Output: `audit-manifest-shared-kmp-libs.json` + `audit-manifest-androidcommondoc.json`
- [x] **T04: 13-audit-validate 04**
  - Execute monitor-sources for freshness validation across the full consolidated corpus, then merge all four project audit manifests into a single structured audit report. This is the capstone plan that produces the final deliverables consumed by Phase 14 and Phase 15.

Purpose: Per STATE.md decision, monitor-sources runs AFTER all content is discovered (Plans 01-03 complete). The final merged manifest and executive summary provide the evidence base that drives all subsequent v1.2 work.

Output: `audit-manifest.json` (merged machine-readable manifest) + `audit-report.md` (executive summary)

## Files Likely Touched

- `.planning/phases/13-audit-validate/audit-manifest-wakethecave.json`
- `.planning/phases/13-audit-validate/audit-manifest-dawsync.json`
- `.planning/phases/13-audit-validate/audit-manifest-shared-kmp-libs.json`
- `.planning/phases/13-audit-validate/audit-manifest-androidcommondoc.json`
- `.planning/phases/13-audit-validate/audit-manifest.json`
- `.planning/phases/13-audit-validate/audit-report.md`
