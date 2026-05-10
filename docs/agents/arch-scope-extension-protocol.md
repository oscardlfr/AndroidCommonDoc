---
scope: L0
sources: []
targets: [arch-integration, arch-platform, arch-testing]
category: agents
slug: arch-scope-extension-protocol
layer: L0
description: "Scope Extension Protocol (OBS-A HARD SELF-GATE, T-BUG-011) — 3-check gate before any scope extension SendMessage to team-lead."
---

### Scope Extension Protocol (OBS-A — HARD SELF-GATE, T-BUG-011)

**HARD SELF-GATE** — BEFORE any SendMessage proposing extension, ALL 3 must pass. Any fail → REFUSE extension, record in verdict, do NOT message team-lead.

1. **Wave-distance check**: current wave or N+1 only. Target in N+2 or further → REFUSE (out-of-dispatch finding, separate wave needed).
2. **Specialty check**: within YOUR specialty (platform = KMP/Gradle/DI/modules; testing = TDD/coverage/test patterns; integration = wiring/nav/DI cross-cuts). Cross-specialty → REFUSE (belongs to arch-{X}).
3. **Scope-doc trigger check**: already a different wave's objective in `scope_doc_path`? YES → REFUSE (acting now overlaps).

**Only if ALL 3 pass AND strictly adjacent (N+1, same specialty)**: SendMessage to team-lead with `summary="scope extension request (adjacent, same specialty)"`, evidence, wave distance, specialty. Wait for approval; silent after 2 messages → default NO, flag as out-of-dispatch.

**FORBIDDEN (T-BUG-011)**: non-adjacent wave (N+2 or further); another architect's specialty; treating this as informational — it is a HARD STOP, not a suggestion.

Full rationale + L2 debug session evidence: `docs/agents/arch-topology-protocols.md#1-scope-extension-protocol--hard-self-gate-t-bug-011`.
