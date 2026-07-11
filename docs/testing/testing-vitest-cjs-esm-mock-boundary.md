---
slug: testing-vitest-cjs-esm-mock-boundary
category: testing
layer: L0
status: active
parent: testing-hub
scope: [vitest, mocking, esm, cjs]
sources: [context7:github.com/vitest-dev/vitest/blob/main/docs/guide/mocking/modules.md@2026-07-09]
targets: [all]
version: 1
last_updated: "2026-07-09"
description: "vi.mock only intercepts import-based module loads, not require(); async-factory mocks throw on require() load; vi.mock is hoisted, vi.doMock is not."
token_budget: 500
---

# Vitest: `vi.mock` Only Covers `import`, Not `require()`

Confirmed against Vitest v4.1.6 docs.

## The Boundary

`vi.mock()` intercepts module resolution for `import`-based loads only. A module loaded via CommonJS `require()` — even one that Vitest has hoisted a `vi.mock()` call for — is **not** intercepted; `require()` resolves to the real, unmocked module.

## Async-Factory Mocks and `require()`

A mock factory using top-level `await` (e.g., calling `importOriginal()` inside the factory to spread the real module and override specific exports) is inherently asynchronous:

```ts
vi.mock('./some-module', async () => {
  const actual = await vi.importOriginal<typeof import('./some-module')>('./some-module')
  return { ...actual, someExport: vi.fn() }
})
```

If anything in the test (or in code the test exercises) subsequently loads that same module via `require()` instead of `import`, the load **throws** — not a Vitest bug, but the direct consequence of `require()` being synchronous and unable to await the async mock factory. Vitest doesn't mock builtin/`node_modules` packages by default, which is why this restriction rarely surfaces in practice — it only matters when test code (or a transitive local import) mixes `require()` and `import` for the SAME mocked local module.

## Hoisting: `vi.mock` vs `vi.doMock`

- `vi.mock(path, factory)` — hoisted to the top of the file by Vitest's transform, before any imports. Applies regardless of where in the file it's written.
- `vi.doMock(path, factory)` — **not** hoisted. Only affects **dynamic** `import()` calls that occur after `vi.doMock` actually executes in file order; static top-level `import` statements are unaffected because they've already been resolved by the time `vi.doMock` runs.

## Anti-Patterns

- Mixing `require()` and `import` for the same local module inside one test file and expecting a `vi.mock()` on that module to cover both.
- Reaching for `vi.doMock` expecting hoisting semantics — if the mock must apply before static imports resolve, use `vi.mock`.
- Debugging an async-factory-mock `require()` throw as a Vitest defect — it is the expected consequence of a synchronous load meeting an asynchronous factory.

## See Also

- [testing-vitest-esm-coverage-instrumentation](testing-vitest-esm-coverage-instrumentation.md) — sibling Vitest gotcha doc (coverage pool defaults)
