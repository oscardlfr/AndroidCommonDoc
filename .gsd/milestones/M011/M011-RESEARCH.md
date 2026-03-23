# M011 Research — Unified Documentation Validation System

## Current state analysis

### 9 doc-related tools — fragmented, no unified view

| Tool | Wave | Limitation |
|------|------|------------|
| `validate-doc-structure` (MCP) | Structure | Functions not callable standalone — needs MCP context |
| `readme-audit` (script) | Coherence | L0 README format only |
| `doc-structure.test.ts` (vitest) | Structure | CI-only, not interactive |
| `monitor-sources` (MCP/CLI) | Upstream | Detects change, not what changed |
| `doc-alignment-agent` | Coherence | Manual invocation, stays in `/full-audit` |
| `l0-coherence-auditor` | Structure | L0-only |
| `ingest-content` (MCP) | Upstream | Manual, no assertions |
| `pattern-lint` (script) | — | Code, not docs (stays in `/full-audit`) |
| `validate-patterns` (skill) | — | Code, not docs (stays in `/full-audit`) |

### Consolidation plan

| Existing tool | Becomes in M011 |
|---------------|----------------|
| `validate-doc-structure` functions | Wave 1 checks (wrapped) |
| `readme-audit` count checks | Wave 2 checks (wrapped) |
| `l0-coherence-auditor` | Wave 1+2 (merged into audit-docs) |
| `monitor-sources` version drift | Wave 3 input (change detection trigger) |
| `ingest-content` fetch logic | Shared `content-fetcher.ts` |
| `doc-alignment-agent` | Stays in `/full-audit` (code→doc scope) |

Existing tools are NOT deleted — `audit-docs` wraps and orchestrates them. Standalone usage still works.

## Content extraction

| Method | Use case | Pros | Cons |
|--------|----------|------|------|
| **Jina Reader** (`r.jina.ai/{url}`) | All doc pages | Clean markdown, handles JS | External dependency |
| **GitHub API** | GitHub-hosted docs/releases | Reliable, authenticated | Only GitHub |
| **Raw HTTP** | Fallback | No dependency | Noisy, fails on JS pages |

**Decision**: Jina primary, GitHub API for releases (already in `source-checker.ts`), raw HTTP fallback. All behind `content-fetcher.ts` interface.

## Cache design

```
.androidcommondoc/upstream-cache/
  {sha256(url)}.json

{
  "url": "https://...",
  "content_md": "# Page title\n...",
  "fetched_at": "2026-03-23T...",
  "content_hash": "sha256:...",
  "source": "jina" | "github" | "raw",
  "ttl_hours": 24
}
```

TTL defaults: CI=24h, manual=1h, deep=0 (always refresh).

## Assertion engine design

Key design principles:
1. **Declarative** — assertions live in frontmatter, not code
2. **Cheap** — grep/regex only, no LLM for Layer 1
3. **Actionable** — each failure maps to a specific doc section
4. **Composable** — assertions can be combined (api_present + deprecation_scan)

Context window for keyword matching: 200 characters around the keyword hit. This catches "Channel is deprecated" but not "Channel" mentioned in an unrelated paragraph.

## Cost analysis

| Profile | Network | LLM | Cost per run |
|---------|---------|-----|-------------|
| default (Wave 1+2) | No | No | $0 |
| `--with-upstream` (Wave 1+2+3 L1) | Yes | No | $0 (grep only) |
| `--profile deep` (Wave 1+2+3 L1+L2) | Yes | Yes | ~$0.03/doc with changes |
| CI weekly (Wave 1+2+3 L1) | Yes | No | $0 |

Estimated weekly: 10 docs with upstream changes × $0 (Layer 1 only in CI) = **$0 for CI**.
Manual deep audit: 10 docs × $0.03 = **$0.30 per deep run**.

## `/full-audit` migration

Checks that move from `/full-audit` to `/audit-docs`:
- `readme-audit` (skill, Wave 1 condition l0_only) → Wave 2 of audit-docs
- `l0-coherence-auditor` (agent, Wave 2 condition l0_only) → Wave 1+2 of audit-docs
- `validate-doc-structure` references → Wave 1 of audit-docs

Checks that STAY in `/full-audit`:
- `doc-alignment-agent` — detects code→doc drift, belongs in code review flow

After M011, `/full-audit` profiles.json removes doc-specific entries and adds:
```json
{"type": "skill", "name": "audit-docs", "category": "documentation", "args": "--wave 1,2"}
```
This runs the local-only waves as part of full-audit. Wave 3 (upstream) stays manual/cron only.

## Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Upstream page structure breaks grep | Medium | Low | Context window matching, not exact line |
| Jina rate limited | Low | Low | Disk cache + raw fallback |
| False positives from keyword matching | Medium | Medium | `qualifier` field narrows context |
| LLM hallucination in Layer 2 | Low | Medium | Advisory only, Layer 1 authoritative |
| Frontmatter bloat | Low | Low | 3-5 assertions per doc max |
| Too many tools — user confusion | Medium | Medium | `/audit-docs` is THE entry point, others are implementation details |
