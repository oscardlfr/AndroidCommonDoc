<!-- GENERATED from skills/kdoc-migrate/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Full-project KDoc migration orchestrator. Adds KDoc to all undocumented public APIs, module by module, informed by pattern docs."
---

Full-project KDoc migration orchestrator. Adds KDoc to all undocumented public APIs, module by module, informed by pattern docs.

## Instructions

## Usage Examples

```
/kdoc-migrate                                    # full project migration
/kdoc-migrate --module core-domain               # single module
/kdoc-migrate --priority-only                    # interfaces + sealed classes only
/kdoc-migrate --dry-run                          # report gaps without generating
/kdoc-migrate --project-root ../shared-kmp-libs  # cross-project
```

## Parameters

- `--project-root PATH` -- Target project root (default: cwd).
- `--module MODULE` -- Single module to migrate (default: all modules).
- `--priority-only` -- Only document public interfaces and sealed classes (highest value).
- `--dry-run` -- Report undocumented APIs without writing KDoc.

## Behavior

### Step 1: Gap Analysis

1. Run `kdoc-coverage --all` → get full gap report per module
2. Sort modules by dependency order: core → domain → data → features
3. Sort symbols by priority: interfaces > sealed classes > classes > functions > properties
4. Display summary: total undocumented, per module, estimated effort

### Step 2: Module-by-Module Migration

For each module (or single `--module`):

1. **Gather context**: call `find-pattern` MCP tool with `scope={module_domain}` to get related pattern docs
2. **Read existing KDoc**: sample 2-3 documented APIs in same package for style reference
3. **Generate KDoc**: for each undocumented API:
   - Read the function/class signature and implementation
   - Read related pattern docs for contract context
   - Write KDoc that describes the **contract**, not the implementation
   - Include `@param`, `@return`, `@throws` where applicable
4. **Validate**: run `kdoc-coverage` on the module → verify coverage improved

### Step 3: Baseline Report

1. Run `kdoc-coverage --all` → final report
2. Coverage persisted to `audit-log.jsonl` → Step 0.5 uses this as baseline
3. Run `/generate-api-docs` if Dokka pipeline is configured → refresh docs/api/

## Rules

1. **Pattern-informed KDoc**: KDoc references the pattern, not just the signature. If pattern doc says "events via SharedFlow(replay=0)", KDoc MUST mention SharedFlow.
2. **No stubs**: `/** TODO */` or `/** See [ClassName] */` without real content = rejected. Real documentation or skip.
3. **Contract over implementation**: KDoc describes WHAT and WHY, not HOW. "Fetches projects from remote API" not "calls ktor client get with auth header".
4. **Module-by-module**: one Agent per module with fresh context. Prevents context bloat.
5. **Existing dev agents**: domain-model-specialist for domain/model, data-layer-specialist for data, ui-specialist for UI. They understand the code.

## Output

```markdown
## KDoc Migration Report

### Before
| Module | Coverage |
|--------|----------|
| core-domain | 12% |
| core-data | 8% |

### After
| Module | Coverage | Added |
|--------|----------|-------|
| core-domain | 85% | +32 KDoc blocks |
| core-data | 82% | +28 KDoc blocks |

### Skipped (no pattern context)
- `InternalHelper` (core-data) — utility class, no public API contract
```
