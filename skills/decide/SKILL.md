---
name: decide
description: "Technical decision analysis using the `advisor` agent."
intent: [decide, decision, advisor, compare, tradeoff]
copilot: false
---

# Decide Skill

Technical decision analysis using the `advisor` agent.

## Usage

```
/decide <decision question>
```

## Steps

1. Parse decision question from `$ARGUMENTS`
2. Ask the shared lifecycle/control plane to ensure the `advisor` role, then
   dispatch a runtime-neutral task containing `$ARGUMENTS`, `{cwd}`, and the
   required comparison-table/recommendation output. Vendor-specific dispatch is
   owned by the selected runtime connector, not this public skill.

3. Present comparison table and recommendation to the user

## Notes

- Use when choosing between 2+ approaches, libraries, or architectures
- The advisor researches options using web search and codebase analysis
- For obvious choices, just decide inline instead of spawning the agent
