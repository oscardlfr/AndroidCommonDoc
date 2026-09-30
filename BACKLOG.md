# AndroidCommonDoc Backlog

> **Last updated**: 2026-09-30
> **Roadmap baseline**: `develop@8ee5d831439312504a98e636c071583528824316` (PR #255). **H1, G0, ordered Waves 1–7, first-consumer hardening, consumer-contract convergence, and runtime-adoption finalization are SHIPPED.**
> **Current delivery**: the active bounded convergence below contains only defects independently reproduced by a live consumer after PR #255 plus the portable agent/memory modernization. There is no numbered wave marked `NEXT`. **R33 remains deferred.**
> **Source of truth**: this file owns ordering and scope. `git log`, merged PRs, and `project_*shipped.md` memory entries own historical detail.

## Operating contract

- The load-bearing portability floor is **validated disk artifacts**. Runtime messaging is an optional acceleration layer.
- Adapter delivery, message text, an MCP return value, or a live peer saying “GO” is never evidence. Only a valid, correlated result artifact counts as a protocol-valid consultation answer; phase and push authorization still require their own contracts.
- Waves 1–7 were executed in order and shipped through PR #250; consumer hardening and bounded follow-ups shipped through PRs #251–#255.
- Re-audit observations and file counts at each wave's starting HEAD. Post-G0 counts below were recorded by PR #245 at `619d9a7`; they are a planning baseline, not permanent truth.
- Each wave must have one frozen scope, explicit no-go boundaries, proportional tests, and a shipped memory entry before the backlog advances.
- Rich runtimes may add `SendMessage`, persistent peers, MCP invocation, app-server threads, or wakeups; failure or absence of those capabilities must not invalidate the disk floor.
- `PRUNEABLE` marks a temporary execution summary, never authority to delete an
  active backlog ID, accepted PLAN/verdict/evidence, operational runbook, or shipped
  record. Once its PR ships, replace the temporary block with one concise shipped
  entry and remove the duplicated workstream detail.

## Gate 0 — completed prerequisite (not counted among the seven waves)

### G0 — Reusable Workflow Input Boundary Hardening

**Status**: SHIPPED — MERGED to `develop@619d9a7`, PR #245.

**Objective delivered**: close the targeted post-H1 reusable-workflow shell-injection surface without expanding into the repository-wide audit.

**Outcome**:

- Hardened `.github/workflows/reusable-shell-tests.yml`, `reusable-copilot-parity.yml`, `reusable-lint-resources.yml`, and `reusable-agent-parity.yml` across both direct `${{ inputs.* }}` and indirect `${{ steps.*.outputs.* }}` run-block paths by projecting values through namespaced `env:` boundaries and quoting shell references.
- Added newline-guarded `GITHUB_ENV` script paths, `persist-credentials: false` on primary/toolkit checkouts, Bash-array argument construction where applicable, and a run-block extractor plus a 13-test regression fence.
- Closed the scoped H1/CodeRabbit documentation nits without changing H1 push behavior.
- Owner-recorded final QG at PR head `c7ba941`: 2,042 Bats PASS / 0 FAIL, 2,607 Vitest PASS, three architect VERIFY-FINAL verdicts, proof mint and pre-push verification PASS before squash to `619d9a7`.
- Preserved the broader security/doc/portability findings for their owning waves; those dispositions are now historical.

## Post-G0 fast-follows — historical closure

The release-input boundary and broader workflow audit shipped in Wave 2. README,
documentation precision, and BL-W4-8 closed in Waves 6–7. The macOS grep
portability conversion shipped in Wave 1 (`1b3eebe5`). These items are historical
inputs, not retained work and must not be scheduled again.

## Ordered seven-wave program

| Order | Professional name | Primary outcome | State |
|---:|---|---|---|
| 1 | Portable Runtime Collaboration & Persistent Role Lifecycle | Persistent canonical support roles plus portable consultation and user-gated documentation ingestion | **SHIPPED** |
| — | Agent & Skill Behavioral Restoration Qualification | Mandatory read-only qualification before Wave 2 | **COMPLETE** |
| 2 | Workflow Expression & Input Boundary Audit | Repository-wide control of untrusted workflow inputs crossing into shell | **SHIPPED** |
| 3 | Structured Verdict Evidence Contract | Verdicts become strictly parsed, correlated, evidence-backed records | **SHIPPED — PR #250** |
| 4 | Reproducible Evidence & Bats Provenance | Independent runs and handoffs become comparable and fail closed | **SHIPPED — PR #250** |
| 5 | Native Push Authority & Peer Authorization Policy | Git-layer push authority, robust intent detection, explicit actor policy | **SHIPPED — PR #250** |
| 6 | Class-Aware Phase, Topology & Skill Orchestration Control Plane | Mechanized wave lifecycle and one runtime-neutral skill/entrypoint control plane | **SHIPPED — PR #250** |
| 7 | Documentation & Operational Baseline Closure | README, agents, skills, MCP, ADRs, memory, and catalogs describe demonstrated behavior | **SHIPPED — PR #250** |

---

## PR #251 first-consumer hardening — SHIPPED

The first real L2 consumer of `dfc48cf` found a coherent portability failure
cluster. PR #251 (`c5ee193e1f726d270577c9256ea7cb09b481508b`) fixed the
causes upstream in L0, exercised clean-consumer and linked-worktree fixtures,
and did not modify a product repository.

| Finding | Root contract | Shipped state |
|---:|---|---|
| 1 | Source-coupled hooks must execute from L0, never as partial consumer copies | **CLOSED by #251** — source reference plus clean-consumer execution coverage |
| 2 | Installed shell hooks must be executable and self-repair identical mode drift | **CLOSED by #251** — positive/conflict mode coverage |
| 3 | Consumer launch requires explicit `--add-dir <L0-root>` | **CLOSED by #251** — operations and getting-started guidance |
| 4 | Documented entrypoints must use canonical single-quoted POSIX rendering | **CLOSED by #251** — canonical skills and mirrors |
| 5 | Runtime installation owns `.claude/registry/wave-topology.yaml` | **CLOSED by #251** — conflict, checksum, and idempotency coverage |
| 6 | YAML resolves from the toolkit runtime closure | **CLOSED by #251** — consumer fixture has no `mcp-server` tree |
| 7–8 | Host compatibility must survive supported patch updates without certificate surgery | **REOPENED by real consumer; closing in `wave-runtime-adoption-final`** — `2.1.x` family adapter plus vendor-signed live-session evidence; exact executable hashes are diagnostic, not patch gates |
| 9 | R131 must not read mutable real-repository `.planning/` | **CLOSED by #251** — isolated one-plan fixture |
| 10 | Requested effort is not effective effort | **REOPENED by real consumer; closing in `wave-runtime-adoption-final`** — native `PreToolUse.effort.level` must equal the requested profile; CLI flags, token use and `system/init.per_turn_effort_active` are non-authoritative |
| 11 | Spawn→`system/init` needs a bounded deadline | **CLOSED by #251** — certification startup watchdog and silent-child negative test |
| 12 | Normal, safe-mode, bare, and print modes need distinct recovery guidance | **CLOSED by #251** — operations runbook |
| 13 | Acceptance must execute from a clean consumer and linked worktree | **CLOSED by #251** — real worktree and runtime fixtures |

The items below are residuals discovered during or after that acceptance. Live
DawSync validation reopened finding 10 and expanded the recovery contract before
this stabilization could be reviewed.

## PR #252 consumer stabilization — SHIPPED

PR #252 was squash-merged as
`51598ecfbf7e2db8781521acc1ba94e3a84108f2`. It closed the following
post-#251 defects and moved them out of the executable queue.

| Closed item | Local evidence |
|---|---|
| `BL-CONS-P0-02` malformed settings fail-open | Missing settings may seed a file; malformed JSON/root/hooks, directory paths, and non-`ENOENT` failures preserve consumer state and abort before sync writes. Settings replacement is atomic. |
| `BL-CONS-P1-02` silent recovery one-shot | `claude-safe-one-shot.cjs` applies bounded init/activity/total deadlines, exact none/read/repair `--tools` profiles verified against `system/init`, partial streaming, terminal-result/accounting/subagent receipts, budget-error classification, and incomplete-accounting evidence after forced termination. |
| Finding 10 effort effectiveness | PR #252 separated requested, observed and effective effort and rejected ambiguous CLI/environment selection. Subsequent live Claude 2.1.283 evidence showed that `system/init.per_turn_effort_active` is not a reliable authority; the active finalization replaces it with native `PreToolUse.effort.level` evidence while retaining the #252 conflict checks. |
| Formal-wave Bats fixture isolation | Wave-resolution fixtures now clear or explicitly override inherited `CLAUDE_WAVE_SLUG`, proving their intended fallback/CLI-precedence contracts even when the full suite runs inside a named QG wave. |
| Host-specific source-hook registrations | A standalone consumer launcher resolves the one manifest-declared local L0 source across normal checkouts and linked worktrees. Remote, unresolved, ambiguous, unsupported, and symlinked targets fail closed; prior generated absolute registrations migrate. |
| Ordinary/runtime composition | Runtime-owned topology survives ordinary prune; repeated ordinary/runtime dry-runs are clean; generated settings contain no developer home or Node installation path. |
| Unsafe CLI discovery | `--help`/`-h` are zero-write; unknown/missing arguments fail; dry-run does not claim to update the manifest. |
| Adapter determinism defects | macOS/POSIX frontmatter parsing and isolated non-mutating `generate-all.sh --check` are covered. Full atomic publication remains open as `BL-CONS-P1-01`. |

Consumer acceptance was repeated from an isolated `shared-kmp-libs` worktree:
ordinary sync, runtime sync, second-pass idempotency, a source-coupled hook launch,
and `:core-result:allTests` pass. The audit first exposed a missing
`skills/registry.json`, which made the intended L1 repository classify as L2.
Generating its registry with the canonical tool restored the disk contract; a
fresh runtime preflight/apply/idempotency cycle now reports **L1**.

## PR #253 consumer-contract convergence — SHIPPED

PR #253 was squash-merged as
`a89005cfd764b53956df5045c94f94da0a8c0384`. It closed the three temporary
`PRUNEABLE` workstreams: byte-stable ordinary/runtime sync and executable-mode
repair, source-referenced hook execution plus the consumer-local runtime
entrypoint launcher, and clean L1/L2/worktree acceptance with exact operations
guidance. Those execution summaries are intentionally pruned; DawSync remains
consumer evidence, never an edited product repository.

## PR #254 runtime-adoption follow-up — SHIPPED

PR #254 was squash-merged as
`59087cb248ea441843a0395f756f249d5d14be3b`. It shipped exact wave-scoped
admission, post-admission PREP creation, ordinary/runtime timeout idempotency,
planner write confinement, ViewModel-rule precision, recovery guidance, and the
bounded consumer acceptance that exposed the finalization defects below.

## PR #255 runtime-adoption finalization — SHIPPED

PR #255 was squash-merged as
`8ee5d831439312504a98e636c071583528824316`. It shipped the Claude `2.1.x`
family adapter, native PreToolUse effort proof, exact host composition,
planless dashboard admission, first-launch transcript handling, and
checksum-allowlisted legacy Detekt hook migration. The former temporary
finalization workstream is pruned; its detailed evidence remains in the merged
PR, changelog, tests, and runtime consumer runbook.

## Active backlog after PR #255

Priority is impact, not implementation size. Every item needs an accepted PLAN,
negative and positive tests, and a clean-consumer acceptance when it changes a
consumer-facing contract.

### Live-consumer agent/runtime convergence — ACTIVE, PRUNEABLE after merge

This single bounded workstream closes the current compatibility cluster:
permanent retirement of the legacy `team-lead` artifact; runtime executable
paths rooted in the qualified toolkit rather than the consumer; exact
PLAN/class-sentinel parsing; a portable `AGENTS.md`/thin-Claude-adapter/
path-rules/durable-memory contract; and explicit sync that maps source paths to
consumer destinations, records a full provenance SHA, and cannot install hooks
outside its selected set. It requires negative and positive fixtures, clean L1
and L2/worktree acceptance, one local full aggregate, and required GitHub CI.
After merge, replace this paragraph with one shipped-history line.

### PR #259 runtime liveness closure — IN REVIEW, PRUNEABLE after merge

Physical acceptance on the final candidate (clean interactive Claude `2.1.285`,
Sonnet 5.5, `--effort high`, Agent Teams enabled, disposable consumer worktrees):

| Scenario | Result |
|---|---|
| L2 bootstrap → probes → `READY`; explicit `shutdown_request` of one role → next init spawns a **new** actor only for that role → `READY` → stable re-init with zero actions | PASS (6 unique members, terminated binding fenced, no resumable handle left) |
| Same explicit-shutdown cycle on an L1 consumer | PASS |
| Ordinary stop (`TaskStop`) → role parked `WAITING` → next message resumes the **same** actor with its history → re-init with zero spawns | PASS |
| Ordinary consumer session without orchestration (`/init-session` dashboard, one-shot agents, git/read) | PASS, no hook denial |
| Planning from scratch on `feature/<slug>`: planner Pass A draft → `--orchestrate <slug>` over the draft → support plane `READY` | PASS |
| Planner Pass B consultation of context-provider from a consumer | **FAIL** — tracked as `BL-CONS-P1-08` |

Defects found only by the live runs and fixed in this PR: fulfilled spawn
history made a replacement spawn ambiguous; subagent lifecycle hooks spawned one
`git` process per registry record (7.5 s) and hit the 10 s host timeout; a
terminated RoleActorBinding competed with its live replacement; a SubagentStop
without a session generation blocked; the planner Pass A draft was not
parseable by the wave control plane. After merge, replace this block with one
shipped-history line.

### P0 — evidence integrity and consumer data safety

| ID | Open problem | Minimum professional closure | Dependencies |
|---|---|---|---|
| `BL-CONS-P0-01` | **False-perfect KMP coverage**. A real `kmp-test changed --json --test-type desktop --coverage-tool kover` run returned exit 0 and 6/6 tests while every module was `no_xml`, `modules_contributing=0`, `missed_lines=0`, and `warnings=[]`. L0 wrappers also prefer any global `kmp-test` without verifying the documented v0.14.0 contract, and the coverage post-processor derives a percentage and `CLASSES_ANALYZED` from test totals. | Resolve the effective runner version against an explicit supported contract; preserve coverage diagnostics through `changed`/`parallel`; reject a requested coverage result with zero contributing modules or missing XML; compute coverage only from genuine coverage fields. Add global-old-version, pinned fallback, `no_xml`, zero-contributor, mixed-contributor, POSIX, PowerShell, and clean-consumer tests. | Coordinate upstream `kmp-test-runner` fixes with the L0 wrappers; no QG or coverage skill may claim a percentage from this envelope meanwhile. |

### P1 — runtime reliability, confinement, and proportional CI

| ID | Open problem | Minimum professional closure | Dependencies |
|---|---|---|---|
| `BL-CONS-P1-01` | **Destructive/non-atomic adapters**. Copilot generators write tracked outputs directly and orphan cleanup can delete during the same incomplete run; a mid-generation failure can leave a partially rewritten adapter set. | Generate into a confined staging tree, validate the complete set, then publish atomically; retain the prior valid set on any failure. Orphan deletion must require exact generator ownership and run only after successful validation. Add cut-point failures, invalid source/frontmatter, hand-written orphan, symlink/path escape, and successful replacement tests. | One shared publication primitive for all active adapters; preserve current output bytes on success. |
| `BL-CONS-P1-03` | **No enforceable one-shot read scope**. Safe-mode/print prompts do not constrain filesystem reads or Bash traversal. | Define and prove an enforceable Read/Bash path capability or allowlist before claiming scope confinement; prompt wording alone is insufficient. | Requires a host permission primitive or a wrapper that can enforce paths rather than merely request them. |
| `BL-CONS-P1-04` | **Same-worktree Gradle interference and invented targets**. Concurrent validation in one build tree produced false unresolved references; target selection inferred `macosX64` where only `macosArm64` existed. | Serialize same-worktree builds or isolate Gradle/build directories, and derive invocations only from enumerated tasks/targets. Test contention, isolated parallelism, single-architecture native projects, and rerun determinism. | Build on the corrected runner contract from `BL-CONS-P0-01`. |
| `BL-CONS-P1-05` | **`L0_SYNC` changes over-trigger consumer CI**. A clean auto-sync merge tree was classified `FULL` solely because generated `l0-manifest.json` was an `unmapped executable path`, forcing the complete product matrix. | Add a fail-closed `L0_SYNC` class for machine-proven sync-only changes. It must validate manifest schema/digests, generated inventory/parity, runtime sync, and the relevant smoke tests. Any malformed manifest, undeclared path, mixed product change, missing provenance, or classifier error remains `FULL`. Add positive sync-only and all negative downgrade-bypass cases. | L0 owns the portable policy/template; consumers may implement their local classifier without weakening the unknown-path fallback. |
| `BL-CONS-P1-06` | **Root-source human-consent boundary is undecided**. The runtime can derive a binding from observed session/worktree/PLAN identity without a request-scoped human confirmation, while other roadmap text calls true human/OS authentication out of contract. | Decide the threat model first. If required, design a request-bound confirmation, mint-time gate, and dispatch-time freshness/scope check backed by a capability an AI cannot self-assert. Otherwise remove the stronger claim and document the explicit boundary. | Architecture decision; do not implement a prose-only or self-signed “human” artifact. |
| `BL-CONS-P1-07` | **Windows drive-letter confinement remains brittle in `write-coordination-artifact.sh`**. Two incorrect path behaviors currently cancel each other. | Correct absolute drive-letter classification and physical/lexical confinement atomically, with outside-root and fallback-tier negatives. | Do not port only the R131 normalization; preserve fail-closed behavior at every cut point. |
| `BL-CONS-P1-08` | **Context-provider consultation is unreachable from consumers**. context-provider accepts only `COORDINATION_CONSULT/v1` requests published by the runtime-consultation `publish-request` command, but an L1/L2 consumer has no launcher operation, documentation or grant path for a requester to publish one. Planner Pass B cannot finalize a plan from scratch, and architects/specialists cannot consult context-provider during a consumer wave. | Second bounded PR after #259: expose one allowlisted consumer launcher operation for publish-request/await-result with its grant and gate admission, document the exact requester command in the planner and architect templates, and resolve `BL-CONS-P2-02` in the same change. Prove it with a clean L2 acceptance: plan from scratch → orchestrate draft → Pass B accepted CP result → marker-free PLAN, plus an architect consult during EXECUTE. | Do not relax the disk-result contract; owner chose a separate PR over accepting informal SendMessage answers. |
| `BL-CONS-P1-09` | **CI Node hook tests stop at the first failing file** (`set -e` loop in `reusable-shell-tests.yml`), hiding every later failure and forcing one push per defect. PR #259 had 21 files never executed after the first failure. | Run every non-skipped file, list all failures, exit non-zero at the end; keep the pinned R33 skip list. | Independent CI fix. |
| `BL-QG-P1-01` | **Quality-gate session ordering can make the one expensive local full run stale before minting**. The first consumer ran Bats before explicit QG initialization/wave binding, so otherwise-green evidence carried unusable provenance; planning defects were detected only after the cost was paid. | Provide one canonical orchestration entrypoint that preflights `CLASS`, exact Path Manifest, clean HEAD, architect verdict bindings, and explicit wave/PLAN inputs; initializes QG; then runs/selects the one six-shard full aggregate exactly once. Reject incomplete planning before any expensive suite starts. | Separate workflow-hardening PLAN; do not weaken freshness, path audit, aggregate completeness, or required GitHub `CI Gate` merge authority. |
| `BL-QG-P1-02` | **A valid PLAN amendment cannot supersede its stale PREP verdict**. The protocol requires stale PREP authority to be superseded, but `write-verdict` rejects the superseding record because the old and new `plan_sha256` differ (`superseded-binding-mismatch`), forcing a fresh wave slug instead of the documented same-wave recovery. | Define one narrow PLAN-transition supersession contract: verify the old record and lineage, require the new PLAN/request/HEAD binding to be current, publish atomically, and reject cross-wave, cross-role, cross-phase, unrelated-request, or unproven old records. Add positive amended-PLAN recovery and every mismatch negative. | Separate workflow-hardening PLAN; do not relax ordinary binding equality or mix this with runtime stabilization. |
| `BL-QG-P1-03` | **Verdict checker result depends on project-root spelling**. The same valid record produced `INTERNAL_ERROR` with a relative project root and PASS with the canonical absolute root. | Normalize and confine the project root once, or reject relative input explicitly with a stable validation error. Prove relative, absolute, symlink/alias, missing, and outside-root cases return deterministic equivalent policy outcomes. | Separate workflow-hardening PLAN; no runtime dependency. |

### P2 — bounded hardening and governance

| ID | Open problem | Minimum professional closure | Trigger / dependency |
|---|---|---|---|
| `BL-CONS-P2-01` | `reusable-audit-report.yml` renders raw `project`, `layer`, and `cve_high` into downloadable HTML. | Escape rendered text with `html.escape(..., quote=True)` and prove hostile tags/attributes are absent from the artifact. | Independent bounded security-output fix. |
| `BL-CONS-P2-02` | The documented draft-only `planner → context-provider` bootstrap edge is rejected by the shipped role policy, which permits only `arch-* → context-provider`. | Choose either one exact draft-only exception with negative role/phase tests or correct the documentation; never open general specialist access. | Owner decision before code. |
| `BL-CONS-P2-03` | PowerShell `run-qg` has no restored security-critical parity path. | Implement and qualify only on an environment with real `pwsh`; retain identical failure/authority semantics. | Windows-capable execution environment. |
| `BL-CONS-P2-04` | **macOS-only runtime test failures**: `runtime-claude-ready-bootstrap` (envelope budget vs the long Homebrew `node` path) and `runtime-collaboration-entrypoint-hook` fail on macOS, also on `develop`, and pass on Linux CI. The master-only `runtime-macos` job runs both. | Determine whether the real Claude tool-result budget is exceeded for real consumer paths; fix the root cause, never relax the budget without evidence. | Must be closed before the next `master` release. |
| `BL-CONS-P2-05` | **Push gates govern ordinary consumer development**. `push-authorization-gate` requires the git pre-push hook plus fresh quality-gate/pre-pr stamps for every consumer push, and consumers still wire the retired `pre-push-pre-pr-gate.js`. | Owner decision: enforce consumer push gates only while an L0 wave is active, and retire the legacy gate wiring through sync. | Deferred by the owner until the runtime is validated. |
| `BL-GOV-P2-01` | **Future work/evidence/decision management pattern**. L0 lacks one concise operational view that connects an accepted work item to its current evidence, superseded attempts, decisions, blockers, and terminal outcome. | Future design task only: evaluate the useful work/evidence/decision pattern demonstrated in DawSync, generalize it without product coupling, and decide whether it belongs above existing PLAN/verdict/evidence records as an index rather than a competing authority. Define migration, retention, query, and single-source-of-truth rules before any implementation. | Do not implement in the documentation-reconciliation change; requires a separate approved PLAN and consumer-neutral prototype. |

### Blocked and trigger-only

- **R33 native** remains `PENDING_EXTERNAL_RELEASE`; do not schedule it before
  the required platform release exists.
- Upstream Agent Teams notification reporting requires a minimal live repro.
- Live acceptance harness facts: a structured `shutdown_request` needs the Agent
  Teams `SendMessage` variant (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, set by the
  desktop app); host composition rejects a Claude session nested inside another
  Claude process tree.
- macOS shell/hook, Gradle truststore, and Xcode/iOS smoke checks require their
  owning platform validation window.
- Product/plugin/OSS packaging ideas remain outside the L0 runtime stabilization
  sequence until a concrete product or release trigger exists.

---

## Wave 1 — Portable Runtime Collaboration & Persistent Role Lifecycle

**Class**: HARNESS

**Status**: SHIPPED — MERGED to `develop@b5d7ed46`. PR #246 (`1b3eebe5`, "portable mixed-host consultation and consumer sync"), PR #247 (`2a98bc17`, macOS stabilization: F-24 per-platform host-certificate coexistence, symlink-identity and TMPDIR path-budget fixes), PR #248 (`b5d7ed46`, macOS follow-ups: ctimeNs identity-check gap, config.toml parse hardening, parallel Bats orchestrator, zombie-process liveness fix for `S16-HOSTBRIDGE-LIVENESS-NO-SAME-TICK-STALE-01`). Windows live qualification (P4/P5/P6) recorded in memory `project_portable_runtime_p4_qualified_p5_p6_blocked.md` and `project_portable_runtime_p5_five_attempts_exhausted.md`; full ship record in memory `project_wave_portable_runtime_collaboration_lifecycle_shipped.md`. The post-Wave-1 checkpoint found the non-blocking documented `planner → context-provider` bootstrap-edge mismatch now owned canonically by `BL-CONS-P2-02`; it is not a reason to reopen Wave 1. R33 native remains `PENDING_EXTERNAL_RELEASE` (unchanged, out of Wave 1 scope).

### Objective

Restore the useful historical collaboration semantics—canonical architects, `context-provider`, and `doc-updater` available throughout the session—without restoring mandatory Claude `TeamCreate`. A specialist consults its reporting `arch-platform`, `arch-testing`, or `arch-integration`; that architect may open a nested consultation with `context-provider`; documentation gaps can continue through explicit user approval to a reusable `doc-updater`. Every path lands and validates authoritative disk artifacts.

The default project support plane is exactly `arch-platform`, `arch-testing`, `arch-integration`, `context-provider`, and `doc-updater`. It is project-configurable and session-scoped: roles move `READY/WAITING ↔ BUSY`, idle does not mean dead, and a second consultation should reuse the same healthy binding rather than spend another full spawn context. Specialists remain wave/scope-selected; planner, verifier, and quality-gater remain phase-scoped.

The protocol is transport-neutral. Role-policy validation rejects disallowed direct specialist → context-provider transitions and reuses the existing concern-ownership/reporting-architect map rather than creating a second topology map. The allowed chain must work whether activation uses a persistent Claude Agent Teams/native peer, Claude without Agent Teams, `SendMessage`, a persistent Codex session, Codex invoked through the adapter MCP facade, a canonical single-use dispatch, or an already supervised disk-polling worker.

This wave must support both agreed operating modes:

1. **Persistent support plane / dual runtime** — capability-proven Claude peers and/or retained Codex workers remain available concurrently and can receive repeated work without the user relaying messages.
2. **On-demand MCP or ephemeral fallback** — Claude invokes Codex through the adapter-owned MCP facade, or the lifecycle manager uses canonical single-use/disk fallback when persistent peers are unavailable.

Both modes share one disk protocol and differ only in how a target is woken or invoked.

### Why it is first

Portable Coordination Artifacts (PR #236) restored the portable data plane, but not a complete live consultation loop. Architects/context-provider no longer reliably survive through EXECUTE, specialists cannot consume a correlated protocol-valid answer portably, and Codex/Claude still need a manual bridge in many sessions. Fixing this collaboration layer first improves every later wave's planning, audit, and quality-gate review without weakening disk-first evidence.

### Historical baseline and retained lessons

- At the PR #213 (`aac0257`) snapshot, the dominant documented Claude topology kept context-provider, doc-updater, three architects, and Phase-2 specialists alive, then used a temporary QG peer with live architect deliberation. Some start-roster docs already disagreed on whether QG was persistent, which is historical evidence that prose-only lifecycle rules drift.
- PR #219 (`1f4214b`) deliberately removed mandatory `TeamCreate` dependence and moved architects toward single-use/background-optional execution. That improved portability but reduced live continuity.
- PR #220 (`2622205`) documented an adapter/capability direction with pseudocode and a textual capability guard; it did not ship an executable runtime-neutral loop.
- PR #235 (`125409b`) realigned documentation, not runtime liveness.
- PR #236 (`68ed036`) shipped the portable coordination-artifact floor: six typed schemas, a writer, validator, context-provider disk branch, and Bats/Node coverage. It did not ship an inbox consumer, poller, wakeup, or respawn loop.
- PR #237 (`8aacc05`) reconciled phase wording and explicitly deferred HARNESS mechanization to BL-W4-10.
- Today `consult/v1` is a context-provider marker, `message/v1` may be content-free, and `result/v1` has no request correlation or actor binding. Direct-final writes are collision-safe but not temp+rename atomic; the context-provider disk branch excludes specialists, which still depend on an architect-written live-message flag.

The target is not to resurrect the Claude-only topology. It is to recover its useful liveness through replaceable connectors. Historical `/resume-work` prose never constituted a real runtime-resume implementation; Wave 1 must build discover/reuse-or-respawn/rehydrate behavior rather than falsely label a memory dashboard as restored liveness.

### Architecture contract

Separate two planes:

- **Authoritative data plane**: validated artifacts below one configured base `coordination_root` (default `<worktree>/.planning/coordination`). It carries requests, correlation, results, freshness, transaction cancellation, and acknowledgement state.
- **Best-effort activation/wake plane**: `SendMessage`, Codex app-server/thread input, Codex MCP invocation, the bounded `claude-agent` one-shot driver, a registered runtime-consumer wake, or no-op. It only activates or tells a worker which authoritative artifact to read; `runtime-spawn` is wake-only and never launches a model.

Keep six implementation layers distinct:

1. Authority protocol (validated disk requests/results/acceptance).
2. Tracked project policy (`auto|persistent|ephemeral|disk-only`, role classes, budgets, fallback, workflows).
3. Role lifecycle (`probe`, `ensure`, `discover`, `waitReady`, `wake`, `reuse`, `rotate`, `stopOwned`).
4. Runtime connectors (Claude Agent Teams/native roster, Codex app-server, adapter MCP, bounded `claude-agent` ephemeral dispatch, registered disk consumer). Codex in-app native collaboration remains preserved as outer-host `RuntimeAdapter` capability metadata, but is non-selectable in Wave 1 until a stable code-callable host action plus identity/grant and conformance contract exists.
5. Notification transports (`SendMessage`, MCP call, app-server wake, helper, polling/no-op).
6. Typed workflows (mediated architecture consultation and user-approved documentation ingestion).

Tracked policy must never contain host handles, PIDs, endpoints, or credentials. A separate gitignored presence registry records bounded host-local binding/readiness data and is never evidence. Session restart invalidates session-scoped bindings; retained workers are rediscovered and other roles are canonically respawned/reconnected from validated disk bundles. Never report a dead binding as reused.

Proposed transport-neutral facade:

```text
dispatch(target_role, request_artifact_path, policy) -> ActivationAction
record_delivery(activation_action, observed_commit_point) -> DeliveryReceipt
await_result(request_id, expected_role, deadline) -> ValidatedResult | Timeout
```

`ActivationAction` is a host-private instruction selected only after the authoritative request and activation records exist. `DeliveryReceipt` is diagnostic telemetry only. `ValidatedResult` means **protocol-valid consultation result**, not authenticated actor identity or permission to advance a phase. It exists only after request/result correlation, allowed role transition, wave, PLAN digest, exact subject snapshot/scope, schema, status, and content checks pass.

### Protocol evolution

Keep existing schemas readable during migration, but do not overload weak v1 meanings:

| Artifact | Wave 1 role |
|---|---|
| `coordination/consult/v1` | Legacy pre-PLAN context-provider contact marker; readable for compatibility, not proof that a response completed and not the general transaction format |
| `coordination/consult/v2` | PLAN-bound general consultation request with stable `request_id`, target role, one required bounded question, at most one optional content-addressed `content_ref` for supplemental context, reply contract, deadline/policy, PLAN digest, and exact subject snapshot digest |
| `coordination/message/v1` | Legacy notification envelope only; never a consultation result and too weak to be the v2 inbox reference |
| `coordination/inbox-ref/v1` | Immutable inbox reference carrying `request_id`, request digest, target role, kind, and creation time; it carries no caller path because core derives exactly `transactions/<request_id>/request.json`, and it is not an independent copy of request authority |
| `coordination/result/v1` | Legacy result, readable with its shipped semantics; do not add stricter required fields |
| `coordination/result/v2` | Correlated post-PLAN response carrying `in_reply_to`, attempt/epoch, expected roles, result kind/status, non-empty content or confined content reference+digest, PLAN digest, and exact observed subject snapshot |
| `coordination/cancel/v1` | Transaction-local timeout/cancel state; means “this consultation will not be accepted,” not “kill the peer” and not harness phase authority |
| `coordination/stop/v1` | Legacy presence signal only; never controls a new persistent worker generation |
| `coordination/stop/v2` | Session-bound best-effort stop for a worker spawned/owned by the adapter, with worker/session, attempt/lease epoch, expiry, and acknowledgement; Wave 1 owns minimum ensure/readiness/reuse/respawn/owned-stop lifecycle, while Wave 6 owns general class-aware composition |
| `coordination/request/v1` + `approval/v1` | Keep their shipped ingestion-loop semantics; do not repurpose them for arbitrary consultations |

Audit every shipped producer/consumer before implementation, but the compatibility direction is fixed: preserve v1 semantics and add the v2/result/inbox/cancel contracts above. Do not silently tighten persisted v1 artifacts. General `consult/v2` requires a PLAN digest, but planner/PREP bootstrap does not require a pre-existing final PLAN. Canonical Planner Pass A writes a brief-derived `STATUS: DRAFT-CONTEXT-PENDING` PLAN with Write only and returns. In `auto|persistent`, top-level validates those bytes and performs one multi-role ensure for the full configured support plane; in `ephemeral|disk-only`, an already-registered non-recursive CP path is required. Canonical Planner Pass B then performs the disk-authoritative v2 transaction through the bootstrap-only `planner → context-provider` edge. Only its valid accepted result permits finalization and marker removal, followed by explicit same-process rebind of every draft-bound persistent support role to the final digest. The legacy `consult/v1` marker remains readable and unchanged; it is not promoted into response authority.

Required validation primitive:

```text
validate_result_for(request_artifact, result_artifact) -> valid | reason
```

There is no protocol-valid answer when the result is missing, empty, stale, uncorrelated, outside the allowed requester→target→kind policy, written under the wrong declared role, or valid only as free-form runtime/MCP text. Because any process with filesystem write access can self-declare `from`, Wave 1 must not claim actor authentication; Waves 3 and 5 own phase evidence and the strongest honest host/runtime actor policy.

### Transaction layout and fencing

Avoid timestamp scans as the consumer API. Define a deterministic, confined namespace such as:

```text
<coordination_root>/<repo_id>/<wave_slug>/<plan_digest>/
  inbox/<target_role>/<request_id>.json
  transactions/<request_id>/
    request.json
    activations/<attempt_id>.json
    claims/<attempt_id>.json
    active-leases/<attempt_id>.json
    takeover.json
    delivery/<attempt_id>.intent.json
    delivery/<attempt_id>.json
    results/<attempt_id>.json
    accepted-result.json
    ack.json
    cancel.json
    conflict/<attempt_id>-<other_attempt_id>.json
  workers/<target_role>/<worker_session_id>/stops/<stop_id>.json
  workers/<target_role>/<worker_session_id>/stops/<stop_id>.ack.json
```

Role inboxes contain validated immutable `inbox-ref/v1` references to transaction paths, not copies with independent authority. The contract must specify discovery bounds, filename/path allowlists, maximum envelope/content sizes, `content_ref` confinement beneath approved roots, digest verification, acknowledgement/consumption, retention, and cleanup. A receipt under `delivery/` records only driver, request/attempt identifiers, timestamps, outcome, and bounded error code; it never stores prompt/result text, secrets, or authority.

The requester/supervisor allocates each `attempt_id` and advertised monotonic `lease_epoch`; a target may claim only that attempt. The confined transition lock is an exclusive `.lock/` directory with a bounded wait and **no age-based reclaim**: timeout means STOP/manual recovery, never stale-lock takeover. Claim/claim-fence election remains outside that lock; candidate-result/accept/cancel/takeover decisions and current-attempt lease refresh re-read active state while holding it. Immutable records use one portable first-writer-wins publication primitive: same-directory owner-tagged temp, file fsync, no-clobber link, directory barrier, temp unlink, second directory barrier. Atomic replace is limited to active-lease and presence-heartbeat refreshes. A protocol takeover is allowed once, increments the epoch, and never overwrites the previous activation, claim, or result: it publishes the new activation, requester-owned WAL when applicable, then `takeover.json` last, and returns any required action only after that authority commit.

Required transaction state model:

| From | Allowed transition | Constraint |
|---|---|---|
| `PUBLISHED` | `CLAIMED` | only the advertised attempt/epoch can win |
| `CLAIMED` | `ANSWERED` | immutable per-attempt candidate result; not successful until requester acceptance |
| `ANSWERED` | `ACCEPTED` | requester only; `validate_result_for(...)` passes for the current attempt/epoch and exact subject/PLAN, then exclusive no-clobber acceptance wins atomically against cancellation |
| `CLAIMED` | `BLOCKED` | protocol-valid negative terminal result; requester may acknowledge it, but it is never accepted as an answer and never permits phase advance |
| `CLAIMED` | `SUPERSEDED` → new `PUBLISHED` | one expired-lease takeover maximum; new activation/attempt/higher epoch becomes authoritative only when `takeover.json` is published last, and a later ordinary claim enters `CLAIMED` |
| any non-terminal state | `EXPIRED` or `CANCELLED` | transaction-local terminal state; does not stop a persistent peer |

`validate_result_for(...)` rejects a result whose attempt/epoch is not current, even if it arrives late with otherwise valid fields. Competing files remain visible for conflict detection instead of being overwritten last-writer-wins. Same-digest duplicates may be idempotent; conflicting current results force transaction cancellation plus a harness STOP/report with no phase advance. A stale `stop/v1` can never stop a new worker; `stop/v2` is confined to a specific adapter-owned worker session.

The current validator accepts an artifact bound to a HEAD ancestor. Post-PLAN consultation must be stricter, but it must distinguish the reviewed subject from the worker checkout: request/result bind exactly to immutable `subject_head`, `plan_digest`, and `subject_scope_digest`; result records the worker's `producer_head` and `producer_worktree_id` separately as diagnostic provenance and repeats the exact subject snapshot it observed. A target checkout need not equal the subject HEAD, but it must consume the referenced subject snapshot. If the requester's subject HEAD/scope changes before acceptance, the result is stale and a new transaction is required; a result for subject A is never reused implicitly for subject B.

### Adapter drivers and routing

Version and extend the existing ADR-001 nine-operation `RuntimeAdapter` contract with consultation dispatch/await semantics; do not create a parallel `ConsultationAdapter` facade. PREP has already produced the capability ledger and corrected surface mapping; EXECUTE consumes those frozen findings and performs only the two required fingerprint revalidation checkpoints, not another Phase-0 redesign. A host-provided capability manifest/bridge owns runtime-native operations, handshakes, version compatibility, approval flow, and at least one real conformance path for each agreed operating mode. Portable shell code owns the disk transaction/wait floor and cannot pretend to invoke host-native Claude/Codex primitives by itself.

Runtime spawn, app-server, and MCP operations execute only through explicitly registered host bridges outside the portable shell core. A manifest is declarative: allowlisted driver/executable identifiers, fixed argv fields, versions, availability, and approval state. It cannot supply an arbitrary command string, model/permission flags from a request, or anything evaluated with `eval`/shell interpolation. The one retained POSIX supervisor launch uses only a host-derived canonical single-quoted rendering of the closed argv array, inverse-parsed and deep-compared by the gate; models never author its quoting. Reconcile the existing CLI-spawn policy/gate explicitly; do not create a hidden exception that shells out to `claude -p`, `codex exec`, or another model CLI from request-controlled data.

Use one registry/capability probe with deterministic per-role routing. Activation drivers are distinct from wait strategies:

| Activation driver | Use | Required behavior |
|---|---|---|
| `claude-sendmessage` | Wake an existing Claude peer | Send only role + artifact path + kind/request id; never treat reply text as evidence |
| `claude-agent` | Execute one canonical role in Claude without Agent Teams | Outside planner bootstrap only, after request/activation/WAL/inbox are durable, invoke one foreground Agent; no TeamCreate/SendMessage/READY/reuse claim; require a target-gated disk result and ignore final prose |
| `codex-app-server` / persistent thread | Wake a parked Codex worker | Start the retained `session-run` only through the exact top-level-owned `supervisor-start` action/background task, then resume the canonical worker from disk; no operator/out-of-band launch |
| `codex-mcp` | Invoke Codex on demand from Claude or another MCP host | Sandboxed model stays read-only; trusted host validates its correlated result envelope and is the sole publisher of `result/v2`; returned text alone is insufficient |
| `runtime-spawn` | Wake an already-supervised registered disk consumer | Invoke only its fixed allowlisted wake helper; it never starts a model or carries result content |
| `noop` | Notification unavailable | Record diagnostic no-delivery (`commit_point:null`, `delivered:false`, no WAL) and leave progress to an already-registered disk loop or fail closed at deadline |

Requester result polling and optional worker inbox polling are bounded wait strategies, not activation drivers. `noop` plus disk polling completes only when a separately registered external supervisor/worker consumer already exists; otherwise it deterministically times out.

Example policy, stored as configuration rather than hard-coded branching:

```text
verifier:          [codex-app-server, codex-mcp, claude-agent, runtime-spawn, noop]
quality-gater:     [codex-app-server, codex-mcp, claude-agent, runtime-spawn, noop]
arch-platform:     [claude-sendmessage, claude-agent, codex-app-server, codex-mcp, runtime-spawn, noop]
arch-testing:      [claude-sendmessage, claude-agent, codex-app-server, codex-mcp, runtime-spawn, noop]
arch-integration:  [claude-sendmessage, claude-agent, codex-app-server, codex-mcp, runtime-spawn, noop]
context-provider:  [claude-sendmessage, claude-agent, codex-app-server, codex-mcp, runtime-spawn, noop]
doc-updater:       [claude-sendmessage, claude-agent, codex-app-server, codex-mcp, runtime-spawn, noop]
toolkit-specialist: [claude-sendmessage, claude-agent, codex-app-server, codex-mcp, runtime-spawn, noop]
test-specialist:   [claude-sendmessage, claude-agent, codex-app-server, codex-mcp, runtime-spawn, noop]
```

The routing registry chooses the connector for one attempt; the project collaboration policy separately chooses lifecycle mode and role class. The logical role remains canonical regardless of whether Claude or Codex executes it; runtime choice never creates a new authority role. Do not race two active drivers for the same request by default. `SendMessage`, Codex thread/app-server turns, and Codex MCP are host-native bridges selected only after a capability handshake. Use the stable request/attempt/lease fencing above so fallback cannot create two current authors. A late result from a superseded attempt is invalid; two conflicting otherwise-valid results trigger cancellation + harness STOP/report.

### Runtime consultation loop

1. Before request publication, the requester materializes and validates the exact `plan_ref`, immutable routing-policy snapshot, subject bundle, and any optional content-addressed blob. It then publishes `request.json` through the canonical durable no-clobber primitive and validates it. Nested requests carry `root_request_id`, optional `parent_request_id`, and bounded `max_depth` (default 2); role transitions and depth are validated to prevent loops.
2. The adapter checks the host capability manifest/handshake and selects one allowed driver. It publishes the immutable activation; for requester-owned drivers it next durably publishes the activation-intent WAL; only then does it expose `inbox-ref/v1` and return a non-authoritative `ActivationAction`. Either Codex bridge first claims, leases, and admits the item to the per-role scheduler without a WAL; only when that scheduler selects the item for service does the trusted host durably write its WAL, immediately before backend activation. `noop` writes none. Every branch records compatible diagnostic delivery separately.
3. A native/disk target wins the advertised attempt claim through the same no-clobber primitive, publishes/refreshes only its attempt-scoped active lease, performs the role-specific work, and writes its own immutable correlated result through the sanctioned writer. For either Codex driver, the sandboxed model is read-only: the trusted host validates its envelope/correlation and solely publishes `result/v2`.
4. The requester polls/waits with a bounded deadline and atomically records an accepted result only when `validate_result_for(...) == valid` for the active epoch.
5. If the peer is dead or its lease expires, perform at most one canonical respawn/re-invocation with the same request id, a new attempt id, and a higher lease epoch.
6. If no valid result arrives, write transaction `cancel/v1`, emit a harness STOP/report that prevents phase advance, and surface the unresolved consultation. Do not stop an unrelated persistent peer and never synthesize the target's verdict in the orchestrator.

Specialist consultation remains mediated where architecture requires it:

```text
specialist -> architect request artifact
architect -> context-provider nested request artifact (when needed)
context-provider -> architect correlated result artifact
architect -> specialist correlated result artifact
```

The context-provider and architect remain the semantic authors of their answers. Native/disk targets publish through their confined writer; for a Codex-executed role, the trusted host materializes only the validated read-only model envelope as `result/v2`. The orchestrator may schedule, wake, validate, and report; it may not synthesize or impersonate either role.

`context-provider` is a leaf only in the consultation graph. It may originate a separate documentation workflow:

```text
context-provider PATTERN-GAP
  -> request/v1 kind:ingestion
  -> orchestrator obtains explicit user approval/v1
  -> lifecycle wakes/reuses doc-updater
  -> search/deduplicate -> ingest -> validate -> write -> audit
  -> correlated result/v1 ingestion profile -> callback
```

Wave 1 preserves the generic v1 schemas but adds an ingestion-specific consumer that validates exact `request_id`, `request_kind:"ingestion"`, `approval_sha256`, `approver:"user"`, doc-updater authorship/target, disposition, audit status, and confined files. A generic uncorrelated `result/v1` cannot complete ingestion. Missing/denied approval means zero documentation writes; a second equivalent ingestion must take the deduplication path.

### Persistent dual-runtime behavior

- A host-side supervisor owns process/session liveness; language models are not expected to block forever inside one inference call.
- With Claude Agent Teams/native roster capability, `ensureRole` creates or reuses exactly one canonical teammate per configured support role and parks it in WAITING between requests. `SendMessage` is only the notification transport after a healthy binding is proven.
- Without Agent Teams, the same project policy selects retained Codex, canonical single-use respawn+bundle rehydration, adapter MCP, or supervised disk fallback; no path silently assumes `TeamCreate`.
- Claude and Codex workers may be parked in bounded wait cycles, woken by their native surface, and resumed against the configured coordination root.
- Either runtime can initiate a request by writing the same artifact. The other can answer without the user copying text between applications.
- Default mode sets `coordination_root=<worktree>/.planning/coordination`; all new transaction paths use the single namespace defined above. Exactly one root/version is authoritative per request. A legacy v1 adapter is read-only and may translate an observation into diagnostics, but it cannot mirror two authoritative copies or let a v1 marker satisfy v2 completion.
- To support the current “Claude and Codex in sibling worktrees” case, Wave 1 also allows the base `coordination_root` to be explicitly configured to a same-machine host-local directory shared by those worktrees. The root must be canonicalized, symlink-safe, owner-confined (`0700`-equivalent where supported), explicitly granted to both runtimes, and keyed by a stable repository identity separate from worktree ids. Requests bind the reviewed subject snapshot exactly while recording each producer worktree/HEAD separately; different producer HEADs do not invalidate a result by themselves, but an undeclared or changed subject snapshot does.
- Cross-host/network federation remains deferred; a shared coordination root is a same-machine disk transport, not a broker.
- If only one runtime is running, the same protocol works through spawn/MCP/polling or terminates cleanly at its deadline.
- Session restart invalidates old native bindings. A healthy retained worker may be rediscovered; every other role is canonically respawned/reconnected and rehydrated from disk. Idle, dead, and ambiguous are distinct states.

### Fallback matrix

| Condition | Expected action |
|---|---|
| Live Claude peer + `SendMessage` available | Persist request, notify through Claude driver, validate disk result |
| Agent Teams unavailable + `claude-agent` proven in `auto|ephemeral` | Outside planner bootstrap, persist request/activation/WAL/inbox, invoke one Agent, require target-gated disk result, ignore final prose, and make no READY/reuse claim |
| Persistent Codex worker available | Persist request, wake/resume worker, validate disk result |
| No persistent Codex worker + Codex MCP available | Persist request, invoke adapter MCP facade; trusted host validates the read-only model envelope and publishes `result/v2`; only that artifact completes |
| Runtime has no messaging capability | Persist request, record no-op delivery, and use bounded polling only if a registered external worker/supervisor consumes that inbox; otherwise timeout deterministically |
| Canonical peer is dead | One bounded canonical respawn/re-invocation, then continue polling |
| Adapter fails but disk result appears | Accept only after full artifact validation; report adapter degradation |
| No valid result before deadline | Transaction cancel + harness STOP/report; consultation remains unanswered and a persistent peer is not killed |

In the capability-proven persistent default profile, lifecycle acceptance additionally requires: init twice yields the same five bindings with one spawn each; idle wakes the same binding; peer death causes one canonical respawn+bundle rehydration; ambiguous/multiple owners are quarantined rather than guessed; session restart never reports false reuse; Agent Teams disabled exercises the explicit one-shot/retained-Codex/disk fallback; canceling one transaction leaves a healthy support peer WAITING. `ephemeral`/`disk-only` must not claim five live bindings.

### Included scope and probable files

- Phase-0 producer/consumer compatibility census plus a runtime-capability ledger, real host-bridge conformance probe, adapter registry, routing policy, non-authoritative delivery receipts, bounded wait strategies, claim/lease, and one-respawn lifecycle.
- A tracked `runtime-collaboration-policy/v1` with modes `auto|persistent|ephemeral|disk-only`, exact support/wave/phase role classes, bounded readiness/respawn budgets, and a separate gitignored presence registry.
- A shared role-lifecycle controller/provider seam for probe, ensure, discover, READY/WAITING/BUSY, notify, explicit draft→final same-process rebind, reuse, rotate, canonical respawn+bundle rehydration, and owned stop. Claude Agent Teams/native peers are the preferred rich connector when capability-proven, never the portable floor.
- Deterministic transaction paths, role inbox references, acknowledgement/consumption, atomic artifact publication, attempt/lease fencing, strict request/result correlation, and a confined optional sibling-worktree coordination root.
- The frozen seven-file runtime-messaging documentation shape: `docs/agents/runtime-messaging-adapters.md` as the hub plus `runtime-messaging-{protocol,state-machine,drivers,bridges,cp-writer,modes}.md`.
- The original delivery PLAN froze a 99-path schema/ADR/hook manifest, including `docs/agents/coordination-artifact-schema.md`, `docs/adr/ADR-001-runtime-adapter-contract.md`, and `.claude/hooks/coordination-artifact.js`. The authorized maintenance refactor in PR #246 adds bounded internal modules without changing that historical delivery claim or the public runtime contracts.
- Three stable CLI/API facades at `scripts/lib/runtime-{consultation,role-lifecycle,bridge-codex}.cjs` compose cohesive internal modules under their same-named directories. Internal modules own protocol, durability, transactions, lifecycle authority, process isolation, credentials and recovery; consumer inventories recursively include all three trees. Both thin `scripts/sh/runtime-consultation.sh` and `scripts/ps1/runtime-consultation.ps1` argv-forwarding wrappers remain mandatory, together with the real `windows-latest` job required to close SC-17.
- Bats/Node tests under `scripts/tests/` for protocol, transport selection, lifecycle, and failures.
- Planner, specialist, architect, context-provider, doc-updater, orchestrator, and quality-gater guidance/templates; regenerate registries/adapters only where canonical sources require it.
- Exactly five blocking skills: `init-session`, `resume-work`, `work`, `ingest-content`, and `monitor-docs`. Keep their public outcomes distinct and share only the internal policy/lifecycle invocation path; do not migrate the full skill catalog.
- Canonical session/topology/ingestion docs required to operate the lifecycle, plus an explicit post-Wave-1 qualification specification.
- Correct stale runtime capability mapping in ADR/docs after probing the actual Claude and Codex surfaces available at implementation time.
- Keep `capability-preservation.bats` and `named-team-regression-guard.bats` green and unchanged in Wave 1; their protected behavior must remain intact, but neither file is an authorized implementation path in the 99-entry manifest.
- Keep `consult/v1` only as the legacy pre-PLAN context-provider contact marker. Planner bootstrap is exactly two bounded canonical invocations: Pass A writes the `STATUS: DRAFT-CONTEXT-PENDING` PLAN and returns; top-level validates it and, for `auto|persistent`, ensures the full configured support plane in one call; Pass B uses the marker-gated `planner → context-provider` edge to obtain exact CP `consult/v2` → accepted `result/v2`, removes the marker, finalizes, and requires all-role final-digest rebind. Bootstrap excludes recursive `claude-agent` and requester-launched MCP/runtime-spawn. No pre-existing final PLAN or live SendMessage is required. Post-PLAN architect/specialist flows use the same correlated v2 contract; writing a v1 marker alone never means “answered”.
- Add the narrowly confined context-provider result-publication path for its active claim; preserve its read-only boundary everywhere else.

### No-go / out of scope

- Runtime message bodies as evidence or authority.
- Mandatory Claude `SendMessage`, mandatory MCP, or mandatory persistent processes.
- A bespoke network broker, cloud queue, or cross-host federation. A confined same-machine coordination root for sibling worktrees is included.
- Reintroducing `TeamCreate` as the portable floor.
- Unlimited polling, unlimited respawn, duplicate concurrent invocations, or orchestrator-authored role results.
- General class-aware phase/topology/skill-catalog mechanization; Wave 1 owns only the minimum consultation/session lifecycle and five blocking entrypoints, while Wave 6 composes it globally.
- General phase/topology state-machine work (Wave 6), verdict grammar redesign (Wave 3), or push authorization redesign (Wave 5).
- Concrete Copilot, generic GPT, Kimi/Kimchi, IDE-chat, arbitrary-GUI wake, network-broker, or cross-host connector implementations. They remain future providers over the disk contract and require their own capability/security/conformance evidence.

### Principal risks

- Duplicate or late workers produce conflicting results.
- A transport reports delivery while no worker actually claims the request.
- MCP returns plausible prose without writing an artifact.
- Non-atomic writes expose partial JSON to pollers.
- Stale PLAN/subject snapshot, stale worker-stop sentinels, self-declared role spoofing, unconstrained content references, or an empty `result/v2` passes a structurally weak validator.
- Persistent sessions disappear between wake and response; unbounded recovery becomes a zombie loop.
- A lifecycle/presence layer is mistaken for authority, or fixed support roles leak into every project/wave despite tracked policy.
- Repeated single-use respawns recreate the observed million-token planning cost instead of reusing healthy canonical support roles.
- Runtime docs encode capabilities that have changed; capability probes and adapters must isolate that churn.
- Subject and producer HEADs are conflated, or sibling worktrees consume a transaction from the wrong repo/worktree namespace.
- **CONFIRMED empirically 2026-08-23** (mission `WAVE1-FUNCTIONAL-CLOSEOUT-REALISTIC-20260822`, mailbox sequence 12): the "lifecycle/presence mistaken for authority" risk above is not hypothetical. `createMainOrchestratorBinding` (`scripts/lib/runtime-role-lifecycle.cjs`) mints its binding from mechanically-observed session identity + `worktree_id` + `plan_digest` only — no human-consent input of any kind — and `isRootSourceGrantContext` (`scripts/lib/runtime-consultation.cjs`) checks only the binding's schema *type* (v1/v2), never who authorized the action. The real `toolkit-specialist` agent template (`.claude/agents/toolkit-specialist.md`) carries no root-source/authority logic at all — the prior root-source-mint declines this mission cited as proof-of-safety were unenforced LLM judgment calls by whichever agent received the bootstrap prompt, not a code-level gate, and are not reliably reproducible under sustained retry pressure. **Not yet scoped or built**: a request-scoped confirmation artifact producible only by a live human (never another AI's assertion), a mint-time gate requiring it, and dispatch-time enforcement of freshness + exact-request-scope. This is genuinely new work matching the BL-W4-12/Wave 3–5 actor-authorship boundary below, not a Wave-1 patch. Root-source live execution (Matrix 3) itself reached GREEN (mailbox sequence 48: real five-role `codex-app-server` support plane, disk-authoritative chain, a current accepted result and ack, real cited Context7 evidence, zero repository mutation) without this gate existing — that live run is no longer `repair_ready`. The human-consent confirmation-artifact gap identified above remains separately unresolved and unscoped; it is a durable hardening item Matrix 3's own live execution was not blocked on, not a closed finding. See `project_wave1_functional_closeout_realistic_20260822_blocked.md` memory for full detail.

### Verification expected

- Producer→schema→path→consumer compatibility census; legacy v1 fixture tests plus fixed `consult/v2`, `result/v2`, `inbox-ref/v1`, `cancel/v1`, and session-bound `stop/v2` tests.
- Materialize-before-publish, persist-before-activate, durable two-barrier no-clobber publication, bounded exclusive transition-lock timeout+STOP (never age reclaim), lease-only atomic-replace, and no-clobber acceptance tests.
- Deterministic-path/inbox discovery bounds, path traversal/symlink, payload-size, confined `content_ref`, digest, ACK, retention, and cleanup tests.
- Transaction-state-table tests with `attempt_id` + `lease_epoch` fencing; immutable competing results, same-digest idempotence, no last-writer-wins replacement, single takeover, superseded-result rejection, and stale-stop-after-respawn rejection.
- Activation-driver contract tests for Claude SendMessage, one-shot `claude-agent`, persistent Codex, Codex MCP, registered-consumer wake, and no-op, plus separate requester/worker polling tests: available, unavailable, timeout, and transport failure.
- Host capability-manifest handshake, version mismatch, approval-denied, hostile argv/newline/metacharacter, owner-permission, and arbitrary-command rejection tests; prove shell-only mode never claims a native driver it cannot invoke.
- Split fake-driver CI conformance from opt-in host integration tests. Rich adapters may capability-gate a SKIP only when unavailable; disk-floor tests always run. Demonstrate a real host bridge for persistent dual-runtime and on-demand MCP modes or stop the wave as incomplete.
- MCP/App-server test proving model/transport text without a valid host-published result artifact is rejected.
- Dead-peer → one respawn → valid result, and dead-peer → exhausted recovery → transaction cancel + harness STOP tests; prove timeout does not kill an unrelated persistent peer.
- Wrong-role, disallowed direct specialist→context-provider transition, nested-depth overflow, wrong/root/parent request, stale subject HEAD/scope/PLAN, empty-content, malformed, duplicate, late-attempt, and conflicting-result rejection.
- Two-poller/claim race, idempotent re-read, backoff/deadline, session-exact worker stop, transaction cancel, and cleanup tests.
- End-to-end same-worktree Claude ↔ Codex consultation and specialist → architect → context-provider → architect → specialist chain.
- In the capability-proven persistent profile, Claude support-plane conformance: exactly five support bindings, init-twice idempotency, two consultations separated by idle, quality-gater consultation with live architects, and no quality-gater in the persistent set; separate one-shot and disk-only profiles prove no false five-binding claim.
- Peer-death canonical respawn+bundle rehydration, runtime-restart no-false-reuse, ambiguous-binding rejection, and Agent-Teams-disabled fallback.
- PATTERN-GAP ingestion denial/zero-write, approved doc-updater wake/reuse and correlated completion, and second-ingestion deduplication.
- End-to-end sibling-worktree Claude ↔ Codex consultation through a confined shared root, including different producer HEADs with exact subject binding and changed/undeclared subject rejection.
- Portability proof with every rich adapter disabled: disk-only flow completes only with a registered polling worker or otherwise fails closed deterministically.
- Planner bootstrap proof: exactly Pass A → top-level disk validation/full-plane single ensure → Pass B; no lifecycle/READY claim before a draft exists; Pass B's first Bash is the exact branch-aware CP consultation chain through the draft-only planner→CP edge; recursive/requester-launched drivers are filtered; marker-bearing drafts cannot receive PREP verdicts; a valid accepted CP result is required before final PLAN, and ordered `role-rebind` actions move every retained support peer to the final digest without respawn.

### Backlog and memory impact

- **Closes/touches**: agent-teams notification residual (local portion), the operational gap left after Portable Coordination Artifacts, BL-W32-04 context-provider zombie behavior when reproduced, the lifecycle-critical portion of BL-W4-11, and the live-collaboration part of the optional Topology Pilot.
- **Touches, does not close**: BL-W4-12 (actor/role authorship), because cryptographic or OS-level identity is not promised here; Wave 3 and Wave 5 complete the policy/evidence sides.
- **Memory on ship**: create `project_wave_portable_runtime_collaboration_lifecycle_shipped.md`; refresh Portable Coordination Artifacts, ingestion, session/topology, skills-entrypoint, and harness-audit memories with the shipped consumer loop, role classes, exact connectors, compatibility decision, and measured degraded-mode/respawn behavior.
- **R33 native (M2-M5/M9-NATIVE) status**: PENDING_EXTERNAL_RELEASE — the native execve-census/accredited-executable-set path (Model B, WP3-ABI) depends on a platform release not yet available; this does not block Wave 1 functional closure. Full reconciliation against measured results lands with the M8-B documentation pass.

---

## Mandatory post-Wave 1 checkpoint — Agent & Skill Behavioral Restoration Qualification

**Kind**: read-only program qualification; this is not an implementation wave.

**Status**: COMPLETE (2026-09-20). Zero P0/P1 Wave-1 lifecycle/consultation/authority/ingestion defects found — the Wave-1 stabilization batch was not triggered. One non-blocking Wave-1 fast-follow was found (planner→context-provider bootstrap-edge gap, see Wave 1 section Status line above). Full behavior matrix, skill/command disposition census, and routing decisions recorded in memory `project_post_wave1_agent_skill_behavioral_qualification.md`. This unblocks the Wave 2 promotion below.

**Historical promotion gate**: Wave 2 could not be promoted until this checkpoint completed and every finding had an owner. A P0/P1 Wave-1 defect in consultation, lifecycle, disk authority, or ingestion would have returned to one bounded Wave-1 stabilization batch rather than creating a chain of micro-waves.

**Objective**: prove on AndroidCommonDoc and a representative KMP consumer that the restored collaboration behaves as intended, then reconcile observed behavior against git history, merged plans/PRs, README, agent documentation, skills, commands, adapters, MCP surfaces, tests, and durable memory.

**Required behavioral qualification**:

- Verify that `context-provider`, `doc-updater`, `arch-platform`, `arch-testing`, and `arch-integration` remain addressable through a persistent session, survive idle periods, retain canonical identity, and are not respawned for each consultation.
- Verify specialist → reporting architect → context-provider → architect → specialist, including two consultations separated by idle and a quality-gater consultation while architects remain available.
- Verify context-provider → durable ingestion request → explicit user approval → doc-updater → search/ingest/validate/audit → correlated result, including denial/zero-write and a second ingestion with deduplication and peer reuse.
- Verify canonical respawn and disk-bundle rehydration after real peer loss or session restart; never report a dead binding as reused.
- Exercise Claude Agent Teams persistent mode, Claude without Agent Teams, retained Codex/app-server, adapter MCP on demand, disk-only supervised fallback, and one mixed Claude/Codex flow without manual copy/paste.
- Reconstruct the useful pre-degradation collaboration baseline from approximately 20–30 pre-harness PRs and distinguish it from the intentional removal of mandatory `TeamCreate`.
- Census canonical `skills/*/SKILL.md`, `.claude/commands`, `.agents/skills/source-command-*`, generated adapters, agent templates, MCP/script invocations, hooks, tests, and registries at the checkpoint HEAD.
- Exercise at minimum `/init-session`, `/resume-work`, `/work`, documentation ingestion/monitoring/auditing entrypoints, verifier/QG routing, and every surface that directly invokes `Agent`, `SendMessage`, MCP, or a runtime-specific primitive.
- Compare documented and observed behavior; classify missing, undocumented, obsolete, aspirational, runtime-specific, and portable behavior.
- Record spawn count, canonical binding/identity, reuse across idle, wake/result outcome, context-bundle reads, fallback path, ingestion approvals/writes, and invalid-result rejection.

**Required deliverable**: one durable behavior matrix:

```text
behavior_id -> historical source -> current documentation -> expected behavior
  -> runtime/profile -> owner role -> authoritative artifact
  -> observed evidence -> status -> disposition -> owning wave
```

Skills and commands additionally receive exactly one provisional disposition: `KEEP`, `REWRITE`, `MERGE_INTERNAL`, `ALIAS`, `PROMOTE`, `RUNTIME_SPECIFIC`, `DEPRECATE`, or `DELETE`.

**Disposition rules**:

- Wave-1 lifecycle/adapter/ingestion regressions block promotion and return to the bounded stabilization batch.
- Input-boundary findings route to Wave 2; verdict/evidence/push findings to Waves 3–5.
- Phase, topology, entrypoint, skill-routing, internal merge, alias, and deprecation work routes to Wave 6.
- README, catalog, prose, migration, memory, and global documentation drift routes to Wave 7.
- Product/runtime adapters not required by the Wave-1 contract remain incubator items.

**No-go**: implementation during the checkpoint, deleting or merging skills from usage counts alone, treating historical prose as authority, reviving fixed `TeamCreate` assumptions literally, or marking behavior valid solely because a message was delivered. Current telemetry does not reliably attribute every invocation to `skill_name`; no deletion decision is admissible until attribution is fixed and observed across at least two cycles with consumer/alias/conformance evidence.

**Rationalization candidates to evaluate, not pre-approved deletions**:

- Keep `init-session`, `resume-work`, and `work` as distinct public entrypoints; `MERGE_INTERNAL` only their lifecycle/session engine.
- Consider `test-full` as an alias of `test-full-parallel` only if parameters, errors, artifacts, and serial/parallel semantics prove equivalent.
- Share a backend between `coverage` and `coverage-full` while preserving distinct outcomes/modes where they remain real.
- Consider `validate-upstream` as an alias of `audit-docs --waves 3`; legacy `doc-check` → `doc-integrity`; `doc-update` → doc-updater workflow; `sync-tech-versions` → `sync-versions`/`check-outdated`; `start-track`/`merge-track` → `git-flow`; `pre-release` → `pre-pr` + QG/release—only after consumer/equivalence evidence.
- Keep `web-quality-audit` as a thin aggregator over atomic web skills if aggregation is a real user outcome.
- Do not merge `audit`/`full-audit`/`pre-pr`; `audit-docs`/`doc-integrity`/`readme-audit`/`monitor-docs`; the SBOM trio; `test`/`test-changed`/`test-full-parallel`; KDoc audit/migrate/API generation; or `review-pr`/`pre-pr` merely because names overlap.

Any merge/deprecate/delete requires: no unique outcome; replacement parity across parameters, side effects, errors, authority artifacts, and runtime profiles; consumer/reference migration; alias window; green conformance; reliable telemetry for at least two cycles; synchronized registry/generators/docs; and zero consumer breakage.

**Memory on completion**: create `project_post_wave1_agent_skill_behavioral_qualification.md` with the matrix, runtime observations, historical sources, measured cost, and routing decisions.

---

## Wave 2 — Workflow Expression & Input Boundary Audit

**Class**: SECURITY / HARNESS

**Status**: SHIPPED — MERGED to `develop@fa7f6cf8` (2026-09-21). PR #249 (`fa7f6cf8`, "fix(ci): harden workflow input boundaries"), squash-merged; merge tree byte-identical to the approved PR head tree `7e634353`. 30/30 required checks passed, 0 unresolved review threads, CLEAN merge state before merge; PLAN digest `8f5e1849f42af77b4c0fcffa3e2f884c70adf6c1e564b261203ce3611cd50a05`. Scope matches the ten audited workflows/templates recorded in `CHANGELOG.md` (the eight-workflow census below plus `l0-release-assets.yml` and `setup/templates/workflows/l0-auto-sync.yml`), together with `qg-path-audit.sh` H2/H3/table-form parser hardening and the new `docs/agents/quality-gate-local-ci-reproduction.md`. Evidence: full Bats 3391/3391 (`qg-linux-canonical` six-shard profile), MCP Vitest 2665/2665, ESLint 0 errors, documentation/registry/secret-scan/path-manifest validation PASS, three independent architect VERIFY-FINAL verdicts APPROVE. Local/CI reproduction now documents three distinct profiles — `ci-linux-equivalent` (four-shard), `qg-linux-canonical` (six-shard), `windows-native` — never conflate them; macOS remains intentionally skipped for `develop`-targeted PRs. Full record in memory `project_wave_workflow_input_boundary_audit_shipped.md`. R33 native remains `PENDING_EXTERNAL_RELEASE` (unchanged, out of Wave 2 scope). The HTML-escaping residual is owned canonically by `BL-CONS-P2-01`; it does not reopen Wave 2.

**Objective**: inventory and harden every untrusted GitHub Actions value that crosses into a shell or privileged workflow operation, extending G0 from its focused fix to a repository-wide trust-boundary contract.

**Why second**: G0 established the corrected targeted pattern. Wave 1 then gives this broad security audit portable Claude/Codex review paths. The audit precedes new evidence and push machinery so later waves build on trustworthy CI inputs.

**Included**:

- Recount every `${{ inputs.* }}`, `${{ github.event.inputs.* }}`, dispatch input, reusable-workflow input, and relevant tainted step output at the wave's starting HEAD.
- Review direct expression interpolation inside `run:`, safe `env:` projection, shell quoting, boolean coercion, arrays/multiline values, validation/allowlists, output propagation, and least permissions.
- Post-G0 census recorded at `619d9a7`, excluding the four workflows closed by G0: 36 `${{ inputs.* }}` run-block sites across eight workflows — `readme-audit.yml` (19), `doc-audit.yml` (3), `doc-monitor.yml` (1), `reusable-architecture-guards.yml` (1), `reusable-check-outdated.yml` (3), `reusable-kmp-safety-check.yml` (3), `reusable-audit-report.yml` (3), and `reusable-commit-lint.yml` (3) — plus three `github.event.inputs.tag_name` run-block sites in `.github/workflows/l0-release-assets.yml`. Recount at the Wave-2 starting HEAD.
- Treat `l0-release-assets.yml` as elevated risk because it has `contents: write`; if it must run before Wave 2, either bring that focused check forward or block the run pending review.
- Add a repeatable extractor/check so the inventory does not depend on a one-time grep.
- Apply the same trust-boundary review to skills/commands that construct or propagate workflow/CLI inputs, selected from the qualification census by actual input flow rather than a hard-coded skill list. This wave fixes quoting, enums, defaults, injection boundaries, and parity; it does not rationalize their UX or lifecycle.

**No-go**: action-SHA pinning program, release architecture redesign, unrelated workflow DRY work, or broad permission changes not justified by the taint path.

**Risks**: YAML/expression/shell quoting interactions; false confidence from simple regex; trusted-looking step outputs that preserve taint; behavior changes in release paths.

**Verification expected**: parser/extractor fixtures for scalar, multiline, folded, nested, and allowed `if:`/`with:` contexts; shell tests for hostile values; actionlint/YAML validation; focused workflow tests; required CI; manual review of every write-capable workflow.

**Backlog entries**: closes the broader reusable/workflow input-handling audit created by G0; records any unrelated release hardening as separately justified residual rather than expanding this wave.

**Explicit residual (P2, separately owned)**: `reusable-audit-report.yml`'s downloadable HTML interpolates raw `project`, `layer`, and `cve_high` values from the audit JSONL. This is a pre-existing HTML-escaping gap, not a shell or privileged-operation boundary introduced by Wave 2. A bounded follow-up must escape rendered text with `html.escape(..., quote=True)` and prove hostile tags are absent from generated HTML; it is not silently claimed as fixed by this wave.

**Memory on ship**: link the final G0 shipped record; create `project_wave_workflow_input_boundary_audit_shipped.md` with the complete inventory, allowed patterns, elevated-permission review, and residuals.

---

## Wave 3 — Structured Verdict Evidence Contract

**Class**: HARNESS / EVIDENCE

**Status**: SHIPPED — PR #250, merged at `develop@dfc48cf`.

**Policy supersession (2026-09-27)**: the shipped provenance machinery remains,
but its historical default of two local full runs is superseded. Current policy is
one complete six-shard local aggregate for push plus required GitHub `CI Gate` for
merge. The historical bullets below describe PR #250 and are retained as history,
not current operator instructions.

**Plan**: `.planning/wave-structured-verdict-evidence-contract/PLAN.md`, current raw-byte SHA-256 `aac4ad96d2b7c8fb947df7591996ccc33504b667860d2d5420a9ec01800d2240` (the digest bound by the final local acceptance). Its planning-only header records the pre-execution state; the later direct user instruction authorized implementation without treating that header as current execution authority.

**Objective**: replace substring/token-based PREP and VERIFY-FINAL acceptance with a strict, correlated verdict record whose decision, rationale, evidence references/digests, role, PLAN, and HEAD are machine-validated.

**Why third**: Wave 1 establishes correlated role results and Wave 2 secures CI inputs. Verdicts can then reuse the correlation/freshness primitives instead of inventing a second messaging protocol.

**Included**:

- Define explicit verdict schema/grammar, decision enums, required non-empty rationale, evidence references/digests, author role, phase, PLAN digest, HEAD, and request/dispatch correlation.
- Reject verdict tokens embedded in prose, duplicate/conflicting decisions, empty sections, unknown enums, stale artifacts, wrong-role authors, and unbacked evidence claims.
- Bind `APPROVED-PREP` and `APPROVED-VERIFY-FINAL` to the exact phase transition and evidence set they authorize.
- Decide how verdicts relate to Wave 1 `result` artifacts without conflating consultation responses with phase authorization.
- Reconcile verdict-consuming/producing behavior in `verify`, `review-pr`, `audit`, `full-audit`, `audit-docs`, `doc-integrity`, and `audit-l0` so each names the same evidence authority, binding, and fail-closed semantics. Preserve distinct public outcomes.

**No-go**: claims of cryptographic human/agent identity, redesign of test provenance, or a broad phase-state machine.

**Risks**: breaking old verdict fixtures; ambiguous migration between prose files and structured artifacts; a strict syntax that encourages boilerplate without better evidence.

**Verification expected**: parser fixtures for token-in-prose, missing/empty body, duplicate decision, wrong role/phase/request, stale PLAN/HEAD, altered evidence digest, and valid PREP/VERIFY-FINAL; end-to-end proof that no unbacked verdict advances the gate.

**Backlog entries**: closes the Wave A `APPROVED-PREP` and `APPROVED-VERIFY-FINAL` evidence gaps; materially addresses BL-W4-12 but leaves true runtime actor authorization to Wave 5.

**Memory on ship**: create `project_wave_structured_verdict_evidence_contract_shipped.md`; update the Wave A evidence-integrity and phase-orchestration memories with the new verdict format and migration boundary.

---

## Wave 4 — Reproducible Evidence & Bats Provenance

**Class**: HARNESS / EVIDENCE

**Status**: SHIPPED — PR #250, merged at `develop@dfc48cf`.

**Objective**: make test and quality-gate evidence independently reproducible, comparable across runs, and fail closed when handoff selection, metadata, target, environment, or counts disagree.

**Why fourth**: strict verdicts need a trustworthy evidence object to cite. This wave builds on Waves 1 and 3 correlation and avoids redesigning result/verdict schemas twice.

**Included**:

- Enumerate all Bats/QG handoff producers and consumers; centralize selection and validation rather than relying on newest-wins discovery.
- Bind run identity, HEAD, PLAN/wave, target/scope, started/finished timestamps, complete/total/not-ok counts, verdict, target digest, environment fingerprint, and relevant tool versions.
- Require agreement across the declared evidence set; reject count/metadata disagreement, stale handoffs, wrong target/scope, and truncated runs.
- Establish an independent rerun policy. Default target: two agreeing full runs for security-critical mint evidence, with explicit documented exceptions where cost requires a different rule.
- Make project-root handling under Bats fail closed and portable; update stale quality-gate protocol prose to the shipped metadata contract.
- Bring `test`, `test-changed`, `test-full`, `test-full-parallel`, `android-test`, `extract-errors`, `coverage`, `coverage-full`, `auto-cover`, `benchmark`, `eval-agents`, and the reproducibility portion of `pre-pr`/metrics onto the same run/provenance contract. Repair per-skill telemetry before using it to infer disuse.

**No-go**: reopening Wave C's already-closed manifest artifact binding, redefining `bats_complete`/`bats_verdict` unless an audit finds a real defect, or restoring untested PS1 mint authority without a PowerShell parity environment.

**Risks**: nondeterministic environment fingerprints; excessive runtime; accidental acceptance of two runs derived from one cached artifact; compatibility with macOS/Bash 3.2 tooling.

**Verification expected**: two independent full-run comparison; disagreement/newest-wins rejection; stale HEAD/PLAN, wrong scope/target/digest, truncated and reused-artifact tests; portable project-root tests; docs-contract checks; canonical mint and proof verification.

**Backlog entries**: closes the Wave A rerun-until-green/reproducibility residual, unsafe `PROJECT_ROOT` under Bats, and stale `quality-gate-protocol.md` metadata coverage. `bats_evidence complete/total` remains recorded as already resolved by Wave C.

**Memory on ship**: create `project_wave_reproducible_evidence_bats_provenance_shipped.md`; update Wave A/C and macOS QG memories with the final handoff schema, rerun policy, and measured cost.

---

## Wave 5 — Native Push Authority & Peer Authorization Policy

**Class**: SECURITY / HARNESS

**Status**: SHIPPED — PR #250, merged at `develop@dfc48cf`.

**Objective**: make the installed git `pre-push` hook the sole portable push authority, redesign advisory runtime push-intent detection, and define what runtime-specific controls can honestly restrict which peer may request or perform a push.

**Why fifth**: H1 bootstrapped the git authority but intentionally left command detection open. This redesign should consume the structured verdict and reproducible evidence contracts from Waves 3-4 rather than encode their old weak forms.

**Included**:

- Preserve the git-layer pre-push hook as the load-bearing enforcement point for refs and proof artifacts.
- Replace fragile command-string/regex detection with parsed command intent or a narrower, testable advisory design covering quoting, wrappers, backticks, substitutions, chained commands, aliases, and explicit exceptions.
- Define peer authorization as a policy/capability layer: portable disk evidence proves conditions; rich runtimes may additionally restrict actor/tool access when they expose a real identity/capability boundary.
- Clarify that a Claude/Codex hook claiming an actor name is defense-in-depth unless backed by a non-spoofable runtime capability.
- Reconcile `pre-pr`, `commit-lint`, `git-flow`, and release aliases/commands with QG/push-proof consumption and peer authorization; broader catalog consolidation stays in Wave 6.

**No-go**: making a JS/runtime hook the sole push authority, regex patch accumulation, blocking harmless text that merely contains `git push`, or promising cross-runtime identity guarantees that the host cannot enforce.

**Risks**: shell grammar complexity; false positives/negatives around wrappers; bypass through alternate git transports; confusing evidence authority with actor authorization.

**Verification expected**: adversarial command corpus with evasive spelling and benign false positives; direct git/pre-push integration; missing/stale/invalid proof rejection; explicit exception tests; rich-adapter unavailable path proving git-layer enforcement still holds.

**Backlog entries**: closes H1's deferred CRITICAL command-string detector redesign and advances BL-W4-12 from discipline-only to the strongest honest host/runtime policy available.

**Memory on ship**: create `project_wave_native_push_authority_peer_policy_shipped.md`; update H1 shipped memory with the detector successor, exact portable authority boundary, and any runtime-specific actor guarantees.

---

## Wave 6 — Class-Aware Phase, Topology & Skill Orchestration Control Plane

**Class**: HARNESS

**Status**: SHIPPED — PR #250, merged at `develop@dfc48cf`.

**Objective**: mechanize the PREP → EXECUTE → VERIFY-FINAL → QG lifecycle, derive required roles from wave class, and make every orchestration entrypoint and skill route through one runtime-neutral lifecycle/control plane.

**Why sixth**: this is the final behavioral composition step. It consumes the portable lifecycle, verdict, evidence, and push contracts after they stabilize; Wave 7 then documents the demonstrated system globally.

**Included**:

- A fail-closed phase state machine with legal transitions and persisted state.
- Class-aware role floors for HARNESS, DOC, and FAST-PATH; resolve required architects/specialists from declared scope rather than a fixed roster.
- Selective ensure/wake/reuse/park/rotate/stop behavior using Wave 1; no parallel lifecycle implementation.
- Mechanize `wave-topology.yaml`, required-role resolution, quality-gate integration, and the currently inert Rule A in `wave-phase-gate.js`.
- Move `/init-session`, `/resume-work`, and `/work` fully onto the shared lifecycle/control plane; keep their public intentions distinct while removing duplicated runtime-specific orchestration.
- Qualify every canonical skill, command, `.agents` wrapper, generated adapter, agent template, registry entry, and MCP-facing entrypoint against the post-Wave-1 behavior matrix.
- Implement approved internal merges, aliases, rewrites, deprecations, and removals with migration coverage. Preserve distinct user outcomes even when implementations share an engine.
- Remove direct `Agent`/`SendMessage`/vendor-specific lifecycle knowledge from public skills except inside declared runtime connectors.
- Resolve the missing `/quality-gate` entrypoint decision and stale/nonexistent skill references such as historical `material-3-skill` paths.
- Run the deferred Topology Pilot with measured persistent-peer vs on-demand/subagent/disk-only comparisons.

**No-go**: mandatory `TeamCreate`, spawning every role for every wave, bulk deletion from incomplete telemetry, renaming/removing public skills without aliases and consumer checks, merging skills with distinct outcomes, another state ledger, reimplementing Wave-1 transports, or changing domain/product architecture.

**Risks**: deadlocks from over-strict transitions; class misclassification; fixed-roster drift reappearing in generated surfaces; lifecycle automation stopping a still-needed worker; removing a low-observability but externally consumed skill.

**Verification expected**: state-transition tests; role-floor fixtures; illegal-transition rejection; entrypoint idempotency; two invocations reusing canonical peers; routing parity across runtime profiles; skill/command/registry/template/generated-adapter parity; alias/deprecation migration tests; absence of undeclared direct runtime bypasses; measured Topology Pilot.

**Backlog entries**: closes BL-W4-10, the behavioral portion of BL-W4-11/BL-W4-8, Wave 39 W19-#3/#4/#6, BL-W47 Topology Pilot, BL-W47-PREPR-1, and evidence-backed skill rationalization/dead-skill candidates. Documentation/count/catalog closure belongs to Wave 7.

**Memory on ship**: create `project_wave_class_aware_phase_topology_skill_control_plane_shipped.md`; update phase-orchestration, adaptive-harness, Wave 19 topology, topology-pilot, skill/command qualification, and entrypoint memories with measurements, final role floors, and migration decisions.

---

## Wave 7 — Documentation & Operational Baseline Closure

**Class**: DOC / GOVERNANCE

**Status**: SHIPPED — PR #250, merged at `develop@dfc48cf`.

**Objective**: reconcile every public and operational description of the harness with behavior demonstrated by Waves 1–6 and establish one trustworthy post-program documentation baseline.

**Why seventh**: every earlier wave updates the documentation required to operate its own contract. This final wave performs the global cross-surface reconciliation only after runtime behavior, evidence, authorization, topology, and skill routing are stable.

**Included**:

- Re-run README, documentation, registry, command, skill, agent, MCP, hook, template, generated-adapter, link, frontmatter, version, and count audits at the Wave-7 starting HEAD.
- Reconcile README architecture, script/tool/skill/agent counts and tables, agent/testing hubs, MCP catalog, available-skills catalog, and setup/session examples.
- Reconcile `docs/agents` topology, session setup/resume, consultation, persistent lifecycle, ingestion loop, runtime profiles/fallbacks, quality-gate protocol, push authority, and limitations.
- Update ADRs to distinguish authority protocol, lifecycle manager, runtime connectors, notification transports, and project policy.
- Publish the final skill/command catalog, aliases, deprecations, migration paths, runtime-specific availability, and canonical source-of-truth rules.
- Reconcile BACKLOG and MEMORY: compact shipped/stale entries, retain historical lessons, and remove executable wording from superseded plans.
- Close every documentation-vs-observed-behavior finding from the post-Wave-1 checkpoint or record an explicit owner and reason it remains open.
- Generate and validate all derived documentation/adapters through their canonical process.

**No-go**: introducing runtime behavior, silently fixing functional code, reviving aspirational claims without evidence, deleting historical evidence, or postponing documentation required to operate Waves 1–6 until this wave. A functional defect discovered here blocks closure and returns to its owning wave; it is not repaired inside this DOC wave.

**Risks**: publishing volatile counts as permanent facts; generated/manual surface divergence; documenting one rich runtime as portable behavior; erasing intentional historical decisions while cleaning stale prose.

**Verification expected**: `/readme-audit`; docs structure/link/frontmatter/upstream validators; agent/skill/registry/template parity; generated-adapter diff; MCP/tool catalog census; secret scan; zero unresolved documentation-vs-observed findings without an explicit owner; manual review of every portability and authority claim.

**Backlog entries**: closes the README audit baseline recorded at `619d9a7`, Post-#245 documentation precision, the documentation portion of BL-W4-8/BL-W4-11, `dual-location-protocol.md` registry-sync omission, Wave 39 BL-W36-02/03 after re-audit, agent/testing hub drift, and all documentation residuals routed by the qualification checkpoint.

**Memory on ship**: create `project_wave_documentation_operational_baseline_closure_shipped.md`; update the roadmap, README-audit, skills/commands, runtime-adapter, topology, ingestion, QG, and harness-audit memories with the final baseline and remaining explicitly owned residuals.

---

## Historical consolidation and incubators

The shipped seven-wave program closed the old portable-coordination loop,
workflow-input census, weak verdict tokens, evidence reproducibility, command
push detector, phase mechanization, topology pilot, BL-W4-8/10/11, Wave 39
W19-#3/#4/#6, and BL-W36-02/03. Wave 40's generic L2-hardening premise was
superseded by the real consumer exercise and PR #251. BL-W47 Ex-PR6 and the old
dead-skill cleanup are not executable without new evidence.

The following remain trigger-only and are deliberately not duplicated in the
P0/P1/P2 queue:

- `BL-W36-04` stash/baseline methodology: reproduce against current tooling
  before proposing work.
- `BL-W37-03/04`: L1/supply-chain ownership for empty-Bats workflow behavior
  and immutable L0 workflow pinning.
- Duplicate `MAX_LINES = 435` and commit-lint semantics: opportunistic shared
  helper work only when an owning implementation changes.
- RTK template sweep: requires separate explicit user approval.
- Release watcher, headless Compose rendering, plugin generalization, OSS
  packaging, and hypothesis triage: product/tooling roadmap with a concrete
  trigger, not runtime stabilization.
- Skill deletion: requires reliable attributed telemetry across at least two
  consumer cycles; current evidence authorizes no deletion.

## Completed / stale entries compacted from Active

The following are historical, not executable backlog items:

- **Harness Realignment Waves 0-5** — merged through PRs #234-#238 and #242. Wave 6's old optional Topology Pilot is incorporated into ordered Wave 6 above.
- **Wave A — QG Evidence Integrity** (`19db9d2`, PR #240) — D0/D2/D3/D6 resolved.
- **Wave B — macOS local-green portability** (`e726ca9`, PR #239) — also resolved BL-W4-14 canonical `worktree_id`; do not keep it OPEN.
- **Wave C — QG Artifact Binding** (`7428b81`, PR #241) — D5, secret-scan wording, manifest artifact binding, and Bats `complete/total` evidence resolved.
- **Wave 4 parity follow-ups BL-W4-1/2/3/4/6/7/9** (`30de240`, PR #238) — resolved. BL-W4-5 was audited as not a bug. BL-W4-13 is an operational lesson: never symlink a mutable `node_modules` into a disposable worktree.
- **BL-W37-02 hook distribution** (`2aba991`) — resolved; `.claude/hooks/` is propagated by `sync-l0`.
- **BL-W47-HOOK-MANIFEST** (`1d9355f`) — the canonical hook-classification document shipped; only optional consumer-settings validation remains.
- **Wave 38 content ingestion** (`0db5773`, PR #242) — shipped; do not schedule the old content list again.
- **Platform Shift** — environment migration shipped and macOS-primary operation confirmed; Windows-only items are dead.
- **H1 — Push Authority Bootstrap** (`1e0be41`, PR #243) — shipped; its deferred detector redesign closed in Wave 5.
- **G0 — Reusable Workflow Input Boundary Hardening** (`619d9a7`, PR #245) — shipped. Its focused boundary and mapped Wave-2/Wave-7 follow-ups are closed.

## Shipped (recent)

- **Consumer-contract convergence** — MERGED `develop@a89005cf` (2026-09-28), PR #253. Closed byte-stable sync and executable-mode repair, source-referenced hook/runtime launch, clean L1/L2/worktree acceptance, and the one-local-full-run plus required-GitHub-CI contract. Its temporary `PRUNEABLE` workstreams were removed after merge.
- **Post-first-consumer stabilization** — MERGED `develop@51598ec` (2026-09-27), PR #252. Closed malformed-settings fail-open behavior, bounded safe one-shot recovery, positive effort telemetry enforcement, formal-wave Bats fixture isolation, manifest-aware portable hook registrations, ordinary/runtime composition, CLI discovery side effects, and deterministic adapter checks.
- **First-consumer runtime hardening** — MERGED `develop@c5ee193e` (2026-09-27), PR #251. Closed all 13 post-PR-#250 consumer findings with source-referenced runtime hooks, executable-mode repair, topology/YAML closure, exact launch/recovery documentation, atomic Claude host recertification, bounded certification startup, isolated R131 fixtures, and clean consumer/worktree acceptance.
- **Wave 2 — Workflow Expression & Input Boundary Audit** — MERGED `develop@fa7f6cf8` (2026-09-21), PR #249 (`fa7f6cf8`, "fix(ci): harden workflow input boundaries"); merge tree byte-identical to the approved PR head tree `7e634353`. Hardened raw untrusted GitHub expression interpolation across the ten audited workflows/templates (shell and `github-script` bodies routed through `env:` boundaries, quoted at consumption) plus `qg-path-audit.sh` H2/H3/table-form parser hardening. 30/30 required checks passed, 0 unresolved review threads, CLEAN merge state; full Bats 3391/3391 (`qg-linux-canonical` six-shard profile), MCP Vitest 2665/2665, ESLint 0 errors, three independent architect VERIFY-FINAL verdicts APPROVE. PLAN digest `8f5e1849f42af77b4c0fcffa3e2f884c70adf6c1e564b261203ce3611cd50a05`; full record in memory `project_wave_workflow_input_boundary_audit_shipped.md`. HTML escaping is tracked only as `BL-CONS-P2-01`; R33 native stays `PENDING_EXTERNAL_RELEASE`.
- **Wave 1 — Portable Runtime Collaboration & Persistent Role Lifecycle** — MERGED `develop@b5d7ed46` (2026-09-19). PR #246 `1b3eebe5` (2026-09-15, portable mixed-host consultation + consumer sync, 204 internal CommonJS modules across the 3 stable facades), PR #247 `2a98bc17` (2026-09-19, macOS stabilization: per-platform host-certificate coexistence, symlink-identity and TMPDIR-path-budget fixes), PR #248 `b5d7ed46` (2026-09-19, macOS follow-ups: ctimeNs identity gap, config.toml parse hardening, parallel Bats orchestrator, zombie-liveness fix). Windows live qualification: P4 QUALIFIED, P5 LIVE_QUALIFIED (attempt N13), P6 QUALIFIED (attempt 3). Mandatory post-Wave-1 qualification checkpoint COMPLETE, zero P0/P1 findings (one non-blocking fast-follow: planner→context-provider bootstrap-edge gap); full record in memory `project_wave_portable_runtime_collaboration_lifecycle_shipped.md` and `project_post_wave1_agent_skill_behavioral_qualification.md`. R33 native stays `PENDING_EXTERNAL_RELEASE`.
- **G0 — Reusable Workflow Input Boundary Hardening** — MERGED `619d9a7`, PR #245 (2026-07-12). Closed the four targeted reusable workflows with namespaced environment boundaries, quoted shell consumption, checkout hardening, a run-block extractor, and a 13-test regression fence; owner-recorded final QG at `c7ba941` was 2,042 Bats / 2,607 Vitest before squash. Its mapped follow-ups closed in Waves 1, 2, 6, and 7.
- **H1 — Push Authority Bootstrap** — MERGED `1e0be41`, PR #243 (2026-07-11). Installed-hook identity is required by the QG mint and Claude push gate; in-JS proof fallback removed. Its command-detector redesign closed in Wave 5.
- **Portable Ingestion + Wave 38 Content** — MERGED `0db5773`, PR #242 (2026-07-11).
- **Wave C — QG Artifact Binding** — MERGED `7428b81`, PR #241.
- **Wave A — QG Evidence Integrity** — MERGED `19db9d2`, PR #240.
- **Wave B — macOS Local-Green Portability** — MERGED `e726ca9`, PR #239.

For full history use `git log` and the corresponding `project_*shipped.md` memory entries.

## How to use this document

1. Select from **Active backlog after PR #255**, normally highest priority first; there is no legacy numbered `NEXT` wave.
2. Reproduce the selected item independently at current `develop`, accept one bounded PLAN, and freeze its exact path manifest before implementation.
3. Preserve the item's dependencies and fail-closed acceptance. Do not combine unrelated P0/P1 entries merely to reduce PR count.
4. Treat Waves 1–7, G0, and PRs #251–#255 as shipped history; do not reopen them implicitly or execute old wave prose literally.
5. On completion, record final PR/commit/tests, move only the closed ID to shipped history, and reprioritize remaining evidence.
6. Trigger-only work enters the active queue only with the stated current evidence and an explicit owner.
