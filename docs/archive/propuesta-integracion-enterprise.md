---
scope: [enterprise, integration, proposal]
sources: [androidcommondoc, ci-cd, detekt, copilot, claude-code]
targets: [android, kmp]
version: 2
last_updated: "2026-03"
description: "Catálogo de adopción enterprise para AndroidCommonDoc — modular, elige lo que necesites. Cada módulo es independiente."
slug: propuesta-integracion-enterprise
status: archived
layer: L0
category: archive
---

# AndroidCommonDoc — Catálogo de Adopción Enterprise

Esto NO es un paquete todo-o-nada. Cada módulo es **adoptable independientemente**. Elige lo que resuelva tu problema — ignora el resto.

## Cómo Usar Este Documento

1. Lee el [Catálogo de Módulos](#catálogo-de-módulos) — cada módulo tiene: qué es, qué necesita, qué te da
2. Consulta el [Mapa de Dependencias](#mapa-de-dependencias) — algunos módulos funcionan mejor juntos pero ninguno es obligatorio
3. Empieza por las [Quick Wins](#puntos-de-partida-recomendados)
4. Para visibilidad de management: [Dashboard de Coverage](#módulo-7-dashboard-de-coverage-para-stakeholders)

## Estrategia de Fork

```
Opción A: Fork completo (GitHub/GitLab interno)
  → Clonar todo, eliminar lo que no se necesite
  → Pro: todo disponible para explorar
  → Con: carga de mantenimiento en partes no usadas

Opción B: Cherry-pick de módulos (recomendado)
  → Copiar solo los directorios elegidos del catálogo
  → Pro: footprint mínimo, ownership claro
  → Con: actualizaciones manuales cuando L0 evolucione

Opción C: Git subtree / submodule
  → Referenciar L0 como subtree en tu proyecto
  → Pro: actualizaciones upstream vía git pull
  → Con: requiere expertise Git, puede conflictuar con políticas corporativas
```

---

## Catálogo de Módulos

### Módulo 1: Reglas Detekt de Arquitectura

**Qué:** 19 reglas Detekt custom que enforce patrones arquitectónicos en compile-time. Detecta violaciones de sealed-interface, CancellationException tragada, credenciales hardcodeadas, imports prohibidos en commonMain.

**Necesita:** Detekt 2.x en tu build Gradle. Ninguna otra dependencia de L0.

**Te da:**
- Violaciones detectadas en IDE (tiempo real) y CI (gate de PR)
- Zero revisión manual para violaciones de patrones
- Reglas configurables por proyecto vía `detekt.yml`

**Funciona sin:** Todo lo demás. Plugin Gradle puro.

**Ideal para:** Cualquier equipo que quiera enforcement automático de arquitectura.

---

### Módulo 2: Workflows CI (GitHub Actions)

**Qué:** 14 workflows reutilizables — commit linting, README audit, Detekt, paridad de agentes, coverage, monitoreo de docs, KMP safety checks.

**Necesita:** GitHub Actions.

**Te da:**
- Gate de PR: commit-lint, pattern-lint, Detekt, validación de counts
- Semanal: monitoreo de fuentes upstream, validación de docs
- On-demand: audit completo, suite de coverage

**Funciona sin:** Agentes, MCP server, pattern docs.

**Ideal para:** Equipos en GitHub Actions que quieren gates de PR estandarizados.

---

### Módulo 3: Sistema de Agentes IA (Claude Code)

**Qué:** 15 agentes especializados + 5 templates. Dev-lead orquesta, especialistas (test, UI, security, release) ejecutan tareas de dominio.

**Necesita:** Claude Code (Anthropic).

**Te da:**
- `dev-lead`: planifica, delega a especialistas
- `test-specialist`: escribe tests, quality-over-coverage, e2e obligatorio
- `ui-specialist`: accessibility Compose, previews, strings hardcodeados
- `release-guardian`: scan pre-release (debug flags, secrets, URLs dev)

**Funciona sin:** MCP server, CI, Detekt. Los agentes funcionan standalone.

**Ideal para:** Equipos usando Claude Code que quieren workflows multi-agente estructurados.

---

### Módulo 4: Copilot Instructions + Adaptador

**Qué:** Instrucciones custom para GitHub Copilot generadas desde patrones L0. Adaptador que convierte agentes Claude a prompts Copilot.

**Necesita:** GitHub Copilot Enterprise o Individual.

**Te da:**
- Sugerencias de Copilot alineadas con patrones del equipo
- Script adaptador: `adapters/copilot-agent-adapter.sh`

**Funciona sin:** Claude Code, MCP, CI. Mejora pura de Copilot.

**Ideal para:** Equipos en Copilot que quieren sugerencias convention-aware.

---

### Módulo 5: Documentación de Patrones (97 docs)

**Qué:** 15 hubs de dominio, 55 sub-docs, 16 guías — todo con frontmatter YAML para integración con tooling. Cubre ViewModel, Compose, Navigation, Testing, DI, Offline-first, Security, Storage, arquitectura KMP.

**Necesita:** Nada. Archivos Markdown legibles por cualquiera.

**Te da:**
- Patrones de arquitectura con ejemplos de código
- Anti-patrones con explicaciones
- Assertions `validate_upstream` que verifican contra docs oficiales

**Funciona sin:** Todo lo demás. Conocimiento standalone.

**Ideal para:** Cualquier equipo que quiera estándares documentados y buscables.

---

### Módulo 6: MCP Server (32 herramientas)

**Qué:** Servidor Model Context Protocol con 32 tools — validación de patrones, health de módulos, grafos de dependencia, métricas, validación de docs, análisis de coverage.

**Necesita:** Node.js 24+. Herramienta compatible MCP (Claude Desktop, Claude Code).

**Te da:**
- `audit-docs`: validación de docs en 3 waves
- `monitor-sources`: detección de drift de versiones upstream
- `module-health`: tests, coverage, complejidad por módulo
- 29 herramientas más

**Funciona sin:** Agentes, CI, Copilot. Las herramientas CLI funcionan standalone.

**Ideal para:** Equipos que quieren acceso programático a herramientas de validación.

---

### Módulo 7: Dashboard de Coverage para Stakeholders

**Qué:** Pipeline CI que genera historial de coverage, lo almacena como artifacts, y alimenta un dashboard visible para stakeholders no técnicos.

**Necesita:** GitHub Actions + herramienta de visualización (Power BI, Grafana, o HTML simple).

**Arquitectura:**
```
CI (cada PR/merge)                    Dashboard (semanal)
┌──────────────────────┐              ┌──────────────────────┐
│ ./gradlew koverXml   │              │ Power BI / Grafana   │
│         ↓            │              │                      │
│ Parsear XML reports  │──artifacts──▶│ Tendencias coverage  │
│         ↓            │              │ Desglose por módulo  │
│ Append a             │              │ Heatmap de riesgo    │
│ coverage-history.json│              │ Sprint-over-sprint   │
└──────────────────────┘              └──────────────────────┘
```

**El dashboard muestra (para management):**
- Tendencia overall de coverage (gráfico de línea con límites de sprint)
- Desglose por módulo (barras, coloreado: verde >95%, amarillo >80%, rojo <80%)
- Módulos de riesgo (tabla: menor coverage, más churn, menos tests)
- Delta de sprint ("+2.3% este sprint, 3 módulos mejoraron, 1 regresó")

**Funciona sin:** Agentes, MCP, docs. Pipeline CI + datos pura.

**Ideal para:** Equipos cuyo management quiere visibilidad de calidad sin leer código.

---

### Módulo 8: Shell Scripts (28 scripts)

**Qué:** Scripts Bash cross-platform para testing, coverage, pattern linting, gestión de registro, git hooks. Probados en Windows (MSYS2) y Linux (CI).

**Necesita:** Bash. Algunos scripts necesitan `jq`, `python3`, o `node`.

**Funciona sin:** Todo lo demás. Scripts standalone.

---

## Mapa de Dependencias

```
Independientes (sin deps):       Mejor juntos:
┌─────────────────────┐        ┌─────────────────────────────┐
│ Módulo 1: Detekt    │        │ Módulo 3 (Agentes)          │
│ Módulo 5: Docs      │        │   ↕ usa                     │
│ Módulo 8: Scripts   │        │ Módulo 6 (MCP) ← Módulo 2   │
│ Módulo 4: Copilot   │        │   ↕ alimenta       (CI)     │
│ Módulo 7: Dashboard │        │ Módulo 7 (Dashboard)        │
└─────────────────────┘        └─────────────────────────────┘
```

## Puntos de Partida Recomendados

| Situación del equipo | Empieza con | Siguiente |
|---------------------|-------------|-----------|
| "No tenemos estándares" | Módulo 5 (docs) + Módulo 1 (Detekt) | Módulo 8 (scripts) |
| "Los PRs no tienen gates" | Módulo 2 (CI) + Módulo 1 (Detekt) | Módulo 7 (dashboard) |
| "Usamos Claude Code" | Módulo 3 (agentes) + Módulo 6 (MCP) | Módulo 2 (CI) |
| "Usamos Copilot" | Módulo 4 (Copilot) + Módulo 5 (docs) | Módulo 1 (Detekt) |
| "Management quiere métricas" | Módulo 7 (dashboard) + Módulo 2 (CI) | Módulo 1 (Detekt) |
| "Queremos todo" | Fork (Opción A), habilitar progresivamente | — |

## Consideraciones de Seguridad (Banca/Enterprise)

| Módulo | Exposición de datos | ¿Necesita aprobación? |
|--------|--------------------|-----------------------|
| 1. Detekt | Ninguna — corre local + CI | No |
| 2. CI workflows | GitHub Actions (ya aprobado) | No |
| 3. Agentes | Claude Code — código enviado a Anthropic API | **Sí** — LLM con código fuente |
| 4. Copilot | Copilot Enterprise — código en tenant | Verificar política Copilot existente |
| 5. Docs | Ninguna — Markdown estático | No |
| 6. MCP server | Proceso Node.js local | No — salvo validación upstream (Jina) |
| 7. Dashboard | Solo datos de coverage (sin código fuente) | No — métricas numéricas |
| 8. Scripts | Ejecución local | No |

**Módulo 3 (Agentes) y Módulo 6 con validación upstream son los únicos que envían datos externamente.** Todo lo demás corre localmente o dentro de infraestructura corporativa existente.
