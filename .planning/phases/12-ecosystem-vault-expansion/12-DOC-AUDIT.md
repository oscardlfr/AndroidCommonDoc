# Phase 12: Documentation Layer Audit Report

**Audited:** 2026-03-14
**Purpose:** Inventory documentation across AndroidCommonDoc, shared-kmp-libs, and DawSync to inform vault collector configuration (globs, excludes, layer assignments) and identify layer misplacements.

## 1. shared-kmp-libs (L1 Ecosystem Layer)

**Path:** `C:\Users\34645\AndroidStudioProjects\shared-kmp-libs`
**Layer Assignment:** L1 (ecosystem conventions consumed by all apps)

### File Inventory

| Path | Lines | Classification | Vault Type |
|------|-------|---------------|------------|
| `CLAUDE.md` | 57 | ai | reference |
| `README.md` | 316 | docs | docs |
| `coverage-full-report.md` | 1249 | generated | EXCLUDE |
| `docs/API_EXPOSURE_PATTERN.md` | 319 | docs | docs |
| `docs/CONVENTION_PLUGINS.md` | 500 | docs | docs |
| `docs/ERROR_HANDLING_PATTERN.md` | 340 | docs | docs |
| `docs/GRADLE_SETUP.md` | 646 | docs | docs |
| `docs/TESTING_STRATEGY.md` | 694 | docs | docs |
| `core-common/README.md` | 170 | docs | docs |
| `core-designsystem-foundation/README.md` | 233 | docs | docs |
| `core-domain/README.md` | 175 | docs | docs |
| `core-error/README.md` | 192 | docs | docs |
| `core-io-api/README.md` | 195 | docs | docs |
| `core-io-okio/README.md` | 141 | docs | docs |
| `core-json-api/README.md` | 96 | docs | docs |
| `core-json-kotlinx/README.md` | 126 | docs | docs |
| `core-logging/README.md` | 191 | docs | docs |
| `core-network-api/README.md` | 270 | docs | docs |
| `core-network-ktor/README.md` | 170 | docs | docs |
| `core-network-retrofit/README.md` | 168 | docs | docs |
| `core-result/README.md` | 164 | docs | docs |
| `core-storage-api/README.md` | 356 | docs | docs |

### Structural Notes

- **No AGENTS.md** at root
- **No `.androidcommondoc/` directory** (no L1 overrides of L0 patterns)
- **`.planning/` exists** but contains only `phases/12.6-kotlinx-io-migration-core-data-io-abstraction/12.6-03-SUMMARY.md` (1 file, leftover from a migration phase)
- **No `.planning/codebase/`** directory (no architecture docs)
- **`SBOM Best Practices KMP.docx`** in docs/ is a `.docx` file (not `.md`) -- exclude from collection
- **13 module READMEs** with substantial content (96-356 lines each, avg ~188 lines) -- individually meaningful, not boilerplate

### Recommended Collection Config

```json
{
  "name": "shared-kmp-libs",
  "path": "C:\\Users\\34645\\AndroidStudioProjects\\shared-kmp-libs",
  "layer": "L1",
  "collectGlobs": [
    "CLAUDE.md",
    "README.md",
    "docs/**/*.md",
    "*/README.md"
  ],
  "excludeGlobs": [
    "**/build/**",
    "**/.gradle/**",
    "**/node_modules/**",
    "coverage-*.md",
    "**/*.docx"
  ]
}
```

### Gaps

- No architecture docs (`.planning/codebase/` absent) -- shared-kmp-libs conventions are documented in `docs/` but there is no formal architecture/structure/concerns decomposition
- No AGENTS.md -- no AI instruction surface beyond CLAUDE.md

---

## 2. DawSync (L2 App Layer)

**Path:** `C:\Users\34645\AndroidStudioProjects\DawSync`
**Layer Assignment:** L2 (app-specific domain documentation)

### File Inventory -- Root

| Path | Lines | Classification | Vault Type |
|------|-------|---------------|------------|
| `CLAUDE.md` | 232 | ai | reference |
| `README.md` | 276 | docs | docs |
| `APPLE_SETUP.md` | 234 | docs | docs |
| `MARKETING_EN.md` | 196 | docs | docs |
| `MARKETING_ES.md` | 196 | docs | docs |
| `THIRD_PARTY_LICENSES.md` | 168 | docs | docs |
| `coverage-full-report.md` | 155486 | generated | EXCLUDE |
| `coverage-gap-report.md` | 8761 | generated | EXCLUDE |

