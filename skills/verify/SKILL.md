---
name: verify
description: "Goal-backward verification using the `verifier` agent."
intent: [verify, goal, backward, spec, verifier]
copilot: false
---

> **Authority boundary:** this skill's conversational PASS/FAIL or generated report is not a phase verdict. PREP and VERIFY-FINAL authority exists only as a request-bound, evidence-backed `verdict/v1` record accepted by the canonical validator.

# Verify Skill

Goal-backward verification using the `verifier` agent.

## Usage

```
/verify <goal description> [--criteria "criteria list"]
```

## Steps

1. Parse goal and optional criteria from `$ARGUMENTS`
2. If no criteria provided, the verifier will derive them from the goal
3. Ask the shared lifecycle/control plane to ensure `verifier`, then dispatch a
   runtime-neutral task containing `{goal}`, `{criteria}`, and `{cwd}`. The
   selected runtime connector owns the concrete dispatch primitive.

4. Report PASS/FAIL verdict with evidence

## Notes

- Use after completing a feature to confirm it meets the spec
- The verifier runs tests and checks code — not just reads files
- FAIL verdicts include specific gaps and recommended actions
