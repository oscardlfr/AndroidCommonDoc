---
scope: [agents, workflow, runtime-adapter, multi-agent]
sources: [androidcommondoc, bl-w48-team-model-rootfix]
targets: [all]
slug: runtime-adapter-contract
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

These capabilities:
- Are OPTIONAL ACCELERATORS (the artifact floor works without them).
- Must NOT be deleted when references are reclassified.
- Belong in the `adapter-specific-capability` bucket.
- The anti-degradation guard (section 6 + constraint 7b) protects them mechanically.

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

### 2.2 Classification of Major Reference Patterns (from the brief surface)

#### 2.2.1 Hooks (7 hooks — how they reference team-lead)

| Hook | Reference type | Classification | Notes |
|------|---------------|----------------|-------|
| `addressee-liveness-gate.js` | Error message: "Route to team-lead or an alternate peer instead." | **portable-role** | "team-lead" = role label in human-readable error text. No runtime key. Keep. |
| `architect-bash-write-gate.js` | Checks `agentType.startsWith('arch-')` — no team-lead key. Routes by `agent_type` prefix. | — | No team-lead reference in logic; brief count likely from docs/comments. |
| `architect-self-edit-gate.js` | Error message: `SendMessage(to="team-lead", ...)` as recovery instruction. | **portable-role** | Role label in guidance text. Keep. Also names the SendMessage channel — adapter-specific-capability. |
| `context-provider-gate.js` | Old exemption comment: "team-lead exemption removed: main is now caught by empty agent_type check." The CURRENT logic exempts `agent_type === ''` (main orchestrator). | **portable-role** (historical comment) | The functional exemption is by empty agent_type, not the name "team-lead". Comment is documentation of a past state. Safe to update comment; logic already correct. |
| `plan-md-write-gate.js` | Checks `agentType === 'planner'` — no team-lead key in logic. | — | No team-lead reference in enforcement logic; possible doc comment. |
| `premature-execution-gate.js` | Comment: "Excluded: arch-*, team-lead, context-provider, project-manager, quality-gater, planner". SUBJECT_TYPES list does not include team-lead. | **portable-role** | Role label in exclusion comment. Functional exclusion is by SUBJECT_TYPES absence. Comment correct. |
| `push-authorization-gate.js` | Checks `agent_type` empty = main orchestrator (allow with stamp validation); non-empty = peer/subagent (block). The word "team-lead" does not appear in enforcement logic. | — | Gate keys on empty agent_type for orchestrator identity. Correct. "team-lead" may appear in error messages only. |

**Hook summary**: All 7 hooks key on `agent_type` values or `agent_type` prefix patterns
(e.g., `arch-`, empty string for main). They do NOT hardcode "team-lead" as a gate key.
References in hook source are either: (a) role labels in error/guidance messages
(portable-role, keep), or (b) historical comments (can update for clarity, not required).
**No hook requires changes to unblock the adapter.**

**Critical note on `data.agent_id` in hooks**: The hook field `data.agent_id` ROTATES
per wake — it is a per-invocation value, NOT a stable peer identity. Gates MUST NOT key
on `data.agent_id` as an identity contract. `data.agent_type` is the stable identity
field hooks use for classification. The adapter's `AgentHandle` is a separate concept
(see section 3.2).

#### 2.2.2 `tl-*` Dispatch Docs (docs/agents/)

