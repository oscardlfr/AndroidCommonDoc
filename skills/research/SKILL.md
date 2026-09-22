---
name: research
description: "Ad-hoc technical research before implementation."
intent: [research, explore, investigate, technical, pre-implementation]
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
2. Ask the shared lifecycle/control plane to ensure `researcher`, then dispatch
   the runtime-neutral task `Research this topic: $ARGUMENTS` with `{cwd}` and
   a structured, sourced findings requirement. The selected runtime connector
   owns its concrete dispatch primitive.

3. Present findings to the user

## Notes

- Use for unfamiliar domains, library comparisons, or architecture research
- The researcher uses WebSearch, Context7, and codebase analysis
- For quick lookups, just answer directly instead of spawning the agent
