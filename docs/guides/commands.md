---
scope: l0
sources: CLAUDE.md
targets: l0
category: guides
slug: commands
status: active
layer: L0
description: "Full list of /pre-pr, /readme-audit, /full-audit and all other L0 slash commands (extracted from CLAUDE.md prep-6)"
---

# Commands

- `/pre-pr` — full pre-merge validation
- `/readme-audit` — doc audit (10 checks, hub table, counts, links)
- `/full-audit` — unified audit across all quality dimensions
- `/audit-docs` — doc-specific audit (structure + coherence + upstream)
- `/validate-patterns` — code vs pattern compliance
- `/sync-l0` — propagate skills/agents/commands to L1/L2
- `/generate-rules` — emit Detekt rules from doc frontmatter
- `/check-outdated` — check dependency versions against Maven Central (TOML parser, kdoc-state v2 cache)
- `/debug` — systematic bug investigation via debugger agent
- `/research` — ad-hoc technical research via researcher agent
- `/map-codebase` — structured codebase analysis via codebase-mapper agent
- `/verify` — goal-backward verification via verifier agent
- `/decide` — technical decision comparison via advisor agent
- `/note` — zero-friction idea capture to memory
- `/review-pr` — code review of a PR with structured suggestions
- `/benchmark` — run benchmark suites (JVM/Android)
- `/work` — smart task routing to agents/skills (extensible via frontmatter intent)
- `/init-session` — show project context and available tools
- `/resume-work` — CEO/CTO dashboard with department status from last session
- `/doc-integrity` — unified doc audit (kdoc-coverage → check-doc-patterns → API freshness → audit-docs)
- `/eval-agents` — run promptfoo evaluations against agent prompt templates before merging
- `/metrics` — unified dashboard: runtime tool usage, skill usage, MCP rates, CP bypass count
- Pre-commit hooks: see `docs/guides/pre-commit-hooks.md`
