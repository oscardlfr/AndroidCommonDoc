---
scope: [agents, workflow, runtime-adapter, multi-agent]
sources: [androidcommondoc, bl-w48-team-model-rootfix]
targets: [all]
slug: runtime-adapter-contract
category: adr
description: "ADR-001: engine-agnostic runtime adapter contract — multi-agent as an optional accelerator over a disk-artifact floor"
---

# ADR-001: Runtime Adapter Contract

**Status:** Accepted — implemented in the `runtime-adapter-capability-matrix` wave.
**Context:** Follows BL-W48, which decoupled the load-bearing harness contract from `TeamCreate`/named-team (those tools are gone from the current Claude Code build). This ADR defines an engine-agnostic **adapter contract** so multi-agent (background peers, `SendMessage`, operator visibility) stays a *supported optional accelerator* — never a least-common-denominator harness. The load-bearing contract remains disk artifacts.
**Enforced by:** `scripts/tests/capability-preservation.bats` (C1–C7, anti-degradation) + `scripts/tests/named-team-regression-guard.bats` (anti-reintroduction of a hard `TeamCreate` dependency).
**Supersedes:** none (first ADR in this repo).

---

## 1. The Three-Concept Distinction (constraint 1 — verbatim)

These three concepts MUST NEVER be conflated. They live at different abstraction layers
and have entirely different fates.

### 1.1 Orchestrator / Team-Lead — portable logical ROLE

The **orchestrator** (running as `team-lead`) is the dispatcher/coordinator of a wave:
it spawns agents, sequences work, reads verdicts, and drives the artifact-floor
(PLAN.md → arch-*-verdict.md → quality-gate-report.json → push-proof.json).

This role:
- Is defined by BEHAVIOR, not by a runtime primitive.
- Survives every engine (Claude, Codex, Copilot, any future engine).
- Is currently the MAIN agent (empty `agent_type`) in the Claude build.
- Is referenced in hooks/templates/docs as a ROLE LABEL — those references are PORTABLE
  and must NOT be changed to an engine-specific primitive.

### 1.2 TeamCreate / team_name — obsolete Claude-legacy runtime PRIMITIVE

`TeamCreate()`, `TeamDelete()`, `TeamList()`, and `Agent(team_name=...)` were
Claude-Code-specific APIs that no longer exist as usable primitives in the current
Claude Code build (confirmed BL-W47-tail, merged develop @ `fcf0d48`).

This primitive:
- Is GONE from the current build (0 `TeamCreate(` calls post-BL-W48, per the brief).
- Lives on ONLY as `optional_capabilities: [TeamCreate]` on the two lead templates
  (BL-W48 intent: preserve the concept as an optional adapter hint, not a hard dep).
- The `named-team-regression-guard.bats` (Patterns 1-5) enforces that nothing
  reintroduces it as a hard dependency.
- References that identify this primitive as a named-team mechanic → category
  `Claude-legacy-runtime`. These are candidates for pruning or `optional_capability`
  labeling during implementation, NOT global search-and-replace.

### 1.3 Background Peers / SendMessage / Operator Visibility — preservable CAPABILITIES

These are runtime capabilities that the adapter PRESERVES where the engine supports them:
- **Background peers**: `Agent()` spawns that run with `agent_class=peer`, persist idle,
  and are reusable — observed empirically in this Claude build (dispatch model 3-axis).
- **SendMessage**: the peer messaging channel. Name-routing to idle peers is unreliable
  (finding 1, `project_peer_control_plane_findings.md`). SendMessage routing by any
  identifier is **pending-evidence** as a cross-context contract — observed in BL-W48
  but not proven to be stable across sessions or engine versions.
- **Operator visibility**: the roster/tooling that lets the operator see which peers
  are running, their status, and route control-plane messages.

These capabilities are OPTIONAL ACCELERATORS (artifact floor works without them), belong in
the `adapter-specific-capability` bucket, and must NOT be deleted when references are
reclassified. The anti-degradation guard (section 6) protects them mechanically.

---

## 2. Classification Rubric + Major Reference Pattern Classifications (constraint 2)

### 2.1 Classification Rubric

For EVERY `team-lead`, `TeamCreate`, `SendMessage`, or capability reference in templates,
hooks, docs, and skills, apply this three-bucket classifier:

| Bucket | Definition | Fate |
|--------|-----------|------|
| **portable-role** | The reference names the orchestrator/coordinator *role* — its function, not an engine API. Could be replaced with "orchestrator" or left as "team-lead" with no runtime change. | KEEP AS-IS or relabel to "orchestrator/team-lead" for clarity. Do NOT delete. |
| **Claude-legacy-runtime** | The reference calls or names a runtime primitive that no longer exists: `TeamCreate`, `TeamDelete`, `TeamList`, `spawn_method: TeamCreate-peer`, `session-<slug>-team` as a hard team roster. | Reclassify to `optional_capability` or prune (per-line, not global replace). |
| **adapter-specific-capability** | The reference describes a runtime behavior/channel that is real in some engines and absent in others: background peers, `SendMessage`, `run_in_background`, operator visibility/roster. | PRESERVE. Move into the adapter interface. The anti-degradation guard protects these. |

**EXPLICIT RULE: No global search-and-replace of `team-lead`.**
Exhaustive per-line reclassification is an implementation step, gated by the guards.
The rubric here applies to MAJOR PATTERNS (representative, not exhaustive).

### 2.2 Classification Summary of Major Reference Patterns

**Hooks (all 7)**: Key on `agent_type` values or prefix (`arch-`, empty string for main
orchestrator). "team-lead" appears only in error/guidance messages as a **portable-role**
label — NOT as a gate key. `data.agent_id` ROTATES per wake and must never be used as an
identity contract; `data.agent_type` is the stable gate key. No hook requires changes.

**`tl-*` dispatch docs**: Majority refs are **portable-role** (orchestrator behavior, phase
boundaries). Two genuine edit targets remain in the manifest: `team_name` in
`tl-dispatch-topology.md` (L52 → PRUNE) and legacy-framing in `tl-session-start.md`
(L128 → REFRAME). `arch-topology-protocols.md` has 0 TeamCreate/roster-mechanics content;
only legacy ref = dangling `team-lead.md` xref (L173, PRUNE).

**Agent templates**: `doc-updater.md` and the 5 core specialists carry
`SendMessage(to="team-lead", …)` as the canonical Claude-adapter `send(→orchestrator)`
expression — **correct-as-is, zero rewrite** (verified: 0 named-team-framing hits).
Lead templates carry `optional_capabilities: [TeamCreate]` (BL-W48 intent preserved).

**Skills**: `work`, `sync-l0`, `doc-integrity` — all refs are **portable-role**.

### 2.3 Capabilities to Preserve (NOT to reclassify away)

The following are in the `adapter-specific-capability` bucket and must be KEPT:
- `SendMessage` in 22 template files — the messaging channel; preserved in the adapter interface.
- `background peer` / `run_in_background` in 25 files — spawn mode; preserved in adapter.
- `operator` / `roster` / `visibility` in 7 docs — operator control; preserved in adapter.

**These are the inputs to section 6 (anti-degradation guard).** See `scripts/tests/capability-preservation.bats` (C1–C7) for the mechanical enforcement.

---

## 3. The 9-Operation Adapter Interface (constraint 3)

The adapter interface decouples the orchestrator's logical intent from engine-specific
API calls. The artifact-based fallback (constraint 6) is the floor for every operation
when the channel is absent.

```text
Interface: RuntimeAdapter
```

### 3.1 Operation Signatures and Semantics

#### Op 1: `spawn(role, prompt, options?) → AgentHandle`

**Semantic**: Create a new agent instance for the given role, delivering the initial
prompt. Returns an opaque handle for subsequent operations. The handle's `runtime_id`
field (if populated) is adapter-internal — it is NOT the hook field `data.agent_id`,
which rotates per wake and must never be used as an identity contract or SendMessage
target.

**Options** (engine-specific, all optional):
- `run_in_background: bool` — request background/async execution
- `subagent_type: string` — role identifier (e.g., `arch-platform`, `planner`)
- `custom_name: string` — explicit peer name (use sparingly; canonical names only)

**Artifact-based fallback**: The spawn itself always produces a handle; the agent's
deliverable is ALWAYS a disk artifact (verdict, PLAN.md, report). If the handle is
opaque or `runtime_id` is absent, the orchestrator polls the artifact path, not the
handle.

#### Op 2: `send(handle, message) → void`

**Semantic**: Deliver a message to a running/idle peer agent.

