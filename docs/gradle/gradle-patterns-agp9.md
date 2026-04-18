---
scope: [gradle, build-config, agp9, templates]
sources: [agp, android-cli]
targets: [android, desktop, ios, jvm]
slug: gradle-patterns-agp9
status: active
layer: L0
category: gradle
parent: gradle-patterns
assumes_read: gradle-hub
version: 1
last_updated: "2026-04-17"
token_budget: 650
description: "AGP 9.0+ module templates — what `android create` emits, how the L0 wrapper (setup/create-module.sh) aligns it with convention plugins, and the flat-module-names invariant."
---

# Gradle Patterns — AGP 9.0+ Module Templates

Google's `android create` (Android CLI v0.7+) emits AGP 9.0-compatible project templates. This doc captures what the generator produces and how the L0 wrapper `setup/create-module.sh` post-processes the output so new modules land in the same convention-plugin + flat-naming world as the rest of the ecosystem.

## Template catalogue

`android create --list-profiles` lists currently available templates. The stable ones as of CLI v0.7:

| Template slug | Produces | When to use |
|---|---|---|
| `empty-activity-agp-9` | Single-activity AGP 9 app with Compose | New feature app or sample |
| `compose-library-agp-9` | KMP library module with Compose Multiplatform | Shared Compose UI module (L1) |
| `kmp-library-agp-9` | Pure KMP library (no Compose) | Shared domain/data module (L1) |

Run `android create --dry-run --verbose <template>` to preview the full file tree without writing.

## L0 post-processing — why `create-module.sh`

Raw `android create` output applies AGP 9 the Google way: inlined `build.gradle.kts` with `android { ... }` blocks, no convention plugin. L0 convention plugins centralize Kotlin/JVM targets, Compose BOM alignment, Detekt wiring, and Kover instrumentation. The wrapper reconciles both:

1. Runs `android create <template>` into a tmp dir.
2. Rewrites the generated `build.gradle.kts` to apply the correct L0 convention plugin:
   - `androidcommondoc.android.library` for pure Android modules
   - `androidcommondoc.kmp.library` for KMP modules
   - `androidcommondoc.kmp.compose` for KMP + Compose Multiplatform
3. Strips the inlined `android { compileSdk = ... }` block (the convention plugin owns those).
4. Validates the flat-module-naming invariant — no colon-delimited nested paths.
5. Runs `validate-kmp-packages` MCP tool on the created module before exit to catch source-set layout violations.

See `setup/create-module.sh` for the implementation.

## Flat module names — the AGP 9 constraint

AGP 9+ has a documented circular-dependency bug when module paths contain more than two colon segments (`core:json:api`). L0 prescribes **flat** kebab-case names (`core-json-api`) for all new KMP modules.

AGP 8.x Android-only projects are not affected, but adopting flat names there too keeps the naming convention consistent if the project later migrates to AGP 9.

### ❌ Bad (AGP 9)

```
settings.gradle.kts
include(":core:json:api")  // ← triggers AGP 9 circular dep bug
```

### ✅ Good (AGP 9)

```
settings.gradle.kts
include(":core-json-api")
```

The rule is mechanically enforced by `gradle-patterns-flat-module-names` (Detekt-generated from `gradle-hub.md`).

## Mapping `android create` output to L0 conventions

| `android create` emits | L0 replacement | Why |
|---|---|---|
| `android.compileSdk = 34` inlined | Convention plugin owns `compileSdk` | Single source of truth, easy AGP bump |
| `kotlin { jvmToolchain(17) }` inlined | Convention plugin owns toolchain | Match project-wide version |
| No Detekt block | Convention plugin applies Detekt + L0 rules | Enforces patterns out of the box |
| No Kover block | Convention plugin wires Kover for coverage | Required by `/coverage` skill |
| Nested `:feature:foo:api` paths | Flat `:feature-foo-api` | AGP 9 invariant |

## Usage

```bash
# Create a new Android-only library module
bash setup/create-module.sh --name feature-settings --package com.example.feature.settings

# Create a KMP library module
bash setup/create-module.sh --name core-validation --package com.example.core.validation --kmp

# Dry run (preview what would be written)
bash setup/create-module.sh --name feature-test --package com.example.feature.test --dry-run
```

After the script finishes, the module is registered in `settings.gradle.kts` and ready for `./gradlew :<module-name>:assemble`.

## Verification

```bash
# Convention plugin applied?
grep "androidcommondoc" <module>/build.gradle.kts

# Flat naming respected?
grep "include(\":" settings.gradle.kts | grep -E ":[a-z]+:[a-z]+:"
# ^ should return NOTHING for AGP 9 modules

# KMP source sets valid?
/verify-kmp <module>
```

## Cross-references

- [gradle-hub](gradle-hub.md) — parent hub with flat-module-names rule frontmatter
- [gradle-patterns-conventions](gradle-patterns-conventions.md) — L0 convention plugins
- [gradle-patterns-android-only](gradle-patterns-android-only.md) — AGP 8.x path for legacy modules
- Plan 19-03 — `setup/create-module.sh` wrapper design
- Android CLI: `android create --list-profiles` for current templates
