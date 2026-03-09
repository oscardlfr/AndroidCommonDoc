# T05: 12-ecosystem-vault-expansion 04

**Slice:** S08 — **Milestone:** M002

## Description

Update the transformer pipeline (transformer, tag generator, wikilink generator) and vault writer to support layer-first output paths, slug disambiguation, extended tagging, and clean-slate migration.

Purpose: The transformer pipeline converts collected VaultSources into VaultEntries with enriched frontmatter, wikilinks, and correct vault output paths. With the new layer-first structure, paths change from flat (patterns/, skills/, projects/) to hierarchical (L0-generic/, L1-ecosystem/, L2-apps/). The vault writer needs clean-slate migration to remove old structure. These changes are independent of the collector rewrite (Plan 03) -- both depend only on the types from Plan 02.
Output: Updated transformer.ts, tag-generator.ts, wikilink-generator.ts, and vault-writer.ts

## Must-Haves

- [ ] "Transformer builds layer-first vault paths using L0-generic/, L1-ecosystem/, L2-apps/ prefixes"
- [ ] "Slug disambiguation prevents collisions across layers (L0 bare slugs, L1/L2 project-prefixed)"
- [ ] "Tag generator adds layer tags, domain/architecture tags, and sub-project tags"
- [ ] "Wikilink generator handles layer-qualified slug pool without duplicate links"
- [ ] "Vault writer supports clean-slate migration from flat to layer-first structure"
- [ ] "VaultEntry carries layer field populated by transformer"
- [ ] "vault_source_path breadcrumb added to enriched frontmatter"
- [ ] "VAULT_TYPE_MAP includes 'architecture' type"

## Files

- `mcp-server/src/vault/transformer.ts`
- `mcp-server/src/vault/tag-generator.ts`
- `mcp-server/src/vault/wikilink-generator.ts`
- `mcp-server/src/vault/vault-writer.ts`
