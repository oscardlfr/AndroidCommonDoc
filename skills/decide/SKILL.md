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
2. Spawn the advisor agent:

```
Agent(
  subagent_type="advisor",
  prompt="Analyze this decision: $ARGUMENTS\n\nProject context: {cwd}\nProduce a comparison table with recommendation.",
  description="Decide: $ARGUMENTS"
)
```

3. Present comparison table and recommendation to the user

## Notes

- Use when choosing between 2+ approaches, libraries, or architectures
- The advisor researches options using web search and codebase analysis
- For obvious choices, just decide inline instead of spawning the agent
