# AndroidCommonDoc Backlog

> **Last updated**: 2026-06-03 (post Kotlin 2.4.0 GA)
> **Source of truth**: this file is the ordered index. Detailed entries live in `git log` + `~/.claude/projects/.../memory/` (`project_*shipped.md`, `project_*backlog.md`).
> **Update protocol**: when a wave ships, move entry to `## Shipped (recent)`. New items appended in priority order under `## Active`.

## Active (proposed wave order)

### Team stale-suffix spawn guard (MED — hook, ~2-3h) — filed 2026-06-07

Hook to **BLOCK** spawning any core session role (team-lead, arch-platform/integration/testing, context-provider, doc-updater, quality-gater, planner, specialists) with a `-2`/`-N` numeric suffix. A suffixed spawn means the canonical name is occupied by a stale/dead peer (stale team dir) → **inter-peer messages misroute to the DEAD original** (gate-acks, consults, dispatches silently lost). The hook should block the spawn and direct the operator to clean `~/.claude/teams/session-{slug}/` first (the work-skill stale-dir check) so the respawn takes the canonical name.

**Trigger**: Kotlin 2.4.0 session, post-reboot (2026-06-07) — respawned `context-provider` + `quality-gater` collided with the dead originals → `context-provider-2` / `quality-gater-2` → broken messaging (user-observed live). The work-skill's manual stale-dir cleanup is easy to skip; make it a mechanical block. Relates to Wave 39 session-teardown hook + memory `feedback_stale_team_suffix_collision`.

**Source**: filed by user 2026-06-07.

### Wave 38 — Ingestion bundle (LOW urgency, ~2-4h)

| ID | Item |
|----|------|
| Ingest-1 | npm-cli-bin-field doc |
| Ingest-2 | gradle-patterns-plugin-authoring doc |
| Ingest-3 | testing-vitest-cjs-esm-mock-boundary doc |
| Ingest-4 | testing-vitest-esm-coverage-instrumentation doc |
| BL-W36-check | `/release-build-verify` promotion eval (calendar BL-W38 ~2026-07-03) |

**Source**: `project_w31.5_ingestion_deferred.md`, `project_bl_w36_backlog.md`.
**Recommendation**: consider folding 4 ingest items into a single `external-tooling-gotchas` hub doc.

### Wave 39 — Wave 19 topology debt + housekeeping (~10-15h)

| ID | Severity | Item |
|----|----------|------|
| W19-#3 | MED | session teardown hook (TeamDelete on session end) |
| W19-#4 | MED | `/work` skill rewrite for 3-phase topology |
| W19-#6 | MED | PREP/EXECUTE dispatch modes (verify partial Wave 23 ship) |
| BL-W36-02 | MED | test-specialist sub-docs vm-testing (10 lines) + coverage-targets (8 lines) are stub-sized per `doc-migrator.md:157`. Consider consolidating into a single `test-specialist-patterns.md` sub-doc or merging back to template (if line budget allows) |
| BL-W36-03 | LOW | MIGRATIONS.json field divergence — older entries use `note`, recent (1.16.0/1.17.0/1.18.0) use `summary`. Normalize in cleanup pass |
| BL-W36-04 | LOW | quality-gater stash-test methodology gave false "pre-existing" verdict on PR4 manifest-validator failures (actually PR4-introduced version mismatch). Investigate stash hygiene or replace with `git diff develop` baseline check |
| BL-W37-02 | MED | `/sync-l0` does NOT propagate `.claude/hooks/` — extend manifest/distribution path to cover hook files. Caused L1 to go stale after BL-W33 PR #102 logger fix; manual cross-repo PR was required (Wave 37 PR1) |
| BL-W37-03 | LOW | When L1 grows `scripts/tests/*.bats` files, fold the inline `shell-tests` job in L1's `ci.yml` (added by BL-W37 PR2) into a call to L0's `reusable-shell-tests.yml`. Currently inline because L0's reusable would fail on empty `.bats` glob in L1 |
| BL-W37-04 | LOW | L1 calls L0 reusable workflows via `@master` (4 invocations + 1 from BL-W37). Pin to immutable SHA or release tag for supply-chain hardening; auto-bump via dependabot or scheduled CI |
| Housekeeping | LOW | `.gsd/agents/` gitignore decision, `l0-manifest.json` source vs output, `material-3-skill/` triage, lingering remote branches |
| Modularization paso 2 | LOW | rewrite "Target architecture" section in `.planning/MODULARIZATION-PLAN.md` (~1h) |

