---
title: "Detekt Baseline Reduction Playbook / Guía de reducción gradual de baseline"
slug: baseline-reduction
category: guides
scope: [guides, detekt, baseline]
sources: [androidcommondoc]
targets: [all]
description: >
  Step-by-step playbook for progressively eliminating Detekt baseline suppressions
  in legacy Android/KMP projects. / Guía paso a paso para eliminar progresivamente
  las supresiones del baseline de Detekt en proyectos Android/KMP heredados.
last_updated: "2026-03-18"
status: active
layer: L0
---

# Detekt Baseline Reduction Playbook

---

## English

After running `./gradlew detektBaseline`, existing violations are suppressed so only
_new_ issues block the build. That's the right starting point — but the baseline
shouldn't stay at 304 suppressions forever.

This playbook gives you a repeatable process to reduce it to zero over time.

### Step 1 — Understand what you have

```bash
# Count violations per rule across all modules
./gradlew detekt --continue 2>&1 \
  | grep -E "^\s+\w+\.kt:[0-9]+:[0-9]+: warning:" \
  | grep -oE "\[.+\]$" \
  | sort | uniq -c | sort -rn

# Count total baseline suppressions
grep -c "<ID>" detekt-baseline.xml 2>/dev/null \
  || find . -name "detekt-baseline.xml" -exec grep -c "<ID>" {} \; 2>/dev/null
```

Typical distribution in a legacy project:

| Rule | Typical count | Fix effort |
|------|--------------|-----------|
| `KtlintStandardTrailingCommaOnCallSite` | 120–200 | **Auto-fix** |
| `KtlintStandardTrailingCommaOnDeclarationSite` | 40–80 | **Auto-fix** |
| `KtlintStandardFinalNewline` | 20–40 | **Auto-fix** |
| `WildcardImport` | 10–30 | Manual (5 min/file) |
| `NoSilentCatchRule` | 5–15 | Manual (needs judgment) |
| `MutableStateFlowExposedRule` | 2–8 | Manual (refactor) |
| `NoHardcodedDispatchersRule` | 1–5 | Manual (inject dispatcher) |

### Step 2 — Quick wins (auto-fixable, ≤30 min)

These three ktlint rules generate the most baseline entries and can be fixed
automatically with `ktlint --format`:

```bash
# Install ktlint CLI (or use the Gradle wrapper)
brew install ktlint                      # macOS
# Windows: scoop install ktlint

# Auto-fix trailing commas and final newlines across the whole project
ktlint --format "**/*.kt"

# Verify no regressions
./gradlew :core:domain:detekt           # spot-check a module

# Regenerate baseline (removes all auto-fixed entries)
./gradlew detektBaseline
```

> **Tip**: Commit the auto-fix as a separate commit with message
> `style: auto-fix ktlint trailing commas and newlines`
> Keep it separate from logic changes to keep history clean.

### Step 3 — Manual prioritization (WildcardImports)

`WildcardImport` is the next highest-count rule. Fix one module at a time:

```bash
# Find all wildcard imports in a module
grep -rn "import .*\*" core/domain/src --include="*.kt"

# In each file: expand the wildcard. Most IDEs can do this automatically:
# IntelliJ/Android Studio: Code → Optimize Imports
```

After fixing a module:
```bash
./gradlew :core:domain:detektBaseline   # update baseline for that module only
```

### Step 4 — Architecture violations (require judgment)

These rules catch real bugs and architecture drift. Do **not** suppress them
permanently — fix the root cause.

#### `NoSilentCatchRule`

```kotlin
// ❌ Suppressed in baseline — fix it
catch (e: Exception) {
    // empty or just log
}

// ✅ Either rethrow, handle specifically, or document why swallowing is safe
catch (e: IOException) {
    logger.warn("Cache miss — falling back to network", e)
} catch (e: CancellationException) {
    throw e  // always rethrow
}
```

#### `MutableStateFlowExposedRule`

```kotlin
// ❌ Exposes mutable state
class MyViewModel : ViewModel() {
    val uiState = MutableStateFlow(UiState.Loading)
}

// ✅ Backing property pattern
class MyViewModel : ViewModel() {
    private val _uiState = MutableStateFlow(UiState.Loading)
    val uiState: StateFlow<UiState> = _uiState.asStateFlow()
}
```

#### `NoHardcodedDispatchersRule`

```kotlin
// ❌ Hardcoded dispatcher
viewModelScope.launch(Dispatchers.IO) { ... }

// ✅ Injected dispatcher
class MyViewModel(private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO)
    : ViewModel() {
    fun load() = viewModelScope.launch(ioDispatcher) { ... }
}
```

### Step 5 — Track progress

