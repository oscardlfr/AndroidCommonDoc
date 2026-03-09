# M007: Detekt Rule Expansion & L0/L1 Config Flexibility

**Vision:** Ampliar el ruleset de AndroidCommonDoc con reglas de alta utilidad que cubran hardcoding, exposición de estado mutable y anti-patrones de corrutinas, y dotar al sistema de un modelo de configuración jerárquico que permita a proyectos L1 corporativos heredar todas las reglas L0 por defecto y overridear solo lo que no les aplica.

## Success Criteria

- Un `detekt-l0-base.yml` distribuido por AndroidCommonDoc contiene todas las reglas con `active: true` como baseline
- Un proyecto L1 puede desactivar una regla L0 individual añadiendo `active: false` en su propio `detekt.yml` sin tocar el baseline
- El `config-emitter.ts` genera el `detekt-l0-base.yml` automáticamente desde frontmatter — no hay config escrita a mano
- 10+ reglas nuevas hand-written implementadas, testadas y registradas en el provider
- Cada regla nueva tiene frontmatter `rules:` en el doc de patrón correspondiente
- `./gradlew :detekt-rules:test` pasa al 100%
- El skill `generate-rules` documenta el modelo de herencia L0/L1

## Key Risks / Unknowns

- Detekt config merging — verificar que `--config base.yml,override.yml` realmente hace override atómico por regla (no merge de mapas) — si no funciona así, necesitamos otro mecanismo
- Reglas sobre hardcoding de strings/números requieren distinguir constantes legítimas de valores mágicos — la heurística AST tiene falsos positivos potenciales
- `NoRunCatchingInViewModel` puede colisionar con uso legítimo de `runCatching` fuera de ViewModels — el scope check es crítico

## Proof Strategy

- Config merging → retirar en S01 probando con un proyecto de test mínimo que override una regla
- Heurística hardcoding → retirar en S02 probando los test cases límite (constantes named, companion object vals)
- `runCatching` scope → retirar en S02 con tests que cubren both ViewModel y non-ViewModel

## Verification Classes

- Contract verification: `./gradlew :detekt-rules:test` — todos los tests de reglas pasan
- Integration verification: `npm test` en `mcp-server/` — config-emitter genera YAML correcto con nuevas reglas
- Operational verification: ninguno
- UAT / human verification: probar `detekt --config detekt-l0-base.yml,my-override.yml` en proyecto real

## Milestone Definition of Done

- S01, S02, S03 completos
- `./gradlew :detekt-rules:test` 100% verde
- `npm test` en mcp-server 100% verde
- `detekt-l0-base.yml` existe y contiene todas las reglas
- Documentación de herencia L0/L1 en `docs/guides/detekt-config.md`
- `generate-rules` SKILL.md actualizado con referencia al modelo jerárquico
- Todas las reglas nuevas tienen `hand_written: true` + `source_rule:` en frontmatter

## Requirement Coverage

- Covers: flexibilidad configuración Detekt L0/L1, expansión ruleset
- Leaves for later: reglas que requieren type resolution (ResultTypeRequired), reglas sobre ficheros no-Kotlin (flat-module-names, compose-resources-in-common-main)

## Slices

- [x] **S01: Config hierarchy — detekt-l0-base.yml + L1 override model** `risk:high` `depends:[]`
  > After this: existe `detekt-l0-base.yml` generado automáticamente, el config-emitter lo produce, y un test de integración prueba que un L1 puede desactivar una regla individual via override.

- [x] **S02: New hand-written rules — hardcoding, state exposure, coroutine safety** `risk:medium` `depends:[S01]`
  > After this: 8-10 reglas nuevas implementadas (NoHardcodedStrings, MutableStateFlowExposed, NoRunCatching, NoDispatchersHardcoded, NoContextInViewModel, UseResultType, NoLaunchInInit, NoSilentCatch), todas con tests pasando y registradas en el provider.

- [x] **S03: Frontmatter + docs wiring + generate-rules skill update** `risk:low` `depends:[S02]`
  > After this: cada regla nueva tiene `rules:` en el doc de patrón correspondiente con `hand_written: true`, `generate-rules` SKILL.md documenta el modelo jerárquico, y `docs/guides/detekt-config.md` explica el sistema completo.

## Boundary Map

### S01 → S02

Produces:
- `detekt-rules/src/main/resources/config/detekt-l0-base.yml` — config baseline con todas las reglas activas
- `mcp-server/src/generation/config-emitter.ts` — método `emitBaselineConfig()` que escribe el fichero
- Documentado: cómo Detekt merges múltiples configs (`--config a.yml,b.yml`)

Consumes:
- nothing (first slice)

### S02 → S03

Produces:
- 8-10 ficheros `.kt` nuevos en `detekt-rules/src/main/kotlin/.../rules/`
- Tests compañeros en `detekt-rules/src/test/kotlin/.../rules/`
- `AndroidCommonDocRuleSetProvider.kt` actualizado con todas las nuevas reglas

Consumes:
- `detekt-l0-base.yml` de S01 (para añadir las reglas nuevas al baseline)
