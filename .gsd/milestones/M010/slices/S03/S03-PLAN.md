# S03: auto-bump en /monitor-docs

## Goal

Cuando el agente acepta un finding de version-drift en `/monitor-docs`, el skill ejecuta `bumpManifestVersion()` directamente — sin que el usuario tenga que editar `versions-manifest.json` a mano. Genera commit message convencional listo para aprobar. Si la versión tiene `coupled_versions`, propone el bump de todas las entradas acopladas en el mismo commit.

## Context

- `skills/monitor-docs/SKILL.md`: paso "Accept" actualmente dice "update pattern doc and versions manifest" — es manual
- No existe función de bump programático en el MCP server
- `coupled_versions` de S02 da la información para propagar

## Tasks

- [ ] **T01: `bumpManifestVersion(key, newVersion, manifestPath)` en MCP server** `est:45m`
- [ ] **T02: `resolveCoupledVersions(key, manifest)` — devuelve entradas acopladas pendientes** `est:30m`
- [ ] **T03: Actualizar `skills/monitor-docs/SKILL.md` — paso Accept con auto-bump** `est:30m`
- [ ] **T04: Tests para `bumpManifestVersion` + `resolveCoupledVersions`** `est:30m`

## Acceptance

- `bumpManifestVersion("kotlin", "2.3.20", path)` actualiza `versions.kotlin` + `profiles.*.kotlin` en una sola operación
- `resolveCoupledVersions("kotlin", manifest)` devuelve `["ksp"]` cuando `coupled_versions.ksp = ["kotlin"]`
- `skills/monitor-docs/SKILL.md` describe el flujo: finding → accept → auto-bump → commit message generado
- Tests vitest para ambas funciones: bump correcto, profiles actualizados, coupled detectados
