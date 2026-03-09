<!-- L0 Generic Command -->
<!-- Usage: /verify-migrations [--verbose] -->
# /verify-migrations - Validate Database Schema Integrity

Run migration verification to ensure database schema files are consistent and migrations apply cleanly.

## Usage
```
/verify-migrations [--verbose]
```

## Arguments
- `--verbose` - Show detailed migration analysis

## Instructions

### Step 1 -- Run Validator

Run the project's migration verification script if one exists. Capture and display output.

### Step 2 -- Additional Schema Checks (if --verbose)

1. **Count schema files**: Glob database schema files (e.g., `**/*.sq`)
2. **Count migration files**: Glob migration files (e.g., `**/*.sqm`)
3. **Check migration ordering**: Verify sequential numbering
4. **AfterVersion callbacks**: Check for data migration pattern usage
5. **INSERT in migrations**: Flag INSERT statements that should use callbacks instead

### Step 3 -- Output Report

```
Migration Verification -- YYYY-MM-DD

SCHEMA SUMMARY:
  Schema files: N
  Migration files: N

ISSUES:
  [WARN] INSERT found in migration N -- should use callback

Status: PASS / FAIL (N issues)
```

### Important Rules

1. **Read-only** -- never modify schema or migration files
2. **Trust the script** -- project validator is primary
3. **Verbose adds context** but does not replace script output
