<!-- GENERATED from CLAUDE.md files -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/claude-md-copilot-adapter.sh -->
# Coding Instructions

These instructions are generated from the CLAUDE.md ecosystem (L0 global + project-specific).
Follow these rules when writing code in this project.

## Doc Consultation

- Vault sync → `mcp-server/src/vault/` (transformer, moc-generator, wikilink-generator)
- New skill → `skills/sync-vault/SKILL.md` as canonical example
- L0→L1/L2 propagation → `skills/sync-l0/SKILL.md`
- Pattern docs → `docs/` with category hubs (17 domains, 81+ sub-docs)
- Upstream validation → `docs/guides/upstream-validation.md` (validate_upstream frontmatter)
- Detekt rules → `detekt-rules/` + `docs/guides/detekt-config.md`
- Spec-driven workflow → `docs/agents/spec-driven-workflow.md`
- Agent templates → `setup/agent-templates/` (product-strategist, content-creator, landing-page-strategist; orchestration guide at `docs/agents/main-agent-orchestration-guide.md`)
- Note: `setup/agent-templates/team-lead.md` deprecated W31.6 — see `docs/agents/main-agent-orchestration-guide.md`
- Business doc templates → `setup/doc-templates/business/` (PRODUCT_SPEC, MARKETING, PRICING, LANDING_PAGES, COMPETITIVE)
- MCP tools → 46 tools via ~/.mcp.json — architects/specialists must declare them in `tools:` frontmatter to call them (Wave 25 fix: prose references alone don't load schemas)
- Dependency freshness → `check-outdated` MCP tool (TOML parser, Maven Central, kdoc-state v2 cache)

