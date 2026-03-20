# AndroidCommonDoc — Knowledge Base

Append-only register of project-specific rules, patterns, and lessons learned.
Read this at the start of every work unit. Append when you discover a non-obvious pattern or rule.

---

## Milestone Closure Checklist

**Always run `/readme-audit --fix` before the final commit of any milestone.**

The README.md goes stale with every milestone that adds skills, rules, agents, or tools. The skill audits counts and missing sections automatically. This is the canonical close-milestone gate.

---

## Detekt Rules — AST-Only Constraint

All custom Detekt rules must be AST-only (no `bindingContext`, no type resolution).
- Avoids Detekt issue #8882 (ClassCastException in analysis pipeline)
- Use PSI visitor methods only: `visitNamedFunction`, `visitClass`, `visitCallExpression`, etc.
- Companion objects in PSI are `KtObjectDeclaration` with `COMPANION_KEYWORD` modifier — not `KtClass`
- `getParentOfType<KtClass>()` silently skips companion objects; use `getParentOfType<KtObjectDeclaration>()` with `hasModifier(KtTokens.COMPANION_KEYWORD)`

## Detekt Initializer Text

When checking initializer expressions for type names, use `startsWith("TypeName")` not `contains("TypeName(")`.
- `MutableStateFlow<Event?>(null)` does NOT contain `"MutableStateFlow("` (generic breaks the match)
- `startsWith("MutableStateFlow")` catches all generic variants

## Detekt Config Merge Order

`--config base.yml,override.yml` → `CompositeConfig(lookFirst=override.yml, lookSecond=base.yml)`.
The **last** file in the list wins per leaf key. L1 override files go last.

---

## MCP Server — No console.log

All MCP server code must use the `logger` utility (stderr only).
`console.log` corrupts the stdio transport and breaks Claude Desktop integration.

---

## Doc Size Limits

- Hub docs (containing `## Sub-documents`): **≤100 lines**
- Sub-docs: **≤300 lines**, absolute max 500
- CLAUDE.md files: **≤150 lines**

Enforced by `doc-structure.test.ts`. Check with `npm test tests/integration/doc-structure.test.ts`.

---

## Vault — Obsidian Graph Quality

- README and CHANGELOG files should use parent directory name as vault slug to avoid 60+ identical "readme" nodes
- Relative markdown links `[text](../file.md)` become ghost nodes in Obsidian graph — strip to plain text with `stripRelativeFileLinks()`
- MOC entries need `aliases: [slug]` in YAML frontmatter so `[[slug]]` wikilinks resolve correctly
- Sub-project files need sub-project prefix in slug to avoid collisions with parent project files sharing same basename

---

## Version Intelligence — manifest_key y coupled_versions

- `MonitorUrl.manifest_key` es el campo explícito que vincula una URL upstream a una clave en `versions-manifest.json`. Sin él, `checkVersionDrift` usa heurística URL-substring que falla para slugs ambiguos (`kotlin` vs `kotlinx-coroutines`).
- **Regla**: nuevas entradas en `monitor_urls` de frontmatter DEBEN tener `manifest_key` si son de tipo `github-releases` o `maven-central`. Solo las `doc-page` pueden omitirlo.
- **`versions-manifest.json` es la source of truth**: tiene sus propios `monitor_urls` canónicos para Kotlin, KSP, AGP, Compose, Coroutines, Kover. Los docs NO necesitan duplicar esas URLs — solo añadir `monitor_urls` para páginas de contenido que ellos monitorean específicamente.
- **`coupled_versions`**: expresa dependencias entre versiones. `{ "ksp": ["kotlin"] }` significa que cuando Kotlin bumpa, KSP debe revisarse. `resolveCoupledVersions(key, manifest)` devuelve los keys acoplados. Siempre actualizar `ksp` cuando se actualiza `kotlin`.
- **`check-version-sync --from-manifest`**: modo para comparar `libs.versions.toml` de cualquier proyecto L1/L2 contra `versions-manifest.json` directamente. No requiere otro proyecto como fuente de verdad.
- **Hub docs con `monitor_urls` largos**: si añadir `monitor_urls` a un hub doc lo lleva por encima de 100 líneas, mover las URLs de versiones al `versions-manifest.json` (que tiene sus propios `monitor_urls`) y dejar solo las `doc-page` en el frontmatter del doc.

---

## Detekt 2.0 + KMP — Per-Module Plugin Requirement

The `androidcommondoc.toolkit` plugin must be applied to **each module individually**, not just the root project. Detekt 2.0 creates per-source-set tasks (`detektCommonMainSourceSet`, `detektDesktopMainSourceSet`, etc.) only in modules where the plugin is applied.

**Symptom**: Only pure-JVM modules (e.g. `core-error-audit`, `core-result`) show Detekt tasks. KMP modules report `NO-SOURCE` or have zero Detekt tasks.

**Root cause**: The plugin is only applied to modules that declare `id("androidcommondoc.toolkit")` in their `build.gradle.kts`. KMP modules without this declaration get no Detekt integration.

**Fix**: Apply via a project-level convention plugin or `subprojects { apply(plugin = "androidcommondoc.toolkit") }`.

**Not a Detekt 2.0 bug** — the per-source-set integration works correctly when the plugin is present. The `afterEvaluate + tasks.withType(Detekt).configureEach` pattern in the toolkit plugin handles config propagation to all KMP source-set tasks.

---

## README Counts — Always Verified by Hook

Three pre-commit hooks fire on every `git commit`:
1. `detekt-pre-commit.sh` — Detekt pattern violations on staged .kt files
2. `registry-pre-commit.sh` — Rehashes registry.json if skills/agents/commands changed
3. `readme-pre-commit.sh` — **Blocks commit if README counts are stale** (skills, agents, rules, MCP tools, workflows, registry, commands)

**Never commit without updating README counts.** The hook will deny the commit with a message listing which counts are wrong. Run `/readme-audit --fix` to repair.

This exists because README count drift was a recurring issue — CI caught it too late.

---

## README Test Counts — Informational Only

Bats and MCP test counts in README are approximate and NOT validated by CI. They vary by platform (Windows CRLF, Linux LF, test skips, timeouts). CI on Ubuntu may get different counts than local Windows.

Only **static filesystem counts** are CI-validated: skills, agents, rules, MCP tools, workflows, registry entries, commands.

When updating README test counts, use the local count as the canonical value. Don't chase CI count differences — they're environmental.