**Artifact-based fallback**: If `send` is absent or unreliable (name-routing failure
per finding 1 in `project_peer_control_plane_findings.md`): the orchestrator writes
the instruction as a `message/v1` artifact under `.planning/wave-<slug>/inbox/<to>/`
(exact filename convention: [coordination-artifact-schema](../agents/coordination-artifact-schema.md))
and the agent reads it on next activation or via a fresh-instance spawn.

#### Op 3: `status(handle) → AgentStatus`

**Semantic**: Query whether the agent is running, idle, complete, or failed.

**Artifact-based fallback**: Read and validate the expected disk artifact. Architects:
verdict file + `APPROVED-PREP`/`APPROVED-FINAL` marker + HEAD-binding (finding 5). Planner:
`PLAN.md` + `### Spawn Table` marker. Quality-gater: `quality-gate-report.json` with
`"verdict":"PASS"` + stamp within TTL (≤30 min). Bare file presence is NOT sufficient.

#### Op 4: `result(handle) → string | null`

**Semantic**: Retrieve the agent's final return value or summary message.

**Artifact-based fallback**: Disk artifact is ALWAYS the authoritative result (message
channel = optional accelerator). Validation mirrors Op 3. A verdict without a valid marker
or with a HEAD mismatch → `result = null`; orchestrator must request re-verification.

#### Op 5: `stop(handle) → void`

**Semantic**: Request graceful shutdown of a running agent (analogous to
`SendMessage(type="shutdown_request")`).

**Artifact-based fallback**: If `stop` is absent: write a stop sentinel file
(`.planning/wave-<slug>/stop-<role>.flag`). The agent checks for this file at
checkpoint boundaries. If the agent is ungovernable (finding 4:
arch-integration resume deadlock), use `spawn(role, fresh-prompt)` as a
fresh-instance-replacement instead.

#### Op 6: `artifact(role, wave_slug) → FilePath`

**Semantic**: Return the canonical disk-artifact path for this role in this wave.
This is the MOST IMPORTANT operation — it defines the load-bearing contract.

**Examples**:
- `artifact('planner', slug)` → `.planning/wave-<slug>/PLAN.md`
- `artifact('arch-platform', slug)` → `.planning/wave-<slug>/arch-platform-verdict.md`
- `artifact('quality-gater', slug)` → `.androidcommondoc/quality-gate-report.json`
  + `.androidcommondoc/push-proof.json`

**No fallback needed**: this is the fallback itself. Every other operation degrades to
reading/writing artifact paths.

#### Op 7: `operator_visibility(handle) → OperatorView | null`

**Semantic**: Return operator-visible metadata: peer name, state, last-active timestamp,
unanswered-message count. `OperatorView` does NOT expose `data.agent_id` (rotating hook
field) — `runtime_id` is adapter-internal and opaque, not a routing target.

**Artifact-based fallback**: Infer liveness from artifact mtime + unanswered count
(addressee-liveness-gate.js logic) when no roster API exists.

#### Op 8: `reuse(name_or_handle) → AgentHandle | null`

**Semantic**: Attempt to reuse/resume an already-running idle peer by canonical NAME
or adapter-internal handle (NOT `data.agent_id` — rotating, not a routing contract).
Treat as best-effort: observed in BL-W48 but not proven cross-context. arch-integration
RESUME path has a known deadlock (finding 4, confirmed 4×) — NEVER use `reuse` for that
role; always `spawn` fresh-instance-replacement. Returns null if unavailable.

**Artifact-based fallback**: `reuse` returns null → `spawn(role, prompt)`. NEVER forge
a verdict from an ungovernable peer — re-verify via a fresh instance (finding 4).

#### Op 9: `overflow(role, index) → AgentHandle`

**Semantic**: Spawn an additional instance of a role when the primary is saturated
(intentional `-2` suffix pattern). Use ONLY for genuine overflow — NEVER to bypass
an ungovernable peer (that is `spawn` / fresh-instance-replacement, not overflow).

**Artifact-based fallback**: Overflow instances write to role-indexed artifact paths
(e.g., `arch-platform-2-verdict.md`). The orchestrator aggregates all role verdicts
before the QG.

---

### 3.2 Adapter Interface (TypeScript-style pseudocode for documentation)

