# M010: Version Intelligence — Monitoreo Fiable de Dependencias

**Vision:** El sistema detecta automáticamente que Kotlin 2.3.20 ha salido, lo cruza contra el manifest L0, y cualquier proyecto L1/L2 puede comparar su `libs.versions.toml` contra esa source of truth en un comando. Cero trabajo manual para saber si estás desactualizado.

## Success Criteria

- `/monitor-docs` detecta drift de Kotlin/AGP/KSP sin heurística URL — usa `manifest_key` explícito
- `check-version-sync --from-manifest` compara `libs.versions.toml` de cualquier proyecto contra `versions-manifest.json` directamente
- KSP está registrado con `coupled_versions: [kotlin]` — un update de Kotlin muestra KSP como pendiente automáticamente
- `versions-manifest.json` tiene `monitor_urls` canónicos propios — es el único fichero que hay que actualizar, no los frontmatters de los docs
- Cuando `/monitor-docs` acepta un finding, `versions-manifest.json` se auto-bumpa y genera commit message listo para aprobar
- `npm test` 653/653 verde tras todos los cambios

## Key Risks / Unknowns

- `manifest_key` en `MonitorUrl` requiere cambio de tipo + parser + lógica de comparación — si el parser de frontmatter no recoge el campo, todo lo demás es inerte
- `checkVersionDrift` actual usa URL-matching frágil — el refactor puede romper findings existentes si no hay tests específicos para los casos de matching
- `check-version-sync` tiene un parser TOML propio (bash, 409 líneas) — añadir modo `--from-manifest` sin romper el modo existente requiere cuidado

## Proof Strategy

- `manifest_key` frágil → retire en S01: test de integración que pasa una entrada con `manifest_key: kotlin` y verifica que el finding usa esa clave, no la heurística
- URL-matching roto → retire en S01: fixture de URLs GitHub con slugs ambiguos (kotlinx-coroutines vs kotlin) que antes matcheaban mal
- TOML parser sin tests → retire en S02: bats tests para `parse_version_catalog()` con TOML real

## Verification Classes

- Contract: vitest unitarios para `MonitorUrl` con `manifest_key`, `checkVersionDrift` con clave explícita, `VersionsManifest` con `monitor_urls` + `coupled_versions`
- Integration: `monitor-sources` CLI con `versions-manifest.json` real devuelve findings correctos para Kotlin 2.3.10 → 2.3.20
- Shell: bats tests para `check-version-sync.sh --from-manifest` + `parse_version_catalog()`
- UAT: ejecutar `/monitor-docs` en un proyecto L2 con Kotlin 2.3.10 y ver finding MEDIUM generado

## Milestone Definition of Done

- `MonitorUrl.manifest_key` tipado, parseado, y usado en `checkVersionDrift`
- `versions-manifest.json` tiene `monitor_urls` propios + `coupled_versions` + `ksp`
- `check-version-sync --from-manifest <project>` funciona end-to-end
- Auto-bump en skill `/monitor-docs` al aceptar finding
- `npm test` 653/653 + bats 94+N/94+N verde
- README actualizado
- Commit firmado en master

## Requirement Coverage

- Covers: fiabilidad del sistema de monitoreo (no hay R activo — este milestone lo crea)
- Leaves for later: monitoreo de librerías de terceros (Koin, MockK) — out of scope M010

## Slices

- [ ] **S01: manifest_key + checkVersionDrift refactor** `risk:high` `depends:[]`
  > After this: `monitor-sources` CLI detecta Kotlin 2.3.20 usando `manifest_key` explícito — verificable con `npm test` + fixture test con `manifest_key: kotlin`

- [ ] **S02: versions-manifest como source of truth autónoma** `risk:medium` `depends:[S01]`
  > After this: `versions-manifest.json` tiene `monitor_urls` propios + `coupled_versions` + `ksp`; `check-version-sync --from-manifest` funciona; bats tests verdes para el modo nuevo

- [ ] **S03: auto-bump en /monitor-docs** `risk:medium` `depends:[S02]`
  > After this: `/monitor-docs` acepta finding → bumpa `versions-manifest.json` + genera commit message convencional listo para aprobar

- [ ] **S04: cierre, README, bats coverage** `risk:low` `depends:[S01,S02,S03]`
  > After this: `npm test` 653/653, bats ≥110/N, README refleja el nuevo sistema, commit en master

## Boundary Map

### S01 → S02

Produces:
- `MonitorUrl.manifest_key?: string` — campo opcional en tipo + parseado en frontmatter scanner
- `checkVersionDrift(slug, result, versions, manifestKey?)` — usa `manifestKey` cuando presente, fallback a heurística cuando ausente
- Vitest fixtures: `manifest_key` en frontmatter YAML → `MonitorUrl.manifest_key` presente en registry entry

Consumes:
- nothing (primer slice)

### S01 → S03

Produces:
- `VersionsManifest` con shape estable que S03 puede leer/escribir

Consumes:
- nothing

### S02 → S03

Produces:
- `versions-manifest.json` con `monitor_urls[]` canónicos en raíz
- `versions-manifest.json` con `coupled_versions: Record<string, string[]>`
- `check-version-sync --from-manifest` CLI contract estable

Consumes:
- `MonitorUrl.manifest_key` de S01

### S03 → S04

Produces:
- `skills/monitor-docs/SKILL.md` actualizado con paso de auto-bump
- Función `bumpManifestVersion(key, newVersion, manifestPath)` en MCP server

Consumes:
- `versions-manifest.json` shape de S02
- `checkVersionDrift` de S01
