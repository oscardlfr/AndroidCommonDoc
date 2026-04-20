---
name: verify
description: "Goal-backward verification using the `verifier` agent."
intent: [verify, goal, backward, spec, verifier]
copilot: false
---

# Verify Skill

Goal-backward verification using the `verifier` agent.

## Usage

```
/verify <goal description> [--criteria "criteria list"]
```

## Steps

1. Parse goal and optional criteria from `$ARGUMENTS`
2. If no criteria provided, the verifier will derive them from the goal
3. Spawn the verifier agent:

```
Agent(
  subagent_type="verifier",
  prompt="Verify this goal: {goal}\n\nSuccess criteria: {criteria}\n\nProject root: {cwd}\nCheck codebase for evidence of achievement.",
  description="Verify: {goal}"
)
```

4. Report PASS/FAIL verdict with evidence

## Notes

- Use after completing a feature to confirm it meets the spec
- The verifier runs tests and checks code — not just reads files
- FAIL verdicts include specific gaps and recommended actions
