# Decisions

<!-- Append-only register of architectural and pattern decisions -->

## D001 — Multi-platform rule enforcement: schema-first, emit-per-platform

**Scope:** architecture  
**Date:** 2026-03-21  
**Context:** M003 chain layer model / pre-iOS planning  
**Revisable:** Yes — when iOS enters production and SwiftLint custom_rules prove insufficient for complex RuleTypes (required-rethrow, banned-supertype), may need a swift-validator CLI alongside SwiftLint.

### Decision

Extend the existing frontmatter rule spec with an optional `platforms` map per rule. The generation pipeline adds emitters per platform (`kotlin-emitter.ts` exists today, `swift-emitter.ts` future). The `RuleType` taxonomy remains platform-agnostic — it describes intent, not tooling. No Swift implementation until iOS enters production. All schema changes are additive (optional fields only).

### Choice

```yaml
# In pattern doc frontmatter — extended rule spec:
rules:
  - id: sealed-ui-state
    type: prefer-construct
    message: "UiState must be sealed interface"
    platforms:
      kotlin:
        tool: detekt
        source_rule: SealedUiStateRule.kt
        hand_written: true
      swift:                          # future — not implemented yet
        tool: swiftlint
        strategy: custom_rule         # or: validator_cli, manual
        equivalent: "enum with associated values"
    detect:
      class_suffix: UiState
      must_be: sealed
```

Generation pipeline evolution:
```
frontmatter rules:
  ├── kotlin-emitter.ts   → Detekt .kt rule     (exists)
  ├── test-emitter.ts     → Detekt test .kt      (exists)
  ├── config-emitter.ts   → detekt YAML config   (exists)
  ├── swift-emitter.ts    → SwiftLint .yml rule   (future)
  └── swift-config.ts     → .swiftlint.yml merge  (future)
```

### Rationale

1. **Pipeline already exists.** `mcp-server/src/generation/` has `rule-parser → kotlin-emitter → test-emitter → writer`. Extending to Swift = one new emitter file, not a rewrite.

2. **RuleType is already platform-agnostic.** The 8 types (`banned-import`, `prefer-construct`, `banned-usage`, `required-call-arg`, `banned-supertype`, `naming-convention`, `banned-annotation`, `required-rethrow`) describe intent. ~70% map directly to SwiftLint `custom_rules` regex. The rest need a thin CLI validator.

3. **Platform scoping already exists.** `targets: [android, desktop, ios, jvm]` in frontmatter already marks which rules apply to iOS. Adding `platforms` per rule is the granular version.

4. **Backward-compatible.** `platforms` is optional. Existing rules without it continue working — `kotlin-emitter` checks `hand_written`/`source_rule` as before. When `platforms.kotlin` is present, it takes precedence.

5. **No dead code.** Premature Swift implementation = untested, unmaintained code. Schema-first means the spec is ready when iOS arrives, and the pipeline needs only one new file.

### RuleType → Swift Tooling Mapping

| RuleType | Detekt (today) | SwiftLint equivalent | Feasibility |
|----------|---------------|---------------------|-------------|
| `banned-import` | visitImportDirective | `custom_rules` regex on imports | ✅ Direct |
| `banned-usage` | visitCallExpression | `custom_rules` regex on usage | ✅ Direct |
| `banned-annotation` | visitAnnotationEntry | `custom_rules` regex on `@` | ✅ Direct |
| `naming-convention` | visitClass/Function | `type_name`, `identifier_name` | ✅ Direct |
| `prefer-construct` | visitClass | `custom_rules` + `identifier_name` | ⚠️ Partial |
| `required-call-arg` | visitCallExpression | Partial with regex | ⚠️ Partial |
| `required-rethrow` | visitCatchSection | No direct — needs CLI validator | ❌ CLI needed |
| `banned-supertype` | visitClass | No direct — SwiftLint can't inspect inheritance | ❌ CLI needed |

### What NOT to do

- **Don't rename the repo.** "cross-platform architecture rule authority" is over-engineering of brand. AndroidCommonDoc with multi-target support is sufficient.
- **Don't implement Konsist for "portable" rules.** Konsist is Kotlin-specific (KoScope). It gives cross-module architecture enforcement in Kotlin — that's orthogonal to Swift portability.
- **Don't create a separate "rules-spec/" directory.** The frontmatter IS the spec. Duplicating it creates drift.
- **Don't port Detekt rule classes to SwiftLint.** Port the intention via the type system, not the implementation.

