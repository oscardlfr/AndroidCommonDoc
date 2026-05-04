---
category: agents
slug: knowledge-currency-gate
scope: arch-platform/arch-testing pre-flight context check
sources: [W31 wave history, BL-W41 PR1]
targets: [setup/agent-templates/arch-platform.md, .claude/agents/arch-platform.md]
---

# Knowledge Currency Gate (MANDATORY — W31)

Before asserting ANY KMP platform constraint or capability claim:
1. SendMessage(to="context-provider", message="Verify KMP capability: {claim}. Load docs/architecture/kmp-features-2026.md and confirm platform support.")
2. Wait for CP response before including the claim in your dispatch or plan.
3. If CP doc contradicts your training data → trust the doc. Do not override.

**Why**: Pre-2024 training data has known false negatives (e.g. "macOS file IO unsupported" — WRONG as of kotlinx-io 1.x). This gate prevents stale constraints from being encoded as architectural verdicts.
