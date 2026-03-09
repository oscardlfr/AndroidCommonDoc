<!-- L0 Generic Command -->
<!-- Usage: /sync-tech-versions [--dry-run] -->
# /sync-tech-versions - Sync Documentation Versions with Version Catalog

Read `gradle/libs.versions.toml` and compare with technology docs and CLAUDE.md. Auto-fix version mismatches with confirmation.

## Usage
```
/sync-tech-versions [--dry-run]
```

## Arguments
- `--dry-run` - Show mismatches without fixing

## Instructions

### Step 1 -- Read Sources

1. `gradle/libs.versions.toml` -- **canonical source of truth**
2. Technology reference docs (version tables)
3. `CLAUDE.md` -- "Key Dependencies" section

### Step 2 -- Extract and Compare

From `libs.versions.toml`, extract all version entries. For each, search for corresponding mentions in docs. Key mappings: kotlin, agp, compose, koin, coroutines, serialization, sqldelight, ktor, kover, etc.

### Step 3 -- Report Mismatches

```
Version Sync Report

| Library | libs.versions.toml | Docs | CLAUDE.md | Status |
|---------|-------------------|------|-----------|--------|

N mismatches found.
```

### Step 4 -- Apply Fixes (unless --dry-run)

Show mismatch table, ask for approval, update docs to match version catalog, commit.

### Important Rules

1. **libs.versions.toml is always the truth** -- never update it
2. **Preserve formatting** -- match existing doc style
3. **Only touch version numbers** -- don't rewrite text
