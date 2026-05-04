---
scope: [agents]
sources: [androidcommondoc]
targets: [all]
slug: test-specialist-coverage-targets
category: agents
description: "Test coverage targets table (instruction/branch/line minimums per layer). Extracted from test-specialist template body for L1/L2 propagation."
---

# test-specialist-coverage-targets — Coverage Targets (minimum)

| Layer | Target | E2E Required |
|-------|--------|-------------|
| Model layer | 100% | YES |
| Domain layer | 100% | YES |
| Data layer | 99%+ | YES |
| Database layer | 99%+ | YES |
| Design system | 95% | No |
| Feature/UI modules | 95%+ | Compose tests required |
