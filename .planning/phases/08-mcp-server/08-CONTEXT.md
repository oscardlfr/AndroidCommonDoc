# Phase 8: MCP Server - Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Expose pattern docs, skill definitions, and validation commands as MCP tool endpoints for AI agent access. TypeScript MCP server running as a Claude Code subprocess via stdio transport. Covers MCP-01 through MCP-05. Read-only/advisory — no write capabilities. Local stdio only — no cloud deployment.

</domain>

<decisions>
## Implementation Decisions

### Resource URI design
- Claude's discretion on URI scheme (flat `docs://androidcommondoc/{name}` vs typed `acd://{type}/{name}`)
- Claude's discretion on whether skills (16 SKILL.md files) are also exposed as resources alongside the 8 pattern docs
- Claude's discretion on discovery/listing (MCP protocol has resources/list natively)
- Claude's discretion on raw markdown vs metadata-enriched responses
- Claude's discretion on dynamic filesystem scan vs hardcoded manifest
- Claude's discretion on resource templates (parameterized URIs)
- Claude's discretion on freshness data (inline vs separate tool concern)
- Claude's discretion on content negotiation (full vs summary variants)
- Claude's discretion on meta docs (CLAUDE.md/AGENTS.md as resources)
- Claude's discretion on related resource linking
- Claude's discretion on file watching / live update notifications
- Translate `propuesta-integracion-enterprise.md` to English so all resources are consistently English

### Validation tool selection
- Claude's discretion on which 5+ scripts/agents become MCP tools (may add more than 5)
- Include a consolidated 'validate-all' meta-tool that runs every validation and returns combined results
- Include a setup validation tool that checks if a project is properly configured (env var, hooks, skills, Detekt)
- Claude's discretion on structured JSON output format (normalized schema vs tool-specific)
- Claude's discretion on live execution vs cached reports
- Claude's discretion on parameterized tools vs whole-project-only
- Claude's discretion on error handling for unavailable scripts/platforms
- Claude's discretion on dry-run mode, timing info, severity filtering
- Claude's discretion on individual gate tools vs unified orchestrator tool (or both)
- Report-only approach — consistent with advisory/no-write-capabilities philosophy. Claude decides whether to include suggested fixes in reports.
- Claude's discretion on cross-project validation (accepting a project path parameter)
- Claude's discretion on linking validation results back to relevant pattern doc resources
- Claude's discretion on progress notifications vs blocking execution
- Claude's discretion on caching strategy
- Claude's discretion on Konsist test result exposure
- Claude's discretion on Windows script execution strategy (Git Bash vs PowerShell per platform)
- Configurable rate limiting to prevent runaway agent loops — defensive enterprise design

### Prompt template content
- Claude's discretion on prompt types (layer-focused vs full architecture audit)
- Claude's discretion on whether prompts accept arguments or are static templates
- Claude's discretion on prompt count (1 per doc vs curated essential set)
- Claude's discretion on inline content vs resource URI references
- Claude's discretion on severity guide, versioning, strictness levels
- Include a PR-level review prompt that takes a diff and reviews all changed files against relevant patterns
- Include an onboarding prompt that guides new developers through toolkit patterns and setup
- Claude's discretion on context injection (additional_rules parameter)
- Claude's discretion on explain/teaching prompts vs review-only
- Claude's discretion on example violations in prompts
- Claude's discretion on rule authoring prompts and batch review mode

### Server packaging
- TypeScript compiled (not plain JavaScript) — type safety, IDE support, enterprise quality
- Full test suite — unit tests for each tool/resource/prompt handler, integration tests for stdio transport
- ESLint + Prettier for code quality and formatting
- GitHub Actions CI workflow for automated testing on push/PR
- Full README.md with setup instructions, architecture overview, and API reference
- Include a changelog/what's-new resource that summarizes recent changes to patterns, skills, and rules
- Claude's discretion on server location in repo (mcp-server/ at root vs tools/mcp-server/)
- Claude's discretion on registration approach (claude mcp add, setup-toolkit.sh, or both)
- Claude's discretion on package.json dependencies vs bundled/zero-dependency
- Claude's discretion on npm publishing vs local-repo-only
- Claude's discretion on config approach (config file vs CLI args vs env vars)
- Claude's discretion on type exports for external TS consumers
- Claude's discretion on test framework (Vitest/Jest/Node test runner)
- Claude's discretion on Docker support
- Claude's discretion on module system (ES Modules vs CommonJS)
- Claude's discretion on version endpoint, graceful shutdown, --version flag