| Doc | Dominant reference type | Classification |
|-----|------------------------|----------------|
| `arch-topology-protocols.md` | Describes orchestrator BEHAVIOR: dispatch sequences, phase boundaries, artifact routing. "team-lead" = the orchestrator's role label. | **portable-role** (majority). **Only legacy ref = the dangling `team-lead.md` xref (L173)** → Claude-legacy-runtime PRUNE. (Verified: 0 `TeamCreate`/`team_name`/roster-mechanics content — the earlier "roster mechanics sections" wording over-claimed.) |
| `arch-dispatch-modes.md` | Describes how team-lead dispatches architects (PREP → EXECUTE → VERIFY). | **portable-role** |
| `tl-model-profiles.md` | Per-model behavior notes for the team-lead/orchestrator. References peer behaviors (background, SendMessage). | **portable-role** (model guidance) + **adapter-specific-capability** (peer channels) |
| `tl-dispatch-topology.md` | Topology: Planning/Execution/QG phases, architect/specialist/CP/doc-updater roles. | **portable-role** (majority) + **Claude-legacy**: `team_name` (L52 → PRUNE) and named-team FRAMING (L48 "session team specialist" / L59 "named team peer" → REFRAME). In the exact manifest. |
| `tl-verification-gates.md` | Gate conditions the team-lead enforces (APPROVED-PREP, artifact-floor). | **portable-role** |
| `tl-session-start.md` | Session initialization: CP consultation, planner dispatch, session-start setup. | **portable-role** (protocol, majority) + **legacy-framing** (L128 "session team setup agents" → REFRAME, in the manifest). L219 "No `team_name` required" = EXEMPT (negative/corrected). |

#### 2.2.3 Agent Templates (setup/agent-templates/)

| Template | Dominant reference type | Classification |
|----------|------------------------|----------------|
| `doc-updater.md` (18 refs) | Receives dispatch from team-lead; sends results back via SendMessage. | **portable-role** (dispatch relationship) + **adapter-specific-capability** (SendMessage channel) |
| `context-provider.md` (18 refs) | "On First Contact" protocol; oracle for team-lead queries. | **portable-role** (relationship) |
| Core specialists (12 refs each) | "Receiving work: team-lead sends tasks via SendMessage"; report to team-lead. | **portable-role** (dispatch rel.) + **adapter-specific-capability** (SendMessage channel). **Verified 0 named-team-framing hits** — the BL-W48 "deeper residual" is RESOLVED as correct-as-is (§5.2 + classification-report §5 Decision 2); zero rewrite. |
| Leads (10-11 refs each) | `optional_capabilities: [TeamCreate]` (BL-W48). Otherwise orchestrator role. | **adapter-specific-capability** for the optional_capability entry; **portable-role** for rest |
| `quality-gater.md` (6 refs) | Step 0 activation check: "Confirm you have been activated by team-lead for Phase 3." | **portable-role** |

#### 2.2.4 Skills (skills/)

| Skill | Reference type | Classification |
|-------|---------------|----------------|
| `work` | Specialist receiving-work protocol: dispatched by team-lead. | **portable-role** |
| `sync-l0` | L0 → L1/L2 propagation orchestrated by team-lead. | **portable-role** |
| `doc-integrity` | Doc integrity checks reported to team-lead. | **portable-role** |

#### 2.2.5 Capabilities to Preserve (NOT to reclassify away)

The following are in the `adapter-specific-capability` bucket and must be KEPT:
- `SendMessage` in 22 template files — the messaging channel; preserved in the adapter interface.
- `background peer` / `run_in_background` in 25 files — spawn mode; preserved in adapter.
- `operator` / `roster` / `visibility` in 7 docs — operator control; preserved in adapter.

**These are the inputs to section 6 (anti-degradation guard).**

---

## 3. The 9-Operation Adapter Interface (constraint 3)

The adapter interface decouples the orchestrator's logical intent from engine-specific
API calls. The artifact-based fallback (constraint 6) is the floor for every operation
when the channel is absent.

```
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
the instruction to a well-known disk path (e.g.,
`.planning/wave-<slug>/inbox-<role>.md`) and the agent reads it on next activation
or via a fresh-instance spawn.

#### Op 3: `status(handle) → AgentStatus`

**Semantic**: Query whether the agent is running, idle, complete, or failed.

**Artifact-based fallback**: Read the expected disk artifact and validate it:
- For architects: the verdict file must exist AND contain a valid status marker
  (`APPROVED-PREP` or `APPROVED-FINAL`) AND the head SHA recorded in the verdict
  must match the current HEAD (verdict→HEAD binding, BL-W48 finding 5).
- For the planner: `PLAN.md` must exist and contain `### Spawn Table` (required marker).
- For the quality-gater: `quality-gate-report.json` must exist AND contain
  `"verdict": "PASS"` AND the push-proof timestamp must be within the freshness TTL
  (≤30 min, matching the push-authorization-gate.js stamp model).
