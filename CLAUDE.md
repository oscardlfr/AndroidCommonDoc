# AndroidCommonDoc

> L0 Pattern Toolkit — Source of truth for KMP patterns, skills, Detekt rules, MCP server, and vault sync. Feeds L1/L2 via `/sync-l0`.

## Workflow Orchestration

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

### Vault sync is fragile
- Run `validate-vault` before every sync (0 duplicates, 0 homogeneity errors)
- Vault files: `lowercase-kebab-case` — uppercase causes ghost nodes in Obsidian

### Git Flow
- `master` ← releases only — **requires user approval** for any merge to master. `develop` ← integration. `feature/*` ← from develop.
- Agents can autonomously: create branches, commit, push feature/develop branches, merge feature→develop, create PRs.
- Agents MUST ask before: merging to master, creating releases, tagging, force push.
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
- Pattern docs → `docs/` with category hubs (15 domains, 88+ sub-docs)
- Upstream validation → `docs/guides/upstream-validation.md` (validate_upstream frontmatter)
- Detekt rules → `detekt-rules/` + `docs/guides/detekt-config.md`
- Spec-driven workflow → `docs/agents/spec-driven-workflow.md`
- Agent templates → `setup/agent-templates/` (team-lead, product-strategist, content-creator, landing-page-strategist)
- Business doc templates → `setup/doc-templates/business/` (PRODUCT_SPEC, MARKETING, PRICING, LANDING_PAGES, COMPETITIVE)
- MCP tools → 46 tools via ~/.mcp.json — architects/specialists must declare them in `tools:` frontmatter to call them (Wave 25 fix: prose references alone don't load schemas)
- Dependency freshness → `check-outdated` MCP tool (TOML parser, Maven Central, kdoc-state v2 cache)

## Wave History (most recent on top)

Development waves live in git log + memory; summarized here for onboarding context:

- **Wave 28** (2026-04-22, PR feature/wave-28→develop) — L0 housekeeping pre-W29. Shipped BL-W27-01 (CP Spawn Protocol find-pattern→search-docs), BL-W27-02 (dev scope Opción B), BL-W27-03 (doc-updater ownership of agent-template edits), BL-W27-04 (spawn-prompt hygiene), BL-W26-01b (planner no-change verdict), W17 HIGH #1 (addressee-liveness-gate.js hook), #3 (Message Topic Discipline), #4 (Scope Immutability Gate), #5 (catalog Kotlin scan). Trim+extract on arch-platform/arch-integration to fit 400-line limit. 13 new tests (9 Vitest + 4 bats). doc-updater 2.5.0, team-lead 6.2.1, test-specialist 1.11.1. Plugin v0.2.1 verified triggered-only. backlog.md consolidated with 0 HIGH/MEDIUM without target-wave.
- **Wave 27** (2026-04-22, PR #61) — BL-W26-06 rollback W25 pattern-search MCP + codify dev→arch→CP chain. Frontmatter strips (find-pattern/module-health/pattern-coverage) from 3 architects + team-lead. Prose additions in 3 arch + 4 dev templates. Hub/sub-doc split for arch-testing.md → docs/agents/arch-testing-dispatch-protocol.md. 8 MIGRATIONS entries. New Group 8 anti-regression (7 tests). team-lead 6.2.0. 2210/2210 tests pass.
- **Wave 26** (2026-04-21, PR #60) — BL-W26-01a MCP wiring for 4 agents (test-specialist, quality-gater, release-guardian-agent, cross-platform-validator) + Bug #8 topology gate in team-lead template (MANDATORY Phase 2 Topology Activation Gate post-ExitPlanMode). team-lead 6.1.0.
- **Wave 25** (2026-04-21, PR #59) — MCP wiring fix: 10 agents gained explicit `mcp__androidcommondoc__*` frontmatter; context-provider v3.0 pattern pre-cache; ingestion loop (context-provider → team-lead user-approval → doc-updater → `ingest-content`) finally closed after T-BUG-005 half-landed.
- **Wave 24** (2026-04-20, PR #58) — Bug #3 `TeamDelete` before `TeamCreate` + P4: 17 agent mirrors. team-lead 5.17.0.
- **Wave 23** (2026-04-20, PR #57) — S8 token meter + Bug #5 `scope_doc_path` + Bug #6 PREP/EXECUTE architect dispatch modes. team-lead 5.15.0.
- **Wave 22** (2026-04-20, PR #56) — Token topology S1–S7: team-lead model → sonnet, spawn-prompt diet, RTK prefix enforcement, verdict-to-disk, compaction loop.
- **Wave 21** (2026-04-20, PR #55) — Enforcement + portability chain (session team collision fix).
- **Wave 20** (2026-04-20, PRs #53 + #54) — Bug #7 session-scoped CP gate, S2.1 hash parity, S2.2 MIGRATIONS, S3.1 `/work` rewrite, S3.2 material-3 ADOPT.

## RTK Enforcement (Wave 22)
Agent templates MUST prefix all git/gh/docker/curl commands with `rtk`. Enforced in setup/agent-templates/team-lead.md.

## Ingestion Loop (Wave 25)
External sources (Context7 / WebFetch) flow into L0 docs via an explicit approval chain: context-provider flags the gap → team-lead requests user approval → doc-updater runs `mcp__androidcommondoc__ingest-content` → commits to `docs/{category}/{slug}.md` with citation frontmatter. User approval is a hard gate — team-lead does not forward to doc-updater without `approved_by: user`.
