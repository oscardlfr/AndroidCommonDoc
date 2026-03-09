<!-- L0 Generic Command -->
<!-- Usage: /lint-resources [--module-path PATH] [--strict] [--check-swift-sync] [--output-format FMT] -->
# /lint-resources - Validate String Resource Naming

Validate string resource naming conventions (snake_case, prefixes, duplicates, Swift sync). Use when checking resource files or before merging UI changes.

## Usage
```
/lint-resources
/lint-resources --module-path feature/home
/lint-resources --strict
/lint-resources --check-swift-sync
/lint-resources --output-format json
```

## Arguments
- `--project-root` - Project root directory (default: current working directory).
- `--module-path` - Specific module to check (relative to project root).
- `--strict` - Fail on warnings in addition to errors.
- `--show-details` - Show matched lines for each violation.
- `--check-swift-sync` - Compare Compose keys against `.xcstrings`.
- `--output-format` - Output format: `human` (default) or `json`.

## Instructions

### Step 1 -- Detect Platform and Run Script

**macOS / Linux:**
```bash
bash scripts/sh/lint-resources.sh [OPTIONS]
```

**Windows (PowerShell):**
```powershell
pwsh scripts/ps1/lint-resources.ps1 [OPTIONS]
```

Pass through all user-provided flags to the script.

### Step 2 -- Report Results

Show the script output directly. If there are errors, explain each violation and suggest fixes.

### Step 3 -- Suggest Fixes

For each ERROR, propose the corrected key name:
- camelCase → snake_case: `homeTitle` → `home_title`
- uppercase → lowercase: `Home_Title` → `home_title`
- invalid chars → remove: `home-title` → `home_title`

### Important Rules

1. **Read-only** -- never modify strings.xml files automatically
2. **snake_case** -- all keys must be lowercase with underscores only
3. **Prefix convention** -- `common_`, `error_`, `a11y_`, or `{feature}_`
4. **Format** -- `{category}_{entity}_{descriptor}` (at least one underscore)
