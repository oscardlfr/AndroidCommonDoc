<!-- L0 Generic Command -->
<!-- Usage: /doc-update [--ref REF] [--since DATE] -->
# /doc-update - Update Documentation from Code Changes

Read `git diff`, match changed files to feature inventory modules, propose status changes, and update documentation after approval.

## Usage
```
/doc-update [--ref REF] [--since DATE]
```

## Arguments
- `--ref REF` - Compare against a specific git ref (default: HEAD~1)
- `--since DATE` - Show changes since date

## Instructions

### Step 1 -- Detect Code Changes

Determine diff range and collect changed files.

### Step 2 -- Read Current Docs

Read product spec, feature inventory, technology docs, and CLAUDE.md.

### Step 3 -- Map Changes to Features

For each changed file: determine module, related features, and change type.

### Step 4 -- Propose Status Changes

Valid transitions: IDEATED->PREPARED->SCHEMA_READY->SHIPPED. Evidence required for SHIPPED (implementation + tests + DI wiring).

### Step 5 -- Present for Approval

Display routing table. **DO NOT proceed until user approves.**

### Step 6 -- Apply Updates (after approval)

Update feature statuses, version numbers, coverage tables.

### Step 7 -- Commit

```
docs(update): sync N feature statuses and M version refs with code
```

### Important Rules

1. **Approval gate is mandatory**
2. **Conservative transitions** -- only SHIPPED if tests exist
3. **Never downgrade** statuses
4. **Preserve formatting**
