---
title: "Step 4 — Sync skills / Paso 4 — Sincronizar habilidades"
slug: getting-started-sync-skills
scope: [guides, getting-started, sync]
sources: [androidcommondoc]
targets: [android, desktop, ios, jvm]
status: active
layer: L0
parent: getting-started
category: guides
description: >
  Run /sync-l0 or the CLI to materialise L0 skills, agents, and commands
  into a downstream project with version tracking. / Ejecutar /sync-l0 o el
  CLI para materializar habilidades, agentes y comandos L0 en un proyecto
  descendente con seguimiento de versión.
last_updated: "2026-09-05"
---

# Step 4 — Sync skills

---

## English

The sync engine reads `l0-manifest.json`, resolves every selected entry
against `skills/registry.json`, computes a diff of checksums, and
materialises only what has changed. Each copied file receives version-tracking
headers so drift is detectable at any time.

### From Claude Code (recommended)

```
/sync-l0
```

Claude Code reads the skill from `.claude/skills/sync-l0/SKILL.md` and
invokes the CLI with the correct paths automatically.

### From the terminal

```bash
cd "$ANDROID_COMMON_DOC/mcp-server"
npx tsx src/sync/sync-l0-cli.ts \
  --project-root /path/to/my-project \
  --l0-root "$ANDROID_COMMON_DOC"
```

### Expected output

```
Sync L0 -> /path/to/my-project
  Adding:    33 skills, 12 agents, 32 commands
  Updating:  0
  Removing:  0
  Unchanged: 0
Sync complete: 77 added, 0 updated, 0 removed, 0 unchanged
Manifest updated: l0-manifest.json
```

### What gets materialised

| Destination | Contents |
|-------------|----------|
| `.claude/skills/` | 33 SKILL.md files with `l0_source` / `l0_hash` headers |
| `.claude/agents/` | 12 agent markdown files |
| `.claude/commands/` | 32 command markdown files |
| `l0-manifest.json` | Updated `checksums` and `last_synced` |

> **Note — scripts are not copied.** Skills invoke scripts from the L0
> installation using `$ANDROID_COMMON_DOC/scripts/...`. The env var must be
> set in every shell session (and in CI). If it is missing, skills fail with
> an explicit `ANDROID_COMMON_DOC is not set` error. See
> [Step 1](01-install-l0.md) for how to persist it in your shell profile.

### Optional collaboration runtime

To enable the Claude/Codex collaboration runtime in an L1 or L2 consumer, first keep an explicit local `L0`/`tooling` entry in `l0-manifest.json`, then run:

```bash
/sync-l0 --runtime --dry-run
/sync-l0 --runtime
```

Runtime mode does not copy runtime code. It pins the toolkit commit and executable-content digest, installs ten canonical role definitions, and registers hooks by absolute path to the declared L0 source. It never uses `ANDROID_COMMON_DOC` as an authority fallback. Missing, remote, ambiguous, or drifted sources and customized owned runtime files fail closed without overwrite. Do not combine runtime mode with prune, force, or migration flags. An explicit start also requires one unambiguous PLAN in the consumer; the read-only dashboard never creates one.

### Version-tracking headers

Every synced file receives headers that identify its L0 origin:

**Skill / agent (YAML frontmatter):**
```yaml
l0_source: "../AndroidCommonDoc/skills/test/SKILL.md"
l0_hash: "sha256:abc123..."
l0_synced: "2026-03-18T00:00:00.000Z"
```

**Command (HTML comment):**
```markdown
<!-- l0_source: ../AndroidCommonDoc/.claude/commands/test.md -->
<!-- l0_hash: sha256:abc123... -->
<!-- l0_synced: 2026-03-18T00:00:00.000Z -->
```

These headers let you detect drift: if a file is modified locally its hash
will differ from the registry on the next sync run.

### Re-syncing after L0 updates

```bash
cd "$ANDROID_COMMON_DOC" && git pull
cd detekt-rules && ./gradlew assemble && cd ..
# Then in each downstream project:
/sync-l0
```

Only changed files are updated; unchanged files are skipped.

### Restart your agent

Skills are loaded on startup. After syncing, restart Claude Code or reload
Copilot Chat for the new skills to become available.

---

