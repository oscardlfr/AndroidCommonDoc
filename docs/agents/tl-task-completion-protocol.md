---
scope: [workflow, ai-agents, pm, specialists]
sources: [androidcommondoc]
targets: [main agent]
slug: tl-task-completion-protocol
status: active
layer: L0
parent: agents-hub
category: agents
description: "team-lead task completion protocol: specialists send READY-FOR-REVIEW, team-lead verifies delivery then marks completed. Never accept specialist self-completion."
version: 1
last_updated: "2026-05"
assumes_read: tl-verification-gates
token_budget: 600
---

# tl-task-completion-protocol

Specialists CANNOT mark tasks completed. team-lead is the sole task-completion authority.

## Specialist Signal

```
READY-FOR-REVIEW: <task-id>
Summary: <what was done>
Files modified: <list>
```

## team-lead Verification Steps

1. **Receive READY-FOR-REVIEW** from specialist via SendMessage
2. **Verify delivery**: cross-check files modified vs claimed (git status or grep)
3. **Check scope**: confirm no out-of-scope changes
4. **Mark completed**: `TaskUpdate(taskId="<id>", status="completed")`
5. **Notify next dependent** if any task was unblocked

## Mechanical Enforcement

`.claude/hooks/specialist-task-completion-gate.js` (BL-W47-prep-10 F1) blocks specialist `TaskUpdate` with `status="completed"`. The hook exits non-zero on violation.

**Bypass** (emergencies only, requires user authorization): `SPECIALIST_TASK_COMPLETION_BYPASS=1` env var.

## Anti-Patterns

- **DO NOT** accept task completion from architect or specialist directly
- **DO NOT** mark completed based on a claim alone — verify files
- **DO NOT** mark completed if READY-FOR-REVIEW was never received

## Origin

BL-W47-prep-10 F1 — specialists were self-completing tasks without team-lead verification, bypassing the architect verification gate.
