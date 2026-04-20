<!-- GENERATED from skills/android-skills-consume/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Bridge to Google's Android CLI skill ecosystem. Documents how to install Google's official Android skills via `android skills add` and how they co-exist with L0 skills without conflict."
---

Bridge to Google's Android CLI skill ecosystem. Documents how to install Google's official Android skills via `android skills add` and how they co-exist with L0 skills without conflict.

## Instructions

# android-skills-consume (reference)

This is a **reference-type** skill: no actions, no flags — it documents a co-existence design between L0 (AndroidCommonDoc) and Google's Android Skills ecosystem.

## Catalog (as of 2026-04-18)

| Slug | Purpose | Install |
|---|---|---|
| `android-cli` | Orchestrate the `android` CLI itself (auto-installed by `android init`) | `android init` |
| `navigation-3` | Jetpack Navigation 3 install/migrate | `android skills add --skill=navigation-3` |
| `edge-to-edge` | Jetpack Compose edge-to-edge + insets | `android skills add --skill=edge-to-edge` |
| `r8-analyzer` | R8 / Proguard keep-rule audit | `android skills add --skill=r8-analyzer` |
| `agp-9-upgrade` | Android Gradle Plugin v9 migration | `android skills add --skill=agp-9-upgrade` |
| `migrate-xml-views-to-jetpack-compose` | XML View → Compose migration workflow | `android skills add --skill=migrate-xml-views-to-jetpack-compose` |
| `play-billing-library-version-upgrade` | Play Billing Library migration | `android skills add --skill=play-billing-library-version-upgrade` |

Authoritative list: `android skills list --long`.

## Co-existence rules

- L0 does **not** fork, vendor, or re-sync Google skills.
- Google skills live at `~/.claude/skills/<slug>/SKILL.md` alongside L0-managed skills.
- `/sync-l0` ignores any slug not in the L0 registry — Google skills are never overwritten.
- If an L0 slug collides with a Google slug, add the slug to `selection.exclude_skills` in `l0-manifest.json`.

## Per-layer applicability

- **L0** — all installed for agent delegation
- **L1 shared-kmp-libs** — `navigation-3`, `agp-9-upgrade`
