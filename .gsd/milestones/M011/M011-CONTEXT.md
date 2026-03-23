# M011 — Unified Documentation Validation System

## Goal

Build a complete documentation validation pipeline that answers three questions:
1. **Structure** — ¿Nuestros docs cumplen los estándares L0? (sizes, frontmatter, links, counts)
2. **Coherence** — ¿Nuestros docs están alineados entre sí y con el código? (refs, drift, cross-layer)
3. **Upstream** — ¿Nuestros docs siguen al día con las fuentes oficiales? (APIs, patterns, deprecations)

Unified under a single command: `/audit-docs`

## Problem Statement

Today documentation validation is fragmented across 9 tools with no unified view:

| Tool | What | Limitation |
|------|------|------------|
| `validate-doc-structure` (MCP) | Sizes, frontmatter, naming | No content validation |
| `readme-audit` (script) | README counts match reality | L0-only format |
| `doc-structure.test.ts` (vitest) | L0 refs, hub limits | CI-only, not interactive |
| `monitor-sources` (MCP/CLI) | URL reachable, version drift | Doesn't read content |
| `doc-alignment-agent` | Code → doc drift | Manual invocation |
| `l0-coherence-auditor` | Hub structure, frontmatter | L0-only |
| `ingest-content` (MCP) | Analyze external content | Manual, no assertions |
| `pattern-lint` (script) | Code anti-patterns | Doesn't validate docs |
| `validate-patterns` (skill) | 7 code pattern categories | Doesn't validate docs |

No single command answers "are our docs healthy?" — you have to run 5+ tools and mentally merge the results.

## Architecture

### `/audit-docs` — unified doc audit command

```
/audit-docs                              # all checks, local only
/audit-docs --with-upstream              # include upstream content validation (network)
/audit-docs --layer L1 --project-root /path/to/l1
/audit-docs --profile deep              # include LLM semantic analysis
```

Three waves, separated by cost:

```
Wave 1: Structure (local, $0, <5s)       Wave 2: Coherence (local, $0, <15s)
┌──────────────────────────┐              ┌──────────────────────────────┐
│ • Hub docs ≤ 100 lines   │              │ • Internal links resolve     │
│ • Sub-docs ≤ 300 lines   │              │ • L0 refs from L1/L2 valid   │
│ • Frontmatter complete   │              │ • Doc alignment with code    │
│ • Naming conventions     │              │ • README counts match        │
│ • archive/ excluded      │              │ • Hub tables complete        │
└──────────────────────────┘              │ • Cross-layer refs valid     │
                                          └──────────────────────────────┘

Wave 3: Upstream (network, ~$0.30, opt-in)
┌──────────────────────────────────────────┐
│ Layer 1: Deterministic ($0)              │
│ • API present/absent assertions          │
│ • Deprecation keyword scan               │
│ • Version drift (manifest vs upstream)   │
│                                          │
│ Layer 2: Semantic (LLM, ~$0.03/doc)      │
│ • Pattern doc vs upstream content diff   │
│ • Changed recommendations detection      │
│ • New API discovery                      │
└──────────────────────────────────────────┘
```

### Separation from `/full-audit`

| | `/full-audit` | `/audit-docs` |
|---|---|---|
| **Scope** | Code, architecture, tests, security, release | Documentation only |
| **Network** | Never | Only Wave 3 (opt-in) |
| **LLM** | Never | Only `--profile deep` |
| **Cost** | $0 | $0 default, ~$0.30 with `--with-upstream` |
| **When** | Every PR, pre-release | Weekly cron, manual, pre-release |
| **Doc checks** | Only `doc-alignment-agent` (code→doc drift) | All doc validation |

`/full-audit` keeps `doc-alignment-agent` because it detects when a code change broke a doc — that belongs in code review. Everything else doc-related moves to `/audit-docs`.

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
    on_failure: HIGH
```

### Assertion types (Wave 3, Layer 1)

| Type | Behavior | Severity |
|------|----------|----------|
| `api_present` | Grep for API name in upstream content. FAIL if absent. | HIGH |
| `api_absent` | Grep for API name. FAIL if found. | MEDIUM |
| `keyword_absent` | FAIL if keyword appears near qualifier. | MEDIUM |
| `keyword_present` | FAIL if keyword NOT found. | LOW |
| `pattern_match` | Regex match on upstream content. FAIL if no match. | Configurable |
| `deprecation_scan` | Scan for "deprecated", "removed", "no longer" near our API names. | HIGH |

### New modules

```
mcp-server/src/monitoring/
  content-fetcher.ts          # NEW — fetch + cache (Jina/raw), shared with ingest-content
  content-cache.ts            # NEW — disk cache with TTL (.androidcommondoc/upstream-cache/)
  assertion-engine.ts         # NEW — Layer 1 deterministic assertions
  semantic-analyzer.ts        # NEW — Layer 2 LLM analysis (optional)

mcp-server/src/tools/
  audit-docs.ts               # NEW — MCP tool (orchestrates all waves)
  validate-upstream.ts        # NEW — MCP tool (Wave 3 standalone)

mcp-server/src/cli/
  audit-docs.ts               # NEW — CLI entrypoint

skills/
  audit-docs/SKILL.md         # NEW — unified skill
  validate-upstream/SKILL.md  # NEW — standalone upstream validation
```

### Relationship with `ingest-content`

| | `ingest-content` | `validate-upstream` | `audit-docs` |
|---|---|---|---|
| **Trigger** | Manual | Automatic (Wave 3) | Manual or cron |
| **Input** | Any URL or pasted text | URLs in frontmatter | Entire docs/ tree |
| **Question** | "Should we add this to our docs?" | "Are our docs still valid?" | "How healthy are our docs?" |
| **Direction** | Outside → In | Inside → Out | Both |

Shared infrastructure: `content-fetcher.ts` + `content-cache.ts`. Same URL fetched once, cached, used by all three.

Pipeline when upstream changes:
```
audit-docs --with-upstream (detect) → ingest-content (analyze change) → human review → doc update
```

### Multi-layer support

Works on L0, L1, L2 via `--project-root` + `--layer`:
- Wave 1 (structure): adapts limits per layer (archive/ excluded everywhere)
- Wave 2 (coherence): L1/L2 checks `l0_refs` resolve to valid L0 slugs
- Wave 3 (upstream): uses layer-appropriate `versions-manifest.json`

## Constraints

- Wave 1 and 2 MUST work offline — no network, no LLM
- Wave 3 is opt-in (`--with-upstream`) — never runs by default
- LLM semantic analysis is opt-in (`--profile deep`) — never runs in CI
- Content cache respects rate limits — max 1 fetch per URL per hour
- `validate_upstream` frontmatter is optional — docs without it skip Wave 3
- All findings follow existing `MonitoringFinding` interface
- Review state (accept/reject/defer) reuses `review-state.ts`
- Works on L0, L1, L2 with same command

## Non-goals

- Not a code linter (that's Detekt/pattern-lint in `/full-audit`)
- Not a test runner (that's test-specialist in `/full-audit`)
- Does NOT auto-fix docs — reports findings for human/agent review
- Does NOT replace `/full-audit` — complements it

## Success criteria

1. `/audit-docs` runs on L0 with 0 findings (Wave 1+2)
2. `/audit-docs --with-upstream` detects a simulated deprecation
3. `/audit-docs --layer L1 --project-root <L1>` works on consumer projects
4. Wave 3 Layer 1 catches deprecated API in upstream content
5. Wave 3 Layer 2 produces actionable diff (deep profile only)
6. CI workflow runs weekly (Waves 1+2+3 Layer 1 only)
7. Full test coverage: unit + integration per module
