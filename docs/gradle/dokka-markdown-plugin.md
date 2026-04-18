---
scope: [gradle, dokka, api-docs]
sources: [androidcommondoc]
targets: [all]
slug: dokka-markdown-plugin
status: active
layer: L0
category: gradle
description: "Dokka 2.2.x plugin that renders KDoc to L0-compliant structured markdown (docs/api/*.md) with 14-field YAML frontmatter."
version: 1
last_updated: "2026-04"
parent: gradle-hub
---

# Dokka Markdown Plugin

Gradle plugin (`com.androidcommondoc:dokka-markdown-plugin`) that intercepts Dokka's rendering phase and writes L0-compliant structured markdown to `docs/api/`. Single-pass, deterministic, cross-platform. Replaces the lost `scripts/sh/dokka-to-docs.sh`.

## What it does

The plugin registers via `CoreExtensions.renderer`, overriding `htmlRenderer`. On `./gradlew dokkaGenerate` it writes three file types per module plus a central run-state file — no post-processing shell script needed.

Output structure:
- `docs/api/<module>-hub.md` — navigation hub, markdown table of sub-docs (≤100 lines)
- `docs/api/<module>/<kebab-name>.md` — one file per top-level symbol
- `.androidcommondoc/kdoc-state.json` — ISO 8601 timestamp + per-file content hash for CI drift detection

## Apply

Add to `libs.versions.toml`:

```toml
[versions]
dokka-markdown-plugin = "0.1.0"

[libraries]
dokka-markdown-plugin = { module = "com.androidcommondoc:dokka-markdown-plugin", version.ref = "dokka-markdown-plugin" }
```

Add GitHub Packages repo in root `build.gradle.kts`:

```kotlin
maven {
    url = uri("https://maven.pkg.github.com/oscardlfr/AndroidCommonDoc")
    credentials {
        username = providers.gradleProperty("gpr.user").orNull ?: System.getenv("GITHUB_ACTOR")
        password = providers.gradleProperty("gpr.key").orNull ?: System.getenv("GITHUB_TOKEN")
    }
}
```

Add to module's `build.gradle.kts`:

```kotlin
plugins { id("org.jetbrains.dokka") version "2.2.0" }
dependencies { dokkaPlugin(libs.dokka.markdown.plugin) }
```

## Frontmatter spec (14 fields + optional 15th)

Fixed field order — renderers and validators depend on this order:

| # | Field | Type | Example | Notes |
|---|-------|------|---------|-------|
| 1 | `scope` | string | `core-domain` | Module name |
| 2 | `sources` | list | `[src/commonMain/kotlin/...]` | Source paths |
| 3 | `targets` | list | `[docs/api/core-domain/]` | Output paths |
| 4 | `slug` | string | `base64-converter` | Type B; `--base64-converter` for Type A |
| 5 | `status` | string | `stable` | stable / experimental / deprecated |
| 6 | `layer` | string | `L1` | Hardcoded in 0.1.0; DSL override in 0.2.0 |
| 7 | `category` | string | `api` | Always `api` for generated docs |
| 8 | `description` | string | `"One-line KDoc summary"` | First KDoc sentence |
| 9 | `version` | string | `0.1.0` | Module version |
| 10 | `last_updated` | string | `2026-04-18` | ISO 8601 date |
| 11 | `generated` | bool | `true` | Always true — excludes from dup detection |
| 12 | `generated_from` | string | `com.example.Base64Converter` | Fully qualified class name |
| 13 | `content_hash` | string | `sha256:abc123...` | Content-addressed hash for drift detection |
| 14 | `parent` | string | `core-domain-hub` | Hub slug |
| 15 | `platforms` | list | `[android, common, desktop]` | Optional; KMP expect/actual only |

## File taxonomy

