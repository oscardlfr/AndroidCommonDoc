<!-- L0 Generic Command -->
<!-- Usage: /metrics [--section SECTION] -->
# /metrics - Project Health Dashboard

Show a health dashboard: LOC, test count, coverage %, doc freshness, feature completion %, and tech debt indicators.

## Usage
```
/metrics [--section SECTION]
```

## Arguments
- `--section` - Show only: `code`, `tests`, `docs`, `features`, `debt`

## Instructions

### Step 1 -- Code Metrics

1. Count lines of Kotlin code (excluding tests and generated)
2. Count source files
3. Count modules (build.gradle.kts files)
4. Count database schema files if applicable

### Step 2 -- Test Metrics

1. Count test files (*Test.kt)
2. Count test functions (@Test annotations)
3. Read latest coverage report if available
4. Calculate overall coverage from CLAUDE.md table

### Step 3 -- Documentation Metrics

1. Count doc files in docs/
2. Check freshness via git log
3. Flag stale docs (not updated in >30 days)

### Step 4 -- Feature Metrics

From feature inventory:
1. Count by status: SHIPPED, SCHEMA_READY, PREPARED, IDEATED
2. Calculate completion percentage

From ROADMAP.md:
1. Count completed phases vs total
2. Count executed plans vs total

### Step 5 -- Tech Debt Indicators

1. Count TODO comments in production code
2. Count FIXME, HACK, XXX comments
3. Count @Suppress annotations
4. Count @Ignore test annotations
5. Count !! non-null assertions in production Kotlin

### Step 6 -- Output Dashboard

```
Project Health Dashboard -- YYYY-MM-DD

CODE
  Lines of Kotlin: ~XX,XXX (N files)
  Modules: N

TESTS
  Test files: N
  Test functions: N
  Coverage: XX.X% overall

DOCUMENTATION
  Doc files: N
  Stale docs (>30 days): N

FEATURES
  Total: N | Shipped: N (XX%)
  Phase completion: X/Y (XX%)

TECH DEBT
  TODOs: N | FIXMEs: N | @Suppress: N | !! assertions: N
```

### Important Rules

1. **Read-only** -- never modify files
2. **Approximate is fine** -- wc -l is acceptable
3. **No judgment** -- report numbers, let user decide
4. **Fast** -- use Glob/Grep, don't run Gradle
