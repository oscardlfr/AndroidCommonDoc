# AndroidCommonDoc Backlog

> **Last updated**: 2026-06-22; qg-report-freshness C0: corrected qg-suite-completeness shipped row (MERGED @ 8f65831)
> **Source of truth**: this file is the ordered index. Detailed entries live in `git log` + `~/.claude/projects/.../memory/` (`project_*shipped.md`, `project_*backlog.md`).
> **Update protocol**: when a wave ships, move entry to `## Shipped (recent)`. New items appended in priority order under `## Active`.

## Active (proposed wave order)

### Agent-teams completion-message delivery unreliable (HIGH — harness reliability) — user-flagged 2026-06-16

**Symptom**: peers (esp. **quality-gater**) finish their work but the completion message (QG-PASS, READY-FOR-REVIEW, EXECUTE-COMPLETE) does NOT reach the orchestrator → it hangs waiting indefinitely. Recurring across sessions (user: "2 días que el quality gate no responde cuando termina, no podemos seguir así"). Same delivery class seen mid-session bl-w47-expr4: a dispatch "never reached toolkit-specialist's inbox" (routing gap); planner idle-loops; quality-gater re-QG ran 25+ min with no notification while the `quality-gate.stamp` stayed at the prior HEAD.

**Root cause**: the experimental `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` primitive has documented limitations around task coordination / notification delivery (audit A2 #4 — "known limitations"). T3 message delivery is not a reliable carrier of load-bearing results. **Structural root cause identified (bl-w47-tail):** `TeamCreate`/`TeamDelete`/`TeamList` no longer exist in this Claude Code build — the named-team coordination substrate the peers and gates were built on is obsolete (single implicit team now). See the "Team-model migration" root-fix entry directly below.

**Operational mitigation (apply NOW, no code)**: the orchestrator MUST NOT wait on completion MESSAGES for load-bearing verdicts. Read the result from the T2 disk artifact — `quality-gate.stamp` (HEAD-bound), commit SHAs (`git log`), `arch-*-verdict.md`, `qg-path-audit` exit code — and poke the peer via SendMessage for detail. This is the A0/T2 doctrine (invariants live in files, not messages) — fitting, since ex-PR4 is itself a harness-reliability wave.

**Root fix (this item)**: (a) QG emits a structured `.planning/wave-<slug>/qg-result.json` the orchestrator polls (decouple verdict from message delivery); (b) repro + report the agent-teams notification drop upstream, or add a heartbeat/ack; (c) session-health check that flags peers idle >N min whose on-disk artifact shows completed work.

**Status (2026-06-21)**: (a) poll-able `qg-result.json` verdict + (c) heartbeat/session-health recovery SHIPPED in `qg-reliability-root-fix` (orchestrator reads the verdict from disk, NOT the completion message — demonstrated live). Remaining: (b) repro/report the upstream agent-teams notification drop. That wave's QG verification also surfaced a partial-run-detection gap → resolved in `qg-suite-completeness`.

**Source**: user-flagged 2026-06-16 during bl-w47-expr4.

**Source**: discovered 2026-06-16 during bl-w47-tail orchestration init; user-directed to backlog the root-fix.

### run-bats.sh default glob fails on Windows (LOW — harness portability) — surfaced 2026-06-21

run-bats.sh's default `"$ROOT"/scripts/tests/*.bats` glob expands to 88 file args → "command line too long" on Windows. Workaround used by the QG: pass the directory arg (`bash run-bats.sh scripts/tests`). Fix: default to the directory (bats expands internally); verify CI-parity (directory == top-level glob == same 1645 set) before cutover.

**Source**: surfaced during qg-suite-completeness QG (2026-06-21).

### quality-gater report-finalize carries stale step-reason values (MED — QG report reliability) — surfaced 2026-06-21

The formal QG's first run (@ e351c92) emitted qg-result.json `steps[]` reasons with STALE carried predecessor values (bats 745, vitest 2593, HEAD 6004d00, 25-entry manifest, 14 commits), internally inconsistent (node-verify "vitest PASS" while the vitest step FAILED). Verdict still sound (fresh handoff + vitest step authoritative); the re-run @ 22e3d3f was fresh only after an explicit instruction. Root-fix: report-writing must populate every step reason from THIS run's output, never carry. (quality-gater.md template = separate wave.)

**Source**: surfaced during qg-suite-completeness QG (2026-06-21).

### Installer sourcing-shim for wave-slug resolver (MED — harness, ~1-2h) — deferred 2026-06-16

The L0 installer/setup does not wire `scripts/sh/lib/wave-slug.sh` (the validated `get_wave_slug` resolver — allowlist `^[A-Za-z0-9._-]+$`, rejects empty/`.`/`..`/slash-backslash traversal) into bash-layer consumers' sourcing path. The resolver exists but consumers re-inline their own slug extraction logic; a sourcing-shim in the installer would prevent per-consumer divergence and keep the validation logic canonical.

**Constraint**: any tmp-file or path referenced by the shim MUST use explicit `$HOME` (not implicit `~`) for portability across environments.

**Source**: deferred from BL-W47-expr4 slug-validation work (2026-06-16).

### Team-completeness-gate grace-clock reset with explicit HOME (MED — harness, ~1h) — deferred 2026-06-16

The team-completeness-gate's 30-min grace clock (tmp-file timestamp that gates floor enforcement after spawn) needs a defined reset trigger (e.g., on wave start) and its tmp-file path must use **explicit `$HOME`** (not implicit `~`), for portability across shell environments and tool invocations that may not expand `~` consistently.

**Source**: deferred from BL-W47-expr4 (2026-06-16).

### Centralize duplicated JS hook helpers (MED — hooks, ~2h) — deferred 2026-06-16

The helpers `isValidSlug`, `getWaveSlug`, `resolveFloorPeers`, and `loadYaml` are duplicated across the 3 JS hooks (`premature-execution-gate.js`, `team-completeness-gate.js`, `team-topology-gate.js`). Extract into a shared module (e.g. `scripts/sh/lib/hook-utils.js` or `.claude/hooks/lib/`) so changes to slug validation or floor resolution only need to happen in one place. CodeRabbit nitpick; deferred per user.

**Source**: CodeRabbit audit during BL-W47-expr4 CodeRabbit review (2026-06-16).

### Team stale-suffix spawn guard (MED — hook, ~2-3h) — filed 2026-06-07

Hook to **BLOCK** spawning any core session role (team-lead, arch-platform/integration/testing, context-provider, doc-updater, quality-gater, planner, specialists) with a `-2`/`-N` numeric suffix. A suffixed spawn means the canonical name is occupied by a stale/dead peer (stale team dir) → **inter-peer messages misroute to the DEAD original** (gate-acks, consults, dispatches silently lost). The hook should block the spawn and direct the operator to clean `~/.claude/teams/session-{slug}/` first (the work-skill stale-dir check) so the respawn takes the canonical name.

**Trigger**: Kotlin 2.4.0 session, post-reboot (2026-06-07) — respawned `context-provider` + `quality-gater` collided with the dead originals → `context-provider-2` / `quality-gater-2` → broken messaging (user-observed live). The work-skill's manual stale-dir cleanup is easy to skip; make it a mechanical block. Relates to Wave 39 session-teardown hook + memory `feedback_stale_team_suffix_collision`.

**Source**: filed by user 2026-06-07.

### BL-W49-committed-manifest-parity — agents.manifest.yaml committed-frontmatter-sha parity (MED — harness) — filed 2026-06-20

**Context**: `qg-committed-integrity` (this wave) enforces committed-tree integrity for `skills/registry.json` via `qg-registry-integrity.sh`. A sibling gap exists for `.claude/registry/agents.manifest.yaml`: CI already BLOCKs on `manifest-drift-warn` (template frontmatter SHA parity), but local QG has no committed-tree enforcement equivalent. If an agent template is edited and the manifest SHA is not updated + committed, CI blocks but local QG does not.

**Scope**: add committed-tree enforcement for `agents.manifest.yaml` `template_frontmatter_sha256` fields at the local QG mint level (analogous to the registry check added this wave). The CI check (`manifest-drift-warn`) already exists; this is the local-side mechanization.

**Deferred**: user-consented deferral during `qg-committed-integrity` planning. The CI gate already prevents broken pushes; the local-QG gap is lower severity than the registry gap was.

**Source**: Phase-0 classification in `qg-committed-integrity` PLAN.md (2026-06-20). Tracking ID: `BL-W49-committed-manifest-parity`.

### `rtk` command-prefix contract for agent-template shell snippets (MED — harness/templates) — filed 2026-06-20

**Problem**: CLAUDE.md mandates "agent templates MUST prefix all git/gh/docker/curl commands with `rtk`", but several bash blocks in `quality-gater.md` (both copies — `setup/agent-templates/` + `.claude/agents/`) use bare `git` at lines 92, 206-209, 224, 308-310 (`git diff`, `git rev-parse`, `git merge-base`). Pre-existing on develop; not introduced by qg-doc-coverage. The same gap is likely present in other templates/docs with shell snippets.

**Scope**: (1) audit `quality-gater.md` (both copies) at the known lines; (2) audit ALL other agent templates + docs with shell snippets for the same gap; (3) DECIDE a portable contract — `rtk` mandatory in exportable templates, OR "use rtk when available, fallback to the raw command" (consumer projects may not have rtk installed); (4) if mandatory, add a mechanical guard/test so the contract is enforced (not reliant on CodeRabbit or manual review); (5) NO partial opportunistic patch — design the contract first, then apply uniformly.

**Trigger**: next agent-template maintenance wave or harness wave; the decision step (3) may be a fast standalone session.

**Source**: CodeRabbit on PR #221 (out-of-scope, pre-existing on develop — deferred per user direction 2026-06-20). Tracking ID: `BL-W49-rtk-command-prefix-contract`.

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

- **BL-W47-PREPR-2** (MED) — quality-gater secret-scan capability gap: quality-gater lacks `mcp__androidcommondoc__scan-secrets` tool; its secret-scan relies on `bash trufflehog` (absent on Windows host), fudged SKIP→PASS this wave. Root fix: give quality-gater canonical secret-scan capability (MCP scanner) OR honest fail-closed on absence; reconcile `/pre-pr` Step-5.6 `SKIPPED=INFO` semantics with the QG manifest's required-`PASS` semantics for the `secret-scan` step.

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

- **qg-suite-completeness** (2026-06-21) — Closed the QG partial-run false-green: 4-part bats completeness metric (run-bats.sh asserts exactly-one `1..N` plan + `(ok+not_ok)==N` + no Executed-warning, keeping ok>0/not_ok==0) [Finding B] + run-id-bound run-bats→emit handoff with HEAD+run_id+generated_at validation, fallback fail-closed [Finding A] + CI inline parity (ci-bats-parity.bats). Empirical: bats 1645/0 (== --count == plan), vitest 2593, 11-path manifest. MERGED @ 8f65831 (squash PR #224); CI 25/25 + CodeRabbit/Codex clean. Follow-ups: run-bats.sh Windows-glob + QG report-finalize staleness. — `project_wave_qg_suite_completeness_shipped.md`
- **qg-reliability-root-fix** (2026-06-21) — Made the QG RELIABLE: verdict load-bearing in a polled disk artifact `.planning/wave-<slug>/qg-result.json` (orchestrator reads PASS/FAIL from disk, NEVER the completion message — demonstrated live) + status/updated_at heartbeat (--init/--phase before each long step) so a hung quality-gater is detectable → TaskStop + lean re-dispatch (not a multi-day hang). New `scripts/sh/run-bats.sh` makes `grep -c "^not ok"` AUTHORITATIVE (npx bats exits 0 even with not-ok) + reused in CI (local-green⇒CI-green); lean quality-gater (suites→logs, no context-bloat stall). quality-gater 2.20.0 (5-pata). GUARDRAIL held: qg-result.json (gitignored) does NOT trip the #222 clean-tree gate, NOT consumed by verify-proof/pre-push, NOT a push-proof step. 2 review rounds caught 4 real bugs (node-verify false-green, run-bats/CI ok_ct==0 parity, heartbeat-once, node-verify subdir-package.json log-path false-red). RUN VERIFIED: full bats (1631) 0 not-ok + verify-proof PASS + MERGED @ c9eab29 (PR #223), CI 25/25 + CodeRabbit clean. Follow-ups: full-suite-ran assertion (HIGH) + count observability (MED). — `project_wave_qg_reliability_root_fix_shipped.md`
- **qg-committed-integrity** (2026-06-21) — Committed-tree registry integrity mechanized at the QG mint (#222 @ `3ac0c60`): shared `qg-registry-integrity.sh` (run-qg + CI skill-registry job ⇒ local-green⇒CI-green by construction) + clean-tree assertion (allowlist `^.claude/wave-quality-gates/`) + `--require-registry` strict mode + registry digest in push-proof `artifact_digests`; the previously-declared `registry-hash` step is now REAL (quality-gater 2.19.0, 5-pata). CI green first push; 4-QG cascade caught 3 real bugs. — `project_wave_qg_committed_integrity_shipped.md`
- **qg-doc-coverage** (2026-06-20) — Local QG runs the EXACT CI doc-validators via shared `qg-doc-validators.sh` (cross_refs + doc_structure_vitest) as a REQUIRED `doc-validator-parity` step ⇒ local-green⇒CI-green for docs (#221 @ `7fb802b`; closes the prior doc-frontmatter/size-limit coverage gap). quality-gater 2.18.0; regression vitest + bats #DV1-11. — `project_wave_qg_doc_coverage_shipped.md`
- **runtime-adapter-capability-matrix** (2026-06-19) — Engine-agnostic runtime adapter contract over the disk-artifact floor (follow-up to bl-w48). ADR-001 (first repo ADR) defines the three-concept distinction (portable orchestrator/`team-lead` ROLE · obsolete `TeamCreate`/`team_name` PRIMITIVE · preservable background-peer/`SendMessage`/operator-visibility CAPABILITIES), a three-bucket classification rubric (`portable-role` / `Claude-legacy-runtime` / `adapter-specific-capability`), and a per-engine capability matrix (Claude / Codex / Copilot / Future × spawn / send / status / result / stop / artifact) with graceful degradation. 10 `docs/agents/*` protocol docs reframed per the rubric; `capability-preservation.bats` (C1–C7) anti-degradation guard added (multi-agent stays an optional accelerator, never least-common-denominator); `docs/adr/README.md` ADR index; `.claude/commands/work.md` + `skills/registry.json` aligned; three-phase vitest repinned. bl-w48 carried residuals resolved-by-classification (role/`SendMessage` refs = keep-as-is) + peer-control findings homed in `project_peer_control_plane_findings.md`. — `project_runtime_adapter_shipped.md`

For full wave history: `git log` + memory `project_*shipped.md` files.

## How to use this document

1. **Starting a session**: pick the topmost active wave; review the linked source memory files for detailed context.
2. **Wave brief**: write `.planning/wave-bl-w{N}-prompt.md` modeled after `.planning/wave-bl-w34-l1-security-prep-prompt.md` (gitignored — local).
3. **On wave completion**: doc-updater moves entry to `## Shipped (recent)`, prunes oldest if section >5 waves, commits via PR.
4. **Adding new items**: append to active waves or create new wave entry; preserve priority order rationale.
5. **Cross-references**: every active wave row links to a memory file with full context. If memory entry is missing, file before starting that wave.
