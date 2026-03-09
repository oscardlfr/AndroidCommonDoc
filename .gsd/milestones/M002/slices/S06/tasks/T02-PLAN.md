# T02: 10-doc-intelligence-detekt-generation 02

**Slice:** S06 — **Milestone:** M002

## Description

Build the Detekt rule generation engine: parse rule definitions from pattern doc frontmatter and emit Kotlin source code for AST-only Detekt rules with companion tests.

Purpose: Creates the code generation pipeline that transforms YAML rule definitions in pattern docs into compilable Kotlin Detekt rules and tests, matching the exact patterns of the 5 existing hand-written rules.
Output: rule-parser, kotlin-emitter, test-emitter, config-emitter modules with full test coverage.

## Must-Haves

- [ ] "Rule parser extracts RuleDefinition[] from pattern doc frontmatter"
- [ ] "Kotlin emitter produces compilable AST-only Detekt rule source code"
- [ ] "Test emitter produces compilable JUnit + detekt-test test source code"
- [ ] "Generated rules use the same Kotlin PSI visitor patterns as existing hand-written rules"
- [ ] "Generated tests follow the same lint/assertThat pattern as existing hand-written tests"

## Files

- `mcp-server/src/generation/rule-parser.ts`
- `mcp-server/src/generation/kotlin-emitter.ts`
- `mcp-server/src/generation/test-emitter.ts`
- `mcp-server/src/generation/config-emitter.ts`
- `mcp-server/tests/unit/generation/rule-parser.test.ts`
- `mcp-server/tests/unit/generation/kotlin-emitter.test.ts`
- `mcp-server/tests/unit/generation/test-emitter.test.ts`
