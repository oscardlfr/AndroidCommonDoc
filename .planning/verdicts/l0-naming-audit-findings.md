# L0 Naming-Drift Audit — Findings & Fix Plan

**Date**: 2026-04-25  
**Auditor**: codebase-mapper (audit-runner)  
**Scope**: `setup/agent-templates/*.md` (39 files) + spot-check `.claude/agents/` copies  

---

## Summary

**Total findings: 4** (2 HIGH / 1 MED / 1 LOW)

**Cross-verification result**: ALL `.claude/agents/` copies are byte-identical to `setup/agent-templates/` — no drift.

**Top 5 templates with drift** (by finding count):
1. `team-lead.md` — 1 HIGH (self-describes as "project manager")
2. `arch-platform.md` — 1 HIGH + 1 MED (stale doc anchor, "senior engineer" in description)
3. `arch-integration.md` — 1 HIGH (stale doc anchor, same as arch-platform)
4. `feature-domain-specialist.md` — 1 LOW ("senior engineer" label in body)
5. No other templates have naming-drift findings.

---

## Findings Table

| # | File | Line | Legacy Term | Replacement | Severity |
|---|------|------|-------------|-------------|----------|
| F1 | `setup/agent-templates/team-lead.md` | 18 | `"You are the project manager."` | `"You are the team-lead."` | HIGH |
| F2 | `setup/agent-templates/arch-platform.md` | 85 | anchor `pm-liveness-check` in URL | `tl-liveness-check` (match actual heading in `arch-topology-protocols.md`) | HIGH |
| F3 | `setup/agent-templates/arch-integration.md` | 85 | anchor `pm-liveness-check` in URL | `tl-liveness-check` (match actual heading) | HIGH |
| F4 | `setup/agent-templates/feature-domain-specialist.md` | 31 | `"You are a senior engineer."` | remove / replace with role-appropriate framing (specialist, not architect) | MED |

---

## Finding Details

### F1 — team-lead.md:18 — "You are the project manager"

```
You are the project manager. You orchestrate the project: plan scope, assign work to architects...
```

The frontmatter `name: team-lead` is correct. The body's opening identity sentence still uses the pre-Wave-25 "project manager" label. Per MIGRATIONS.json entry at line 97: `"PM" shorthand -> "team-lead"`. This is the primary identity sentence — it's what the model reads first to understand its role. A mismatch between `name: team-lead` (frontmatter) and `"project manager"` (body) creates role-label confusion in the very first instruction.

**Fix**: `"You are the team-lead. You orchestrate the project..."`

---

### F2 & F3 — arch-platform.md:85 + arch-integration.md:85 — stale `pm-liveness-check` anchor

Both files reference:
```
docs/agents/arch-topology-protocols.md#2-reporter-protocol--pm-liveness-check--team-lead-fallback-t-bug-012
```

The actual heading in `docs/agents/arch-topology-protocols.md` (line 49) is:
```
## 2. Reporter Protocol — team-lead liveness check + team-lead fallback (T-BUG-012)
```

Which resolves to anchor: `#2-reporter-protocol--team-lead-liveness-check--team-lead-fallback-t-bug-012`

The `pm-liveness-check` segment is a leftover from before the Wave-25 rename. The anchor is a **broken deep-link** — it silently points to nothing (no heading matches the anchor string). Any agent or reader following this link lands at the top of the doc, not the correct section.

**Fix** (both files, same line 85):
```
docs/agents/arch-topology-protocols.md#2-reporter-protocol--team-lead-liveness-check--team-lead-fallback-t-bug-012
```

---

### F4 — feature-domain-specialist.md:31 — "You are a senior engineer"

```
You are a senior engineer. You review the {{DOMAIN}} layer for architecture compliance.
```

Per memory `feedback_senior_engineer_role.md`: "ONLY devs are senior engineers, NOT architects." The `feature-domain-specialist` is a **dev-tier template** (tools include Write/Edit via Bash), so calling it "senior engineer" is **not architecturally wrong** (devs ARE senior engineers). However, the framing "senior engineer" is ambiguous — it's a leftover label that doesn't match the role-naming convention (specialists/devs, not "engineer" generic).

The rule says devs ARE senior engineers. This is MED because technically this is dev-tier, but the generic "senior engineer" label is not the canonical naming for a specialist-type agent in the current roster.

**Fix**: Replace with `"You are a persistent session team member..."` + role-appropriate specialist framing (matching test-specialist.md:25, ui-specialist.md:20 pattern). Remove `"senior engineer"` label entirely.

---

## Canonical Roster (confirmed from team-lead.md + Wave history)

