# S04: cierre, README, bats coverage

## Goal

Cerrar M010 limpiamente: verificación final de todos los tests, README actualizado con el nuevo sistema de monitoreo, KNOWLEDGE.md con las reglas aprendidas, STATE.md actualizado.

## Tasks

- [ ] **T01: `npm test` 653/653 + bats ≥110/N** `est:15m`
- [ ] **T02: README — sección "Version Intelligence"** `est:20m`
- [ ] **T03: KNOWLEDGE.md — reglas de `manifest_key` y `coupled_versions`** `est:10m`
- [ ] **T04: STATE.md + commit + push** `est:10m`

## Acceptance

- `npm test` verde sin regresiones
- bats cubre `--from-manifest`, `parse_version_catalog`, y los nuevos bats de S02
- README refleja: `versions-manifest.json` como hub central, `manifest_key` en frontmatter, `--from-manifest` en `check-version-sync`
- Commit en master con mensaje convencional
