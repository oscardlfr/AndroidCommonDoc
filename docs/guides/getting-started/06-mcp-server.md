---
title: "Step 6 — MCP server / Paso 6 — Servidor MCP"
slug: getting-started-mcp-server
category: guides
description: >
  Connect the AndroidCommonDoc MCP server to Claude Desktop for programmatic
  access to all 17 tools. / Conectar el servidor MCP de AndroidCommonDoc a
  Claude Desktop para acceso programático a las 17 herramientas.
last_updated: "2026-03-18"
---

# Step 6 — MCP server

---

## English

The MCP server exposes 17 tools over stdio transport. Once connected,
Claude Desktop can invoke validation, monitoring, and doc-intelligence tools
directly — no shell commands needed.

### Locate `claude_desktop_config.json`

| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

### Configuration — development mode (TypeScript source)

Use during active development of the toolkit itself:

```json
{
  "mcpServers": {
    "androidcommondoc": {
      "command": "npx",
      "args": [
        "tsx",
        "/absolute/path/to/AndroidCommonDoc/mcp-server/src/index.ts"
      ],
      "env": {
        "ANDROID_COMMON_DOC": "/absolute/path/to/AndroidCommonDoc"
      }
    }
  }
}
```

### Configuration — production mode (compiled JS)

Build once, then use the compiled output (faster startup):

```bash
cd "$ANDROID_COMMON_DOC/mcp-server" && npm run build
```

```json
{
  "mcpServers": {
    "androidcommondoc": {
      "command": "node",
      "args": [
        "/absolute/path/to/AndroidCommonDoc/mcp-server/build/index.js"
      ],
      "env": {
        "ANDROID_COMMON_DOC": "/absolute/path/to/AndroidCommonDoc"
      }
    }
  }
}
```

### Verify the connection

Restart Claude Desktop after editing the config. Open a new conversation and
look for the tool icon (🔧). Type:

```
List all available androidcommondoc tools
```

You should see 17 tools grouped by category.

### Available tools (17)

| Category | Tools |
|----------|-------|
| Validation | `validate-all`, `verify-kmp`, `check-version-sync`, `validate-skills`, `validate-doc-structure`, `validate-vault` |
| Monitoring | `monitor-sources`, `check-doc-freshness` |
| Generation | `generate-detekt-rules`, `ingest-content` |
| Vault | `sync-vault`, `vault-status` |
| Utility | `find-pattern`, `setup-check`, `rate-limit-status`, `script-parity`, `validate-claude-md` |

### Rate limiting

The server self-limits to **30 calls/minute** to protect external APIs
(GitHub, Maven Central, doc pages). Burst requests return `rate_limit_status`
info in the response.

---

## Castellano

El servidor MCP expone 17 herramientas sobre transporte stdio. Una vez
conectado, Claude Desktop puede invocar herramientas de validación, monitoreo
e inteligencia documental directamente, sin comandos de shell.

### Localizar `claude_desktop_config.json`

| Sistema operativo | Ruta |
|-------------------|------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

### Configuración — modo desarrollo (fuente TypeScript)

Usar durante el desarrollo activo del toolkit:

```json
{
  "mcpServers": {
    "androidcommondoc": {
      "command": "npx",
      "args": [
        "tsx",
        "/ruta/absoluta/a/AndroidCommonDoc/mcp-server/src/index.ts"
      ],
      "env": {
        "ANDROID_COMMON_DOC": "/ruta/absoluta/a/AndroidCommonDoc"
      }
    }
  }
}
```

### Configuración — modo producción (JS compilado)

Compila una vez y usa la salida compilada (arranque más rápido):

```bash
cd "$ANDROID_COMMON_DOC/mcp-server" && npm run build
```

```json
{
  "mcpServers": {
    "androidcommondoc": {
      "command": "node",
      "args": [
        "/ruta/absoluta/a/AndroidCommonDoc/mcp-server/build/index.js"
      ],
      "env": {
        "ANDROID_COMMON_DOC": "/ruta/absoluta/a/AndroidCommonDoc"
      }
    }
  }
}
```

### Verificar la conexión

Reinicia Claude Desktop tras editar la configuración. Abre una nueva
conversación y busca el icono de herramientas (🔧). Escribe:

```
Lista todas las herramientas de androidcommondoc disponibles
```

Deberías ver 17 herramientas agrupadas por categoría.

### Herramientas disponibles (17)

| Categoría | Herramientas |
|-----------|-------------|
| Validación | `validate-all`, `verify-kmp`, `check-version-sync`, `validate-skills`, `validate-doc-structure`, `validate-vault` |
| Monitoreo | `monitor-sources`, `check-doc-freshness` |
| Generación | `generate-detekt-rules`, `ingest-content` |
| Vault | `sync-vault`, `vault-status` |
| Utilidad | `find-pattern`, `setup-check`, `rate-limit-status`, `script-parity`, `validate-claude-md` |

### Rate limiting

El servidor se autolimita a **30 llamadas/minuto** para proteger las APIs
externas (GitHub, Maven Central, páginas de docs). Las peticiones en ráfaga
reciben información de `rate_limit_status` en la respuesta.

---

→ Next / Siguiente: [Step 7 — CI reusable workflows](07-ci-workflows.md)
