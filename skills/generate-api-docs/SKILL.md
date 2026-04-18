---
name: generate-api-docs
description: "Optional: Run Dokka + transformer to generate docs/api/ from KDoc in source code. Produces YAML-frontmatter docs consumable by context-provider and search-docs."
allowed-tools: [Bash, Read, Grep, Glob]
disable-model-invocation: true
copilot: true
copilot-template-type: behavioral
---

## Usage Examples

```
/generate-api-docs                                    # full project
/generate-api-docs --module core-domain               # single module
/generate-api-docs --project-root ../shared-kmp-libs  # cross-project
/generate-api-docs --validate-only                    # check docs/api/ freshness without regenerating
```

## Parameters

- `--project-root PATH` -- Target project root (default: cwd).
- `--module MODULE` -- Single module to generate (default: all modules).
- `--validate-only` -- Check if docs/api/ is stale without regenerating.

## Prerequisites

- Dokka Gradle plugin configured in `build-logic/` (convention plugin)
- `dokka-markdown-plugin` installed: check `versions-manifest.json` `plugin_versions.dokka-markdown-plugin` — if absent, add `com.androidcommondoc:dokka-markdown-plugin:0.1.0` from GitHub Packages (`https://maven.pkg.github.com/oscardlfr/AndroidCommonDoc`) to the project's Dokka plugin dependencies and re-run `/setup` or `/sync-l0`

## Behavior

### Step 1: Run Dokka

```bash
./gradlew dokkaGenerate    # full project
# OR
./gradlew :core-domain:dokkaGenerate  # single module
```

Output: `build/dokka/` with raw Markdown per module.

### Step 2: Transform to Internal Format

The `dokka-markdown-plugin` runs automatically as part of `dokkaGenerate` — no separate script invocation needed. The plugin (loaded via SPI) intercepts Dokka's renderer phase and writes directly to `docs/api/`.

Transformer:
- Creates `docs/api/{module}-hub.md` per module (≤100 lines, navigation only)
- Creates `docs/api/{module}/{class-name}.md` per class/interface (≤300 lines)
- Adds YAML frontmatter: `scope`, `category: api`, `generated: true`, `generated_at: <ISO date>`
- Resolves cross-references (@see, @link)

### Step 3: Validate

- Run `validate-doc-structure` MCP tool on `docs/api/`
- Verify all generated docs have valid frontmatter
- Report: modules processed, docs generated, any validation issues

### Validate-Only Mode

1. Read `generated_at` from docs/api/ frontmatter
2. Compare against latest commit touching public APIs
3. Report: stale modules, estimated drift

## Output

```markdown
## API Docs Generation Report

- **Modules processed**: 5
- **Docs generated**: 23 (5 hubs + 18 class docs)
- **Validation**: PASS (all frontmatter valid)
- **Coverage**: docs/api/ now indexed by search-docs and context-provider
```

## Integration

- **After `/kdoc-migrate`**: run this to publish KDoc to the doc system
- **Quality gate Step 0**: validates frontmatter on docs/api/ automatically
- **context-provider**: discovers API docs via `search-docs(category="api")`
- **validate-doc-update**: excludes `generated: true` files from duplicate detection
