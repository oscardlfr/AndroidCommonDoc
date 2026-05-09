# BL-W46 PR4 — Plan-Mode ENTRY Regression Investigation
**Date**: 2026-05-09  
**Investigator**: toolkit-specialist  
**Deferred item**: Deferred-1 (GRAY-1=(b) — investigation-only, no fix unless confirmed reproducible)

---

## 1. Symptom Report (from BL-W45 memory)

> "ya no nos ponemos en plan mode" (we no longer enter plan mode) — ENTRY blocked, not EXIT.

Counter-evidence: in the current BL-W46 session, plan mode was entered and exited successfully (system reminder "Exited Plan Mode" observed at conversation start). The regression is not currently active.

---

## 2. Hook L73 Audit — Does the Gate Correctly Handle ENTRY?

### Source: `.claude/hooks/plan-mode-spawn-planner.js`

**EnterPlanMode handler (lines 58-66)**:
```js
if (toolName === 'EnterPlanMode') {
  if (process.env.CLAUDE_SKIP_PLANNER === '1') {
    process.exit(0);
  }
  try {
    fs.writeFileSync(sentinelPath, new Date().toISOString(), 'utf8');
  } catch (_) {}
  process.exit(0);  // ALWAYS allows — exit 0
}
```

Key observation: **ENTRY is never blocked**. The hook on EnterPlanMode only writes a sentinel file and exits 0 (allow). It does not emit `decision: block`. Plan-mode ENTRY cannot be blocked by this hook.

**Agent handler (lines 68-84)** — checks planner spawn:
```js
if (subagentType === 'planner') {
  const teamName = data.tool_input?.team_name;
  const agentName = data.tool_input?.name;
  if (teamName && agentName === 'planner') {
    fs.unlinkSync(sentinelPath);  // clears sentinel
    process.exit(0);
  }
  // Wrong form: emit block reason
  process.stdout.write(JSON.stringify({ decision: 'block', reason: '...' }));
  process.exit(2);
}
```

L73 (`teamName && agentName === 'planner'`) correctly gates on BOTH conditions. A bare `Agent(subagent_type="planner")` without `team_name` and `name="planner"` is blocked — correct behavior, not a bug.

**ExitPlanMode handler (lines 87-113)**:
- PostToolUse: clears sentinel (no block)
- PreToolUse: blocks if sentinel exists (planner not spawned)

**Conclusion**: The gate NEVER blocks EnterPlanMode. If ENTRY appeared blocked, the cause is elsewhere.

### Git log for `plan-mode-spawn-planner.js`
```
dfad35e fix(tools): bl-w44-s2 retrospective fixes — hooks, gate, lint, generators (PR4 of 4) (#153)
84cab55 feat(agents): bl-w32-07 spawn-pattern coherence — peer-vs-subagent fixes (#93)
242f0c2 feat(agents): bl-w31.7-12 planner peer auto-spawn enforcement (#89)
```

No changes since BL-W44-S2 (#153), which predates the BL-W45 symptom report. Hook is stable; no recent regression introduced.

---

## 3. Session-Start Protocol Audit (`tl-session-start.md`)

**Planning Phase (lines 188-193)**:
```
1. EnterPlanMode() — plan-context.js injects context...
2. Spawn planner: Agent(name="planner", team_name="session-{slug}", subagent_type="planner", ...)
```

Pre-flight checklist item 8:
```
□ 8. Agent(planner) called for non-trivial tasks? → YES or STOP
     (ENFORCED by plan-mode-spawn-planner.js; escape: CLAUDE_SKIP_PLANNER=1)
```

Protocol is correct and complete. No gap found.

`plan-context.js` last changed: wave 31 (#66) — before BL-W45. No recent changes.

---

## 4. /work Skill Audit

**`skills/work/SKILL.md:126`**:
```
| `\b(implement|feature|build|scope|plan|execute|wave)\b` | Act as main-context orchestrator (in-process per W31.6) ***
```

Footnote `***` specifies TeamCreate + 6-peer spawn + plan-mode path. Routing is correct. No gap found.

Last changed in BL-W45-PR1 (#154) — alignment debt cleanup; no plan-mode routing changes.

---

## 5. Settings.json Wiring Audit

All three events correctly wired in PostToolUse (EnterPlanMode, Agent) and both Pre/PostToolUse (ExitPlanMode):
- `EnterPlanMode` → plan-context.js + plan-mode-spawn-planner.js (PostToolUse)
- `Agent` → plan-mode-spawn-planner.js + team-topology-gate.js (PostToolUse)
- `ExitPlanMode` → plan-context.js + plan-mode-spawn-planner.js (Pre AND PostToolUse)

No wiring gap found.

---

## 6. Root-Cause Hypothesis

**Stale sentinel from prior crashed/killed session** is the most likely explanation:

If `.planning/.plan-mode-planner-required` exists from a session that was killed before ExitPlanMode PostToolUse cleanup fired:
- EnterPlanMode: hook overwrites sentinel with new timestamp → exit 0 (allow) ✓
- Agent(planner) in wrong form (missing `name="planner"` or `team_name`): blocked by L73-81
- ExitPlanMode PreToolUse: sentinel exists → block

The perceived "ENTRY blocked" may actually be the Agent(planner) step blocked due to wrong spawn form, which FEELS like being stuck in plan-mode entry. The escape hatch `CLAUDE_SKIP_PLANNER=1` bypasses all sentinel logic.

---

## 7. Conclusion

| Check | Result |
|-------|--------|
| EnterPlanMode can be blocked by hook | NO — hook always exits 0 |
| Recent regression in plan-mode-spawn-planner.js | NO — last change predates symptom |
| Protocol gap in tl-session-start.md | NO |
| /work skill routing gap | NO |
| Settings.json wiring gap | NO |
| Smoking gun found | NONE |

**Deferred-1 status**: CLOSED — not reproducible. No code changes required.

If the symptom recurs: collect the exact block message. If it contains `[plan-mode-spawn-planner]`, fix is to use the correct spawn form: `Agent(name="planner", team_name="session-{slug}", subagent_type="planner", ...)`. If no hook message appears, the regression is platform-level (EnterPlanMode not firing hooks) — out of scope for L0.
