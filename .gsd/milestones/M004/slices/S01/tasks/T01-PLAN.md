# T01: 13-audit-validate 01

**Slice:** S01 — **Milestone:** M004

## Description

Mine all 209 WakeTheCave markdown files (docs/ 199 + docs2/ 10) for reusable KMP patterns sourced from official documentation. Produce a per-file audit manifest with L0 promotion candidates, AI-readiness scores, and advisory doc health recommendations -- without modifying WakeTheCave.

Purpose: WakeTheCave started as a pure Android app and contains Android/KMP patterns potentially sourced from official Kotlin, Jetpack, KMP, and Gradle documentation. Mining these surfaces L0 promotion candidates for AndroidCommonDoc's pattern library and builds evidence for Phase 14 template design.

Output: `audit-manifest-wakethecave.json` -- machine-readable per-file manifest with layer classifications, AI-readiness scores, L0 promotion candidates, and advisory recommendations.

## Must-Haves

- [ ] "All 209 WakeTheCave markdown files (199 docs/ + 10 docs2/) are inventoried with per-file classification"
- [ ] "L0 promotion candidates identified with conservative threshold (only official-docs-sourced patterns)"
- [ ] "Each file has an AI-readiness score (0-5) using the standard criteria"
- [ ] "WakeTheCave directory structure is preserved in the output (grouped by subdirectory)"
- [ ] "Advisory doc health recommendations included (read-only -- no WakeTheCave modifications)"

## Files

- `.planning/phases/13-audit-validate/audit-manifest-wakethecave.json`
