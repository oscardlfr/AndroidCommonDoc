---
title: "Bounded MCP research mode"
slug: runtime-consumer-research-mode
scope: [guides, runtime, research, mcp]
sources: [androidcommondoc, anthropic-claude-code]
targets: [all]
status: active
layer: L0
parent: getting-started
category: guides
last_updated: "2026-09-28"
description: "Authenticated provider-MCP research without confusing it with safe-mode recovery."
---

# Bounded MCP research mode

`--safe-mode` disables installed plugins and every MCP server. Use it to recover
from broken customizations, never for a task that must consult Context7.

When startup customizations are healthy but a research turn needs only the
authenticated Context7 plugin, use a separate session. Claude Code `2.1.x`
restricted mode ignores user/project/local settings by default, so select the
user source explicitly to recover the installed plugin's configuration and
authentication:

```bash
claude --restricted --setting-sources user \
  --add-dir "$ANDROID_COMMON_DOC" \
  --allowedTools "mcp__plugin_context7_context7__resolve-library-id,mcp__plugin_context7_context7__query-docs" \
  --disallowedTools "Bash,PowerShell,Edit,Write,NotebookEdit,WebFetch,WebSearch" \
  --permission-mode manual
```

This is a research profile, not the runtime launcher, safe-mode recovery, or a
persistent collaboration session. `--allowedTools` preauthorizes names; it does
not by itself hide every other tool. `--restricted` removes built-in code
execution and confines native file tools, while the explicit deny list records
the expected negative surface.

Inspect `system/init` and stop if either required Context7 tool is absent or an
unrequested execution, write, or general-network tool is present. Never replace
the authenticated plugin with an unauthenticated endpoint merely to suppress a
permission prompt. If the installed host cannot restore the plugin through the
explicit user setting source, use a normal supervised session or provision a
reviewed `--mcp-config`; safe mode cannot be the fallback for MCP research.

The provider response is evidence for the research result, not proof of
filesystem isolation or runtime readiness. Preserve the queried library ID,
question, provider result, and host tool surface in the task evidence.