- Bare file presence is NOT sufficient — a valid status marker + HEAD-binding/freshness
  check is required where applicable.

#### Op 4: `result(handle) → string | null`

**Semantic**: Retrieve the agent's final return value or summary message.

**Artifact-based fallback**: Read and validate the disk artifact:
- The disk artifact is ALWAYS the authoritative result (the message channel is an
  optional accelerator).
- Validation mirrors Op 3: valid status marker + HEAD-binding for architect verdicts;
  `"verdict": "PASS"` + freshness for QG artifacts.
- A verdict file without a valid marker (e.g., stub present but empty, or HEAD mismatch)
  is treated as `result = null` — the orchestrator must request re-verification.

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

**Semantic**: Return operator-visible metadata: peer name, observed peer state, last
active timestamp, message count. Used by orchestrator for liveness tracking.

**Note on identity**: The `OperatorView` does NOT expose `data.agent_id` (the rotating
hook field). It may expose an adapter-internal `runtime_id` if the engine provides one,
but this is opaque and not a routing target. The orchestrator uses `artifact` presence
and unanswered-message count (addressee-liveness-gate.js logic) as liveness signals,
not peer identity tokens.

**Artifact-based fallback**: If operator visibility is absent (no roster API):
the orchestrator infers liveness from artifact freshness (mtime of the expected
artifact) and unanswered-message count (addressee-liveness-gate.js logic).

#### Op 8: `reuse(name_or_handle) → AgentHandle | null`

**Semantic**: Attempt to reuse/resume an already-running idle peer. The routing
target is the peer's canonical NAME or an adapter-internal handle (NOT the hook's
`data.agent_id`, which rotates per wake and is not a routing contract).

**Pending-evidence note**: `SendMessage` routing to a parked/idle peer was OBSERVED
to work in some BL-W48 sessions but is NOT proven as a cross-context contract.
Treat all `reuse` attempts as best-effort. The arch-integration RESUME path has a
known deadlock pattern (finding 4, confirmed 4×) — for that role, do NOT use `reuse`;
always use `spawn` (fresh-instance-replacement).

Returns null if the peer is unavailable or routing is unreliable.

**Artifact-based fallback**: If `reuse` returns null: call `spawn(role, prompt)`
for a fresh-instance-replacement. NEVER forge a verdict from an ungovernable peer —
re-verify via a fresh instance (finding 4).

#### Op 9: `overflow(role, index) → AgentHandle`

**Semantic**: Spawn an additional instance of a role when the primary is saturated
(intentional `-2` suffix pattern). Use ONLY for genuine overflow — NEVER to bypass
an ungovernable peer (that is `spawn` / fresh-instance-replacement, not overflow).

**Artifact-based fallback**: Overflow instances write to role-indexed artifact paths
(e.g., `arch-platform-2-verdict.md`). The orchestrator aggregates all role verdicts
before the QG.

---

### 3.2 Adapter Interface (TypeScript-style pseudocode for documentation)

