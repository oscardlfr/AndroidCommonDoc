# AndroidCommonDoc Backlog

> **Last updated**: 2026-06-24; H2 hook/control-plane hardening shipped/merged via PR #230; RTK template sweep remains deferred pending separate approval
> **Source of truth**: this file is the ordered index. Detailed entries live in `git log` + `~/.claude/projects/.../memory/` (`project_*shipped.md`, `project_*backlog.md`).
> **Update protocol**: when a wave ships, move entry to `## Shipped (recent)`. New items appended in priority order under `## Active`.

## Active (proposed wave order)

### Agent-teams upstream notification delivery report (LOW/MED — upstream/runtime)

The in-repo root fix for unreliable quality-gater completion messages is already shipped: poll-able `qg-result.json` + heartbeat/session-health recovery. Remaining work is an upstream repro/report for the experimental agent-teams notification drop. This is **not** a blocker for the QG harness and should not drive another local harness wave unless a new in-repo failure appears.

### Live-tree-write bats hygiene (LOW/MED — pre-existing, recurring bug class; user-consented 2026-07-03)

Two bats files inject content into LIVE tracked files and don't always clean up on interrupted runs → a dirty tree that can trip clean-tree / manifest-sha / template-sync gates at the next QG:
- `scripts/tests/manifest-sha-parity.bats:125` injects `# dirty-sentinel-bats-test` into `setup/agent-templates/toolkit-specialist.md` (found + reverted during the runtime-topology-disk-first-binding QG).
- `scripts/tests/copilot-parity.bats` writes an orphan template into `setup/copilot-templates/` (already tracked as `project_bl_copilot_parity_live_tree_write`).

Fix = route both through temp-project fixtures + `trap`-cleanup (same shape as the H1 copilot-parity fix). Deliberately NOT fixed in the disk-first wave (out of scope). Consolidate with `project_bl_copilot_parity_live_tree_write` when scheduled.

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

### Wave BL-W47 — Adaptive Harness Redesign (meta plan) — CORE SHIPPED 2026-06-16

Core goal of all BL-W47-prep-X waves. Redesigns the wave harness for resilience, mechanical enforcement, and self-improvement. Full plan at `.planning/BL-W47-PLAN-v2.md` (v2 supersedes v1).

**Status (post bl-w47-tail closeout)**: core sequence SHIPPED across S1–S6 + tail (cleanup+0a → 0b+rotation-docs → bundles → 0c → floors → tail) plus inserted follow-ups (supersede, prepr-proof). Final closeout (bl-w47-tail) = registry drift hotfix + Terminal L1/L2 sync + Wave-Close + Ex-PR1 Q&A.

