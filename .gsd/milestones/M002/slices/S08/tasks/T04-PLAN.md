# T04: 12-ecosystem-vault-expansion 03

**Slice:** S08 — **Milestone:** M002

## Description

Create the glob expander utility, sub-project detector, version catalog parser, and rewrite the collector to use configurable glob-based collection with L0/L1/L2 layer routing.

Purpose: The collector is the data ingestion layer -- it determines what files enter the vault pipeline. Replacing hardcoded collection functions with glob-based collection makes the system configurable per project (ECOV-07), enables L1 ecosystem collection (ECOV-01), L2 app collection (ECOV-02), architecture doc collection (ECOV-03), and sub-project support (ECOV-04). The version catalog parser implements the features.versionCatalog opt-in flag from ProjectConfig.
Output: Four source files: glob-expander.ts, sub-project-detector.ts, version-catalog-parser.ts, rewritten collector.ts

## Must-Haves

- [ ] "Glob expander resolves patterns against a directory and returns matching file paths"
- [ ] "Sub-project detector finds nested projects by build-system signals (not Gradle sub-modules)"
- [ ] "Collector uses ProjectConfig globs instead of hardcoded collection functions"
- [ ] "L0 collection gathers patterns and skills from AndroidCommonDoc"
- [ ] "L1 collection gathers all .md files from shared-kmp-libs (per config globs)"
- [ ] "L2 collection gathers app docs with correct layer and project tagging"
- [ ] "Architecture docs (.planning/codebase/) collected with sourceType 'architecture'"
- [ ] "Sub-project docs collected under parent project with subProject field set"
- [ ] "Version catalog parser generates readable reference page from libs.versions.toml when feature enabled"

## Files

- `mcp-server/src/vault/glob-expander.ts`
- `mcp-server/src/vault/sub-project-detector.ts`
- `mcp-server/src/vault/collector.ts`
- `mcp-server/src/vault/version-catalog-parser.ts`
