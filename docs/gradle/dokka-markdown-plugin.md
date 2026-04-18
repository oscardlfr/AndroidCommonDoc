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
- `docs/api/<module>/-<kebab-class>.md` — Type A: one file per class/object/interface (leading-dash filename)
- `docs/api/<module>/<kebab-fn>.md` — Type B: one file per function/property/typealias
- `<module>/build/.androidcommondoc/kdoc-state.json` — written at end of each module's Dokka task: per-module JSON map of slug → `{ source, content_hash }` + top-level `generated_at` ISO timestamp

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
    url = uri("https://maven.pkg.github.com/oscardlfr/dokka-markdown-plugin")
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
| 1 | `scope` | list | `[api, core-domain]` | Always `[api, <module>]` |
| 2 | `sources` | list | `[core-domain]` | Module name(s) |
| 3 | `targets` | list | `[all]` | Always `[all]` |
| 4 | `slug` | string | `core-domain--base64-converter` | Type A: `<module>--<kebab-class>`; Type B: `<module>-<kebab-fn>` |
| 5 | `status` | string | `active` | Always `active` for generated docs |
| 6 | `layer` | string | `L1` | Hardcoded in 0.1.0; DSL override in 0.2.0 |
| 7 | `category` | string | `api` | Always `api` for generated docs |
| 8 | `description` | string | `One-line KDoc summary.` | First KDoc sentence, unquoted |
| 9 | `version` | string | `1` | Always `1` (not module semver) |
| 10 | `last_updated` | string | `2026-04` | Year-month (not full date) |
| 11 | `generated` | bool | `true` | Always true — excludes from dup detection |
| 12 | `generated_from` | string | `dokka` | Always literal `dokka` |
| 13 | `content_hash` | string | `7a8836e73f62` | 12-char compact hex, no `sha256:` prefix |
| 14 | `parent` | string | `core-domain-api-hub` | Hub slug: `<module>-api-hub` |
| 15 | `platforms` | list | `[android, common, desktop]` | Optional; KMP expect/actual only |

## File taxonomy

| Type | Filename | Slug format | When |
|------|----------|-------------|------|
| **Type A** (class-index) | `-base64-converter.md` | `core-domain--base64-converter` (module + double-dash + kebab) | Top-level class / object / interface |
| **Type B** (member) | `parse-json.md` | `core-domain-parse-json` (module + single-dash + kebab) | Functions, properties, typealias |
| **Hub** | `core-domain-hub.md` | `core-domain-api-hub` | One per module |

## Slug rules

- Type A slug = `<module>--<kebab-class>` e.g. `core-domain--base64-converter`
- Type B slug = `<module>-<kebab-fn>` e.g. `core-domain-parse-json`
- `MyClass` → `my-class` (kebab: camelCase split, leading-dash in filename only)
- `HTTPSClient` → `https-client` (acronym: lowercase block)
- Nested sealed subclass: `<module>--<parent-kebab>-<nested-kebab>` e.g. `core-domain--network-result-success`
- Module normalization: flat kebab (`core-domain`), colon path (`core:domain`), filesystem (`core/domain`), dot notation (`com.example.core`), deep nesting — all normalized to flat kebab before slug construction

## Body structure

**Type A** (class-index): breadcrumb `[<module>](<hub-link>) / ClassName`, class name heading, KDoc description, primary constructor signature (if present).

**Type B** (member): breadcrumb `[<module>](<hub-link>) / fnName`, function name heading, full signature fenced block, KDoc description, `#### Parameters` / `#### Return` / `#### Throws` / `#### See also` sections (omitted if empty).

**Hub**: YAML frontmatter + intro paragraph + `## Sub-documents` markdown table with a blank separator row after the header row, sorted alphabetically by symbol name.

## Fixes applied (baseline vs plugin output)

| Legacy bug (`dokka-to-docs.sh`) | Plugin behavior |
|---------------------------------|-----------------|
| Two timestamps per file (2-pass script) | Single-pass; per-module `<module>/build/.androidcommondoc/kdoc-state.json` written once at task end |
| `androidapplecommondesktop` concatenated string | `platforms: [android, apple, common, desktop]` — sorted array |
| Duplicated expect/actual bodies | Merged — one body, platform list separate |
| Duplicate hub entries | Deterministic sort, single data row per symbol; blank separator row after header |
| HTML leftovers (`[](#content)`, `index.html` links) | Direct Documentable → markdown, no ContentNode round-trip |
| Script unavailable on Windows without WSL | Gradle-native — runs on all platforms |

## Known limitations (0.1.0)

- `layer` field hardcoded to `L1` — custom DSL for L0/L2 override planned for 0.2.0
- Output directory is Dokka's `context.configuration.outputDir` — `structuredMarkdown { outputDirectory }` DSL planned for 0.2.0
- KDoc-state file path uses `../` relative from `outputDir` — absolute path override planned for 0.2.0
- `GoldenIntegrationTest` (TestKit renderer-override + Windows daemon OOM) deferred to 0.1.1 — 120 unit tests + 2 integration tests pass

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

- [dokka-markdown-plugin repo README](https://github.com/oscardlfr/dokka-markdown-plugin#readme) — apply, task, compat matrix (external repo, MIT)
- [`skills/generate-api-docs/SKILL.md`](../../skills/generate-api-docs/SKILL.md) — end-to-end generation workflow
- [`skills/kdoc-audit/SKILL.md`](../../skills/kdoc-audit/SKILL.md) — coverage auditing before generation
- [`skills/kdoc-migrate/SKILL.md`](../../skills/kdoc-migrate/SKILL.md) — filling KDoc gaps before generation
- [`docs/guides/generate-api-docs.md`](../guides/generate-api-docs.md) — full pipeline guide
