<!-- L0 Generic Command -->
<!-- Usage: /pre-release [--quick] [--skip CHECKS] -->
# /pre-release - Pre-Release Validation Checklist

Orchestrator that runs all validation checks in sequence and produces a pass/fail checklist.

## Usage
```
/pre-release [--quick] [--skip CHECKS]
```

## Arguments
- `--quick` - Skip slow checks (full test suite, coverage)
- `--skip` - Comma-separated list of checks to skip

## Instructions

Run each check sequentially. Record PASS/FAIL/SKIP for each.

### Checklist Items

#### 1. Documentation Alignment
Run `/doc-check` logic. Record issues found.
- PASS: 0 issues | WARN: 1-5 | FAIL: 6+ or any CRITICAL

#### 2. String/Resource Validation
Validate string resources and i18n completeness.
- PASS: 0 missing | FAIL: Any missing

#### 3. Migration Integrity
Validate database schema integrity if applicable.
- PASS: Clean | FAIL: Issues found

#### 4. Full Test Suite (skipped with --quick)
Run the project test suite.
- PASS: All pass | FAIL: Any failure

#### 5. KMP Architecture
Run `/verify-kmp` logic.
- PASS: 0 violations | WARN: Warnings only | FAIL: Errors

#### 6. TODO/FIXME Scan
Search for unresolved items in production code.
- PASS: 0 items | WARN: 1-10 | FAIL: 11+

#### 7. Debug Logging Scan
Search for debug artifacts that shouldn't ship:
- println, System.out, console.log, debugLog
- Hardcoded localhost URLs
- TODO("Not yet implemented") that would crash
- PASS: 0 artifacts | WARN: 1-5 | FAIL: 6+

### Output Report

```
Pre-Release Checklist -- YYYY-MM-DD

| # | Check | Status | Details |
|---|-------|--------|---------|

OVERALL: PASS (X pass, Y warn, 0 fail)
-- or --
OVERALL: FAIL (blockers listed)
```

### Important Rules

1. **Sequential execution** -- run in order
2. **Always complete** -- run all checks even if early ones fail
3. **WARN vs FAIL** -- WARNs don't block, FAILs do
4. **--quick skips only slow checks**
5. **Clear blockers** -- list exactly what needs fixing
