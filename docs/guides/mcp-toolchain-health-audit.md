---
scope: [guides, mcp, toolchain, audit]
sources: [androidcommondoc]
targets: [android, desktop, ios, jvm]
slug: mcp-toolchain-health-audit
status: active
layer: L0
category: guides
description: "47-tool MCP toolchain health audit matrix covering coverage, fail-mode, cache safety, and rate limiting"
version: 1
last_updated: "2026-05-25"
parent: guides-hub
---

# MCP Toolchain Health Audit

Point-in-time health snapshot of all 47 registered MCP tools in the AndroidCommonDoc server.

## Column Definitions

| Column | Meaning |
|--------|---------|
| **Registered** | Tool appears in `mcp-server/src/tools/index.ts` `registerTools()` call |
| **Tested** | Dedicated unit test file exists under `mcp-server/tests/unit/tools/<name>.test.ts` |
| **Documented** | Tool listed in the `mcp-server/README.md` tools table (L132+) |
| **FailModeOK** | Tool returns a structured error (non-exception status) on expected failure paths — not a thrown unhandled exception |
| **CacheOK** | Tool writes/reads a persistent cache for expensive operations; `n/a` when caching not applicable |
| **RateLimited** | Tool passes the shared `rateLimiter` to its registration call; `exempt (meta)` for the meta utility tool |

## Methodology

- **Source**: `mcp-server/src/tools/index.ts` L72–141, registration order preserved as audit order
- **Tested**: cross-referenced against `mcp-server/tests/unit/tools/` directory listing
- **Documented**: cross-referenced against `mcp-server/README.md` tools table (L132–140 as of 2026-05-25; stale — only 7 tools listed)
- **FailModeOK**: assessed per-tool via source review; FAIL rows have remediation notes below the table
- **CacheOK**: only `check-outdated` uses `writeKDocState` for persistent caching; `audit-docs` accepts `cacheTtlHours` but this is a script-side concern (see footnote)
- **RateLimited**: all tools registered via `register*(server, rateLimiter)` pattern pass the shared limiter; `rate-limit-status` is inline with no limiter (meta exemption by design)

## Audit Table

| # | Tool | Registered | Tested | Documented | FailModeOK | CacheOK | RateLimited |
|---|------|-----------|--------|-----------|-----------|---------|------------|
| 1 | `check-doc-freshness` (alias: `monitor-sources`) | Y | Y | Y | Y | n/a | Y |
| 2 | `verify-kmp-packages` | Y | N | Y | Y | n/a | Y |
| 3 | `check-version-sync` | Y | N | Y | **FAIL** (F2) | n/a | Y |
| 4 | `script-parity` | Y | N | Y | Y | n/a | Y |
| 5 | `setup-check` | Y | Y | Y | Y | n/a | Y |
| 6 | `validate-all` | Y | Y | Y | Y | n/a | Y |
| 7 | `find-pattern` | Y | Y | N | Y | n/a | Y |
| 8 | `generate-detekt-rules` | Y | Y | N | Y | n/a | Y |
| 9 | `ingest-content` | Y | Y | N | Y | n/a | Y |
| 10 | `monitor-sources` | Y | Y | N | Y | n/a | Y |
| 11 | `sync-vault` | Y | Y | N | Y | n/a | Y |
| 12 | `vault-status` | Y | Y | N | Y | n/a | Y |
| 13 | `validate-doc-structure` | Y | Y | N | Y | n/a | Y |
| 14 | `validate-skills` | Y | Y | N | Y | n/a | Y |
| 15 | `validate-claude-md` | Y | Y | N | Y | n/a | Y |
| 16 | `validate-vault` | Y | Y | N | Y | n/a | Y |
| 17 | `validate-agents` | Y | Y | N | Y | n/a | Y |
| 18 | `audit-report` | Y | N | N | Y | n/a | Y |
| 19 | `module-health` | Y | Y | N | Y | n/a | Y |
| 20 | `dependency-graph` | Y | Y | N | Y | n/a | Y |
| 21 | `l0-diff` | Y | Y | N | Y | n/a | Y |
| 22 | `pattern-coverage` | Y | Y | N | Y | n/a | Y |
| 23 | `unused-resources` | Y | Y | N | Y | n/a | Y |
| 24 | `api-surface-diff` | Y | Y | N | Y | n/a | Y |
| 25 | `migration-validator` | Y | Y | N | Y | n/a | Y |
| 26 | `code-metrics` | Y | Y | N | Y | n/a | Y |
| 27 | `skill-usage-analytics` | Y | Y | N | Y | n/a | Y |
| 28 | `gradle-config-lint` | Y | Y | N | Y | n/a | Y |
| 29 | `string-completeness` | Y | Y | N | Y | n/a | Y |
| 30 | `compose-preview-audit` | Y | Y | N | Y | n/a | Y |
| 31 | `android-layout-diff` | Y | Y | N | Y | n/a | Y |
| 32 | `compose-semantic-diff` | Y | Y | N | Y | n/a | Y |
| 33 | `android-cli-bridge` | Y | Y | N | Y | n/a | Y |
| 34 | `proguard-validator` | Y | Y | N | Y | n/a | Y |
| 35 | `audit-docs` | Y | N | N | Y | n/a* | Y |
| 36 | `findings-report` | Y | Y | N | Y | n/a | Y |
| 37 | `search-docs` | Y | Y | N | Y | n/a | Y |
| 38 | `suggest-docs` | Y | Y | N | Y | n/a | Y |
| 39 | `kdoc-coverage` | Y | Y | N | Y | n/a | Y |
| 40 | `validate-doc-update` | Y | Y | N | Y | n/a | Y |
| 41 | `check-doc-patterns` | Y | Y | N | Y | n/a | Y |
| 42 | `check-outdated` | Y | Y | N | **FAIL** (F1) | Y | Y |
| 43 | `scan-secrets` | Y | Y | N | Y | n/a | Y |
| 44 | `doc-readability` | Y | Y | N | Y | n/a | Y |
| 45 | `search-patterns` | Y | Y | N | Y | n/a | Y |
| 46 | `tool-use-analytics` | Y | Y | N | Y | n/a | Y |
| 47 | `rate-limit-status` | Y | N | Y | Y | n/a | exempt (meta) |

