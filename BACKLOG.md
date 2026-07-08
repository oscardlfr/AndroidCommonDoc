# AndroidCommonDoc Backlog

> **Last updated**: 2026-07-09; Harness Realignment Waves 0-3 (#234 `0bbf6fa`, #235 `125409b`, #236 `68ed036`, #237 `8aacc05`) and Wave 4 (QG/macOS/Local-CI Parity Hardening, #238 `30de240`) are all MERGED to develop; **Wave 5 — Portable Ingestion + Wave 38 Content is the active wave**; RTK template sweep remains deferred pending separate approval
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
- **Wave 4 — QG/macOS/Local-CI Parity Hardening** (MERGED to develop `30de240`, PR #238 — see `## Shipped (recent)`) — make local QG on this Mac honest and reproducible without ad hoc per-wave explanations.
- **Wave 5 — Portable Ingestion + Wave 38 Content** (**ACTIVE WAVE** — DOC) — make the ingestion loop portable, then process the deferred Wave 38 content (below) through the corrected loop.
- **Wave 6 (optional) — Topology Pilot** (DOC or HARNESS depending on outcome) — measure when Claude-rich background peers are worth using versus single-use/disk-only execution.

**Sequencing**: Waves 0-4 are MERGED; **Wave 5 — Portable Ingestion + Wave 38 Content is the current active wave**. After Wave 5, Wave 6 (optional — Topology Pilot) may follow. This wave completes the recommended minimum Waves 0-5; Wave 6 is optional hardening after Wave 5.

**Source**: `.planning/harness-realignment-deep-audit-plan.md` (local, gitignored).

### Realignment follow-ups (Wave 4 — QG/macOS parity)

Specific findings enumerated in `.planning/harness-realignment-deep-audit-plan.md` (Wave 0 scope block) to be addressed under Wave 4 — QG/macOS/Local-CI Parity Hardening, above:

- **BL-W4-1** (OPEN, 2026-07-04) — qg-path-audit Class-parser anchoring: `qg-path-audit.sh` extracts the first bold `**Class**:` marker anywhere in `PLAN.md`, not the one under `### Wave Class`; can false-fail detailed plans. **RESOLVED — Wave 4 MERGED `30de240` (PR #238).**
- **BL-W4-2** (OPEN, 2026-07-04) — qg-doc-validators `ANDROID_COMMON_DOC` propagation: `qg-doc-validators.sh` accepts `--toolkit-root` but does not export `ANDROID_COMMON_DOC` to the vitest subprocess; structure check fails without the env var exported even when `--toolkit-root` is passed. **RESOLVED — Wave 4 MERGED `30de240` (PR #238).**
- **BL-W4-3** (OPEN, 2026-07-04) — validate-agent-templates Bash 3.2 policy: macOS ships Bash 3.2 by default; `validate-agent-templates.sh --check tool-body-xref` fails on `declare -A TOOL_PATTERNS` (`TeamCreate: unbound variable`) — needs an explicit compatibility policy (portable Bash 3.2 rewrite, or a fail-closed probe that routes to modern bash without silent skip). **RESOLVED — Wave 4 MERGED `30de240` (PR #238).**
- **BL-W4-4** (OPEN, 2026-07-04) — qg-result delta-honest semantics: tighten what "0-new" / accepted-harness-gap means for `qg-result.json` `status:fail` outcomes so local pre-existing failures don't require a manual per-wave explanation. **RESOLVED — Wave 4 MERGED `30de240` (PR #238).** — `emit-qg-result.sh` manifest-membership code fix (required-steps lookup now sourced from `quality-gate-manifest.json`'s `required_steps[].id` instead of a per-step `required` default, closing the conditional-SKIP-flips-fail false negative) + `docs/agents/qg-proof-push-gate.md` doc-contract clarification (qg-result.json MAY still read `fail` in a degraded local/macOS env; `push-proof.json`/`verify-proof`/two-stamp gate remain sole push authority regardless).
- **BL-W4-5** (AUDITED — NOT A BUG, 2026-07-04) — `.androidcommondoc/bats-result.*.env` collision: audited as a non-issue — producer names are unique per run, the consumer validates HEAD + started_at + max, and both rejection paths are tested. Originally flagged as a "multi-agent handoff collision risk" in `project_wave_live_tree_write_bats_hygiene_shipped.md`. Two optional LOW-severity hardening notes recorded as non-blocking.
- **BL-W4-6** (OPEN, 2026-07-04) — validate-doc-update root-target confinement: for root-level markdown such as `BACKLOG.md`, docsRoot resolution can walk up to `/` and duplicate detection may traverse the whole filesystem / trigger permission prompts / hang. Fix by rejecting or fast-pathing non-docs targets, bounding the duplicate scan to the project `docs/` root, and adding a regression proving `BACKLOG.md` returns quickly without scanning `/`. (Concrete cause found this wave; refines D9.) **RESOLVED — Wave 4 MERGED `30de240` (PR #238).** — this very BACKLOG.md edit is still routed around the running (pre-fix) MCP server instance rather than through it, since the fix isn't live in-process yet.
- **BL-W4-7** (OPEN, 2026-07-07) — qg-path-audit current-wave sentinel auto-recognition: `qg-path-audit.sh` should auto-recognize a wave's own `.claude/wave-quality-gates/<slug>.md` sentinel (mirror the clean-tree exemption) so future waves don't each declare it as a Path-Manifest bullet — candidate HARNESS wave; supersedes the per-wave Path-Manifest workaround used in Waves 1 and 2. **RESOLVED — Wave 4 MERGED `30de240` (PR #238).**
- **BL-W4-8** (OPEN, 2026-07-07) — bats-test-authoring hygiene (3 items): (a) stale line cite in `arch-dispatch-modes.md` (`premature-execution-gate.js:77` → ~144); (b) `capability-preservation.bats` C7.3 named "tl-* doc" but greps bare `docs/agents/`; (c) `named-team-regression-guard.bats` bare-`.planning/PLAN.md` negation matches literal "never" only, not "Do NOT".
- **BL-W4-9** (OPEN, 2026-07-07) — Harden `write-specialist-dispatch.sh:345` confinement prefix check: the `.planning*` bare-glob matches a sibling like `.planning-evil`; needs a trailing-separator / exact-match guard, mirroring the `write-coordination-artifact.sh` fix. Low-severity (only reachable via a symlink planted inside `.planning/`, already a trusted write surface). Surfaced by the Wave 2 Codex-round security re-review. **RESOLVED — Wave 4 MERGED `30de240` (PR #238).** — `write-verdict.sh` sibling also hardened with the same trailing-separator/exact-match guard.
- **BL-W4-10** (OPEN, 2026-07-07) — Class-aware phase mechanization gap: the `.claude/hooks/*.js` control plane is class-blind (HARNESS/DOC/FAST-PATH lives only in prose + `wave-topology.yaml`/`resolve-required-roles.js`/`qg-path-audit.sh`, never in a hook); no `SessionStart` hook; `wave-topology.yaml phase_gates` has only 2 booleans with no PREP→dispatch→VERIFY-FINAL state machine; `quality-gate-manifest.json` `architect-deliberation.required_roles` hardcodes the 3 architects (over-blocks DOC/FAST-PATH waves declaring fewer). This is the deep-audit-plan's original Wave-3 HARNESS mechanization idea, deferred (Wave 3 shipped DOC — docs/agents wording reconciliation only). Route to Wave 4 or a dedicated HARNESS wave.
- **BL-W4-11** (OPEN, 2026-07-07) — README + skills fixed-roster drift: `README.md:36,657,659`, `skills/work/SKILL.md:105,182` (the `/work` T-BUG-010 HARD-GATE), `skills/init-session/SKILL.md:28` still teach the old '6 core subagents / 5 core specialists' fixed roster, contradicting the class-aware model reconciled in `docs/agents/` this wave. Both skills are `copilot:false` (no template mirror) but touch the `/work` runtime gate + `/sync-l0` surface, so scoped out of this DOC wave. Reconcile to selective/class-aware.
- **BL-W4-12** (OPEN, 2026-07-07) — No hook blocks orchestrator verdict-forging: `architect-self-edit-gate.js` gates only `agent_type.startsWith('arch-')` (and even then exempts verdict-shaped paths); `push-authorization-gate.js` only intercepts `git push`; `premature-execution-gate.js` excludes `arch-*`/orchestrator by design. Verified via direct source read (Wave 3 PREP): no hook prevents the orchestrator (empty `agent_type`) from directly Write/Edit-ing an `arch-*-verdict.md` path (hand-authoring a verdict instead of `write-verdict.sh`). The 'no-forged-verdict' rule added to `agent-verdict-protocol.md` this wave is discipline-enforced only; this tracks the HARNESS-track mechanical closure.
- **BL-W4-13** (OPEN, 2026-07-09) — baseline-worktree/node_modules isolation: never symlink main's `node_modules` into a throwaway measurement worktree — a test's `rm -rf node_modules/` follows the symlink and empties MAIN deps (Wave 4 incident, recovered via `npm ci`). Prefer scoped wave+consumer checks in the main repo.
- **BL-W4-14** (OPEN, 2026-07-09) — `emit-push-proof.sh` worktree_id non-canonical path bug: `worktree_id` is set from `git rev-parse --show-toplevel` in both emit (`:534`) and verify (`:620`), and verify hard-fails on mismatch (`:654`). On macOS, `--show-toplevel` returns `/var/…` vs `/private/var/…` inconsistently (symlink), so a worktree emit/verify pair can disagree → "proof worktree_id != current worktree" — the source of the 4 non-wave `test-push-proof-gate.bats` failures. Fix: canonicalize worktree_id (`pwd -P`/realpath) consistently in emit + verify. HARNESS-track.

**Source**: `.planning/harness-realignment-deep-audit-plan.md` (Wave 0 scope + Wave 4 scope), `project_wave_live_tree_write_bats_hygiene_shipped.md`.

### Realignment follow-ups (Wave A — QG Evidence Integrity)

Findings from `.planning/wave-qg-evidence-integrity/PLAN.md`, filed once Steps 5, 9, and 11 had actually landed (confirmed on disk at filing time):

- **D0** (RESOLVED by Wave A) — `scripts/sh/emit-push-proof.sh` accepted a claimed `{"step":"test-suite","result":"PASS"}` on faith: duplicate step ids silently last-won, `result` was never checked against an enum, unknown step ids were never checked. Closed by five named evidence-binding checks (`invalid-step-result`, `duplicate-step-id`, `unknown-step-id`, `report-started-at-*`, `test-suite-evidence-*`).
- **D2** (RESOLVED by Wave A) — `docs/agents/quality-gater-freshness-gate.md`'s `ls .../bats-result.*.env | sort | tail -1` handoff discovery reimplemented, incorrectly (no HEAD check, no scope check), logic that already existed correctly in `emit-qg-result.sh`. Extracted to shared `scripts/sh/lib/bats-handoff.sh`; the doc now calls `select_bats_handoff --since <report.started_at> --require-scope full` and fails Step Z when it returns anything other than `ok`.
- **D3** (RESOLVED by Wave A) — `emit-qg-result.sh` conflated bats-run completeness with test-pass success — a complete-but-failing run was indistinguishable from a truncated one. Now emits separate `suite_summary.bats_complete` and `suite_summary.bats_verdict`.
- **D5** (ADDRESSED by wave `qg-artifact-binding`, pending merge — see below) — `pre_pr_coverage` and `discovered_rules` have zero producers repo-wide; `emit-push-proof.sh` still only checks their *presence*, not that the content is real. Explicitly out of Wave A's scope. **Fix**: mint-internal `emit-pre-pr-report.sh` + `emit-rule-inventory.sh` derived-artifact producers, a `pre_pr_coverage` managed-key contract (`secret_scan`/`registry_hash_freshness`/`commit_lint`), and a `rule-coverage-gap` check diffing `discovered_rules[].rule_id` against the generated inventory — see [quality-gater-artifact-binding.md](docs/agents/quality-gater-artifact-binding.md).
- **D6** (RESOLVED by Wave A) — the QG report carried no session timestamp. `emit-qg-result.sh --init` now stamps `started_at`/`head` into `quality-gate-report.json`, used both as the evidence-lookup `--since` floor and as `emit-push-proof.sh`'s own `report-started-at-*` plausibility check (`now-86400s <= started_at <= now+120s`).
- **Decorative `artifact` field** (LOW) — `quality-gate-manifest.json`'s `required_steps[].artifact` (e.g. `test-suite`'s declared `.androidcommondoc/test-suite-report.json`) stays decorative — no code reads it. Wave A binds evidence through the new `evidence` sub-object instead. Low-priority cleanup: either wire a real producer/consumer for `artifact` or drop the field.
- **PS1 `run-qg` restoration** (MED) — `scripts/ps1/emit-push-proof.ps1`'s `run-qg` is disabled (hard-refuses to mint, exit 2) pending a PowerShell port of the evidence-binding logic; `pwsh` was not available on the box Wave A was implemented on, so writing an untested security-critical PS1 evidence binding was correctly deferred rather than risked. Needs a box with `pwsh` installed, plus parity tests against the bash implementation. `verify-push-proof.ps1` (the read-only verifier) is unaffected and already carries the same `bats_evidence` 8th check as bash.
- **`docs/agents/dual-location-protocol.md` doc drift** (LOW, non-blocking) — its 5-line Sync Steps (lines 16-24) *omit* Patas 3-4 of the Rule 9 ceremony entirely: the doc never mentions `skills/registry.json` or `generate-registry.js` anywhere in its body, even though a template-version bump also requires regenerating the registry's embedded `frontmatter.template_version` copy (a different artifact than the manifest hash the doc does cover). Both existing lines in the doc are individually correct about the manifest-hash artifact — the doc simply omits the registry-sync patas, it does not contradict them.
- **HIGH — `docs/agents/quality-gate-protocol.md` is stale on the bats-evidence subsystem** — currently inaccurate, not a future risk (pure prose; nothing gates on it, so not test-breaking). Not in the 29-file Path-Manifest; `PLAN.md` is frozen (amending it would invalidate three PREP verdicts and three dispatch artifacts mid-flight), so filed here rather than fixed this wave. Found by context-provider: `:206-218`'s handoff-fields table lists 10 fields while `run-bats.sh` now writes 13 (adds `BATS_SCOPE`, `BATS_TARGET_DIGEST`, `BATS_ENV_FINGERPRINT`); `:220-233` describes the old inline discovery algorithm, but `emit-qg-result.sh:289` now delegates entirely to `select_bats_handoff --require-scope full` in `lib/bats-handoff.sh` and the doc has no concept of `--require-scope`; and the doc has zero mention of `fail_class` (`emit-qg-result.sh:378-389`) or of `bats_verdict` as distinct from `bats_complete` (the D3 fix, `:369-376`).
- **`docs/agents/quality-gater-secret-scan.md:49,55`** (FIXED by wave `qg-artifact-binding`) — blanket claim `"quality-gate-manifest.json — NOT touched"`. The specific point (secret-scan needs no NEW manifest entry) stays true, but the unscoped wording was false: Step 9 already touched the manifest for an unrelated reason (`informational_steps`), and wave `qg-artifact-binding` touches it further (`manifest_version: 3`, generic binding loop that now actively reads this report). Both lines rescoped to the narrow true point; same defect shape as the freshness-gate lines already fixed in Wave A, lower severity.
- **`mcp-server/src/tools/validate-agents.ts:325`** — `const MAX_LINES = 435;`, a second, independent copy of the agent-template line cap, parallel to `validate-agent-templates.sh:429`. Not broken by this wave (the template stays at exactly 435, satisfying both). Risk: the two magic numbers could drift apart in some future change. `docs/guides/project-constraints.md:23` states the ≤435 policy as prose (not a pin) — benign.

**Methodology note (context-provider) — a sweep axis prior audits structurally could not cover.** Every axis swept this wave asked "does anything *reference* the value I am changing?" But a doc asserting `"quality-gate-manifest.json — NOT touched"` contains neither `manifest_version` nor `informational_steps` as literal text — **a value-grep can never catch a stale negative claim.** New axis: after changing a shared artifact, additionally grep for the *pattern* of denials about it — `"untouched"`, `"NOT touched"`, `"informational only"`, `"does not"`, `"is unnecessary"` — not just its field names. This single idea found the two doc items above, plus the two lines already fixed in `quality-gater-freshness-gate.md:45,51`.

**Wave C — `pre_pr_coverage`/`discovered_rules` producer + binding — ADDRESSED on `feature/qg-artifact-binding`, pending merge.** The branch lands a real producer for `pre_pr_coverage` and `discovered_rules`: mint-internal `emit-pre-pr-report.sh` + `emit-rule-inventory.sh`, a `pre_pr_coverage` managed-key contract, and a `rule-coverage-gap` check diffing `discovered_rules[].rule_id` against the generated inventory (see [quality-gater-artifact-binding.md](docs/agents/quality-gater-artifact-binding.md)). Same wave also closes the `secret-scan`/`doc-validator-parity` "declared-but-never-opened" gap via a generic binding loop, and the `registry-hash`/`rule-cross-check` tautology/circularity via the `mint_rederived` marker and a rule-inventory-based coverage check respectively. `feature/portable-ingestion-wave38` (Wave 5) still must not resume until this wave's QG passes and it merges to `develop` — direct successor to Wave A in the B → A → C → Wave 5 sequence.

**LOW/MED — commit-lint semantics duplicated across three validators; extract a shared helper.** The Codex NO-GO fix round's P1 fix (wave `qg-artifact-binding`) ported `scripts/sh/commit-msg-hook.sh`'s conventional-commit-scope semantics INLINE into `scripts/sh/emit-pre-pr-report.sh` (the mint's `commit_lint` managed-key producer — see [quality-gater-artifact-binding.md](docs/agents/quality-gater-artifact-binding.md)), kept contained to that one file per the wave's own Path-Manifest. That leaves **three** independent bash/JS implementations that can silently drift: `scripts/sh/commit-msg-hook.sh` (git hook), `scripts/sh/emit-pre-pr-report.sh` (mint), and `.claude/hooks/commit-scope-validation-gate.js` (pre-commit JS gate) — plus `.github/workflows/reusable-commit-lint.yml` as the CI-side sibling to keep in view (not a fourth implementation to merge, a comparison point). **Desired fix**: extract one shared commit-lint helper the bash-side validators source, so the semantics cannot drift; re-verify the JS gate against it. Not a blocker for Wave C's merge — filed as a follow-up.

**LOW/MED — `readme-audit` surfaced `README.md` staleness while auditing wave `qg-artifact-binding`'s own docs work (NOT fixed — `README.md` is outside this wave's Path-Manifest).** Sub-docs count stale (README says 97, actual 99 — includes this wave's new `quality-gater-artifact-binding.md`); sh-scripts count stale (README project tree says 50, actual 62 — includes this wave's 2 new `emit-pre-pr-report.sh`/`emit-rule-inventory.sh`, though the 12-script gap is mostly pre-existing); 11 scripts (including both of this wave's new ones) missing from the README scripts table entirely. Fix with `/readme-audit --fix` in a dedicated pass — do not fold into a wave whose Path-Manifest doesn't include `README.md`.

**HIGH — `APPROVED-PREP` is an unbacked assertion, same defect class as D0, one layer earlier.** `.claude/hooks/premature-execution-gate.js:143` unlocks all specialist Write/Edit/Bash execution on the literal token `APPROVED-PREP` plus a matching `PLAN_SHA256` — but `scripts/sh/write-verdict.sh`'s `prep` mode (`:9`) mints that token from **no analysis input at all**; only its `verify-final` mode (`:11`) reads a verdict body from stdin. Anything driving `write-verdict.sh --phase prep` can unlock specialist execution without ever having produced a structured PREP analysis. Desired fix: bind the `APPROVED-PREP` token to a structured, non-empty PREP body (mirroring how `verify-final` already requires one) before it can unlock specialist execution. *User-approved for filing 2026-07-09; explicitly NOT folded into Wave A's own scope.*

**HIGH — `APPROVED-VERIFY-FINAL` is an unbacked assertion, same defect class as D0 and as the `APPROVED-PREP` item above, one phase later and one layer more load-bearing.** `scripts/sh/write-verdict.sh` verify-final reads the architect's body from stdin with a bare `stdin_content="$(cat)"` — accepting anything, including an empty body. Worse, `scripts/sh/emit-push-proof.sh:573` tests the seal with a bare substring check, `if 'APPROVED-VERIFY-FINAL' not in content`, so **the token is satisfied by any occurrence of the literal string anywhere in the file — including prose that merely mentions it.**

**Demonstrated live during Wave A.** `arch-integration-verdict.md` carries the string twice: once at `:126` as its actual seal, and once at `:112` inside a sentence *describing this very backlog item*. **Delete the seal and the file still passes.** Paired with the `**HEAD**:` regex, which matches any line of the form `**HEAD**: <40-hex>`, **a prose-only file satisfies `verdict-head-binding` entirely.** The token does not prove an architect reviewed anything; it does not prove `write-verdict.sh` was ever run. Unlike `APPROVED-PREP`, which unlocks specialist execution, this token unlocks the **push**.

**And the `**HEAD**:` line is stamped by `write-verdict.sh` at write time from `git rev-parse HEAD` — never asserted against the evidence the verdict body cites.** Observed in Wave A: an architect verified the tree at one commit, a docs commit landed during its verification pass, and its sealed verdict bound the newer commit while its Evidence section cited handoffs from the older one — with no bats handoff at the bound commit at all. The mint fail-closes on a stale `**HEAD**:`, so this is not exploitable; but **a verdict can be internally inconsistent and still satisfy `verdict-head-binding`.** Same defect class as `report.head` (fixed in `51b0d63`), one layer up: a field written by the tooling, never cross-checked against the content it accompanies. Found by `arch-testing` auditing its own artifact.

**Operational rule until the verdict evidence contract is fixed:** re-check HEAD and `git status --porcelain` immediately before every `write-verdict.sh` invocation, not once at the start of a verification pass. A long, careful pass is exactly when HEAD moves underneath you.

**Desired fix — and a non-empty-body check is explicitly insufficient.** Do not test for a substring. Require a **structurally delimited seal block** that `write-verdict.sh` alone emits, carrying evidence-bound review content, and **reject any file where the token appears outside that block**. Mirror §A4: the gate reads evidence, not an assertion — and a *mention* of an assertion is not even the assertion. *Explicitly NOT fixed in Wave A, by user decision — it changes both the verdict evidence contract and the push-mint semantics, so it belongs in a dedicated follow-up / Wave C scope. Do not add `write-verdict.sh` to Wave A's Path-Manifest. No silent deferral: this is a named, owned item, not a parked one.*

**HIGH — the evidence binding requires evidence to be PRESENT, never REPRODUCIBLE. It is order-dependent.** Wave A binds `test-suite: PASS` to a HEAD-bound, full-scope, complete bats handoff with `not_ok=0`. It never establishes that a second run at the same HEAD would agree. Two handoffs observed on disk during Wave A, same commit `dc6aef0`, same scope, both `complete=true`:

```
21:29:15   OK=1945   NOT_OK=0   COMPLETE=true   VERDICT=pass
21:33:32   OK=1941   NOT_OK=4   COMPLETE=true   VERDICT=fail
```

`scripts/sh/lib/bats-handoff.sh` (Pass 3b) selects the candidate with the **maximum `BATS_GENERATED_AT`** among valid, fresh, full-scope, HEAD-matching handoffs. **The newest run wins.**

For the pair above, the newest is the *failing* one, so the mint correctly dies `test-suite-evidence-dirty`. **That ordering is safe.** The hazard is the **reverse**: a failing run followed by any later clean run — *including a simple retry* — leaves a clean handoff as newest. The mint binds it and has **no awareness that an earlier run at the same commit disagreed.** The gate silently rewards *"re-run until green,"* which is precisely the culture a flaky suite produces.

The evidence of disagreement is not lost. `run-bats.sh` writes a **new file per run and never overwrites**, so every same-HEAD handoff persists in `.androidcommondoc/`. **The mint reads exactly one and ignores the rest.** The data required to detect non-reproducibility is already on disk, unread.

**Desired fix.** At mint time, enumerate **all** valid full-scope HEAD-matching handoffs rather than only the newest, and **die if any two disagree** on `ok` / `not_ok` / `expected`. No new artifact is needed — only reading what `run-bats.sh` already writes. Optionally strengthen to *require* ≥2 agreeing runs, so a single unrepeated measurement cannot mint at all. Mirror §A4: the gate reads evidence, not an assertion — and **one answer is an assertion about *the* answer.**

*Found by arch-testing in the raw handoff archive; the ordering semantics corrected by arch-platform while sealing VERIFY-FINAL, against the orchestrator's own (backwards) description. User-approved for filing 2026-07-09. Explicitly NOT fixed in Wave A — the root cause is fixed; the gate hardening is a tracked follow-up, not a blocker. To be disclosed in the PR body as a known limitation.*

**MED — `run-bats.sh` and `emit-qg-result.sh` default `PROJECT_ROOT` to the live repo; under bats this silently reads live artifacts.** `run-bats.sh:72` and `emit-qg-result.sh:79` both resolve `${ANDROID_COMMON_DOC:-$(cd "$SCRIPT_DIR/../.." && pwd)}`. Both branches yield the live repo — there is no safe branch. A bats test that invokes either without `--project-root` receives isolated `--report`/`--out` paths but a **live** handoff-discovery directory (`scripts/sh/lib/bats-handoff.sh:111` enumerates `$repo_root/.androidcommondoc`).

Observed in Wave A (2026-07-09): eight tests in `scripts/tests/emit-qg-result.bats` (`#QR1`, `#QR2`, `#QR3`, `#QR9`, `#QR22`, `#QR23`, `#QR24`, `#QR26`) passed for four hours for the wrong reason — no handoff had ever bound a live HEAD, so every live candidate was rejected as foreign and the script fell back to the `--bats-log` fixture each test was actually asserting. The first honest `run-bats.sh` run wrote a full-scope handoff bound to HEAD; `select_bats_handoff` then returned `ok`, the script consumed the real run instead of the fixture, and the tests broke. Fixed in-wave by passing `--project-root "$REPO"` (plus copying the manifest into the sandbox, without which the required-steps evaluator fails closed and the tests go red for a different wrong reason). **Failure mode is silent passing**, so no amount of green tells you it is absent.

Currently dormant elsewhere: `scripts/tests/bats-handoff.bats` and `scripts/tests/emit-push-proof.bats` are clean. `scripts/tests/run-bats.bats` is clean **by two different routes, and only one of them generalises**: `#RB1`–`#RB10b` and `#RB17` invoke `--eval-only`, which never performs handoff discovery or writing at all — immune **by construction**. The remaining seven — `#RB11`, `#RB12`, `#RB13`, `#RB14`, `#RB15`, `#RB16`, `#RB18` — are full-run invocations kept safe only because each explicitly passes `--project-root "$WORK_DIR"` — safe **by discipline**. The set is **non-contiguous**: a range grep for `#RB13`–`#RB18` silently misses `#RB11`/`#RB12` and wrongly includes `#RB17`. `--eval-only` immunity survives a careless future test; flag-passing discipline does not. Dormant is not fixed.

Desired fix — do not rely on discipline; make the default impossible under test: under Bats (`BATS_TEST_FILENAME` or `BATS_TEST_TMPDIR` set), `run-bats.sh` must fail closed if `--project-root` was not passed explicitly (`die` rather than silently defaulting to the live repo). Production and `quality-gater` behaviour are unchanged — the live-repo default remains correct outside tests. Add a regression proving the die fires (and a positive control proving the explicit flag still works). `emit-qg-result.sh:79` carries the identical pattern and warrants the same treatment. *User-approved for filing 2026-07-09. Explicitly NOT fixed in Wave A unless it becomes an active blocker.*

**HIGH — `wave-phase-gate.js` Rule A is inert; it cannot fail.** `.claude/hooks/wave-phase-gate.js:58` blocks `git push`/`gh pr create` only when the wave sentinel is absent. `.claude/hooks/plan-md-write-gate.js:55` auto-creates that exact file at PLAN.md-write time, guarded by `if (!fs.existsSync(...))` — so it can never overwrite, and the stub's promise ("overwritten by QG verdict at pre-PR time") is unfulfillable by that writer; no other writer exists. The literal `status: PASS` in the stub is parsed by nothing. `emit-push-proof.sh:616` additionally exempts the path from the clean-tree assertion. Found by `quality-gater`; independently corroborated by `context-provider` across three sweeps (zero readers of the sentinel content). Note `scripts/tests/planner-write-gate.bats:86` asserts the stub text, so removing the false promise is not a one-liner. Both hook files are outside Wave A's Path-Manifest. Same defect class as the `APPROVED-PREP` and `APPROVED-VERIFY-FINAL` entries above: a gate whose predicate cannot be false. *Not a live authorization bypass — real push authority is `push-authorization-gate.js` plus the two-stamp git hook.*

**MED — `bats_evidence` omits `complete` and `total`.** `emit-push-proof.sh` validates `complete == true` and `total == expected` (the sanity floor) at mint time, then persists only `{run_id, head, ok, not_ok, expected, scope, generated_at}`. `verify_proof`'s 8th check is presence + `.head == pushed_sha` — nothing more. So the three "equivalent-rigor" verifiers (bash `verify-proof`, `verify-push-proof.ps1`, the `push-authorization-gate.js` fallback) confirm evidence exists and names the right commit, never what it said. `emit-push-proof.sh:35` already admits the consequence: *"a hand-authored, well-formed, correct-HEAD handoff file is not distinguishable from a genuine one by this mechanism alone."* Desired fix: persist `complete` and `total`; have all three verifiers re-derive `not_ok == 0 && scope == "full" && complete && total == expected && ok > 0`. Found by `quality-gater`. *Explicitly not fixed in Wave A by user decision — the `report.head` fix must not widen.*

**LOW — `PA-JS1`/`PA-JS2` match a loose substring where a structured field exists.** Both tests (`scripts/tests/push-authorization-gate.bats:598`, `:629`) correctly pin `[ "$status" -eq 2 ]`, but assert the decision with `[[ "$output" == *"BLOCKED"* ]]` — a substring that merely happens to live inside the hook's reason string — rather than the structured `[[ "$output" == *'"decision":"block"'* ]]` field that `#PAG-PEER-BLOCK` (`:818`) already uses. A future reason-string rewording, or any output containing the word incidentally, would satisfy the assertion without the hook having emitted a block decision.

**Desired fix:** assert the structured `"decision":"block"` field alongside the existing exit-code check, matching `#PAG-PEER-BLOCK`'s pattern. Flagged by `arch-testing` during review; the mechanism corrected by `arch-integration`, which read both tests rather than accept the filed description. Same defect class as `#PAG-PEER-BLOCK`'s vacuity: **an assertion weaker than the property it names.**

**INCIDENT — push-authorization bypass, 2026-07-10.** `push-authorization-gate.js`'s `isGitPushCommand` split on `&&`, `||`, `;`, `|` but not on newlines, then anchored `^git push` per segment. A `bash -c` body whose first line was `cd …` became one segment starting with `cd` and went undetected. `:174`'s `if (!isGitPushCommand(cmd)) process.exit(0)` precedes the peer-block, so the false negative disabled the entire gate — a peer could push (verified: `agent_type=toolkit-specialist` + `bash -c 'cd /repo\ngit push'` → ALLOW). The bypass shape is the shape this project mandates (`env PATH=… bash -c 'cd …\n<cmd>'`, required for the GNU userland). `.git/hooks/pre-push` was not installed in the clone, so the documented git-layer fallback was absent too. One push occurred through the hole: branch `feature/qg-evidence-integrity` at `1809ff6`, with stamps 58 minutes stale.

**State plainly: this was an AUTHORIZATION bypass, not evidence fraud.** `proof.head == bats_evidence.head == origin/feature/qg-evidence-integrity == 1809ff6`. The pushed commit is exactly the one the proof binds, and that proof was minted from a QG whose bats evidence came from a run inside its own session. No bad code shipped; a gate simply failed to gate. *(That distinction is `quality-gater`'s, and it is the right one.)*

`#PAG-PEER-BLOCK` — the regression written specifically to guard this property — was green throughout, because it feeds the hook a bare `git push`, an input nobody issues. Fixed in `3c64643` (newline and background-operator separators) with `#PAG-PEER-WRAPPED`/`#PAG-MAIN-STALE-WRAPPED` covering the real shape. `install-git-hooks.sh` was run as immediate mitigation.

**Update (Codex NO-GO round, 2026-07-10): the detector is best-effort, not authoritative — and one class stays open.** The newline/`&` (`3c64643`), global-git-option + ANSI-C (`3f23add`), and line-continuation (`737c1b9`) evasions were narrowed. A **known class remains OPEN by design decision** (redesign, not another special case): backslash-escape of ordinary characters. A shell strips `\x`→`x`, so every one of these executes a real `git push` yet the detector ALLOWs it — nine confirmed shapes (fake-`git`-on-PATH proof): `git \push`, `\git push`, `git p\ush`, `g\it push`, `git pu\sh`, `git \p\ush`, `git -C /tmp \push`, `rtk git \push`, `git \push\ origin`. The naive `replace(/\\(.)/g,'$1')` over-normalizes escaped spaces and stays in the regex-vs-shell trap; rejected. **The authoritative push gate is the git-layer `.git/hooks/pre-push` hook**, which reads git's native pre-push refs (not a command string) and so cannot be evaded by any spelling; it blocked a stale-stamp push with exit 1 in this branch. **Wave A's delivered contract is test-suite evidence integrity + proof binding, not complete shell-command push authorization.**

**LOW — `push-authorization-gate.js` Pass 1 recurses into any backtick span, so ANY Bash call whose text contains backtick-quoted push-like content is blocked as a push.** `isGitPushCommand`'s `EXEC` list treats `` `…` `` as command substitution and recurses into it regardless of whether the content resembles a command. **Pass 1 runs on the ORIGINAL command, before Pass 2 strips heredoc bodies and quoted spans** (`:57`) — so a heredoc offers no protection.

**The blast radius is Bash calls generally, not commit messages.** Observed live in Wave A: `arch-platform`'s `write-verdict.sh --phase verify-final --supersede` invocation — a command touching no git — was blocked as *"arch-platform attempted git push"*, because its heredoc body described the bypass using backtick-quoted syntax. A plain `echo` with backticked push text blocks identically.

Pre-existing for a backtick span whose content is bare `git push`. The newline and `&` separators added in `3c64643` each created a new instance: a backtick span containing `cd /x` on one line and `git push` on the next (the newline case), and `` `sleep 1 & git push` `` (the `&` case) — both were allowed before and block now.

**Over-blocking, not under-blocking** — fail-closed, and strictly safer than the bypass it replaced. Reported by `toolkit-specialist` against its own change after its own commit was refused; scope corrected by `arch-platform` after its own verdict-write was refused. Both rephrased rather than widening the detector or bypassing it.

**Desired fix (design question, `toolkit-specialist`'s suggestion):** Pass 1 should require backtick content to look like a command before recursing, rather than merely be non-empty. Must preserve the existing prose guards and must not reopen the newline/`&` bypass.

**Practical note until fixed:** avoid backtick-quoted push syntax in any Bash argument — commit messages, heredocs, `echo`, verdict bodies. Plain prose is fine.

**CRITICAL — replace the command-string-parsing push detector; stop treating regex parsing as authoritative.** `push-authorization-gate.js`'s `isGitPushCommand` parses a Bash command string with regex to decide whether it is a `git push`. This is structurally unable to keep pace with the shell's grammar — four evasion families were closed in sequence (newline, `&`, global-options/ANSI-C, line-continuation) and a fifth (backslash-escape of ordinary characters, 9 shapes) remains open. Do not add a fifth special case. Redesign options: (1) treat the git-layer `.git/hooks/pre-push` hook as the sole authority and demote the JS PreToolUse hook to advisory identity defense; (2) replace the regex with a conservative shell tokenizer modeling unquoted backslash, line continuation, wrappers, and git global options, with explicit **deny-on-unknown for peer agents**; (3) for peers, block any Bash command whose normalized body contains an executable `git` token unless proven non-push. The detector must fail **closed** for peers, not open. The same regex fragility also produces **false positives**, not only false negatives: during this round a plain `git commit` (no push) was blocked as "attempted git push" because Pass 1's non-greedy `$(…)` match closed on an unrelated inner `$(…)` before the heredoc's true end, leaking a git-push example string past heredoc-stripping. A detector that both misses real pushes and blocks legitimate non-pushes is wrong in both directions — the definitive case for replacement over patching. *User-directed CRITICAL, 2026-07-10.*

**HIGH — install `.git/hooks/pre-push` automatically; manual install leaves clones unprotected.** The git-layer two-stamp pre-push hook is the authoritative, escape-proof push gate, but `install-git-hooks.sh` is a manual step (documented in README / `docs/guides/pre-commit-hooks.md`, not wired into any automatic setup/bootstrap). A fresh clone with the hook absent has **no** authoritative push gate — exactly the state that allowed the `1809ff6` push during this wave. Wire installation into onboarding/setup so the git-layer gate is present by default, or have a checked-in mechanism verify+install it. *User-directed HIGH, 2026-07-10.*

**Source**: `.planning/wave-qg-evidence-integrity/PLAN.md`, `.planning/wave-qg-evidence-integrity/arch-integration-verdict.md`.

### Wave 38 — Ingestion bundle (LOW urgency, ~2-4h) — DEFERRED to Harness Realignment Wave 5

Content deferred — not the next harness wave. Will be processed via **Wave 5 (Portable Ingestion + Wave 38 Content)** of the Harness Realignment Sequence above, once the ingestion loop is made portable, not executed standalone.

| ID | Item |
|----|------|
| Ingest-1 | npm-cli-bin-field doc |
| Ingest-2 | gradle-patterns-plugin-authoring doc |
| Ingest-3 | testing-vitest-cjs-esm-mock-boundary doc |
| Ingest-4 | testing-vitest-esm-coverage-instrumentation doc |
| BL-W36-check | `/release-build-verify` promotion eval (calendar BL-W38 ~2026-07-03) — EVAL (Wave 5, 2026-07-09): no concrete gap identified vs the existing `/pre-release` command; recommend DEFER promotion — a dedicated `/release-build-verify` would touch `.claude/commands`+`skills` (HARNESS); revisit as a follow-on wave only if a specific release-build-verify need arises. |

**Source**: `project_w31.5_ingestion_deferred.md`, `project_bl_w36_backlog.md`.
**Recommendation**: SUPERSEDED (Wave 5, 2026-07-09) — the 4 items shipped as atomic docs under existing categories (docs/guides, docs/gradle, docs/testing); a dedicated grouping would be a new top-level category = a separate HARNESS wave if ever wanted.

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

- **qg-macos-local-ci-parity** (2026-07-08) — MERGED to develop `30de240` (PR #238, squash). CLASS HARNESS; fixed 7 BL-W4 items (1/2/3/4/6/7/9): qg-path-audit `**Class**:` anchoring + resolve-required-roles fail-open surface, ANDROID_COMMON_DOC export to the qg-doc-validators vitest child, bash-3.2-safe TOOL_PATTERNS (no `declare -A`), emit-qg-result conditional-FAIL semantics, bounded `findDocsRoot()` + repo-root exemption in validate-doc-update, qg-path-audit self-sentinel auto-exempt, and `.planning` confinement hardening in write-specialist-dispatch/write-verdict (pure-shell `pwd -P`, no python3 dep). Codex GO after a NO-GO fix round; CI 24/24; delta-clean; node_modules incident recovered via `npm ci`. — `project_wave_qg_macos_local_ci_parity_shipped.md`
- **phase-orchestration-restoration** (2026-07-08) — QG PASS (7/7 required steps; 3/3 arch VERIFY-FINAL HEAD-bound @ e5b836e; test-suite delta-honest 1793 ok / 71 pre-existing not-ok, 0 new, byte-identical across 2 independent runs; secret-scan trufflehog 3.95.8 clean). Pushed from `feature/phase-orchestration-restoration`; MERGED to develop `8aacc05` (PR #237, squash). CLASS **DOC** (Codex-ratified vs plan's HARNESS): surgical docs/agents wording reconciliation (phase-loop/class-awareness already ~90% shipped by Waves 1-2) plus a no-forged-verdict rule and a Wave 2 Shipped-entry backfill; HARNESS mechanization deferred to BL-W4-10. Codex GO after a NO-GO fix round (arch-dispatch-modes READY wording, converged w/ CodeRabbit). — `project_wave_phase_orchestration_restoration_shipped.md`
- **portable-coordination-artifacts** (2026-07-07) — QG PASS (3/3 arch VERIFY-FINAL HEAD-bound; bats 52/52; push-proof + quality-gate-report minted). Pushed from `feature/portable-coordination-artifacts`; MERGED to develop `68ed036` (PR #236). Implemented the ADR-001 disk-inbox portable coordination layer: 6 typed schemas (consult/message/result/request/approval/stop v1) with `.claude/hooks/coordination-artifact.js` validator + `scripts/sh/write-coordination-artifact.sh` writer + `docs/agents/coordination-artifact-schema.md`; additive fail-closed CP-gate disk-consult. Codex GO after a NO-GO fix round. — `project_wave_portable_coordination_artifacts_shipped.md`
- **runtime-topology-contract-realignment** (2026-07-06) — QG PASS (5 QG cycles / 0 bypass; Codex GO; CI 24/24 green). Pushed from `feature/runtime-topology-contract-realignment`; MERGED to develop `125409b` (PR #235, final branch HEAD `6dc4649`). Realigned 11 orchestration docs/agents to one coherent portable-floor + Claude-accelerator model — the portable disk-first floor is authoritative; SendMessage / background-peers are optional accelerators. — `project_wave_runtime_topology_contract_realignment_shipped.md`
- **live-tree-write-bats-hygiene** (2026-07-03) — QG PASS (push-proof.json + verify-proof green @ cebd169; Phase-B closeout re-minted at final HEAD; full Bats 1676 ok / 71 pre-existing local-env not-ok = 0 new; targeted manifest-sha-parity.bats 5/5; mcp-server node 2602/2602; secret-scan/registry-hash/doc-validators PASS). Pushed from `feature/live-tree-write-bats-hygiene`; MERGED to develop `4aac9ef` (final branch HEAD `cebd169`). Isolates the manifest-sha-parity.bats "dirty template" test to a mktemp temp copy — live tracked template never mutated, git-checkout revert removed (load-bearing under set -e) — plus a whole-worktree hygiene regression; targeted 5/5 green. Copilot-parity live-tree-write half already resolved — PR #228. — `project_wave_live_tree_write_bats_hygiene_shipped.md`
For full wave history: `git log` + memory `project_*shipped.md` files.

## How to use this document

1. **Starting a session**: pick the topmost active wave; review the linked source memory files for detailed context.
2. **Wave brief**: write `.planning/wave-bl-w{N}-prompt.md` modeled after `.planning/wave-bl-w34-l1-security-prep-prompt.md` (gitignored — local).
3. **On wave completion**: doc-updater moves entry to `## Shipped (recent)`, prunes oldest if section >5 waves, commits via PR.
4. **Adding new items**: append to active waves or create new wave entry; preserve priority order rationale.
5. **Cross-references**: every active wave row links to a memory file with full context. If memory entry is missing, file before starting that wave.