---

## D002 — Knowledge cascade in multi-layer sync

**Scope:** architecture  
**Date:** 2026-03-21  
**Context:** M003 chain layer model — knowledge, agents, skills sync across L0→L1→L2  
**Revisable:** Yes — implementation details may change during M003 execution.

### Decision

Each artifact type gets a sync strategy matching its semantics:

| Artifact | Strategy | Conflict resolution |
|----------|----------|-------------------|
| Knowledge | Append cascade (tagged `[L0]`/`[L1]`/`[L2]`) | Additive — never conflicts |
| Agents | Reference + optional `.override.md` merge | Local override extends base, doesn't replace |
| Skills | Reference + version pin in manifest | Local wins (classloader model) |
| Commands | Same as skills | Local wins |
| Detekt config | `--config base.yml,override.yml` (last wins) | Already works — no change needed |

Resolution model is **classloader chain**: L2 local → L1 source → L0 source. First match wins for skills/commands. Merge for agents/knowledge.

### Classloader chain — resolution order

```
Resolving "test-specialist" agent in L2:
  L2 local?  → ./agents/test-specialist.md        → if exists, use this
  L1 source? → shared-kmp-libs/agents/test-sp...   → if exists, use this
  L0 source? → AndroidCommonDoc/agents/test-sp...  → fallback base

Override without fork:
  L2: test-specialist.override.md (only differences)
  Merge: L0 base + L2 override → resolved agent
```

### Open questions — resolved

**Q1: Reference at runtime or materialization at sync?**

Materialization via `sync-l0 --resolve`, but manifest stores references. This gives:
- Local file for offline use (materialized copy)
- Reference for freshness check (`sync-l0 --resolve` re-resolves from sources)
- `sync-l0` without `--resolve` behaves as today (copy)

**Q2: Partial override or full replace?**

- **Partial merge** for agents and knowledge (text artifacts — merge = concatenate sections with layer tags)
- **Full replace** for skills and commands (atomic units — local copy wins completely)

This matches semantics: knowledge is additive, agents need project context injected, but a skill is a self-contained instruction set.

**Q3: Manifest v3 or v2 extension?**

v2 extension — no breaking change. Fields added:
- `artifacts.agents[name].override` → `"local"` indicates `.override.md` merge
- `artifacts.skills[name].source` → `"l0"` | `"l1"` | `"local"`
- `artifacts.knowledge.cascade` → `true` enables KNOWLEDGE-RESOLVED.md generation

v1→v2 migration already exists. v2 extensions are optional fields — existing manifests unchanged.

### Knowledge cascade detail

```
sync-l0 --resolve generates:

  .resolved/KNOWLEDGE-RESOLVED.md =
    ## [L0] AndroidCommonDoc
    (contents of L0/KNOWLEDGE.md)

    ## [L1] shared-kmp-libs
    (contents of L1/KNOWLEDGE.md)

    ## [L2] DawSync
    (contents of L2/KNOWLEDGE.md)
```

Agents receive KNOWLEDGE-RESOLVED.md instead of local KNOWLEDGE.md. The resolved file is regenerated on each `sync-l0 --resolve` and gitignored (derived artifact).

### Agent template + inject

```yaml
# L0 base agent: test-specialist.md
---
base: true
inject: [KNOWLEDGE, DETEKT_CONFIG]
---
You are a test specialist...
{{LAYER_KNOWLEDGE}}
{{LAYER_CONVENTIONS}}
```

```yaml
# L1 override: test-specialist.override.md
---
extends: l0:test-specialist
---
## Additional rules for shared-kmp-libs
- Always use testDispatcher from StandardTestDispatcher
- Fakes live in :core:test-fakes module
```

Engine merge: base template + resolved knowledge + layer override → final agent prompt.

### Rationale

`sync-l0` today is a file copier — it creates stale copies that diverge. The classloader model gives:
1. Fresh resolution (always reads from source)
2. Override without fork (`.override.md` extends, doesn't replace)
3. No drift (manifest tracks references, not copies)
4. Offline fallback (materialized copies via `sync-l0 --resolve`)
