# dokka-markdown-plugin — MOVED

This tool has been **extracted to its own repository** as part of the AndroidCommonDoc modularization plan.

- **New home**: [github.com/oscardlfr/dokka-markdown-plugin](https://github.com/oscardlfr/dokka-markdown-plugin)
- **License**: MIT
- **Maven coordinate (unchanged)**: `com.androidcommondoc:dokka-markdown-plugin:0.1.0`
- **Publish registry**: `https://maven.pkg.github.com/oscardlfr/dokka-markdown-plugin`

## Why it moved

Part of the [AndroidCommonDoc modularization plan](../../.planning/MODULARIZATION-PLAN.md) — each L0 tool becomes a standalone repo with its own release cadence, enabling single-purpose consumers (just the plugin, no ecosystem clone required) and cleaner OSS distribution.

## Upgrade path

### Via Maven coordinate (once 0.1.0 publishes)

```kotlin
// libs.versions.toml
dokka-markdown-plugin = "0.1.0"

// consumer build.gradle.kts
repositories {
    maven {
        url = uri("https://maven.pkg.github.com/oscardlfr/dokka-markdown-plugin")
        // credentials: gpr.user / gpr.key with read:packages scope
    }
}
dependencies {
    dokkaPlugin(libs.dokka.markdown.plugin)
}
```

### Via composite build (dev/test, no publish)

```kotlin
// consumer settings.gradle.kts
includeBuild("../dokka-markdown-plugin") {
    dependencySubstitution {
        substitute(module("com.androidcommondoc:dokka-markdown-plugin"))
            .using(project(":"))
    }
}
```

## See also

- Pattern doc: `docs/gradle/dokka-markdown-plugin.md` — full contract spec (frontmatter, slug rules, file taxonomy)
- Integration guide: `docs/guides/generate-api-docs.md` — end-to-end KDoc → `docs/api/*.md` workflow
- Consumer skill: `skills/generate-api-docs/SKILL.md`
- Setup wizard: `skills/setup/SKILL.md` W10 — opt-in auto-install
