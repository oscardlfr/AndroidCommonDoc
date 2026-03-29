---
scope: [workflow, ai-agents, multi-agent, data]
sources: [anthropic-claude-code, androidcommondoc]
targets: [all]
slug: data-handoff-patterns
status: active
layer: L0
parent: agents-hub
category: agents
description: "Agent data handoff: structured markers, severity convention, prose fallback, test gaming detection"
version: 1
last_updated: "2026-03"
assumes_read: autonomous-multi-agent-workflow
token_budget: 1000
---

# Data Handoff Patterns

How agents pass data between each other: structured markers for machine parsing, severity conventions, and fallback strategies.

---

## Structured Markers (Agent to Aggregator)

```markdown
<!-- FINDINGS_START -->
[
  {"severity": "HIGH", "file": "AuthViewModel.kt", "line": 42, "title": "CancellationException swallowed", "category": "error-handling"},
  {"severity": "MEDIUM", "file": "LoginScreen.kt", "line": 18, "title": "Missing contentDescription", "category": "accessibility"}
]
<!-- FINDINGS_END -->
```

Aggregator extracts JSON between markers. Everything outside markers is human-readable narrative.

---

## Severity Convention

| Level | Meaning | Blocks release? |
|-------|---------|-----------------|
| `BLOCKER` | Broken functionality, data loss risk | Yes |
| `HIGH` | Security issue, crash risk | Yes |
| `MEDIUM` | Code smell, missing coverage, pattern violation | No |
| `LOW` | Style, naming, minor improvement | No |
| `INFO` | Observation, context for other findings | No |

---

## Prose Fallback (Agent to Human)

When an agent produces unstructured output, the orchestrator falls back to line-pattern parsing:

- `[BLOCKER]`, `[CRITICAL]`, `[ERROR]`, `[FAIL]` → HIGH+
- `[WARNING]`, `[WARN]` → MEDIUM
- `[OK]`, `[PASS]` → skip

Always prefer structured markers. Prose fallback exists for resilience, not as a design target.

---

## Test Gaming Detection

Anti-patterns that indicate test gaming (quantity over quality):

| Pattern | Why it's gaming |
|---------|----------------|
| `assertEquals(X, X)` | Trivial — always passes |
| `assertTrue(true)` | No-op — tests nothing |
| `assertNotNull(...)` alone | Existence check, not behavior |
| 1 assertion per test class | Minimum effort coverage |
| Mock-only verification | Tests the test, not the code |
| `@Ignore` with no ticket | Silenced failure |

arch-testing detects these via grep on new/modified test files.

---

## Related Docs

- [Multi-Agent Patterns](multi-agent-patterns.md) — topology and orchestration
- [Quality Gate Protocol](quality-gate-protocol.md) — where findings feed into gates
