---
name: run
description: "Build, install, and run app with debug logging. Use when asked to launch, run, or deploy the app on a device or desktop."
intent: [run, build, install, deploy, launch, debug]
allowed-tools: [Bash, Read, Grep, Glob]
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

```bash
node .claude/runtime/l0-toolkit-launcher.cjs run run-app --project-root "$PWD" -- $ARGUMENTS
```

### Windows
Claude Code runs the POSIX command above from Bash on Windows as well. The
launcher selects the platform implementation and passes the invocation as one
`-Arguments` value to the Windows adapter.

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
