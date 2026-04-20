---
name: validate-upstream
description: "Validate pattern docs against upstream official documentation. Runs Layer 1 deterministic assertions (api_present, deprecation_scan, etc.) from validate_upstream frontmatter. Use when checking if docs are still accurate."
intent: [validate, upstream, docs, assertions, deprecation, accuracy]
allowed-tools: [Bash, Read, Grep, Glob]
disable-model-invocation: true
copilot: true
copilot-template-type: behavioral
---

## Usage Examples

```
/validate-upstream                                      # all docs with validate_upstream
/validate-upstream --layer L1 --project-root /path/to/l1
/validate-upstream --slug viewmodel-state-patterns      # single doc
```

## Parameters

- `--project-root PATH` -- Target project root (default: cwd).
- `--layer L0|L1|L2` -- Project layer (default: L0).
- `--slug SLUG` -- Validate a specific doc only (by frontmatter slug).

## Behavior

1. Scan docs for `validate_upstream` frontmatter entries.
2. Fetch upstream content (cached if fresh). Source is routed by URL scheme:
   - `kb://android/...`  → Google Android CLI local KB (offline-capable after first run).
   - `https://...`       → Jina Reader, raw HTTP fallback.
3. Run assertions against fetched content.
4. Report findings with severity and remediation context.

## Implementation

```bash
node mcp-server/build/cli/audit-docs.js --project-root "$(pwd)" --with-upstream --waves 3
```

## Cross-References

- Parent skill: `/audit-docs` (Wave 3 = validate-upstream)
- Assertion engine: `mcp-server/src/monitoring/assertion-engine.ts`
- Content fetcher: `mcp-server/src/monitoring/content-fetcher.ts`
