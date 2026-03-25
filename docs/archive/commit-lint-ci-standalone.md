---
scope: [ci, commit-lint, conventional-commits]
sources: [androidcommondoc, github-actions]
targets: [android, kmp, any]
version: 1
last_updated: "2026-03"
description: "Guía para adoptar el workflow de Commit Lint en CI sin depender de AndroidCommonDoc. Copy-paste limpio, cero dependencias externas."
slug: commit-lint-ci-standalone
status: archived
layer: L0
category: archive
---

# Commit Lint en CI — Adopción Standalone

Guía para integrar validación de Conventional Commits en tu CI de GitHub Actions **sin depender de AndroidCommonDoc**. Un solo fichero YAML, cero dependencias externas.

## Contexto

AndroidCommonDoc incluye un [reusable workflow](../../.github/workflows/reusable-commit-lint.yml) que valida mensajes de commit contra la spec [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/). Este documento explica qué copiar y cómo adaptarlo para que funcione de forma independiente.

## Qué Se Necesita

| Pieza | Fichero | Dependencias |
|-------|---------|--------------|
| Workflow CI | 1 fichero `.yml` | `actions/checkout@v5` (estándar GitHub) |
| Prompt Copilot | 1 fichero `.md` (opcional) | Ninguna |

**Total: 1 fichero obligatorio. 0 dependencias de AndroidCommonDoc.**

## Workflow Standalone

Copiar a `.github/workflows/commit-lint.yml` en tu proyecto:

```yaml
name: Commit Lint

on:
  pull_request:
    branches: [main, develop]

jobs:
  commit-lint:
    name: "🔤 Commit Lint"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0

      - name: Validate commit messages
        run: |
          BASE="${{ github.event.pull_request.base.sha }}"
          HEAD="${{ github.event.pull_request.head.sha }}"
          RANGE="$BASE..$HEAD"

          echo "Validating commits in range: $RANGE"

          # ── Personalizar para tu proyecto ──────────────────
          VALID_TYPES="feat,fix,docs,style,refactor,perf,test,build,ci,chore,revert"
          VALID_SCOPES=""      # vacío = cualquier scope; o "core,data,ui,feature"
          MAX_LEN=100
          # ───────────────────────────────────────────────────

          TYPE_PATTERN=$(echo "$VALID_TYPES" | tr ',' '|')

          if [ -n "$VALID_SCOPES" ]; then
            SCOPE_LIST=$(echo "$VALID_SCOPES" | tr ',' '|')
            SCOPE_PATTERN="(\(($SCOPE_LIST)\))?"
          else
            SCOPE_PATTERN="(\([a-z0-9/_-]+\))?"
          fi

          FULL_PATTERN="^(${TYPE_PATTERN})${SCOPE_PATTERN}!?: .+"

          ERRORS=0
          COMMIT_COUNT=0

          while IFS= read -r line; do
            [ -z "$line" ] && continue
            COMMIT_COUNT=$((COMMIT_COUNT + 1))
            HASH=$(echo "$line" | cut -d' ' -f1)
            MSG=$(echo "$line" | cut -d' ' -f2-)

            if ! echo "$MSG" | grep -qP "$FULL_PATTERN"; then
              echo "::error::[$HASH] Formato inválido: '$MSG'"
              echo "  Esperado: <type>[scope][!]: <descripción>"
              echo "  Tipos válidos: $VALID_TYPES"
              [ -n "$VALID_SCOPES" ] && echo "  Scopes válidos: $VALID_SCOPES"
              ERRORS=$((ERRORS + 1))
            fi

            DESC=$(echo "$MSG" | sed 's/^[^:]*: //')
            if echo "$DESC" | grep -qP '^[A-Z]'; then
              echo "::error::[$HASH] Descripción empieza con mayúscula: '$DESC'"
              ERRORS=$((ERRORS + 1))
            fi

            if echo "$DESC" | grep -qP '\.$'; then
              echo "::error::[$HASH] Descripción termina con punto: '$DESC'"
              ERRORS=$((ERRORS + 1))
            fi

            if [ ${#MSG} -gt "$MAX_LEN" ]; then
              echo "::warning::[$HASH] Subject supera $MAX_LEN chars (${#MSG})"
            fi

          done < <(git log "$RANGE" --pretty=format:"%h %s")

          echo ""
          echo "Validados $COMMIT_COUNT commit(s)"

          if [ $ERRORS -gt 0 ]; then
            echo "❌ $ERRORS error(es) encontrados"
            exit 1
          fi
          echo "✅ Todos los commits cumplen Conventional Commits v1.0.0"
```

