# Stack Research

**Domain:** Documentation coherence, CLAUDE.md ecosystem alignment, context delegation, and standard doc templates for KMP developer toolkit
**Researched:** 2026-03-14
**Confidence:** HIGH (this milestone is primarily documentation structure + minimal tooling additions to an existing, validated MCP server)

## Context

This is a DELTA stack document for v1.2. The v1.0 stack (Kotlin 2.3.10, Detekt 2.0.0-alpha.2, Gradle 9.1.0, 23 pattern docs, 16 skills, Python3 adapters, Bash/PS1 scripts) and v1.1 stack (TypeScript MCP SDK 1.27.1, Vitest 3.x, Konsist 0.17.3, Obsidian vault sync pipeline, L0/L1/L2 collector/transformer/MOC generator) are validated and shipping. This document covers ONLY the changes needed for v1.2 documentation coherence features.

**Key insight: v1.2 is 90% content work, 10% tooling work.** The existing MCP server, vault sync pipeline, and quality gate infrastructure already support what is needed. The primary deliverables are well-structured Markdown files (CLAUDE.md rewrites, doc templates, consolidated docs) and minor MCP tool additions for validation.

## Recommended Stack Additions

### No New Core Technologies Required

v1.2 does not require new languages, frameworks, or major library additions. The existing stack is sufficient:

| Existing Technology | v1.2 Usage | Notes |
|---------------------|------------|-------|
| TypeScript (MCP server) | New validation tool(s) for CLAUDE.md coherence checking | Same @modelcontextprotocol/sdk 1.27.1, same Vitest test framework |
| Markdown | Standard doc structure templates, CLAUDE.md rewrites | Plain Markdown with YAML frontmatter (existing pattern) |
| YAML frontmatter | Metadata for doc templates, cross-reference declarations | Existing `yaml` npm package 2.8.x already in MCP server |
| Vault sync pipeline | Updated collector globs, possibly new sourceType | Existing transformer/MOC pipeline handles new content automatically |

### Supporting Additions

| Addition | Purpose | Integration Point |
|----------|---------|-------------------|
| `@import` references in CLAUDE.md files | Cross-layer context delegation between L0/L1/L2 | Claude Code native feature -- no library needed |
| JSON Schema for doc structure validation | Optional: validate that project docs follow standard template | Existing `zod` 3.24.x in MCP server already handles schema validation |
| Markdown section parser (hand-rolled) | Validate CLAUDE.md structure against template requirements | ~50 lines TypeScript, no external dependency needed |

### Development Tools (Unchanged)

| Tool | Purpose | Notes |
|------|---------|-------|
| Vitest 3.x | Test new validation logic | Already configured in mcp-server/ |
| ESLint 9 + @typescript-eslint | Lint new TypeScript code | Already configured |
| Prettier 3.x | Format new TypeScript code | Already configured |

## What Is Actually New in v1.2

### 1. CLAUDE.md Template & Cross-Reference System (Pure Markdown)

**What:** Standardized CLAUDE.md structure that each project follows, with `@import` directives for cross-layer context delegation.

**Why no new tech:** Claude Code natively supports `@path/to/file` in CLAUDE.md files. This is a content design problem, not a tooling problem. The `@import` syntax:
- Resolves relative and absolute paths
- Supports `@~/` for home directory references
- Loads imported files into Claude's context on session start
- Is recursive (imported files can import other files)

**Implementation approach:** Write three CLAUDE.md files (AndroidCommonDoc, shared-kmp-libs, DawSync) that use `@import` to reference each other's documentation via the `@~/.claude/docs/` directory or direct relative paths. No code to write -- just well-structured Markdown.

**Cross-reference pattern:**
```markdown
# DawSync CLAUDE.md

## Ecosystem Context
@~/.claude/CLAUDE.md (shared KMP rules)

## Architecture Patterns
See @docs/architecture/PATTERNS.md for domain-specific patterns.
For generic KMP patterns, consult @~/.claude/docs/kmp-architecture.md (from L0 AndroidCommonDoc).
```

### 2. Standard Doc Structure Template (Pure Markdown)

**What:** A template defining the expected sections for project documentation, organized by domain (architecture, testing, UI, data, cross-cutting).

**Why no new tech:** This is a Markdown file that serves as a reference template. Quality gate validation (optional) uses existing pattern-matching capabilities in the MCP server.

