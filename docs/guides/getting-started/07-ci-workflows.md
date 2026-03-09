---
title: "Step 7 — CI reusable workflows / Paso 7 — Workflows de CI reutilizables"
slug: getting-started-ci-workflows
category: guides
description: >
  Import the four reusable workflow_call workflows into any L1/L2 project
  for instant CI coverage. / Importar los cuatro workflows reutilizables
  workflow_call en cualquier proyecto L1/L2 para CI inmediato.
last_updated: "2026-03-18"
---

# Step 7 — CI reusable workflows

---

## English

AndroidCommonDoc ships four `workflow_call` reusable workflows. A downstream
project imports them in its own `ci.yml` — no copy-paste, no drift.

### Available workflows

| Workflow file | What it checks |
|---------------|---------------|
| `reusable-commit-lint.yml` | Conventional Commits format on PR title and commits |
| `reusable-lint-resources.yml` | Android resource naming conventions (`snake_case`, prefixes) |
| `reusable-kmp-safety-check.yml` | KMP source set imports — no platform deps in `commonMain` |
| `reusable-architecture-guards.yml` | Detekt + Konsist structural guards |

### Minimal `ci.yml` for a downstream project

Create `.github/workflows/ci.yml` in your L1 or L2 project:

```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:

jobs:
  commit-lint:
    uses: <org>/AndroidCommonDoc/.github/workflows/reusable-commit-lint.yml@master

  lint-resources:
    uses: <org>/AndroidCommonDoc/.github/workflows/reusable-lint-resources.yml@master
    with:
      project-root: ${{ github.workspace }}

  kmp-safety:
    uses: <org>/AndroidCommonDoc/.github/workflows/reusable-kmp-safety-check.yml@master

  architecture-guards:
    uses: <org>/AndroidCommonDoc/.github/workflows/reusable-architecture-guards.yml@master
    with:
      project-root: ${{ github.workspace }}
```

### Adding project-specific jobs

Extend the same `ci.yml` with project-owned jobs — they run in parallel:

```yaml
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'
      - run: ./gradlew test --parallel
```

### Pin to a specific L0 version

Replace `@master` with a tag or SHA for reproducible builds:

```yaml
uses: <org>/AndroidCommonDoc/.github/workflows/reusable-commit-lint.yml@v2.0.0
```

### Viewing the template

A full `ci.yml` example with all jobs and common project-specific additions is
at `setup/github-workflows/ci-template.yml` in this repo.

---

## Castellano

AndroidCommonDoc incluye cuatro workflows reutilizables con disparo
`workflow_call`. Un proyecto descendente los importa en su propio `ci.yml`
— sin copiar-pegar, sin deriva.

### Workflows disponibles

| Fichero del workflow | Qué comprueba |
|----------------------|--------------|
| `reusable-commit-lint.yml` | Formato Conventional Commits en título de PR y commits |
| `reusable-lint-resources.yml` | Convenciones de nomenclatura de recursos Android (`snake_case`, prefijos) |
| `reusable-kmp-safety-check.yml` | Imports en source sets KMP — sin dependencias de plataforma en `commonMain` |
| `reusable-architecture-guards.yml` | Guardias estructurales Detekt + Konsist |

### `ci.yml` mínimo para un proyecto descendente

Crea `.github/workflows/ci.yml` en tu proyecto L1 o L2:

```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:

jobs:
  commit-lint:
    uses: <org>/AndroidCommonDoc/.github/workflows/reusable-commit-lint.yml@master

  lint-resources:
    uses: <org>/AndroidCommonDoc/.github/workflows/reusable-lint-resources.yml@master
    with:
      project-root: ${{ github.workspace }}

  kmp-safety:
    uses: <org>/AndroidCommonDoc/.github/workflows/reusable-kmp-safety-check.yml@master

  architecture-guards:
    uses: <org>/AndroidCommonDoc/.github/workflows/reusable-architecture-guards.yml@master
    with:
      project-root: ${{ github.workspace }}
```

### Añadir jobs específicos del proyecto

Extiende el mismo `ci.yml` con jobs propios — se ejecutan en paralelo:

```yaml
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'
      - run: ./gradlew test --parallel
```

### Fijar una versión específica de L0

Reemplaza `@master` por un tag o SHA para builds reproducibles:

```yaml
uses: <org>/AndroidCommonDoc/.github/workflows/reusable-commit-lint.yml@v2.0.0
```

### Ver la plantilla completa

Un ejemplo completo de `ci.yml` con todos los jobs y las adiciones más
comunes específicas de proyecto está en `setup/github-workflows/ci-template.yml`
de este repositorio.

---

→ Next / Siguiente: [Step 8 — Verify and troubleshoot](08-verify.md)