### File Inventory -- docs/ (excluding archive/)

| Path | Lines | Classification | Vault Type |
|------|-------|---------------|------------|
| `docs/PRODUCT_SPEC.md` | 1664 | docs | docs |
| `docs/BUSINESS_STRATEGY.md` | 451 | docs | docs |
| `docs/FEATURE_INVENTORY.md` | 311 | docs | docs |
| `docs/RISKS_RULES.md` | 277 | docs | docs |
| `docs/SCALING_PLAN.md` | 83 | docs | docs |
| `docs/TECHNOLOGY_CHEATSHEET.md` | 450 | docs | docs |
| `docs/CLAUDE_CODE_WORKFLOW.md` | 441 | docs | docs |
| `docs/SBOM.md` | 111 | docs | docs |
| `docs/VIABILITY_AUDIT.md` | 390 | docs | docs |
| `docs/DAWSYNC_PARA_ARTISTAS.md` | 131 | docs | docs |
| `docs/guides/ACCESSIBILITY.md` | 115 | docs | docs |
| `docs/guides/CAPTURE_SYSTEM.md` | 336 | docs | docs |
| `docs/guides/KMP_RESOURCES.md` | 365 | docs | docs |
| `docs/guides/MEDIA_SESSION.md` | 299 | docs | docs |
| `docs/guides/NAVIGATION.md` | 645 | docs | docs |
| `docs/guides/TESTING.md` | 865 | docs | docs |

### File Inventory -- docs/architecture/

| Path | Lines | Classification | Vault Type |
|------|-------|---------------|------------|
| `docs/architecture/SYSTEM_ARCHITECTURE.md` | 432 | docs | docs |
| `docs/architecture/PATTERNS.md` | 331 | docs | docs |
| `docs/architecture/PRODUCER_CONSUMER.md` | 259 | docs | docs |
| `docs/architecture/diagrams/*.md` (62 files) | ~various | docs | docs |

### File Inventory -- docs/CODEX_AUDITY/

| Path | Lines | Classification | Vault Type |
|------|-------|---------------|------------|
| `docs/CODEX_AUDITY/01_business_roadmap_audit.md` | 80 | docs | docs |
| `docs/CODEX_AUDITY/02_security_compliance_audit.md` | 122 | docs | docs |
| `docs/CODEX_AUDITY/03_architecture_db_performance_audit.md` | 107 | docs | docs |
| `docs/CODEX_AUDITY/04_vst3_m4l_realtime_memory_audit.md` | 71 | docs | docs |
| `docs/CODEX_AUDITY/05_master_closure_plan.md` | 108 | docs | docs |

### File Inventory -- docs/references/

| Path | Lines | Classification | Vault Type |
|------|-------|---------------|------------|
| `docs/references/ABLETON_TEST_DATA.md` | 1616 | docs | docs |
| `docs/references/ANDROID_2026.md` | 653 | docs | docs |

### File Inventory -- docs/legal/ (11 files)

Legal documents (privacy policies, terms of service, cookie policies in EN/ES). All DawSync-specific. Consider excluding from vault as they are not developer documentation.

### File Inventory -- .planning/codebase/

| Path | Lines | Classification | Vault Type |
|------|-------|---------------|------------|
| `.planning/codebase/ARCHITECTURE.md` | 216 | architecture | architecture |
| `.planning/codebase/CONCERNS.md` | 323 | architecture | architecture |
| `.planning/codebase/CONVENTIONS.md` | 353 | architecture | architecture |
| `.planning/codebase/INTEGRATIONS.md` | 239 | architecture | architecture |
| `.planning/codebase/STACK.md` | 181 | architecture | architecture |
| `.planning/codebase/STRUCTURE.md` | 297 | architecture | architecture |
| `.planning/codebase/TESTING.md` | 575 | architecture | architecture |

### File Inventory -- .androidcommondoc/

| Path | Lines | Classification | Vault Type |
|------|-------|---------------|------------|
| `.androidcommondoc/docs/dawsync-domain-patterns.md` | 175 | L1 override | pattern |
| `.androidcommondoc/README.md` | 61 | meta | EXCLUDE |

