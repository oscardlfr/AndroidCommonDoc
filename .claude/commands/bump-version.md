<!-- L0 Generic Command -->
<!-- Usage: /bump-version [--major|--minor|--patch] [--set VERSION] -->
# /bump-version - Bump Application Version

Bump the version number following Semantic Versioning. Reads from and writes to `version.properties` (the single source of truth).

## Usage
```
/bump-version [--major|--minor|--patch] [--set VERSION]
```

## Arguments
- `--major` - Bump major version (X.0.0) — breaking changes
- `--minor` - Bump minor version (x.Y.0) — new features, backward compatible
- `--patch` - Bump patch version (x.y.Z) — bug fixes (default if no flag)
- `--set VERSION` - Set to a specific version (e.g., `--set 1.0.0-beta.1`)

## Instructions

### Step 1 — Read Current Version

Look for version in this priority order:
1. `version.properties` (preferred — `major=X`, `minor=Y`, `patch=Z` format)
2. `gradle.properties` (`version=X.Y.Z` or `app.version=X.Y.Z`)
3. Root `build.gradle.kts` (version declaration)

If `version.properties` doesn't exist, create it from whatever source has the version.

### Step 2 — Calculate New Version

Apply semver rules:
- `--major`: increment major, reset minor and patch to 0
- `--minor`: increment minor, reset patch to 0
- `--patch`: increment patch (default)
- `--set`: use the exact version provided

### Step 3 — Confirm

Display:
```
Version bump: X.Y.Z → A.B.C
Files to update:
  - version.properties
  - CHANGELOG.md (add [Unreleased] → [A.B.C] - YYYY-MM-DD)
Proceed? (y/n)
```

### Step 4 — Apply (after confirmation)

1. Update `version.properties` (major, minor, patch fields)
2. Update `CHANGELOG.md`: rename `[Unreleased]` section to `[A.B.C] - YYYY-MM-DD`, add new empty `[Unreleased]` above it
3. Commit: `chore(release): bump version to A.B.C`
4. Suggest: "Run `/git-flow release vA.B.C` to create the release branch"

### Important Rules

1. **Confirmation required** — never bump without user approval
2. **Semantic versioning** — follow semver strictly
3. **Single source** — `version.properties` is canonical. App build files read from it.
4. **CHANGELOG update** — always update CHANGELOG.md in the same commit
5. **No tag here** — tagging happens in `/git-flow release`, not in `/bump-version`
