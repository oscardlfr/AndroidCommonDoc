---
scope: [gradle, detekt, architecture]
sources: [detekt, gradle]
targets: [android, desktop, ios, jvm]
version: 1
last_updated: "2026-03"
description: "Convention plugin pattern for chain Detekt config loading across L0→L1→L2"
slug: convention-plugin-chain
status: active
layer: L0
category: gradle
assumes_read: gradle-hub
token_budget: 600
---

# Convention Plugin — Chain Detekt Config

## Overview

In a chain topology (L0→L1→L2), each layer can provide Detekt config overrides. The convention plugin resolves config files in layer order: L0 base → L1 override → L2 override. **Last wins per key** — same as Detekt's `CompositeConfig` behavior.

## Pattern

### Convention Plugin (build-logic)

```kotlin
// build-logic/src/main/kotlin/detekt-chain.gradle.kts
import io.gitlab.arturbosch.detekt.Detekt

plugins {
    id("dev.detekt")
}

// Resolve config chain from l0-manifest.json
val manifestFile = rootProject.file("l0-manifest.json")

val configFiles = buildList {
    if (manifestFile.exists()) {
        val manifest = groovy.json.JsonSlurper().parse(manifestFile) as Map<*, *>
        val sources = manifest["sources"] as? List<*> ?: emptyList<Any>()

        // Add configs from each source layer, ordered by layer name
        for (source in sources.sortedBy { (it as Map<*, *>)["layer"] as String }) {
            val sourcePath = (source as Map<*, *>)["path"] as String
            val configFile = rootProject.file("$sourcePath/detekt-rules/src/main/resources/config/detekt-l0-base.yml")
            if (configFile.exists()) add(configFile)
        }
    }

    // Local project override (always last = highest priority)
    val localConfig = rootProject.file("detekt.yml")
    if (localConfig.exists()) add(localConfig)
}

tasks.withType<Detekt>().configureEach {
    config.setFrom(configFiles)
}
```

### Key Points

1. **Order matters**: `config.setFrom(l0Base, l1Override, l2Local)` — Detekt's `CompositeConfig` checks the **last** file first per key.
2. **Each layer only overrides what it needs**: L1 doesn't duplicate L0's entire config — only the keys it wants to change.
3. **L0 base is always present**: The convention plugin reads from the L0 source path in the manifest.
4. **Local override is always last**: `detekt.yml` in the project root has highest priority.

### L1 Override Example

```yaml
# shared-kmp-libs/detekt-override.yml
# Only override severity — L0 base provides all other config
AndroidCommonDoc:
  NoTurbineRule:
    active: false  # shared-libs uses Turbine intentionally
  NoHardcodedDispatchersRule:
    severity: warning  # downgrade from error
```

### Integration Test Fixture

To verify config chain order, create a test that checks merge behavior:

```kotlin
@Test
fun `detekt config chain loads in correct order`() {
    // L0 base: NoTurbineRule active=true
    // L1 override: NoTurbineRule active=false
    // Expected: NoTurbineRule active=false (L1 wins)
    val config = CompositeConfig(
        lookFirst = YamlConfig.load(l1Override),
        lookSecond = YamlConfig.load(l0Base),
    )
    val ruleConfig = config.subConfig("AndroidCommonDoc")
        .subConfig("NoTurbineRule")
    assertThat(ruleConfig.valueOrDefault("active", true)).isFalse()
}
```

## Related

- `docs/guides/detekt-migration-v2.md` — Detekt 2.0 coordinates and setup
- `docs/architecture/layer-topology.md` — Chain vs flat topology model
- `.gsd/DECISIONS.md` D002 — Knowledge cascade design
