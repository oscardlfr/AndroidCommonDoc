---
scope: [guides, api-docs, workflow]
sources: [androidcommondoc]
targets: [all]
slug: generate-api-docs-workflow
status: active
layer: L0
category: guides
description: "End-to-end workflow for generating docs/api/ from KDoc via dokka-markdown-plugin."
version: 1
last_updated: "2026-04"
parent: guides-hub
---

# API Doc Generation — End-to-End Workflow

This guide walks the full pipeline from KDoc source to searchable `docs/api/` consumed by MCP tools and agents.

## The pipeline

```
KDoc source
  → Dokka 2.2.x (./gradlew dokkaGenerate)
  → dokka-markdown-plugin (CoreExtensions.renderer override)
  → docs/api/<module>-hub.md
  → docs/api/<module>/<symbol>.md
  → .androidcommondoc/kdoc-state.json
  → MCP tools: search-docs, find-pattern, api-surface-diff, kdoc-coverage
  → Agents: context-provider, doc-alignment-agent, codebase-mapper, beta-readiness-agent
```

## Step 1: Audit KDoc coverage

Before generating, measure how much of your public API is documented:

```
/kdoc-audit                       # full project coverage report
/kdoc-audit --module core-domain  # single module
```

`/kdoc-audit` reports undocumented public symbols and regressions vs the previous run. Address BLOCK-level gaps (new undocumented APIs) before proceeding.

## Step 2: Fill KDoc gaps

If coverage is below threshold or new public APIs lack docs:

```
/kdoc-migrate --module core-domain
```

`/kdoc-migrate` iterates symbols module by module, generates KDoc from context (existing names, types, usages), and writes it back to source. Review each change — KDoc is contract documentation, not implementation commentary.

## Step 3: Install the plugin

**Via wizard (recommended):**

```
/setup --dokka-plugin yes
```

Wizard step W10 handles version catalog entry, GitHub Packages repo wiring, and `l0-manifest.json` tracking.

**Manual install:** see [`docs/gradle/dokka-markdown-plugin.md`](../gradle/dokka-markdown-plugin.md#apply) for the exact TOML + Gradle snippets.

## Step 4: Generate

```
/generate-api-docs                           # full project
/generate-api-docs --module core-domain      # single module
/generate-api-docs --validate-only           # stale check without regenerating
```

Under the hood this runs `./gradlew dokkaGenerate`. The plugin intercepts the renderer phase — no shell script invocation needed. Output lands in `build/dokka/` (Dokka default); copy or symlink to `docs/api/`:

```bash
cp -r build/dokka/ docs/api/
```

Or configure `outputDirectory` in your Dokka Gradle config to point directly at `docs/api/`.

## Step 5: Validate output

Run `validate-doc-structure` on the output to confirm frontmatter is complete:

```
/audit-docs          # includes validate-doc-structure on docs/api/
```

The MCP tool `validate-doc-structure` skips `generated: true` files for duplicate detection but still validates required frontmatter fields. Expect 0 errors after a clean generation run.

Track coverage regression:

```
/kdoc-audit --validate-only   # re-run after generation to confirm no regressions
```

## Step 6: Consume

Once `docs/api/` is populated, these consumers activate automatically:

| Consumer | How it uses docs/api/ |
|----------|-----------------------|
| `context-provider` | `search-docs(category="api")` — answers API queries without greping source |
| `doc-alignment-agent` | Checks `generated_from` field against live source for drift |
| `codebase-mapper` | Builds module inventory from hub files |
| `beta-readiness-agent` | Flags modules where public APIs lack docs (WARN threshold: <80%) |
| `/find-pattern` MCP | Full-text search includes API category docs |
| `/api-surface-diff` MCP | Compares `content_hash` fields between branches for breaking changes |

## CI drift detection

The plugin writes `.androidcommondoc/kdoc-state.json` on every run — a central index of ISO 8601 timestamps and `sha256:` content hashes per file. Use this in CI to detect stale docs:

```yaml
# Recommended CI check (add to ci.yml)
- name: Check API docs freshness
  run: |
    node mcp-server/build/cli/monitor-sources.js \
      --check kdoc-state \
      --project-root . \
      --fail-on-stale
```

Individual docs also carry `content_hash:` in their frontmatter. `api-surface-diff` compares hashes between the PR branch and `develop` to surface breaking API changes before merge.

## Opt-out

Projects that skip plugin installation (`/setup --dokka-plugin no` or W10 declined) can still use `/generate-api-docs`. The skill detects missing plugin and prints the install hint from `versions-manifest.json plugin_versions.dokka-markdown-plugin`. All consuming agents degrade gracefully when `docs/api/` is absent — they fall back to source-level KDoc queries.

## Cross-references

- [`docs/gradle/dokka-markdown-plugin.md`](../gradle/dokka-markdown-plugin.md) — frontmatter contract, file taxonomy, slug rules
- [`tools/dokka-markdown-plugin/README.md`](../../tools/dokka-markdown-plugin/README.md) — compat matrix, known fixes
- [`skills/generate-api-docs/SKILL.md`](../../skills/generate-api-docs/SKILL.md) — skill parameters and steps
- [`skills/kdoc-audit/SKILL.md`](../../skills/kdoc-audit/SKILL.md) — coverage auditing
- [`skills/kdoc-migrate/SKILL.md`](../../skills/kdoc-migrate/SKILL.md) — KDoc authoring