```typescript
interface AgentHandle {
  role: string;            // canonical role name (e.g., "arch-platform")
  runtime_id?: string;     // adapter-internal opaque id (may be absent); NOT the
                           // hook's data.agent_id (that rotates per wake — different concept)
  name: string;            // peer name (canonical; may be unreliable for routing)
  artifactPath: string;    // canonical disk artifact path (always reliable)
}

interface ArtifactValidation {
  exists: boolean;
  // For architect verdicts: true if file contains APPROVED-PREP or APPROVED-FINAL
  // AND the recorded head SHA matches current HEAD.
  validMarker: boolean;
  headBound: boolean;      // head in verdict == current HEAD (where applicable)
  // For QG artifacts: true if verdict=="PASS" AND stamp age <= TTL (1800s).
  fresh: boolean;          // within freshness TTL (where applicable)
}

interface AgentStatus {
  state: 'spawned' | 'running' | 'idle' | 'complete' | 'failed';
  // Derived from ArtifactValidation — bare existence is NOT sufficient.
  // complete = exists && validMarker && headBound (architect) / fresh (QG)
  artifactValid: ArtifactValidation;
}

interface OperatorView {
  name: string;
  // runtime_id is adapter-internal and opaque; NOT exposed as a routing target.
  runtime_id?: string;
  state: AgentStatus['state'];
  lastActiveMs: number;
  unansweredMessages: number;
}

interface RuntimeAdapter {
  spawn(role: string, prompt: string, options?: SpawnOptions): AgentHandle;
  send(handle: AgentHandle, message: string): void;
  status(handle: AgentHandle): AgentStatus;
  result(handle: AgentHandle): string | null;
  stop(handle: AgentHandle): void;
  artifact(role: string, waveSlug: string): string;  // file path
  operator_visibility(handle: AgentHandle): OperatorView | null;
  reuse(nameOrHandle: string | AgentHandle): AgentHandle | null;
  overflow(role: string, index: number): AgentHandle;
}
```

**Identity contract**: Load-bearing identity is the disk artifact (file path + valid
content). `runtime_id` in `AgentHandle`/`OperatorView` is adapter-internal and opaque.
The hook field `data.agent_id` is a SEPARATE, ROTATING value that MUST NOT be used as
a SendMessage target, gate key, or identity contract anywhere in the harness.

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

Engine: GitHub Copilot (agent/extensions API).
Source: brief constraint 4 (explicitly: "document the REAL capability surface or mark pending evidence").

| Op | Copilot Implementation | Notes |
|----|----------------------|-------|
| `spawn` | **Pending evidence.** Copilot Workspace may spawn agents; exact API unknown. | Do NOT invent T3 (background-peer messaging) parity. |
| `send` | **Pending evidence.** No confirmed channel analogous to SendMessage. | |
| `status` | Disk artifact validation (always the floor). | |
| `result` | Disk artifact (always the floor). | The artifact floor applies regardless of engine. |
| `stop` | **Pending evidence.** | |
| `artifact` | Same canonical paths (engine-agnostic). | |
| `operator_visibility` | **Pending evidence.** Copilot may have extension-level visibility. | |
| `reuse` | **Pending evidence.** | |
| `overflow` | **Pending evidence.** | |

**Copilot adapter posture**: degrade gracefully to the artifact floor (op 6).
All `send`/`status`/`result` operations use disk artifact fallback until Copilot
capability is confirmed empirically. NO invented T3 parity.

### 4.4 Future Engine Adapter (graceful degradation baseline)

Any engine not yet implemented degrades to the artifact floor:

| Op | Future (degraded) Implementation |
|----|----------------------------------|
| `spawn` | Any mechanism that starts an agent and eventually writes its artifact. |
| `send` | Write to `.planning/wave-<slug>/inbox-<role>.md`. |
| `status` | Read + validate artifact (marker + HEAD-binding/freshness where applicable). |
| `result` | Read + validate artifact. |
| `stop` | Write `.planning/wave-<slug>/stop-<role>.flag`. |
| `artifact` | Canonical path (section 3.1 op 6). |
| `operator_visibility` | null (operator infers from artifact mtime + unanswered-message count). |
| `reuse` | null (always fresh-instance-replacement). |
| `overflow` | Additional spawn + indexed artifact path. |

The artifact floor is the MINIMUM VIABLE multi-agent harness. Any engine that can
write files can participate.

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
- `spawn('context-provider', query)` (single-use) OR
- `reuse('context-provider')` (pending-evidence on routing reliability) OR
- Disk-artifact fallback: context-provider writes pattern index to disk; architects read.
The `context-provider-gate.js` session-scoped flag remains valid — one CP consultation
unblocks all peers regardless of which op was used.

