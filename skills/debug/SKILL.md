---
name: debug
description: "Systematic bug investigation using the `debugger` agent."
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
3. Spawn the debugger agent:

```
Agent(
  subagent_type="debugger",
  prompt="Investigate this bug: $ARGUMENTS\n\nRecent changes:\n{git_log}\n\nProject root: {cwd}",
  description="Debug: $ARGUMENTS"
)
```

4. Report the debugger's findings to the user

## Notes

- The debugger agent uses scientific method (hypothesis → evidence → test → fix)
- For simple/obvious bugs, fix inline instead of spawning the agent
- If `/test` is available, the debugger will use it to verify fixes