### File Inventory -- docs/archive/ (33 files)

Stale/superseded documents. All should be excluded via `excludeGlobs`.

### Sub-Project: SessionRecorder-VST3

**Path:** `DawSync/SessionRecorder-VST3`
**Build System:** CMake (CMakeLists.txt) -- different from parent's Gradle
**Language:** C++ (JUCE framework)

| Path | Lines | Classification | Vault Type |
|------|-------|---------------|------------|
| `README.md` | 231 | docs | docs |
| `TESTING.md` | 184 | docs | docs |
| `CHANGELOG.md` | 46 | docs | docs |
| `EULA.md` | 254 | docs | docs |
| `MACOS_BUILD_INSTRUCTIONS.md` | 224 | docs | docs |
| `src/README.md` | 137 | docs | docs |
| `installer/macos/README.md` | - | docs | docs |
| `installer/windows/README.md` | - | docs | docs |

**Note:** `build-Release/` and `build-tests/` contain hundreds of .md files from fetched dependencies (JUCE, CLAP). These MUST be excluded -- they are third-party build artifacts.

### Sub-Project: DawSyncWeb (External)

**Path:** `C:\Users\34645\AndroidStudioProjects\DawSyncWeb` (sibling directory)
**Build System:** Node.js (package.json)
**Language:** TypeScript/JavaScript (web landing + marketing site)

| Path | Lines | Classification | Vault Type |
|------|-------|---------------|------------|
| `README.md` | 43 | docs | docs |
| `.agents/product-marketing-context.md` | 121 | ai | reference |
| `.claude/commands/deploy-web.md` | 90 | ai | reference |
| `.planning/PROJECT.md` | 106 | planning | planning |
| `.planning/REQUIREMENTS.md` | - | planning | planning |
| `.planning/ROADMAP.md` | - | planning | planning |
| `.planning/STATE.md` | - | planning | planning |
| `.planning/codebase/ARCHITECTURE.md` | 200 | architecture | architecture |
| `.planning/codebase/CONCERNS.md` | 156 | architecture | architecture |
| `.planning/codebase/CONVENTIONS.md` | 213 | architecture | architecture |
| `.planning/codebase/INTEGRATIONS.md` | 152 | architecture | architecture |
| `.planning/codebase/STACK.md` | 132 | architecture | architecture |
| `.planning/codebase/STRUCTURE.md` | 241 | architecture | architecture |
| `.planning/codebase/TESTING.md` | 199 | architecture | architecture |
| `.planning/research/*.md` (5 files) | 1427 | planning | planning |
| `docs/legal/*.md` (6 files) | - | legal | EXCLUDE |

### L0 Promotion Candidates

Review of DawSync docs for generic KMP/Compose patterns that belong in AndroidCommonDoc (L0):

| DawSync File | Assessment | Recommendation |
|--------------|-----------|----------------|
| `docs/guides/KMP_RESOURCES.md` | DawSync-specific references to "DawSync" resource patterns | **Keep L2** -- DawSync-specific, L0 already has `compose-resources-*.md` |
| `docs/guides/NAVIGATION.md` | References DawSync navigation patterns specifically | **Keep L2** -- L0 already has `viewmodel-navigation.md` |
| `docs/guides/TESTING.md` | DawSync-specific testing guide with DawSync modules | **Keep L2** -- L0 already has `testing-patterns*.md` |
| `docs/TECHNOLOGY_CHEATSHEET.md` | DawSync version matrix with DawSync-specific deps | **Keep L2** -- version-specific to DawSync |
| `docs/CLAUDE_CODE_WORKFLOW.md` | Documents DawSync's specific Claude Code workflow | **Keep L2** -- interesting but DawSync-specific |
| `docs/architecture/PATTERNS.md` | DawSync architecture patterns (producer/consumer) | **Keep L2** -- domain-specific patterns |

**Conclusion:** No new L0 promotion candidates identified. Phase 9 (09-06) already promoted error-handling to L0 and created the DawSync domain patterns L1 override. The remaining DawSync docs are genuinely domain-specific.

### Recommended Collection Config

