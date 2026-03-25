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

## Cómo Activar en Tu Proyecto

### Paso 1 — Copiar el fichero YAML

Crea el fichero `.github/workflows/commit-lint.yml` en la rama principal de tu repositorio (normalmente `main` o `master`). El directorio `.github/workflows/` es donde GitHub Actions busca los workflows automáticamente.

```
mi-proyecto/
├── .github/
│   └── workflows/
│       └── commit-lint.yml   ← copiar aquí el YAML de arriba
├── src/
└── ...
```

> **Importante:** el fichero debe estar en la rama destino del PR (la rama base). Si tus PRs van a `main`, el workflow debe existir en `main`. GitHub Actions lee los workflows de la rama base, no de la rama del PR.

### Paso 2 — Configurar las ramas destino

El bloque `on:` del YAML controla cuándo se ejecuta. Por defecto valida PRs que apunten a `main` o `develop`:

```yaml
on:
  pull_request:
    branches: [main, develop]
```

Esto significa que **toda PR** que apunte a esas ramas disparará la validación automáticamente. No hay que hacer nada más — cualquier developer que abra un PR verá el check.

**Variantes comunes:**

```yaml
# Solo la rama principal
on:
  pull_request:
    branches: [main]

# Todas las ramas (útil si usáis Git Flow con release/*, hotfix/*, etc.)
on:
  pull_request:

# Ramas específicas con patrón
on:
  pull_request:
    branches: [main, develop, 'release/**']
```

### Paso 3 — Hacer el primer merge a la rama base

Haz commit y merge del fichero a la rama base (ej. `main`):

```bash
git checkout main
git add .github/workflows/commit-lint.yml
git commit -m "ci: add commit-lint workflow"
git push origin main
```

A partir de este momento, **toda PR nueva** contra `main` ejecutará el check automáticamente. Lo verás en la pestaña "Checks" del PR con el nombre `🔤 Commit Lint`.

### Paso 4 — Hacerlo obligatorio (branch protection)

Sin este paso, el check se ejecuta pero **no bloquea el merge** — un developer puede ignorarlo y mergear igualmente. Para hacerlo obligatorio:

1. Ve a **Settings → Branches** en tu repositorio de GitHub
2. Crea o edita una **Branch protection rule** para la rama `main` (o la que corresponda)
3. Marca **✅ Require status checks to pass before merging**
4. En el buscador que aparece, escribe `Commit Lint` y selecciona `🔤 Commit Lint`
5. (Recomendado) Marca también **✅ Require branches to be up to date before merging**
6. Guarda los cambios

> **Nota:** el check solo aparece en el buscador después de que se haya ejecutado al menos una vez. Si no lo ves, abre un PR de prueba primero para que GitHub lo registre.

### Paso 5 — Verificar

Abre un PR de prueba con un commit intencionalmente mal formateado:

```bash
git checkout -b test/commit-lint
echo "test" > test.txt
git add test.txt
git commit -m "Added test file"   # ← falta tipo, mayúscula inicial
git push origin test/commit-lint
```

Deberías ver en el PR:
- ❌ `🔤 Commit Lint` — failed
- Anotación: `[ERROR] Missing type prefix`
- Anotación: `[ERROR] Description starts with uppercase`
- El botón "Merge" aparece bloqueado (si configuraste branch protection)

Corrige el commit y verifica que pasa:

```bash
git commit --amend -m "test: add test file"
git push --force-with-lease origin test/commit-lint
```

Ahora deberías ver ✅ `🔤 Commit Lint` — passed.

### Resumen visual del flujo

```
Developer abre PR contra main
         │
         ▼
GitHub Actions detecta el trigger pull_request
         │
         ▼
Ejecuta commit-lint.yml
         │
         ├── ✅ Todos los commits válidos → check verde → merge permitido
         │
         └── ❌ Algún commit inválido → check rojo
                  │
                  ├── Sin branch protection → merge posible (pero con warning)
                  └── Con branch protection → merge BLOQUEADO hasta que se corrija
```

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
