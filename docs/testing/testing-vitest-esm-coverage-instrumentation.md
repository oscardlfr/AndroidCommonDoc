---
slug: testing-vitest-esm-coverage-instrumentation
category: testing
layer: L0
status: active
parent: testing-hub
scope: [vitest, coverage, esm, pool]
sources: [context7:github.com/vitest-dev/vitest/blob/main/docs/guide/improving-performance.md@2026-07-09, context7:github.com/vitest-dev/vitest/blob/main/docs/guide/migration.md@2026-07-09]
targets: [all]
version: 1
last_updated: "2026-07-09"
description: "Vitest 4 defaults: forks pool (not threads) and V8 coverage provider; coverage.all/coverage.extensions removed in favor of coverage.include/coverage.exclude."
token_budget: 500
---

# Vitest 4: Pool Default and Coverage Config Changes

Confirmed against Vitest v4.1.6 docs (`improving-performance.md`, `migration.md`).

## Pool Default Changed: `forks`, Not `threads`

Vitest's default test pool is **`forks`** — chosen for better compatibility. `threads` remains available as an opt-in, documented as slightly faster for some larger projects:

```ts
// vitest.config.ts
export default defineConfig({
  test: {
    pool: 'threads', // explicit opt-in — no longer the default
  },
})
```

If a project's config or docs assume `pool: 'threads'` is the default, that assumption is stale for Vitest 4 — it must now be set explicitly to get that behavior.

There are unverified/anecdotal reports linking the `forks` default to coverage-instrumentation issues in some ESM setups; this doc does not assert a causal mechanism — it isn't confirmed in current Vitest docs. If coverage looks wrong under the default pool, trying `pool: 'threads'` is a reasonable diagnostic step, not a documented fix.

## Coverage Config: `all`/`extensions` Removed

Vitest 4 **removes** `coverage.all` and `coverage.extensions`. Use `coverage.include` / `coverage.exclude` instead — they replace both:

```ts
// vitest.config.ts
export default defineConfig({
  test: {
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts'],
    },
  },
})
```

A config still setting `coverage.all` or `coverage.extensions` after upgrading to Vitest 4 is a migration miss, not a supported no-op.

## Default Coverage Provider

V8 is Vitest's default coverage provider (no `coverage.provider` needed unless switching to `istanbul`).

## Anti-Patterns

- Assuming `pool: 'threads'` is still Vitest's default after upgrading to v4 — it is not; set it explicitly if that behavior is required.
- Leaving `coverage.all`/`coverage.extensions` in a Vitest 4 config — both are removed; migrate to `coverage.include`/`coverage.exclude`.
- Asserting a specific causal mechanism for pool-related coverage anomalies without checking current Vitest docs — treat it as a diagnostic lead, not a documented fact.

## See Also

- [testing-vitest-cjs-esm-mock-boundary](testing-vitest-cjs-esm-mock-boundary.md) — sibling Vitest gotcha doc (require/import mock boundary)