| Type | Filename | Slug format | When |
|------|----------|-------------|------|
| **Type A** (class-index) | `-base64-converter.md` | `--base64-converter` (double-dash) | Top-level class / object / interface |
| **Type B** (member) | `parse-json.md` | `parse-json` (single-dash) | Functions, properties, typealias |
| **Hub** | `core-domain-hub.md` | `core-domain-hub` | One per module |

## Slug rules

- `MyClass` → `-my-class` (Type A: leading dash + kebab)
- `parseJson` → `parse-json` (Type B: camelCase → kebab)
- `HTTPSClient` → `-https-client` (acronym: lowercase block)
- Double-dash slug in frontmatter mirrors leading-dash filename: `--base64-converter`

## Body structure

**Type A** (class-index): breadcrumb path, class name heading, primary constructor signature, members table (name, type, KDoc first sentence).

**Type B** (member): full signature fenced block, KDoc description, `### Parameters` / `### Returns` / `### Throws` sections (omitted if empty).

**Hub**: YAML frontmatter + intro paragraph + markdown table sorted alphabetically by symbol name (one row per symbol — no separator rows).

## Fixes applied (baseline vs plugin output)

| Legacy bug (`dokka-to-docs.sh`) | Plugin behavior |
|---------------------------------|-----------------|
| Two timestamps per file (2-pass script) | Single-pass; one ISO timestamp in central `.androidcommondoc/kdoc-state.json` |
| `androidapplecommondesktop` concatenated string | `platforms: [android, apple, common, desktop]` — sorted array |
| Duplicated expect/actual bodies | Merged — one body, platform list separate |
| Empty hub separator rows + duplicate entries | Deterministic sort, single row per symbol |
| HTML leftovers (`[](#content)`, `index.html` links) | Direct Documentable → markdown, no ContentNode round-trip |
| Script unavailable on Windows without WSL | Gradle-native — runs on all platforms |

## Known limitations (0.1.0)

- `layer` field hardcoded to `L1` — custom DSL for L0/L2 override planned for 0.2.0
- Output directory is Dokka's `context.configuration.outputDir` — `structuredMarkdown { outputDirectory }` DSL planned for 0.2.0
- KDoc-state file path uses `../` relative from `outputDir` — absolute path override planned for 0.2.0
- `GoldenIntegrationTest` (TestKit renderer-override + Windows daemon OOM) deferred to 0.1.1 — 101/101 unit tests pass

## Consumer contracts

Agents and MCP tools that rely on `docs/api/` output:

| Consumer | What it reads |
|----------|--------------|
| `context-provider` | Discovers API docs via `search-docs(category="api")` |
| `doc-alignment-agent` | Compares `generated_from` field against live source |
| `codebase-mapper` | Indexes module structure from hub files |
| `beta-readiness-agent` | Checks coverage: undocumented public APIs → WARN |
| `search-docs` MCP tool | Full-text search across `docs/api/` |
| `find-pattern` MCP tool | Pattern lookup including API category |
| `validate-doc-structure` MCP tool | Validates frontmatter; skips `generated: true` for dup detection |
| `validate-doc-update` MCP tool | Excludes `generated: true` files from duplicate detection |
| `api-surface-diff` MCP tool | Diffs `content_hash` values between branches |
| `kdoc-coverage` MCP tool | Reports undocumented symbols using hub tables |

## Cross-references

- [`tools/dokka-markdown-plugin/README.md`](../../tools/dokka-markdown-plugin/README.md) — apply, task, compat matrix
- [`skills/generate-api-docs/SKILL.md`](../../skills/generate-api-docs/SKILL.md) — end-to-end generation workflow
- [`skills/kdoc-audit/SKILL.md`](../../skills/kdoc-audit/SKILL.md) — coverage auditing before generation
- [`skills/kdoc-migrate/SKILL.md`](../../skills/kdoc-migrate/SKILL.md) — filling KDoc gaps before generation
- [`docs/guides/generate-api-docs.md`](../guides/generate-api-docs.md) — full pipeline guide
