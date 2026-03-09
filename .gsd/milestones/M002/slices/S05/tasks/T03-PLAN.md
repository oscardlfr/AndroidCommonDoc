# T03: 09-pattern-registry-discovery 03

**Slice:** S05 — **Milestone:** M002

## Description

Implement the three-layer resolver (L0 > L1 > L2 with full replacement semantics) and project auto-discovery from settings.gradle.kts includeBuild paths.

Purpose: This enables per-project pattern customization without forking -- a consuming project can override any L0 pattern doc by placing a same-named file in their .androidcommondoc/docs/ directory, and the resolver picks the highest-priority version automatically.

Output: resolver.ts for layer resolution, project-discovery.ts for consumer detection, extended paths.ts with L1/L2 directory helpers.

## Must-Haves

- [ ] "L0/L1/L2 layer resolution returns the highest-priority doc with full replacement (L1 > L2 > L0)"
- [ ] "Consumer projects are discovered from settings.gradle.kts includeBuild paths pointing to AndroidCommonDoc"
- [ ] "Project discovery falls back to ~/.androidcommondoc/projects.yaml when settings.gradle.kts not parseable"
- [ ] "paths.ts provides L1 and L2 directory resolution functions"

## Files

- `mcp-server/src/registry/resolver.ts`
- `mcp-server/src/registry/project-discovery.ts`
- `mcp-server/src/utils/paths.ts`
- `mcp-server/tests/unit/registry/resolver.test.ts`
- `mcp-server/tests/unit/registry/project-discovery.test.ts`
- `mcp-server/tests/unit/utils/paths.test.ts`
