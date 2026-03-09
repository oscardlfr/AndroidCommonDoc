<!-- L0 Generic Command -->
<!-- Usage: /bump-version [--major|--minor|--patch] [--set VERSION] -->
# /bump-version - Bump Application Version

Bump the version number in `gradle.properties`. Supports semantic versioning with major/minor/patch increments.

## Usage
```
/bump-version [--major|--minor|--patch] [--set VERSION]
```

## Arguments
- `--major` - Bump major version (X.0.0)
- `--minor` - Bump minor version (x.Y.0)
- `--patch` - Bump patch version (x.y.Z) -- default if no flag
- `--set VERSION` - Set to a specific version (e.g., `--set 1.0.0-beta.1`)

## Instructions

### Step 1 -- Read Current Version

Read `gradle.properties` and find the version property. Common patterns:
- `version=X.Y.Z`
- `app.version=X.Y.Z`

Also check `build.gradle.kts` root for version if not in properties.

### Step 2 -- Calculate New Version

Apply semver rules based on the flag provided.

### Step 3 -- Confirm

Display the proposed change. Ask for confirmation.

### Step 4 -- Apply (after confirmation)

1. Edit the version in `gradle.properties`
2. Check for version references in other build files
3. Commit: `chore: bump version to X.Y.Z`

### Important Rules

1. **Confirmation required** -- never bump without user approval
2. **Semantic versioning** -- follow semver rules strictly
3. **Single source** -- `gradle.properties` is the canonical version location
4. **Pre-release labels** -- `--set` supports labels like `1.0.0-beta.1`
