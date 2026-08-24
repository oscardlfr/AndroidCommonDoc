# AndroidCommonDoc Backlog

> **Last updated**: 2026-07-14
> **Roadmap baseline**: `develop@0704ddf` (PR #244; PR #245 at `619d9a7` is its confirmed ancestor). **H1 and G0 — Reusable Workflow Input Boundary Hardening are SHIPPED.**
> **Next executable wave**: **Wave 1 — Portable Runtime Collaboration & Persistent Role Lifecycle.**
> **Source of truth**: this file owns ordering and scope. `git log`, merged PRs, and `project_*shipped.md` memory entries own historical detail.

## Operating contract

- The load-bearing portability floor is **validated disk artifacts**. Runtime messaging is an optional acceleration layer.
- Adapter delivery, message text, an MCP return value, or a live peer saying “GO” is never evidence. Only a valid, correlated result artifact counts as a protocol-valid consultation answer; phase and push authorization still require their own contracts.
- Execute Waves 1-7 in order; Wave 1 is next. The mandatory read-only qualification after Wave 1 is a promotion checkpoint, not an eighth wave. Do not split routine implementation details into extra micro-waves.
- Re-audit observations and file counts at each wave's starting HEAD. Post-G0 counts below were recorded by PR #245 at `619d9a7`; they are a planning baseline, not permanent truth.
- Each wave must have one frozen scope, explicit no-go boundaries, proportional tests, and a shipped memory entry before the backlog advances.
- Rich runtimes may add `SendMessage`, persistent peers, MCP invocation, app-server threads, or wakeups; failure or absence of those capabilities must not invalidate the disk floor.

## Gate 0 — completed prerequisite (not counted among the seven waves)

### G0 — Reusable Workflow Input Boundary Hardening

**Status**: SHIPPED — MERGED to `develop@619d9a7`, PR #245.

**Objective delivered**: close the targeted post-H1 reusable-workflow shell-injection surface without expanding into the repository-wide audit.

**Outcome**:

- Hardened `.github/workflows/reusable-shell-tests.yml`, `reusable-copilot-parity.yml`, `reusable-lint-resources.yml`, and `reusable-agent-parity.yml` across both direct `${{ inputs.* }}` and indirect `${{ steps.*.outputs.* }}` run-block paths by projecting values through namespaced `env:` boundaries and quoting shell references.
- Added newline-guarded `GITHUB_ENV` script paths, `persist-credentials: false` on primary/toolkit checkouts, Bash-array argument construction where applicable, and a run-block extractor plus a 13-test regression fence.
- Closed the scoped H1/CodeRabbit documentation nits without changing H1 push behavior.
- Owner-recorded final QG at PR head `c7ba941`: 2,042 Bats PASS / 0 FAIL, 2,607 Vitest PASS, three architect VERIFY-FINAL verdicts, proof mint and pre-push verification PASS before squash to `619d9a7`.
- Preserved the broader security/doc/portability findings below as deferred fast-follows; none blocks Wave 1.

## Post-G0 fast-follows — retained, deferred, and outside Wave 1

| Fast-follow | Priority | Exact retained scope | Owner / sequencing |
|---|---|---|---|
| `l0-release-assets.yml` `tag_name` boundary | HIGH | Three shell sites at the PR #245 baseline (`L45`, `L46`, `L142`) consume `github.event.inputs.tag_name`; the workflow has `contents: write` and therefore needs focused validation before its next release use | Wave 2. If a release must run first, land the focused fix before that release; do not pull it into Wave 1 |
| Broader workflow input audit | LOW/MED | 36 remaining run-block `${{ inputs.* }}` sites across eight workflows: `readme-audit.yml` (19), `doc-audit.yml` (3), `doc-monitor.yml` (1), `reusable-architecture-guards.yml` (1), `reusable-check-outdated.yml` (3), `reusable-kmp-safety-check.yml` (3), `reusable-audit-report.yml` (3), and `reusable-commit-lint.yml` (3) | Wave 2; recount at its starting HEAD |
| README count/table reconciliation | LOW/MED | Revalidated at `619d9a7`: 21 findings (0 HIGH, 15 MEDIUM, 6 LOW) — project-tree scripts `50→63`, guides `28→29`, sub-docs `97→102`, 12 missing script rows, four misclassified library rows, and incomplete agents/testing hub coverage | Wave 7 global baseline closure; no standalone micro-wave |
| qg-local-green grep portability | LOW | GNU-only BRE `\s`/`\+` usages in `scripts/tests/session-coverage.bats:63,109` and `scripts/tests/script-utils.bats:267`; convert to POSIX/ERE and sweep siblings. Canonical GNU grep is green; Apple grep exposes the latent gap | Independent portability fast-follow; never part of adapter scope |
| Post-#245 documentation precision | LOW | State exact hook-manifest exemptions as `refs/heads/{develop,master,main}`; distinguish pre-commit gate-check reason codes from usage/environment errors; reconcile the README PS1-only wording at its current equivalents of former `L21`/`L963` | Wave 7; never part of adapter implementation |
| BL-W4-8 documentation/test nits | LOW | Stale line cite in `arch-dispatch-modes.md`; C7.3 test name vs actual `docs/agents/` scope; named-team negation recognizes `never` but not `Do NOT` | Behavioral matcher/test mechanics in Wave 6; wording/cites in Wave 7; no standalone wave |

## Ordered seven-wave program

| Order | Professional name | Primary outcome | State |
|---:|---|---|---|
| 1 | Portable Runtime Collaboration & Persistent Role Lifecycle | Persistent canonical support roles plus portable consultation and user-gated documentation ingestion | **IN REVIEW** |
| — | Agent & Skill Behavioral Restoration Qualification | Mandatory read-only qualification before Wave 2 | REQUIRED CHECKPOINT |
| 2 | Workflow Expression & Input Boundary Audit | Repository-wide control of untrusted workflow inputs crossing into shell | QUEUED |
| 3 | Structured Verdict Evidence Contract | Verdicts become strictly parsed, correlated, evidence-backed records | QUEUED |
| 4 | Reproducible Evidence & Bats Provenance | Independent runs and handoffs become comparable and fail closed | QUEUED |
| 5 | Native Push Authority & Peer Authorization Policy | Git-layer push authority, robust intent detection, explicit actor policy | QUEUED |
| 6 | Class-Aware Phase, Topology & Skill Orchestration Control Plane | Mechanized wave lifecycle and one runtime-neutral skill/entrypoint control plane | QUEUED |
| 7 | Documentation & Operational Baseline Closure | README, agents, skills, MCP, ADRs, memory, and catalogs describe demonstrated behavior | QUEUED |

---

## Wave 1 — Portable Runtime Collaboration & Persistent Role Lifecycle

**Class**: HARNESS

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
- The frozen six-file runtime-messaging documentation shape: `docs/agents/runtime-messaging-adapters.md` as the hub plus `runtime-messaging-{protocol,state-machine,drivers,bridges,cp-writer}.md`.
- The exact schema/ADR/hook updates frozen in the PLAN, including `docs/agents/coordination-artifact-schema.md`, `docs/adr/ADR-001-runtime-adapter-contract.md`, and `.claude/hooks/coordination-artifact.js`; no “if required” escape from the 99-path manifest.
- One shared portable core, `scripts/lib/runtime-consultation.cjs`, owning ids, validation, durable state, correlation, and bounded waits; both thin `scripts/sh/runtime-consultation.sh` and `scripts/ps1/runtime-consultation.ps1` argv-forwarding wrappers are mandatory, together with the real `windows-latest` job required to close SC-17.
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

**Promotion gate**: Wave 2 cannot become NEXT until this checkpoint completes and every finding has an owner. A P0/P1 Wave-1 defect in consultation, lifecycle, disk authority, or ingestion returns to one bounded Wave-1 stabilization batch; it must not create a chain of micro-waves.

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

**Memory on ship**: link the final G0 shipped record; create `project_wave_workflow_input_boundary_audit_shipped.md` with the complete inventory, allowed patterns, elevated-permission review, and residuals.

---

## Wave 3 — Structured Verdict Evidence Contract

**Class**: HARNESS / EVIDENCE

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

## Residuals mapped to the ordered program

Historical text below is not an instruction to execute old wave plans literally. Re-audit each item at the target wave's starting HEAD.

| Finding / historical entry | Current disposition | Roadmap home |
|---|---|---|
| Agent-team completion notification drop | Upstream/runtime report remains optional; local liveness/consultation behavior belongs here | Wave 1; upstream report independent |
| Portable Coordination Artifacts have no general consumer/wakeup/result loop | Open | Wave 1; qualification proves operational closure |
| BL-W4-12 orchestrator can forge architect-shaped verdict path | Open; spans result authorship, verdict evidence, and honest actor policy | Waves 1, 3, 5 |
| Broad workflow input/expression inventory after targeted H1 follow-up | Open | Wave 2 |
| Wave A unbacked `APPROVED-PREP` / weak VERIFY-FINAL substring acceptance | Open | Wave 3 |
| Wave A evidence reproducibility / rerun-until-green concern | Open | Wave 4 |
| Bats unsafe project-root and stale protocol metadata prose | Open | Wave 4 |
| H1 command-string push detector | Explicitly deferred by H1 | Wave 5 |
| BL-W4-10 class-aware phase mechanization | Open | Wave 6 |
| BL-W4-11 README + `/work` + `/init-session` fixed-roster drift | Lifecycle-critical entrypoints start in Wave 1; full skill/topology behavior and global prose/catalog are separate | Waves 1, 6, 7 |
| BL-W47 Topology Pilot / Wave 39 topology debt | Re-audit; do not replay old TeamCreate assumptions | Wave 6 |
| BL-W4-8 Bats test-authoring hygiene (three small doc/test naming issues) | Behavioral matcher/test mechanics and documentation have separate owners; no cleanup wave | Wave 6 behavior; Wave 7 wording/cites |
| BL-W36-04 stash/baseline methodology | Re-audit against current diff/baseline tooling | Wave 4 if still reproducible |
| BL-W32-04 context-provider zombie observation | Reproduce during Wave 1 and mandatory qualification; Wave-1 defect gets one stabilization batch, topology-only residual routes onward | Wave 1 + qualification; conditionally Wave 6 |
| Historical collaboration/documentation behavior drift | Reconstruct expected vs observed behavior; do not treat old prose as authority or silently lose useful semantics | Mandatory post-Wave-1 qualification; findings route to Waves 1–7 |
| Skill/command overlap, aliases, hard-coded runtime calls, dead-skill candidates | Telemetry currently lacks reliable per-skill attribution; zero deletion decisions now | Qualification census → Wave 6 behavior/migration → Wave 7 catalog |
| README/AGENTS/doc index audit revalidated at `619d9a7` | Open; 21 findings (0 HIGH, 15 MEDIUM, 6 LOW) cover 12 missing script rows, four misclassified library rows, count drift, and hub coverage | Wave 7 global closure; no standalone cleanup wave |

## Independent / incubator backlog

These items are not allowed to interrupt Waves 1-7 unless a concrete blocker or security trigger changes priority.

| Item | Status / trigger |
|---|---|
| Upstream agent-teams notification delivery report | LOW/MED; file only with a minimal runtime repro; not a local harness blocker |
| PS1 `run-qg` restoration | MED; requires an environment with `pwsh` and security-critical parity tests |
| Duplicate `MAX_LINES = 435` policy in shell/TypeScript validators | LOW; centralize when either validator next changes |
| Commit-lint semantics duplicated across hook, mint, JS gate, and CI comparison point | LOW/MED; shared-helper design, not part of messaging |
| RTK template sweep | Deferred; requires separate explicit user approval before any template edits |
| BL-W36-check `/release-build-verify` promotion candidate | Trigger-only; revisit only when a concrete release need or measured gap appears |
| BL-W47-WATCHER release-trigger watcher | Incubator; independent product/tooling wave |
| BL-W47-RENDER headless Compose render-to-PNG loop | Incubator; Desktop JVM first, separate product/tooling wave |
| Consumer `settings.json` validation against the shipped hook manifest | Optional follow-up only; `docs/agents/hook-manifest.md` itself is already shipped |
| macOS zsh/hooks sweep | Migration resolved; full shell/hook sweep still needs current evidence |
| macOS Gradle truststore check | Verify one full build without legacy flags |
| Xcode/iOS target smoke test | Run when an owning KMP validation wave is scheduled |
| `~/.gradle/gradle.properties` hygiene | Re-verify the Mac-local configuration without copying Windows flags |
| L2 consumer product alignment / future agents / plugin v0.2.1 | Long-term, trigger-driven; retain source memory entries |

## Legacy candidates — re-audit before scheduling

Do not preserve old ordering merely because a wave number exists. These tracks predate Waves A/C/H1 and the realignment; each needs a fresh problem statement, current evidence, and consolidation decision.

| Legacy track | Disposition |
|---|---|
| Wave 39 `W19-#3` / `W19-#4` / `W19-#6` | Session teardown, `/work` phase rewrite, and PREP/EXECUTE dispatch modes map to Wave 6 after re-audit |
| Wave 39 `BL-W36-02` / `BL-W36-03` | Re-audit and close/document in Wave 7 if still current |
| Wave 39 `BL-W36-04` | Stash/baseline methodology maps conditionally to Wave 4 after reproduction |
| Wave 39 `BL-W37-03` / `BL-W37-04` | Empty-Bats reusable workflow and immutable L0 workflow pinning remain L1/supply-chain follow-ups |
| Wave 39 housekeeping / modularization paso 2 | Independent cleanup; require a current inventory before scheduling |
| Wave 40 — Wave 17 L2 hardening | Re-audit against current L2 consumer and final harness contracts after Wave 7 |
| Wave 41 — Plugin v0.2.0 generalization | Product/plugin roadmap; independent of harness ordering |
| Wave 42 — OSS Phase 1 modularization | Product/packaging roadmap; independent of harness ordering |
| Wave 43 — Wave 18 hypothesis triage | Data-triggered only; use current metrics before scheduling |
| BL-W47 Ex-PR6 HOLD checkpoint / council design | Re-audit after Wave 6; do not revive superseded adaptive-harness mechanics |
| Dead-skill pruning | Not an independent cleanup: qualification evidence first, Wave 6 owns behavior/migration, Wave 7 owns final catalog; no deletion from current telemetry |
| SF-prep-19-B TDD bundling protocol | Policy candidate only; revisit with current QG evidence rather than replaying the old warning |
| Platform-shift Mac follow-ups | Migration itself resolved; four concrete checks are retained in Independent / incubator above |

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
- **H1 — Push Authority Bootstrap** (`1e0be41`, PR #243) — shipped. Only its explicitly deferred detector redesign remains, mapped to Wave 5.
- **G0 — Reusable Workflow Input Boundary Hardening** (`619d9a7`, PR #245) — shipped. Its focused four-workflow boundary is closed; the exact broader census, release `tag_name` risk, README drift, grep portability, and documentation precision follow-ups remain mapped above.

## Memory ledger update plan

This tracked roadmap update changes `BACKLOG.md` only; the current Wave-1 execution plan remains gitignored PREP state. Shipped history is factual; queued-wave memory must be updated by the owning implementation wave or checkpoint, not speculatively marked shipped here.

| Milestone | Required memory action |
|---|---|
| G0 shipped backfill | Reconcile `project_followup_ci_harden_workflow_inputs_queued.md` with PR #245, `619d9a7`, final evidence, and the retained residual inventory; keep `project_wave_push_authority_bootstrap_shipped.md` unchanged except for a factual follow-up link if needed |
| Wave 1 | Add portable-runtime-collaboration/lifecycle shipped memory; refresh Portable Coordination Artifacts, ingestion, session/topology, skills-entrypoint, and harness-audit memories with exact roles/connectors, reuse/respawn measurements, and degraded-mode proof |
| Post-Wave-1 qualification | Add `project_post_wave1_agent_skill_behavioral_qualification.md` with historical/observed behavior matrix, runtime scenarios, skill dispositions, measured cost, and owning-wave routing |
| Wave 2 | Add workflow-input-boundary audit shipped memory with a machine-generated inventory and privileged-workflow review |
| Wave 3 | Add structured-verdict contract shipped memory; amend evidence-integrity/phase memories with migration semantics |
| Wave 4 | Add reproducibility/Bats-provenance shipped memory; amend Wave A/C/QG memories without reopening resolved findings |
| Wave 5 | Add native-push/peer-policy shipped memory; link H1's intentionally deferred detector item to its closure |
| Wave 6 | Add class-aware phase/topology/skill-control-plane shipped memory; consolidate obsolete Wave 19/BL-W47 topology records, skill/command migration decisions, and pilot measurements |
| Wave 7 | Add documentation/operational-baseline closure memory; reconcile roadmap, README-audit, skill/command, runtime-adapter, topology, ingestion, QG, and harness-audit memories with the final demonstrated baseline |

## Shipped (recent)

- **G0 — Reusable Workflow Input Boundary Hardening** — MERGED `619d9a7`, PR #245 (2026-07-12). Closed the four targeted reusable workflows with namespaced environment boundaries, quoted shell consumption, checkout hardening, a run-block extractor, and a 13-test regression fence; owner-recorded final QG at `c7ba941` was 2,042 Bats / 2,607 Vitest before squash. Broader workflow, release `tag_name`, README, grep-portability, and documentation-precision findings remain explicitly deferred above.
- **H1 — Push Authority Bootstrap** — MERGED `1e0be41`, PR #243 (2026-07-11). Installed-hook identity is required by the QG mint and Claude push gate; in-JS proof fallback removed. Command detector intentionally deferred to Wave 5.
- **Portable Ingestion + Wave 38 Content** — MERGED `0db5773`, PR #242 (2026-07-11).
- **Wave C — QG Artifact Binding** — MERGED `7428b81`, PR #241.
- **Wave A — QG Evidence Integrity** — MERGED `19db9d2`, PR #240.
- **Wave B — macOS Local-Green Portability** — MERGED `e726ca9`, PR #239.

For full history use `git log` and the corresponding `project_*shipped.md` memory entries.

## How to use this document

1. Start with Wave 1, the first row marked **NEXT**, and re-audit its mapped findings at current `develop`.
2. After Wave 1 ships, run the mandatory Agent & Skill Behavioral Restoration Qualification. Do not promote Wave 2 while any Wave-1 P0/P1 lifecycle, consultation, authority, or ingestion defect remains unresolved.
3. After the checkpoint, and after each later shipment, promote exactly one subsequent numbered wave to **NEXT**; do not reopen G0 or execute historical entries literally.
4. Freeze one plan/path manifest, preserve the wave's no-go boundary, and avoid standalone micro-waves for routine cleanup.
5. On completion, record final PR/commit/tests in memory, move the wave to Shipped, and promote the next eligible row.
6. If a real security or release blocker requires reordering, document the evidence and dependency explicitly rather than silently changing the sequence.
