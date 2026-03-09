# S08: Ecosystem Vault Expansion

**Goal:** Create stub test files for all 10 vault test files required by Phase 12.
**Demo:** Create stub test files for all 10 vault test files required by Phase 12.

## Must-Haves


## Tasks

- [x] **T01: 12-ecosystem-vault-expansion 00**
  - Create stub test files for all 10 vault test files required by Phase 12. Each stub defines the behavioral contracts (as .todo() tests) that the implementation plans (02-06) must satisfy. This is the Nyquist Wave 0 -- test scaffolds exist before any production code changes.

Purpose: Ensures every implementation task in Plans 02-06 has a corresponding test file that can be run. The stubs use Vitest's `it.todo()` to declare expected behaviors without implementation. As Plans 02-06 execute, Plan 07 rewrites these stubs into full tests. The stubs also serve as living documentation of what each module must do.
Output: 10 test stub files (7 rewrites of existing Phase 11 tests + 2 new files + 1 integration rewrite)
- [x] **T02: 12-ecosystem-vault-expansion 01**
  - Audit the documentation landscape across DawSync, shared-kmp-libs, and AndroidCommonDoc to understand what docs exist, identify layer misplacements, and formally define ECOV requirements in REQUIREMENTS.md.

Purpose: The audit informs the collector's collection configuration (what globs, what exclusions, what layer assignments). Without knowing what actually exists in the target repos, the collector refactoring would be done blind. Also formalizes ECOV requirements since they only exist in ROADMAP.md success criteria.
Output: 12-DOC-AUDIT.md report with findings + updated REQUIREMENTS.md with ECOV definitions
- [x] **T03: 12-ecosystem-vault-expansion 02**
  - Rewrite the vault type system and config management to support the L0/L1/L2 hierarchy with rich per-project configuration.

Purpose: Types are the foundation -- every other vault module depends on these interfaces. Getting the contracts right first prevents cascading changes later. This is a breaking change (projects: string[] -> ProjectConfig[]) which is allowed per CONTEXT.md.
Output: Rewritten types.ts and config.ts with ProjectConfig, SubProjectConfig, layer-first types
- [x] **T04: 12-ecosystem-vault-expansion 03**
  - Create the glob expander utility, sub-project detector, version catalog parser, and rewrite the collector to use configurable glob-based collection with L0/L1/L2 layer routing.

Purpose: The collector is the data ingestion layer -- it determines what files enter the vault pipeline. Replacing hardcoded collection functions with glob-based collection makes the system configurable per project (ECOV-07), enables L1 ecosystem collection (ECOV-01), L2 app collection (ECOV-02), architecture doc collection (ECOV-03), and sub-project support (ECOV-04). The version catalog parser implements the features.versionCatalog opt-in flag from ProjectConfig.
Output: Four source files: glob-expander.ts, sub-project-detector.ts, version-catalog-parser.ts, rewritten collector.ts
- [x] **T05: 12-ecosystem-vault-expansion 04**
  - Update the transformer pipeline (transformer, tag generator, wikilink generator) and vault writer to support layer-first output paths, slug disambiguation, extended tagging, and clean-slate migration.

Purpose: The transformer pipeline converts collected VaultSources into VaultEntries with enriched frontmatter, wikilinks, and correct vault output paths. With the new layer-first structure, paths change from flat (patterns/, skills/, projects/) to hierarchical (L0-generic/, L1-ecosystem/, L2-apps/). The vault writer needs clean-slate migration to remove old structure. These changes are independent of the collector rewrite (Plan 03) -- both depend only on the types from Plan 02.
Output: Updated transformer.ts, tag-generator.ts, wikilink-generator.ts, and vault-writer.ts
- [x] **T06: 12-ecosystem-vault-expansion 05**
  - Rewrite MOC generator for ecosystem-aware groupings with Home.md, and update the sync engine to wire the full layer-first pipeline together.

Purpose: MOC pages are the primary navigation surface in Obsidian -- they must reflect the L0/L1/L2 hierarchy with descriptive labels and project groupings (ECOV-06). The sync engine orchestrates the full pipeline and needs to handle clean-slate migration, pass the new config through, and provide per-layer status (ECOV-05).
Output: Rewritten moc-generator.ts with 7 MOC pages + updated sync-engine.ts
- [x] **T07: 12-ecosystem-vault-expansion 06**
  - Update MCP tools (sync-vault, vault-status, find-pattern) and the sync-vault skill definition for ecosystem-aware operation.

Purpose: MCP tools are the agent-facing surface -- they must expose the L0/L1/L2 model consistently (ECOV-06). find-pattern needs ecosystem-aware queries so agents can ask "give me all patterns for DawSync" and get L0 + L1 + L2-DawSync results. The vault-status tool needs per-layer breakdowns. The skill definition needs updated parameters.
Output: Updated sync-vault, vault-status, find-pattern tools + updated SKILL.md
- [x] **T08: 12-ecosystem-vault-expansion 07**
  - Rewrite all vault tests for the layer-first structure and run full verification. This is a clean rewrite per CONTEXT.md locked decision -- not incremental updates to old tests. Replaces the Wave 0 stubs (from Plan 00) with fully-implemented tests.

Purpose: Tests validate that the entire refactored pipeline works correctly. Without tests, we cannot verify ECOV requirements are met. The rewrite approach (vs. updating) is deliberate: old tests assert flat paths (patterns/, skills/, projects/) which are fundamentally wrong for the new structure. Plan 00 created stubs; this plan fills them with real assertions.
Output: 9 unit test files (7 rewritten + 2 new) + 1 integration test rewritten, all passing. Human checkpoint for Obsidian visual verification.

## Files Likely Touched

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
- `.planning/REQUIREMENTS.md`
- `mcp-server/src/vault/types.ts`
- `mcp-server/src/vault/config.ts`
- `mcp-server/src/vault/glob-expander.ts`
- `mcp-server/src/vault/sub-project-detector.ts`
- `mcp-server/src/vault/collector.ts`
- `mcp-server/src/vault/version-catalog-parser.ts`
- `mcp-server/src/vault/transformer.ts`
- `mcp-server/src/vault/tag-generator.ts`
- `mcp-server/src/vault/wikilink-generator.ts`
- `mcp-server/src/vault/vault-writer.ts`
- `mcp-server/src/vault/moc-generator.ts`
- `mcp-server/src/vault/sync-engine.ts`
- `mcp-server/src/tools/sync-vault.ts`
- `mcp-server/src/tools/vault-status.ts`
- `mcp-server/src/tools/find-pattern.ts`
- `skills/sync-vault/SKILL.md`
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