## Puntos de Personalización

| Variable | Qué controla | Valor por defecto |
|----------|-------------|-------------------|
| `VALID_TYPES` | Tipos permitidos | Los 11 de la spec |
| `VALID_SCOPES` | Scopes permitidos (vacío = libre) | `""` |
| `MAX_LEN` | Largo máximo del subject | `100` |
| `branches` en `on.pull_request` | En qué ramas se activa | `[main, develop]` |

### Ejemplo con scopes restrictivos

```yaml
VALID_SCOPES="auth,payments,profile,settings,ci,deps"
```

Con esto, `feat(auth): add biometric login` pasa, pero `feat(login): add biometric` falla.

## Qué Valida

| Regla | Severidad | Ejemplo que falla |
|-------|-----------|-------------------|
| Tipo obligatorio | ERROR | `"added new feature"` |
| Separador `: ` tras tipo/scope | ERROR | `"feat(ui) updated theme"` |
| Scope en lista permitida | ERROR | `"feat(unknown): something"` |
| Descripción en minúscula | ERROR | `"feat: Add login"` |
| Sin punto final | ERROR | `"feat: add login."` |
| Largo del subject | WARNING | Mensajes >100 chars |

Los errores aparecen como **anotaciones inline** en la pestaña Files del PR en GitHub.

## Prompt de Copilot (Opcional)

Si usáis GitHub Copilot, podéis añadir un prompt para que el agente valide commits antes del push. Copiar a `.github/copilot-templates/commit-lint.prompt.md`:

```markdown
---
mode: agent
description: "Validar mensajes de commit contra Conventional Commits v1.0.0."
---

Valida mensajes de commit contra Conventional Commits v1.0.0.

## Formato esperado

<type>[scope][!]: <descripción>

## Tipos válidos

feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert

## Reglas

- El tipo es obligatorio
- El scope es opcional, entre paréntesis: feat(auth): ...
- La descripción va en minúscula, sin punto final
- El subject no supera 100 caracteres
- ! antes de : indica breaking change
- BREAKING CHANGE: en footer debe ir en mayúsculas

## Uso

Validar el último commit:
git log HEAD~1..HEAD --pretty=format:"%H|%s"

Validar un mensaje suelto:
echo "feat(auth): add biometric login" → ✅
echo "Added login" → ❌ falta tipo
```

## Activar como Gate Obligatorio

1. Ve a **Settings → Branches → Branch protection rules** de tu repo
2. Activa **Require status checks to pass before merging**
3. Busca `commit-lint` (o `🔤 Commit Lint`) y márcalo como required
4. A partir de ahí, ningún PR con commits mal formateados podrá mergearse

## Referencia Rápida — Conventional Commits

```
<type>[scope][!]: <descripción>

[cuerpo]

[footer(s)]
```

| Tipo | SemVer | Cuándo usarlo |
|------|--------|---------------|
| `feat` | MINOR | Nueva funcionalidad |
| `fix` | PATCH | Corrección de bug |
| `docs` | — | Solo documentación |
| `style` | — | Formato, sin cambio de código |
| `refactor` | — | Cambio de código sin feat/fix |
| `perf` | PATCH | Mejora de rendimiento |
| `test` | — | Añadir o corregir tests |
| `build` | — | Build system o dependencias |
| `ci` | — | Configuración de CI |
| `chore` | — | Otros cambios (no src/test) |
| `revert` | — | Revierte un commit anterior |

**Breaking changes**: añadir `!` tras tipo/scope O usar footer `BREAKING CHANGE:`. Dispara bump MAJOR.
