# M003 — Chain Layer Model: L0 → L1 → L2 Knowledge Cascade

## Problem Statement

AndroidCommonDoc uses a flat distribution model: L0 syncs directly to L1 and L2. Both consume L0 independently. L1 cannot define rules, patterns, or conventions that L2 inherits.

This means an AI agent working on L2 (DawSync) has no access to L1 (shared-kmp-libs) conventions — only L0 generic patterns and L2 app-specific context. The middle layer's knowledge is invisible.

## Goal

Enable a **chain model** where knowledge cascades: L0 → L1 → L2. Each layer can:

1. **Inherit** everything from its parent layer
2. **Add** layer-specific rules, patterns, docs, skills, agents
3. **Override** parent rules (disable, change severity, customize)

Enterprise projects can opt for **flat** (L0 → each project directly) when there's no shared-libs layer.

## Scope — What Cascades

| Resource | How It Cascades | Resolution |
|---|---|---|
| **Detekt rules** | `config.setFrom(l0Base, l1Override, l2Override)` — last wins per key | Gradle convention plugin |
| **Pattern docs** | L2 agent reads L0 + L1 + L2 docs directories | CLAUDE.md / AGENTS.md cross-references |
| **Skills** | L2 manifest lists L0 + L1 as sources; sync resolves both | Manifest schema + sync engine |
| **Agents** | L2 can invoke L0 agents + L1 agents | GSD agent dirs + l0-manifest sources |
| **CLAUDE.md context** | L2 CLAUDE.md imports L0 + L1 conventions sections | Convention in CLAUDE.md template |
| **Versions** | L1 is authority for its deps; L0 for tooling versions | versions-manifest.json per layer |
| **Decisions** | Agent reads L0 DECISIONS + L1 DECISIONS + L2 DECISIONS | GSD reads from all layers |
| **KNOWLEDGE.md** | Agent reads L0 + L1 + L2 knowledge bases | Explicit cross-layer imports |

## Design Decisions (Pending)

### D1: Manifest Schema — `sources` Array

Current: `l0_source: "../AndroidCommonDoc"` (single source)

Proposed:
```json
{
  "version": 2,
  "sources": [
    { "layer": "L0", "path": "../../AndroidCommonDoc", "role": "tooling" },
    { "layer": "L1", "path": "../../shared-kmp-libs", "role": "ecosystem" }
  ],
  "topology": "chain",
  "selection": { "..." : "..." }
}
```

`topology: "chain"` means L2 inherits L1's rules + L0's rules.
`topology: "flat"` means L2 only sees L0.

### D2: Detekt Config Chain

The convention plugin resolves configs in order:
```kotlin
val configFiles = mutableListOf<File>()
for (source in manifest.sources.sortedBy { it.layer }) {
    val base = resolveLayerConfig(source)
    if (base.exists()) configFiles.add(base)
}
val l2Override = file("detekt.yml")
if (l2Override.exists()) configFiles.add(l2Override)
config.setFrom(configFiles)
```

### D3: Skill/Agent Sync — Multi-Source

The sync engine resolves entries from ALL sources:
```
L0 registry: 82 entries
L1 registry: 12 entries (shared-libs specific)
Merged: 94 entries (L1 overrides L0 by name if collision)
```

### D4: Agent Context Chain

When an agent starts in L2, its context includes:
1. L0 AGENTS.md → universal conventions
2. L1 AGENTS.md → shared-libs conventions
3. L2 AGENTS.md → app-specific conventions

### D5: Wizard Choice

`/setup` Step 0:
```
Layer topology:
  [1] chain  — This project inherits from a parent layer (L1 or L0)
  [2] flat   — This project consumes L0 directly (enterprise / standalone)
```

## Implementation Plan

1. **Manifest schema v2**: `sources[]` array, `topology` field, backward-compatible with v1
2. **Sync engine**: multi-source resolution, per-source checksums
3. **Convention plugin**: chain config loading from N layers
4. **CLAUDE.md template**: cross-layer imports section
5. **Setup wizard**: topology choice, parent layer resolution
6. **Tests**: schema migration v1→v2, multi-source sync, chain config ordering
7. **Docs**: architecture guide for the chain model

## Constraints

- Backward-compatible: v1 manifests work (treated as flat)
- Enterprise flat mode requires no parent beyond L0
- Chain depth max 3 (L0 → L1 → L2) — no arbitrary nesting
- Each layer works standalone if parents are offline (cached copies)

## Documentation Cascade

The doc system already has per-layer conventions (enforced by `l0-coherence-auditor` and `doc-structure.test.ts`), but they're implicit in code. The chain model makes them explicit and cascading.

### Current doc standard per layer

| Aspect | L0 | L1 | L2 |
|---|---|---|---|
| **Frontmatter** | 10 fields required | 10/10 completeness | category-only minimum |
| **Hub docs** | ≤100 lines, one per subdir | ≤100 lines | Optional |
| **Sub-docs** | ≤300 lines (500 max) | ≤500 lines | ≤500 lines |
| **monitor_urls** | Required for upstream tracking | Optional | Not expected |
| **l0_refs** | Within L0 | To L0 slugs (validated) | To L0 slugs |
| **category** | 9 approved categories | Same vocab | Same vocab |
| **Validated by** | `l0-coherence-auditor` + `doc-structure.test.ts` | `doc-structure.test.ts` L1 section | `doc-structure.test.ts` L2 section |

### What chain adds for docs

1. **L2 agent discovers L1 docs**: DawSync agent finds shared-kmp-libs patterns, not just L0 generic ones
2. **l1_refs**: L2 docs reference L1 slugs — validated cross-layer
3. **find-pattern searches all layers**: L0 + L1 + L2, ranked by proximity (L2 > L1 > L0)
4. **Convention inheritance**: L1 inherits L0 doc standards, L2 inherits L1's
5. **Vault integration**: `sync-vault` already handles multi-project — chain formalizes discovery order

### Missing deliverables

- `docs/guides/doc-standards.md`: Explicit per-layer standards (currently only in test assertions)
- Manifest v2 `sources[]` used by `find-pattern` for multi-layer search
- `CLAUDE.md` template: "## Cross-Layer Documentation" section pointing to parent docs

## Open Questions

1. Should L1 have its own registry.json or reuse L0's format?
2. How does L1 declare "my rules" vs "L0 rules I'm passing through"?
3. ~~Should KNOWLEDGE.md be merged automatically or require explicit imports?~~ → **Resolved in D002**: cascade via `sync-l0 --resolve`, generates `KNOWLEDGE-RESOLVED.md` from all layers.
4. How do version conflicts resolve? (L0 says Kotlin 2.3.20, L1 says 2.3.10)
5. Should the doc standard per layer be a static doc or generated from test assertions?
6. ~~Should `find-pattern` auto-discover parent layer docs or require explicit manifest config?~~ → **Resolved in D002**: manifest `sources[]` is used; `find-pattern` reads ordered sources from manifest.

## Resolved Design Questions (from D002)

- **Runtime vs materialization**: Materialization via `sync-l0 --resolve`. Manifest stores references, resolved files are gitignored derived artifacts.
- **Partial vs full replace**: Partial merge for agents/knowledge (additive text), full replace for skills/commands (atomic units).
- **Schema version**: v2 extension (optional fields), no v3 breaking change.