**Source**: `project_wave19_topology_debt.md`, `project_wave19_sprint2_deferred.md`, `project_modularization_paso2_pending.md`.

### Wave 40 — Wave 17 L2 hardening (BIG, ~19-32h)

19 findings (5 HIGH, 13 MED, 1 LOW) from L2 consumer session 2026-04-18. Hardens prose rules → mechanical gates (hooks, numbered-step assertions, liveness probes).

**Source**: `project_wave17_l2_topology_findings.md`, plan at `.planning/wave17-l2-topology-findings.md`.
**Trigger**: schedule AFTER Wave 35-39 cleared for clean context.

### Wave 41 — Plugin v0.2.0 generalize (TBD effort)

9 DSL settings + 3 enums + sha256+prefix + custom frontmatter lambda. Decouple plugin from AndroidCommonDoc opinions.

**Source**: `project_plugin_v0.2.0_generalize.md`, plan at `.planning/plugin-v0.2.0-generalize.md`.
**Sequencing**: per memory directive, "Start AFTER Wave 17".

### Wave 42 — OSS Phase 1 modularization (~12-20h)

`@oscardlfr/claude-kmp-mcp` npm + `io.github.oscardlfr:detekt-kmp-rules` Maven Central + `oscardlfr.github.io/AndroidCommonDoc` VitePress. Apache-2.0 LICENSE prereq met.

**Source**: `project_claude_for_oss_modularization.md`.

### Wave 43 — Wave 18 hypothesis triage (data-driven)

3 candidates: dev pattern-matching loop detection, arch flip-flop guard (one-topic-per-message), CP grep scope auto-validation.

**Trigger**: review when `/metrics` data shows measurable pattern frequency.
**Source**: `project_wave18_backlog.md`.

### Wave BL-W47 — Adaptive Harness Redesign (meta plan, 5 PRs)

Core goal of all BL-W47-prep-X waves. Redesigns the wave harness for resilience, mechanical enforcement, and self-improvement. Full plan at `.planning/BL-W47-PLAN.md`.

**Sub-findings from prep-19** (deferred):
- **SF-prep-19-A** (LOW) — Backslash heredoc Windows path gap: `cat <<'EOF' > C:\...` mangles path in MSYS Bash. Filed by arch-testing. **Obsoleted by Mac migration ~2026-06 → re-eval post-migration.**
- **SF-prep-19-B** (LOW) — TDD bundling protocol: QG WARN in prep-19 C2 (bats+fix bundled in one commit). Future waves may tighten protocol; defer to post-BL-W47 harness review.

**Source**: `.planning/BL-W47-PLAN.md`, `project_wave_bl_w47_prep_19_shipped.md`.

### Wave BL-W47-WATCHER — Release-trigger watcher framework (~4-8h iterative)

Unified upstream-change watcher with 3 output handlers. Replaces ad-hoc calendar items (e.g., `BL-W36-check`) and manual reminders for upstream releases / doc drift.

| Component | Description | Status |
|-----------|-------------|--------|
| Watcher core | Registry of targets + `/schedule` cron + diff vs last snapshot | scoped |
| Handler A | Version trigger — new non-prerelease tag → `/note` + backlog entry + ping for upgrade wave | first iteration |
| Handler B | Doc ingest — new upstream doc URL → existing Ingestion Loop (CP flag → user approval → `ingest-content`) | follow-on |
| Handler C | Drift detection — ingested doc upstream diverges from `last_verified` frontmatter → revalidate finding | follow-on |

**Dependencies**: `/schedule` user-trigger semantics (billable, not auto-launched by Claude), `ingest-content` MCP, `monitor-sources` MCP, `check-outdated` MCP, `validate_upstream` frontmatter.

**Sequencing**: NOT a blocker for BL-W47 main harness wave — independent + parallel. Recommended start AFTER Mac migration completes (~2026-06-07) so watcher targets + Handler B integration validate on the stable post-migration shell environment.

