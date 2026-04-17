# Android Skills Catalog (Google CLI) — Intel

**Captured:** 2026-04-18 via `android skills list --long` (CLI v0.7.15222914)
**Source:** https://github.com/android/skills (Apache 2.0) — distributed via `android skills add`
**Policy:** Option C selective bridge — see `skills/android-skills-consume/SKILL.md`.
L0 does NOT fork, vendor, or re-sync Google skills. They live at
`~/.claude/skills/<slug>/SKILL.md` alongside L0-managed skills without collision.

## Full catalog (7 skills)

| Slug | Purpose | Target platform |
|---|---|---|
| `android-cli` | Orchestration of the `android` CLI itself (auto-installed by `android init`) | All agents |
| `navigation-3` | Jetpack Navigation 3 install/migrate; deep links, multi-backstack, scenes, Hilt/VM integration | Android + KMP Compose |
| `r8-analyzer` | R8 / Proguard keep-rule audit: redundancies, broad rules, consumer rule conflicts | Android (release build) |
| `play-billing-library-version-upgrade` | Migrate to latest Play Billing Library | Android (monetized) |
| `edge-to-edge` | Jetpack Compose edge-to-edge + insets + system-bar legibility | Android Compose |
| `agp-9-upgrade` | Upgrade Android Gradle Plugin to v9 | Android build |
| `migrate-xml-views-to-jetpack-compose` | Structured XML View → Compose migration workflow | Android legacy→modern |

## Installed on this host (2026-04-18)

Invoked: `android skills add --skill=<name> --agent=claude-code` (idempotent).

- ✅ `android-cli` — auto-installed by `android init` (all detected agents)
- ✅ `navigation-3`
- ✅ `edge-to-edge`
- ✅ `r8-analyzer`
- ✅ `agp-9-upgrade`
- ✅ `migrate-xml-views-to-jetpack-compose`
- ❌ `play-billing-library-version-upgrade` — deferred (no Play Store target in active projects)

Materialization path: `C:\Users\34645\.claude\skills\<slug>\SKILL.md`. Claude Code
auto-discovers — no registry entry required.

## Per-layer recommendations

| Layer | Project | Applicable skills | Rationale |
|---|---|---|---|
| L0 | AndroidCommonDoc | ALL 7 | Tooling layer — agents reference ALL skills to delegate when relevant |
| L1 | shared-kmp-libs | navigation-3, agp-9-upgrade | KMP infrastructure; no UI (skip edge-to-edge/migrate-xml), no app-release (skip r8/pbl) |
| L2 | DawSync | navigation-3 | Desktop-primary Compose app. androidApp is a stub — skip Android-only tooling until ships |
| L2 | DawSyncWeb | (none) | Astro + Cloudflare Workers web app. Android skills do not apply. Awareness-only via `android-skills-consume` doc |

## Collision check (L0 vs Google slugs)

Zero slug collisions observed. L0 slugs are functional (`test`, `coverage`,
`sync-l0`); Google slugs are domain-scoped (`edge-to-edge`, `r8-analyzer`).
`/sync-l0` additive-mode ignores any slug not in the L0 registry, so Google
skills are never overwritten.

## Wire-up targets (Phase 22-02 scope)

L0 agents to reference these delegatable skills:

| L0 agent | Delegates to | Trigger |
|---|---|---|
| `ui-specialist` | `/edge-to-edge` | Compose insets / `Scaffold` without padding; IME overlap; status-bar legibility |
| `ui-specialist` | `/navigation-3` | New route added, deep-link regression, back-stack divergence |
| `ui-specialist` | `/migrate-xml-views-to-jetpack-compose` | Legacy XML found in `androidMain` |
| `kmp-reviewer` | `/agp-9-upgrade` | AGP version change in `libs.versions.toml` |
| `platform-auditor` | `/r8-analyzer` | Proguard/R8 rule changes under `proguard-rules.pro` |

Agents DO NOT auto-invoke — they recommend in their Summary and surface the
skill slug. The user (or orchestrator PM) decides whether to run `/skill-slug`.

## Refresh cadence

Google's repo is under active expansion. Expected catalog growth:
- Check quarterly with `android skills list --long` (compare against this file)
- When a new slug appears, evaluate: does it overlap with an L0 skill? Per-layer
  applicability? Wire into which agent?
- Updates to existing skills are pulled automatically by `android skills update`
  (not currently scheduled; manual command).

## Cross-references

- `skills/android-skills-consume/SKILL.md` — bridge design + install recipe
- `skills/setup/SKILL.md` — `/setup --mcp` wizard (Phase 19-03 added detection; 22-02 will add skill-install prompt)
- `docs/guides/compose-semantic-diff.md` — Phase 21 desktop UI validation (pairs with `edge-to-edge` for desktop-vs-android UI gap analysis)
- `mcp-server/src/tools/android-cli-bridge.ts` — narrow CLI bridge (`android run --apks`)
- https://developer.android.com/tools/agents/android-skills — official index
- https://github.com/android/skills — source repo (Apache 2.0)
