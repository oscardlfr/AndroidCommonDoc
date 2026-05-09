---
title: "Step 2 — Connect a downstream project / Paso 2 — Conectar proyecto descendente"
slug: getting-started-connect-project
scope: [guides, getting-started, setup]
sources: [androidcommondoc]
targets: [android, desktop, ios, jvm]
status: active
layer: L0
parent: getting-started
category: guides
description: >
  Use setup-toolkit.sh to install the Gradle convention plugin, Claude Code
  hooks, Copilot instructions, and run the first L0 sync. / Usar
  setup-toolkit.sh para instalar el plugin de Gradle, hooks de Claude Code,
  instrucciones de Copilot y ejecutar el primer sync de L0.
last_updated: "2026-03-18"
---

# Step 2 — Connect a downstream project

---

## English

`setup-toolkit.sh` automates the full installation in one command:

1. Inserts `includeBuild` in `settings.gradle.kts` for the convention plugin
2. Applies `id("androidcommondoc.toolkit")` in Android/KMP modules
3. Runs the initial L0 skill sync (creates `l0-manifest.json` if absent)
4. Installs GitHub Copilot instructions (`.github/copilot-instructions.md`)
5. Installs Claude Code hooks (`.claude/settings.json`)

### Basic usage

```bash
bash "$ANDROID_COMMON_DOC/setup/setup-toolkit.sh" \
  --project-root /path/to/my-project
```

### All options

| Option | Description |
|--------|-------------|
| `--project-root PATH` | Consuming project root **(required)** |
| `--dry-run` | Preview changes without writing any files |
| `--force` | Overwrite existing configurations |
| `--skip-skills` | Skip L0 skill sync |
| `--skip-copilot` | Skip Copilot instructions install |
| `--skip-hooks` | Skip Claude Code hooks install |
| `--skip-gradle` | Skip Gradle modifications |
| `--mode block\|warn` | Hook severity (default: `block`) |

**Recommendation for existing projects:** use `--mode warn` on first run to
review violations before enforcing them:

```bash
bash "$ANDROID_COMMON_DOC/setup/setup-toolkit.sh" \
  --project-root /path/to/my-project --mode warn
```

Once `detekt.yml` is tuned, reinstall with `--mode block --force`.

### What each step inserts

**`settings.gradle.kts`** — relative `includeBuild` so it works on any machine:
```kotlin
includeBuild("../AndroidCommonDoc/build-logic") // AndroidCommonDoc toolkit
```

**`build.gradle.kts` (each Android/KMP module):**
```kotlin
plugins {
    id("androidcommondoc.toolkit") // activates 13 Detekt rules + coverage config
}
```

**`.claude/settings.json`** — `PostToolUse` hook that runs Detekt on every
`.kt` file write. With `block` mode Claude Code cannot continue on violations;
`warn` mode reports but does not stop.

### Partial adoption (without the script)

```bash
# Hooks only
bash "$ANDROID_COMMON_DOC/setup/install-hooks.sh" \
  --projects my-app --mode warn

# Copilot instructions only
bash "$ANDROID_COMMON_DOC/setup/install-copilot-prompts.sh" --projects my-app

# Skills sync only
cd "$ANDROID_COMMON_DOC/mcp-server"
npx tsx src/sync/sync-l0-cli.ts --project-root /path/to/my-project
```

---

## Castellano

`setup-toolkit.sh` automatiza la instalación completa en un solo comando:

1. Inserta `includeBuild` en `settings.gradle.kts` para el plugin de convención
2. Aplica `id("androidcommondoc.toolkit")` en los módulos Android/KMP
3. Ejecuta el sync inicial de habilidades L0 (crea `l0-manifest.json` si no existe)
4. Instala las instrucciones de GitHub Copilot (`.github/copilot-instructions.md`)
5. Instala los hooks de Claude Code (`.claude/settings.json`)

### Uso básico

```bash
bash "$ANDROID_COMMON_DOC/setup/setup-toolkit.sh" \
  --project-root /ruta/a/mi-proyecto
```

### Todas las opciones

| Opción | Descripción |
|--------|-------------|
| `--project-root PATH` | Raíz del proyecto consumidor **(obligatorio)** |
| `--dry-run` | Muestra qué haría sin modificar ningún fichero |
| `--force` | Sobreescribe configuraciones ya existentes |
| `--skip-skills` | Omite el sync de habilidades L0 |
| `--skip-copilot` | Omite la instalación de instrucciones de Copilot |
| `--skip-hooks` | Omite la instalación de hooks de Claude Code |
| `--skip-gradle` | Omite las modificaciones de Gradle |
| `--mode block\|warn` | Severidad del hook (defecto: `block`) |

**Recomendación para proyectos existentes:** usa `--mode warn` la primera vez
para revisar violaciones antes de bloquear:

```bash
bash "$ANDROID_COMMON_DOC/setup/setup-toolkit.sh" \
  --project-root /ruta/a/mi-proyecto --mode warn
```

Una vez ajustado `detekt.yml`, reinstala con `--mode block --force`.

### Qué inserta cada paso

**`settings.gradle.kts`** — `includeBuild` relativo, funciona en cualquier máquina:
```kotlin
includeBuild("../AndroidCommonDoc/build-logic") // AndroidCommonDoc toolkit
```

**`build.gradle.kts` (cada módulo Android/KMP):**
```kotlin
plugins {
    id("androidcommondoc.toolkit") // activa 13 reglas Detekt + configuración de cobertura
}
```

**`.claude/settings.json`** — hook `PostToolUse` que ejecuta Detekt en cada
escritura de fichero `.kt`. Con modo `block` Claude Code no puede continuar
si hay violaciones; con `warn` las reporta pero sigue.

### Adopción parcial (sin el script)

```bash
# Solo hooks
bash "$ANDROID_COMMON_DOC/setup/install-hooks.sh" \
  --projects mi-app --mode warn

# Solo instrucciones de Copilot
bash "$ANDROID_COMMON_DOC/setup/install-copilot-prompts.sh" --projects mi-app

# Solo sync de habilidades
cd "$ANDROID_COMMON_DOC/mcp-server"
npx tsx src/sync/sync-l0-cli.ts --project-root /ruta/a/mi-proyecto
```

---

→ Next / Siguiente: [Step 3 — l0-manifest.json](03-manifest.md)
