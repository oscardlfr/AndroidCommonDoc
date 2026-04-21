---
scope: [agents, models, config, pm, session-setup]
sources: [androidcommondoc]
targets: [all]
slug: tl-model-profiles
status: active
layer: L0
parent: agents-hub
category: agents
description: "Design doc for .claude/model-profiles.json: profile semantics, team-lead-opus-override rationale, haiku/opus override maps, session-start selection."
version: 1
last_updated: "2026-04"
assumes_read: agents-hub
token_budget: 1500
---

# team-lead Model Profiles

Reference for `.claude/model-profiles.json`. Explains the profile structure, what each profile means, why the team-lead override is intentional, and how the profile maps to session-start model selection.

## File Structure

```json
{
  "current": "balanced",
  "profiles": {
    "<name>": {
      "description": "...",
      "default_model": "haiku" | "sonnet" | "opus",
      "overrides": { "<agent-name>": "<model>", ... }
    }
  }
}
```

- `current` — the active profile. Project-local, never overwritten by L0 sync.
- `profiles` — canonical profile definitions. Shipped by L0, refreshable via `/set-model-profile --update`.
- `default_model` — the model every agent gets unless it appears in `overrides`.
- `overrides` — per-agent model pins within a profile. An agent's effective model is `overrides[name] ?? default_model`.

## The Four Profiles

| Profile | `default_model` | Intent | When to use |
|---------|------------------|--------|-------------|
| `budget` | haiku | All agents run on haiku. No overrides. Optimize for speed and cost. | Quick static checks, iterating on scripts, cost-constrained CI runs. |
| `balanced` | sonnet | Sonnet for cross-file reasoning. Haiku overrides for grep-like static validators. Opus override for team-lead (multi-arch coordination). **This is the default profile.** | Day-to-day development. |
| `advanced` | sonnet | Sonnet default. Opus overrides for orchestration and deep analysis. Opus team-lead (same rationale as balanced). Best cost/quality ratio for serious work. | Milestone-level work where orchestrators and debuggers need stronger planning, but most validators can stay on sonnet. |
| `quality` | opus | All agents run on opus. No overrides. Maximum quality. | Pre-release audits, critical production investigations, final milestone gates. |

## Override Maps

### `balanced` overrides

Pushes static/grep-like agents down to haiku (cheaper than the sonnet default) and team-lead up to opus (stronger than default):

- `script-parity-validator` → haiku
- `skill-script-alignment` → haiku
- `doc-code-drift-detector` → haiku
- `l0-coherence-auditor` → haiku
- `release-guardian-agent` → haiku
- `api-rate-limit-auditor` → haiku
- `template-sync-validator` → haiku
- `team-lead` → **opus**

### `advanced` overrides

Pushes orchestrators, deep-analysis specialists, and high-stakes auditors up to opus:

- `full-audit-orchestrator` → opus
- `quality-gate-orchestrator` → opus
- `beta-readiness-agent` → opus
- `cross-platform-validator` → opus
- `privacy-auditor` → opus
- `test-specialist` → opus
- `debugger` → opus
- `team-lead` → **opus**

### `budget` and `quality` overrides

Both are deliberately empty. They are the "escape hatches" — one flag to make everything cheap or everything careful. Adding per-agent overrides here erodes that guarantee.

## The team-lead Opus Override — Intentional

The `team-lead` agent's template frontmatter is `model: sonnet`. The profile file overrides this to **opus** in both `balanced` and `advanced`. This is **intentional, not drift**.

Reasoning:

- **team-lead coordinates multiple architects in parallel.** It reads each architect's verdict, reconciles disagreements, authorizes scope extensions, and routes retries. This is multi-source reasoning — the failure mode of a sonnet team-lead is that it accepts a flawed verdict because it lacks the headroom to cross-check all three architects' outputs simultaneously.
- **team-lead decisions are load-bearing for the whole session.** A single bad team-lead call (wrong dispatch target, missed verdict conflict, silent scope drift) propagates to every dev and architect. The marginal opus cost is paid once per wave; the downside of a sonnet mistake is paid across the whole team.
- **The template `model:` field is a fallback.** It is what a bootstrap project sees before `/set-model-profile` runs. Once a profile is selected, the `overrides` map wins. This is why the template shows `sonnet` (Wave 22 spawn-prompt diet) while live team-lead still runs on opus in both default profiles — the two are designed to be different.

Do not "fix" this gap by removing the team-lead override. That would silently downgrade team-lead wave coordination quality on every project running `balanced` or `advanced`.

### When team-lead actually runs on sonnet

- `budget` — explicit user choice to trade quality for speed/cost. Acceptable for short iteration waves.
- `balanced` or `advanced` with a custom project override that removes the team-lead pin. Only do this if the project has simple single-architect waves.

## Session-Start Selection

At session start, team-lead reads `.claude/model-profiles.json` to determine which model each spawned peer should use. The selection is advisory:

- Team-lead resolves each peer's model as `overrides[peer] ?? default_model` for the `current` profile.
- Team-lead uses that model when calling `Agent(name=..., model=...)` to spawn the peer.
- **team-lead does not enforce model selection on peers it spawns** — once a peer is running, team-lead coordinates via `SendMessage`, not via model control. If a peer was spawned with the wrong model, the fix is to rotate the peer, not to inject model instructions.

## Changing the Active Profile

```
/set-model-profile balanced      # applies to this project
/set-model-profile --show        # current + per-agent model table
/set-model-profile --update      # refresh profile defs from L0, keep `current`
```

The skill rewrites every agent's `model:` frontmatter to match the profile's resolved model. After a switch, the team-lead template will carry the override model (opus for balanced/advanced, haiku for budget, opus for quality) — this is the runtime state, not drift from the template fallback.

## Custom Profiles

Projects can add profiles to `model-profiles.json` (e.g., a `mixed` profile with opus orchestrators and haiku validators). After manual edits, run `/set-model-profile <name>` to apply. `/sync-l0` does not overwrite `model-profiles.json` — local customizations survive sync.

## Cross-References

- Config file: `.claude/model-profiles.json`
- Skill: `skills/set-model-profile/SKILL.md`
- team-lead template: `setup/agent-templates/team-lead.md`
- team-lead agent (synced): `.claude/agents/team-lead.md`
- Session setup: [tl-session-setup](tl-session-setup.md)
- Hub: [agents-hub](agents-hub.md)
