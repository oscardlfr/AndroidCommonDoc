---
title: "Getting Started — Full L0 / L1 / L2 Setup"
slug: getting-started
category: guides
description: >
  Index for the complete configuration guide. Goes from zero to a working
  AndroidCommonDoc setup across L0, L1, and L2 projects in 15 minutes.
  Each sub-document is available in English and Castellano.
last_updated: "2026-03-18"
---

# Getting Started — L0 / L1 / L2

**Estimated time: 15 minutes** for a new project.
Each linked document contains both **English** and **Castellano** sections.

## System architecture

```
AndroidCommonDoc (L0) — single source of truth
│   skills/ · detekt-rules/ · mcp-server/ · docs/
│
├── shared-libs/ (L1)  — shared versions, Detekt overrides
│   └── l0-manifest.json
│
└── my-app/ (L2)       — Android / KMP application
    └── l0-manifest.json
```

## Sub-documents

- [Step 1 — Install L0](getting-started/01-install-l0.md)
- [Step 2 — Connect a downstream project](getting-started/02-connect-project.md)
- [Step 3 — l0-manifest.json](getting-started/03-manifest.md)
- [Step 4 — Sync skills](getting-started/04-sync-skills.md)
- [Step 5 — Configure Detekt per layer](getting-started/05-detekt-layers.md)
- [Step 6 — MCP server](getting-started/06-mcp-server.md)
- [Step 7 — CI reusable workflows](getting-started/07-ci-workflows.md)
- [Step 8 — Verify and troubleshoot](getting-started/08-verify.md)

## Related docs

- [Detekt config hierarchy](detekt-config.md)
- [AI agent consumption guide](../agents/agent-consumption-guide.md)
- [Claude Code workflow](../agents/claude-code-workflow.md)
- [CLAUDE.md template](../agents/claude-md-template.md)
