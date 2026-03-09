# Phase 10: Doc Intelligence & Detekt Generation - Context

**Gathered:** 2026-03-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Pattern docs stay current through automated monitoring of official sources, and verified patterns can generate custom Detekt rules — so deprecated APIs and new recommendations are caught automatically. Includes a final v1.1 milestone cleanup/audit pass to leave the repository professional, consistent, and fully documented before milestone closure.

</domain>

<decisions>
## Implementation Decisions

### Source monitoring
- **Tiered monitoring levels** with user control — user decides which tier to run and when
- **Both on-demand + CI scheduled** — skill/MCP tool for ad-hoc checks, GitHub Actions cron for regular sweeps
- **Deprecation detection** enabled — when upstream deprecates an API a pattern doc recommends, flag as HIGH severity
- **Update behavior**: Default is suggest-and-approve (generate proposed changes, user reviews). Configurable to auto-apply safe changes (version bumps) while flagging risky ones (API changes) — controlled by user setting
- **Monitoring tier structure**: Claude's discretion — professional, AI-oriented enterprise approach
- **Report format**: Claude's discretion — professional, AI-oriented enterprise approach
- **Source-to-doc linking**: Claude's discretion — leverage existing frontmatter `sources:` field from Phase 9
- **CI output format**: Claude's discretion — professional, AI-oriented enterprise approach

### Update approval flow
- **Review UX**: Claude's discretion — professional, AI-oriented, enterprise approach
- **Review state tracking**: Yes — remember which findings were already reviewed (accepted/rejected/deferred), next run only shows new findings, prevents review fatigue
- **Auto-commit on approval**: Yes, with conventional commit messages (e.g., `docs(patterns): update kotlinx-coroutines refs to 1.9.0`) but always user-approved first — no noise in their project/organization
- **Deferred logging**: Claude's discretion — consider noise-awareness and configurability

### Detekt rule generation
- **Rule definition format**: YAML `rules:` section in pattern doc frontmatter with structured entries (type, prefer/over, message fields). Machine-readable, co-located with the pattern doc
- **Generation approach**: Claude's discretion — professional, AI-oriented, enterprise approach (must remain AST-only per project constraint)
- **Module location**: Claude's discretion — professional approach (existing `detekt-rules/` module has 5 hand-written rules)
- **Rule types to support**: Claude's discretion — professional, AI-oriented enterprise approach
- **Link existing rules to pattern docs**: Yes — existing 5 hand-written rules get metadata linking them to their source pattern docs. System detects rule-doc drift when patterns change
- **Generate tests alongside rules**: Yes — each generated rule gets companion test with compliant/violating code samples, mirroring existing hand-written rule test pattern
- **Consumer rule generation**: Yes — consuming projects with L1 pattern docs containing `rules:` frontmatter can generate project-specific Detekt rules (e.g., DawSync domain-specific enforcement)
- **Rule update handling**: Claude's discretion — professional enterprise approach
- **Distribution**: Composite build — same `includeBuild("../AndroidCommonDoc")` pattern consumers already use. Zero extra config
- **Multi-tool surface**: Not Claude-only — tooling accessible via MCP + scripts/skills for Copilot and other AI tools (follows existing adapter pattern)

### User-contributed sources
- **Source configuration**: Claude's discretion — professional, AI-oriented, enterprise approach
- **URL types supported**: Claude's discretion — professional enterprise approach
- **L1 monitoring**: Yes — consumer projects can add monitoring sources to their L1 pattern docs. Follows registry layering model (L0/L1/L2)
- **URL validation**: Yes — validate reachability and parseable content when a user adds a monitor_url. Prevents broken monitoring configs
- **Arbitrary content ingestion**: Users can contribute content from any source — Medium posts, LinkedIn articles, blog posts, conference talks, etc. The system must:
  - Accept pasted content (text + images) when a URL can't be fetched directly (paywall, unsupported platform)
  - Analyze the contributed content, extract relevant patterns/recommendations
  - Route extracted insights to the appropriate existing pattern doc(s) or suggest creating new ones
  - Handle images/diagrams in the pasted content (analyze and reference in docs)
- **Unsupported URL fallback**: When a URL type isn't directly fetchable (e.g., Medium paywall, LinkedIn auth-wall), gracefully degrade — prompt user to paste the content manually instead of failing silently. Log unsupported URL types for potential future support

### Cleanup and audit (v1.1 milestone closure)
- **Included in Phase 10** as the final plans — Phase 10 is the last phase of v1.1
- **Dead code/scripts audit**: Find and remove unused scripts, orphaned files, dead code paths from v1.0→v1.1 evolution
- **Consolidation opportunities**: Identify overlapping tools/scripts (e.g., check-freshness overlap with new doc intelligence) and merge into coherent systems
- **README + docs accuracy**: Verify README, AGENTS.md, CLAUDE.md, skill descriptions all reflect current state after Phase 10
- **Convention compliance**: Verify the toolkit follows its own conventions (naming, file structure, error handling). Dog-food the rules
- **Tool alignment**: Ensure check-freshness, find-pattern, and new doc intelligence tools share consistent interfaces, error handling, output formats
- **Registry/frontmatter hardening**: Validate all frontmatter is complete and consistent, ensure registry scanner handles new fields (`rules:`, `monitor_urls:`) cleanly
- **v1.1 changelog**: Generate CHANGELOG.md entry summarizing all v1.1 capabilities (Konsist, guard tests, MCP server, pattern registry, doc intelligence, detekt generation)

