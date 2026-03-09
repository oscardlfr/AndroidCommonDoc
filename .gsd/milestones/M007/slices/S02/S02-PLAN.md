# S02: New hand-written rules — hardcoding, state exposure, coroutine safety

**Goal:** Implementar 8 reglas hand-written nuevas que cubren los gaps más importantes: hardcoding de strings/números, exposición de MutableStateFlow, anti-patrones de corrutinas (runCatching, launch en init, silent catch), y Dispatchers hardcodeados. Cada regla tiene test compañero con casos válidos e inválidos.

**Demo:** `./gradlew :detekt-rules:test` pasa con 8 nuevas test classes. El provider registra todas las reglas nuevas. `detekt-l0-base.yml` contiene las 13 reglas totales.

## Must-Haves

- `NoHardcodedStringsInViewModelRule` — detecta string literals en ViewModel (excl. empty, log tags)
- `NoMagicNumbersInUseCaseRule` — detecta Int/Long literals > 1 en UseCase (excl. 0, 1, -1)
- `MutableStateFlowExposedRule` — detecta `val _x = MutableStateFlow` sin backing `val x: StateFlow`  
- `NoRunCatchingInCoroutineScopeRule` — detecta `runCatching` en clases que extienden ViewModel
- `NoHardcodedDispatchersRule` — detecta `Dispatchers.Main/IO/Default` hardcodeados en ViewModel/UseCase
- `NoLaunchInInitRule` — detecta `launch {` dentro de `init {}` en cualquier clase
- `NoSilentCatchRule` — detecta `catch(e: Exception)` o `catch(e: Throwable)` sin throw/rethrow
- `NoChannelForNavigationRule` — detecta `Channel` en ViewModels donde se usa para navegación

## Verification

- `./gradlew :detekt-rules:test` — BUILD SUCCESSFUL, todos los tests pasan
- Cada regla tiene al menos 2 tests: `reports violating code` + `accepts compliant code`
- `AndroidCommonDocRuleSetProvider.kt` registra las 8 reglas nuevas

## Tasks

- [ ] **T01: NoHardcodedStringsInViewModel + NoMagicNumbersInUseCase** `est:60min`
- [ ] **T02: MutableStateFlowExposed + NoRunCatchingInCoroutineScope** `est:45min`
- [ ] **T03: NoHardcodedDispatchers + NoLaunchInInit** `est:45min`
- [ ] **T04: NoSilentCatch + NoChannelForNavigation** `est:45min`
- [ ] **T05: Registrar reglas en provider + actualizar detekt-l0-base.yml + test suite completo** `est:30min`
