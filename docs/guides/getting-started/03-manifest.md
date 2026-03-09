---
title: "Step 3 — l0-manifest.json / Paso 3 — l0-manifest.json"
slug: getting-started-manifest
category: guides
description: >
  Full reference for l0-manifest.json: all fields, L1 vs L2 examples,
  selection modes, and l2_specific. / Referencia completa de l0-manifest.json:
  todos los campos, ejemplos L1 y L2, modos de selección y l2_specific.
last_updated: "2026-03-18"
---

# Step 3 — l0-manifest.json

---

## English

`l0-manifest.json` lives at the root of every downstream project. It declares
which L0 entries to sync, tracks checksums for drift detection, and lists
project-owned files the sync engine must never overwrite.

The sync engine creates a default `include-all` manifest automatically if the
file is absent. You only need to create it manually if you want exclusions from
day one.

### Field reference

```jsonc
{
  "version": 1,                         // schema version — always 1
  "l0_source": "../AndroidCommonDoc",   // relative path to L0 root
  "last_synced": "2026-01-01T00:00:00.000Z",

  "selection": {
    "mode": "include-all",              // "include-all" | "explicit"
    "exclude_skills":   [],             // skill names to skip  e.g. ["sbom"]
    "exclude_agents":   [],             // agent filenames      e.g. ["release-readiness.md"]
    "exclude_commands": [],             // command slugs        e.g. ["sync-roadmap"]
    "exclude_categories": []            // category labels      e.g. ["product", "web"]
  },

  "checksums": {},                      // auto-managed by sync engine — do not edit manually

  "l2_specific": {
    "commands": [],                     // project-owned command files — sync never touches these
    "agents":   [],
    "skills":   []
  }
}
```

### Selection modes

| Mode | Behaviour |
|------|-----------|
| `include-all` | Sync everything except entries listed in `exclude_*` / `exclude_categories` |
| `explicit` | Only sync entries already present in `checksums` (opt-in, useful for tight control) |

### L2 manifest — app (sync everything)

```json
{
  "version": 1,
  "l0_source": "../AndroidCommonDoc",
  "last_synced": "2026-01-01T00:00:00.000Z",
  "selection": {
    "mode": "include-all",
    "exclude_skills": [],
    "exclude_agents": [],
    "exclude_commands": [],
    "exclude_categories": []
  },
  "checksums": {},
  "l2_specific": { "commands": [], "agents": [], "skills": [] }
}
```

### L1 manifest — shared library (exclude product/GSD commands)

```json
{
  "version": 1,
  "l0_source": "../AndroidCommonDoc",
  "last_synced": "2026-01-01T00:00:00.000Z",
  "selection": {
    "mode": "include-all",
    "exclude_skills": [],
    "exclude_agents": [],
    "exclude_commands": ["start-track", "sync-roadmap", "merge-track"],
    "exclude_categories": ["product"]
  },
  "checksums": {},
  "l2_specific": {
    "commands": ["my-custom-command.md"],
    "agents":   ["my-domain-agent.md"],
    "skills":   []
  }
}
```

### Key rules

- **Absence = opt-out:** not listing an entry skips it automatically in `include-all` mode.
- **`checksums`** is auto-managed — never edit it by hand.
- **`l2_specific`** protects project-owned files from being overwritten by the sync engine.
- **`l0_source`** can be absolute or relative (relative is recommended for portability).

---

## Castellano

`l0-manifest.json` reside en la raíz de cada proyecto descendente. Declara
qué entradas L0 sincronizar, guarda checksums para detección de deriva y
lista ficheros propios del proyecto que el sync engine nunca debe sobreescribir.

El sync engine crea automáticamente un manifest `include-all` por defecto si
el fichero no existe. Solo necesitas crearlo manualmente si quieres exclusiones
desde el primer día.

### Referencia de campos

```jsonc
{
  "version": 1,                         // versión del schema — siempre 1
  "l0_source": "../AndroidCommonDoc",   // ruta relativa al root de L0
  "last_synced": "2026-01-01T00:00:00.000Z",

  "selection": {
    "mode": "include-all",              // "include-all" | "explicit"
    "exclude_skills":   [],             // nombres de skills a omitir   p.ej. ["sbom"]
    "exclude_agents":   [],             // ficheros de agentes           p.ej. ["release-readiness.md"]
    "exclude_commands": [],             // slugs de comandos             p.ej. ["sync-roadmap"]
    "exclude_categories": []            // etiquetas de categoría        p.ej. ["product", "web"]
  },

  "checksums": {},                      // gestionado por el sync engine — no editar manualmente

  "l2_specific": {
    "commands": [],                     // comandos propios del proyecto — el sync nunca los toca
    "agents":   [],
    "skills":   []
  }
}
```

### Modos de selección

| Modo | Comportamiento |
|------|---------------|
| `include-all` | Sincroniza todo salvo las entradas en `exclude_*` / `exclude_categories` |
| `explicit` | Solo sincroniza las entradas ya presentes en `checksums` (opt-in, control total) |

### Manifest L2 — app (sincroniza todo)

```json
{
  "version": 1,
  "l0_source": "../AndroidCommonDoc",
  "last_synced": "2026-01-01T00:00:00.000Z",
  "selection": {
    "mode": "include-all",
    "exclude_skills": [],
    "exclude_agents": [],
    "exclude_commands": [],
    "exclude_categories": []
  },
  "checksums": {},
  "l2_specific": { "commands": [], "agents": [], "skills": [] }
}
```

### Manifest L1 — librería compartida (excluye comandos de producto y GSD)

```json
{
  "version": 1,
  "l0_source": "../AndroidCommonDoc",
  "last_synced": "2026-01-01T00:00:00.000Z",
  "selection": {
    "mode": "include-all",
    "exclude_skills": [],
    "exclude_agents": [],
    "exclude_commands": ["start-track", "sync-roadmap", "merge-track"],
    "exclude_categories": ["product"]
  },
  "checksums": {},
  "l2_specific": {
    "commands": ["mi-comando-propio.md"],
    "agents":   ["mi-agente-dominio.md"],
    "skills":   []
  }
}
```

### Reglas clave

- **Ausencia = exclusión:** no listar una entrada la omite automáticamente en modo `include-all`.
- **`checksums`** se gestiona solo — nunca lo edites a mano.
- **`l2_specific`** protege los ficheros propios del proyecto para que el sync no los sobreescriba.
- **`l0_source`** puede ser absoluta o relativa (relativa recomendada para portabilidad).

---

→ Next / Siguiente: [Step 4 — Sync skills](04-sync-skills.md)
