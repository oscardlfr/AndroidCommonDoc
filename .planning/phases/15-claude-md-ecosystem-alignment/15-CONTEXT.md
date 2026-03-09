# Phase 15: CLAUDE.md Ecosystem Alignment - Context

**Gathered:** 2026-03-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Rewrite every CLAUDE.md file in the ecosystem to a standard template with context delegation, so an AI agent working in any project gets correct behavioral rules without redundancy or stale cross-references. Scope: `~/.claude/CLAUDE.md` (L0 generic), AndroidCommonDoc (L0 toolkit), shared-kmp-libs (L1), DawSync (L2). Includes canonical rule extraction, template design, @import/delegation mechanism, smoke tests, validate-claude-md MCP tool, and Copilot adapter generation.

Phase 14.3 (MATL-07) already completed initial CLAUDE.md layering — files are de-duplicated and slimmed (62-100 lines). Phase 15 formalizes the structure, adds validation, and builds the adapter pipeline.

</domain>

<decisions>
## Implementation Decisions

### Rule inventory & canonical checklist (CLAUDE-01)
- **Full audit with cross-file consistency**: Inventory every behavioral rule across all 4 CLAUDE.md files AND validate consistency (version numbers match, no contradictory rules, no stale references)
- **L1/L2 rule selectivity**: Each L1/L2 project should be able to define which L0 rules they adopt — the inventory must support per-rule opt-in/opt-out awareness
- **Audit scope, format, granularity, drop policy, location, severity levels, overlap mapping, lean-vs-self-contained balance**: Claude's discretion — choose the most professional, enterprise-grade, AI-oriented, token-efficient approach

### Context delegation mechanism (CLAUDE-06)
- **L0 fully generic**: `~/.claude/CLAUDE.md` must NOT reference any project by name (DawSync, OmniTrack, shared-kmp-libs). Generic KMP rules only. Essential for corporate portability
- **Developer-specific context placement**: Claude's discretion on where solo-dev ecosystem context lives (separate file, project CLAUDE.md, etc.)
- **Explicit override support**: L1/L2 can explicitly override specific L0 rules (e.g., L0 says Koin, corporate L1 could say Dagger/Hilt). Critical for future corporate adoption. Override format is Claude's discretion
- **Automated circular reference detection**: validate-claude-md must check that L0 never points to L1/L2, L1 never points to L2 — fail on circular or upward references
- **Reference resolution, propagation strategy, override validation depth**: Claude's discretion

### Template section design (CLAUDE-02)
- **Mandatory identity header**: Every CLAUDE.md starts with project name, layer (L0/L1/L2), one-line purpose, and delegation reference. AI agent immediately knows context
- **DawSync Wave 1 stays**: Wave 1 parallel tracks are active (user currently working on track-E). Must remain in DawSync CLAUDE.md
- **Layer-specific vs shared template, budget model (per-file vs per-project), doc consultation section, frontmatter, temporal rules, build command format, team rules placement, template doc location**: Claude's discretion — design the most professional, token-efficient template

### Smoke test methodology (CLAUDE-07)
- **Full Claude discretion**: User deferred all smoke test decisions. Claude designs the most effective verification approach — could be real code generation in projects (then discard), dry-run validation, MCP-driven checks, or a combination. Must prove behavioral rules are preserved after rewrite

### Copilot adapter (IN SCOPE for Phase 15)
- **Copilot instructions generation**: Generate .github/copilot-instructions.md (or equivalent) from the rewritten CLAUDE.md files. Validates the tool-agnostic design
- **Adapter target scope (Copilot only vs +Cursor), format (GitHub official vs custom), integration point (/sync-l0 vs standalone), hierarchy flattening approach**: Claude's discretion
- **Corporate portability**: The system must be extensible enough for corporate environments, but don't over-design corporate features now. Current ecosystem (DawSync + shared-kmp-libs + AndroidCommonDoc) is the target

### validate-claude-md MCP tool (CLAUDE-08)
- **Checks template structure against standard sections**
- **Detects missing rules vs canonical checklist**
- **Validates @import/reference resolution** (references point to existing files)
- **Circular reference detection** (L0 never → L1/L2, L1 never → L2)
- **Cross-file consistency** (version numbers, non-contradictory rules)
- **Override validation** (overrides reference valid L0 rules)
- Additional validation scope: Claude's discretion

### Claude's Discretion
Claude has extensive discretion across all areas. Key flexibility zones:
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

**Guiding principle throughout:** "Professional, enterprise, modern, clean, solid, maintainable, spec-driven, AI-oriented, token-efficient, 2026 approach." Design for current ecosystem (DawSync, shared-kmp-libs, AndroidCommonDoc) but extensible for corporate adoption.

