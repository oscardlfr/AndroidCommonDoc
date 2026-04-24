---
scope: L0
sources: dokka-gradle-plugin-2.2.0-sources.jar (inspected 2026-04-19)
targets: L1/L2 projects using Dokka companion plugins
category: gradle
slug: gradle-patterns-dgpv2-typed-config
status: draft
---

# DGPv2 Typed pluginsConfiguration

## Overview

DGP v2 replaces the stringly-typed `PluginConfiguration` DSL with a typed `ExtensiblePolymorphicDomainObjectContainer<DokkaPluginParametersBaseSpec>`.

## Consumer Pattern

Subclass `DokkaPluginParametersBaseSpec` with `@OptIn(InternalDokkaGradlePluginApi::class)` and implement `jsonEncode(): String`:

```kotlin
@OptIn(InternalDokkaGradlePluginApi::class)
abstract class MyPluginConfig @Inject constructor(name: String) :
    DokkaPluginParametersBaseSpec(name) {
    override fun jsonEncode(): String = buildJsonObject { /* ... */ }.toString()
}
```

## Registration

Use `registerBinding` + `register` — NOT `.named()` or `.maybeCreate()`:

```kotlin
pluginsConfiguration.registerBinding(MyPluginConfig::class, MyPluginConfig::class)
pluginsConfiguration.register<MyPluginConfig>("com.example.MyDokkaPlugin") {
    // configure properties
}
```

## Two API Layers — Do Not Confuse

| Layer | API | Purpose |
|-------|-----|---------|
| Gradle DSL | `jsonEncode()` | Serializes config to JSON for engine |
| Engine runtime | `DokkaPluginConfiguration.fqPluginName` + `.values` | Reads serialized config |

## fqPluginName Gotcha

`fqPluginName` at runtime = Dokka **plugin class** FQN (e.g., `com.example.MyDokkaPlugin`), NOT the Gradle plugin ID. Use the fully-qualified class name when calling `register<T>("...")`.

## Migration from DGPv1

DGPv1 used `pluginsConfiguration.create("fqName") { values = "..." }` (stringly-typed). DGPv2 requires typed subclass + `registerBinding` — no direct equivalent to `values` string assignment.