### Claude's Discretion
- Monitoring tier structure and report format
- CI output format (GitHub issue, artifact, or other)
- Update review UX (interactive skill, batch report, or other)
- Deferred update logging approach (noise-awareness)
- Detekt rule generation approach (generated Kotlin source, template-based, or runtime-interpreted — must be AST-only)
- Module location for generated rules (extend detekt-rules/ or separate module)
- Initial rule types to support (prefer-API, banned-imports, naming conventions, etc.)
- Rule update handling when pattern docs change
- Source configuration format (frontmatter URLs, central config, or both)
- Supported URL types (GitHub releases, changelogs, Maven Central, doc pages)
- MCP + skill surface design for multi-tool accessibility

</decisions>

<specifics>
## Specific Ideas

- User consistently wants "the cleanest, most professional, solid, clean, maintainable enterprise approach" — same direction as all prior phases
- Multi-tool surface is critical: not just Claude MCP, also Copilot adapters and scripts. Follow existing open/closed adapter pattern
- The repo has evolved significantly through v1.1 — an audit may reveal more optimal ways to solve problems that were addressed early. Be open to consolidation
- All documentation (README, .claude, AGENTS.md, skills) must be current before milestone closure — no stale references to pre-Phase 10 capabilities
- Existing 5 Detekt rules should be treated as first-class citizens of the system, not legacy — link them to their pattern docs
- Users should be able to feed the system with knowledge from any source: Medium posts, LinkedIn articles, blog posts, conference talks — paste content when URLs aren't fetchable. The system analyzes and routes relevant patterns to the right docs

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `detekt-rules/` module: 5 hand-written AST-only rules with `AndroidCommonDocRuleSetProvider`, Detekt 2.0.0-alpha.2 API, full test suite — template for generated rules
- `mcp-server/src/tools/check-freshness.ts`: Existing freshness check MCP tool — evolve or consolidate with new doc intelligence
- `mcp-server/src/registry/scanner.ts`: Dynamic directory scanner with frontmatter parsing — extend for `rules:` and `monitor_urls:` fields
- `mcp-server/src/registry/frontmatter.ts`: YAML frontmatter parser using `yaml` npm package — add new field support
- `mcp-server/src/registry/resolver.ts`: L0/L1/L2 layer resolution with full replacement semantics — reuse for monitoring source resolution
- `mcp-server/src/registry/project-discovery.ts`: Auto-discover consumer projects from settings.gradle.kts — reuse for consumer monitoring
- `mcp-server/src/tools/find-pattern.ts`: Metadata-based search across registry layers — pattern for new monitoring tools
- `mcp-server/src/utils/rate-limiter.ts` + `rate-limit-guard.ts`: Rate limiting infrastructure — reuse for monitoring tools

### Established Patterns
- MCP server: TypeScript + stdio transport + ESLint/Prettier (Phase 8)
- Zod schemas for MCP tool parameter validation
- Frontmatter: YAML with required fields `scope`, `sources`, `targets` (Phase 9)
- Dynamic registry scan — no hardcoded lists (Phase 9, KNOWN_DOCS removed)
- AST-only Detekt rules — avoid Detekt #8882 performance issue in KMP monorepos
- Convention plugin for one-line Gradle adoption
- Composite build distribution via `includeBuild` + dependency substitution
- Dual script platform (PS1 + SH) with parity tests
- Multi-tool skill generation: SKILL.md → Claude Code + Copilot adapters
- Guard test templates with token substitution (Phase 7) — potential pattern for rule templates

### Integration Points
- `docs/*.md` frontmatter: Add `rules:` and `monitor_urls:` fields to existing pattern docs
- `detekt-rules/build.gradle.kts`: Extend for generated rule compilation
- `AndroidCommonDocRuleSetProvider.kt`: Register generated rules alongside hand-written ones
- `mcp-server/src/tools/index.ts`: Register new monitoring + generation tools
- `mcp-server/src/registry/types.ts`: Extend `PatternMetadata` with new fields
- Consumer `.androidcommondoc/docs/`: L1 pattern docs with monitoring sources and rule definitions
- GitHub Actions CI: Add cron workflow for scheduled monitoring

</code_context>

<deferred>
## Deferred Ideas

- **Full repository architecture optimization** — The user noted that as AndroidCommonDoc evolved, there may be more optimal approaches to problems solved early. A deep architectural review could identify further improvements, but this is beyond Phase 10's scope and could be a v1.2 initiative
- **Conventional Commits enforcement** — Git commit-msg hook (noted in Phase 6 deferred, still not scoped)
- **Gitflow workflow validation** — Branch naming rules (noted in Phase 6 deferred, still not scoped)
- **Codex adapter** — ADAPT-01 in future requirements
- **Cursor/Windsurf rule adapters** — ADAPT-02 in future requirements

</deferred>

---

*Phase: 10-doc-intelligence-detekt-generation*
*Context gathered: 2026-03-14*
