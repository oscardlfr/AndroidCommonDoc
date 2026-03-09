# Deferred Items - Phase 10

## Pre-existing Issues (Out of Scope)

1. **change-detector.test.ts fails** - `mcp-server/tests/unit/monitoring/change-detector.test.ts` references `../../../src/monitoring/change-detector.js` which does not exist. This appears to be from an incomplete Plan 01 execution. The test file and source-checker files exist but change-detector source was never created. This is Plan 01's responsibility, not Plan 02.