| Role | Template Name | Layer | Managed By |
|------|--------------|-------|-----------|
| Orchestrator | `team-lead` | Session | User (is the team-lead directly) |
| Architects | `arch-testing`, `arch-platform`, `arch-integration` | Session (persistent) | team-lead |
| Core Devs | `test-specialist`, `ui-specialist`, `data-layer-specialist`, `domain-model-specialist` | Phase 2 (persistent) | Architects |
| Session Peers | `context-provider`, `doc-updater`, `quality-gater`, `planner` | Session | team-lead |
| Guardians | `release-guardian-agent`, `cross-platform-validator`, `privacy-auditor`, `api-rate-limit-auditor`, `doc-alignment-agent` | On-demand | Architects / team-lead |
| Support | `debugger`, `verifier`, `advisor`, `researcher`, `codebase-mapper` | On-demand | team-lead |
| Audit/Ops | `full-audit-orchestrator`, `quality-gate-orchestrator`, `l0-coherence-auditor`, `platform-auditor` | On-demand | team-lead |
| Doc-ops | `doc-migrator`, `doc-code-drift-detector`, `script-parity-validator`, `skill-script-alignment`, `template-sync-validator`, `module-lifecycle` | On-demand | team-lead |
| Business | `product-lead`, `product-strategist`, `marketing-lead`, `content-creator`, `landing-page-strategist` | On-demand | team-lead |
| Template | `feature-domain-specialist` | Template only (fill in `{{DOMAIN}}`) | — |
| Beta | `beta-readiness-agent` | On-demand | team-lead |

**NOT in roster (confirmed deprecated/removed)**: `project-manager`, `dev-lead`, `PM` as agent name  
**NOT in roster (memory only, no template)**: `ui-dev`, `data-dev`, `domain-dev`, `test-dev` — these names appear in memory (`project_3phase_team_architecture.md`) as a *v5.0.0 description concept* but the actual spawned agents use `test-specialist`, `ui-specialist`, etc. The "4 core devs" ARE the specialists.

---

## Fix Plan

### Group A — HIGH: Identity + broken anchor (3 occurrences, 3 files)

**Priority**: Fix before Wave 31.5-b runs (user directive).

1. **team-lead.md line 18**: Change `"You are the project manager."` → `"You are the team-lead."`
2. **arch-platform.md line 85**: Fix `pm-liveness-check` anchor → `team-lead-liveness-check`
3. **arch-integration.md line 85**: Same anchor fix as arch-platform

After edits: copy all 3 files to `.claude/agents/` (currently identical, so a standard `cp` suffices). Regenerate registry if any frontmatter changed (no frontmatter changes expected for these fixes).

### Group B — MED: Feature-domain-specialist role label (1 occurrence, 1 file)

**Priority**: Can follow Group A in the same PR.

4. **feature-domain-specialist.md line 31**: Replace `"You are a senior engineer. You review the {{DOMAIN}} layer for architecture compliance."` with `"You are a persistent session team member specializing in the {{DOMAIN}} layer. You review {{DOMAIN}} components for architecture compliance."` — aligns with the specialist template pattern used in test-specialist, ui-specialist, domain-model-specialist.

Copy to `.claude/agents/` after edit.

---

## Out-of-Scope Observations

These are NOT naming-drift issues but were noticed during audit:

1. **team-lead.md line 248**: Claims "MCP Tools (35, used by architects and devs automatically)" — the count 35 is hardcoded and likely stale (actual MCP tool count may differ). Not a naming issue; belongs in a separate doc-accuracy audit.

2. **arch-testing.md:94** references `"context-provider has find-pattern, module-health, search-docs"` — `search-docs` may be a legacy tool name (vs `find-pattern` used elsewhere). Not verified against MCP server tools list. Out of scope for naming audit.

3. **quality-gater.md:12** says "Phase 3" but the session setup in team-lead.md spawns quality-gater at session start (not Phase 3 start). The body says "DORMANT until team-lead activates for Phase 3" which is correct. The description "added to session-{project-slug} in Phase 3" is slightly inaccurate — it's added at session start but dormant. Minor doc accuracy issue, not naming drift.

4. **arch-platform.md:3 (description field)**: Says "fixes violations directly or via delegation" — this contradicts the NO Write/Edit rule enforced in the body. The description is visible in the registry and could mislead callers. Not naming drift; belongs in a template-accuracy audit.

5. **README.md in setup/agent-templates/**: Not mirrored to `.claude/agents/` (expected — it's a meta-doc, not an agent template). No action needed.

---

## Cross-Verification: Memory vs Templates

| Memory Claim | Template Reality | Match? |
|---|---|---|
| "dev-lead legacy references removed in Wave 29" | No `dev-lead` found in any template | MATCH |
| "ONLY devs are senior engineers, NOT architects" | Architects say "NO Write/Edit tool" in body; NO "senior engineer" label. feature-domain-specialist (dev-tier) has "senior engineer" label | PARTIAL — the label only appears in dev-tier, which IS allowed per memory rule |
| "architects bypass dev dispatch and write code directly — Remove Write/Edit from arch tools" | All 3 arch frontmatter have NO Write/Edit; body text says "NO Write/Edit tool" | MATCH |
| "project-manager → team-lead rename (Wave 25)" | team-lead.md body line 18 still says "project manager" | MISMATCH — F1 above |
| "4 core devs (ui/data/domain/test) persist Phase 2→end" | team-lead.md spawns exactly 4 specialists (test-specialist, ui-specialist, domain-model-specialist, data-layer-specialist) | MATCH |
| "session team naming: session-{slug}" | All templates use `session-{project-slug}` | MATCH |
