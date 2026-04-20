<!-- GENERATED from skills/check-outdated/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Check libs.versions.toml against Maven Central for outdated dependencies. Caches results in kdoc-state.json."
---

Check libs.versions.toml against Maven Central for outdated dependencies. Caches results in kdoc-state.json.

## Instructions

## Usage Examples

```
/check-outdated                           # Check shared-kmp-libs catalog
/check-outdated --project ~/MyApp         # Check a specific project
/check-outdated --refresh                 # Bypass cache, query Maven Central
/check-outdated --json                    # Machine-readable JSON output
```

## Parameters

- `project_root` (required) -- Path to project containing `gradle/libs.versions.toml`.
- `cache_ttl_hours` (optional, default: 24) -- Hours before cache expires. Use 0 to force refresh.
- `format` (optional, default: "summary") -- Output format: `summary` (human-readable) or `json`.

## Behavior

1. Reads `{project_root}/gradle/libs.versions.toml`
2. Parses `[versions]` and `[libraries]` sections
3. Checks kdoc-state.json cache -- returns cached results if fresh
4. Queries Maven Central Search API for each library's latest version
5. Compares current vs latest, reports outdated dependencies
6. Caches results in kdoc-state.json under `dependencies` section

### Rate Limiting

Maven Central queries are batched (5 concurrent) with 100ms delays between batches to be respectful of the API.

### Cache

Results are stored in `.androidcommondoc/kdoc-state.json`. Subsequent calls within the TTL window return cached results instantly. Use `cache_ttl_hours: 0` to force a fresh check.