**Template structure (domain sections):**
- Architecture (module structure, data flow, key patterns)
- Testing (frameworks, coverage targets, patterns)
- UI (design system, navigation, accessibility)
- Data (storage, network, sync)
- Cross-cutting (error handling, DI, logging)

### 3. CLAUDE.md Validation Tool (Minor MCP Addition)

**What:** An MCP tool that validates CLAUDE.md files against the standard template, checking for required sections, broken `@import` references, and cross-layer consistency.

**Why existing stack is sufficient:**
- Markdown parsing: split by `##` headers, check section presence -- ~50 lines TypeScript
- `@import` validation: regex extract `@path/to/file` references, verify files exist via `fs.access` -- ~30 lines
- Cross-layer consistency: check that L2 CLAUDE.md references L1/L0 docs appropriately -- ~40 lines
- Total: one new tool file (~200 lines), one test file (~150 lines), registration in index.ts

**Implementation:** Single new file `mcp-server/src/tools/validate-claude-md.ts` following the established tool pattern (rate limiter, zod schema, structured JSON response).

### 4. DawSync Doc Consolidation (Pure Content Work)

**What:** Audit DawSync's docs/ directory, archive stale content, consolidate overlapping docs, identify L0 promotion candidates.

**Why no new tech:** This is editorial work. The vault sync pipeline already collects DawSync docs. The only tooling touch is potentially updating `vault-config.json` exclude globs for archived content.

### 5. Vault Sync Updates (Minor Config Changes)

**What:** Update default collection globs to collect the new standardized doc structure from all projects.

**Why existing stack is sufficient:** The `getDefaultGlobs()` function in `config.ts` already returns glob patterns. Updating the default patterns or adding layer-specific defaults (the `_layer` parameter is already reserved) is a one-line change.

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| Hand-rolled Markdown section parser | remark/unified/mdast | Over-engineered for checking section headers in <10 files; adds 50+ transitive dependencies for ~50 lines of logic |
| `@import` in CLAUDE.md | Custom context injection via MCP resources | `@import` is Claude Code native, zero overhead, auto-loaded on session start; MCP resources require explicit tool calls |
| Single validate-claude-md MCP tool | Quality gate agent for CLAUDE.md | Agents are for orchestration; a focused tool is more composable and can be called from existing quality-gate-orchestrator |
| YAML frontmatter for doc metadata | JSON sidecar files per doc | Consistent with existing pattern doc convention; one file not two |
| Plain Markdown templates | Docusaurus/MDX/custom templating engine | Templates are reference documents, not rendered sites; Markdown is universal |
| Direct @path references between repos | Symlinks or file copying | `@` references are first-class in Claude Code, work across repos without filesystem tricks |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| remark/unified/rehype | Massive dependency tree for trivial Markdown structure checking | Hand-rolled header extraction (~50 lines) |
| Custom doc rendering engine | v1.2 is about content structure, not presentation | Plain Markdown files that humans and agents read directly |
| Template generation scripts | Over-engineering; templates are reference documents, not scaffolding | Markdown template files that developers copy and fill in |
| CLAUDE.md generation from code analysis | `/init` already does this; re-implementing adds no value | Manual authoring with standard template as guide |
| Database for cross-reference tracking | Over-engineering; the L0/L1/L2 relationships are static and small | @import references + vault sync manifest for tracking |
| Complex doc validation CI pipeline | Three projects, one developer; the quality gate agent is sufficient | MCP tool invoked manually or from quality-gate-orchestrator |
| Bidirectional sync between CLAUDE.md files | Conflict resolution complexity, unclear source of truth | Unidirectional: each CLAUDE.md is authoritative for its project, references others read-only |
| NotebookLM API integration | Requires enterprise license; manual upload is sufficient | Vault sync to Obsidian (already working) + manual NotebookLM upload |

## Stack Patterns by Context

**When writing CLAUDE.md files:**
- Use `@~/.claude/docs/pattern-name.md` for L0 generic pattern references (these are already deployed)
- Use `@../shared-kmp-libs/CLAUDE.md` for L1 ecosystem references (relative to project root)
- Keep each CLAUDE.md under 10K words (community-validated performance threshold)
- Use WHY/WHAT/HOW information hierarchy per Anthropic best practices

**When adding MCP validation tools:**
- Follow the established pattern in `mcp-server/src/tools/` (rate limiter, zod schema, structured JSON)
- Test with Vitest using InMemoryTransport (established in Phase 8)
- Register in `tools/index.ts` with rate limiter injection

