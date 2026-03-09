# T01: 12-ecosystem-vault-expansion 00

**Slice:** S08 — **Milestone:** M002

## Description

Create stub test files for all 10 vault test files required by Phase 12. Each stub defines the behavioral contracts (as .todo() tests) that the implementation plans (02-06) must satisfy. This is the Nyquist Wave 0 -- test scaffolds exist before any production code changes.

Purpose: Ensures every implementation task in Plans 02-06 has a corresponding test file that can be run. The stubs use Vitest's `it.todo()` to declare expected behaviors without implementation. As Plans 02-06 execute, Plan 07 rewrites these stubs into full tests. The stubs also serve as living documentation of what each module must do.
Output: 10 test stub files (7 rewrites of existing Phase 11 tests + 2 new files + 1 integration rewrite)

## Must-Haves

- [ ] "All 10 test files exist with describe blocks and .todo() placeholder tests"
- [ ] "Each stub test file imports from the correct source module"
- [ ] "Running vitest on the stub files produces 'todo' results (not errors)"
- [ ] "Test stubs define the behavior contracts that Plans 02-06 must satisfy"

## Files

- `mcp-server/tests/unit/vault/collector.test.ts`
- `mcp-server/tests/unit/vault/config.test.ts`
- `mcp-server/tests/unit/vault/transformer.test.ts`
- `mcp-server/tests/unit/vault/moc-generator.test.ts`
- `mcp-server/tests/unit/vault/vault-writer.test.ts`
- `mcp-server/tests/unit/vault/tag-generator.test.ts`
- `mcp-server/tests/unit/vault/wikilink-generator.test.ts`
- `mcp-server/tests/unit/vault/sub-project-detector.test.ts`
- `mcp-server/tests/unit/vault/glob-expander.test.ts`
- `mcp-server/tests/integration/vault-sync.test.ts`
