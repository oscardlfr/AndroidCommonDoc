# Phase 15: CLAUDE.md Ecosystem Alignment - Research

**Researched:** 2026-03-16
**Domain:** Claude Code project instructions, context delegation, MCP validation tooling, Copilot adapter pipeline
**Confidence:** HIGH

## Summary

Phase 15 formalizes the CLAUDE.md layering established in Phase 14.3 into a validated, template-driven system with context delegation, rule inventory, smoke tests, and cross-tool adapter generation. The research covers four primary domains: (1) Claude Code's native CLAUDE.md loading hierarchy and `@import` mechanism, (2) canonical rule extraction and template design patterns, (3) MCP tool architecture for validate-claude-md, and (4) Copilot adapter generation from CLAUDE.md as SSOT.

The key technical finding is that Claude Code natively loads `~/.claude/CLAUDE.md` for all projects (L0 injection) and project-root `CLAUDE.md` per-project. The `@path/to/file` import syntax allows cross-file reference within CLAUDE.md files, but `@~/.claude/file.md` syntax has known reliability issues (GitHub issue #8765). The recommended delegation pattern is: L0 loads automatically via `~/.claude/CLAUDE.md`, L1/L2 project CLAUDE.md files add project-specific context and use `@docs/file.md` for local imports only. The `.claude/rules/` directory provides path-scoped rule loading for conditional rules.

The current ecosystem state is favorable: Phase 14.3 already de-duplicated the files (100/62/62/85 lines, all under 150-line budget). The main work is formalizing the template, extracting the canonical rule checklist, implementing override support, building validation tooling, and adding the Copilot adapter pipeline.

**Primary recommendation:** Use convention-based context delegation (not @import for cross-project references) -- L0 auto-loads via Claude Code's native mechanism, each project CLAUDE.md states its layer and what it inherits, validate-claude-md tool enforces the structure programmatically.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Rule inventory with cross-file consistency**: Inventory every behavioral rule across all 4 CLAUDE.md files AND validate consistency (version numbers match, no contradictory rules, no stale references). L1/L2 rule selectivity (per-rule opt-in/opt-out awareness)
- **L0 fully generic**: `~/.claude/CLAUDE.md` must NOT reference any project by name (DawSync, OmniTrack, shared-kmp-libs). Generic KMP rules only. Essential for corporate portability
- **Explicit override support**: L1/L2 can explicitly override specific L0 rules (e.g., L0 says Koin, corporate L1 could say Dagger/Hilt). Critical for future corporate adoption
- **Automated circular reference detection**: validate-claude-md must check that L0 never points to L1/L2, L1 never points to L2 -- fail on circular or upward references
- **Mandatory identity header**: Every CLAUDE.md starts with project name, layer (L0/L1/L2), one-line purpose, and delegation reference
- **DawSync Wave 1 stays**: Wave 1 parallel tracks are active (user currently working on track-E). Must remain in DawSync CLAUDE.md
- **Copilot instructions generation**: Generate .github/copilot-instructions.md from rewritten CLAUDE.md files
- **validate-claude-md MCP tool**: Checks template structure, detects missing rules vs canonical checklist, validates reference resolution, circular reference detection, cross-file consistency, override validation

### Claude's Discretion
- Rule inventory format (structured table, JSON, both) and granularity (atomic vs grouped)
- Rule drop policy (explicit justification per rule vs smoke-test-sufficient)
- Delegation mechanism details (convention-based, explicit file references, pattern doc pointers)
- Developer context placement after L0 becomes generic
- Override format and validation depth
- Template structure (shared with optional sections vs layer-specific)
- Context budget interpretation (per-file vs per-project)
- Frontmatter on CLAUDE.md (YAML vs pure markdown)
- Smoke test approach (real generation, dry-run, MCP-driven, combination)
- Copilot adapter specifics (format, targets, integration point)
- Build command presentation format
- Whether team/agent rules stay in CLAUDE.md or move to separate file
- Where template reference doc lives (docs/guides/ vs .planning/)

### Deferred Ideas (OUT OF SCOPE)
- Coordinated DawSync agent system -- specialized agents for each DawSync domain
- Corporate environment deployment -- full corporate rollout with team-level L0 and project-level L2s
- Cursor/Windsurf adapters -- only if naturally fits within Phase 15 scope
- NotebookLM API integration
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CLAUDE-01 | Extract canonical rule checklist from all existing CLAUDE.md files | Claude Code loading hierarchy documented; all 4 CLAUDE.md files analyzed (100/62/62/85 lines); rule categories identified across architecture, ViewModel, testing, error handling, build, DI, navigation, naming, team workflow |
| CLAUDE-02 | Design CLAUDE.md template with standard sections, <150 lines, <4000 tokens | Official best practices: "target under 200 lines", use markdown headers/bullets; current files already under budget; template sections and identity header pattern defined |
| CLAUDE-03 | Rewrite CLAUDE.md for AndroidCommonDoc (L0) | Current file at 62 lines, already toolkit-focused; needs identity header, override declaration section |
| CLAUDE-04 | Rewrite CLAUDE.md for shared-kmp-libs (L1) | Current file at 62 lines, module-focused; needs identity header, L0 inheritance declaration, override section |
| CLAUDE-05 | Rewrite CLAUDE.md for DawSync (L2) | Current file at 85 lines with Wave 1 context; needs identity header, L1/L0 inheritance, override section, Wave 1 must stay |
| CLAUDE-06 | Implement L0->L1->L2 context delegation | Convention-based delegation using Claude Code's native loading (no @import needed for L0); @import for local files only; .claude/rules/ for conditional rules; validate-claude-md enforces direction |
| CLAUDE-07 | Smoke test each rewritten CLAUDE.md | Dry-run validation via prompt-response analysis; MCP-driven checklist verification; no need for actual code generation in real projects |
| CLAUDE-08 | MCP tool validate-claude-md | Existing patterns: validate-doc-structure (863 lines), validate-skills (506 lines); TypeScript + Vitest; McpServer.registerTool with zod schema; rate limiter integration; parseFrontmatter utility available |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | (project default) | MCP tool implementation | All existing MCP tools are TypeScript |
| Vitest | (project default) | Testing validate-claude-md | 512 existing tests use Vitest |
| zod | (project default) | MCP tool input schema | Standard across all registered tools |
| @modelcontextprotocol/sdk | (project default) | McpServer.registerTool | Standard MCP tool registration pattern |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:fs/promises | Node built-in | File system access for CLAUDE.md reading | Template validation, reference resolution |
| node:path | Node built-in | Cross-platform path manipulation | Windows compatibility (project on Windows 11) |
| parseFrontmatter | Internal (registry/frontmatter.js) | YAML frontmatter extraction | If CLAUDE.md gets optional frontmatter |
| discoverProjects | Internal (registry/project-discovery.js) | Cross-project CLAUDE.md discovery | validate-claude-md multi-project validation |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Convention-based delegation | @import directives for L0 loading | @~/.claude/file.md has known bugs (issue #8765); convention-based uses Claude Code's native auto-loading |
| Pure markdown CLAUDE.md | YAML frontmatter CLAUDE.md | Frontmatter adds structure for machine validation but adds cognitive overhead; recommend optional frontmatter-like identity block |
| .claude/rules/ directory | Monolithic CLAUDE.md | Rules allow path-scoped conditional loading but add file sprawl; use only for conditional rules, not core project rules |

## Architecture Patterns

### CLAUDE.md File Hierarchy (Claude Code Native)

```
~/.claude/CLAUDE.md                    # L0 Global (auto-loaded for ALL projects)
  |
  +-- {project}/CLAUDE.md             # L1/L2 Project (auto-loaded per-project)
  |     |
  |     +-- {project}/.claude/CLAUDE.md    # Alternative project location
  |     +-- {project}/.claude/rules/*.md   # Path-scoped conditional rules
  |
  +-- {project}/subdir/CLAUDE.md      # On-demand (loaded when Claude reads files in subdir)
```

**Key insight:** Claude Code automatically loads `~/.claude/CLAUDE.md` into every session. No explicit import needed for L0. This is the foundation of the delegation model -- L0 rules propagate without any mechanism beyond file placement.

### Pattern 1: Convention-Based Context Delegation

**What:** Each CLAUDE.md declares its layer and what it inherits, but inheritance happens through Claude Code's native loading, not explicit @import directives.

**When to use:** Always -- this is the recommended delegation model.

**How it works:**
1. `~/.claude/CLAUDE.md` (L0): Contains generic KMP rules. Auto-loaded by Claude Code for all projects. Never references project names.
2. `{project}/CLAUDE.md` (L1/L2): Starts with identity header declaring layer and inheritance. Contains only project-specific rules.
3. Claude Code loads both L0 and project CLAUDE.md automatically. Agent sees combined context.
4. validate-claude-md enforces structural compliance.

**Example identity header:**
```markdown
# {Project Name} Project Rules

> **Layer:** L2 (Application)
> **Inherits:** L0 (Generic KMP via ~/.claude/CLAUDE.md), L1 (shared-kmp-libs conventions)
> **Purpose:** {one-line description}

Shared KMP rules in ~/.claude/CLAUDE.md (auto-loaded by Claude Code).
This file contains ONLY {project}-specific rules and context.
```

### Pattern 2: Explicit Override Declaration

**What:** L1/L2 files can explicitly override specific L0 rules using a structured override section.

**When to use:** When a project needs to deviate from L0 defaults (e.g., corporate project using Hilt instead of Koin).

**Example:**
```markdown
## L0 Overrides

| L0 Rule | Override | Reason |
|---------|----------|--------|
| DI: Koin 4.1.1 | Dagger/Hilt 2.52 | Corporate standard |
| Navigation: Navigation3 | Voyager 1.1.0 | Legacy project |
```

validate-claude-md checks that overrides reference valid L0 rule identifiers and that overridden rules are not silently dropped.

### Pattern 3: Developer Context Separation

**What:** Developer-specific ecosystem context (solo dev, project list, workflow preferences) lives in `~/.claude/CLAUDE.md` as a "Developer Context" section, not in project CLAUDE.md files.

**When to use:** For context that is developer-specific, not project-specific.

**Current state:** `~/.claude/CLAUDE.md` has a "Developer Context" section listing "Solo developer working on KMP ecosystem: DawSync, OmniTrack, shared-kmp-libs". This references projects by name. For L0 genericity, this section should be moved to a separate imported file or kept but clearly marked as developer-personal (which it already is, since `~/.claude/CLAUDE.md` is user-scoped).

**Recommendation:** Keep developer context in `~/.claude/CLAUDE.md` since it's user-scoped (only this developer sees it). The "L0 must not reference project names" constraint applies to generic rules, not the user-scoped identity section. Mark the section clearly as user-specific so corporate users know to replace it.

### Pattern 4: Copilot Adapter Pipeline

**What:** Generate `.github/copilot-instructions.md` from CLAUDE.md as SSOT, adapted to Copilot's simpler format.

**When to use:** For every project that supports GitHub Copilot.

**How it works:**
1. Read project CLAUDE.md + L0 CLAUDE.md
2. Extract behavioral rules (DO/DON'T, architecture, patterns)
3. Flatten layer hierarchy into single Copilot instructions file
4. Write to `.github/copilot-instructions.md`
5. Copilot auto-loads it for code completion context

**Output format:** Plain markdown, no frontmatter. Short self-contained statements. Include reasoning behind rules.

### Anti-Patterns to Avoid

- **Cross-project @import**: Do NOT use `@~/.claude/file.md` or `@../other-project/file.md` in CLAUDE.md -- known reliability issues (GitHub issue #8765). Use Claude Code's native auto-loading instead.
- **Duplicating L0 rules in L1/L2**: Do NOT copy L0 rules into project CLAUDE.md. The whole point of delegation is that L0 auto-loads. If you duplicate, rules drift.
- **L0 referencing downstream projects**: L0 (`~/.claude/CLAUDE.md`) must NEVER contain project-specific rules for DawSync, shared-kmp-libs, etc. It provides generic KMP rules only.
- **Upward references**: L1 must not reference L2 files. L0 must not reference L1/L2 files. Direction is always downward.
- **Bloated CLAUDE.md**: Official docs warn: "If Claude keeps doing something you don't want despite having a rule against it, the file is probably too long and the rule is getting lost." Stay under 150 lines per file.

### Recommended Template Structure

```markdown
# {Project Name} Project Rules

> **Layer:** L{0|1|2} ({Type})
> **Inherits:** {inheritance chain}
> **Purpose:** {one-line description}

{Delegation statement -- e.g., "Shared KMP rules in ~/.claude/CLAUDE.md (auto-loaded)"}
{Scope statement -- "This file contains ONLY {scope} rules."}

## {Critical Rules / Key Architecture Decisions}
{Most important behavioral rules for this project}

## {Domain-Specific Section(s)}
{Project-specific patterns, module structure, etc.}

## {Build Commands}
{Essential build/test/run commands}

## {L0 Overrides} (if any)
{Explicit table of overridden L0 rules with justification}

## {Temporal Context} (if any -- e.g., Wave 1 tracks)
{Time-bounded project context}
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CLAUDE.md file discovery across ecosystem | Custom file walker | `discoverProjects()` from `project-discovery.js` | Already handles settings.gradle.kts includeBuild paths and projects.yaml fallback |
| Frontmatter parsing | Custom YAML parser | `parseFrontmatter()` from `registry/frontmatter.js` | Battle-tested across 500+ docs, handles edge cases |
| MCP tool registration boilerplate | Custom server setup | `McpServer.registerTool()` + zod schema + rateLimiter | Standard pattern across all 14 existing tools |
| Cross-project file path resolution | Manual path construction | `path.join()` + `path.resolve()` + `getToolkitRoot()` | Windows compatibility already solved (Windows 11 dev environment) |
| Content hashing for drift detection | Custom hash | `computeHash()` from `skill-registry.js` | SHA-256 with `sha256:` prefix, consistent with l0-manifest.json |
| Copilot prompt generation | New adapter from scratch | Extend existing `copilot-adapter.sh` + `copilot-instructions-adapter.sh` | Pipeline exists, just needs CLAUDE.md input source |

## Common Pitfalls

### Pitfall 1: @import Tilde Path Resolution Failure
**What goes wrong:** Using `@~/.claude/file.md` in CLAUDE.md fails to load the referenced file on some platforms/versions.
**Why it happens:** GitHub issue #8765 -- Claude Code has inconsistent tilde expansion in @import paths. Multiple users report it worked in v2.0.5 but regressed.
**How to avoid:** Do NOT rely on @import for L0->L1/L2 delegation. Use Claude Code's native auto-loading of `~/.claude/CLAUDE.md` (which always works). Use @import only for local project files (`@docs/file.md`).
**Warning signs:** CLAUDE.md file referencing `@~/.claude/` paths; `/memory` command not showing the imported file.

### Pitfall 2: Rule Duplication After Delegation
**What goes wrong:** L1/L2 CLAUDE.md contains rules already in L0, leading to contradictions when L0 is updated but L1/L2 copies are stale.
**Why it happens:** Phase 14.3 de-duplicated but the boundary between "inherited" and "project-specific" is informal.
**How to avoid:** validate-claude-md must detect duplicate rules by comparing rule identifiers across layers. Template explicitly states "This file contains ONLY {scope} rules."
**Warning signs:** Same rule text appearing in multiple CLAUDE.md files; version numbers differing between L0 and L1.

### Pitfall 3: L0 Context Budget Bloat
**What goes wrong:** `~/.claude/CLAUDE.md` grows beyond 200 lines, causing Claude to ignore rules in long sessions.
**Why it happens:** Developer adds project-specific rules to L0 instead of project CLAUDE.md.
**How to avoid:** Strict template enforcement: L0 is generic KMP rules only. validate-claude-md checks line count. Official docs recommend under 200 lines, project requirement is under 150.
**Warning signs:** Rule adherence drops in sessions; Claude ignores specific instructions.

### Pitfall 4: Version Number Drift Across Files
**What goes wrong:** L0 says "Kotlin 2.3.10" but L1/L2 says "Kotlin 2.3.0" because L1/L2 was written at different time.
**Why it happens:** Version numbers appear in both L0 (generic rules) and L1/L2 (project specifics). No automated sync.
**How to avoid:** validate-claude-md cross-checks version numbers against `versions-manifest.json`. Version numbers should appear in exactly one layer (prefer L0 for shared deps, L1 for ecosystem deps, L2 for project deps).
**Warning signs:** `validate-claude-md --cross-check` reporting version mismatches.

### Pitfall 5: Copilot Adapter Generating Stale Instructions
**What goes wrong:** `.github/copilot-instructions.md` reflects old CLAUDE.md content because adapter wasn't re-run.
**Why it happens:** Manual pipeline -- `bash adapters/generate-all.sh` must be run explicitly.
**How to avoid:** validate-claude-md can check if Copilot instructions are stale by comparing content hash against CLAUDE.md hash.
**Warning signs:** Copilot suggestions don't follow updated rules.

### Pitfall 6: Smoke Test False Positives
**What goes wrong:** Smoke test declares rules preserved, but testing was superficial (checked ViewModel pattern but missed CancellationException rethrow rule).
**Why it happens:** Smoke tests check a subset of rules, not the full canonical checklist.
**How to avoid:** Smoke test checklist must be derived from canonical rule inventory. Each rule in the inventory gets a verification method (keyword check, pattern match, or manual review).
**Warning signs:** Smoke test passes but generated code violates behavioral rules.

## Code Examples

### MCP Tool Registration Pattern (from validate-skills.ts)

```typescript
// Source: mcp-server/src/tools/validate-skills.ts
export function registerValidateClaudeMdTool(
  server: McpServer,
  limiter?: RateLimiter,
): void {
  server.registerTool(
    "validate-claude-md",
    {
      title: "Validate CLAUDE.md",
      description:
        "Validates CLAUDE.md files: template structure, canonical rule checklist coverage, " +
        "reference resolution, circular reference detection, cross-file consistency, " +
        "override validation. Returns structured JSON.",
      inputSchema: z.object({
        project: z
          .string()
          .optional()
          .describe("Specific project name, or omit for all discovered projects"),
        check_canonical: z
          .boolean()
          .optional()
          .default(true)
          .describe("Check rules against canonical checklist"),
        check_versions: z
          .boolean()
          .optional()
          .default(true)
          .describe("Cross-check version numbers against versions-manifest.json"),
      }),
    },
    async ({ project, check_canonical, check_versions }) => {
      // ... implementation
    },
  );
}
```

### Canonical Rule Checklist Format

```typescript
// Recommended format for the rule inventory
interface CanonicalRule {
  id: string;           // e.g., "ARCH-01", "VM-01", "TEST-01"
  category: string;     // e.g., "architecture", "viewmodel", "testing"
  rule: string;         // The actual behavioral rule text
  source: string;       // Which CLAUDE.md file it originates from
  layer: "L0" | "L1" | "L2";  // Which layer owns the rule
  overridable: boolean; // Can downstream layers override this?
}

// Example rules:
// { id: "ARCH-01", category: "architecture", rule: "5-layer architecture: UI > VM > Domain > Data > Model",
//   source: "~/.claude/CLAUDE.md", layer: "L0", overridable: false }
// { id: "VM-01", category: "viewmodel", rule: "UiState: ALWAYS sealed interface",
//   source: "~/.claude/CLAUDE.md", layer: "L0", overridable: false }
// { id: "DI-01", category: "di", rule: "Koin 4.1.1 for dependency injection",
//   source: "~/.claude/CLAUDE.md", layer: "L0", overridable: true }
```

### Circular Reference Detection

```typescript
// Source: pattern from validate-doc-structure.ts adapted for CLAUDE.md
interface ClaudeMdInfo {
  path: string;
  layer: "L0" | "L1" | "L2";
  references: string[]; // paths referenced via @import or delegation statements
}

function detectCircularReferences(files: ClaudeMdInfo[]): string[] {
  const errors: string[] = [];
  const layerOrder = { L0: 0, L1: 1, L2: 2 };

  for (const file of files) {
    for (const ref of file.references) {
      const target = files.find(f => f.path === ref || f.path.endsWith(ref));
      if (!target) continue;

      const sourceLevel = layerOrder[file.layer];
      const targetLevel = layerOrder[target.layer];

      if (targetLevel >= sourceLevel && file.layer !== target.layer) {
        errors.push(
          `${file.path} (${file.layer}) references ${target.path} (${target.layer}) -- ` +
          `upward/circular reference detected (${file.layer} must not reference ${target.layer})`
        );
      }
    }
  }

  return errors;
}
```

### Copilot Instructions Generation Pattern

```typescript
// Pattern for generating .github/copilot-instructions.md from CLAUDE.md
interface CopilotSection {
  heading: string;
  rules: string[];
}

function generateCopilotInstructions(
  l0Rules: CanonicalRule[],
  projectRules: CanonicalRule[],
  overrides: Override[],
): string {
  // Merge L0 + project rules, applying overrides
  const effectiveRules = mergeWithOverrides(l0Rules, projectRules, overrides);

  // Group by category
  const sections = groupByCategory(effectiveRules);

  // Format as Copilot markdown (no frontmatter, natural language)
  const lines: string[] = [];
  lines.push("# Coding Instructions");
  lines.push("");

  for (const section of sections) {
    lines.push(`## ${section.heading}`);
    lines.push("");
    for (const rule of section.rules) {
      lines.push(`- ${rule}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Monolithic CLAUDE.md (232+ lines) | Layered CLAUDE.md (62-100 lines each) | Phase 14.3 (2026-03-15) | Zero duplication, within budget |
| Copy-paste rules across projects | Convention-based delegation | Phase 14.3 (2026-03-15) | L0 auto-loads, projects add specifics only |
| No CLAUDE.md validation | validate-doc-structure for docs | Phase 14.1 (2026-03-14) | Pattern exists for CLAUDE.md validator |
| Adapter-generated commands | Claude reads SKILL.md directly | Phase 14.3 (2026-03-15) | 16 adapter commands deleted |
| `.claude/rules/` not used | Available since Claude Code v2.0 (Jan 2026) | Jan 2026 | Path-scoped conditional rules possible |

**Current Claude Code CLAUDE.md features (2026):**
- Native `~/.claude/CLAUDE.md` auto-loading (all projects)
- Project-root `./CLAUDE.md` or `./.claude/CLAUDE.md` auto-loading
- `@path/to/file` import syntax (relative to containing file)
- `.claude/rules/*.md` for path-scoped conditional rules
- Managed policy CLAUDE.md for organizations
- `claudeMdExcludes` setting to skip specific files
- Auto memory system alongside CLAUDE.md
- Official recommendation: under 200 lines per file

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (via project npm config) |
| Config file | `mcp-server/vitest.config.ts` |
| Quick run command | `cd mcp-server && npx vitest run tests/unit/tools/validate-claude-md.test.ts` |
| Full suite command | `cd mcp-server && npm test` |

### Phase Requirements --> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CLAUDE-01 | Canonical rule extraction from 4 CLAUDE.md files | unit | `npx vitest run tests/unit/tools/validate-claude-md.test.ts -t "canonical"` | Wave 0 |
| CLAUDE-02 | Template section validation, line count, token budget | unit | `npx vitest run tests/unit/tools/validate-claude-md.test.ts -t "template"` | Wave 0 |
| CLAUDE-03 | AndroidCommonDoc CLAUDE.md follows template | integration | `npx vitest run tests/integration/claude-md-validation.test.ts -t "L0"` | Wave 0 |
| CLAUDE-04 | shared-kmp-libs CLAUDE.md follows template | integration | `npx vitest run tests/integration/claude-md-validation.test.ts -t "L1"` | Wave 0 |
| CLAUDE-05 | DawSync CLAUDE.md follows template | integration | `npx vitest run tests/integration/claude-md-validation.test.ts -t "L2"` | Wave 0 |
| CLAUDE-06 | Context delegation: no circular refs, direction enforced | unit | `npx vitest run tests/unit/tools/validate-claude-md.test.ts -t "delegation"` | Wave 0 |
| CLAUDE-07 | Smoke test: behavioral rules preserved after rewrite | manual-only | Checklist-based verification against canonical rule inventory | N/A |
| CLAUDE-08 | validate-claude-md MCP tool returns structured JSON | unit | `npx vitest run tests/unit/tools/validate-claude-md.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `cd mcp-server && npx vitest run tests/unit/tools/validate-claude-md.test.ts`
- **Per wave merge:** `cd mcp-server && npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `mcp-server/tests/unit/tools/validate-claude-md.test.ts` -- covers CLAUDE-01, CLAUDE-02, CLAUDE-06, CLAUDE-08
- [ ] `mcp-server/tests/integration/claude-md-validation.test.ts` -- covers CLAUDE-03, CLAUDE-04, CLAUDE-05
- [ ] `mcp-server/src/tools/validate-claude-md.ts` -- the tool itself (source, not test)

## Open Questions

1. **Developer Context section in generic L0**
   - What we know: `~/.claude/CLAUDE.md` currently has "Developer Context" section mentioning DawSync, OmniTrack, shared-kmp-libs by name. The user locked "L0 must not reference projects by name."
   - What's unclear: Whether the "Developer Context" section counts as violating this rule since `~/.claude/CLAUDE.md` is user-scoped (never shared).
   - Recommendation: Keep the Developer Context section but clearly mark it as `## Developer Context (User-Specific)` with a comment that corporate users should replace this section. The generic KMP rules sections must not reference project names. This satisfies both the genericity requirement and the practical need for developer context.

2. **Rule inventory output format**
   - What we know: User wants cross-file consistency checking. Canonical checklist is the foundation for smoke tests and validate-claude-md.
   - What's unclear: Whether to store the inventory as a standalone JSON artifact, embed it in RESEARCH.md, or make it a runtime data structure in validate-claude-md.
   - Recommendation: Dual format -- JSON artifact at `docs/guides/canonical-rules.json` for tool consumption + markdown summary in a guide doc for human reference. validate-claude-md loads the JSON at runtime.

3. **Smoke test implementation depth**
   - What we know: User gave full discretion. Success criterion says "generate ViewModel, UseCase, and test in each project; verify all behavioral rules preserved."
   - What's unclear: Whether to actually run code generation (creates files to discard) or use a dry-run checklist approach.
   - Recommendation: Checklist-based verification using the canonical rule inventory. For each rule, define a verification method (keyword presence check, pattern match, or manual confirmation). No real code generation needed -- the validate-claude-md tool + canonical checklist provides sufficient programmatic verification. Document a manual smoke test protocol for optional human verification.

4. **Copilot adapter integration point**
   - What we know: Existing adapter pipeline in `adapters/`. Copilot format is `.github/copilot-instructions.md`.
   - What's unclear: Whether to extend existing `copilot-instructions-adapter.sh` (extracts from docs/) or create a new adapter that extracts from CLAUDE.md files.
   - Recommendation: New CLAUDE.md-based adapter that generates `.github/copilot-instructions.md` by flattening the L0+L1/L2 rule hierarchy. Existing docs-based adapter remains separate (different source, different output). Add to `generate-all.sh`.

## Sources

### Primary (HIGH confidence)
- [Claude Code Official Docs - Memory](https://code.claude.com/docs/en/memory) -- Complete CLAUDE.md loading hierarchy, @import syntax, .claude/rules/, size recommendations
- [Claude Code Official Docs - Best Practices](https://code.claude.com/docs/en/best-practices) -- CLAUDE.md writing guidance, include/exclude recommendations, size targets
- [GitHub Copilot Custom Instructions Docs](https://docs.github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot) -- `.github/copilot-instructions.md` format and behavior
- Codebase analysis: All 4 current CLAUDE.md files, all MCP tool source code, adapter pipeline scripts (directly read from filesystem)

### Secondary (MEDIUM confidence)
- [GitHub Issue #8765](https://github.com/anthropics/claude-code/issues/8765) -- @~/.claude/file.md syntax not loading personal preferences (closed as NOT PLANNED)
- [GitHub Issue #2950](https://github.com/anthropics/claude-code/issues/2950) -- Imports or CLAUDE.local.md discussion, @import behavior details
- [GitHub Awesome Copilot](https://github.com/github/awesome-copilot) -- Community patterns for copilot-instructions.md

### Tertiary (LOW confidence)
- None -- all findings verified against primary sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all tools are existing project infrastructure (TypeScript, Vitest, MCP SDK)
- Architecture: HIGH - Claude Code's native loading mechanism verified via official docs; delegation model validated against current ecosystem state
- Pitfalls: HIGH - @import issues verified via GitHub issues; rule duplication risk observed in Phase 14.3 work
- Copilot adapter: MEDIUM - format verified via official docs, but integration with CLAUDE.md-as-SSOT is new (no prior implementation exists)
- Smoke test: MEDIUM - checklist approach is sound but effectiveness depends on rule inventory completeness

**Research date:** 2026-03-16
**Valid until:** 2026-04-16 (stable -- Claude Code CLAUDE.md system is mature)
