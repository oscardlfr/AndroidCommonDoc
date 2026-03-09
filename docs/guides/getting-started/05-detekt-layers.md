---
title: "Step 5 — Configure Detekt per layer / Paso 5 — Configurar Detekt por capas"
slug: getting-started-detekt-layers
category: guides
description: >
  Wire detekt-l0-base.yml as the baseline and create a project-level
  detekt.yml for L1/L2 overrides. / Conectar detekt-l0-base.yml como
  baseline y crear detekt.yml de proyecto para overrides L1/L2.
last_updated: "2026-03-18"
---

# Step 5 — Configure Detekt per layer

---

## English

AndroidCommonDoc uses a two-file Detekt config hierarchy:

| File | Owner | Purpose |
|------|-------|---------|
| `detekt-l0-base.yml` | L0 (this repo) | All 13 rules `active: true` — never edit |
| `detekt.yml` | Your project | Override only what differs from the baseline |

Detekt's `CompositeConfig` merges them: **the last file wins per leaf key**.
If a rule is absent from your `detekt.yml` it inherits `active: true` from the baseline.

### Option A — Convention plugin (easiest)

`setup-toolkit.sh` already inserted `id("androidcommondoc.toolkit")` in your
modules. This plugin wires the baseline automatically; you only need to create
`detekt.yml` at the project root for project-specific overrides.

### Option B — Manual Gradle config

```kotlin
// build.gradle.kts
val androidCommonDocPath: String by rootProject.extra

detekt {
  config.from(
    resources.text.fromFile(
      "$androidCommonDocPath/detekt-rules/src/main/resources/config/detekt-l0-base.yml"
    ),
    file("${rootDir}/detekt.yml")   // project overrides — may be empty
  )
}
```

Define the extra property in `gradle.properties` or `settings.gradle.kts`:
```
# gradle.properties
androidCommonDocPath=../AndroidCommonDoc
```

### Project-level `detekt.yml` (L1 or L2 override)

Only declare what you need to change. Everything else inherits `active: true`.

```yaml
# detekt.yml — project overrides
# The L0 baseline has all rules active: true.
# Only put here what differs.

AndroidCommonDoc:
  NoMagicNumbersInUseCase:
    active: false   # domain constants defined inline by convention here

  NoHardcodedStringsInViewModel:
    active: false   # project uses a custom localisation system
```

To disable the entire ruleset:
```yaml
AndroidCommonDoc:
  active: false
```

### Verify rules are active

```bash
./gradlew detekt 2>&1 | grep "AndroidCommonDoc"
# Should print rule names for any violations found
```

For the full 13-rule catalogue and rationale see [detekt-config.md](../detekt-config.md).

---

## Castellano

AndroidCommonDoc usa una jerarquía de dos ficheros de configuración Detekt:

| Fichero | Propietario | Propósito |
|---------|-------------|-----------|
| `detekt-l0-base.yml` | L0 (este repo) | Las 13 reglas `active: true` — no editar |
| `detekt.yml` | Tu proyecto | Solo lo que difiere del baseline |

`CompositeConfig` de Detekt las fusiona: **el último fichero gana por clave hoja**.
Si una regla no aparece en tu `detekt.yml` hereda `active: true` del baseline.

### Opción A — Plugin de convención (más sencillo)

`setup-toolkit.sh` ya insertó `id("androidcommondoc.toolkit")` en tus módulos.
Este plugin conecta el baseline automáticamente; solo necesitas crear `detekt.yml`
en la raíz del proyecto para overrides específicos.

### Opción B — Configuración manual de Gradle

```kotlin
// build.gradle.kts
val androidCommonDocPath: String by rootProject.extra

detekt {
  config.from(
    resources.text.fromFile(
      "$androidCommonDocPath/detekt-rules/src/main/resources/config/detekt-l0-base.yml"
    ),
    file("${rootDir}/detekt.yml")   // overrides del proyecto — puede estar vacío
  )
}
```

Define la propiedad extra en `gradle.properties` o `settings.gradle.kts`:
```
# gradle.properties
androidCommonDocPath=../AndroidCommonDoc
```

### `detekt.yml` de proyecto (override L1 o L2)

Solo declara lo que necesitas cambiar. Todo lo demás hereda `active: true`.

```yaml
# detekt.yml — overrides del proyecto
# El baseline L0 tiene todas las reglas active: true.
# Solo pon aquí lo que difiere.

AndroidCommonDoc:
  NoMagicNumbersInUseCase:
    active: false   # las constantes de dominio se definen inline por convención

  NoHardcodedStringsInViewModel:
    active: false   # el proyecto usa un sistema de localización propio
```

Para deshabilitar todo el ruleset:
```yaml
AndroidCommonDoc:
  active: false
```

### Verificar que las reglas están activas

```bash
./gradlew detekt 2>&1 | grep "AndroidCommonDoc"
# Debe imprimir nombres de regla para cualquier violación encontrada
```

Para el catálogo completo de las 13 reglas y su justificación ver
[detekt-config.md](../detekt-config.md).

---

→ Next / Siguiente: [Step 6 — MCP server](06-mcp-server.md)
