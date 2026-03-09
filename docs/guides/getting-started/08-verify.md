---
title: "Step 8 — Verify and troubleshoot / Paso 8 — Verificar y resolver problemas"
slug: getting-started-verify
category: guides
description: >
  Verification checklist and troubleshooting table for a complete L0/L1/L2
  setup. / Checklist de verificación y tabla de resolución de problemas para
  una configuración completa L0/L1/L2.
last_updated: "2026-03-18"
---

# Step 8 — Verify and troubleshoot

---

## English

### Verification checklist

Run these commands after completing Steps 1–7 to confirm everything is wired
correctly.

```bash
# 1. Environment variable
echo $ANDROID_COMMON_DOC
# → /path/to/AndroidCommonDoc  (must not be empty)

# 2. Detekt rules JAR compiled
ls "$ANDROID_COMMON_DOC/detekt-rules/build/libs/"*rules*.jar
# → detekt-rules-X.X.X.jar  (must exist)

# 3. MCP server tests green
cd "$ANDROID_COMMON_DOC/mcp-server" && npm test
# → Tests: 653 passed (653) ✓

# 4. Skills synced in downstream project
ls .claude/skills/ | wc -l
# → 33 (or more if your L1/L2 adds project-specific skills)

# 5. Detekt rules are active
./gradlew detekt 2>&1 | grep "AndroidCommonDoc"
# → prints rule names for any violations (or nothing if code is clean)

# 6. Claude Code hooks installed
cat .claude/settings.json | python3 -m json.tool | grep -A 3 "hooks"
# → PostToolUse hook entry present

# 7. Manifest has checksums populated after sync
cat l0-manifest.json | python3 -m json.tool | grep '"checksums"' -A 5
# → entries for each synced file
```

### Expected project structure after full setup

```
my-project/
├── l0-manifest.json            ← sync manifest with populated checksums
├── detekt.yml                  ← project Detekt overrides (may be empty)
├── settings.gradle.kts         ← includeBuild("../AndroidCommonDoc/build-logic")
├── .github/
│   ├── workflows/
│   │   └── ci.yml              ← imports reusable workflows
│   └── copilot-instructions.md ← Copilot agent instructions
└── .claude/
    ├── settings.json           ← PostToolUse Detekt hook
    ├── skills/                 ← 33+ materialised SKILL.md files
    ├── agents/                 ← 12+ materialised agent files
    └── commands/               ← 32+ materialised command files
```

### Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `ANDROID_COMMON_DOC is not set` | Env var missing | Add `export ANDROID_COMMON_DOC=...` to `~/.zshrc` and `source ~/.zshrc` |
| `command not found: claude` | Claude Code not installed or not in PATH | Install Claude Code; verify `which claude` |
| Detekt rules detect nothing | JAR not compiled or not in classpath | `cd detekt-rules && ./gradlew assemble` |
| `Sync: Manifest not found` | No `l0-manifest.json` | Run `setup-toolkit.sh` or create manually (Step 3) |
| Skills dir has 0 files after sync | Wrong `--project-root` | Verify path passed to sync CLI matches actual project root |
| MCP server not visible in Claude Desktop | Wrong path in config JSON | Use absolute paths; check no typos in `claude_desktop_config.json` |
| Hook blocks valid commits | `block` mode too strict | Reinstall with `--mode warn --force`; tune `detekt.yml` then switch back to `block` |
| Gradle sync fails after `includeBuild` | Relative path wrong | Verify `../AndroidCommonDoc/build-logic` is reachable from `settings.gradle.kts` |
| `BUILD FAILED: Could not resolve androidcommondoc.toolkit` | JAR not yet compiled | Run `./gradlew assemble` in `detekt-rules/` first |
| **`./gradlew detekt` fails with 400+ issues immediately** | No baseline generated | Run `./gradlew detektBaseline` — this suppresses pre-existing issues so only new violations block the build. `setup-toolkit.sh` does this automatically in Step 2.5. |
| **Hundreds of trailing-comma / newline violations** | `formattingRules = true` set explicitly | Remove that line or set `formattingRules.set(false)` — ktlint formatting is disabled by default. Enable only when ready to enforce formatting. |
| **Architecture rules not enforced (no AndroidCommonDoc violations ever)** | `detekt-l0-base.yml` not loaded | Verify `ANDROID_COMMON_DOC` points to the repo root and the JAR is compiled. The plugin loads `detekt-l0-base.yml` + `config.yml` — if only `config.yml` loads, rules fire via ServiceLoader but config won't reflect overrides. |
| **304 Detekt issues, don't know where to start** | Baseline generated but many real issues | See [baseline-reduction.md](../baseline-reduction.md) for the full playbook |

### Gradual baseline reduction

After generating the baseline, you'll want to progressively fix real architecture issues rather than leaving them all suppressed forever. Recommended approach:

```bash
# 1. See which rules have the most violations right now
./gradlew detekt --continue 2>&1 | grep "AndroidCommonDoc" | sort | uniq -c | sort -rn | head -20

# 2. Pick the lowest-count rule (easiest wins first), fix its violations
# 3. Regenerate baseline for that module only
./gradlew :core:domain:detektBaseline

# 4. Commit — the rule is now enforced, baseline shrinks
# 5. Repeat for next rule
```

To see only the architecture rules (filtering out any ktlint noise):
```bash
./gradlew detekt --continue 2>&1 | grep "AndroidCommonDoc\|NoSilentCatch\|NoChannel\|MutableStateFlow\|NoHardcoded\|NoLaunch\|NoRunCatching\|NoMagicNumbers"
```

---

## Castellano

### Checklist de verificación

