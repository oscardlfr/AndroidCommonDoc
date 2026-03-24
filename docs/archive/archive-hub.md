---
scope: [archive, reference]
sources: [androidcommondoc]
targets: [android, desktop, ios, jvm]
slug: archive-hub
status: active
layer: L0
category: archive
description: "Archive category hub: DI SDK architecture research and enterprise deployment proposals"
version: 2
last_updated: "2026-03"
---

# Archive

DI architecture research and enterprise deployment proposals. These are reference documents — analysis of trade-offs, not prescriptive patterns.

## DI SDK Architecture

| Document | Description |
|----------|-------------|
| [dagger2-sdk-selective-init](dagger2-sdk-selective-init.md) | Dagger 2: 3 approaches for modular SDK init (monolithic, per-feature, ServiceLoader) |
| [di-sdk-selective-init-comparison](di-sdk-selective-init-comparison.md) | Framework comparison: 5 approaches × 10 requirements with decision matrix |
| [di-sdk-consumer-isolation](di-sdk-consumer-isolation.md) | DI concepts: isolation levels, DI vs Service Locator, singleton survival |
| [di-cross-feature-deps](di-cross-feature-deps.md) | Cross-feature dependencies: how each approach resolves Feature A needing Feature B |
| [di-hybrid-koin-sdk-dagger-app](di-hybrid-koin-sdk-dagger-app.md) | Hybrid: Koin SDK consumed by Dagger/Hilt apps via bridge module |

## Enterprise

| Document | Description |
|----------|-------------|
| [enterprise-integration-proposal](enterprise-integration-proposal.md) | Enterprise deployment proposal — 8 adoptable modules (English) |
| [propuesta-integracion-enterprise](propuesta-integracion-enterprise.md) | Enterprise deployment proposal (Spanish) |
