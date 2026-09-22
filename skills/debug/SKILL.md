---
name: debug
description: "Systematic bug investigation using the `debugger` agent."
intent: [debug, bug, investigate, hypothesis, fix]
copilot: false
---

# Debug Skill

Systematic bug investigation using the `debugger` agent.

## Usage

```
/debug <bug description>
```

## Steps

1. Parse bug description from `$ARGUMENTS`
2. Gather context:
   - Check recent commits: `git log --oneline -10`
   - Check for error logs or stack traces in the conversation
3. Ask the shared lifecycle/control plane to ensure the `debugger` role, then
   dispatch this runtime-neutral task payload through the selected connector:
   `Investigate this bug: $ARGUMENTS`, recent changes, and `{cwd}`.
   The connector owns any vendor-specific tool call; this public skill does not.

4. Report the debugger's findings to the user

## Notes

- The debugger agent uses scientific method (hypothesis → evidence → test → fix)
- For simple/obvious bugs, fix inline instead of spawning the agent
- If `/test` is available, the debugger will use it to verify fixes
