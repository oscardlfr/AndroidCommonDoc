# AndroidCommonDoc

> L0 Pattern Toolkit — Source of truth for KMP patterns, skills, Detekt rules, MCP server, and vault sync. Feeds L1/L2 via `/sync-l0`.

## Workflow Orchestration

See [docs/agents/workflow-orchestration.md](docs/agents/workflow-orchestration.md) for plan mode, agent delegation, verification, and autonomous execution rules.

## Project Constraints

See [docs/guides/project-constraints.md](docs/guides/project-constraints.md) for console.log ban, doc size limits, agent template dual-location, vault sync, Git Flow, and agentskills pilot.

## Commands

See [docs/guides/commands.md](docs/guides/commands.md) for all /pre-pr, /readme-audit, /full-audit, and other L0 slash commands.

## Doc Consultation
- Vault sync → `mcp-server/src/vault/` (transformer, moc-generator, wikilink-generator)
- New skill → `skills/sync-vault/SKILL.md` as canonical example
- L0→L1/L2 propagation → `skills/sync-l0/SKILL.md`
- Pattern docs → `docs/` with category hubs (16 domains, 68+ sub-docs)
- Upstream validation → `docs/guides/upstream-validation.md` (validate_upstream frontmatter)
- Detekt rules → `detekt-rules/` + `docs/guides/detekt-config.md`
- Spec-driven workflow → `docs/agents/spec-driven-workflow.md`
- Agent templates → `setup/agent-templates/` (product-strategist, content-creator, landing-page-strategist; orchestration guide at `docs/agents/main-agent-orchestration-guide.md`)
- Note: `setup/agent-templates/team-lead.md` deprecated W31.6 — see `docs/agents/main-agent-orchestration-guide.md`
- Business doc templates → `setup/doc-templates/business/` (PRODUCT_SPEC, MARKETING, PRICING, LANDING_PAGES, COMPETITIVE)
- MCP tools → 46 tools via ~/.mcp.json — architects/specialists must declare them in `tools:` frontmatter to call them (Wave 25 fix: prose references alone don't load schemas)
- Dependency freshness → `check-outdated` MCP tool (TOML parser, Maven Central, kdoc-state v2 cache)

## Wave History

Lives in `git log` + memory (`~/.claude/projects/.../memory/project_*shipped.md`) + `.planning/wave-*/`. Per Boris template (`docs/agents/claude-md-template.md`): temporal context belongs in Memory, not CLAUDE.md.

## RTK Enforcement
Agent templates MUST prefix all git/gh/docker/curl commands with `rtk`. See `docs/agents/main-agent-orchestration-guide.md`.

## Ingestion Loop
External sources (Context7 / WebFetch) flow into L0 docs via an explicit approval chain: context-provider flags the gap → team-lead requests user approval → doc-updater runs `mcp__androidcommondoc__ingest-content` → commits to `docs/{category}/{slug}.md` with citation frontmatter. User approval is a hard gate.
