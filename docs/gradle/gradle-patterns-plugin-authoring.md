---
slug: gradle-patterns-plugin-authoring
category: gradle
layer: L0
status: active
parent: gradle-hub
scope: [gradle, plugin-authoring, publishing]
sources: [context7:docs.gradle.org/current/userguide/java_gradle_plugin.html@2026-07-09]
targets: [all]
assumes_read: gradle-patterns-conventions
version: 1
last_updated: "2026-07-09"
description: "Version-generic Gradle plugin authoring: java-gradle-plugin + gradlePlugin{} DSL, automatic Plugin Marker Artifact generation, and settings.gradle.kts pluginManagement wiring for consumers."
token_budget: 700
---

# Gradle Plugin Authoring: `java-gradle-plugin`

**Version-generic** — this repo has no root Gradle build to pin against; apply the same pattern regardless of the Gradle/AGP version in the consuming project.

## Standard Authoring + Publishing Combo

```kotlin
// build.gradle.kts (the plugin's own build script)
plugins {
    `java-gradle-plugin`
    `maven-publish`
}
```

`java-gradle-plugin` adds the machinery to declare and validate plugins; `maven-publish` (or the Plugin Publishing Plugin, for the Gradle Plugin Portal) handles distribution.

## Declaring the Plugin

```kotlin
gradlePlugin {
    plugins {
        create("myPlugin") {
            id = "com.example.my-plugin"
            implementationClass = "com.example.MyPlugin"
        }
    }
}
```

(Groovy DSL uses the equivalent `plugins { myPlugin { id = '...'; implementationClass = '...' } }` block shape.)

`create("myPlugin")` is an arbitrary internal name for the plugin declaration — only `id` (the string consumers apply via `plugins { id("...") }`) and `implementationClass` (the `Plugin<Project>` entry point) are externally meaningful.

## What `gradlePlugin {}` Does Automatically

Applying `java-gradle-plugin` and populating `gradlePlugin { plugins { ... } }`:

- Generates the plugin descriptor (`META-INF/gradle-plugins/<id>.properties`) mapping `id` → `implementationClass` — no manual properties file needed.
- Configures the **Plugin Marker Artifact** publication automatically — a marker artifact (coordinates derived from the plugin `id`) that lets consumers resolve the plugin by `id` via the `plugins {}` DSL rather than a raw group:artifact:version dependency.
- If the Plugin Publishing Plugin (`com.gradle.plugin-publish`) is also applied, wires publication to the Gradle Plugin Portal — still no manual marker configuration.

## Consumer-Side Wiring

A consumer resolving the plugin via `plugins { id("com.example.my-plugin") }` needs the hosting repository declared in `settings.gradle.kts`'s `pluginManagement {}` block (the `plugins {}` DSL resolves against `pluginManagement.repositories`, not the project's regular `repositories {}`):

```kotlin
// settings.gradle.kts
pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral() // or wherever the marker artifact is published
    }
}
```

Omitting this produces a "Plugin ... not found" resolution failure even when the artifact itself is reachable from the project's normal dependency repositories.

## Anti-Patterns

- Hand-authoring the `META-INF/gradle-plugins/<id>.properties` descriptor instead of letting `gradlePlugin { plugins { ... } }` generate it.
- Publishing the implementation artifact without the Plugin Marker Artifact, then wondering why `plugins { id(...) }` resolution fails for consumers.
- Declaring the plugin's repository only under the project's `repositories {}` instead of `pluginManagement.repositories` — the two are resolved independently.

## See Also

- [gradle-patterns-conventions](gradle-patterns-conventions.md) — how this toolkit's own convention plugins are structured and applied
- [gradle-patterns-publishing](gradle-patterns-publishing.md) — composite-build / Maven-coordinate publishing patterns used elsewhere in this repo
