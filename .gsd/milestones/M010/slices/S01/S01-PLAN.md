# S01: manifest_key + checkVersionDrift refactor

## Goal

Eliminar la heurística URL-matching de `checkVersionDrift`. Añadir `manifest_key` como campo explícito en `MonitorUrl` — parseado desde frontmatter YAML, propagado por el registry, consumido en `change-detector.ts`. Con `manifest_key` presente, el drift se detecta con certeza; sin él, se mantiene el fallback para no romper los 69 docs existentes.

## Context

- `MonitorUrl` en `types.ts`: no tiene `manifest_key`
- `checkVersionDrift` en `change-detector.ts`: usa `url.includes(key)` normalizado — falla para `kotlin` vs `kotlinx-coroutines`
- Frontmatter parser en `registry/scanner.ts` o similar: no recoge campos extras de `monitor_urls`
- 5 docs ya tienen `manifest_key:` en su YAML (añadidos en turno anterior) — están esperando soporte

## Tasks

- [ ] **T01: Añadir `manifest_key` a `MonitorUrl` + tests** `est:45m`
- [ ] **T02: Actualizar frontmatter parser para recoger `manifest_key`** `est:30m`
- [ ] **T03: Refactorizar `checkVersionDrift` para usar `manifest_key` cuando presente** `est:45m`
- [ ] **T04: Fixtures de regresión — slugs ambiguos** `est:30m`

## Acceptance

- `npm test` verde — sin regresiones en 653 tests existentes
- Nuevo test: frontmatter con `manifest_key: kotlin` → `MonitorUrl.manifest_key === "kotlin"`
- Nuevo test: `checkVersionDrift` con `manifest_key: kotlin` matchea solo `"kotlin"` en versions, no `"kotlinx-coroutines"`
- Nuevo test: `checkVersionDrift` sin `manifest_key` sigue funcionando con heurística (backward compat)
