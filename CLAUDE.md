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
- Pattern docs → `docs/` with category hubs (15 domains, 88+ sub-docs)
- Upstream validation → `docs/guides/upstream-validation.md` (validate_upstream frontmatter)
- Detekt rules → `detekt-rules/` + `docs/guides/detekt-config.md`
- Spec-driven workflow → `docs/agents/spec-driven-workflow.md`
- Agent templates → `setup/agent-templates/` (product-strategist, content-creator, landing-page-strategist; orchestration guide at `docs/agents/main-agent-orchestration-guide.md`)
- Note: `setup/agent-templates/team-lead.md` deprecated W31.6 — see `docs/agents/main-agent-orchestration-guide.md`
- Business doc templates → `setup/doc-templates/business/` (PRODUCT_SPEC, MARKETING, PRICING, LANDING_PAGES, COMPETITIVE)
- MCP tools → 46 tools via ~/.mcp.json — architects/specialists must declare them in `tools:` frontmatter to call them (Wave 25 fix: prose references alone don't load schemas)
- Dependency freshness → `check-outdated` MCP tool (TOML parser, Maven Central, kdoc-state v2 cache)

## Wave History (most recent on top)

Development waves live in git log + memory; summarized here for onboarding context:

- **Wave 31.7** (2026-04-26 → 2026-04-27, PRs #71 squash 82ba91f + #72 squash 0a55409 + #73 squash 0514058) — agents-manifest workflow + bash-write bypass closeout. **PR #71 (Phase 1)**: hand-edited manifest seed at `.claude/registry/agents.manifest.yaml` covering 38/38 agents with 5 cross-cutting invariants (ARCHITECT_NO_FILE_WRITE, IN_PROCESS_NO_AGENT, NAMING_CONVENTION, CANONICAL_NAME_MATCHES_SUBAGENT_TYPE, CONTEXT_PROVIDER_READ_ONLY); 4 mechanical template fixes (platform-auditor + l0-coherence-auditor + module-lifecycle + cross-platform-validator). **PR #72 (Phase 2)**: validators wired into CI in WARN mode — `mcp-server/src/registry/manifest-validator.ts` (lib) + `mcp-server/src/cli/validate-manifest.ts` (CLI) + `scripts/sh/validate-manifest.sh` (bash) + `.ps1` parity + `manifest-drift-warn` job in `.github/workflows/drift-audit.yml`. NAMING_CONVENTION regex extended with `-detector|-alignment`; UTF-8 mojibake (`â€"`) restored to em-dash in data-layer/domain-model/ui-specialist descriptions. **PR #73 (BL-W31.7-07)**: `architect-bash-write-gate.js` PreToolUse hook blocks heredoc/sed-i/awk-i/python-write/tee/redirect bypass for arch-* agents — pairs with existing `architect-self-edit-gate.js` to fully close the W31.5 bypass. Exempt write targets: `/tmp/*`, `/dev/null`, `.planning/wave*/arch-*-verdict.md`, `.androidcommondoc/audit-log.jsonl`. Test deltas: 28 Vitest (manifest-validator) + 21 bats (architect-bash-write-gate) = 49 new tests; suite total 2306/2306 across 126 files. 6 BL-W31.7 items remain (01..06); Phase 3 (templates GENERATED from manifest) is the next milestone in that thread.
- **Wave 31.6** (2026-04-25, PR #69 squash 77aa199) — agent-template cleanup + canonical pattern alignment. 4 task groups: PREP/EXECUTE dispatch clarification (BL-W31.5-01); BANNED-TOOLS banner + Grep/Glob hook coverage (BL-W31.5-04); tl-session-setup.md no-UI-wave skip (BL-W31.5-02); team-lead.md retired in favor of docs/agents/main-agent-orchestration-guide.md (canonical Anthropic pattern: main IS team-lead). Bonus: dev → specialist terminology sweep across 12+ docs. Discovered: all 3 architects bypassed Write/Edit ban via Bash; 7 backlog items added for W31.7 (BL-W31.7-01..07).
- **Wave 29** (2026-04-23, L0 feature/wave-29 + L1 PR #28 + DawSync local merge) — L0 → L1/L2 propagation with manifest drift cleanup. Scope corrected mid-wave (validation tools in target repos are L2/L1 console's job, not L0's). Shipped: L1 PR #28 merged to shared-kmp-libs develop (bd4667bd) with sync + manifest cleanup (removed ghost dev-lead + L0 generics, added legacy L1 orchestrator) + api-contract-guardian CP gate. DawSync local FF merge on feature/sidebar-bug-sprint (2 W29 commits: d3af4ce9 sync/manifest, 0f654dcd CP gates on 4 private agents; user tests locally, 2 stashes preserved for restore). L0 cleanup: dev-lead legacy references removed (doc-alignment-agent dual + skills/work). Observations: setup/agent-templates/ staleness confirmed (BL-W30-04); DawSync local-only repo (BL-W30-05). W17 MED simple-fixes deferred → BL-W30-06..09. WakeTheCave OMITTED (paused, no manifest).
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
Agent templates MUST prefix all git/gh/docker/curl commands with `rtk`. Enforced via agent template guidelines — see `docs/agents/main-agent-orchestration-guide.md`.

## Ingestion Loop (Wave 25)
External sources (Context7 / WebFetch) flow into L0 docs via an explicit approval chain: context-provider flags the gap → team-lead requests user approval → doc-updater runs `mcp__androidcommondoc__ingest-content` → commits to `docs/{category}/{slug}.md` with citation frontmatter. User approval is a hard gate — team-lead does not forward to doc-updater without `approved_by: user`.
