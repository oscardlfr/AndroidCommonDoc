---
name: android-skills-consume
description: "Bridge to Google's Android CLI skill ecosystem. Documents how to install Google's official Android skills via `android skills add` and how they co-exist with L0 skills without conflict."
allowed-tools: [Bash, Read, Glob]
copilot: true
copilot-template-type: reference
scope: l0
category: ecosystem
slug: android-skills-consume
status: active
layer: L0
version: 1
last_updated: "2026-04-17"
sources:
  - url: "https://github.com/android/skills"
    type: github-repo
    tier: 1
    license: Apache-2.0
  - url: "https://developer.android.com/tools/agents/android-skills"
    type: doc-page
    tier: 2
---

## Purpose

Google publishes a growing set of official Android Skills (`github.com/android/skills`, Apache 2.0) that any `agentskills.io`-compatible agent — including Claude Code — can install with one command. This skill documents how those skills **co-exist** with L0's own skill ecosystem *without* fork debt or sync conflicts.

## Design — Option C (selective bridge)

AndroidCommonDoc does **not** fork, vendor, or re-distribute Google's skills. They live where `android skills add --agent=claude-code` puts them (`~/.claude/skills/<name>/SKILL.md`) and Claude Code loads them directly. L0 neither tracks their content in the registry nor ships them via `/sync-l0`.

Why this design:
- The Google repo does not accept external PRs — forking means perpetual drift maintenance.
- The skills format is open (`agentskills.io`) and 1:1 compatible with `.claude/skills/`, so no translation layer is needed.
- Each consumer project can adopt or ignore each Google skill independently.

## Usage Examples

```
# Install all Google-maintained Android skills
android skills add --all

# Install a specific skill (listed by `android skills list`)
android skills add edge-to-edge
android skills add --agent=claude-code performance

# Remove
android skills remove --agent=claude-code edge-to-edge

# Discover what's available
android skills list --long
android skills find 'performance'
```

The `--agent` flag accepts any detected agent directory. `android init` auto-installs the `android-cli` skill into every detected agent location (`~/.claude/skills/`, `~/.codex/skills/`, `~/.gemini/antigravity/skills/`, etc.).

## Co-existence with L0 skills

When both L0 and Google publish a skill with the same slug, L0's `/sync-l0` will overwrite the Google copy at sync time — but the user can opt out per slug by adding it to `selection.exclude_skills` in `l0-manifest.json`. The recommended flow:

1. Install Google skill: `android skills add <slug>`.
2. If the slug collides with an L0-owned slug, decide which one the project wants to use.
3. If the Google version is preferred, add the slug to `selection.exclude_skills` in the project's `l0-manifest.json`. Next `/sync-l0` run leaves the Google skill intact.

As of Phase 22 audit (2026-04-18), zero collisions between L0 slugs (e.g. `test`, `coverage`, `sync-l0`) and Google slugs (domain-scoped names). Verify with `android skills list --long` before adopting a new Google skill. Full catalog snapshot maintained at `.planning/intel/android-skills-catalog.md`.

## Google catalog (as of 2026-04-18)

| Slug | Purpose | Applicable layer |
|---|---|---|
| `android-cli` | Orchestrate the `android` CLI itself (auto-installed by `android init`) | ALL |
| `navigation-3` | Jetpack Navigation 3 install/migrate, deep links, multi-backstack | Android + KMP Compose |
| `edge-to-edge` | Jetpack Compose edge-to-edge + insets + system bars | Android Compose |
| `r8-analyzer` | R8 / Proguard keep-rule audit | Android release builds |
| `agp-9-upgrade` | Android Gradle Plugin v9 migration | Android build |
| `migrate-xml-views-to-jetpack-compose` | XML View → Compose migration workflow | Android legacy→modern |
| `play-billing-library-version-upgrade` | Play Billing Library migration | Android monetized |

Run `android skills list --long` for the authoritative, up-to-date catalogue.

## Per-layer applicability

- **L0 (AndroidCommonDoc)**: all skills installed for agent delegation. See wire-up table in `.planning/intel/android-skills-catalog.md`.
- **L1 (shared-kmp-libs)**: `navigation-3`, `agp-9-upgrade`. No UI means no `edge-to-edge`; no release build means no `r8-analyzer`/`play-billing`.
- **L2 KMP desktop-primary (e.g. DawSync)**: `navigation-3` only until `androidApp` ships. Other Android-specific skills deferred.
- **L2 Web (e.g. DawSyncWeb)**: NONE of the Google Android skills apply (Astro/Cloudflare Workers target, not Android).

## L0 agent integration (Phase 22-02)

L0 agents recommend — they do NOT auto-invoke — these delegatable skills when the diff matches their trigger pattern:

| L0 agent | Skill | Trigger |
|---|---|---|
| `ui-specialist` Rule 9 | `/edge-to-edge` | Compose insets / Scaffold without padding / IME overlap / status bar legibility |
| `ui-specialist` Rule 9 | `/navigation-3` | New route, deep-link regression, back-stack change |
| `ui-specialist` Rule 9 | `/migrate-xml-views-to-jetpack-compose` | Legacy XML in `androidMain` |
| `kmp-reviewer` | `/agp-9-upgrade` | AGP version bumped in `libs.versions.toml` |
| `platform-auditor` | `/r8-analyzer` | Proguard/R8 rule changes under `proguard-rules.pro` or `consumer-rules.pro` |

## What this skill does NOT do

- It does not run `android skills add` automatically — installation is an explicit user action.
- It does not sync Google skills via `/sync-l0` — those are managed by the Google CLI.
- It does not validate Google skill content against L0 conventions — Google's skills follow the `agentskills.io` spec, which L0 respects but does not enforce on external content.

## Cross-references

- `skills/sync-l0/SKILL.md` — section "External skill sources" explains how sync avoids touching Google skills
- `skills/setup/SKILL.md` — Wizard W9 "Android CLI detection" (Phase 19-03)
- `docs/guides/getting-started/09-android-cli-windows.md` — Windows install without admin
- `skills/validate-upstream/SKILL.md` — routes `kb://` URLs through `android docs fetch`
- `skills/android-layout-diff` (MCP tool) — runtime UI validation via the Android CLI