### Claude's Discretion
- URI scheme design and resource organization
- Which specific validation scripts become MCP tools
- JSON output schema design
- Script execution and caching strategy
- Prompt content and structure decisions
- Server architecture (monolithic vs plugin system)
- Cross-project and multi-project support
- Authentication (likely none needed for stdio-only)
- Error telemetry approach
- Token-efficient condensed resource format
- Usage analytics
- Batch validation and parallel execution
- Pattern compliance metrics
- Doc search tool
- Skill recommendation intelligence
- Lint configuration resource exposure

</decisions>

<specifics>
## Specific Ideas

- User consistently wants "the cleanest, most professional, solid, clean enterprise approach" — same direction as Phases 5-7
- Translate `propuesta-integracion-enterprise.md` to English before exposing as MCP resource
- Consolidated validate-all meta-tool mirrors existing quality-gate-orchestrator's unified report pattern
- PR-level review prompt is high-value — takes a diff and reviews all changed Kotlin files against relevant patterns
- Onboarding prompt guides new developers through toolkit patterns — enterprise adoption accelerator
- Rate limiting provides defensive design against runaway agent loops
- GitHub Actions CI ensures MCP server quality matches the rest of the toolkit
- Setup validation tool checks project configuration completeness (env var, hooks, skills, Detekt config)
- Changelog resource keeps agents aware of pattern/skill evolution

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `docs/` directory: 9 pattern docs (8 English + 1 Spanish to translate) — direct content source for MCP resources
- `skills/*/SKILL.md`: 16 skill definitions — potential additional MCP resources
- `scripts/sh/` + `scripts/ps1/`: 13 script pairs — candidates for MCP tool wrappers
- `.claude/agents/`: 5 quality gate agents — quality-gate-orchestrator pattern informs validate-all meta-tool design
- `setup-toolkit.sh`: Unified setup script — model for MCP server registration integration
- `konsist-tests/`: Konsist module — potential MCP tool for architecture validation

### Established Patterns
- Cross-platform scripts (SH + PS1 parity) — MCP tools should leverage both via platform detection
- Colored logging (`log_info/ok/warn/err`) — map to structured JSON severity levels
- `--dry-run/--force/--projects` flags — inform MCP tool parameter schemas
- Quality gate orchestrator delegates to individual agents — validate-all tool follows same pattern
- `ANDROID_COMMON_DOC` env var resolves toolkit path — MCP server uses this as base path
- Composite build pattern: `includeBuild("../AndroidCommonDoc")` — informs cross-project validation context

### Integration Points
- `claude mcp add` command — registers MCP server as Claude Code subprocess
- setup-toolkit.sh — potential integration point for automated MCP registration
- `.claude/settings.json` — MCP server configuration stored here by Claude Code
- `scripts/sh/*.sh` — MCP tools invoke these scripts for live validation
- `docs/*.md` — MCP resources read these files for pattern doc content
- `skills/*/SKILL.md` — MCP resources read these for skill definitions

</code_context>

<deferred>
## Deferred Ideas

- Optional webhooks to external systems (Slack, GitHub) for validation failure notifications — new capability beyond MCP-01 through MCP-05, belongs in future enhancement
- Streamable HTTP transport (SSE) — tracked as MCPX-01 in future requirements
- npm publishing for public distribution — evaluate after local-only validation is solid
- Plugin system for extensibility — refactor to plugins if the monolithic approach proves limiting

</deferred>

---

*Phase: 08-mcp-server*
*Context gathered: 2026-03-13*
