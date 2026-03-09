# AndroidCommonDoc

> **Layer:** L0 (Pattern Toolkit)
> **Inherits:** `~/.claude/CLAUDE.md` (auto-loaded)
> **Purpose:** L0 pattern toolkit — docs, skills, Detekt rules, MCP server, vault sync

## Project Context

AndroidCommonDoc is the **source of truth for all KMP patterns**. It feeds L1/L2 via sync-l0.
- MCP server (`mcp-server/`) is Node.js TypeScript, tested with Vitest
- Skills in `skills/*/SKILL.md`, commands in `commands/`, pattern docs in `docs/`

## Critical Rules

### 1. No console.log in MCP server
- Use `logger` utility (stderr only) — `console.log` corrupts stdio and breaks Claude Desktop

### 2. Doc size limits
- Hub docs **<100 lines**, sub-docs **<300 lines**, absolute max 500 lines
- If a doc is growing beyond this: split it, don't extend it

### 3. Vault sync is fragile
- Run `validate-vault` before every sync (0 duplicates, 0 homogeneity errors)
- Vault files must be `lowercase-kebab-case` — uppercase names cause ghost nodes in Obsidian

### 4. Tests before committing doc changes
- MCP server: `cd mcp-server && npm test`
- Konsist: `./gradlew :konsist-tests:test`
- Detekt: `./gradlew :detekt-rules:test`
- Never mark doc changes done without running the relevant validator

### 5. Pattern docs need YAML frontmatter
- Every doc must have `scope`, `sources`, `targets`, `category`, `slug`
- Cross-references use relative paths — no absolute paths between subdirectories

## Workflow Overrides

### Plan mode triggers
- Any change that touches `moc-generator.ts`, `transformer.ts`, or `wikilink-generator.ts` → enter plan mode, the vault graph is affected
- Any new pattern doc → check hub doc size before adding; may need hub restructure first

### Verification before done
- MCP tool change → run full Vitest suite, verify against real vault with `sync-vault`
- New skill → run `validate-skills`; new doc → run `validate-doc-structure`
- Vault fix → open Obsidian and visually confirm graph before calling it done

## Doc Consultation

- Changing vault sync behavior → read `mcp-server/src/vault/` (transformer, moc-generator, wikilink-generator)
- Adding a new skill → read `skills/sync-vault/SKILL.md` as the canonical example
- Changing L0→L1/L2 propagation → read `skills/sync-l0/SKILL.md`
