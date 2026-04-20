---
name: eval-agents
description: "Run promptfoo evaluations against agent prompt templates. Validates agent prompts produce expected outputs. Use after editing agent templates to catch regressions."
intent: [eval, agents, promptfoo, validate, regression, templates]
allowed-tools: [Bash, Read, Glob]
copilot: false
---

# Eval Agents Skill

Run promptfoo evaluations against agent prompt templates.

## Usage Examples

```
/eval-agents
/eval-agents --config example-agent-eval
```

## Parameters

- `--config <name>` — Run a specific eval by name (without `-eval.yaml` suffix). Default: run all.

## Behavior

1. **Check promptfoo is available:**
   ```bash
   npm exec -- promptfoo --version
   ```

2. **Run a specific eval:**
   ```bash
   npm exec -- promptfoo eval --config promptfoo/evals/<name>-eval.yaml
   ```

3. **Run all evals:**
   ```bash
   for f in promptfoo/evals/*-eval.yaml; do npm exec -- promptfoo eval --config "$f"; done
   ```

4. **Report results** — pass/fail per test case with assertion details.

## Rules

- **No LLM-based configs in CI** — token cost makes them unsuitable for automated pipelines.
- **Echo provider is offline-safe** — use `id: echo` in eval configs for CI-safe assertions.
- **Use after editing agent templates** — run evals to catch prompt regressions before committing.

## Cross-References

- Eval configs: `promptfoo/evals/`
- Example config: `promptfoo/evals/example-agent-eval.yaml`
- Promptfoo docs: `promptfoo/README.md`