```bash
# After each module is clean, check total baseline count
find . -name "detekt-baseline.xml" \
  | xargs grep -c "<ID>" 2>/dev/null \
  | awk -F: 'NR==1{sum=$2} NR>1{sum+=$2} END{print "Total suppressions:", sum}'
```

Suggested targets:

| Week | Goal |
|------|------|
| Week 1 | Auto-fix ktlint (`-50%` typical) |
| Week 2–3 | Fix WildcardImports module by module (`-20%`) |
| Week 4+ | Address architecture violations one rule at a time (`-30%`) |

### CI enforcement (progressive)

Once a rule is clean in all modules, disable its baseline entry by adding an
explicit `active: false` override in `detekt.yml` with a TODO comment:

```yaml
# detekt.yml
KtlintWrapper:
  KtlintStandardTrailingCommaOnCallSite:
    active: true   # ✅ clean — all baseline entries removed 2026-03-20
```

---

## Castellano

Tras ejecutar `./gradlew detektBaseline`, las violaciones existentes quedan suprimidas
para que solo los _nuevos_ issues bloqueen el build. Ese es el punto de partida
correcto — pero el baseline no debería quedarse con 304 supresiones para siempre.

Esta guía ofrece un proceso repetible para reducirlo a cero.

### Paso 1 — Entender qué tienes

```bash
# Contar violaciones por regla en todos los módulos
./gradlew detekt --continue 2>&1 \
  | grep -E "^\s+\w+\.kt:[0-9]+:[0-9]+: warning:" \
  | grep -oE "\[.+\]$" \
  | sort | uniq -c | sort -rn

# Contar total de supresiones en el baseline
grep -c "<ID>" detekt-baseline.xml 2>/dev/null \
  || find . -name "detekt-baseline.xml" -exec grep -c "<ID>" {} \; 2>/dev/null
```

Distribución típica en un proyecto legacy:

| Regla | Cantidad típica | Esfuerzo |
|-------|----------------|---------|
| `KtlintStandardTrailingCommaOnCallSite` | 120–200 | **Auto-fix** |
| `KtlintStandardTrailingCommaOnDeclarationSite` | 40–80 | **Auto-fix** |
| `KtlintStandardFinalNewline` | 20–40 | **Auto-fix** |
| `WildcardImport` | 10–30 | Manual (5 min/fichero) |
| `NoSilentCatchRule` | 5–15 | Manual (requiere criterio) |
| `MutableStateFlowExposedRule` | 2–8 | Manual (refactor) |
| `NoHardcodedDispatchersRule` | 1–5 | Manual (inyectar dispatcher) |

### Paso 2 — Victorias rápidas (auto-corregibles, ≤30 min)

Las tres reglas de ktlint que generan más entradas en el baseline se pueden
corregir automáticamente con `ktlint --format`:

```bash
# Instalar ktlint CLI
brew install ktlint                      # macOS
# Windows: scoop install ktlint

# Auto-corregir trailing commas y newlines finales en todo el proyecto
ktlint --format "**/*.kt"

# Verificar sin regresiones
./gradlew :core:domain:detekt

# Regenerar baseline (elimina todas las entradas auto-corregidas)
./gradlew detektBaseline
```

> **Consejo**: Haz commit del auto-fix por separado con mensaje
> `style: auto-fix ktlint trailing commas and newlines`
> Mantenerlo separado de cambios de lógica facilita la revisión del historial.

### Paso 3 — Priorización manual (WildcardImports)

`WildcardImport` suele ser la siguiente regla con más violaciones. Trabaja módulo a módulo:

```bash
# Encontrar todos los imports wildcard en un módulo
grep -rn "import .*\*" core/domain/src --include="*.kt"

# En cada fichero: expandir el wildcard.
# IntelliJ/Android Studio: Code → Optimize Imports
```

Tras limpiar un módulo:
```bash
./gradlew :core:domain:detektBaseline   # actualiza el baseline solo de ese módulo
```

### Paso 4 — Violaciones de arquitectura (requieren criterio)

Estas reglas detectan bugs reales y desviaciones de arquitectura. **No las suprimas**
indefinidamente — corrige la causa raíz.

Ver los ejemplos de código en la sección English — los patrones son idénticos.

### Paso 5 — Seguimiento del progreso

```bash
find . -name "detekt-baseline.xml" \
  | xargs grep -c "<ID>" 2>/dev/null \
  | awk -F: 'NR==1{sum=$2} NR>1{sum+=$2} END{print "Total supresiones:", sum}'
```

Objetivos sugeridos:

| Semana | Objetivo |
|--------|---------|
| Semana 1 | Auto-fix ktlint (`-50%` típico) |
| Semana 2–3 | WildcardImports módulo a módulo (`-20%`) |
| Semana 4+ | Violaciones de arquitectura, una regla por vez (`-30%`) |
