<!-- L0 Generic Command -->
<!-- Usage: /sync-roadmap [--dry-run] -->
# /sync-roadmap - Synchronize Roadmap Phases to GSD Directories

Align `.gsd/phases/` directories with ROADMAP.md phase definitions. Creates missing scaffolding so GSD tools can discover all phases.

## Usage
```
/sync-roadmap [--dry-run]
```

## Arguments
- `--dry-run` - Show sync report without creating directories

## Instructions

**CRITICAL: This command NEVER invokes GSD planning/execution commands. It only creates directory scaffolding.**

### Step 1 -- Read Sources

Read `.gsd/ROADMAP.md` and `.gsd/STATE.md`. Scan `.gsd/phases/` for existing directories.

### Step 2 -- Build Phase Registry

From ROADMAP.md, extract every phase. Record number, name, status, and track assignment.

Classify: COMPLETE / ABSORBED / SUPERSEDED / PLANNED

### Step 3 -- Compute Expected Directories

For PLANNED phases, compute expected directory names using zero-padded numbering and kebab-case slugs.

### Step 4 -- Scan and Diff

Compare expected vs existing. Classify: MATCHED / MISSING / ORPHAN.

### Step 5 -- Present Sync Report

Output table showing status of each phase directory.

### Step 6 -- Gate: User Approval

If `--dry-run`, stop here. Otherwise ask for confirmation.

### Step 7 -- Create Missing Directories

Create `.gitkeep` + `CONTEXT.md` for each missing directory.

### Step 8 -- Commit

```
chore(planning): sync roadmap phases to GSD directories
```

### Important Rules

1. **ROADMAP.md is read-only** -- never modify the roadmap
2. **No planning work** -- only directory scaffolding
3. **Idempotent** -- safe to run repeatedly
4. **Skip completed/absorbed** phases
5. **NEVER invoke GSD planning commands**
6. **Orphans are reported, not deleted**
