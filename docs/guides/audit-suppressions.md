---
scope: [audit, suppressions, findings]
sources: [scripts, agents]
targets: [android, kmp]
slug: audit-suppressions
status: active
layer: L0
category: guides
parent: guides-hub
description: "How to suppress known false positives in audit findings — schema, expiry, prefix matching"
version: 1
last_updated: "2026-03"
---
# Audit Suppressions

Suppress known false positives so they don't appear in `/readme-audit`, `/full-audit`, or pattern-lint reports.

## File Location

```
<project>/.androidcommondoc/audit-suppressions.jsonl
```

One JSON object per line. The file is consumed by:
- `scripts/sh/lib/suppressions.sh` → used by `readme-audit.sh`, `pattern-lint.sh`
- `full-audit-orchestrator` agent → filters findings before the report
- `findings-report` MCP tool → respects suppressions in aggregation

## Schema

```jsonl
{"dedupe_key":"readme-audit:misplaced:Script 'audit-append' listed in README","reason":"lib/ scripts are intentionally in the README table for discoverability","suppressed_by":"oscar","suppressed_at":"2026-03-22T20:00:00Z","expires":"never"}
```

| Field | Required | Description |
|-------|----------|-------------|
| `dedupe_key` | ✅ | Exact key or prefix pattern (end with `*` for prefix match) |
| `reason` | ✅ | Why this finding is suppressed — must be a real justification |
| `suppressed_by` | ✅ | Who decided to suppress |
| `suppressed_at` | ✅ | ISO-8601 timestamp |
| `expires` | Optional | ISO-8601 expiry date, or `"never"`. Default: never expires |

## Key Format

Keys follow the pattern: `<source>:<category>:<detail>`

| Source | Example Key |
|--------|-------------|
| `readme-audit` | `readme-audit:misplaced:Script 'audit-append'*` |
| `pattern-lint` | `pattern-lint:cancellation-rethrow:core/data/SomeRepo.kt:42` |
| `full-audit` | `full-audit:code-quality:cancellation-exception-swallowed:*` |
| `agent:<name>` | `agent:daw-guardian:cpu-usage-warning:CaptureWatcher.kt` |

## Prefix Matching

End a `dedupe_key` with `*` to suppress all findings that start with that prefix:

```jsonl
{"dedupe_key":"readme-audit:misplaced:*","reason":"All lib/ scripts are intentionally listed","suppressed_by":"oscar","suppressed_at":"2026-03-22T20:00:00Z","expires":"never"}
```

This suppresses ALL `readme-audit:misplaced:` findings.

## Expiry

Suppressions can expire — useful for temporary workarounds:

```jsonl
{"dedupe_key":"pattern-lint:todo-crash:*","reason":"TODO cleanup deferred to M004","suppressed_by":"oscar","suppressed_at":"2026-03-22T20:00:00Z","expires":"2026-06-01T00:00:00Z"}
```

After the `expires` date, the finding reappears in reports.

## Anti-Patterns

- ❌ Don't suppress HIGH severity findings without a plan to fix
- ❌ Don't suppress findings just to get a clean report
- ❌ Don't use `*` to suppress entire categories without reviewing each finding
- ✅ Do suppress known false positives with clear justification
- ✅ Do set expiry for temporary suppressions
- ✅ Do review suppressions periodically — run `grep -c '' .androidcommondoc/audit-suppressions.jsonl` to track count