```json
{
  "name": "DawSync",
  "path": "C:\\Users\\34645\\AndroidStudioProjects\\DawSync",
  "layer": "L2",
  "collectGlobs": [
    "CLAUDE.md",
    "README.md",
    "APPLE_SETUP.md",
    "MARKETING_EN.md",
    "THIRD_PARTY_LICENSES.md",
    "docs/**/*.md",
    ".planning/codebase/**/*.md"
  ],
  "excludeGlobs": [
    "**/build/**",
    "**/build-Release/**",
    "**/build-tests/**",
    "**/.gradle/**",
    "**/node_modules/**",
    "**/archive/**",
    "**/dist/**",
    "coverage-*.md",
    "docs/legal/**",
    "MARKETING_ES.md",
    "coverage-gap-report.md"
  ],
  "subProjects": [
    {
      "name": "SessionRecorder-VST3",
      "path": "SessionRecorder-VST3",
      "collectGlobs": [
        "README.md",
        "TESTING.md",
        "CHANGELOG.md",
        "MACOS_BUILD_INSTRUCTIONS.md",
        "src/README.md",
        "installer/*/README.md"
      ],
      "excludeGlobs": [
        "**/build-Release/**",
        "**/build-tests/**",
        "EULA.md"
      ]
    },
    {
      "name": "DawSyncWeb",
      "path": "C:\\Users\\34645\\AndroidStudioProjects\\DawSyncWeb",
      "collectGlobs": [
        "README.md",
        ".agents/**/*.md",
        ".claude/commands/**/*.md",
        ".planning/PROJECT.md",
        ".planning/codebase/**/*.md"
      ],
      "excludeGlobs": [
        "**/node_modules/**",
        "**/dist/**",
        "docs/legal/**",
        ".planning/research/**"
      ]
    }
  ],
  "features": {
    "subProjectScanDepth": 1
  }
}
```

---

## 3. AndroidCommonDoc (L0 Generic Layer)

**Path:** `C:\Users\34645\AndroidStudioProjects\AndroidCommonDoc` (current repo)
**Layer Assignment:** L0 (generic cross-project patterns and toolkit)

### File Inventory -- Root

| Path | Lines | Classification | Vault Type |
|------|-------|---------------|------------|
| `AGENTS.md` | 154 | ai | reference |
| `README.md` | 497 | docs | docs |
| `CHANGELOG.md` | 101 | docs | docs |
| `SKILLS-README.md` | 227 | docs | docs |

### File Inventory -- docs/ (23 pattern documents)

| Path | Lines | Classification | Vault Type |
|------|-------|---------------|------------|
| `docs/compose-resources-configuration.md` | 276 | pattern | pattern |
| `docs/compose-resources-patterns.md` | 95 | pattern | pattern |
| `docs/compose-resources-troubleshooting.md` | 204 | pattern | pattern |
| `docs/compose-resources-usage.md` | 208 | pattern | pattern |
| `docs/enterprise-integration-proposal.md` | 337 | pattern | pattern |
| `docs/error-handling-patterns.md` | 441 | pattern | pattern |
| `docs/gradle-patterns.md` | 398 | pattern | pattern |
| `docs/kmp-architecture.md` | 341 | pattern | pattern |
| `docs/offline-first-architecture.md` | 330 | pattern | pattern |
| `docs/offline-first-caching.md` | 170 | pattern | pattern |
| `docs/offline-first-patterns.md` | 94 | pattern | pattern |
| `docs/offline-first-sync.md` | 286 | pattern | pattern |
| `docs/propuesta-integracion-enterprise.md` | 341 | pattern | pattern |
| `docs/resource-management-patterns.md` | 462 | pattern | pattern |
| `docs/testing-patterns.md` | 105 | pattern | pattern |
| `docs/testing-patterns-coroutines.md` | 497 | pattern | pattern |
| `docs/testing-patterns-coverage.md` | 127 | pattern | pattern |
| `docs/testing-patterns-fakes.md` | 145 | pattern | pattern |
| `docs/ui-screen-patterns.md` | 651 | pattern | pattern |
| `docs/viewmodel-events.md` | 166 | pattern | pattern |
| `docs/viewmodel-navigation.md` | 89 | pattern | pattern |
| `docs/viewmodel-state-management.md` | 273 | pattern | pattern |
| `docs/viewmodel-state-patterns.md` | 162 | pattern | pattern |

### File Inventory -- skills/ (20 skill definitions)

