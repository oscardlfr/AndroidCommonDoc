# Dokka Markdown Plugin

Dokka 2.2.x plugin that transforms KDoc into L0-compliant structured markdown (`docs/api/*.md`) with 14-field YAML frontmatter, content-addressed hashes for CI drift detection, and first-class KMP expect/actual handling. Replaces the legacy `dokka-to-docs.sh` script.

## Apply

Add to your project's `libs.versions.toml`:

```toml
[versions]
dokka-markdown-plugin = "0.1.0"

[libraries]
dokka-markdown-plugin = { module = "com.androidcommondoc:dokka-markdown-plugin", version.ref = "dokka-markdown-plugin" }
```

Add the GitHub Packages repository in your root `build.gradle.kts`:

```kotlin
allprojects {
    repositories {
        mavenCentral()
        maven {
            url = uri("https://maven.pkg.github.com/oscardlfr/AndroidCommonDoc")
            credentials {
                username = providers.gradleProperty("gpr.user").orNull ?: System.getenv("GITHUB_ACTOR")
                password = providers.gradleProperty("gpr.key").orNull ?: System.getenv("GITHUB_TOKEN")
            }
        }
    }
}
```

Add the Dokka plugin and plugin dependency in the target module's `build.gradle.kts`:

```kotlin
plugins {
    id("org.jetbrains.dokka") version "2.2.0"
}

dependencies {
    dokkaPlugin(libs.dokka.markdown.plugin)
}
```

Store credentials in `~/.gradle/gradle.properties` (never commit):

```properties
gpr.user=your-github-username
gpr.key=ghp_yourPersonalAccessToken
```

## Task

Run `./gradlew dokkaGenerate` — the plugin intercepts Dokka's rendering phase automatically via the `CoreExtensions.renderer` extension point, overriding `htmlRenderer`. Output lands in `build/dokka/` by default. Copy or symlink the output to `docs/api/` for MCP tool consumption.

```bash
./gradlew dokkaGenerate
# then copy output:
cp -r build/dokka/ docs/api/
```

Or for a single module:

```bash
./gradlew :core-domain:dokkaGenerate
```

## Output format

Three file types are generated per module:

- `docs/api/<module>-hub.md` — navigation hub with a markdown table of all sub-docs (≤100 lines); hub table has a blank separator row after the header
- `docs/api/<module>/-<kebab-class>.md` — one file per top-level class/object/interface (Type A); filename has leading `-`, no module prefix (e.g., `-base64-converter.md`)
- `docs/api/<module>/<kebab-fn>.md` — one file per top-level function/property/typealias (Type B); no leading `-` (e.g., `parse-json.md`)
- `<module>/build/.androidcommondoc/kdoc-state.json` — written at end of every module's Dokka task: per-module JSON map `{ "<slug>": { "source": "<path>", "content_hash": "<12-hex>" } }` + top-level `generated_at` ISO timestamp. Per-module (not a shared central file) to avoid collision with other skills writing to `.androidcommondoc/`.

Each generated doc includes 14-field YAML frontmatter:

```yaml
---
scope: [api, core-domain]
sources: [core-domain]
targets: [all]
slug: core-domain--base64-converter    # Type A (class): module--kebab-class
                                       # Type B (function): core-domain-parse-json
status: active
layer: L1
category: api
description: One-line KDoc summary.
version: 1
last_updated: 2026-04
generated: true
generated_from: dokka
content_hash: 7a8836e73f62             # 12-char compact hex (no sha256: prefix)
parent: core-domain-api-hub
---
```

Optional 15th field for multi-target KMP declarations:

```yaml
platforms: [android, common, desktop]
```

## Compatibility matrix

| Dokka | Kotlin | AGP | JDK | Status |
|-------|--------|-----|-----|--------|
| 2.2.0 | 2.3.20 | 9.0.0+ (KMP) | 17+ | Supported |
| 2.2.0 | 2.3.20 | 8.x (Android-only) | 17+ | Supported |
| 2.1.x | any | any | 17+ | Unsupported — extension point changed |

Dokka 2.1.x used a different renderer extension point (`htmlRenderer` shape differs). Upgrade to 2.2.x before adopting this plugin.

## Known fixes applied (vs. legacy dokka-to-docs.sh)

| Legacy bug | Plugin behavior |
|------------|-----------------|
| Two timestamps per file (2-pass script) | Single-pass renderer; one ISO timestamp in per-module `<module>/build/.androidcommondoc/kdoc-state.json` |
| `androidapplecommondesktop` concatenated string | `platforms: [android, apple, common, desktop]` — sorted array |
| Duplicated expect/actual bodies | Merged — one body, platform list separate |
| Duplicate hub entries + missing separator | Deterministic sort; one data row per symbol; blank separator row after header |
| HTML leftovers (`[](#content)`, `index.html` links) | Direct Documentable → markdown, no ContentNode round-trip |

## Replaces

This plugin replaces the lost `scripts/sh/dokka-to-docs.sh` referenced by `skills/generate-api-docs/SKILL.md`. No paired shell/PowerShell scripts — the plugin is Gradle-native and cross-platform.

## Current limitations (0.1.0)

- `layer` field hardcoded to `L1` — custom DSL for L0/L2 override planned for 0.2.0
- Output directory is Dokka's `context.configuration.outputDir`; custom `structuredMarkdown { outputDirectory }` DSL planned for 0.2.0
- KDoc-state file path uses `../` relative from `outputDir` — absolute path DSL override planned for 0.2.0

## Opt-in via /setup wizard

Run `/setup --dokka-plugin yes` to auto-install. The wizard (step W10) handles:
- Adding the version catalog entry
- Wiring the GitHub Packages repository
- Writing the `l0-manifest.json` plugin tracking entry

See also `skills/setup/SKILL.md` wizard step W10.
