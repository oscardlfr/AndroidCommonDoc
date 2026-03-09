<!-- L0 Generic Command -->
<!-- Usage: /unlock-tests [--clean] [--module MODULE] -->
# /unlock-tests - Kill Stuck Gradle Workers and Release File Locks

Kill orphaned Gradle test workers, release `output.bin` locks, and clean stale test results so tests can run again.

**Use this before running tests** when you see file locking errors like:
- `Could not delete path ... output.bin`
- `The process cannot access the file because it is being used by another process`
- Gradle daemon crashes with `stop command received`

## Usage
```
/unlock-tests [--clean] [--module MODULE]
```

## Arguments
- `--clean` - Also delete stale `output.bin` files and test-results directories
- `--module MODULE` - Only clean specific module (e.g., `core:data`)

## Instructions

### Step 1 -- Find Stuck Java Processes

Count and kill all Java processes (Gradle daemons, test workers, Kotlin daemon):
```bash
# On Windows
tasklist | grep -ci "java.exe"
taskkill //F //IM java.exe

# On Unix
pkill -f java || true
```

### Step 2 -- Stop Gradle Daemons

```bash
./gradlew --stop 2>/dev/null || true
```

### Step 3 -- Handle Locked Files

If `--clean`:
- If `--module` specified, clean only that module's test-results and kover directories
- Otherwise, find and delete all `output.bin` and `results.bin` in test-results directories

If not `--clean`:
- Report count of locked files and suggest using `--clean`

### Output

```
File locks released. Tests should run cleanly now.
```

### Important Rules

1. **Windows-specific** -- uses `taskkill` on Windows, `pkill` on Unix
2. **Always stop daemons** before cleaning
3. **--module scopes cleanup** to a single module
