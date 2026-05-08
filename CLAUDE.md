# AndroidCommonDoc

> L0 Pattern Toolkit — Source of truth for KMP patterns, skills, Detekt rules, MCP server, and vault sync. Feeds L1/L2 via `/sync-l0`.

## Workflow Orchestration

> **W31.6 Canonical Pattern**: The main agent IS the orchestrator — see `docs/agents/main-agent-orchestration-guide.md` for session protocol. Canonical flat-spawning is preferred over nested team-lead subagent model.

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural impact)
- Changing vault sync (`moc-generator.ts`, `transformer.ts`, `wikilink-generator.ts`) → plan mode — graph impact
- Adding a new pattern doc → check hub doc size first; may need hub restructure
- Changing L0→L1/L2 propagation → plan mode — blast radius is every consumer

### 2. Agent Delegation (mandatory)
- **ALWAYS delegate domain audits to specialized agents** — never do them inline
- Launch agents in parallel when they cover independent domains

| Agent | Domain | MUST delegate when |
|-------|--------|-------------------|
| `test-specialist` | Testing | After implementation — pattern review, coverage gaps, write tests |
| `ui-specialist` | Compose UI | ANY change to Compose code — accessibility, Material3 |
| `doc-alignment-agent` | Doc accuracy | After code changes — verify docs match implementation |
| `release-guardian-agent` | Release safety | Before ANY publish — debug flags, secrets, dev URLs |
| `full-audit-orchestrator` | Quality audit | `/full-audit` — wave execution, specialized agents, 3-pass dedup |
| `quality-gate-orchestrator` | Consistency | Quality gate runs — all 5 validators + pass/fail report |
| `debugger` | Bug investigation | Systematic bugs needing hypothesis testing — `/debug` |
| `verifier` | Goal verification | After feature completion — verify spec is met — `/verify` |
| `advisor` | Technical decisions | Choosing between approaches/libraries — `/decide` |
| `researcher` | Domain research | Pre-implementation exploration — `/research` |
| `codebase-mapper` | Architecture analysis | First-time repo analysis — `/map-codebase` |

**Dev scope gates**: specialty default + architect-authorized override. test-specialist aligned with other core devs 2026-04-22 (BL-W27-02).

**Agent-template `.md` edits**: doc-updater owns by default; a core dev may own when the template change is domain-specific (e.g., test-specialist template → test-specialist self-edits). Formalized 2026-04-22 (BL-W27-03).

### 3. Verification Before Done
- MCP tool change → full Vitest suite + verify with `sync-vault`
- New skill → `validate-skills`; new doc → `validate-doc-structure`
- Vault fix → confirm graph in Obsidian before done
- Doc changes → `cd mcp-server && npm test` + Detekt + Konsist
- **Before any PR → `/pre-pr`**

### 4. Autonomous Execution
- Use L0 skills: `/test`, `/readme-audit`, `/validate-patterns`, `/extract-errors`
- MCP server is Node.js TypeScript, tested with Vitest — `cd mcp-server && npm test`

## Project Constraints

### No console.log in MCP server
- Use `logger` utility (stderr only) — `console.log` corrupts stdio transport

### Doc size limits (MUST split, never extend)
- Hub docs **≤100 lines**: navigation + glossary only, zero implementation detail
- Sub-docs **≤300 lines**: one focused topic. At 250+ → plan your split
- Agent templates **≤400 lines** — orchestrators are more complex than docs. Extract domain knowledge into `.claude/docs/` sub-docs if approaching limit
- Splitting is the design pattern. Never compress content to fit — create hub + sub-docs

### Pattern docs need YAML frontmatter
- Every doc: `scope`, `sources`, `targets`, `category`, `slug`
- Cross-references use relative paths — no absolute paths between subdirectories

### Agent templates: dual-location (MUST keep in sync)
- `setup/agent-templates/` is the SOURCE for agent templates (team-lead, quality-gater, architects, etc.)
- `.claude/agents/` contains COPIES that the registry scans and `/sync-l0` distributes
- When editing a template: ALWAYS update `setup/agent-templates/X.md` first, then copy to `.claude/agents/X.md`
- Regenerate registry after any template change: `node mcp-server/build/cli/generate-registry.js`
- **New agents**: MUST create both `setup/agent-templates/<name>.md` (source) and `.claude/agents/<name>.md` (copy) atomically in the same commit.

### Vault sync is fragile
- Run `validate-vault` before every sync (0 duplicates, 0 homogeneity errors)
- Vault files: `lowercase-kebab-case` — uppercase causes ghost nodes in Obsidian

### Git Flow
- `master` ← releases only — **requires user approval** for any merge to master. `develop` ← integration **via PR only**. `feature/*` ← from develop.
- **Branch protection on develop** (W31.6 enforcement): PR required, CI Gate + Drift Audit + L0 CI must pass, linear history required, no force pushes, no deletions. Direct pushes are MECHANICALLY blocked.
- Agents can autonomously: create feature branches, commit, push feature branches, create PRs, merge feature→develop via PR (CI green required).
- Agents MUST ask before: merging to master, creating releases, tagging, force push, bypassing branch protection.
- ALL changes to develop go through PR — including post-merge metadata (memory, backlog SHIPPED markers, wave history). NO direct commits to develop.
- After pushing, **monitor CI** — check workflow status, fix failures, and re-push until CI is green.
- Every PR must pass `/pre-pr` locally. Conventional Commits enforced.

## Commands
- `/pre-pr` — full pre-merge validation
- `/readme-audit` — doc audit (13 checks, hub table, counts, links)
- `/full-audit` — unified audit across all quality dimensions
- `/audit-docs` — doc-specific audit (structure + coherence + upstream)
- `/validate-patterns` — code vs pattern compliance
- `/sync-l0` — propagate skills/agents/commands to L1/L2
- `/generate-rules` — emit Detekt rules from doc frontmatter
- `/check-outdated` — check dependency versions against Maven Central (TOML parser, kdoc-state v2 cache)
- `/debug` — systematic bug investigation via debugger agent
- `/research` — ad-hoc technical research via researcher agent
- `/map-codebase` — structured codebase analysis via codebase-mapper agent
- `/verify` — goal-backward verification via verifier agent
- `/decide` — technical decision comparison via advisor agent
- `/note` — zero-friction idea capture to memory
- `/review-pr` — code review of a PR with structured suggestions
- `/benchmark` — run benchmark suites (JVM/Android)
- `/work` — smart task routing to agents/skills (extensible via frontmatter intent)
- `/init-session` — show project context and available tools
- `/resume-work` — CEO/CTO dashboard with department status from last session
- `/doc-integrity` — unified doc audit (kdoc-coverage → check-doc-patterns → API freshness → audit-docs)
- `/eval-agents` — run promptfoo evaluations against agent prompt templates before merging
- `/metrics` — unified dashboard: runtime tool usage, skill usage, MCP rates, CP bypass count
- Pre-commit hooks: see `docs/guides/pre-commit-hooks.md`

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
