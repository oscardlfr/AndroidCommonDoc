<!-- L0 Generic Command -->
<!-- Usage: /package [PLATFORM] [--force] -->
# /package - Build Distribution Package

Build a distribution package for the target platform. Pre-flight checks for clean git state. Reports artifact path and size.

## Usage
```
/package [PLATFORM] [--force]
```

## Arguments
- `PLATFORM` - Target: `msi` (Windows), `dmg` (macOS), `deb` (Linux). Default: auto-detect.
- `--force` - Skip clean git state check

## Instructions

### Step 1 -- Pre-Flight Checks

Unless `--force`:
1. Check for uncommitted changes
2. Warn if found, ask whether to continue or abort

### Step 2 -- Determine Platform

Auto-detect from OS if not specified.

### Step 3 -- Build

Run the appropriate Gradle packaging task:
```bash
./gradlew :{desktop-app}:packageMsi    # Windows
./gradlew :{desktop-app}:packageDmg    # macOS
./gradlew :{desktop-app}:packageDeb    # Linux
```

Adapt the task path based on project structure.

### Step 4 -- Report

Find and report the output artifact path and size.

### Important Rules

1. **Clean git preferred** -- warn on uncommitted changes
2. **One platform at a time**
3. **Report the artifact path**
4. **Show build errors** if Gradle fails
