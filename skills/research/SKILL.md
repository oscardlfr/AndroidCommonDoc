---
name: research
description: "Ad-hoc technical research before implementation."
copilot: false
---

# Research Skill

Ad-hoc technical research before implementation.

## Usage

```
/research <topic or question>
```

## Steps

1. Parse topic from `$ARGUMENTS`
2. Spawn the researcher agent:

```
Agent(
  subagent_type="researcher",
  prompt="Research this topic: $ARGUMENTS\n\nProject context: {cwd}\nProvide structured findings with sources.",
  description="Research: $ARGUMENTS"
)
```

3. Present findings to the user

## Notes

- Use for unfamiliar domains, library comparisons, or architecture research
- The researcher uses WebSearch, Context7, and codebase analysis
- For quick lookups, just answer directly instead of spawning the agent
