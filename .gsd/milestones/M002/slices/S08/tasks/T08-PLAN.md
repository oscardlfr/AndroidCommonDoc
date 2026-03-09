# T08: 12-ecosystem-vault-expansion 07

**Slice:** S08 — **Milestone:** M002

## Description

Rewrite all vault tests for the layer-first structure and run full verification. This is a clean rewrite per CONTEXT.md locked decision -- not incremental updates to old tests. Replaces the Wave 0 stubs (from Plan 00) with fully-implemented tests.

Purpose: Tests validate that the entire refactored pipeline works correctly. Without tests, we cannot verify ECOV requirements are met. The rewrite approach (vs. updating) is deliberate: old tests assert flat paths (patterns/, skills/, projects/) which are fundamentally wrong for the new structure. Plan 00 created stubs; this plan fills them with real assertions.
Output: 9 unit test files (7 rewritten + 2 new) + 1 integration test rewritten, all passing. Human checkpoint for Obsidian visual verification.

## Must-Haves

- [ ] "All 9 unit test files pass with layer-aware assertions"
- [ ] "Integration test validates full L0/L1/L2 pipeline end-to-end"
- [ ] "Glob expander tests cover **, *, literal, and exclude patterns"
- [ ] "Sub-project detector tests distinguish real sub-projects from Gradle sub-modules"
- [ ] "Collector tests verify L0, L1, L2 routing and architecture doc collection"
- [ ] "Transformer tests verify slug disambiguation across layers"
- [ ] "MOC tests verify Home.md generation and ecosystem-aware groupings"
- [ ] "Config tests verify new ProjectConfig schema loading and defaults"
- [ ] "Full test suite passes: cd mcp-server && npx vitest run"
- [ ] "Human verifies vault opens correctly in Obsidian with layer-first structure"

## Files

- `mcp-server/tests/unit/vault/config.test.ts`
- `mcp-server/tests/unit/vault/collector.test.ts`
- `mcp-server/tests/unit/vault/transformer.test.ts`
- `mcp-server/tests/unit/vault/tag-generator.test.ts`
- `mcp-server/tests/unit/vault/wikilink-generator.test.ts`
- `mcp-server/tests/unit/vault/moc-generator.test.ts`
- `mcp-server/tests/unit/vault/vault-writer.test.ts`
- `mcp-server/tests/unit/vault/glob-expander.test.ts`
- `mcp-server/tests/unit/vault/sub-project-detector.test.ts`
- `mcp-server/tests/integration/vault-sync.test.ts`
