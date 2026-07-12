# AndroidCommonDoc Backlog

> **Last updated**: 2026-07-12
> **Roadmap baseline**: `develop@619d9a7` (PR #245). **H1 and G0 — Reusable Workflow Input Boundary Hardening are SHIPPED.**
> **Next executable wave**: **Wave 1 — Portable Runtime Consultation & Messaging Adapters.**
> **Source of truth**: this file owns ordering and scope. `git log`, merged PRs, and `project_*shipped.md` memory entries own historical detail.

## Operating contract

- The load-bearing portability floor is **validated disk artifacts**. Runtime messaging is an optional acceleration layer.
- Adapter delivery, message text, an MCP return value, or a live peer saying “GO” is never evidence. Only a valid, correlated result artifact counts as a protocol-valid consultation answer; phase and push authorization still require their own contracts.
- Execute Waves 1-6 in order; Wave 1 is next. Do not split routine implementation details into extra micro-waves.
- Re-audit observations and file counts at each wave's starting HEAD. Post-G0 counts below were recorded by PR #245 at `619d9a7`; they are a planning baseline, not permanent truth.
- Each wave must have one frozen scope, explicit no-go boundaries, proportional tests, and a shipped memory entry before the backlog advances.
- Rich runtimes may add `SendMessage`, persistent peers, MCP invocation, app-server threads, or wakeups; failure or absence of those capabilities must not invalidate the disk floor.

## Gate 0 — completed prerequisite (not counted among the six waves)

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
| README count/table reconciliation | LOW/MED | Revalidated at `619d9a7`: 21 findings (0 HIGH, 15 MEDIUM, 6 LOW) — project-tree scripts `50→63`, guides `28→29`, sub-docs `97→102`, 12 missing script rows, four misclassified library rows, and incomplete agents/testing hub coverage | Wave 6 bundle; no standalone micro-wave |
| qg-local-green grep portability | LOW | GNU-only BRE `\s`/`\+` usages in `scripts/tests/session-coverage.bats:63,109` and `scripts/tests/script-utils.bats:267`; convert to POSIX/ERE and sweep siblings. Canonical GNU grep is green; Apple grep exposes the latent gap | Independent portability fast-follow; never part of adapter scope |
| Post-#245 documentation precision | LOW | State exact hook-manifest exemptions as `refs/heads/{develop,master,main}`; distinguish pre-commit gate-check reason codes from usage/environment errors; reconcile the README PS1-only wording at its current equivalents of former `L21`/`L963` | Independent documentation follow-up; never part of adapter scope |
| BL-W4-8 documentation/test nits | LOW | Stale line cite in `arch-dispatch-modes.md`; C7.3 test name vs actual `docs/agents/` scope; named-team negation recognizes `never` but not `Do NOT` | Wave 6; one owner, no standalone wave |

## Ordered six-wave program

| Order | Professional name | Primary outcome | State |
|---:|---|---|---|
| 1 | Portable Runtime Consultation & Messaging Adapters | Live Claude/Codex consultation without making runtime messaging authoritative | **NEXT** |
| 2 | Workflow Expression & Input Boundary Audit | Repository-wide control of untrusted workflow inputs crossing into shell | QUEUED |
| 3 | Structured Verdict Evidence Contract | Verdicts become strictly parsed, correlated, evidence-backed records | QUEUED |
| 4 | Reproducible Evidence & Bats Provenance | Independent runs and handoffs become comparable and fail closed | QUEUED |
| 5 | Native Push Authority & Peer Authorization Policy | Git-layer push authority, robust intent detection, explicit actor policy | QUEUED |
| 6 | Class-Aware Phase & Topology Control Plane | Wave class, phase, required roles, and peer lifecycle become mechanized | QUEUED |

---

## Wave 1 — Portable Runtime Consultation & Messaging Adapters

**Class**: HARNESS

### Objective

Restore reliable live collaboration during EXECUTE while preserving the portable contract. A specialist consults its reporting `arch-platform`, `arch-testing`, or `arch-integration`; that architect may open a nested consultation with `context-provider`. The protocol is transport-neutral, but a role-policy validator must reject disallowed direct specialist → context-provider transitions and reuse the existing concern-ownership/reporting-architect map rather than create a second topology map. The allowed chain must work whether activation uses Claude `SendMessage`, a persistent Codex session, Codex invoked through MCP, a spawned worker, or an already supervised disk-polling worker.

This wave must support both agreed operating modes:

1. **Persistent dual runtime** — Claude Code and Codex remain available concurrently and can receive work without the user relaying messages.
2. **On-demand MCP** — Claude invokes Codex through MCP when a persistent Codex worker is unnecessary or unavailable.

Both modes share one disk protocol and differ only in how a target is woken or invoked.

### Why it is first

Wave 2 coordination artifacts restored the portable data plane, but not a complete live consultation loop. Architects/context-provider no longer reliably survive through EXECUTE, specialists cannot consume a correlated protocol-valid answer portably, and Codex/Claude still need a manual bridge in many sessions. Fixing this collaboration layer first improves every later wave's planning, audit, and quality-gate review without weakening disk-first evidence.

### Historical baseline and retained lessons

- At the PR #213 (`aac0257`) snapshot, the dominant documented Claude topology kept context-provider, doc-updater, three architects, and Phase-2 specialists alive, then used a temporary QG peer with live architect deliberation. Some start-roster docs already disagreed on whether QG was persistent, which is historical evidence that prose-only lifecycle rules drift.
- PR #219 (`1f4214b`) deliberately removed mandatory `TeamCreate` dependence and moved architects toward single-use/background-optional execution. That improved portability but reduced live continuity.
- PR #220 (`2622205`) documented an adapter/capability direction with pseudocode and a textual capability guard; it did not ship an executable runtime-neutral loop.
- PR #235 (`125409b`) realigned documentation, not runtime liveness.
- PR #236 (`68ed036`) shipped the portable coordination-artifact floor: six typed schemas, a writer, validator, context-provider disk branch, and Bats/Node coverage. It did not ship an inbox consumer, poller, wakeup, or respawn loop.
- PR #237 (`8aacc05`) reconciled phase wording and explicitly deferred HARNESS mechanization to BL-W4-10.
- Today `consult/v1` is a context-provider marker, `message/v1` may be content-free, and `result/v1` has no request correlation or actor binding. Direct-final writes are collision-safe but not temp+rename atomic; the context-provider disk branch excludes specialists, which still depend on an architect-written live-message flag.

The target is not to resurrect the Claude-only topology. It is to recover its useful liveness through replaceable transports.

### Architecture contract

Separate two planes:

- **Authoritative data plane**: validated artifacts below one configured base `coordination_root` (default `<worktree>/.planning/coordination`). It carries requests, correlation, results, freshness, transaction cancellation, and acknowledgement state.
- **Best-effort wake plane**: `SendMessage`, Codex app-server/thread input, Codex MCP invocation, runtime spawn/respawn, or no-op. It only tells a worker which artifact to read.

Proposed transport-neutral facade:

```text
dispatch(target_role, request_artifact_path, policy) -> DeliveryReceipt
await_result(request_id, expected_role, deadline) -> ValidatedResult | Timeout
```

`DeliveryReceipt` is diagnostic telemetry only. `ValidatedResult` means **protocol-valid consultation result**, not authenticated actor identity or permission to advance a phase. It exists only after request/result correlation, allowed role transition, wave, PLAN digest, exact subject snapshot/scope, schema, status, and content checks pass.

### Protocol evolution

Keep existing schemas readable during migration, but do not overload weak v1 meanings:

| Artifact | Wave 1 role |
|---|---|
| `coordination/consult/v1` | Legacy pre-PLAN context-provider contact marker; readable for compatibility, not proof that a response completed and not the general transaction format |
| `coordination/consult/v2` | Post-PLAN general consultation request with stable `request_id`, target role, question/task or content reference, reply contract, deadline/policy, PLAN digest, and exact subject snapshot digest |
| `coordination/message/v1` | Legacy notification envelope only; never a consultation result and too weak to be the v2 inbox reference |
| `coordination/inbox-ref/v1` | Immutable inbox reference carrying `request_id`, confined transaction-relative path, request digest, and kind; no independent copy of request authority |
| `coordination/result/v1` | Legacy result, readable with its shipped semantics; do not add stricter required fields |
| `coordination/result/v2` | Correlated post-PLAN response carrying `in_reply_to`, attempt/epoch, expected roles, result kind/status, non-empty content or confined content reference+digest, PLAN digest, and exact observed subject snapshot |
| `coordination/cancel/v1` | Transaction-local timeout/cancel state; means “this consultation will not be accepted,” not “kill the peer” and not harness phase authority |
| `coordination/stop/v1` | Legacy presence signal only; never controls a new persistent worker generation |
| `coordination/stop/v2` | Session-bound best-effort stop for a worker spawned/owned by the adapter, with worker/session, attempt/lease epoch, expiry, and acknowledgement; general peer lifecycle stays in Wave 6 |
| `coordination/request/v1` + `approval/v1` | Keep their shipped ingestion-loop semantics; do not repurpose them for arbitrary consultations |

Audit every shipped producer/consumer before implementation, but the compatibility direction is fixed: preserve v1 semantics and add the v2/result/inbox/cancel contracts above. Do not silently tighten persisted v1 artifacts. General `consult/v2` is post-PLAN because PLAN digest is required; this wave must not make planner/PREP startup depend on a PLAN that does not yet exist. Any future completed pre-PLAN response needs a separately designed `brief_digest`-bound profile and is not implied by this wave.

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
    claims/<attempt_id>.json
    active-lease.json
    delivery/<attempt_id>.json
    results/<attempt_id>.json
    accepted-result.json
    ack.json
    cancel.json
  workers/<target_role>/<worker_session_id>/stop.json
```

Role inboxes contain validated immutable `inbox-ref/v1` references to transaction paths, not copies with independent authority. The contract must specify discovery bounds, filename/path allowlists, maximum envelope/content sizes, `content_ref` confinement beneath approved roots, digest verification, acknowledgement/consumption, retention, and cleanup. A receipt under `delivery/` records only driver, request/attempt identifiers, timestamps, outcome, and bounded error code; it never stores prompt/result text, secrets, or authority.

The requester/supervisor allocates each `attempt_id` and advertised monotonic `lease_epoch`; a target may claim only that attempt. Serialize claim, takeover, cancellation, and acceptance through a confined portable transition lock implemented by exclusive directory creation (or an equivalent no-clobber primitive in the shared Node core), not by an assumed rename-CAS. Stale-lock takeover must itself be single-winner and bounded. While holding the lock, re-read active state, publish via temp+rename, and create terminal acceptance with exclusive/no-clobber semantics. A takeover is allowed once, increments the epoch, and never overwrites the previous claim/result.

Required transaction state model:

| From | Allowed transition | Constraint |
|---|---|---|
| `PUBLISHED` | `CLAIMED` | only the advertised attempt/epoch can win |
| `CLAIMED` | `ANSWERED` | immutable per-attempt candidate result; not successful until requester acceptance |
| `ANSWERED` | `ACCEPTED` | requester only; `validate_result_for(...)` passes for the current attempt/epoch and exact subject/PLAN, then exclusive no-clobber acceptance wins atomically against cancellation |
| `CLAIMED` | `BLOCKED` | protocol-valid negative terminal result; requester may acknowledge it, but it is never accepted as an answer and never permits phase advance |
| `CLAIMED` | `SUPERSEDED` → new `CLAIMED` | one expired-lease takeover maximum, new attempt and higher epoch |
| any non-terminal state | `EXPIRED` or `CANCELLED` | transaction-local terminal state; does not stop a persistent peer |

`validate_result_for(...)` rejects a result whose attempt/epoch is not current, even if it arrives late with otherwise valid fields. Competing files remain visible for conflict detection instead of being overwritten last-writer-wins. Same-digest duplicates may be idempotent; conflicting current results force transaction cancellation plus a harness STOP/report with no phase advance. A stale `stop/v1` can never stop a new worker; `stop/v2` is confined to a specific adapter-owned worker session.

The current validator accepts an artifact bound to a HEAD ancestor. Post-PLAN consultation must be stricter, but it must distinguish the reviewed subject from the worker checkout: request/result bind exactly to immutable `subject_head`, `plan_digest`, and `subject_scope_digest`; result records the worker's `producer_head` and `producer_worktree_id` separately as diagnostic provenance and repeats the exact subject snapshot it observed. A target checkout need not equal the subject HEAD, but it must consume the referenced subject snapshot. If the requester's subject HEAD/scope changes before acceptance, the result is stale and a new transaction is required; a result for subject A is never reused implicitly for subject B.

### Adapter drivers and routing

Implement a `ConsultationAdapter` above the existing ADR-001 nine-operation `RuntimeAdapter` contract, or deliberately version that contract with a migration plan; do not leave two unrelated adapter APIs. Phase 0 must produce a capability ledger by probing the actual installed Claude/Codex surfaces and correcting stale ADR mappings before freezing the PLAN. A host-provided capability manifest/bridge owns runtime-native operations, handshakes, version compatibility, approval flow, and at least one real conformance path for each agreed operating mode. Portable shell code owns the disk transaction/wait floor and cannot pretend to invoke host-native Claude/Codex primitives by itself.

Runtime spawn, app-server, and MCP operations execute only through explicitly registered host bridges outside the portable shell core. A manifest is declarative: allowlisted driver/executable identifiers, fixed argv fields, versions, availability, and approval state. It cannot supply an arbitrary command string, model/permission flags from a request, or anything evaluated with `eval`/shell interpolation. Reconcile the existing CLI-spawn policy/gate explicitly; do not create a hidden exception that shells out to `claude -p`, `codex exec`, or another model CLI from request-controlled data.

Use one registry/capability probe with deterministic per-role routing. Activation drivers are distinct from wait strategies:

| Activation driver | Use | Required behavior |
|---|---|---|
| `claude-sendmessage` | Wake an existing Claude peer | Send only role + artifact path + kind/request id; never treat reply text as evidence |
| `codex-app-server` / persistent thread | Wake a parked Codex worker | Resume the canonical worker and point it to the request artifact |
| `codex-mcp` | Invoke Codex on demand from Claude or another MCP host | Instruct the invocation to read the request and write its own result artifact; returned text alone is insufficient |
| `runtime-spawn` | Start/respawn the canonical role when no live peer exists | Rehydrate from a bounded disk context bundle and preserve the same request id |
| `noop` | Notification unavailable | Record an unavailable receipt and leave progress to the disk loop or fail closed at deadline |

Requester result polling and optional worker inbox polling are bounded wait strategies, not activation drivers. `noop` plus disk polling completes only when a separately registered external supervisor/worker consumer already exists; otherwise it deterministically times out.

Example policy, stored as configuration rather than hard-coded branching:

```text
verifier:       [codex-app-server, codex-mcp, runtime-spawn, noop]
quality-gater:  [codex-app-server, codex-mcp, runtime-spawn, noop]
arch-*:         [claude-sendmessage, runtime-spawn, noop]
context-provider: [claude-sendmessage, runtime-spawn, noop]
```

The logical role remains canonical regardless of whether Claude or Codex executes it; runtime choice never creates a new authority role. Do not race two active drivers for the same request by default. `SendMessage`, Codex thread/app-server turns, and Codex MCP are host-native bridges selected only after a capability handshake. Use the stable request/attempt/lease fencing above so fallback cannot create two current authors. A late result from a superseded attempt is invalid; two conflicting otherwise-valid results trigger cancellation + harness STOP/report.

### Runtime consultation loop

1. The requester writes through the sanctioned writer to a temporary path, atomically renames into the deterministic transaction, then validates the request and `inbox-ref/v1` reference. Nested requests carry `root_request_id`, optional `parent_request_id`, and bounded `max_depth` (default 2); role transitions and depth are validated to prevent loops.
2. The adapter checks the host capability manifest/handshake, selects the first allowed driver, and emits a non-authoritative delivery receipt.
3. The target worker atomically claims the active lease, performs the role-specific work, and writes its own immutable per-attempt correlated result through the sanctioned writer.
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

The context-provider and architect must author their own results. Because `context-provider` is otherwise read-only, add one narrowly confined publication path: it may invoke only the sanctioned transaction-result writer for its own active claim, with no general Write/Edit capability; update its template, guards, and tests accordingly. The orchestrator may schedule, wake, validate, and report; it may not impersonate either role.

### Persistent dual-runtime behavior

- A host-side supervisor owns process/session liveness; language models are not expected to block forever inside one inference call.
- Claude and Codex workers may be parked in bounded wait cycles, woken by their native surface, and resumed against the configured coordination root.
- Either runtime can initiate a request by writing the same artifact. The other can answer without the user copying text between applications.
- Default mode sets `coordination_root=<worktree>/.planning/coordination`; all new transaction paths use the single namespace defined above. Exactly one root/version is authoritative per request. A legacy v1 adapter is read-only and may translate an observation into diagnostics, but it cannot mirror two authoritative copies or let a v1 marker satisfy v2 completion.
- To support the current “Claude and Codex in sibling worktrees” case, Wave 1 also allows the base `coordination_root` to be explicitly configured to a same-machine host-local directory shared by those worktrees. The root must be canonicalized, symlink-safe, owner-confined (`0700`-equivalent where supported), explicitly granted to both runtimes, and keyed by a stable repository identity separate from worktree ids. Requests bind the reviewed subject snapshot exactly while recording each producer worktree/HEAD separately; different producer HEADs do not invalidate a result by themselves, but an undeclared or changed subject snapshot does.
- Cross-host/network federation remains deferred; a shared coordination root is a same-machine disk transport, not a broker.
- If only one runtime is running, the same protocol works through spawn/MCP/polling or terminates cleanly at its deadline.

### Fallback matrix

| Condition | Expected action |
|---|---|
| Live Claude peer + `SendMessage` available | Persist request, notify through Claude driver, validate disk result |
| Persistent Codex worker available | Persist request, wake/resume worker, validate disk result |
| No persistent Codex worker + Codex MCP available | Persist request, invoke through MCP, require invoked worker to write result |
| Runtime has no messaging capability | Persist request, record no-op delivery, and use bounded polling only if a registered external worker/supervisor consumes that inbox; otherwise timeout deterministically |
| Canonical peer is dead | One bounded canonical respawn/re-invocation, then continue polling |
| Adapter fails but disk result appears | Accept only after full artifact validation; report adapter degradation |
| No valid result before deadline | Transaction cancel + harness STOP/report; consultation remains unanswered and a persistent peer is not killed |

### Included scope and probable files

- Phase-0 producer/consumer compatibility census plus a runtime-capability ledger, real host-bridge conformance probe, adapter registry, routing policy, non-authoritative delivery receipts, bounded wait strategies, claim/lease, and one-respawn lifecycle.
- Deterministic transaction paths, role inbox references, acknowledgement/consumption, atomic artifact publication, attempt/lease fencing, strict request/result correlation, and a confined optional sibling-worktree coordination root.
- A canonical runtime-messaging document, likely `docs/agents/runtime-messaging-adapters.md`.
- Schema/ADR changes in `docs/agents/coordination-artifact-schema.md`, `docs/adr/ADR-001-runtime-adapter-contract.md`, and `.claude/hooks/coordination-artifact.js` if required.
- One shared portable core, likely `scripts/lib/runtime-consultation.cjs`, owning ids, validation, atomic state, correlation, and bounded waits; thin `scripts/sh/runtime-consultation.sh` and, if distributed as a cross-platform contract, `scripts/ps1/runtime-consultation.ps1` wrappers must not duplicate protocol logic.
- Bats/Node tests under `scripts/tests/` for protocol, transport selection, lifecycle, and failures.
- Specialist, architect, context-provider, orchestrator, and quality-gater guidance/templates; regenerate registries/adapters only where canonical sources require it.
- Correct stale runtime capability mapping in ADR/docs after probing the actual Claude and Codex surfaces available at implementation time.
- Preserve and extend `capability-preservation.bats` and `named-team-regression-guard.bats`; adapter work must not erase capabilities or silently revive mandatory named teams.
- Keep `consult/v1` only as the legacy pre-PLAN context-provider contact marker. Post-PLAN architect/specialist flows require a correlated completed `consult/v2` → `result/v2`; writing the marker alone never means “answered”. Do not make planner/PREP startup depend on a PLAN that does not yet exist.
- Add the narrowly confined context-provider result-publication path for its active claim; preserve its read-only boundary everywhere else.

### No-go / out of scope

- Runtime message bodies as evidence or authority.
- Mandatory Claude `SendMessage`, mandatory MCP, or mandatory persistent processes.
- A bespoke network broker, cloud queue, or cross-host federation. A confined same-machine coordination root for sibling worktrees is included.
- Reintroducing `TeamCreate` as the portable floor.
- Unlimited polling, unlimited respawn, duplicate concurrent invocations, or orchestrator-authored role results.
- General persistent-worker lifecycle/parking policy beyond the bounded adapter-owned attempt; Wave 6 owns topology mechanization.
- General phase/topology state-machine work (Wave 6), verdict grammar redesign (Wave 3), or push authorization redesign (Wave 5).

### Principal risks

- Duplicate or late workers produce conflicting results.
- A transport reports delivery while no worker actually claims the request.
- MCP returns plausible prose without writing an artifact.
- Non-atomic writes expose partial JSON to pollers.
- Stale PLAN/subject snapshot, stale worker-stop sentinels, self-declared role spoofing, unconstrained content references, or an empty `result/v2` passes a structurally weak validator.
- Persistent sessions disappear between wake and response; unbounded recovery becomes a zombie loop.
- Runtime docs encode capabilities that have changed; capability probes and adapters must isolate that churn.
- Subject and producer HEADs are conflated, or sibling worktrees consume a transaction from the wrong repo/worktree namespace.

### Verification expected

- Producer→schema→path→consumer compatibility census; legacy v1 fixture tests plus fixed `consult/v2`, `result/v2`, `inbox-ref/v1`, `cancel/v1`, and session-bound `stop/v2` tests.
- Persist-before-notify, atomic temp+rename, exclusive transition-lock, stale-lock takeover, and no-clobber acceptance tests.
- Deterministic-path/inbox discovery bounds, path traversal/symlink, payload-size, confined `content_ref`, digest, ACK, retention, and cleanup tests.
- Transaction-state-table tests with `attempt_id` + `lease_epoch` fencing; immutable competing results, same-digest idempotence, no last-writer-wins replacement, single takeover, superseded-result rejection, and stale-stop-after-respawn rejection.
- Activation-driver contract tests for Claude, persistent Codex, Codex MCP, spawn, and no-op, plus separate requester/worker polling tests: available, unavailable, timeout, and transport failure.
- Host capability-manifest handshake, version mismatch, approval-denied, hostile argv/newline/metacharacter, owner-permission, and arbitrary-command rejection tests; prove shell-only mode never claims a native driver it cannot invoke.
- Split fake-driver CI conformance from opt-in host integration tests. Rich adapters may capability-gate a SKIP only when unavailable; disk-floor tests always run. Demonstrate a real host bridge for persistent dual-runtime and on-demand MCP modes or stop the wave as incomplete.
- MCP/App-server test proving returned text without a valid result artifact is rejected.
- Dead-peer → one respawn → valid result, and dead-peer → exhausted recovery → transaction cancel + harness STOP tests; prove timeout does not kill an unrelated persistent peer.
- Wrong-role, disallowed direct specialist→context-provider transition, nested-depth overflow, wrong/root/parent request, stale subject HEAD/scope/PLAN, empty-content, malformed, duplicate, late-attempt, and conflicting-result rejection.
- Two-poller/claim race, idempotent re-read, backoff/deadline, session-exact worker stop, transaction cancel, and cleanup tests.
- End-to-end same-worktree Claude ↔ Codex consultation and specialist → architect → context-provider → architect → specialist chain.
- End-to-end sibling-worktree Claude ↔ Codex consultation through a confined shared root, including different producer HEADs with exact subject binding and changed/undeclared subject rejection.
- Portability proof with every rich adapter disabled: disk-only flow completes only with a registered polling worker or otherwise fails closed deterministically.

### Backlog and memory impact

- **Closes/touches**: agent-teams notification residual (local portion), the operational gap left after Wave 2 coordination artifacts, and the live-collaboration part of the optional Topology Pilot.
- **Touches, does not close**: BL-W4-12 (actor/role authorship), because cryptographic or OS-level identity is not promised here; Wave 3 and Wave 5 complete the policy/evidence sides.
- **Memory on ship**: create `project_wave_portable_runtime_messaging_adapters_shipped.md`; refresh the Wave 2 coordination-artifacts and harness-audit memories with the shipped consumer loop, exact adapters, compatibility decision, and measured degraded-mode behavior.

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

**No-go**: making a JS/runtime hook the sole push authority, regex patch accumulation, blocking harmless text that merely contains `git push`, or promising cross-runtime identity guarantees that the host cannot enforce.

**Risks**: shell grammar complexity; false positives/negatives around wrappers; bypass through alternate git transports; confusing evidence authority with actor authorization.

**Verification expected**: adversarial command corpus with evasive spelling and benign false positives; direct git/pre-push integration; missing/stale/invalid proof rejection; explicit exception tests; rich-adapter unavailable path proving git-layer enforcement still holds.

**Backlog entries**: closes H1's deferred CRITICAL command-string detector redesign and advances BL-W4-12 from discipline-only to the strongest honest host/runtime policy available.

**Memory on ship**: create `project_wave_native_push_authority_peer_policy_shipped.md`; update H1 shipped memory with the detector successor, exact portable authority boundary, and any runtime-specific actor guarantees.

---

## Wave 6 — Class-Aware Phase & Topology Control Plane

**Class**: HARNESS

**Objective**: mechanize the PREP → EXECUTE → VERIFY-FINAL → QG lifecycle, derive required roles from wave class, and manage selective peer activation/liveness without returning to a fixed Claude-only team.

**Why sixth**: the control plane should be the final composition step. It depends on portable consultations, strict verdicts, reproducible evidence, and honest push authority; implementing it earlier would hard-code transitional contracts.

**Included**:

- A fail-closed phase state machine with legal transitions and persisted state.
- Class-aware role floors for HARNESS, DOC, and FAST-PATH; resolve required architects/specialists from declared scope rather than a fixed roster.
- Selective spawn/wake/park/stop behavior using Wave 1 adapters; lifecycle/heartbeat policy and bounded recovery.
- Mechanize `wave-topology.yaml`/required-role/quality-gate integration, including the currently inert Rule A in `wave-phase-gate.js`, and reconcile README/AGENTS counts, roster, script/hub tables, `/work`, `/init-session`, templates, registries, and generated adapters.
- Close or deliberately disposition the README audit revalidated at `619d9a7`: 21 findings (0 HIGH, 15 MEDIUM, 6 LOW), comprising 12 missing shell-script rows (`emit-pre-pr-report`, `emit-push-proof`, `emit-qg-result`, `emit-rule-inventory`, `qg-doc-validators`, `qg-path-audit`, `qg-registry-integrity`, `run-bats`, `secret-scan-report`, `write-coordination-artifact`, `write-specialist-dispatch`, `write-verdict`), four library scripts misclassified as standalone, guide/sub-doc/shell-script count drift (`28→29`, `97→102`, `50→63`), and incomplete agents/testing hub coverage. Re-run `readme-audit` at the Wave-6 starting HEAD rather than treating this baseline as permanent.
- Run the deferred Topology Pilot with measured persistent-peer vs on-demand/subagent/disk-only comparisons.

**No-go**: mandatory `TeamCreate`, spawning every role for every wave, another parallel state ledger, or changing domain/product architecture.

**Risks**: deadlocks from over-strict transitions; class misclassification; fixed-roster drift reappearing in generated surfaces; lifecycle automation stopping a still-needed worker.

**Verification expected**: state-transition table tests; role-floor fixtures for all wave classes; illegal transition and missing-role rejection; persistent/on-demand/disk-only topology scenarios; liveness/stop/respawn tests; README/skill/template/registry parity; measured pilot report.

**Backlog entries**: closes BL-W4-10 (class-aware mechanization), BL-W4-11 (README/skills fixed-roster drift), the current README/doc-index audit, BL-W4-8's three hygiene items, Wave 39's phase/topology items after re-audit, and the BL-W47 Topology Pilot.

**Memory on ship**: create `project_wave_class_aware_phase_topology_control_plane_shipped.md`; update phase-orchestration, adaptive-harness, Wave 19 topology, topology-pilot, and README-audit memories with measurements, final role floors, and the disposition of all 21 baseline doc findings.

---

## Residuals mapped to the ordered program

Historical text below is not an instruction to execute old wave plans literally. Re-audit each item at the target wave's starting HEAD.

| Finding / historical entry | Current disposition | Roadmap home |
|---|---|---|
| Agent-team completion notification drop | Upstream/runtime report remains optional; local liveness/consultation behavior belongs here | Wave 1; upstream report independent |
| Wave 2 artifacts have no general consumer/wakeup/result loop | Open | Wave 1 |
| BL-W4-12 orchestrator can forge architect-shaped verdict path | Open; spans result authorship, verdict evidence, and honest actor policy | Waves 1, 3, 5 |
| Broad workflow input/expression inventory after targeted H1 follow-up | Open | Wave 2 |
| Wave A unbacked `APPROVED-PREP` / weak VERIFY-FINAL substring acceptance | Open | Wave 3 |
| Wave A evidence reproducibility / rerun-until-green concern | Open | Wave 4 |
| Bats unsafe project-root and stale protocol metadata prose | Open | Wave 4 |
| H1 command-string push detector | Explicitly deferred by H1 | Wave 5 |
| BL-W4-10 class-aware phase mechanization | Open | Wave 6 |
| BL-W4-11 README + `/work` + `/init-session` fixed-roster drift | Open | Wave 6 |
| BL-W47 Topology Pilot / Wave 39 topology debt | Re-audit; do not replay old TeamCreate assumptions | Wave 6 |
| BL-W4-8 Bats test-authoring hygiene (three small doc/test naming issues) | Open; one owner, no standalone cleanup wave | Wave 6 |
| BL-W36-04 stash/baseline methodology | Re-audit against current diff/baseline tooling | Wave 4 if still reproducible |
| BL-W32-04 context-provider zombie observation | Reproduce during Wave 1; close only if adapter liveness covers the observed failure, otherwise emit a measured Wave-6 residual | Wave 1, conditionally Wave 6 |
| README/AGENTS/doc index audit revalidated at `619d9a7` | Open; 21 findings (0 HIGH, 15 MEDIUM, 6 LOW) cover 12 missing script rows, four misclassified library rows, count drift, and hub coverage; fixed-roster prose remains an additional Wave-6 concern | Wave 6; bundle, no standalone cleanup wave |

## Independent / incubator backlog

These items are not allowed to interrupt Waves 1-6 unless a concrete blocker or security trigger changes priority.

| Item | Status / trigger |
|---|---|
| Upstream agent-teams notification delivery report | LOW/MED; file only with a minimal runtime repro; not a local harness blocker |
| PS1 `run-qg` restoration | MED; requires an environment with `pwsh` and security-critical parity tests |
| `dual-location-protocol.md` registry-sync omission | LOW; fold into the next canonical/template registry edit |
| Duplicate `MAX_LINES = 435` policy in shell/TypeScript validators | LOW; centralize when either validator next changes |
| Commit-lint semantics duplicated across hook, mint, JS gate, and CI comparison point | LOW/MED; shared-helper design, not part of messaging |
| BL-W47-PREPR-1 missing `/quality-gate` command entrypoint | MED; requires an explicit harness-entrypoint decision |
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
| Wave 39 `BL-W36-02` / `BL-W36-03` | Stub-doc consolidation and MIGRATIONS field normalization remain independent housekeeping |
| Wave 39 `BL-W36-04` | Stash/baseline methodology maps conditionally to Wave 4 after reproduction |
| Wave 39 `BL-W37-03` / `BL-W37-04` | Empty-Bats reusable workflow and immutable L0 workflow pinning remain L1/supply-chain follow-ups |
| Wave 39 housekeeping / modularization paso 2 | Independent cleanup; require a current inventory before scheduling |
| Wave 40 — Wave 17 L2 hardening | Re-audit against current L2 consumer and new harness contracts after Wave 6 |
| Wave 41 — Plugin v0.2.0 generalization | Product/plugin roadmap; independent of harness ordering |
| Wave 42 — OSS Phase 1 modularization | Product/packaging roadmap; independent of harness ordering |
| Wave 43 — Wave 18 hypothesis triage | Data-triggered only; use current metrics before scheduling |
| BL-W47 Ex-PR6 HOLD checkpoint / council design / dead-skill pruning | Re-audit after Wave 6; do not revive superseded adaptive-harness mechanics |
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

This roadmap PR changes `BACKLOG.md` only. Shipped history is factual; queued-wave memory must be updated by the owning implementation wave, not speculatively marked shipped here.

| Milestone | Required memory action |
|---|---|
| G0 shipped backfill | Reconcile `project_followup_ci_harden_workflow_inputs_queued.md` with PR #245, `619d9a7`, final evidence, and the retained residual inventory; keep `project_wave_push_authority_bootstrap_shipped.md` unchanged except for a factual follow-up link if needed |
| Wave 1 | Add portable-runtime-adapters shipped memory; refresh Wave 2 coordination and harness-audit memories with exact implemented transports and degraded-mode proof |
| Wave 2 | Add workflow-input-boundary audit shipped memory with a machine-generated inventory and privileged-workflow review |
| Wave 3 | Add structured-verdict contract shipped memory; amend evidence-integrity/phase memories with migration semantics |
| Wave 4 | Add reproducibility/Bats-provenance shipped memory; amend Wave A/C/QG memories without reopening resolved findings |
| Wave 5 | Add native-push/peer-policy shipped memory; link H1's intentionally deferred detector item to its closure |
| Wave 6 | Add class-aware phase/topology shipped memory; consolidate obsolete Wave 19/BL-W47 topology records and retain pilot measurements |

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
2. After each shipment, promote exactly one subsequent row to **NEXT**; do not reopen G0 or execute historical entries literally.
3. Freeze one plan/path manifest, preserve the wave's no-go boundary, and avoid standalone micro-waves for routine cleanup.
4. On completion, record final PR/commit/tests in memory, move the wave to Shipped, and promote the next row.
5. If a real security or release blocker requires reordering, document the evidence and dependency explicitly rather than silently changing the sequence.
