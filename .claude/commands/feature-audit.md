<!-- L0 Generic Command -->
<!-- Usage: /feature-audit [--strict] -->
# /feature-audit - Audit Incomplete Features Visible in UI

Flag features with status PREPARED or SCHEMA_READY that are visible in the UI but non-functional. Outputs a table of: hide, finish, or disable before public release.

## Usage
```
/feature-audit [--strict]
```

## Arguments
- `--strict` - Treat SCHEMA_READY as a blocker (default: warning)

## Instructions

### Step 1 -- Read Feature Status

Read feature inventory for all PREPARED or SCHEMA_READY features.

### Step 2 -- Check UI Visibility

For each incomplete feature, search for UI presence in:
- Compose screens (`feature/*/src/composeMain/`)
- ViewModels (`feature/*/src/commonMain/`)
- App navigation and route definitions

Classify visibility: VISIBLE / HIDDEN / PARTIAL
Classify risk: BLOCKER / CONFUSING / SAFE

### Step 3 -- Output Report

```
Feature Visibility Audit

| # | Feature | Status | Visibility | Risk | Recommendation |
|---|---------|--------|------------|------|----------------|

BLOCKERS (must fix before release): N
CONFUSING (should fix): M
SAFE (no action): P
```

### Important Rules

1. **Read-only** -- report only, never modify code
2. **User perspective** -- think about what a user would see
3. **Conservative** -- flag uncertain items for review
4. **Actionable output** -- every flag needs a recommendation
