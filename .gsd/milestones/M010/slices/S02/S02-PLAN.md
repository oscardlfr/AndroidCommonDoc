# S02: versions-manifest como source of truth autónoma

## Goal

`versions-manifest.json` pasa de ser un fichero de datos pasivo a ser el **nodo central** del sistema de monitoreo. Tiene sus propias `monitor_urls` (no necesita depender de que cada doc lo tenga), `coupled_versions` para expresar que KSP se mueve con Kotlin, y `ksp` como entrada nueva. `check-version-sync` gana modo `--from-manifest` para comparar cualquier `libs.versions.toml` contra él directamente.

## Context

- `versions-manifest.json` actual: solo `versions`, `profiles`, `version_notes`, `wildcard_note`
- `check-version-sync.sh`: lee dos `libs.versions.toml`, no conoce el manifest
- `detectChanges()` en `change-detector.ts`: recibe entries del registry — no tiene acceso directo al manifest como fuente de URLs a monitorear
- KSP no está en el manifest; su versión es acoplada a Kotlin (formato `<kotlin>-<ksp>`)

## Tasks

- [ ] **T01: Extender schema de `versions-manifest.json`** `est:30m`
- [ ] **T02: Poblar `monitor_urls` canónicos en el manifest** `est:20m`
- [ ] **T03: `detectChanges` puede consumir manifest como fuente adicional de URLs** `est:60m`
- [ ] **T04: `check-version-sync --from-manifest` mode** `est:90m`
- [ ] **T05: bats tests para `--from-manifest` + `parse_version_catalog`** `est:60m`

## Schema resultante

```json
{
  "monitor_urls": [
    { "url": "https://github.com/JetBrains/kotlin/releases", "type": "github-releases", "manifest_key": "kotlin", "tier": 1 },
    { "url": "https://github.com/google/ksp/releases",       "type": "github-releases", "manifest_key": "ksp",    "tier": 1 },
    { "url": "https://maven.google.com/...",                  "type": "maven-central",   "manifest_key": "agp",    "tier": 1 }
  ],
  "coupled_versions": {
    "ksp": ["kotlin"]
  },
  "versions": { "kotlin": "2.3.20", "ksp": "2.3.20-2.0.1", ... }
}
```

## Acceptance

- `versions-manifest.json` válido según JSON Schema (si existe) + `npm test` verde
- `detectChanges` con manifest como fuente produce findings para Kotlin cuando upstream > manifest
- `check-version-sync --from-manifest ../MyProject` devuelve tabla de drift correcta en formato human y json
- bats: `parse_version_catalog` + `--from-manifest` mode con fixtures TOML reales
- Cuando Kotlin bumpa, el finding de KSP aparece como "coupled — revisar" automáticamente
