---
name: run
description: "Build, install, and run app with debug logging. Use when asked to launch, run, or deploy the app on a device or desktop."
allowed-tools: [Bash, Read, Grep, Glob]
l0_requires: ANDROID_COMMON_DOC
copilot: true
---

## Usage Examples

```
/run
/run android
/run desktop
/run demo --clean
/run android --filter "HUE,MQTT,CLAUDE_DEBUG"
/run android --device R3CT30KAMEH
```

## Parameters

Uses parameters from `params.json`:
- `target` -- Target platform: `auto`, `android`, `desktop`, `demo`, `prod`. Auto-detected if omitted.
- `filter` -- Comma-separated log tags to filter during capture (default: `CLAUDE_DEBUG`).
- `device` -- ADB device serial. Auto-selects if one device connected.
- `clean` -- Force clean build before running.
- `flavor` -- Android build flavor (default: `demo`).
- `log-duration` -- How long to capture logs in seconds (default: 30).
- `json` -- Output results as JSON for programmatic consumption.
- `project-root` -- Path to the project root directory.

## Behavior

### Android Flow
1. Build the app: `./gradlew :app:assemble<Flavor>Debug`.
2. Uninstall existing app (clean install).
3. Install APK via `adb install`.
4. Clear logcat: `adb logcat -c`.
5. Launch app via `adb shell am start`.
6. Capture filtered logcat for `log-duration` seconds (default 30) or until Ctrl+C.

### Desktop Flow
1. Build and run: `./gradlew :desktopApp:run`.
2. Capture stdout/stderr.

## Implementation

> **Claude Code agents**: Always use the `macOS / Linux` path below, regardless of host OS.
> Claude Code agents run in bash (`/usr/bin/bash`) on all platforms including Windows.

### macOS / Linux
```bash
COMMON_DOC="${ANDROID_COMMON_DOC:?ANDROID_COMMON_DOC is not set. See README.md}"

"$COMMON_DOC/scripts/sh/build-run-app.sh" --project-root "$(pwd)" $ARGUMENTS
```

### Windows
```powershell
$commonDoc = if ($env:ANDROID_COMMON_DOC) { $env:ANDROID_COMMON_DOC } else { throw "ANDROID_COMMON_DOC is not set. See README.md" }

& "$commonDoc\scripts\ps1\build-run-app.ps1" -ProjectRoot (Get-Location).Path -Arguments "$ARGUMENTS"
```

## Expected Output

**On success (exit code 0):**
- Build success confirmation
- App launched on target device/emulator
- Filtered log output streamed in real time

**On failure:**
- Exit code 1: Build failure -- compilation errors with file:line:column
- Exit code 2: Install failure -- suggests `adb uninstall` or signature mismatch fixes
- Exit code 3: Launch failure -- crash details and stack traces
- Exit code 4: No device -- lists connected devices and provides guidance

**Output files:**
- `app_build.log` -- Build output (on failure)
- `app_debug.log` -- Filtered logcat output
- `app_full.log` -- Complete logcat (last 1000 lines)

## Cross-References

- Pattern: `docs/gradle-patterns.md`
- Script: `scripts/sh/build-run-app.sh`, `scripts/ps1/build-run-app.ps1`
