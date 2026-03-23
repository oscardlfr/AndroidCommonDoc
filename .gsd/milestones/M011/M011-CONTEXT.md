# M011 — Upstream Content Validation Engine

## Goal

Extend the monitoring infrastructure from **change detection** (does the URL still exist? did the version bump?) to **semantic validation** (does our documentation still match what upstream teaches?). Detect deprecated APIs, removed patterns, and divergent recommendations before they reach developers.

## Problem Statement

Current `monitor-sources` detects that upstream content *changed* but cannot answer:
- Did they deprecate an API we teach?
- Did they change a recommended pattern we document?
- Is our code example still valid against the current API?
- Did they add a new API that supersedes our recommended approach?

This creates a window where L0/L1/L2 docs confidently teach patterns that upstream has already abandoned.

## Architecture

### Two-layer validation pipeline

```
Layer 1: Deterministic (CI, $0)          Layer 2: Semantic (on-demand, ~$0.05/doc)
┌─────────────────────────┐              ┌──────────────────────────────┐
│ Frontmatter assertions  │              │ LLM analysis                 │
│                         │              │                              │
│ validate_upstream:      │   triggers   │ "Compare our pattern doc     │
│   - api: "stateIn"     │─────────────▶│  against this upstream page. │
│     must_exist: true    │  on change   │  Report: deprecated APIs,    │
│   - keyword: "Channel" │  detected    │  changed recommendations,    │
│     alert_if: recommend │              │  missing new APIs"           │
│                         │              │                              │
│ Output: PASS/FAIL with  │              │ Output: structured findings  │
│ specific violations     │              │ with remediation actions     │
└─────────────────────────┘              └──────────────────────────────┘
```

### Frontmatter schema extension

```yaml
# New optional field in pattern doc frontmatter
validate_upstream:
  - url: "https://developer.android.com/kotlin/coroutines/coroutines-best-practices"
    assertions:
      - type: api_present
        value: "viewModelScope"
        context: "ViewModel patterns depend on viewModelScope launch"
      - type: api_present
        value: "stateIn"
        context: "WhileSubscribed(5000) pattern requires stateIn"
      - type: keyword_absent
        value: "Channel"
        qualifier: "recommended"
        context: "We teach SharedFlow over Channel for UI events"
      - type: pattern_match
        value: "WhileSubscribed"
        context: "Upstream still recommends WhileSubscribed for StateFlow"
    on_failure: HIGH
```

### Assertion types (Layer 1)

| Type | Behavior | Finding severity |
|------|----------|-----------------|
| `api_present` | Grep for API name in upstream content. FAIL if absent. | HIGH — API may be removed |
| `api_absent` | Grep for API name. FAIL if found. | MEDIUM — we explicitly avoid this |
| `keyword_absent` | FAIL if keyword appears near qualifier. | MEDIUM — upstream now recommends what we avoid |
| `keyword_present` | FAIL if keyword NOT found. | LOW — upstream may have changed terminology |
| `pattern_match` | Regex match on upstream content. FAIL if no match. | Configurable |
| `deprecation_scan` | Scan for "deprecated", "removed", "no longer" near our API names. | HIGH |

### New modules

```
mcp-server/src/monitoring/
  change-detector.ts          # existing — change detection
  source-checker.ts           # existing — URL fetch + version extract
  content-fetcher.ts          # NEW — fetch + cache upstream content (Jina/raw)
  assertion-engine.ts         # NEW — Layer 1 deterministic assertions
  semantic-analyzer.ts        # NEW — Layer 2 LLM analysis (optional)
  upstream-validator.ts       # NEW — orchestrator (combines L1 + L2)
  content-cache.ts            # NEW — disk cache for fetched content

mcp-server/src/tools/
  validate-upstream.ts        # NEW — MCP tool
  
mcp-server/src/cli/
  validate-upstream.ts        # NEW — CLI entrypoint

skills/
  validate-upstream/SKILL.md  # NEW — agent skill
```

### Content fetching strategy

```
1. Check disk cache (`.androidcommondoc/upstream-cache/{url-hash}.md`)
   - If fresh (< 24h for CI, < 1h for manual): use cached
   - If stale: re-fetch

2. Fetch via Jina Reader (preferred) or raw HTTP
   - Jina: clean markdown, no nav/ads
   - Raw: fallback, needs basic HTML stripping
   
3. Store: { url, content_md, fetched_at, content_hash }
```

### Integration with existing infrastructure

- `validate_upstream` frontmatter sits alongside existing `monitor_urls`
- Reuses `CheckResult.content_hash` for change detection before running assertions
- Findings follow existing `MonitoringFinding` interface
- Review state (accept/reject/defer) reuses `review-state.ts`
- Report format extends `report-generator.ts`

## Constraints

- Layer 1 MUST work without LLM — pure grep/regex on fetched content
- Layer 2 is OPTIONAL — only invoked when Layer 1 detects change or on manual trigger
- Content cache MUST respect rate limits — no more than 1 fetch per URL per hour
- Frontmatter schema extension MUST be backward compatible — `validate_upstream` is optional
- All new code follows existing module patterns (TypeScript, vitest, logger not console.log)
- Works on L0, L1, and L2 via `--project-root` + `--layer` (same as `monitor-sources`)

## Non-goals

- Not a full link checker (that's `check-freshness`)
- Not a code compiler/linter (that's Detekt/pattern-lint)
- Not a doc structure validator (that's `validate-doc-structure`)
- Does NOT auto-fix docs — reports findings for human/agent review

## Success criteria

1. Run `validate-upstream --project-root <L0>` and get structured findings for docs with `validate_upstream` frontmatter
2. Layer 1 catches a simulated deprecation (test with known deprecated API)
3. Layer 2 (LLM) produces actionable diff when upstream content changes
4. CI workflow runs weekly alongside `doc-monitor.yml`
5. Findings integrate with existing review state (accept/reject/defer)
6. Full test coverage: unit tests for assertion engine, integration tests for pipeline
