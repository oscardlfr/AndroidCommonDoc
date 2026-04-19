---
description: Show unified agent/tool/skill/MCP usage dashboard — combines runtime tool-use log with skill/audit runs
intent: observability
---

# /metrics — Unified Usage Dashboard

Produces a 3-section dashboard by invoking two MCP tools and merging their output.

## Steps

1. Invoke MCP tool `tool-use-analytics` with:
   - `project_root`: current project root (use `$CLAUDE_PROJECT_DIR` or the working directory)
   - `format`: `"markdown"`
   - `weeks_lookback`: 4
   - `top_n`: 10

2. Invoke MCP tool `skill-usage-analytics` with:
   - `project_root`: current project root
   - `format`: `"markdown"`
   - `weeks_lookback`: 4

3. Merge both outputs into ONE markdown dashboard with these three sections:

### Section 1 — Runtime Tool Usage
Output from `tool-use-analytics`: top tools table, MCP/Context7/our-MCP call counts, CP bypass count, dead tools list.

### Section 2 — Skill / Audit Runs
Output from `skill-usage-analytics`: skill run counts, findings frequencies, top checks.

### Section 3 — Cross-cutting Highlights
Compute and display:
- **CP bypass blocked**: count from `tool-use-analytics.cp_bypass_blocked` — if > 0, print `⚠ {N} CP bypass attempts blocked. Review tool-use-log.jsonl for agent names.`
- **Dead tools**: list from `tool-use-analytics.dead_tools` — if non-empty, print `⚠ Dead tools detected (0 calls in lookback window): {list}`
- **Context7 vs our-MCP ratio**: `context7_calls / (our_mcp_calls + context7_calls)` as a percentage
- **Top 5 most-used skills**: from `skill-usage-analytics` skills array, top 5 by run_count

## Log rotation note
If `tool-use-analytics` output warns about log size (> 10 MB), rotate before next session:
```bash
mv .androidcommondoc/tool-use-log.jsonl .androidcommondoc/tool-use-log-$(date +%Y%m%d).jsonl
```
