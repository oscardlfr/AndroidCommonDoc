# M011 Research — Upstream Content Validation

## Prior art analysis

### What exists today

| Component | Does | Doesn't |
|-----------|------|---------|
| `monitor-sources` | URL reachability, version drift, content hash | Read content, understand semantics |
| `check-freshness` | Alias for monitor-sources | Same limitations |
| `pattern-lint.sh` | Grep for anti-patterns in local code | Doesn't check upstream docs |
| `validate-doc-structure` | Hub sizes, frontmatter, naming | Doesn't validate content accuracy |
| `validate-patterns` | 7 pattern categories in local code | Doesn't compare to upstream |

### Content extraction options

| Method | Pros | Cons |
|--------|------|------|
| **Jina Reader** (`r.jina.ai/{url}`) | Clean markdown, handles JS-rendered pages, free tier | External dependency, rate limits |
| **Raw HTTP + html-to-md** | No external dependency | Fails on JS-rendered, noisy output |
| **GitHub API raw** | Clean for GitHub docs | Only works for GitHub-hosted docs |
| **Cached snapshots** | Zero network on repeat | Stale if not refreshed |

**Decision**: Jina Reader primary, raw HTTP fallback, disk cache for both.

### Assertion engine design

Key insight: assertions are **contracts between our docs and upstream**. They should be:
1. Declarative (in frontmatter, not code)
2. Cheaply verifiable (grep/regex, not LLM)
3. Actionable (each failure maps to a specific doc section to update)

### Rate limiting considerations

- Google developer docs: no explicit rate limit, but aggressive fetching → 429
- GitHub: 60 req/hour unauthenticated, 5000 with token
- kotlinlang.org: no known limits
- **Strategy**: 1 fetch per URL per hour, disk cache, batch during CI

### LLM cost analysis (Layer 2)

- Input: ~2000 tokens (our doc) + ~3000 tokens (upstream content) = ~5000 tokens
- Output: ~500 tokens (structured findings)
- Cost per doc: ~$0.03 (Claude Sonnet)
- 10 docs with changes: ~$0.30 per weekly run
- Acceptable for weekly CI — negligible cost

## Schema design

### `validate_upstream` frontmatter

```yaml
validate_upstream:
  - url: string            # upstream URL to fetch
    assertions:            # list of checks to run
      - type: string       # api_present | api_absent | keyword_absent | keyword_present | pattern_match | deprecation_scan
        value: string      # API name, keyword, or regex
        qualifier?: string # context word (for keyword_absent: "recommended")
        context: string    # why this assertion matters (shown in findings)
    on_failure?: string    # HIGH | MEDIUM | LOW (default: MEDIUM)
    cache_ttl?: number     # override default TTL in hours
```

### Content cache schema

```
.androidcommondoc/upstream-cache/
  {sha256(url)}.json
  
{
  "url": "https://...",
  "content_md": "# Page title\n...",
  "fetched_at": "2026-03-23T...",
  "content_hash": "sha256:...",
  "source": "jina" | "raw",
  "ttl_hours": 24
}
```

### Finding extension

Existing `MonitoringFinding` interface works. New `category` values:
- `upstream-api-missing` — api_present failed
- `upstream-api-unexpected` — api_absent failed  
- `upstream-keyword-conflict` — keyword check failed
- `upstream-deprecation` — deprecation_scan found hit
- `upstream-semantic-drift` — LLM detected divergence

## Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Upstream page structure changes break grep | Medium | Low | Pattern match with context window, not exact line |
| Jina Reader rate limited | Low | Low | Disk cache + raw fallback |
| False positives from keyword matching | Medium | Medium | `qualifier` field narrows context |
| LLM hallucination in Layer 2 | Low | Medium | Layer 2 is advisory only, Layer 1 is authoritative |
| Frontmatter bloat from assertions | Low | Low | Keep assertions minimal — 3-5 per doc max |
