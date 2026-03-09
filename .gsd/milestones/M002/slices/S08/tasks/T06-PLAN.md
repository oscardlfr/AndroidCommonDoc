# T06: 12-ecosystem-vault-expansion 05

**Slice:** S08 — **Milestone:** M002

## Description

Rewrite MOC generator for ecosystem-aware groupings with Home.md, and update the sync engine to wire the full layer-first pipeline together.

Purpose: MOC pages are the primary navigation surface in Obsidian -- they must reflect the L0/L1/L2 hierarchy with descriptive labels and project groupings (ECOV-06). The sync engine orchestrates the full pipeline and needs to handle clean-slate migration, pass the new config through, and provide per-layer status (ECOV-05).
Output: Rewritten moc-generator.ts with 7 MOC pages + updated sync-engine.ts

## Must-Haves

- [ ] "Home.md MOC page auto-generated with ecosystem overview, MOC links, layer counts"
- [ ] "By Layer MOC shows descriptive sublabels: L0 = Generic Patterns, L1 = Ecosystem, L2 = App-Specific"
- [ ] "By Layer MOC includes ALL vault entries (not just pattern docs)"
- [ ] "L2 entries grouped by project with sub-headers in By Layer and By Project MOCs"
- [ ] "Sub-projects listed under parent project headers in MOC pages"
- [ ] "Override visibility: L0 originals and L1/L2 overrides both appear with annotation"
- [ ] "Sync engine passes layer-first config through the pipeline correctly"
- [ ] "initVault triggers clean-slate migration before first sync"
- [ ] "getVaultStatus returns per-layer file breakdown"

## Files

- `mcp-server/src/vault/moc-generator.ts`
- `mcp-server/src/vault/sync-engine.ts`