Ejecuta estos comandos tras completar los pasos 1–7 para confirmar que todo
está correctamente configurado.

```bash
# 1. Variable de entorno
echo $ANDROID_COMMON_DOC
# → /ruta/a/AndroidCommonDoc  (no debe estar vacía)

# 2. JAR de reglas Detekt compilado
ls "$ANDROID_COMMON_DOC/detekt-rules/build/libs/"*rules*.jar
# → detekt-rules-X.X.X.jar  (debe existir)

# 3. Tests del servidor MCP en verde
cd "$ANDROID_COMMON_DOC/mcp-server" && npm test
# → Tests: 653 passed (653) ✓

# 4. Habilidades sincronizadas en el proyecto descendente
ls .claude/skills/ | wc -l
# → 33 (o más si L1/L2 añade habilidades propias)

# 5. Reglas Detekt activas
./gradlew detekt 2>&1 | grep "AndroidCommonDoc"
# → imprime nombres de regla para violaciones (nada si el código está limpio)

# 6. Hooks de Claude Code instalados
cat .claude/settings.json | python3 -m json.tool | grep -A 3 "hooks"
# → entrada de hook PostToolUse presente

# 7. Manifest con checksums poblados tras el sync
cat l0-manifest.json | python3 -m json.tool | grep '"checksums"' -A 5
# → entradas para cada fichero sincronizado
```

### Estructura esperada del proyecto tras la configuración completa

```
mi-proyecto/
├── l0-manifest.json            ← manifest de sync con checksums poblados
├── detekt.yml                  ← overrides Detekt del proyecto (puede estar vacío)
├── settings.gradle.kts         ← includeBuild("../AndroidCommonDoc/build-logic")
├── .github/
│   ├── workflows/
│   │   └── ci.yml              ← importa los workflows reutilizables
│   └── copilot-instructions.md ← instrucciones para el agente Copilot
└── .claude/
    ├── settings.json           ← hook PostToolUse de Detekt
    ├── skills/                 ← 33+ ficheros SKILL.md materializados
    ├── agents/                 ← 12+ ficheros de agentes materializados
    └── commands/               ← 32+ ficheros de comandos materializados
```

### Resolución de problemas

| Síntoma | Causa probable | Solución |
|---------|---------------|----------|
| `ANDROID_COMMON_DOC is not set` | Variable de entorno ausente | Añadir `export ANDROID_COMMON_DOC=...` a `~/.zshrc` y ejecutar `source ~/.zshrc` |
| `command not found: claude` | Claude Code no instalado o no en PATH | Instalar Claude Code; verificar `which claude` |
| Reglas Detekt no detectan nada | JAR no compilado o no en el classpath | `cd detekt-rules && ./gradlew assemble` |
| `Sync: Manifest not found` | No existe `l0-manifest.json` | Ejecutar `setup-toolkit.sh` o crear manualmente (Paso 3) |
| Directorio de habilidades vacío tras el sync | `--project-root` incorrecto | Verificar que la ruta pasada al CLI coincide con la raíz real del proyecto |
| Servidor MCP no visible en Claude Desktop | Ruta incorrecta en el JSON de configuración | Usar rutas absolutas; comprobar errores tipográficos en `claude_desktop_config.json` |
| El hook bloquea commits válidos | Modo `block` demasiado estricto | Reinstalar con `--mode warn --force`; ajustar `detekt.yml` y volver a `block` |
| Gradle sync falla tras `includeBuild` | Ruta relativa incorrecta | Verificar que `../AndroidCommonDoc/build-logic` es accesible desde `settings.gradle.kts` |
| `BUILD FAILED: Could not resolve androidcommondoc.toolkit` | JAR no compilado aún | Ejecutar `./gradlew assemble` en `detekt-rules/` primero |
| **`./gradlew detekt` falla con 400+ issues nada más integrar** | No se generó baseline | Ejecutar `./gradlew detektBaseline` — suprime issues preexistentes; solo nuevas violaciones bloquean el build. `setup-toolkit.sh` hace esto automáticamente en el Paso 2.5. |
| **Cientos de violaciones de trailing-comma / newlines** | `formattingRules = true` activado explícitamente | Eliminar esa línea o usar `formattingRules.set(false)` — el formateo ktlint está desactivado por defecto. Activarlo solo cuando el proyecto esté listo. |
| **Reglas de arquitectura no se aplican nunca** | `detekt-l0-base.yml` no se carga | Verificar que `ANDROID_COMMON_DOC` apunta a la raíz del repo y el JAR está compilado. |
| **304 issues en Detekt, no sé por dónde empezar** | Baseline generado pero hay issues reales | Ver [baseline-reduction.md](../baseline-reduction.md) para la guía completa |

### Reducción gradual del baseline

Después de generar el baseline, el objetivo es reducirlo progresivamente en lugar de dejarlo suprimido indefinidamente:

```bash
# 1. Ver qué reglas tienen más violaciones
./gradlew detekt --continue 2>&1 | grep "AndroidCommonDoc" | sort | uniq -c | sort -rn | head -20

# 2. Elegir la regla con menos violaciones (victorias rápidas primero), corregirlas
# 3. Regenerar baseline solo para ese módulo
./gradlew :core:domain:detektBaseline

# 4. Commit — la regla queda aplicada, el baseline se reduce
# 5. Repetir con la siguiente regla
```

Para ver solo las reglas de arquitectura (filtrando ruido de ktlint):
```bash
./gradlew detekt --continue 2>&1 | grep "AndroidCommonDoc\|NoSilentCatch\|NoChannel\|MutableStateFlow\|NoHardcoded\|NoLaunch\|NoRunCatching\|NoMagicNumbers"
```
