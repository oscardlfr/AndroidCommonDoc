# Promptfoo Evals

[Promptfoo](https://promptfoo.dev) is a prompt evaluation framework for testing agent and LLM prompt templates. It lets you define test cases with assertions and run them to catch regressions when editing agent prompts.

## Directory layout

```
promptfoo/
  README.md            # this file
  evals/
    example-agent-eval.yaml   # minimal offline-safe example
    <name>-eval.yaml          # one config per agent or prompt under test
```

## How to run a single eval

No global install needed — `npm exec` handles it automatically:

```bash
npm exec -- promptfoo eval --config promptfoo/evals/example-agent-eval.yaml
```

> **Note**: Use `npm exec -- promptfoo eval` (not `npx promptfoo run`). The `npx` form
> fails without a `package.json` in the project root (npm v10+ behaviour).

## How to run all evals

```bash
for f in promptfoo/evals/*-eval.yaml; do npm exec -- promptfoo eval --config "$f"; done
```

## How to add a new eval config

1. Create `promptfoo/evals/<agent-name>-eval.yaml`
2. Set `description` to identify what is being tested
3. Choose a provider:
   - `echo` — offline-safe, no LLM/API key, best for CI
   - `openai:gpt-4o` or similar — requires API key, use locally only
4. Define `prompts` and `tests` with `assert` blocks
5. Run with `npm exec -- promptfoo eval --config promptfoo/evals/<agent-name>-eval.yaml`

## Provider notes

- **echo provider**: Returns the prompt text as the response. Offline-safe — no LLM call, no API key required. Use for CI and structural assertions (`contains`, `not-contains`, `regex`).
- **LLM providers**: Require API keys and incur token cost. Do NOT add LLM-based configs to CI pipelines.

## Example assertion types

| Type | Description |
|------|-------------|
| `contains` | Response must contain the string |
| `not-contains` | Response must not contain the string |
| `regex` | Response must match the regex pattern |
| `javascript` | Custom JS expression over the response |
