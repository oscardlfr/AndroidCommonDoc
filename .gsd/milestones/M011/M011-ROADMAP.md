# M011 Roadmap — Unified Documentation Validation System

## Slices

- [ ] **S01: Content fetcher + disk cache (shared infra)** `risk:low` `depends:[]`
  Shared content fetching module: Jina Reader primary, raw HTTP fallback. Disk cache with configurable TTL at `.androidcommondoc/upstream-cache/`. Rate limiting (1 fetch/URL/hour). Refactor `ingest-content` MCP tool to consume the new fetcher. Full test coverage: unit tests for fetcher, cache TTL, rate limiter.

- [ ] **S02: `audit-docs` Wave 1 — Structure validation** `risk:low` `depends:[]`
  Consolidate existing structure checks into a single orchestrator: hub doc size limits, sub-doc size limits, frontmatter completeness, naming conventions, archive exclusion. Wraps `validate-doc-structure` MCP functions. MCP tool `audit-docs` with `wave` filter param. CLI entrypoint. Output: structured findings with severity.

- [ ] **S03: `audit-docs` Wave 2 — Coherence validation** `risk:medium` `depends:[S02]`
  Internal link resolution (markdown links point to existing files). L0 ref validation (L1/L2 `l0_refs` resolve to valid L0 slugs). README count verification (wraps `readme-audit` checks). Hub table completeness (all sub-docs listed). Cross-layer ref validation. Integrates `doc-alignment-agent` findings when available.

- [ ] **S04: Assertion engine (Wave 3 Layer 1)** `risk:medium` `depends:[S01]`
  Deterministic assertion engine — parses `validate_upstream` frontmatter, fetches cached content, runs assertions. Types: `api_present`, `api_absent`, `keyword_absent`, `keyword_present`, `pattern_match`, `deprecation_scan`. Pure grep/regex, no LLM. Findings follow `MonitoringFinding` interface.

- [ ] **S05: `audit-docs` Wave 3 orchestrator + `validate-upstream` tool** `risk:medium` `depends:[S04]`
  Wire assertion engine into Wave 3 of `audit-docs`. Standalone MCP tool `validate-upstream` for targeted validation. Integration with `monitor-sources` (reuse content hash for change-before-validate optimization). `--with-upstream` flag on `audit-docs`. Review state reuse.

- [ ] **S06: L0 seed assertions + multi-layer support** `risk:low` `depends:[S04]`
  Write `validate_upstream` assertions for key L0 docs: ViewModel (stateIn, WhileSubscribed, SharedFlow), Compose (resources, navigation), Coroutines (structured concurrency), KMP (source sets). At least 30 assertions across 10 docs. Verify `--layer L1/L2` works end-to-end with `--project-root`.

- [ ] **S07: Semantic analyzer (Wave 3 Layer 2 — LLM)** `risk:high` `depends:[S05]`
  Optional LLM layer, `--profile deep` only. When Layer 1 detects content change, fetches full content diff. Sends to LLM: "Compare our pattern doc vs upstream. Report: deprecated APIs, changed recommendations, new APIs." Structured output. Cost-controlled — only fires on detected changes (~$0.03/doc).

- [ ] **S08: CI workflow + skill + `/full-audit` separation** `risk:low` `depends:[S05]`
  CI workflow `doc-audit.yml` (weekly cron + manual dispatch). Agent skill `/audit-docs`. Remove doc-specific checks from `/full-audit` profiles.json (keep only `doc-alignment-agent`). Integration with `/full-audit` findings protocol for cross-audit dedup.

- [ ] **S09: Full test coverage + README coherence + L0 integration validation** `risk:low` `depends:[S08]`
  Close-out slice. Three gates before merge to master:
  
  **Gate 1 — Full test coverage:**
  Unit tests for every new module (content-fetcher, content-cache, assertion-engine, semantic-analyzer). Integration tests for audit-docs orchestrator (all 3 waves). Bats regression tests for CLI flags and frontmatter parsing. Vitest count updated in README + session-coverage.bats. All existing tests still pass (zero regressions).
  
  **Gate 2 — README/AGENTS.md/docs coherence:**
  Run `/readme-audit --fix`. Update skill count, MCP tool count, command count. New skill `/audit-docs` and `/validate-upstream` in skill tables. New MCP tools `audit-docs` and `validate-upstream` in MCP table. Update guides-hub with any new guides. Verify all doc cross-refs resolve. Verify hub doc counts.
  
  **Gate 3 — L0 integration validation:**
  Run `/audit-docs` on L0 — must produce 0 HIGH/MEDIUM findings (Wave 1+2). Run `/audit-docs --with-upstream` on L0 — assertions pass against live upstream. Run `/audit-docs --layer L1 --project-root <L1>` — multi-layer works. Run `/full-audit --profile quick` — doc checks correctly delegated. Run full vitest suite — 0 failures. Run full bats suite — 0 failures. Run pattern-lint on L0 — 8/8 clean.
  
  **Git Flow:** squash merge `release/v1.3.0` → master, tag `v1.3.0`, back-merge to develop, cleanup release branch.