*`audit-docs` accepts `cacheTtlHours` parameter — cache logic is script-side, not in the MCP tool layer.

## FAIL Row Remediation

### Row 3: `check-version-sync` — FailModeOK = FAIL (F2, fixed in BL-W47-prep-15)

**Bug**: When no consumer paths are configured, the tool returned `status: "PASS"` with `"0 passed, 0 failed out of 0 checks"` — a false positive. The `ValidationStatus` type union lacked a distinct value for this state.

**Fix** (BL-W47-prep-15 C2): Added `"NO_CONSUMERS_CONFIGURED"` to `ValidationStatus` union in `mcp-server/src/types/results.ts`. Tool now returns `status: "NO_CONSUMERS_CONFIGURED"` with guidance: `"Pass --consumer-paths or configure in MCP call args"`.

**Test**: `mcp-server/tests/unit/tools/check-version-sync.test.ts` — `parseOutput("", "", 0, 0).status === "NO_CONSUMERS_CONFIGURED"`.

### Row 42: `check-outdated` — FailModeOK = FAIL (F1, fixed in BL-W47-prep-15)

**Bug**: When all network fetches failed (e.g. TypeError), `errors.length=N` but `outdated.length=0` caused `buildResult()` to return `status: "UP_TO_DATE"` — a false positive. Cache was then written unconditionally, poisoning future calls.

**Fix** (BL-W47-prep-15 C1): Added `"PARTIAL"` to `CheckOutdatedResult.status` union. `buildResult()` now returns `status: "PARTIAL"` when all fetches fail. Cache write guarded by error-count threshold.

**Test**: `mcp-server/tests/unit/tools/check-outdated.test.ts` — all-fetch-fail spy asserts `status="PARTIAL"` and `writeKDocState` not called.

## Untested Tools — Remediation

Tools with Tested = N (5 tools): `verify-kmp-packages`, `check-version-sync`, `script-parity`, `audit-report`, `rate-limit-status`.

- `verify-kmp-packages`, `script-parity`: use `runScript()` shell runner — tests require controlled script fixtures or direct `parseOutput()` exercise.
- `check-version-sync`: F2 fixed in this wave; test added in C2.
- `audit-report`: uses `server.tool()` variant — add unit test for result aggregation logic.
- `rate-limit-status`: meta utility; inline handler is trivial. Low priority.

## Undocumented Tools — Remediation

The `mcp-server/README.md` tools table covers only 7 of 47 tools (stale since original 6-tool set). 40 tools have Documented = N.

**Recommended action**: Update `mcp-server/README.md` tools table to cover all 47 tools. Scope: separate wave, low blast radius.

## Audit Cadence

This audit was produced on **2026-05-25** as part of wave BL-W47-prep-15.

Next review: recommended at BL-W49 or after any batch of new tool registrations. Trigger conditions: new tool merged, FailModeOK regression reported, CacheOK policy change.
