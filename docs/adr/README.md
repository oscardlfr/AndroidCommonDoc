---
scope: [agents, workflow, runtime-adapter, multi-agent]
sources: [androidcommondoc, bl-w48-team-model-rootfix]
targets: [all]
slug: adr-index
category: adr
description: "Architecture Decision Records (ADR) index and authoring conventions"
---

# Architecture Decision Records (ADRs)

This directory records significant, hard-to-reverse architecture decisions for the L0 toolkit. Each ADR captures the context, the decision, and the consequences so future contributors understand *why* — not just *what*.

## Format

One file per decision: `ADR-NNN-<kebab-title>.md`. Each has a **Status** (Proposed / Accepted / Superseded), a **Context**, the **Decision**, and an **Enforced by** pointer to the guard(s) that keep the decision from silently eroding.

## Index

| ADR | Title | Status | Enforced by |
|-----|-------|--------|-------------|
| [ADR-001](ADR-001-runtime-adapter-contract.md) | Runtime Adapter Contract — engine-agnostic multi-agent as an optional accelerator over a disk-artifact floor | Accepted | `scripts/tests/capability-preservation.bats` (C1–C7) + `scripts/tests/named-team-regression-guard.bats` |

## Adding an ADR

1. Copy the structure of ADR-001. Use the next free number.
2. State the decision and its consequences; link the guard test(s) that enforce it.
3. Add a row to the Index above.
4. When a decision is replaced, mark the old ADR **Superseded by ADR-NNN** rather than deleting it.