## Castellano

El sync engine lee `l0-manifest.json`, resuelve cada entrada seleccionada
contra `skills/registry.json`, calcula un diff de checksums y materializa
solo lo que ha cambiado. Cada fichero copiado recibe cabeceras de seguimiento
de versión para que la deriva sea detectable en cualquier momento.

### Desde Claude Code (recomendado)

```
/sync-l0
```

Claude Code lee la habilidad desde `.claude/skills/sync-l0/SKILL.md` e
invoca el CLI con las rutas correctas automáticamente.

### Desde la terminal

```bash
cd "$ANDROID_COMMON_DOC/mcp-server"
npx tsx src/sync/sync-l0-cli.ts \
  --project-root /ruta/a/mi-proyecto \
  --l0-root "$ANDROID_COMMON_DOC"
```

### Salida esperada

```
Sync L0 -> /ruta/a/mi-proyecto
  Adding:    33 skills, 12 agents, 32 commands
  Updating:  0
  Removing:  0
  Unchanged: 0
Sync complete: 77 added, 0 updated, 0 removed, 0 unchanged
Manifest updated: l0-manifest.json
```

### Qué se materializa

| Destino | Contenido |
|---------|-----------|
| `.claude/skills/` | 33 ficheros SKILL.md con cabeceras `l0_source` / `l0_hash` |
| `.claude/agents/` | 12 ficheros markdown de agentes |
| `.claude/commands/` | 32 ficheros markdown de comandos |
| `l0-manifest.json` | `checksums` y `last_synced` actualizados |

> **Nota — los scripts no se copian.** Las skills invocan los scripts desde la
> instalación L0 usando `$ANDROID_COMMON_DOC/scripts/...`. La variable de entorno
> debe estar definida en cada sesión de shell (y en CI). Si falta, las skills fallan
> con un error explícito `ANDROID_COMMON_DOC is not set`. Ver
> [Paso 1](01-install-l0.md) para persistirla en el perfil de shell.

### Runtime de colaboración opcional

Para habilitar el runtime Claude/Codex en un consumidor L1 o L2, declara una única fuente local `L0`/`tooling` en `l0-manifest.json` y ejecuta:

```bash
/sync-l0 --runtime --dry-run
/sync-l0 --runtime
```

Este modo no copia el código del runtime. Fija el commit y el digest del contenido ejecutable del toolkit, instala diez roles canónicos y registra los hooks mediante rutas absolutas a la fuente L0 declarada. No usa `ANDROID_COMMON_DOC` como autoridad alternativa. Fuentes ausentes, remotas, ambiguas o con deriva y archivos runtime personalizados fallan de forma cerrada sin sobrescritura. No combines este modo con prune, force o migraciones. El inicio explícito requiere además un único PLAN inequívoco en el consumidor; el dashboard de solo lectura nunca fabrica uno.

### Cabeceras de seguimiento de versión

Cada fichero sincronizado recibe cabeceras que identifican su origen en L0:

**Skill / agente (frontmatter YAML):**
```yaml
l0_source: "../AndroidCommonDoc/skills/test/SKILL.md"
l0_hash: "sha256:abc123..."
l0_synced: "2026-03-18T00:00:00.000Z"
```

**Comando (comentario HTML):**
```markdown
<!-- l0_source: ../AndroidCommonDoc/.claude/commands/test.md -->
<!-- l0_hash: sha256:abc123... -->
<!-- l0_synced: 2026-03-18T00:00:00.000Z -->
```

Estas cabeceras permiten detectar deriva: si un fichero se modifica localmente
su hash diferirá del registro en el siguiente sync.

### Re-sincronizar tras actualizaciones de L0

```bash
cd "$ANDROID_COMMON_DOC" && git pull
cd detekt-rules && ./gradlew assemble && cd ..
# Luego en cada proyecto descendente:
/sync-l0
```

Solo se actualizan los ficheros que han cambiado; los no modificados se omiten.

### Reiniciar el agente

Las habilidades se cargan al inicio. Tras sincronizar, reinicia Claude Code o
recarga Copilot Chat para que las nuevas habilidades estén disponibles.

---

→ Next / Siguiente: [Step 5 — Configure Detekt per layer](05-detekt-layers.md)
