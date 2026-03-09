---
scope: [capability-detection, agent-patterns, mcp]
sources: [mcp-sdk, anthropic-claude-docs]
targets: [claude-agents, mcp-server]
version: 1
last_updated: "2026-03"
description: "Pattern for declaring and checking optional tool capabilities in agents and MCP servers"
slug: capability-detection
status: active
layer: L0
category: guides
assumes_read: guides-hub
token_budget: 520
monitor_urls:
  - url: "https://docs.anthropic.com/en/docs/claude-code/overview"
    type: doc-page
    tier: 3
---

# Capability Detection Pattern

Agents declare what optional tools they *can use* (not what they require). Callers skip gracefully when a tool is absent. This avoids hard failures when Context7, Jina, or other optional integrations are unavailable.

---

## Overview

Three-layer model:
1. **Declare** — frontmatter lists `optional_capabilities` in each agent
2. **Detect** — agent checks tool availability at runtime before use
3. **Degrade gracefully** — always has a fallback that works without the optional tool

---

## Frontmatter Convention

```yaml
optional_capabilities:
  - context7          # resolve_library + get_library_docs
  - jina              # fetch_page with Jina Reader
  - mcp-monitor       # monitor-sources MCP tool
```

Values are lowercase slugs. The registry scanner reads these and exposes them via the `optional_capabilities` field on `PatternMetadata`.

---

## Agent Runtime Pattern

```markdown
## Optional Capabilities

If `resolve_library` is available (Context7):
  → use `resolve_library` + `get_library_docs` for API signatures
  Otherwise: rely on training knowledge + doc frontmatter version fields

If `fetch_page` is available (Jina):
  → fetch upstream URLs from `monitor_urls` frontmatter for freshness checks
  Otherwise: report monitor_urls as unverified, flag for human review
```

---

## Capability Slugs (canonical list)

| Slug | Tools | Purpose |
|------|-------|---------|
| `context7` | `resolve_library`, `get_library_docs` | Live library documentation |
| `jina` | `fetch_page` | Web page content extraction |
| `mcp-monitor` | `monitor-sources` MCP tool | Upstream version checks |
| `mcp-gsd` | `gsd://` MCP resources | Live project state access |
| `bash` | `Bash` | Shell command execution |

---

## References

- [l0-coherence-auditor](../.claude/agents/l0-coherence-auditor.md) — uses `optional_capabilities: [mcp-gsd]`
- [MCP Resources](../mcp-server/src/resources/gsd.ts) — implements `gsd://` scheme