**Source**: `project_wave_bl_w47_prep_20_shipped.md` (filed 2026-05-31).

### Wave BL-W47-RENDER — Headless Compose render-to-PNG autofix loop (~4-8h iterative)

Off-screen rendering of `@Composable` functions to PNG using `androidx.compose.ui.ImageComposeScene` (Skiko-backed). Enables ui-specialist + test-specialist autonomous visual-regression iteration without a display. Fills the "Screenshot diff (future)" gap noted in `docs/guides/compose-semantic-diff.md:126`.

| Component | Description | Status |
|-----------|-------------|--------|
| Renderer wrapper | Thin Kotlin wrapper around `ImageComposeScene` (secondary constructor — no `@ExperimentalComposeUiApi` opt-in) | scoped |
| L0 MCP tool `render-composable` | Invokes renderer via Gradle task, returns PNG path + dimensions | scoped |
| ui-specialist autofix loop | render → multimodal read → detect issues → Edit → re-render → pixel diff | scoped |
| /audit + /full-audit integration | Fold render step into existing audit commands as new dimension | follow-on |

**API surface (CP-verified, source: JetBrains/compose-multiplatform-core jb-main)**:
- Class `androidx.compose.ui.ImageComposeScene` lives in `skikoMain` — available on Desktop JVM, iOS, macOS, Linux (NOT Android, NOT Wasm/JS)
- `render(nanoTime: Long = 0): org.jetbrains.skia.Image` — stable in practice (used by compose-hot-reload since 1.10.0+)
- Conversion chain: `Image.toComposeImageBitmap().toAwtImage()` → `ImageIO.write(...)` PNG (Desktop JVM path)
- Initial implementation: Desktop JVM only (AWT for PNG encoding). iOS/macOS need platform-specific encoder.

**Dependencies**: CMP ≥ 1.10.0 (Skiko-backed targets), Desktop JVM toolchain. NOT integrated with `runComposeUiTest` (which is a separate test API — see `testing-compose-ui-test-v2` for that domain).

**Sequencing**: post Mac migration (~2026-06-07). Re-eval after migration smoke-test confirms Desktop builds clean on macOS. Future Handler B (CI integration) when Wave-RENDER first iteration ships clean.

**Source**: spike pattern observed in L2 consumer project (2026-05-31). CP Context7 + source verification confirmed API. Ingestion-request flagged for new L0 doc `compose-headless-render-imagescene.md` under `category: compose` — file as follow-on wave or fold into RENDER C1 implementation.

### Wave BL-W47-HOOK-MANIFEST — Consumer Hook Manifest (doc-only, ~1h)

File a canonical reference classifying all 34 L0 hooks
(`consumer-required` / `consumer-optional` / `l0-internal`).
Addresses the silent settings.json registration gap: even after hook files land
on disk (`.js` via sync-l0, `.sh` via install-hooks), the consumer must still
decide which to REGISTER in settings.json. Currently the L2 consumer project
registers 5 of 12 consumer-required hooks.

**Components**:
| Doc | Change |
|---|---|
| `docs/agents/hook-manifest.md` | NEW — 34-hook classification table |
| `docs/agents/agents-hub.md` | +1 row to Documents table |

**Sequencing**: Independent of Mac Platform Shift. Doc-only; no hook code changes.
Follow-on wave (out of scope here): extend sync-l0 to validate consumer settings.json
against the manifest (warn-only).

**Source**: BL-W47-prep-22 planning, 2026-05-31.

## Platform Shift (MacBook Pro M5 Max migration in progress)

**Target**: ~2026-06-01 to ~2026-06-07 (≤1 week from filing).
**Trigger**: Hardware migration off Windows + MSYS/Git-Bash environment to native macOS.

### Items that DIE with migration (no follow-up needed)

- **SSL/PKIX Windows-ROOT trust store workaround** — JVM trust chain mismatch resolved by `-Djavax.net.ssl.trustStoreType=Windows-ROOT` flag. Irrelevant on Mac (default keychain trust).
- **Backslash heredoc Windows path gap** (`SF-prep-19-A`) — MSYS Bash mangles `cat <<'EOF' > C:\Users\...\verdict.md`. Native macOS bash/zsh: no such issue.
- **MSYS path quirks** — `/c/` prefixes, cygdrive translation, `/tmp` vs `C:\Users\...\Temp` divergence. All gone on Mac.
- **.ps1 hooks** — never invoked outside PowerShell; prune from settings.json post-migration.

