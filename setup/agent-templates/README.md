# Agent Templates

Generic agent templates for L1 (ecosystem library) and L2 (application) projects.

These are **starting points** — adapt to your project's specific modules, constraints, and domain terminology.

## How to Use

1. Copy the template you need to your project's `.claude/agents/` directory
2. Replace all `{{PLACEHOLDER}}` values with your project specifics
3. Remove sections that don't apply to your project
4. Register the agent in `l0-manifest.json` under `l2_specific.agents`

## Templates

### Universal (any layer)

| Template | Purpose |
|----------|---------|
| `team-lead.md` | 3-phase orchestrator — session team peers + temporary planner/quality-gater |
| `planner.md` | Temporary planning peer — produces structured plans, writes to `.planning/PLAN.md` |
| `quality-gater.md` | Session team peer (Phase 3) — runs sequential verification (tests, coverage, pre-pr) |
| `context-provider.md` | Session team peer — read-only cross-layer context oracle |
| `doc-updater.md` | Session team peer — updates docs, CHANGELOG, memory after work |
| `doc-migrator.md` | Sporadic team agent — migrates docs to L0 patterns (hubs, splits, frontmatter) |

### Architects (session team peers)

| Template | Purpose |
|----------|---------|
| `arch-testing.md` | Test quality, TDD, regression — manages test-specialist, ui-specialist. Compile gate: specialists must prove `./gradlew assemble` passes |
| `arch-platform.md` | KMP patterns, deps, source sets — manages domain-model, data-layer. Compile gate enforced |
| `arch-integration.md` | Compilation, DI, nav, gates — manages ui-specialist, data-layer. Compile gate enforced |

### L1 (Ecosystem Library)

| Template | Purpose |
|----------|---------|
| `platform-auditor.md` | Cross-module architecture coherence auditor |
| `module-lifecycle.md` | New module creation and deprecation checklists |

### L2 (Application)

| Template | Purpose |
|----------|---------|
| `feature-domain-specialist.md` | Domain-specific architecture auditor (customize per domain). Specialist role: must demonstrate understanding before implementation |
| `product-strategist.md` | ICE-scored feature prioritization and milestone planning |
| `content-creator.md` | Build-in-public marketing content (Reddit, Twitter, changelogs) |

### Business Leads (L2 session-level orchestrators)

| Template | Purpose |
|----------|---------|
| `product-lead.md` | Product orchestrator — manages specs, pricing, roadmap |
| `marketing-lead.md` | Marketing orchestrator — campaigns, content, landing pages |
| `landing-page-strategist.md` | Landing page copy, structure, CTAs, SEO strategy |

## Generator (W31.7 Phase 3)

Round 1 (PR #75): templates are now generated from `.claude/registry/agents.manifest.yaml` for `arch-platform`, `arch-testing`, `arch-integration`. Other 35 agents remain hand-edited until subsequent rounds; when 38/38 reach canonical state, Phase 4 flips the validator from WARN to BLOCK.

**For generated agents, edit the manifest, not the template.** Hand-editing template frontmatter on a regenerated agent is drift the validator catches.

```bash
# Regenerate one agent (writes template + mirror, idempotent)
node mcp-server/build/cli/generate-template.js arch-platform .

# Read-only drift check (CI-ready, exit 1 on drift)
node mcp-server/build/cli/generate-template.js arch-platform . --check

# Batch over every manifest entry
node mcp-server/build/cli/generate-template.js --all . --check

# Regenerate + write SHA-256 baseline back to manifest
node mcp-server/build/cli/generate-template.js arch-platform . --update-manifest-hash
```

Wrappers (script-parity rule): `scripts/sh/generate-template.sh`, `scripts/ps1/generate-template.ps1`.

**Canonical frontmatter field order** (anchors round-1 SHA-256 baseline):
`name → description → tools → model → domain → intent → token_budget → template_version → memory → skills → optional_capabilities`

Optional fields are omitted entirely when null/undefined/empty. Body content is preserved byte-for-byte across regeneration — only the YAML frontmatter is authored from manifest data.

## Conventions

All agents follow these conventions from L0:
- **YAML frontmatter**: name, description, tools, model, memory, skills
- **Single responsibility**: one domain per agent
- **Read-only by default**: audit agents report, don't modify
- **Findings protocol**: structured JSON between `FINDINGS_START`/`FINDINGS_END` markers
- **Skills reference**: agents reference L0 skills (test, coverage, etc.) to save tokens
- **Escalation pattern**: agents escalate to user for business/API decisions, never hallucinate

## Model Selection Guide

| Agent Type | Recommended Model | Rationale |
|-----------|-------------------|-----------|
| Dev lead / orchestrator | opus | Complex reasoning, multi-step planning |
| Architecture auditor | opus | Pattern recognition across large codebases |
| Simple gate checker | sonnet | Rule-based checks, lower token cost |
| Source set validator | sonnet | Grep-based, deterministic checks |