**Topology preserved**: architect→specialist hierarchy; CP oracle; gate enforcement. ✓

**Existing template refs resolution (closes the "adapter-routing depth" question for context-provider / doc-updater / specialists):** template refs of the form `SendMessage(to="team-lead", …)` ARE the canonical Claude-adapter `send(→orchestrator)` expression — `team-lead` is the portable orchestrator role-label (§1.1); `SendMessage` is the Claude `send` op (Op 2). They are **CORRECT as-is and require NO Phase-3 edit**: routing depth = **zero rewrite**. A template ref becomes non-conformant ONLY if it asserts named-`session-<slug>`-team membership/roster (the §3b legacy-FRAMING surface in the classification report — e.g., "session team peers"). Verified clean (0 named-team-framing hits): `context-provider.md`, `doc-updater.md`, all 5 dev specialists, `ingestion-loop.md`. Their `SendMessage(team-lead)` capability is independently protected from deletion by the anti-degradation guard (C2.1/C2.2/C2.4 below), so "leave as-is" cannot silently degrade into "capability dropped."

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

The anti-degradation guard is a **bats test file** (`capability-preservation.bats`)
that runs as a PLAIN bats test inside the test-suite / QG bats run — it is NOT a
manifest `conditional_step` and does NOT require protocol_digest regen. If any
assertion fails, the guard fails.

**Design**: Assertions are organized into named groups (C1–C7). Each group targets
a specific semantic capability at a canonical location. Superficial grep-for-keyword
is insufficient — each test checks for a meaningful semantic marker that proves the
capability is documented and wired, not merely that the word appears.

```bash
#!/usr/bin/env bats
# capability-preservation.bats
# Anti-degradation guard: asserts adapter-specific capabilities are NOT deleted.
# Runs as a plain bats test alongside named-team-regression-guard.bats.
# Complements (does not replace) named-team-regression-guard.bats.

# ── C1: All 9 adapter operations documented in ADR ──────────────────────────

@test "C1.1: ADR documents all 9 adapter ops — spawn" {
  grep -qE '^#### Op [0-9]+: `spawn' docs/adr/ADR-001-runtime-adapter-contract.md
}

@test "C1.2: ADR documents all 9 adapter ops — send" {
  # -w prevents matching 'SendMessage'; we want the op-definition line
  grep -qE '^#### Op [0-9]+: `send' docs/adr/ADR-001-runtime-adapter-contract.md
}

@test "C1.3: ADR documents all 9 adapter ops — status" {
  grep -qE '^#### Op [0-9]+: `status' docs/adr/ADR-001-runtime-adapter-contract.md
}

@test "C1.4: ADR documents all 9 adapter ops — result" {
  grep -qE '^#### Op [0-9]+: `result' docs/adr/ADR-001-runtime-adapter-contract.md
}

@test "C1.5: ADR documents all 9 adapter ops — stop" {
  grep -qE '^#### Op [0-9]+: `stop' docs/adr/ADR-001-runtime-adapter-contract.md
}

@test "C1.6: ADR documents all 9 adapter ops — artifact" {
  grep -qE '^#### Op [0-9]+: `artifact' docs/adr/ADR-001-runtime-adapter-contract.md
}

@test "C1.7: ADR documents all 9 adapter ops — operator_visibility" {
  grep -qE '^#### Op [0-9]+: `operator_visibility' docs/adr/ADR-001-runtime-adapter-contract.md
}

@test "C1.8: ADR documents all 9 adapter ops — reuse" {
  grep -qE '^#### Op [0-9]+: `reuse' docs/adr/ADR-001-runtime-adapter-contract.md
}

@test "C1.9: ADR documents all 9 adapter ops — overflow" {
  grep -qE '^#### Op [0-9]+: `overflow' docs/adr/ADR-001-runtime-adapter-contract.md
}

