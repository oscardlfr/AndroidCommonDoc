---
scope: L0
category: guides
slug: script-vs-agent-decision
sources: []
targets: [".claude/agents/", "scripts/"]
---

# Script vs Agent Decision Framework

When to use a deterministic script vs an AI agent for validation checks.

## Decision Matrix

| Criterion | Use Script | Use Agent |
|-----------|-----------|-----------|
| Pattern type | Regex/grep match | Cross-file reasoning |
| Output | Deterministic | Context-dependent judgment |
| CI-runnable | Yes (zero API cost) | No (requires API) |
| Idempotency | Same input = same output | May vary between runs |
| Scope | Single file/line | Architectural relationships |
| Cost | Free | ~$0.01-0.50 per run |

## Examples

### Script-appropriate checks (pattern-lint.sh)
- `CancellationException` not rethrown -- grep for catch blocks
- `MutableSharedFlow` in production -- grep
- `java.time.*` in commonMain -- grep + path filter
- `TODO("Not yet implemented")` -- grep
- `runBlocking` outside tests -- grep + path filter
- `GlobalScope` usage -- grep

### Agent-appropriate checks
- "Is this ViewModel state properly structured?" -- needs semantic understanding
- "Does this feature have adequate test coverage?" -- needs cross-file analysis
- "Are these two scripts functionally equivalent?" -- needs behavioral reasoning
- "Is this error handling complete?" -- needs control flow analysis

## Migration Checklist

When evaluating whether an agent check should become a script:

1. Can the check be expressed as a regex or file-existence test?
2. Does the check always produce the same output for the same input?
3. Would the check be useful in CI (where API calls are expensive)?
4. Is the false-positive rate acceptable without human judgment?

If all four answers are "yes", extract to a script.

## Integration with /full-audit

The `/full-audit` orchestrator runs scripts in Wave 1 (fast, free) and agents in Waves 2-4 (slower, paid). This ordering ensures cheap checks run first, and expensive agent checks only run if the project passes basic hygiene.
