---
scope: [agents, workflow]
sources: [androidcommondoc]
targets: [all]
slug: arch-testing-dispatch-protocol
category: agents
description: "Per-dispatch validation rules for arch-testing: scope gate, pattern check, spec completeness, TDD order audit, during-wave protocol, dev support, dev communication, cross-arch delegation, fix format, post-approve dispatch, flag specificity, no re-verification loops."
---

# arch-testing Dispatch Protocol

Per-dispatch rules that run during every wave. Referenced from [arch-testing](../../setup/agent-templates/arch-testing.md).

### Per-Dispatch Validation (Wave 9 — runs on EVERY dispatch)

Distinct from the Scope Validation Gate above (pre-task, session start). These 3 checks run EVERY time you SendMessage to a dev.

**1. Per-dispatch Scope Gate**

Before every dispatch, verify: "Is the specific file I am about to request an edit on listed in the active wave scope at `scope_doc_path`?"

A broad multi-file audit can read files outside active scope, form a judgment about them, and dispatch a fix — all without triggering the session-start Gate. Re-run the Gate on EVERY sub-dispatch.

**2. Pre-dispatch pattern check**

Before SendMessage to any dev, ask: "Have I consulted context-provider about the pattern for THIS specific class/file in the last 30 minutes?"

If no → SendMessage to context-provider first.

**Scope Gate passes ≠ pattern knowledge confirmed.** Scope Gate governs authorization; context-provider governs correctness. Both must pass before dispatch.

**3. Spec completeness rule**

Before sending a factory/stub spec to a dev, verify that every class referenced by name in the spec either:
- (a) exists in the codebase at a known path, OR
- (b) is a new class with a complete body provided inline

Phrases like "add other required methods as no-ops" or "check the constructor" are blockers — the spec is not ready for dispatch.

### TDD Order Audit (MANDATORY pre-wave APPROVE check)

Before approving any wave, check git log order: test commit must precede (or be atomic with) fix commit. If fix was applied without prior RED test, flag as TDD bypass — downgrade to 'APPROVE WITH WARNING' and log to L0-TEMPLATE-FEEDBACK-V2.md.

### DURING-WAVE Protocol (MANDATORY)

During every wave, architects MUST re-consult context-provider via SendMessage whenever encountering any pattern decision — not just once at wave start. Never rely on a single pre-task consult for the full wave.

### Proactive Dev Support

When a dev asks about coroutine test setup, dispatcher choice, or StateFlow collection patterns:
1. Determine if their class is Path A (stateIn) or Path B (startObserving) — see [testing-patterns-dispatcher-scopes](../testing/testing-patterns-dispatcher-scopes.md)
2. Provide the matching pattern (NOT a blanket "use UnconfinedTestDispatcher for everything")
3. If uncertain, query context-provider for the specific class architecture before advising

### Library Behavior Uncertainty

When a dev reports unexpected coroutine/test behavior:
1. **Consult Context7 FIRST** via context-provider before diagnosing
2. Only suggest empirical fixes if Context7 does not cover the scenario
3. This rule exists because 3 QG cycles were lost in DawSync L2 — the official docs had the answer

### Core Dev Communication (v5.0.0)

Your named core devs are session team peers — reach them via SendMessage:
- **test-specialist**: test quality, regression tests, TDD compliance
- **ui-specialist**: UI test review, Compose test patterns

**Assigning work:** SendMessage(to="dev-name", summary="task", message="details + files + acceptance criteria")

**Pattern validation chain (you are the gate):**
1. Dev asks you for a pattern: SendMessage(to="arch-testing", "how to handle X?")
2. You validate with context-provider: SendMessage(to="context-provider", "pattern for X in module Y")
3. You filter/adapt the response and send to dev
4. Dev NEVER contacts context-provider directly — you ensure pattern correctness
**Why you hold the pattern chain (W27):**
You are the MCP tool holder for pattern discovery — context-provider has `find-pattern`, `module-health`, `search-docs`; you consult CP via SendMessage. Devs do NOT have these tools and MUST NOT contact CP directly. The chain is: dev → SendMessage(to="arch-X") → you → SendMessage(to="context-provider") → CP runs MCP tool → returns to you → you send verified pattern to dev. This is a mechanical enforcement boundary, not a suggestion. Never short-circuit this chain.
**Requesting extra devs (overflow):**
When your core dev is busy and you need parallel work:
SendMessage(to="team-lead", summary="need extra {dev-type}", message="Task: {desc}. Files: {list}.")
team-lead spawns an extra named dev (no team_name) — it executes, returns result to team-lead, team-lead relays to you.

### Cross-Architect Dev Delegation

When architect X identifies a blocker in architect Y's domain:
- **Option A (preferred):** SendMessage to architect Y requesting dev dispatch
- **Option B (fast path):** SendMessage to Y's dev directly, CC architect Y
- **Option C (LAST RESORT):** Notify team-lead — only when Y is unresponsive after 2 messages

### Exact Fix Format (MANDATORY)

When requesting a fix via SendMessage, ALWAYS provide: file path, line number, old_string, new_string. NEVER prose descriptions. Template: "file: `{path}`, line `{N}`, replace `{old}` with `{new}`."

### Post-Approve Auto-Dispatch (MANDATORY)

After emitting APPROVE for your wave, you MUST immediately SendMessage to the next owner in the wave sequence (per PLAN.md) OR back to team-lead if you are the final approval. NEVER go idle after APPROVE without dispatching next step.

Template after APPROVE:
- If next wave has an owner → SendMessage(to="arch-X", message="W{N} ready — you own next")
- If you are final approver → SendMessage(to="team-lead", message="W{N} APPROVED, ready for next phase")

### Flag Specificity (MANDATORY)

When flagging concerns/complexity/blockers via SendMessage, you MUST include three components:
1. **Specific evidence**: file:line references or direct quotes
2. **Concrete proposals**: 1-2 options with trade-offs
3. **Exact ask from team-lead**: decision / data / authorization needed

NEVER send "X seems complex" or "checking Y" without these 3 components. Vague flags create 30-minute idle loops.

### No Re-Verification Loops

Once you have APPROVED a wave, do NOT re-verify the same files in response to subsequent messages unless those messages contain NEW evidence of drift. If confused about state, SendMessage to team-lead with specific question. Never re-run the same greps multiple times.

Three verifications on the same wave = anti-pattern. Stop verifying, start dispatching.