# ── C2: SendMessage capability preserved in templates ────────────────────────

@test "C2.1: context-provider template documents SendMessage as a channel" {
  # Must contain SendMessage as a callable operation, not just a mention
  grep -qE 'SendMessage\s*\(' setup/agent-templates/context-provider.md
}

@test "C2.2: doc-updater template documents SendMessage as a channel" {
  grep -qE 'SendMessage\s*\(' setup/agent-templates/doc-updater.md
}

@test "C2.3: quality-gater template documents SendMessage for activation handshake" {
  grep -qE 'SendMessage\s*\(' setup/agent-templates/quality-gater.md
}

@test "C2.4: at least one real dev-specialist template documents SendMessage for result reporting" {
  # Positively scope to the ACTUAL core dev specialists — must not be satisfiable
  # via planner / arch-* / leads / context-provider / quality-gater / doc-updater.
  count=0
  for s in data-layer-specialist domain-model-specialist test-specialist toolkit-specialist ui-specialist; do
    grep -qE 'SendMessage\s*\(' "setup/agent-templates/$s.md" && count=$((count+1))
  done
  [ "$count" -ge 1 ]
}

# ── C3: background-peer / run_in_background capability preserved ──────────────

@test "C3.1: team-topology documents the background-peer model" {
  # The canonical topology/model doc must document background peers (the optional
  # accelerator layer). NOT arch-topology-protocols (that doc covers the OBS-A /
  # dispatch-tree gate, never the background-peer model — verified: 0 such refs).
  grep -qiE 'background.peer|run_in_background|agent_class.*peer' \
    docs/agents/team-topology.md
}

@test "C3.2: tl-dispatch-topology documents background-peer or run_in_background" {
  grep -qiE 'background.peer|run_in_background' docs/agents/tl-dispatch-topology.md
}

@test "C3.3: at least 20 files preserve background-peer or run_in_background reference" {
  # Brief surface: 25 files. Allow for some pruning of legacy-only refs, floor at 20.
  count=$(grep -rliE 'background.peer|run_in_background' \
    setup/agent-templates/ docs/agents/ skills/ | wc -l)
  [ "$count" -ge 20 ]
}

# ── C4: operator visibility capability preserved ──────────────────────────────

@test "C4.1: operator_visibility capability documented via an intentional anchor in a tl-* dispatch doc" {
  # Codex item-5 fix: the old test greped docs/agents/ BROADLY and matched a single
  # INCIDENTAL phrase ("peer roster", a cross-ref in tl-phase-execution.md) — floor of 1,
  # fragile (any reword drops it to 0) and inconsistent with the test name ("tl-* doc").
  # Now: restricted to docs/agents/tl-*.md AND anchored to a DELIBERATE capability marker
  # ('operator visibility' / 'operator_visibility'), NOT an incidental phrase. Phase-3 adds
  # the explicit operator-visibility bullet to tl-dispatch-topology.md (in the exact manifest);
  # that anchor line is LOAD-BEARING — removing it IS the capability degradation this guard
  # exists to catch. (C7.3 already greps multiple tl-* docs for the CP oracle, so it is not
  # at floor 1; only C4.1 needed this hardening.)
  count=$(grep -rliE 'operator.visib|operator_visibility' docs/agents/tl-*.md | wc -l)
  [ "$count" -ge 1 ]
}

@test "C4.2: ADR documents operator_visibility operation semantics" {
  grep -qiE 'operator.visib' docs/adr/ADR-001-runtime-adapter-contract.md
}

# ── C5: artifact-fallback semantics preserved ────────────────────────────────

@test "C5.1: ADR documents artifact-based fallback for send" {
  # ADR must describe what to do when send is absent (disk inbox pattern)
  grep -qiE 'inbox|disk.*(fallback|floor)' docs/adr/ADR-001-runtime-adapter-contract.md
}