### Items needing RE-EVAL on Mac (assess post-migration)

- Shell defaults — zsh is macOS default; verify all bats + shell hooks work under zsh quirks.
- Gradle truststore — likely zero-config on Mac (keychain trust); confirm by attempting one full build without flags.
- bats runner — confirm `scripts/tests/*.bats` execution under macOS bats-core (Homebrew install).
- Xcode/iOS targets — newly available. L2 consumer projects can finally compile iOS/macOS targets. Schedule smoke-test wave once core toolchain verified.
- `~/.gradle/gradle.properties` — re-create empty on Mac (don't copy Windows-specific flags).

### Migration playbook reference

See conversation history (post BL-W47-prep-19, 2026-05-31) for full migration plan: fresh install + selective restore of `~/.claude/` user-level config + project clones + re-auth all credentials (no token copy).

## Long-term / no fixed order

- **L2 consumer product alignment** session — pricing drift, feature contradictions, dormant context-bridge — `project_dawsync_product_alignment.md`
- **Future agents** — D1 guardian for L2 web consumer, context-provider-as-internal-context7-agent — `project_future_agents.md`
- **Plugin v0.2.1** — triggered-only (10 @Disabled tests pending Maven Central v0.3.0) — `project_plugin_v0.2.1_status.md`
- **BL-W32-04** — CP zombie session start — active observation, no fix yet — `project_BL-W32-04_shipped.md`

## Shipped (recent)

- **Kotlin 2.4.0 GA** (2026-06-03) — Upgrade L0 to Kotlin 2.4.0 GA. Manifest pins (kotlin→2.4.0 ×3, KSP→2.3.9 decoupled + coupled_versions removed), build-logic toolchain 2.3.0→2.4.0 (build-verified clean), 3 GA claim corrections (Wasm Component Model Experimental-in-GA, context-args nuance, K/N GC flag), new docs/stdlib/ domain (UUID/sorted-order/value-class JS-TS export) + collection literals + Gradle 9.5 compat. 13 commits. — `project_wave_kotlin_2_4_0_ga_shipped.md`
- **BL-W47-prep-22** (2026-05-31) — Consumer hook-manifest: 34 hooks 12/10/12 + hub + BACKLOG; 100% coverage now CI-enforced (drift-audit hook-manifest-coverage job). PRs #201/#202/#203 — `project_wave_bl_w47_prep_22_shipped.md`
- **BL-W47-prep-21** (2026-05-31) — BL-W47-RENDER filed (CP-verified ImageComposeScene Skiko API) + 6 Wave-3cd docs promoted draft→active + F3/F4/F5 NOOPs. 2 commits. PR #200 — `project_wave_bl_w47_prep_21_shipped.md`
- **BL-W47-prep-20** (2026-05-31) — BACKLOG.md refresh (27-day stale): Shipped prune to top-5 + BL-W47-WATCHER + BL-W47 main + 2 prep-19 sub-findings + Mac Platform Shift section. 2 commits. PR #199 — `project_wave_bl_w47_prep_20_shipped.md`
- **BL-W47-prep-19** (2026-05-27) — Hook hardening: F1 kickoff-scope validator (WARN-only hook + 4 bats) + F2 $VAR redirect exemption fix (resolveShellVar helper). 126/126 bats. F3 NOOP — `project_wave_bl_w47_prep_19_shipped.md`

For full wave history: `git log` + memory `project_*shipped.md` files.

## How to use this document

1. **Starting a session**: pick the topmost active wave; review the linked source memory files for detailed context.
2. **Wave brief**: write `.planning/wave-bl-w{N}-prompt.md` modeled after `.planning/wave-bl-w34-l1-security-prep-prompt.md` (gitignored — local).
3. **On wave completion**: doc-updater moves entry to `## Shipped (recent)`, prunes oldest if section >5 waves, commits via PR.
4. **Adding new items**: append to active waves or create new wave entry; preserve priority order rationale.
5. **Cross-references**: every active wave row links to a memory file with full context. If memory entry is missing, file before starting that wave.
