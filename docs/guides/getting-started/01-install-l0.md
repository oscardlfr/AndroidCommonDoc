---
title: "Step 1 — Install L0 / Paso 1 — Instalar L0"
slug: getting-started-install-l0
category: guides
description: >
  Clone AndroidCommonDoc, set the environment variable, compile the Detekt
  rules JAR, and install MCP server dependencies. / Clonar AndroidCommonDoc,
  configurar la variable de entorno, compilar las reglas Detekt e instalar
  las dependencias del servidor MCP.
last_updated: "2026-03-18"
---

# Step 1 — Install L0

---

## English

### Prerequisites

| Tool | Min version | Check |
|------|------------|-------|
| Git | any | `git --version` |
| JDK | 17 | `java -version` |
| Node.js | 18 | `node --version` |
| npm | 9 | `npm --version` |
| Claude Code | latest | `claude --version` |

> If you use Android Studio, make sure `JAVA_HOME` points to JDK 17+ when
> running Gradle from the terminal.

### Recommended directory layout

Clone AndroidCommonDoc **next to** your existing projects. The relative path
`../AndroidCommonDoc` used by L1/L2 manifests assumes this layout:

```
workspace/
├── AndroidCommonDoc/   ← L0 (this repo)
├── shared-libs/        ← L1
└── my-app/             ← L2
```

### 1.1 Clone

```bash
cd ~/workspace
git clone git@github.com:<org>/AndroidCommonDoc.git
```

### 1.2 Set environment variable

**macOS / Linux — add to `~/.zshrc` or `~/.bashrc`:**
```bash
export ANDROID_COMMON_DOC="$HOME/workspace/AndroidCommonDoc"
source ~/.zshrc
```

**Windows — PowerShell (persistent for the current user):**
```powershell
[Environment]::SetEnvironmentVariable(
  "ANDROID_COMMON_DOC",
  (Resolve-Path "$HOME\workspace\AndroidCommonDoc").Path,
  [EnvironmentVariableTarget]::User
)
# Open a new PowerShell session for the change to take effect
```

Verify: `echo $ANDROID_COMMON_DOC`

### 1.3 Compile Detekt rules

```bash
cd "$ANDROID_COMMON_DOC/detekt-rules"
./gradlew assemble
```

Expected: `BUILD SUCCESSFUL` and a JAR under `build/libs/`.
Only needed once; re-run after pulling L0 updates.

### 1.4 Install MCP server dependencies

```bash
cd "$ANDROID_COMMON_DOC/mcp-server"
npm ci          # clean install — faster and reproducible
npm test        # verify: 653/653 ✓
```

### 1.5 Updating L0 later

```bash
cd "$ANDROID_COMMON_DOC" && git pull
cd detekt-rules && ./gradlew assemble && cd ..
cd mcp-server   && npm ci               && cd ..
# Then re-sync skills in each downstream project:
cd /path/to/my-project && /sync-l0
```

---

## Castellano

### Prerrequisitos

| Herramienta | Versión mínima | Verificar |
|-------------|---------------|-----------|
| Git | cualquiera | `git --version` |
| JDK | 17 | `java -version` |
| Node.js | 18 | `node --version` |
| npm | 9 | `npm --version` |
| Claude Code | última | `claude --version` |

> Si usas Android Studio, asegúrate de que `JAVA_HOME` apunta a JDK 17+
> cuando ejecutes Gradle desde la terminal.

### Layout de directorios recomendado

Clona AndroidCommonDoc **junto a** tus proyectos. La ruta relativa
`../AndroidCommonDoc` que usan los manifests L1/L2 asume este layout:

```
workspace/
├── AndroidCommonDoc/   ← L0 (este repo)
├── shared-libs/        ← L1
└── my-app/             ← L2
```

### 1.1 Clonar

```bash
cd ~/workspace
git clone git@github.com:<org>/AndroidCommonDoc.git
```

### 1.2 Variable de entorno

**macOS / Linux — añadir a `~/.zshrc` o `~/.bashrc`:**
```bash
export ANDROID_COMMON_DOC="$HOME/workspace/AndroidCommonDoc"
source ~/.zshrc
```

**Windows — PowerShell (persistente para el usuario actual):**
```powershell
[Environment]::SetEnvironmentVariable(
  "ANDROID_COMMON_DOC",
  (Resolve-Path "$HOME\workspace\AndroidCommonDoc").Path,
  [EnvironmentVariableTarget]::User
)
# Abrir una nueva sesión de PowerShell para que surta efecto
```

Verificar: `echo $ANDROID_COMMON_DOC`

### 1.3 Compilar las reglas Detekt

```bash
cd "$ANDROID_COMMON_DOC/detekt-rules"
./gradlew assemble
```

Resultado esperado: `BUILD SUCCESSFUL` y un JAR bajo `build/libs/`.
Solo es necesario una vez; vuelve a ejecutarlo tras actualizar L0.

### 1.4 Instalar dependencias del servidor MCP

```bash
cd "$ANDROID_COMMON_DOC/mcp-server"
npm ci          # instalación limpia y reproducible
npm test        # verificar: 653/653 ✓
```

### 1.5 Actualizar L0 en el futuro

```bash
cd "$ANDROID_COMMON_DOC" && git pull
cd detekt-rules && ./gradlew assemble && cd ..
cd mcp-server   && npm ci               && cd ..
# Re-sincronizar habilidades en cada proyecto descendente:
cd /ruta/a/mi-proyecto && /sync-l0
```

---

→ Next / Siguiente: [Step 2 — Connect a downstream project](02-connect-project.md)