@test "C5.2: artifact fallback requires a validated check (marker + HEAD-binding + freshness), not bare presence" {
  adr=docs/adr/ADR-001-runtime-adapter-contract.md
  # The full validated-artifact contract (ArtifactValidation struct + all 4 fields) must be present.
  grep -q 'ArtifactValidation' "$adr"
  grep -q 'validMarker'        "$adr"
  grep -qiE 'headBound|HEAD.bind' "$adr"
  grep -qiE '\bfresh'          "$adr"
  # The status field IS the validated struct (`: ArtifactValidation`), which PROVES the
  # bare-boolean presence flag is gone. (Positive assertion only: a negative grep for the
  # old `artifactPresent: boolean` / "poll for presence" would self-match this guard's own
  # pseudocode, since the promoted ADR documents this very test.)
  grep -qE ':[[:space:]]*ArtifactValidation' "$adr"
}

# ── C6: architects-govern-specialists topology preserved ─────────────────────

@test "C6.1: tl-dispatch-topology documents architect→specialist governance" {
  grep -qiE 'architect.*specialist|specialist.*architect' \
    docs/agents/tl-dispatch-topology.md
}

@test "C6.2: premature-execution-gate subject-types still include specialist roles" {
  grep -q 'test-specialist' .claude/hooks/premature-execution-gate.js
}

@test "C6.3: architect-self-edit-gate still enforces architect write restriction" {
  # Gate must still block arch-* from Write/Edit non-verdict files
  grep -q "arch-" .claude/hooks/architect-self-edit-gate.js
}

# ── C7: context-provider oracle role preserved ───────────────────────────────

@test "C7.1: context-provider template documents the oracle/pattern role" {
  grep -qiE 'oracle|pattern.index|knowledge.layer' \
    setup/agent-templates/context-provider.md
}

@test "C7.2: context-provider-gate still exempts context-provider from CP consultation" {
  grep -q 'context-provider' .claude/hooks/context-provider-gate.js
}

@test "C7.3: at least one tl-* doc documents context-provider as the query oracle" {
  count=$(grep -rliE 'context.provider.*(oracle|query|consult)|(oracle|query|consult).*context.provider' \
    docs/agents/ | wc -l)
  [ "$count" -ge 1 ]
}
```

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
The QG bats run picks them up automatically as part of the `scripts/tests/*.bats` glob.

---

## Appendix A: Residuals from BL-W48 — RESOLVED this wave (zero rewrite)

The BL-W48 shipped memory (`project_bl_w48_team_model_rootfix_shipped.md`) noted:
> "Residual follow-up: deeper team-lead refs in specialist bodies
> (Receiving-work/Post-Compaction) — not guarded, non-breaking, deferred to the adapter wave."

**Resolution (ADR-finalize):** investigated and **RESOLVED as correct-as-is — NOT
`Claude-legacy-runtime` candidates, zero rewrite, DISCARDED from the Phase-3 edit surface**
(classification-report §5 Decisions 1–2 + §5.1):
- `context-provider.md` (incl. the old §3.7 / "On First Contact"): **0 named-team-framing
  hits** (`grep 'session team|named team|team_name|TeamCreate'` = 0). Its team-lead refs are
  the portable orchestrator role + `SendMessage` (the adapter `send` op).
- The 5 core specialists' "Receiving work" / "Post-Compaction" sections: **0 named-team-framing
  hits**. "team-lead sends tasks via SendMessage" is the portable + send-op expression; the
  identity reframe already shipped in BL-W48 (@ `604487b`).

Their `SendMessage` capability is protected from deletion by the anti-degradation guard
(C2.1/C2.2/C2.4); §5.2 "Existing template refs resolution" documents the mapping. The
remaining named-team **FRAMING/legacy** surface (the genuine edit targets) is the 9 `docs/agents/*`
docs in the exact manifest — "session team peers/specialist/architects/setup", the dangling
`team-lead.md` xrefs (arch-topology + ingestion-loop), and the "(TeamCreate)" peer label —
NOT the templates.
