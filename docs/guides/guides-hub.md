---
scope: [guides, templates, detekt, getting-started]
sources: [androidcommondoc]
targets: [android, desktop, ios, jvm]
slug: guides-hub
status: active
layer: L0
category: guides
description: "Guides hub: getting started, Detekt configuration, doc authoring templates"
version: 2
last_updated: "2026-03"
---

# Guides

Setup, configuration, and authoring guides for the L0/L1/L2 ecosystem.

> For agent workflow docs (CLAUDE.md template, dev-lead model, multi-agent patterns), see [agents-hub](../agents/agents-hub.md).

## Documents

| Document | Description |
|----------|-------------|
| [getting-started](getting-started.md) | **Full L0/L1/L2 setup from scratch** — manifest, Detekt, MCP, CI (EN + ES) |
| [detekt-config](detekt-config.md) | Detekt L0/L1 config hierarchy, rule catalog, and how to add rules |
| [detekt-migration-v2](detekt-migration-v2.md) | Migrating from Detekt 1.x to 2.0: plugin renames, config.validation, KMP baselines |
| [baseline-reduction](baseline-reduction.md) | Playbook for progressively eliminating Detekt baseline suppressions (EN + ES) |
| [convention-plugin-chain](convention-plugin-chain.md) | Detekt config chain: L0 base → L1 override → L2 local via `config.setFrom()` |
| [doc-template](doc-template.md) | Standard doc template with frontmatter and section structure |

## Key Rules

- Hub docs ≤100 lines; sub-docs ≤300 lines
- All docs need YAML frontmatter (scope, sources, targets, slug, status)
- Use `assumes_read` to avoid loading hubs twice
