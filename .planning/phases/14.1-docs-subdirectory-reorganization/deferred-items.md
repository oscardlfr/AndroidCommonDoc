# Deferred Items - Phase 14.1

## Pre-existing Test Failures (Out of Scope)

Discovered during 14.1-01 verification run. These failures exist on the master branch prior to any Phase 14.1 changes.

1. **sync-vault.test.ts** - 3 tests failing (init/sync/clean mode assertions expect `parsed.mode` but get `undefined`)
2. **vault-status.test.ts** - 1 test failing (`parsed.vaultPath` is `undefined` instead of expected path)

These appear to be mock/test wiring issues from a prior MCP SDK version update. Not caused by Phase 14.1 changes.