**When updating vault sync:**
- Modify `vault/config.ts` for default globs
- Update `vault/collector.ts` for new source type classification if needed
- Update `vault/moc-generator.ts` if new MOC groupings are needed
- All changes tested via existing integration test pattern from Phase 12

## Version Compatibility

No new version concerns. All additions use the existing validated stack:

| Component | Version | Compatibility Notes |
|-----------|---------|---------------------|
| @modelcontextprotocol/sdk | 1.27.1 | Stable, no upgrade needed |
| yaml | 2.8.x | Frontmatter parsing, already in use |
| zod | 3.24.x | Schema validation, already in use |
| Node.js | >=18.0.0 | Already enforced in package.json engines |
| TypeScript | 5.7.x | Already configured |
| Vitest | 3.x | Already configured |
| Claude Code CLAUDE.md @import | Native | No version dependency; works in all Claude Code versions supporting CLAUDE.md |

## Context Window Optimization Strategy

Relevant to v1.2 because documentation must be token-efficient for AI agent consumption.

**Key constraints (from Anthropic best practices):**
- CLAUDE.md is loaded every session -- keep it concise, only include what Claude cannot infer from code
- ~1.35 tokens per word estimate for documentation
- Anthropic recommends: "For each line, ask: Would removing this cause Claude to make mistakes?"
- Skills (`.claude/skills/SKILL.md`) are loaded on demand -- use for domain knowledge not needed every session
- Subagents run in separate context -- use for investigation-heavy tasks

**Token budget guidelines for v1.2 CLAUDE.md files:**
| Project | Target Size | Rationale |
|---------|-------------|-----------|
| AndroidCommonDoc | ~3K words (~4K tokens) | Toolkit overview, commands, conventions, boundaries |
| shared-kmp-libs | ~2K words (~2.7K tokens) | Module catalog, critical rules, build commands |
| DawSync | ~5K words (~6.7K tokens) | Largest project, most domain context needed |
| ~/.claude/CLAUDE.md | ~2K words (~2.7K tokens) | Shared KMP rules, cross-cutting conventions |

**Total ecosystem context at session start:** ~12K words (~16K tokens). Well within the recommended <10K per file threshold, and total is <5% of a 200K context window.

**Token efficiency patterns to apply:**
1. Delegate detail to `@import` files that Claude loads on demand (not at session start)
2. Use tables over prose (3x more information-dense)
3. Commands section: only non-obvious commands (Claude can read build files)
4. Architecture section: decision rationale, not code structure (Claude can read code)
5. Link to pattern docs via `@~/.claude/docs/` instead of inlining content

## Sources

- [Anthropic: Using CLAUDE.md Files](https://claude.com/blog/using-claude-md-files) -- Official guide for CLAUDE.md structure, hierarchy, @import syntax (HIGH confidence)
- [Anthropic: Best Practices for Claude Code](https://code.claude.com/docs/en/best-practices) -- CLAUDE.md size guidelines, skills vs CLAUDE.md, context management (HIGH confidence)
- [Anthropic: Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) -- Information density principles, just-in-time retrieval, structured note-taking (HIGH confidence)
- [Addy Osmani: How to Write a Good Spec for AI Agents](https://addyosmani.com/blog/good-spec/) -- Six essential areas, modular specs, living documents (MEDIUM confidence)
- [DEV Community: Organizing CLAUDE.md in a Monorepo](https://dev.to/anvodev/how-i-organized-my-claudemd-in-a-monorepo-with-too-many-contexts-37k7) -- Hierarchical structure, <10K words target, 80% reduction strategy (MEDIUM confidence)
- [GitHub Gist: Monorepo CLAUDE.md for Multi-Project](https://gist.github.com/pirate/ef7b8923de3993dd7d96dbbb9c096501) -- Shared ecosystem table pattern across CLAUDE.md files (MEDIUM confidence)
- Existing MCP server codebase analysis (mcp-server/src/) -- Tool patterns, vault pipeline, rate limiter conventions (HIGH confidence, primary source)
- Existing CLAUDE.md files across ecosystem (~/.claude/CLAUDE.md, shared-kmp-libs/CLAUDE.md, DawSync/CLAUDE.md) -- Current state baseline (HIGH confidence, primary source)

---
*Stack research for: v1.2 Documentation Coherence & Context Management*
*Researched: 2026-03-14*