| Path | Classification | Vault Type |
|------|---------------|------------|
| `skills/android-test/SKILL.md` | skill | skill |
| `skills/auto-cover/SKILL.md` | skill | skill |
| `skills/coverage/SKILL.md` | skill | skill |
| `skills/coverage-full/SKILL.md` | skill | skill |
| `skills/extract-errors/SKILL.md` | skill | skill |
| `skills/generate-rules/SKILL.md` | skill | skill |
| `skills/ingest-content/SKILL.md` | skill | skill |
| `skills/monitor-docs/SKILL.md` | skill | skill |
| `skills/run/SKILL.md` | skill | skill |
| `skills/sbom/SKILL.md` | skill | skill |
| `skills/sbom-analyze/SKILL.md` | skill | skill |
| `skills/sbom-scan/SKILL.md` | skill | skill |
| `skills/sync-vault/SKILL.md` | skill | skill |
| `skills/sync-versions/SKILL.md` | skill | skill |
| `skills/test/SKILL.md` | skill | skill |
| `skills/test-changed/SKILL.md` | skill | skill |
| `skills/test-full/SKILL.md` | skill | skill |
| `skills/test-full-parallel/SKILL.md` | skill | skill |
| `skills/validate-patterns/SKILL.md` | skill | skill |
| `skills/verify-kmp/SKILL.md` | skill | skill |

### File Inventory -- .planning/

| Path | Lines | Classification | Vault Type |
|------|-------|---------------|------------|
| `.planning/PROJECT.md` | 107 | planning | planning |
| `.planning/REQUIREMENTS.md` | 185 | planning | planning |
| `.planning/ROADMAP.md` | 214 | planning | planning |
| `.planning/STATE.md` | 213 | planning | planning |
| `.planning/MILESTONES.md` | - | planning | planning |
| `.planning/RETROSPECTIVE.md` | - | planning | planning |

### Structural Notes

- No CLAUDE.md at project root (uses `~/.claude/CLAUDE.md` shared across all projects)
- L0 pattern docs already have YAML frontmatter with scope/sources/targets (Phase 9)
- All 23 pattern docs are the canonical L0 patterns consumed by the vault
- 20 skill definitions follow established SKILL.md format (Phases 8-11)

### Recommended Collection Config

AndroidCommonDoc is the toolkit itself, so collection is handled internally by the collector (not via external `ProjectConfig`). The existing collector already handles:
- `docs/` -> L0 patterns
- `skills/` -> L0 skills
- `.planning/PROJECT.md` -> L0 project knowledge
- `AGENTS.md` -> L0 AI instructions

No changes needed to AndroidCommonDoc's own collection -- it remains the L0 baseline.

---

## Summary

### Documentation Count by Repository

| Repository | Total .md Files | Collectable | Excluded | Layer |
|------------|----------------|-------------|----------|-------|
| shared-kmp-libs | 22 | 20 | 2 (coverage, docx) | L1 |
| DawSync | 100+ | ~85 | 33 archive + coverage + legal | L2 |
| -- SessionRecorder-VST3 | 70+ | 6-8 | 60+ (build deps) | L2 sub |
| -- DawSyncWeb | 27 | ~15 | 6 legal + 5 research | L2 sub |
| AndroidCommonDoc | 49 | 49 | 0 | L0 |

### Layer Assignment Summary

| Layer | Content | Source |
|-------|---------|--------|
| L0 Generic | 23 pattern docs, 20 skills, project planning | AndroidCommonDoc |
| L1 Ecosystem | CLAUDE.md, README.md, 5 convention docs, 13 module READMEs | shared-kmp-libs |
| L2 DawSync | CLAUDE.md, product docs, guides, architecture diagrams, 7 codebase docs | DawSync |
| L2 DawSync/SessionRecorder-VST3 | README, TESTING, CHANGELOG, build instructions | Sub-project (CMake/C++) |
| L2 DawSync/DawSyncWeb | README, agents, planning, 7 codebase docs | Sub-project (Node.js) |

### Key Findings

1. **shared-kmp-libs has substantial documentation** (20 collectible .md files, ~5,100 lines). The 5 convention docs in `docs/` and 13 module READMEs provide good L1 ecosystem coverage. Gap: no `.planning/codebase/` architecture decomposition.

