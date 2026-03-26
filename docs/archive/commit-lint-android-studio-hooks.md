---
scope: [ci, commit-lint, conventional-commits, android-studio, git-hooks]
sources: [git, gradle, android-studio]
targets: [android, kmp, jvm]
version: 1
last_updated: "2026-03"
description: "Guía corporativa: enforcement de Conventional Commits en Android Studio mediante git hooks distribuidos con Gradle. Pre-commit validation local sin dependencias externas."
slug: commit-lint-android-studio-hooks
status: archived
layer: L0
category: archive
---

# Commit Lint en Android Studio — Git Hooks con Gradle

Guía para enforcement local de Conventional Commits en proyectos Android/KMP mediante git hooks distribuidos automáticamente por Gradle. Enfocado a entornos corporativos donde se necesita que **ningún desarrollador pueda hacer commit con un mensaje inválido**, ni desde Android Studio ni desde terminal.

## Contexto

En entornos corporativos con equipos grandes, la validación de commits en CI llega tarde — el commit ya existe en el historial local y puede propagarse. La solución es **bloquear en origen**: un git hook `commit-msg` que rechaza el commit antes de que se cree.

El reto es la distribución: `.git/hooks/` no se trackea en git. Cada dev tendría que instalar el hook manualmente. La solución es una tarea Gradle que lo instala automáticamente en cada sync de Android Studio.

### Complemento con CI

Este mecanismo **no reemplaza** la validación en CI (ver [commit-lint-ci-standalone](commit-lint-ci-standalone.md)). Son capas complementarias:

| Capa | Cuándo actúa | Qué garantiza |
|------|-------------|---------------|
| **Git hook local** | Al hacer commit | Feedback inmediato al dev, bloqueo en origen |
| **CI (GitHub Actions)** | Al abrir PR | Red de seguridad para commits que bypasearon el hook (`--no-verify`) |

Ambas capas son necesarias: el hook local es UX (feedback instantáneo), CI es enforcement (no se puede evadir).

---

## Arquitectura

```
proyecto/
├── git-hooks/
│   └── commit-msg              ← script validador (trackeado en git)
├── build.gradle.kts            ← tarea installGitHooks
├── gradle.properties           ← flag opcional para desactivar
└── .git/hooks/
    └── commit-msg              ← copia instalada (NO trackeada, generada por Gradle)
```

### Flujo de instalación

```
Dev abre proyecto en Android Studio
  → Gradle sync automático
    → Tarea installGitHooks se ejecuta
      → Copia git-hooks/commit-msg a .git/hooks/commit-msg
        → Permisos de ejecución aplicados
```

A partir de ese momento, cualquier commit (desde AS o terminal) pasa por el hook.

---

## Implementación

### 1. Script validador (`git-hooks/commit-msg`)

```bash
#!/bin/bash
# Conventional Commits validator — git commit-msg hook
# Spec: https://www.conventionalcommits.org/en/v1.0.0/

MSG_FILE="$1"
MSG=$(head -1 "$MSG_FILE")

# Tipos permitidos (ajustar según el proyecto)
TYPES="feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert"

# Patrón: type(scope)!: description
# - type: obligatorio, uno de TYPES
# - (scope): opcional, texto libre entre paréntesis
# - !: opcional, indica breaking change
# - description: obligatoria, 1-72 caracteres
PATTERN="^($TYPES)(\(.+\))?(!)?: .{1,72}$"

# Permitir merge commits y revert automáticos
if echo "$MSG" | grep -qE "^(Merge|Revert) "; then
  exit 0
fi

if ! echo "$MSG" | grep -qE "$PATTERN"; then
  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  ❌ Commit rechazado — mensaje no sigue Conventional Commits ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""
  echo "  Tu mensaje:  $MSG"
  echo ""
  echo "  Formato esperado:"
  echo "    type(scope): descripción"
  echo ""
  echo "  Tipos válidos:"
  echo "    feat     — nueva funcionalidad"
  echo "    fix      — corrección de bug"
  echo "    docs     — solo documentación"
  echo "    style    — formato, sin cambio de lógica"
  echo "    refactor — refactoring sin cambio funcional"
  echo "    perf     — mejora de rendimiento"
  echo "    test     — añadir o corregir tests"
  echo "    build    — cambios en build system o deps"
  echo "    ci       — cambios en CI/CD"
  echo "    chore    — tareas de mantenimiento"
  echo "    revert   — revertir commit anterior"
  echo ""
  echo "  Ejemplos:"
  echo "    feat(auth): add biometric login"
  echo "    fix(network): handle timeout on slow connections"
  echo "    docs: update README with setup instructions"
  echo ""
  exit 1
fi
```

### 2. Tarea Gradle (`build.gradle.kts` raíz)

```kotlin
// root build.gradle.kts

tasks.register<Copy>("installGitHooks") {
    description = "Instala git hooks desde git-hooks/ en .git/hooks/"
    group = "git"

    from("git-hooks")
    into(".git/hooks")

    // Permisos de ejecución (Linux/macOS)
    filePermissions {
        unix("rwxr-xr-x")
    }
}

// Auto-instalación en Gradle sync (Android Studio)
// prepareKotlinBuildScriptModel se ejecuta en cada sync
tasks.matching { it.name == "prepareKotlinBuildScriptModel" }.configureEach {
    dependsOn("installGitHooks")
}
```

### 3. Soporte Windows

En Windows, los permisos Unix no aplican. Git for Windows ejecuta scripts bash via MINGW. El script funciona si Git Bash está instalado (viene con Git for Windows, que es prerequisito de Android Studio).

Para equipos con PowerShell puro (sin Git Bash), añadir una versión PowerShell:

```powershell
# git-hooks/commit-msg.ps1 (alternativa Windows)
$msg = Get-Content $args[0] -First 1
$pattern = "^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?(!)?: .{1,72}$"

if ($msg -match "^(Merge|Revert) ") { exit 0 }

if ($msg -notmatch $pattern) {
    Write-Host "`n❌ Commit rechazado — mensaje no sigue Conventional Commits" -ForegroundColor Red
    Write-Host "  Tu mensaje: $msg`n"
    Write-Host "  Formato esperado: type(scope): descripcion`n"
    exit 1
}
```

Y modificar la tarea Gradle para copiar ambos:

```kotlin
tasks.register<Copy>("installGitHooks") {
    from("git-hooks") {
        include("commit-msg")    // bash (Linux/macOS/Git Bash)
    }
    into(".git/hooks")
    filePermissions { unix("rwxr-xr-x") }
}
```

> **Nota**: Git for Windows usa el script bash `commit-msg` (sin extensión), no el `.ps1`. La versión PowerShell es para ejecución manual o tooling custom.

---

## Personalización Corporativa

### Scopes restringidos

Para limitar los scopes válidos a los módulos del proyecto:

```bash
# Añadir después de TYPES en commit-msg
SCOPES="auth|network|storage|ui|core|analytics|payment"
PATTERN="^($TYPES)(\(($SCOPES)\))?(!)?: .{1,72}$"
```

### Ticket ID obligatorio

Para exigir referencia a Jira/Linear en el footer:

```bash
# Añadir al final del script, después de la validación del subject
BODY=$(tail -n +3 "$MSG_FILE" | tr -d '[:space:]')
if [ -n "$BODY" ]; then
  TICKET_PATTERN="(JIRA|LINEAR)-[0-9]+"
  if ! grep -qE "$TICKET_PATTERN" "$MSG_FILE"; then
    echo "⚠️  Commit con body pero sin referencia a ticket ($TICKET_PATTERN)"
    echo "   Añade una línea como: Refs: JIRA-1234"
    exit 1
  fi
fi
```

### Desactivación temporal

Para casos excepcionales (merge conflicts complejos, scripts automatizados):

```bash
# El dev puede bypass puntual con --no-verify
git commit --no-verify -m "emergency fix"
```

CI capturará estos commits en la PR. El flag `--no-verify` queda visible en `git reflog` para auditoría.

---

## Integración con Android Studio

### Commit Dialog

Android Studio ejecuta git hooks al hacer commit desde el dialog gráfico (VCS → Commit). Si el hook rechaza el mensaje, AS muestra el error en la consola de Git y el commit no se crea.

### Commit Template (opcional)

Para guiar al dev en el dialog de commit, añadir un template:

```
# .gitmessage
# type(scope): descripción (max 72 chars)
#
# Tipos: feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert
# Scope: módulo afectado (auth, network, storage, ui, core)
#
# Ejemplo: feat(auth): add biometric login
```

Configurar en el proyecto:

```bash
git config commit.template .gitmessage
```

O en la tarea Gradle para que sea automático:

```kotlin
tasks.register<Exec>("configureCommitTemplate") {
    commandLine("git", "config", "commit.template", ".gitmessage")
}

tasks.named("installGitHooks") {
    finalizedBy("configureCommitTemplate")
}
```

### Plugin Conventional Commit (complementario)

El plugin [Conventional Commit](https://plugins.jetbrains.com/plugin/13389-conventional-commit) para IntelliJ/AS ofrece autocompletado en el dialog de commit. Es **complementario** al hook — el plugin sugiere, el hook bloquea:

| Herramienta | Rol | Obligatorio |
|-------------|-----|-------------|
| Git hook `commit-msg` | **Enforcement** — bloquea commits inválidos | Sí |
| Plugin Conventional Commit | **UX** — autocompletado en el dialog | No (recomendado) |
| CI commit-lint | **Red de seguridad** — valida en PR | Sí |

---

## Verificación de la Instalación

### Para el dev individual

```bash
# Verificar que el hook está instalado
ls -la .git/hooks/commit-msg

# Test con mensaje inválido (debe fallar)
echo "bad message" | git commit --allow-empty -m "bad message"
# → ❌ Commit rechazado

# Test con mensaje válido (debe pasar)
git commit --allow-empty -m "test: verify commit hook installation"
# → ✅ Commit creado
git reset HEAD~1  # limpiar el commit de test
```

### Para el equipo (CI)

Añadir un check en CI que verifica que el hook existe en el repo:

```yaml
- name: Verify git hooks exist
  run: |
    test -f git-hooks/commit-msg || (echo "❌ git-hooks/commit-msg missing" && exit 1)
    head -1 git-hooks/commit-msg | grep -q "#!/bin/bash" || (echo "❌ Missing shebang" && exit 1)
```

---

## Troubleshooting

| Síntoma | Causa | Solución |
|---------|-------|----------|
| Hook no se ejecuta | No instalado (sync no ejecutado) | `./gradlew installGitHooks` manual |
| "Permission denied" en Linux/macOS | Falta permiso ejecución | `chmod +x .git/hooks/commit-msg` |
| Hook no bloquea en Windows | Git for Windows no encuentra bash | Reinstalar Git for Windows con Git Bash |
| AS no muestra error del hook | Versión antigua de AS | Actualizar AS; verificar en terminal como alternativa |
| "bad interpreter" en macOS | Script con line endings CRLF | Configurar `git config core.autocrlf input` |
| Hook bypaseado con `--no-verify` | Uso intencionado o accidental | CI lo captura; audit via `git reflog` |

---

## Documentos Relacionados

- [commit-lint-ci-standalone](commit-lint-ci-standalone.md) — Validación en CI (capa complementaria)
- [Conventional Commits spec](https://www.conventionalcommits.org/en/v1.0.0/) — Especificación oficial
