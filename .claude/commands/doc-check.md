<!-- L0 Generic Command -->
<!-- Usage: /doc-check [--section SECTION] [--fix] -->
# /doc-check - Validate Documentation Against Code

Cross-validate documentation accuracy: feature validation references against code, version catalog against doc versions, coverage tables, and feature inventory counts.

## Usage
```
/doc-check [--section SECTION] [--fix]
```

## Arguments
- `--section` - Check only: `versions`, `features`, `coverage`, `inventory`
- `--fix` - Auto-fix mismatches with confirmation (otherwise report-only)

## Instructions

### Step 1 -- Read All Sources

Read project documentation and version catalog:
- Product spec with feature validation references
- Feature inventory with status counts
- Technology docs with version numbers
- `gradle/libs.versions.toml` -- canonical dependency versions
- `CLAUDE.md` -- coverage table
- `.gsd/ROADMAP.md` -- phase progress

### Step 2 -- Version Alignment Check

Compare doc version entries against `libs.versions.toml`. Flag mismatches.

### Step 3 -- Feature Validation Check

For features with "Validated by:" blocks, verify referenced files/classes exist. For SHIPPED features, verify validation evidence exists.

### Step 4 -- Coverage Table Check

Compare documented coverage percentages against latest reports. Flag deviations >5%.

### Step 5 -- Inventory Consistency Check

Verify feature counts match actual rows. Cross-reference statuses between docs.

### Step 6 -- Roadmap Consistency Check

Verify plan counts match actual plan files. Verify completion checkboxes.

### Step 7 -- Output Report

Structured mismatch report with categories and severity.

### Step 8 -- Auto-Fix (if --fix)

Present fixable issues for approval, then apply and commit.

### Important Rules

1. **Report-only by default**
2. **libs.versions.toml is always the truth** for versions
3. **No false positives** -- only genuine mismatches
