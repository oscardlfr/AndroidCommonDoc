---
scope: [guides, workflows, templates, agent-consumption]
sources: [androidcommondoc]
targets: [android, desktop, ios, jvm]
slug: guides-hub
status: active
layer: L0
category: guides
description: "Guides category hub: AI agent consumption, Claude Code workflow, CLAUDE.md template, doc authoring"
version: 1
last_updated: "2026-03"
monitor_urls:
  - url: "https://docs.anthropic.com/en/docs/claude-code/overview"
    type: doc-page
    tier: 3
---

# Guides

How-to guides for AI agent consumption, Claude Code workflow, and documentation authoring.

> Start here when onboarding to AndroidCommonDoc or setting up Claude Code for a new project.

## Documents

| Document | Description |
|----------|-------------|
| [agent-consumption-guide](agent-consumption-guide.md) | How AI agents should load and use pattern docs |
| [autonomous-workflow](autonomous-workflow.md) | **Autonomous AI workflow**: Git Flow, auto-merge PRs, multi-agent branches, CI validation |
| [claude-code-workflow](claude-code-workflow.md) | Claude Code setup, hooks, and workflow patterns |
| [claude-md-template](claude-md-template.md) | Standard CLAUDE.md template for L0/L1/L2 projects |
| [capability-detection](capability-detection.md) | Pattern for declaring optional tool capabilities in agents |
| [doc-template](doc-template.md) | Standard doc template with frontmatter and section structure |
| [detekt-config](detekt-config.md) | Detekt L0/L1 config hierarchy, rule catalog, and how to add rules |
| [detekt-migration-v2](detekt-migration-v2.md) | Migrating from Detekt 1.x to 2.0: plugin renames, property renames, config.validation, KMP baselines |
| [baseline-reduction](baseline-reduction.md) | Playbook for progressively eliminating Detekt baseline suppressions (EN + ES) |
| [getting-started](getting-started.md) | **Full L0/L1/L2 setup from scratch** — manifest, Detekt, MCP, CI (EN + ES) |

## Key Rules

- Load the minimal doc set for the task — use `assumes_read` to avoid loading hubs twice
- CLAUDE.md ≤150 lines; delegate to pattern docs with `@import` directives
- Hub docs ≤100 lines; sub-docs ≤300 lines