**Deferred to follow-on waves (user-consented 2026-06-16)**:
- **Ex-PR6 — HOLD ack-checkpoint**: blocked on OQ10 (checkpoint-density decision); own wave.
- **Topology Pilot — subagent-first wave class**: deserves its own *measured* wave (peer-team vs subagent-first comparison); DO-ON-MAC preferred. NOT the same as bl-w47-tail's runtime-necessity subagent adaptation.
- **Council design implementation**: explicitly next-iteration (user's sole deferral, Gate record item 4).
- **D9** (LOW) — `validate-doc-update` perf: avg 160s/call; MCP perf issue, not harness-critical; owner: doc-updater domain.
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

## Platform Shift (MacBook Pro M5 Max migration) — STALE (date passed; home model UNDECIDED)

> ⚠️ **STALE (flagged 2026-06-21)**: the ~2026-06-07 target passed — the harness still runs on **Windows/win32** today. macOS is *available* for ad-hoc tasks, **but the switch is NOT decided**: the real model — *Windows-primary + Mac-available* **vs** an *effective migration* — is open. Do NOT read items below as "abandoned" or "still planned".
>
> **Follow-up (filed 2026-06-21, owner: user)**: decide the harness home model before acting on any item in this section. No mass re-home of Windows-specific items until that decision (deliberately out of scope for the `qg-reliability-root-fix` wave).

**Target (original, NOT met)**: ~2026-06-01 to ~2026-06-07 (≤1 week from filing).
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

- **runtime-topology-disk-first-binding** (2026-07-03) — QG PASS (`push-proof.json` + `verify-proof` green; the `qg-result.json` mechanical fail on the 71 pre-existing **local-env** Bats failures is an accepted harness-gap — `emit-qg-result.sh` has no delta-honest mode — with **0 new** wave-caused failures, CI-green on parent `f6c78bd` PR #231). Pushed from `feature/runtime-topology-disk-first-binding`; pending review/merge. Closes the specialist↔architect binding failure class (`project_specialist_architect_binding_enforcement_queued`): new `scripts/sh/write-specialist-dispatch.sh` (dispatch-artifact writer — JSON, HEAD + PLAN-sha256 bound, out-of-repo `--file` rejected, `doc-updater` rejected, `--bash-only`); `write-verdict.sh` PREP now emits `**PREP-HEAD**`+`**PLAN_SHA256**` (fail-closed on missing PLAN); `premature-execution-gate.js` = ancestry-bound (`git merge-base --is-ancestor`) PREP+dispatch currency + `files[]`-union scope + out-of-repo block (up-front + ignore out-of-repo entries) + `doc-updater` PREP-only exemption; new `docs/agents/specialist-dispatch-protocol.md`. 3 architects VERIFY-FINAL. Review-driven fixes: F1 ancestry (architect PREP catch), Codex P1/P2 + the out-of-repo escape closure. Real trufflehog 3.95.8 secret-scan PASS. — `project_wave_runtime_topology_disk_first_binding_parked.md` (→ shipped-memory on merge)
- **hook-control-plane-hardening** (2026-06-24) — MERGED @ `0748285` (squash PR #230; branch final HEAD `4a3d10f`). Closed H2 control-plane residue: explicit architect verdict/cross-verify path contract (`arch-*-verdict.md` / `arch-*-cross-verify.md`), shared CommonJS hook helper for slug/YAML utilities, bash `wave-slug.sh` resolver sourcing in verdict/bundle writers, git-hook installer copying `.git/hooks/lib/wave-slug.sh`, retired `team-completeness-gate` tombstone pinned no-op/no grace-clock writes, hook manifest/docs drift updated, and stale suffixed persistent control-plane spawns blocked while legitimate specialist overflow remains allowed. Fix-forward: `agent-spawn-validator` block JSON now exits from the stdout write callback before exit 2. Regression: targeted hook suite 28/28, full Bats 1702/1702, qg-path-audit/doc validators/registry integrity/secret scan, 3 architects VERIFY-FINAL, formal QG + verify-proof. CI 24/24 + CodeRabbit SUCCESS + Codex clean. Deferred deliberately: RTK template/registry sweep requires separate STOP, manifest, template ceremony, and approval. — `project_wave_hook_control_plane_hardening_shipped.md`
- **harness-test-runner-hygiene** (2026-06-24) — MERGED @ `2a852b2` (squash PR #228; branch final HEAD `e248874b`). Closed H1 test-runner hygiene bundle: `run-bats.sh` now defaults to the `scripts/tests` directory target while preserving `1..N` + `ok+not_ok==N` completeness and proving explicit glob == directory == CI count (`1688`); CI workflows/docs use the directory target with no second fragile glob path; `copilot-parity --project-root <temp> --fix` routes through `copilot-adapter.sh --project-root`, cleans temp, and leaves live `setup/copilot-templates/` untouched; adapter now validates missing/flag-valued `--project-root`; `wave-phase-gate.js` rejects explicit env slugs (`develop`/`master`/`main`/`HEAD`) without branch fallback. Regression: WPG env-reject 2/2, targeted wrapper 53/53, full Bats 1688/1688, MCP vitest/lint, secret scan, path audit. GitHub exposed 24/24 green check contexts + CodeRabbit clean + Codex clean. — `project_wave_harness_test_runner_hygiene_shipped.md`
- **qg-local-ci-security-closure** (2026-06-23) — MERGED @ `2725eeb` (squash PR #227; QG-HEAD `3da7395`). Closed H1 local-CI/security parity bundle: local QG now blocks agent-template size drift via inline `emit-push-proof.sh`/`.ps1` template-size gate; `/pre-pr`/MCP `scan-secrets` now fail-closes present scanner errors, malformed JSONL, empty/non-JSON, and CRITICAL/HIGH findings (`SCANNER_ERROR` / `SECRETS_FOUND`); committed manifest parity proved composed by existing clean-tree + manifest-sha bats. Regression coverage: TSZ-1..9, SSS-1..4, `scan-secrets.test.ts` 16/16 with `vi.mock(runScript)`. CI 25/25 + CodeRabbit clean + Codex clean. Deferred deliberately: run-bats Windows default glob and copilot-parity live-tree-write isolation. — `project_wave_qg_local_ci_security_closure_shipped.md`
- **qg-proof-honesty-hardening** (2026-06-22) — MERGED @ `58d9465` (squash PR #226). Closed two P1 proof-honesty defects. Fix A: hardened `scripts/sh/qg-path-audit.sh` Path-Manifest parser (anchored `### Path-Manifest` header, multi-boundary terminators incl. `## ` H2 + bold-Excluded + end-marker, counts only literal `- path` bullets with an alphanumeric so prose/`**bold**`/`---`/Excluded-section bullets no longer inflate the allow-list, exit-2 fail-closed on missing header). Fix B: new fail-closed `scripts/sh/secret-scan-report.sh` producer (deterministic trufflehog resolution; absent/erroring scanner → FAIL + reason_code, NEVER PASS/SKIPPED; explicit exit-code capture) wired as quality-gater **Step S (REQUIRED, pre-mint, 2.22.0)** with a 3-part wiring guard (both-twins static contract + emit-push-proof E2E); closes the secret-scan portion of BL-W47-PREPR-2. Regression: qg-path-audit PA-6+, secret-scan-report.bats, emit-push-proof guard. — `project_wave_qg_proof_honesty_hardening_shipped.md`
- **qg-report-freshness** (2026-06-22) — Made QG report step-reason freshness MECHANICAL. New `scripts/sh/lib/qg-report-freshness.sh` (3 fail-closed, false-positive-safe invariants: foreign-HEAD-context SHA, bats-context count, PASS-semantics on FAIL step) + `emit-qg-result.sh` `--init` resets the report scratch + a final-mode BLOCKING freshness check (status:fail on stale) + structured **CARRIED** metadata (`carried`/`source_head`/`current_head`/`files[]`, git-verified byte-identical, hardened paths). Pre-mint **Step Z** gate (exit-code only; canonical bash in `docs/agents/quality-gater-freshness-gate.md` + hub row; NOT a `required_steps[]` entry — `quality-gate-manifest.json`/`emit-push-proof.sh` untouched). Regression `#QR13–QR21` + `#QR6/#QR7` reorder fix (C1 `--init` interaction). quality-gater **2.21.0** (5-pata). — MERGED @ `533bdce` (squash PR #225) — `project_wave_qg_report_freshness_shipped.md`
For full wave history: `git log` + memory `project_*shipped.md` files.

## How to use this document

1. **Starting a session**: pick the topmost active wave; review the linked source memory files for detailed context.
2. **Wave brief**: write `.planning/wave-bl-w{N}-prompt.md` modeled after `.planning/wave-bl-w34-l1-security-prep-prompt.md` (gitignored — local).
3. **On wave completion**: doc-updater moves entry to `## Shipped (recent)`, prunes oldest if section >5 waves, commits via PR.
4. **Adding new items**: append to active waves or create new wave entry; preserve priority order rationale.
5. **Cross-references**: every active wave row links to a memory file with full context. If memory entry is missing, file before starting that wave.