</decisions>

<specifics>
## Specific Ideas

- "Each L1/L2 should be able to define what rules they want to use" — rule selectivity is a first-class concern, not afterthought
- "I would maybe think about having a Copilot approach and Claude approach" — adapter pipeline from CLAUDE.md as SSOT, generating tool-specific formats
- "Es un workflow que me gustaria llevar a mi entorno corporativo con Copilot" — corporate portability is a real goal, not hypothetical
- "De momento lo voy a usar con Claude Code en DawSync" — immediate use case is Claude Code + DawSync
- "Audit everything so it's fully updated with full harmony" — rule inventory must validate freshness, not just catalog
- "I'm still working in track-E at DawSync" — Wave 1 context is live, must stay in DawSync CLAUDE.md
- "Verificaras todo lo posible por tu cuenta y delegaras en mi lo indispensable" — Claude should make maximum autonomous decisions, only escalate what's truly user-dependent
- Current file sizes post-14.3: ~/.claude/ 100 lines, AndroidCommonDoc 62, shared-kmp-libs 62, DawSync 85 — all within budget

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `~/.claude/CLAUDE.md` (100 lines): Current L0 shared KMP rules — becomes generic L0 base after removing project names
- `CLAUDE.md` (62 lines): AndroidCommonDoc L0 toolkit rules — well-structured post-14.3
- `shared-kmp-libs/CLAUDE.md` (62 lines): L1 module catalog — clean post-14.3
- `DawSync/CLAUDE.md` (85 lines): L2 project rules with active Wave 1 context
- `mcp-server/src/tools/validate-doc-structure.ts`: Existing validator — pattern for building validate-claude-md
- `mcp-server/src/tools/validate-skills.ts`: Skill validation tool from Phase 14.3 — pattern for frontmatter parsing and cross-file checks
- `mcp-server/src/registry/scanner.ts`: Dynamic filesystem scanner — pattern for multi-project file discovery
- `skills/registry.json`: L0 skill registry — adapter pipeline integration point
- `l0-manifest.json` schema: Manifest pattern from Phase 14.3 — potential model for CLAUDE.md rule manifests

### Established Patterns
- CLAUDE.md layering convention: "Shared KMP rules in ~/.claude/CLAUDE.md (auto-loaded by Claude Code)" header line
- Claude Code auto-loads `~/.claude/CLAUDE.md` for all projects natively — no explicit import needed for L0
- Hub+sub-doc pattern for oversized docs (Phase 14/14.2)
- Adapter pipeline: SKILL.md → tool-specific output (Phase 10, simplified in 14.3)
- Copilot adapter: `adapters/copilot-adapter.py` generates .github/copilot-instructions.md from skills
- Content hash versioning: SHA-256 for drift detection (Phase 14.3)
- MCP tool pattern: TypeScript in mcp-server/src/tools/, tested with Vitest

### Integration Points
- `~/.claude/CLAUDE.md`: Auto-loaded by Claude Code for every project — the L0 injection point
- `{project}/CLAUDE.md`: Loaded per-project by Claude Code — L1/L2 layer
- `mcp-server/src/tools/index.ts`: Tool registry — add validate-claude-md here
- `adapters/copilot-adapter.py`: Existing Copilot adapter — extend for CLAUDE.md-to-Copilot generation
- `adapters/generate-all.sh`: Adapter pipeline runner — include Copilot instructions generation
- `versions-manifest.json`: Version authority — CLAUDE.md version references should align
- shared-kmp-libs version catalog: Canonical dependency versions — L1 CLAUDE.md references these
- `~/.claude/docs/`: Pattern docs referenced by CLAUDE.md — validate references resolve

### Current State (from Phase 14.3)
- 512 MCP tests passing across ecosystem
- All quality gates pass (validate-doc-structure, script-parity, skill-script-alignment, template-sync)
- 55 registry entries (28 skills + 11 agents + 16 commands)
- /sync-l0 engine operational with manifest-based materialization
- Vault synced with 9 unified categories

</code_context>

<deferred>
## Deferred Ideas

- **Coordinated DawSync agent system** — Specialized agents for each DawSync domain (data, UI, testing, DAW integration, billing). Captured in Phase 14.2.1
- **Corporate environment deployment** — Full corporate rollout with team-level L0 and project-level L2s. Design is extensible but don't implement corporate features now
- **Cursor/Windsurf adapters** — In REQUIREMENTS.md Future section (ADAPT-02). Only if Claude determines they fit within Phase 15 scope naturally
- **NotebookLM API integration** — Out of scope per REQUIREMENTS.md

</deferred>

---

*Phase: 15-claude-md-ecosystem-alignment*
*Context gathered: 2026-03-16*