2. **DawSync has extensive documentation** (~85 collectible files). The `docs/architecture/diagrams/` directory alone contains 62 Mermaid diagram documents organized by subsystem (A-H). The `.planning/codebase/` directory has 7 architecture docs. Coverage reports (155K+ lines) and archive (33 stale docs) must be excluded.

3. **SessionRecorder-VST3 sub-project detection is critical**. The `build-Release/` and `build-tests/` directories contain 60+ .md files from fetched JUCE/CLAP dependencies. Auto-detection must exclude build directories. Only 6-8 root-level docs are actually project documentation. Detection signal: `CMakeLists.txt` in a Gradle parent project.

4. **DawSyncWeb is an external sub-project** (sibling directory, not nested). Has its own `.planning/` structure with 7 codebase docs and research docs. Build system: `package.json` (Node.js). Must be configured explicitly since it is not inside DawSync's directory tree.

5. **No L0 promotion candidates found**. DawSync's guides and reference docs are genuinely domain-specific. Phase 9 already promoted error-handling to L0 and created DawSync L1 domain patterns.

6. **DawSync `.androidcommondoc/docs/dawsync-domain-patterns.md`** is an existing L1 override (175 lines). This is already handled by the Phase 9 pattern registry resolver. The vault should show both the L0 original and this L1 override per CONTEXT.md decision.

7. **Legal docs in DawSync and DawSyncWeb** (privacy policies, terms of service, cookie policies) should be excluded -- they are not developer documentation and add no value to the knowledge hub.

### Recommended Default Globs

For projects without explicit `collectGlobs`:

```
collectGlobs (default):
  - "CLAUDE.md"
  - "AGENTS.md"
  - "README.md"
  - "docs/**/*.md"
  - ".planning/PROJECT.md"
  - ".planning/codebase/**/*.md"

excludeGlobs (default):
  - "**/build/**"
  - "**/build-Release/**"
  - "**/build-tests/**"
  - "**/.gradle/**"
  - "**/node_modules/**"
  - "**/dist/**"
  - "**/archive/**"
  - "**/.androidcommondoc/**"
  - "coverage-*.md"
```

### Recommended vault-config.json Projects

```json
{
  "version": 1,
  "projects": [
    {
      "name": "shared-kmp-libs",
      "path": "C:\\Users\\34645\\AndroidStudioProjects\\shared-kmp-libs",
      "layer": "L1",
      "collectGlobs": ["CLAUDE.md", "README.md", "docs/**/*.md", "*/README.md"],
      "excludeGlobs": ["**/build/**", "**/.gradle/**", "coverage-*.md", "**/*.docx"]
    },
    {
      "name": "DawSync",
      "path": "C:\\Users\\34645\\AndroidStudioProjects\\DawSync",
      "layer": "L2",
      "collectGlobs": ["CLAUDE.md", "README.md", "APPLE_SETUP.md", "MARKETING_EN.md", "THIRD_PARTY_LICENSES.md", "docs/**/*.md", ".planning/codebase/**/*.md"],
      "excludeGlobs": ["**/build/**", "**/build-Release/**", "**/build-tests/**", "**/.gradle/**", "**/archive/**", "coverage-*.md", "coverage-gap-report.md", "docs/legal/**"],
      "subProjects": [
        {
          "name": "SessionRecorder-VST3",
          "path": "SessionRecorder-VST3",
          "collectGlobs": ["README.md", "TESTING.md", "CHANGELOG.md", "MACOS_BUILD_INSTRUCTIONS.md", "src/README.md", "installer/*/README.md"],
          "excludeGlobs": ["**/build-Release/**", "**/build-tests/**"]
        },
        {
          "name": "DawSyncWeb",
          "path": "C:\\Users\\34645\\AndroidStudioProjects\\DawSyncWeb",
          "collectGlobs": ["README.md", ".agents/**/*.md", ".claude/commands/**/*.md", ".planning/PROJECT.md", ".planning/codebase/**/*.md"],
          "excludeGlobs": ["**/node_modules/**", "**/dist/**", "docs/legal/**"]
        }
      ],
      "features": { "subProjectScanDepth": 1 }
    }
  ]
}
```

---

*Audit completed: 2026-03-14*
*Auditor: Phase 12 Plan 01 executor*
