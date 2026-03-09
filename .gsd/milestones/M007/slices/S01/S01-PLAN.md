# S01: Config hierarchy — detekt-l0-base.yml + L1 override model

**Goal:** Establecer el modelo de configuración jerárquico: `detekt-l0-base.yml` como baseline distribuido por AndroidCommonDoc con todas las reglas `active: true`, documentado el mecanismo de override L1, y el `config-emitter.ts` actualizado para generarlo automáticamente.

**Demo:** `npm test` en mcp-server pasa con un test que verifica que `emitBaselineConfig()` produce YAML con todas las reglas activas. Un fichero `detekt-l0-base.yml` existe en `detekt-rules/src/main/resources/config/` y el `config.yml` existente se convierte en un ejemplo de override L1.

## Must-Haves

- Verificar comportamiento real de Detekt con `--config base.yml,override.yml` (merge vs replace por clave)
- `detekt-l0-base.yml` generado con todas las reglas del provider en `active: true`
- `config-emitter.ts` tiene `emitBaselineConfig()` separado de `emitFullConfig()`
- El `config.yml` existente se renombra/refactoriza como `detekt-l1-example.yml` con comentarios explicativos
- Test unitario en mcp-server que cubre el output de `emitBaselineConfig()`
- Comentario de cabecera en `detekt-l0-base.yml` explicando que es el baseline y cómo overridearlo

## Verification

- `npm test` en `mcp-server/` — tests de `config-emitter` pasan incluyendo el nuevo caso `emitBaselineConfig`
- `./gradlew :detekt-rules:test` — sin regresiones
- El fichero `detekt-l0-base.yml` existe y tiene formato YAML válido con todas las reglas del provider

## Tasks

- [ ] **T01: Investigar Detekt config merging y diseñar estructura de ficheros** `est:30min`
- [ ] **T02: Actualizar config-emitter.ts — añadir emitBaselineConfig()** `est:45min`
- [ ] **T03: Crear detekt-l0-base.yml y refactorizar config.yml como ejemplo L1** `est:30min`
- [ ] **T04: Tests para emitBaselineConfig + verificación final** `est:30min`