`AgentHandle` carries: `role` (canonical name), `name` (peer name, may be unreliable for
routing), `artifactPath` (always reliable), and optional `runtime_id` (adapter-internal
opaque id — NOT the hook's `data.agent_id` which rotates per wake).

`ArtifactValidation` has four fields: `exists`, `validMarker` (APPROVED-PREP/FINAL + HEAD
match for verdicts; `"verdict":"PASS"` for QG), `headBound` (verdict HEAD == current HEAD),
`fresh` (stamp within TTL). `AgentStatus.state` is derived from all four — bare existence
is NOT sufficient.

```typescript
interface RuntimeAdapter {
  spawn(role: string, prompt: string, options?: SpawnOptions): AgentHandle;
  send(handle: AgentHandle, message: string): void;
  status(handle: AgentHandle): AgentStatus;   // artifactValid: ArtifactValidation
  result(handle: AgentHandle): string | null;
  stop(handle: AgentHandle): void;
  artifact(role: string, waveSlug: string): string;  // canonical file path
  operator_visibility(handle: AgentHandle): OperatorView | null;
  reuse(nameOrHandle: string | AgentHandle): AgentHandle | null;
  overflow(role: string, index: number): AgentHandle;
}
```

**Identity contract**: Load-bearing identity is the disk artifact (file path + valid
content). `runtime_id` is adapter-internal and opaque. The hook field `data.agent_id`
is a SEPARATE, ROTATING value — MUST NOT be used as a SendMessage target, gate key, or
identity contract anywhere in the harness.

### 3.3 Coordination Artifact Schemas

Beyond the `inbox`/`stop`-flag fallbacks named in the per-op semantics above, the portable layer defines 5 further typed schemas — `message/v1`, `request/v1`, `approval/v1`, `result/v1`, `stop/v1` — full field-level contract, paths, and validation rules in [coordination-artifact-schema](../agents/coordination-artifact-schema.md).

---

## 4. Per-Engine Adapter Matrix (constraint 4)

The matrix below covers Claude / Codex / Copilot / Future × the 9 operations.
"pending evidence" means no confirmed API documentation or empirical data exists —
do NOT invent parity that is not observed.

### 4.1 Claude Adapter

Engine: Claude Code (current build, `Agent()` as the only spawn primitive).
Observations from `project_dispatch_model_this_build.md` + `project_peer_control_plane_findings.md`.

| Op | Claude Implementation | Notes |
|----|----------------------|-------|
| `spawn` | `Agent(subagent_type=role, prompt=prompt, run_in_background=bool)` | `TeamCreate`/`team_name` NOT used. `optional_capabilities: [TeamCreate]` preserved in lead templates as a hint — never a hard dep. |
| `send` | `SendMessage(to=<canonical-name>, message=msg)`. Name-routing is the available surface; routing reliability is **pending-evidence** (observed in BL-W48, not proven cross-context). | Falls back to disk inbox if send fails. Do NOT use `data.agent_id` (rotating hook value) as a routing target. |
| `status` | Poll artifact path + validate marker + HEAD-binding per Op 3 semantics. `addressee-liveness-gate.js` tracks unanswered count for liveness inference. | No first-class status API. Bare file presence is NOT sufficient (see Op 3). |
| `result` | Read + validate artifact (verdict file with valid marker + HEAD-bound; QG report with `"verdict":"PASS"` + fresh stamp). Optional: parse completion notification via `send` channel. | Disk artifact is authoritative (finding 5: verdict→HEAD binding). |
| `stop` | `SendMessage(type="shutdown_request")` OR fresh-instance-replacement for ungovernable peers (finding 4). | arch-integration: ALWAYS use fresh-instance-replacement on RESUME path (finding 4, confirmed 4×). |
| `artifact` | Canonical paths per role (see section 3.1 op 6). Engine-agnostic. | |
| `operator_visibility` | Inferred: `agent_class=peer` in tool-use-log; unanswered count from addressee-liveness-gate. No first-class roster API. `data.agent_id` (rotating) is NOT exposed via this op. | `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set — KEEP-PENDING-EVIDENCE on its causal role. |
| `reuse` | `SendMessage(to=<canonical-name>, ...)` — pending-evidence on cross-context reliability. arch-integration: NEVER reuse; always fresh-spawn. | Falls back to fresh-instance-replacement on any routing failure. |
| `overflow` | `Agent(subagent_type=role)` without custom name → canonical name; with intentional index → overflow. | NEVER use `-2` suffix to bypass ungovernable peers. |

**Claude adapter MUST NOT hard-depend on**: `TeamCreate`, `TeamDelete`, `TeamList`,
`Agent(team_name=...)`, named `session-<slug>-team` roster. These are GONE.

**Claude adapter PRESERVES**: background peers, SendMessage channel (pending-evidence
on routing reliability), completion notifications, operator visibility inferred from
tool-use-log.

### 4.2 Codex Adapter

Engine: Codex (OpenAI code-execution / agent environment).
Source: brief constraint 4 + known Codex agent API.

| Op | Codex Implementation | Notes |
|----|---------------------|-------|
| `spawn` | `spawn_agent(role, prompt)` | Codex's native agent spawn primitive. |
| `send` | `send_input(agent_handle, message)` | Codex native message delivery. |
| `status` | `wait_agent(handle, timeout)` → completion state + validate artifact per Op 3 | Blocking wait with timeout; artifact validation is the authoritative check. |
| `result` | `wait_agent(handle)` return value + validate disk artifact (valid marker + HEAD-bound where applicable). | Disk artifact is the authoritative contract (bl-w48 doctrine). |
| `stop` | `close_agent(handle)` | Graceful close of Codex agent. |
| `artifact` | Same canonical paths as Claude adapter (engine-agnostic). | Codex agents write to the same `.planning/wave-<slug>/` paths. |
| `operator_visibility` | Codex execution environment may expose agent list. **Pending evidence on specifics.** | |
| `reuse` | `spawn_agent` with same prompt if no handle available; no persistent-peer model confirmed. | **Pending evidence** on whether Codex agents are reusable across turns. |
| `overflow` | `spawn_agent` additional instance. | |

**Key principle**: Disk artifacts ARE the contract for Codex. The `wait_agent` result
is a delivery mechanism; the authoritative data is the validated file on disk.

### 4.3 Copilot Adapter

Engine: GitHub Copilot (agent/extensions API). Posture: degrade gracefully to the artifact
floor. All 9 ops except `artifact` and `status`/`result` (disk floor) are **pending evidence**
— no confirmed spawn/send/stop/operator_visibility/reuse API. Do NOT invent T3
(background-peer messaging) parity. `artifact` uses the same canonical engine-agnostic paths.

### 4.4 Future Engine Adapter (graceful degradation baseline)

Any unimplemented engine uses the artifact floor: `spawn` = any mechanism that writes the
artifact; `send` = write a `message/v1` artifact under `.planning/wave-<slug>/inbox/<to>/`
(see [coordination-artifact-schema](../agents/coordination-artifact-schema.md)); `status`/`result` = read
+ validate artifact (marker + HEAD-binding/freshness per op 3); `stop` = write
`.planning/wave-<slug>/stop-<to>.flag`; `operator_visibility` = null (infer from artifact
mtime + unanswered count); `reuse` = null (always fresh-instance-replacement);
`overflow` = additional spawn + indexed artifact path.

The artifact floor is the MINIMUM VIABLE multi-agent harness. Any engine that can write files
can participate.

---

## 5. Topology Preservation Mapping (constraint 5)

The three-phase topology (Planning → Execution → Quality Gate) must survive the adapter
abstraction. Show each phase and how it maps.

### 5.1 Planning Phase

**Current**: orchestrator spawns planner via `Agent(subagent_type="planner")`;
planner writes `PLAN.md` to disk; orchestrator reads PLAN.md from disk.

**Adapter mapping**:
- `spawn('planner', brief_prompt)` → AgentHandle
- `artifact('planner', slug)` → `.planning/wave-<slug>/PLAN.md`
- Orchestrator waits for `status(handle).artifactValid.validMarker` = true
  (PLAN.md present AND contains `### Spawn Table` marker), then reads PLAN.md.
- `send`/`result` are optional accelerators (planner may return "plan ready" via
  completion notification); the disk PLAN.md is always the authoritative deliverable.

**Topology preserved**: planner → PLAN.md → orchestrator reads → all engines. ✓

**Who owns dispatch**: orchestrator (main agent, empty `agent_type`). The role label
"team-lead" in template guidance refers to this orchestrator role.

### 5.2 Execution Phase

**Current**: orchestrator dispatches architects (arch-platform, arch-testing,
arch-integration) who validate + specify work; specialists implement; architects
verify. All via `Agent()` + `SendMessage` + verdict files.

**Adapter mapping**:
- `spawn('arch-platform', prep_prompt)` → handle
- `artifact('arch-platform', slug)` → `arch-platform-verdict.md`
- Architects govern specialists: `spawn('test-specialist', task)` dispatched by
  orchestrator on behalf of architect spec.
- `reuse('arch-platform')` for HEAD-move re-bind of verdict (pending-evidence on
  routing reliability; fresh-instance-replacement is always the safe fallback).
  For arch-integration: NEVER use `reuse`; always `spawn` fresh-instance (finding 4).
- Specialist→architect result: artifact (specialist writes file; architect reads and
  validates marker + HEAD-binding).

**Gate preservation**: `premature-execution-gate.js` blocks specialists without
`APPROVED-PREP` verdict. Gate reads file; adapter doesn't change this.
`architect-self-edit-gate.js` blocks arch-* Write/Edit; gate reads agent_type prefix;
adapter doesn't change this.

**Context-provider role**: oracle/cache (read-only). Dispatched via:
- `spawn('context-provider', query)` (single-use) OR `reuse('context-provider')` (pending-evidence on routing reliability); OR, as a disk-artifact fallback: a `coordination/consult/v1` artifact (see [coordination-artifact-schema](../agents/coordination-artifact-schema.md) for the exact filename convention) under `inbox/context-provider/` — `context-provider-gate.js` validates it on a disk branch (wave_slug match + `CONSULT_TTL_SECONDS`/`MAX_CONSULT_FUTURE_SKEW_SECONDS` directional freshness, no `session_id`) when no live SendMessage flag exists. `context-provider-consulted.js` is unchanged: CP stays read-only, so the gate reads the artifact itself rather than gaining a new writer hook.

The `context-provider-gate.js` session-scoped flag remains valid — one CP consultation unblocks all peers regardless of which op was used.

**Topology preserved**: architect→specialist hierarchy; CP oracle; gate enforcement. ✓

**Template refs resolution**: `SendMessage(to="team-lead", …)` in templates is the
canonical Claude-adapter `send(→orchestrator)` expression — correct-as-is, zero rewrite.
Verified 0 named-team-framing hits in `context-provider.md`, `doc-updater.md`, all 5 dev
specialists, `ingestion-loop.md`. Non-conformance applies only to named-`session-<slug>`-team
roster assertions. The anti-degradation guard (C2.1/C2.2/C2.4) protects this capability
from silent deletion.

### 5.3 Quality Gate Phase

**Current**: orchestrator spawns quality-gater; quality-gater runs
`emit-push-proof.sh` → `resolve-required-roles.js` (by CLASS) → artifact floor check
→ `quality-gate-report.json` + `push-proof.json`.

**Adapter mapping**:
- `spawn('quality-gater', qg_prompt)` → handle
- `artifact('quality-gater', slug)` → `quality-gate-report.json` + `push-proof.json`
- QG reads all arch-*-verdict.md via `artifact('arch-*', slug)` and validates
  marker + HEAD-binding for each.
- `emit-push-proof.sh` + `resolve-required-roles.js` are engine-agnostic scripts
  (they read disk files; they don't call runtime APIs).
- `push-authorization-gate.js` checks `agent_type === ''` (main orchestrator).
  This check survives the adapter: the main orchestrator always has empty agent_type.

**The adapter sits BELOW the artifact-floor** (constraint from brief):
`emit-push-proof.sh` + `resolve-required-roles.js` by CLASS is the load-bearing floor.
The adapter provides the EXECUTION mechanism that produces the artifacts the floor
reads. It never replaces the floor.

**Doc-updater ingestion approval gate**: ingestion flow =
context-provider flags gap → orchestrator requests user approval → doc-updater runs
`mcp__androidcommondoc__ingest-content`. This uses `SendMessage` (adapter op 2) for
the CP-to-orchestrator notification; the user approval is an out-of-band gate; the
`ingest-content` invocation is via MCP tool (engine-local). The adapter wraps the
first two steps; the MCP tool call is engine-specific (Claude: available;
other engines: pending evidence on MCP availability).

**Topology preserved**: QG phase, artifact floor, push-authorization, doc-updater gate. ✓

---

## 6. Anti-Degradation Guard Design (constraint 7b)

### 6.1 Problem Statement

The existing `named-team-regression-guard.bats` (Patterns 1-5, BL-W48) prevents
REINTRODUCTION of hard TeamCreate dependencies. But constraint 7b requires a
SECOND, harder guard: prevent DELETION of useful adapter-specific capabilities
(background peers, SendMessage, operator-visibility).

This is harder because:
- Deletion is "negative evidence" (absence of a pattern, not presence of a forbidden one).
- These capabilities are spread across 22+ template files and 25+ docs.
- A global search-and-replace that replaced all SendMessage with disk-write would pass
  the reintroduction guard but fail the anti-degradation guard.

### 6.2 Guard Mechanism: Capability Presence Assertions

The anti-degradation guard is `scripts/tests/capability-preservation.bats` — a plain bats
test file that runs alongside `named-team-regression-guard.bats`. It is NOT a manifest
`conditional_step` and does NOT require protocol_digest regen. The full source is canonical
at `scripts/tests/capability-preservation.bats`. Summary of the 7 assertion groups:

- **C1 (9 tests)**: ADR-001 contains a `#### Op N: \`<name>\`` header for each of the 9
  operations: spawn, send, status, result, stop, artifact, operator_visibility, reuse, overflow.
- **C2 (4 tests)**: `SendMessage(` call-form present in context-provider, doc-updater, and
  quality-gater templates; at least 1 of the 5 dev-specialist templates also carries it.
- **C3 (3 tests)**: `background.peer|run_in_background` documented in `team-topology.md`,
  `tl-dispatch-topology.md`, and at least 20 files across templates/docs/skills.
- **C4 (2 tests)**: `operator.visib|operator_visibility` in at least 1 `tl-*.md` doc (the
  anchor in `tl-dispatch-topology.md` is load-bearing); ADR-001 documents the op semantics.
- **C5 (2 tests)**: ADR documents disk-inbox fallback for `send`; `ArtifactValidation` struct
  with `validMarker`, `headBound`, `fresh` fields present (proves bare-presence flag removed);
  `status` field typed `: ArtifactValidation`.
- **C6 (3 tests)**: `tl-dispatch-topology.md` documents architect→specialist governance;
  `premature-execution-gate.js` lists `test-specialist`; `architect-self-edit-gate.js`
  enforces the `arch-` write restriction.
- **C7 (3 tests)**: context-provider template has oracle/pattern-index marker; context-provider-gate
  exempts `context-provider`; at least 1 `tl-*` doc pairs context-provider with oracle/consult.

### 6.3 What the Guard Catches

| Scenario | Reintroduction guard | Anti-degradation guard |
|----------|---------------------|----------------------|
| Global replace: `SendMessage` → disk-write everywhere | PASS (no TeamCreate added) | FAIL (C2: SendMessage call-form absent from templates) |
| Delete `background peer` from all tl-* docs | PASS | FAIL (C3: below floor count) |
| Delete `operator visibility` docs | PASS | FAIL (C4.1: no matching docs) |
| Fail to promote ADR to `docs/adr/` | PASS | FAIL (C1: ADR not found) |
| ADR drops an op (e.g., deletes `reuse` section) | PASS | FAIL (C1.8: op header absent) |
| artifact fallback weakened to bare presence | PASS | FAIL (C5.2: validMarker absent) |
| Reintroduce `TeamCreate(` hard call | FAIL (named-team guard) | C1–C7 unaffected |
| Delete context-provider oracle documentation | PASS | FAIL (C7.1/C7.3) |

### 6.4 Guard Registration

`capability-preservation.bats` is added to `scripts/tests/` alongside
`named-team-regression-guard.bats`. Both run as plain bats tests in the existing
bats suite — no new manifest `conditional_step`, no protocol_digest regen required.
The QG bats run picks them up automatically as part of the `scripts/tests` directory target.

---

## Appendix A: BL-W48 Residuals — RESOLVED (zero rewrite)

BL-W48's deferred "deeper team-lead refs in specialist bodies" are RESOLVED as correct-as-is:
`context-provider.md` + the 5 dev specialists have 0 named-team-framing hits — `SendMessage(to="team-lead", …)` = portable orchestrator role + adapter `send` op (reframe shipped BL-W48 @ `604487b`; guard C2 protects). Genuine targets = the 9 `docs/agents/*` docs in the Phase-3 manifest, not templates.
