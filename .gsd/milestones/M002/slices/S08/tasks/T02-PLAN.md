# T02: 12-ecosystem-vault-expansion 01

**Slice:** S08 — **Milestone:** M002

## Description

Audit the documentation landscape across DawSync, shared-kmp-libs, and AndroidCommonDoc to understand what docs exist, identify layer misplacements, and formally define ECOV requirements in REQUIREMENTS.md.

Purpose: The audit informs the collector's collection configuration (what globs, what exclusions, what layer assignments). Without knowing what actually exists in the target repos, the collector refactoring would be done blind. Also formalizes ECOV requirements since they only exist in ROADMAP.md success criteria.
Output: 12-DOC-AUDIT.md report with findings + updated REQUIREMENTS.md with ECOV definitions

## Must-Haves

- [ ] "ECOV-01 through ECOV-07 requirement definitions exist in REQUIREMENTS.md"
- [ ] "shared-kmp-libs documentation landscape is inventoried with findings"
- [ ] "DawSync docs are audited for L0 promotion candidates"

## Files

- `.planning/REQUIREMENTS.md`
