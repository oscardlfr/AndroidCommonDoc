# AndroidCommonDoc Backlog

> **Last updated**: 2026-07-08; Harness Realignment Wave 0 (Harness State Ledger Reconciliation, #234 `0bbf6fa`), Wave 1 (Runtime/Topology Contract Realignment, #235 `125409b`), Wave 2 (Portable Coordination Artifact Layer, #236 `68ed036`), and Wave 3 (Phase-Orchestration Restoration, #237 `8aacc05`) are all MERGED to develop; **Wave 4 — QG/macOS/Local-CI Parity Hardening is the active wave**; RTK template sweep remains deferred pending separate approval
> **Source of truth**: this file is the ordered index. Detailed entries live in `git log` + `~/.claude/projects/.../memory/` (`project_*shipped.md`, `project_*backlog.md`).
> **Update protocol**: when a wave ships, move entry to `## Shipped (recent)`. New items appended in priority order under `## Active`.

## Active (proposed wave order)

### Agent-teams upstream notification delivery report (LOW/MED — upstream/runtime)

The in-repo root fix for unreliable quality-gater completion messages is already shipped: poll-able `qg-result.json` + heartbeat/session-health recovery. Remaining work is an upstream repro/report for the experimental agent-teams notification drop. This is **not** a blocker for the QG harness and should not drive another local harness wave unless a new in-repo failure appears.

### Harness Realignment Sequence (active track, ahead of Wave 38)

Recommended wave sequence from `.planning/harness-realignment-deep-audit-plan.md` (local, gitignored) to reconcile the harness's Claude-first legacy with its shipped disk-first portable floor:

- **Wave 0 — Harness State Ledger Reconciliation** (MERGED to develop `0bbf6fa`, PR #234) — made the ledger honest before new harness work started. No SHIPPED stamp — this is the ledger reconciliation itself, not a shipped feature (stays here, not in `## Shipped`).
- **Wave 1 — Runtime/Topology Contract Realignment** (MERGED to develop `125409b`, PR #235 — see `## Shipped (recent)`) — made every orchestration doc describe one coherent model: portable disk floor plus optional Claude-rich accelerators.
- **Wave 2 — Portable Coordination Artifact Layer** (MERGED to develop `68ed036`, PR #236 — see `## Shipped (recent)`) — implemented the ADR-001 disk-inbox fallback so non-Claude runtimes can coordinate without SendMessage.
- **Wave 3 — Phase-Orchestration Restoration** (MERGED to develop `8aacc05`, PR #237 — see `## Shipped (recent)`; executed DOC: docs/agents wording reconciliation, HARNESS mechanization deferred to BL-W4-10) — restored "living system by phases" on top of the portable contract.
- **Wave 4 — QG/macOS/Local-CI Parity Hardening** (**ACTIVE WAVE** — HARNESS) — make local QG on this Mac honest and reproducible without ad hoc per-wave explanations.
- **Wave 5 — Portable Ingestion + Wave 38 Content** (DOC for pure content; HARNESS if ingestion mechanics/templates change) — make the ingestion loop portable, then process the deferred Wave 38 content (below) through the corrected loop.
- **Wave 6 (optional) — Topology Pilot** (DOC or HARNESS depending on outcome) — measure when Claude-rich background peers are worth using versus single-use/disk-only execution.

**Sequencing**: Waves 0, 1, 2, 3 are MERGED; **Wave 4 — QG/macOS/Local-CI Parity Hardening is the current active wave**. After Wave 4, Wave 5 (Portable Ingestion + Wave 38 Content) is next. Recommended minimum Waves 0-5; Wave 6 is optional hardening after Wave 5.

**Source**: `.planning/harness-realignment-deep-audit-plan.md` (local, gitignored).

### Realignment follow-ups (Wave 4 — QG/macOS parity)

Specific findings enumerated in `.planning/harness-realignment-deep-audit-plan.md` (Wave 0 scope block) to be addressed under Wave 4 — QG/macOS/Local-CI Parity Hardening, above:

- **BL-W4-1** (OPEN, 2026-07-04) — qg-path-audit Class-parser anchoring: `qg-path-audit.sh` extracts the first bold `**Class**:` marker anywhere in `PLAN.md`, not the one under `### Wave Class`; can false-fail detailed plans. **Addressed by Wave 4, pending merge.**
- **BL-W4-2** (OPEN, 2026-07-04) — qg-doc-validators `ANDROID_COMMON_DOC` propagation: `qg-doc-validators.sh` accepts `--toolkit-root` but does not export `ANDROID_COMMON_DOC` to the vitest subprocess; structure check fails without the env var exported even when `--toolkit-root` is passed. **Addressed by Wave 4, pending merge.**
- **BL-W4-3** (OPEN, 2026-07-04) — validate-agent-templates Bash 3.2 policy: macOS ships Bash 3.2 by default; `validate-agent-templates.sh --check tool-body-xref` fails on `declare -A TOOL_PATTERNS` (`TeamCreate: unbound variable`) — needs an explicit compatibility policy (portable Bash 3.2 rewrite, or a fail-closed probe that routes to modern bash without silent skip). **Addressed by Wave 4, pending merge.**
- **BL-W4-4** (OPEN, 2026-07-04) — qg-result delta-honest semantics: tighten what "0-new" / accepted-harness-gap means for `qg-result.json` `status:fail` outcomes so local pre-existing failures don't require a manual per-wave explanation. **Addressed by Wave 4, pending merge** — `emit-qg-result.sh` manifest-membership code fix (required-steps lookup now sourced from `quality-gate-manifest.json`'s `required_steps[].id` instead of a per-step `required` default, closing the conditional-SKIP-flips-fail false negative) + `docs/agents/qg-proof-push-gate.md` doc-contract clarification (qg-result.json MAY still read `fail` in a degraded local/macOS env; `push-proof.json`/`verify-proof`/two-stamp gate remain sole push authority regardless).
- **BL-W4-5** (AUDITED — NOT A BUG, 2026-07-04) — `.androidcommondoc/bats-result.*.env` collision: audited as a non-issue — producer names are unique per run, the consumer validates HEAD + started_at + max, and both rejection paths are tested. Originally flagged as a "multi-agent handoff collision risk" in `project_wave_live_tree_write_bats_hygiene_shipped.md`. Two optional LOW-severity hardening notes recorded as non-blocking.
- **BL-W4-6** (OPEN, 2026-07-04) — validate-doc-update root-target confinement: for root-level markdown such as `BACKLOG.md`, docsRoot resolution can walk up to `/` and duplicate detection may traverse the whole filesystem / trigger permission prompts / hang. Fix by rejecting or fast-pathing non-docs targets, bounding the duplicate scan to the project `docs/` root, and adding a regression proving `BACKLOG.md` returns quickly without scanning `/`. (Concrete cause found this wave; refines D9.) **Addressed by Wave 4, pending merge** — this very BACKLOG.md edit is still routed around the running (pre-fix) MCP server instance rather than through it, since the fix isn't live in-process yet.
- **BL-W4-7** (OPEN, 2026-07-07) — qg-path-audit current-wave sentinel auto-recognition: `qg-path-audit.sh` should auto-recognize a wave's own `.claude/wave-quality-gates/<slug>.md` sentinel (mirror the clean-tree exemption) so future waves don't each declare it as a Path-Manifest bullet — candidate HARNESS wave; supersedes the per-wave Path-Manifest workaround used in Waves 1 and 2. **Addressed by Wave 4, pending merge.**
- **BL-W4-8** (OPEN, 2026-07-07) — bats-test-authoring hygiene (3 items): (a) stale line cite in `arch-dispatch-modes.md` (`premature-execution-gate.js:77` → ~144); (b) `capability-preservation.bats` C7.3 named "tl-* doc" but greps bare `docs/agents/`; (c) `named-team-regression-guard.bats` bare-`.planning/PLAN.md` negation matches literal "never" only, not "Do NOT".
- **BL-W4-9** (OPEN, 2026-07-07) — Harden `write-specialist-dispatch.sh:345` confinement prefix check: the `.planning*` bare-glob matches a sibling like `.planning-evil`; needs a trailing-separator / exact-match guard, mirroring the `write-coordination-artifact.sh` fix. Low-severity (only reachable via a symlink planted inside `.planning/`, already a trusted write surface). Surfaced by the Wave 2 Codex-round security re-review. **Addressed by Wave 4, pending merge** — `write-verdict.sh` sibling also hardened with the same trailing-separator/exact-match guard.
- **BL-W4-10** (OPEN, 2026-07-07) — Class-aware phase mechanization gap: the `.claude/hooks/*.js` control plane is class-blind (HARNESS/DOC/FAST-PATH lives only in prose + `wave-topology.yaml`/`resolve-required-roles.js`/`qg-path-audit.sh`, never in a hook); no `SessionStart` hook; `wave-topology.yaml phase_gates` has only 2 booleans with no PREP→dispatch→VERIFY-FINAL state machine; `quality-gate-manifest.json` `architect-deliberation.required_roles` hardcodes the 3 architects (over-blocks DOC/FAST-PATH waves declaring fewer). This is the deep-audit-plan's original Wave-3 HARNESS mechanization idea, deferred (Wave 3 shipped DOC — docs/agents wording reconciliation only). Route to Wave 4 or a dedicated HARNESS wave.
- **BL-W4-11** (OPEN, 2026-07-07) — README + skills fixed-roster drift: `README.md:36,657,659`, `skills/work/SKILL.md:105,182` (the `/work` T-BUG-010 HARD-GATE), `skills/init-session/SKILL.md:28` still teach the old '6 core subagents / 5 core specialists' fixed roster, contradicting the class-aware model reconciled in `docs/agents/` this wave. Both skills are `copilot:false` (no template mirror) but touch the `/work` runtime gate + `/sync-l0` surface, so scoped out of this DOC wave. Reconcile to selective/class-aware.
- **BL-W4-12** (OPEN, 2026-07-07) — No hook blocks orchestrator verdict-forging: `architect-self-edit-gate.js` gates only `agent_type.startsWith('arch-')` (and even then exempts verdict-shaped paths); `push-authorization-gate.js` only intercepts `git push`; `premature-execution-gate.js` excludes `arch-*`/orchestrator by design. Verified via direct source read (Wave 3 PREP): no hook prevents the orchestrator (empty `agent_type`) from directly Write/Edit-ing an `arch-*-verdict.md` path (hand-authoring a verdict instead of `write-verdict.sh`). The 'no-forged-verdict' rule added to `agent-verdict-protocol.md` this wave is discipline-enforced only; this tracks the HARNESS-track mechanical closure.

**Source**: `.planning/harness-realignment-deep-audit-plan.md` (Wave 0 scope + Wave 4 scope), `project_wave_live_tree_write_bats_hygiene_shipped.md`.

### Wave 38 — Ingestion bundle (LOW urgency, ~2-4h) — DEFERRED to Harness Realignment Wave 5

Content deferred — not the next harness wave. Will be processed via **Wave 5 (Portable Ingestion + Wave 38 Content)** of the Harness Realignment Sequence above, once the ingestion loop is made portable, not executed standalone.

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

### Wave BL-W47 — Adaptive Harness Redesign (meta plan) — CORE SHIPPED 2026-06-16

Core goal of all BL-W47-prep-X waves. Redesigns the wave harness for resilience, mechanical enforcement, and self-improvement. Full plan at `.planning/BL-W47-PLAN-v2.md` (v2 supersedes v1).

**Status (post bl-w47-tail closeout)**: core sequence SHIPPED across S1–S6 + tail (cleanup+0a → 0b+rotation-docs → bundles → 0c → floors → tail) plus inserted follow-ups (supersede, prepr-proof). Final closeout (bl-w47-tail) = registry drift hotfix + Terminal L1/L2 sync + Wave-Close + Ex-PR1 Q&A.

**Deferred to follow-on waves (user-consented 2026-06-16)**:
- **Ex-PR6 — HOLD ack-checkpoint**: blocked on OQ10 (checkpoint-density decision); own wave.
- **Topology Pilot — subagent-first wave class**: deserves its own *measured* wave (peer-team vs subagent-first comparison); DO-ON-MAC preferred. NOT the same as bl-w47-tail's runtime-necessity subagent adaptation.
- **Council design implementation**: explicitly next-iteration (user's sole deferral, Gate record item 4).
- **D9** (LOW) — `validate-doc-update` perf: avg 160s/call; MCP perf issue, not harness-critical; owner: doc-updater domain. **Root cause identified 2026-07-04 (Codex audit): target-confinement bug — root-level markdown resolves docsRoot toward `/` and scans the whole filesystem; refined/superseded by BL-W4-6 (Realignment follow-ups).**
- **Dead-skill pruning** (LOW) — 46/61 skills at 0.94% traffic (Part E #17); owner needed.

**Sub-findings from bl-w47-prepr-proof** (deferred, user-consented 2026-06-15):

- **BL-W47-PREPR-1** (MED) — Missing `/quality-gate` command entrypoint: `/quality-gate` is referenced harness-wide (`scripts/sh/pre-push-hook.sh`, `scripts/sh/emit-push-proof.sh` error messages, `docs/agents/context-rotation-guide.md:80`) but no `.claude/commands/quality-gate.md` backs it. Root fix: create `quality-gate.md` command + matching skill/template driving the QG ceremony, OR sweep all refs to the real runner name. Blocked on harness-entrypoint design decision; out of scope for messaging-only waves.

- **BL-W47-PREPR-2** (RESOLVED for current harness, 2026-06-23) — quality-gater secret-scan proof honesty is closed by `qg-proof-honesty-hardening` (Step S fail-closed producer) and `/pre-pr`/MCP present-error semantics are closed by `qg-local-ci-security-closure`. Absent-scanner `/pre-pr` SKIPPED remains intentionally informational; QG required secret-scan remains fail-closed.

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

## Platform Shift (MacBook Pro M5 Max migration) — RESOLVED — macOS migration shipped 2026-06-01

> **RESOLVED (2026-07-04)**: two-phase outcome — do not read this as a flat "target met" or "still undecided". **Environment/hardware readiness** was met on schedule: macOS migration shipped 2026-06-01 (`project_macos_migration_shipped.md`), inside the original ~2026-06-01–06-07 window. **Operational switch** to macOS-primary daily-driver harness use was still pending as of this section's own 2026-06-21 STALE flag, which correctly reported continued Windows/win32 harness operation at that date. The switch has *since* completed — confirmed by continuous macOS-native harness operation across PRs #227-#233 (2026-06-23 through 2026-07-03: Homebrew, zsh, JDK 21, trufflehog-via-Homebrew, macOS/BSD `realpath -m` fixes) with zero Windows-specific activity in that span. No single record pins the exact switchover date between 06-21 (last known Windows) and 06-23 (first confirmed macOS-native PR, #227) — none is fabricated here.
>
> The harness now runs natively on macOS/darwin. The home-model decision (Windows-primary + Mac-available vs. effective migration) is resolved: effective migration, operationally macOS-primary as of ~2026-06-23. Windows-specific DIE items below are confirmed dead; RE-EVAL items below are reframed as concrete Mac-env follow-ups.

**Target (environment ready on schedule 2026-06-01; operational switch to macOS-primary completed ~2026-06-23)**: ~2026-06-01 to ~2026-06-07 (≤1 week from filing).
**Trigger**: Hardware migration off Windows + MSYS/Git-Bash environment to native macOS.

### Items that DIE with migration (no follow-up needed — confirmed dead, operational switch complete)

- **SSL/PKIX Windows-ROOT trust store workaround** — JVM trust chain mismatch resolved by `-Djavax.net.ssl.trustStoreType=Windows-ROOT` flag. Irrelevant on Mac (default keychain trust).
- **Backslash heredoc Windows path gap** (`SF-prep-19-A`) — MSYS Bash mangles `cat <<'EOF' > C:\Users\...\verdict.md`. Native macOS bash/zsh: no such issue.
- **MSYS path quirks** — `/c/` prefixes, cygdrive translation, `/tmp` vs `C:\Users\...\Temp` divergence. All gone on Mac.
- **.ps1 hooks** — never invoked outside PowerShell; prune from settings.json post-migration.

### Mac-env follow-ups (post-migration status, reframed from "RE-EVAL on Mac")

- Shell defaults — zsh is macOS default; verify all bats + shell hooks work under zsh quirks. **CONFIRMED**: current machine runs zsh as default shell; broader "all bats + shell hooks" zsh-quirk verification still open.
- Gradle truststore — likely zero-config on Mac (keychain trust); confirm by attempting one full build without flags. Still open — not yet re-verified.
- bats runner — confirm `scripts/tests/*.bats` execution under macOS bats-core (Homebrew install). **CONFIRMED** (`feedback_macos_build_toolchain.md`): L0 bats needs GNU userland on PATH (`~/.local/gnubin-l0`) — not zero-config out of the box.
- Xcode/iOS targets — newly available. L2 consumer projects can finally compile iOS/macOS targets. Schedule smoke-test wave once core toolchain verified. Still open — no smoke-test run yet; do not treat as confirmed.
- `~/.gradle/gradle.properties` — re-create empty on Mac (don't copy Windows-specific flags). Still open — not yet re-verified.

### Migration playbook reference

See conversation history (post BL-W47-prep-19, 2026-05-31) for full migration plan: fresh install + selective restore of `~/.claude/` user-level config + project clones + re-auth all credentials (no token copy).

## Long-term / no fixed order

- **L2 consumer product alignment** session — pricing drift, feature contradictions, dormant context-bridge — `project_dawsync_product_alignment.md`
- **Future agents** — D1 guardian for L2 web consumer, context-provider-as-internal-context7-agent — `project_future_agents.md`
- **Plugin v0.2.1** — triggered-only (10 @Disabled tests pending Maven Central v0.3.0) — `project_plugin_v0.2.1_status.md`
- **BL-W32-04** — CP zombie session start — active observation, no fix yet — `project_BL-W32-04_shipped.md`

## Shipped (recent)

- **phase-orchestration-restoration** (2026-07-08) — QG PASS (7/7 required steps; 3/3 arch VERIFY-FINAL HEAD-bound @ e5b836e; test-suite delta-honest 1793 ok / 71 pre-existing not-ok, 0 new, byte-identical across 2 independent runs; secret-scan trufflehog 3.95.8 clean). Pushed from `feature/phase-orchestration-restoration`; MERGED to develop `8aacc05` (PR #237, squash). CLASS **DOC** (Codex-ratified vs plan's HARNESS): surgical docs/agents wording reconciliation (phase-loop/class-awareness already ~90% shipped by Waves 1-2) plus a no-forged-verdict rule and a Wave 2 Shipped-entry backfill; HARNESS mechanization deferred to BL-W4-10. Codex GO after a NO-GO fix round (arch-dispatch-modes READY wording, converged w/ CodeRabbit). — `project_wave_phase_orchestration_restoration_shipped.md`
- **portable-coordination-artifacts** (2026-07-07) — QG PASS (3/3 arch VERIFY-FINAL HEAD-bound; bats 52/52; push-proof + quality-gate-report minted). Pushed from `feature/portable-coordination-artifacts`; MERGED to develop `68ed036` (PR #236). Implemented the ADR-001 disk-inbox portable coordination layer: 6 typed schemas (consult/message/result/request/approval/stop v1) with `.claude/hooks/coordination-artifact.js` validator + `scripts/sh/write-coordination-artifact.sh` writer + `docs/agents/coordination-artifact-schema.md`; additive fail-closed CP-gate disk-consult. Codex GO after a NO-GO fix round. — `project_wave_portable_coordination_artifacts_shipped.md`
- **runtime-topology-contract-realignment** (2026-07-06) — QG PASS (5 QG cycles / 0 bypass; Codex GO; CI 24/24 green). Pushed from `feature/runtime-topology-contract-realignment`; MERGED to develop `125409b` (PR #235, final branch HEAD `6dc4649`). Realigned 11 orchestration docs/agents to one coherent portable-floor + Claude-accelerator model — the portable disk-first floor is authoritative; SendMessage / background-peers are optional accelerators. — `project_wave_runtime_topology_contract_realignment_shipped.md`
- **live-tree-write-bats-hygiene** (2026-07-03) — QG PASS (push-proof.json + verify-proof green @ cebd169; Phase-B closeout re-minted at final HEAD; full Bats 1676 ok / 71 pre-existing local-env not-ok = 0 new; targeted manifest-sha-parity.bats 5/5; mcp-server node 2602/2602; secret-scan/registry-hash/doc-validators PASS). Pushed from `feature/live-tree-write-bats-hygiene`; MERGED to develop `4aac9ef` (final branch HEAD `cebd169`). Isolates the manifest-sha-parity.bats "dirty template" test to a mktemp temp copy — live tracked template never mutated, git-checkout revert removed (load-bearing under set -e) — plus a whole-worktree hygiene regression; targeted 5/5 green. Copilot-parity live-tree-write half already resolved — PR #228. — `project_wave_live_tree_write_bats_hygiene_shipped.md`
- **runtime-topology-disk-first-binding** (2026-07-03) — QG PASS (`push-proof.json` + `verify-proof` green; the `qg-result.json` mechanical fail on the 71 pre-existing **local-env** Bats failures is an accepted harness-gap — `emit-qg-result.sh` has no delta-honest mode — with **0 new** wave-caused failures, CI-green on parent `f6c78bd` PR #231). Pushed from `feature/runtime-topology-disk-first-binding`; MERGED to develop `f301486` (final branch HEAD `4818ed6`). Closes the specialist↔architect binding failure class (`project_specialist_architect_binding_enforcement_queued`): new `scripts/sh/write-specialist-dispatch.sh` (dispatch-artifact writer — JSON, HEAD + PLAN-sha256 bound, out-of-repo `--file` rejected, `doc-updater` rejected, `--bash-only`); `write-verdict.sh` PREP now emits `**PREP-HEAD**`+`**PLAN_SHA256**` (fail-closed on missing PLAN); `premature-execution-gate.js` = ancestry-bound (`git merge-base --is-ancestor`) PREP+dispatch currency + `files[]`-union scope + out-of-repo block (up-front + ignore out-of-repo entries) + `doc-updater` PREP-only exemption; new `docs/agents/specialist-dispatch-protocol.md`. 3 architects VERIFY-FINAL. Review-driven fixes: F1 ancestry (architect PREP catch), Codex P1/P2 + the out-of-repo escape closure. Real trufflehog 3.95.8 secret-scan PASS. — `project_wave_runtime_topology_disk_first_binding_shipped.md`
For full wave history: `git log` + memory `project_*shipped.md` files.

## How to use this document

1. **Starting a session**: pick the topmost active wave; review the linked source memory files for detailed context.
2. **Wave brief**: write `.planning/wave-bl-w{N}-prompt.md` modeled after `.planning/wave-bl-w34-l1-security-prep-prompt.md` (gitignored — local).
3. **On wave completion**: doc-updater moves entry to `## Shipped (recent)`, prunes oldest if section >5 waves, commits via PR.
4. **Adding new items**: append to active waves or create new wave entry; preserve priority order rationale.
5. **Cross-references**: every active wave row links to a memory file with full context. If memory entry is missing, file before starting that wave.
