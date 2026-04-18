# Changelog

## 0.1.0 — 2026-04-18

First release.

### Added

- Dokka 2.2.x custom renderer (`StructuredMarkdownRenderer` via `CoreExtensions.renderer` override)
- 14-field YAML frontmatter per doc + optional `platforms:` for multi-target KMP declarations
- Three file types: Type A class-index (leading-dash filename, double-dash slug), Type B member (signature + KDoc tags), per-module hub (markdown table)
- `.androidcommondoc/kdoc-state.json` central run state with ISO 8601 timestamp and content-hash drift detection
- Structured platform labels — no more `androidapplecommondesktop` concatenation
- Single-pass deterministic output — no more two-timestamp script bug
- First-class KMP expect/actual merging — one body, platform list separate

### Dependencies

- `org.jetbrains.dokka:dokka-core:2.2.0` (compileOnly)
- `org.jetbrains.dokka:dokka-base:2.2.0` (compileOnly)
