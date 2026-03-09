# T04: 10-doc-intelligence-detekt-generation 04

**Slice:** S06 — **Milestone:** M002

## Description

Create the generated rules directory structure in the detekt-rules module and build the writer module that orchestrates the full rule generation pipeline (parse frontmatter -> emit Kotlin -> write files -> update provider registration).

Purpose: Bridges the TypeScript generation engine (Plan 02) with the Kotlin detekt-rules module, producing actual .kt files that compile alongside the 5 existing hand-written rules.
Output: generated/ directories in detekt-rules, writer module that orchestrates end-to-end generation.

## Must-Haves

- [ ] "Generated rule directory exists and is ready for Kotlin source files"
- [ ] "Writer module coordinates full generation pipeline: parse rules, emit Kotlin, write files, update provider"
- [ ] "Existing 5 hand-written rules are never modified or overwritten"
- [ ] "AndroidCommonDocRuleSetProvider can register both hand-written and generated rules"
- [ ] "Generated rules compile alongside existing rules in detekt-rules module"

## Files

- `detekt-rules/src/main/kotlin/com/androidcommondoc/detekt/rules/generated/.gitkeep`
- `detekt-rules/src/test/kotlin/com/androidcommondoc/detekt/rules/generated/.gitkeep`
- `mcp-server/src/generation/writer.ts`
- `mcp-server/tests/unit/generation/writer.test.ts`
