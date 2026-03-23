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
| `full-audit-orchestrator` | Quality audit | `/full-audit` — wave execution, 15 agents, 3-pass dedup |
| `quality-gate-orchestrator` | Consistency | Quality gate runs — all 5 validators + pass/fail report |

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

### Doc size limits
- Hub docs **≤100 lines**, sub-docs **≤300 lines**, absolute max 500
- If growing beyond: split it, don't extend it

### Pattern docs need YAML frontmatter
- Every doc: `scope`, `sources`, `targets`, `category`, `slug`
- Cross-references use relative paths — no absolute paths between subdirectories

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

## Doc Consultation
- Vault sync → `mcp-server/src/vault/` (transformer, moc-generator, wikilink-generator)
- New skill → `skills/sync-vault/SKILL.md` as canonical example
- L0→L1/L2 propagation → `skills/sync-l0/SKILL.md`
- Pattern docs → `docs/` with category hubs (15 domains, 55 sub-docs)
- Upstream validation → `docs/guides/upstream-validation.md` (validate_upstream frontmatter)
- Detekt rules → `detekt-rules/` + `docs/guides/detekt-config.md`
