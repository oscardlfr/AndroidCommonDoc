# M011 Roadmap — Upstream Content Validation Engine

## Slices

- [ ] **S01: Content fetcher + disk cache** `risk:low` `depends:[]`
  Content fetching module with Jina Reader integration, disk cache with TTL, rate limiting. Foundation for all subsequent slices.

- [ ] **S02: Assertion engine (Layer 1)** `risk:medium` `depends:[S01]`
  Deterministic assertion engine — parses `validate_upstream` frontmatter, runs assertions against cached content. Types: `api_present`, `api_absent`, `keyword_absent`, `keyword_present`, `pattern_match`, `deprecation_scan`. Pure grep/regex, no LLM.

- [ ] **S03: Upstream validator orchestrator + MCP tool** `risk:medium` `depends:[S02]`
  Orchestrator combining content fetch → assertion execution → finding generation. MCP tool `validate-upstream` with `projectRoot`, `layer`, `tier`, `slug` params. CLI entrypoint. Integration with existing `MonitoringFinding` and review state.

- [ ] **S04: Frontmatter authoring + L0 seed assertions** `risk:low` `depends:[S02]`
  Write `validate_upstream` assertions for L0 pattern docs. Priority: ViewModel (stateIn, WhileSubscribed, SharedFlow vs Channel), Compose (resources API, navigation), Coroutines (structured concurrency), KMP (source sets, expect/actual). At least 30 assertions across 10 key docs.

- [ ] **S05: Semantic analyzer (Layer 2 — LLM)** `risk:high` `depends:[S03]`
  Optional LLM layer. When Layer 1 detects content change, fetches diff and asks LLM to compare our pattern doc vs upstream. Structured output: deprecated APIs, changed recommendations, new APIs we should document. Cost-controlled — only fires on detected changes.

- [ ] **S06: CI integration + skill** `risk:low` `depends:[S03]`
  CI workflow `upstream-validate.yml` (weekly cron, manual dispatch). Agent skill `/validate-upstream`. Integration with existing `doc-monitor.yml`. Findings feed into `/full-audit` via findings protocol.
