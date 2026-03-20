#!/usr/bin/env bats
# Tests for run-parallel-coverage-suite.ps1 pipe-safety fix
#
# Validates that the PowerShell script doesn't hang when invoked from bash
# via pipe (the original bug). Uses a mock gradlew.bat that exits immediately.

SCRIPT="$BATS_TEST_DIRNAME/../ps1/run-parallel-coverage-suite.ps1"

# Skip all tests if powershell.exe is not available
setup() {
    if ! command -v powershell.exe &>/dev/null; then
        skip "powershell.exe not available"
    fi

    WORK_DIR="$(mktemp -d)"
    PROJECT="$WORK_DIR/project"
    mkdir -p "$PROJECT/gradle"

    # Mock gradlew.bat — exits immediately with configurable output and exit code
    cat > "$PROJECT/gradlew.bat" << 'BATEOF'
@echo off
echo BUILD SUCCESSFUL in 0s
echo.
echo 3 actionable tasks: 3 executed
exit /b 0
BATEOF

    # Minimal settings.gradle.kts so module discovery doesn't fail hard
    echo 'rootProject.name = "test-project"' > "$PROJECT/settings.gradle.kts"

    # Minimal build.gradle.kts
    echo 'plugins { }' > "$PROJECT/build.gradle.kts"
}

teardown() {
    rm -rf "$WORK_DIR"
}

# Helper: run PS1 script with timeout to detect hangs
run_with_timeout() {
    local timeout_secs="${1:-30}"
    shift
    # Convert paths to Windows format for PowerShell
    local win_script
    win_script=$(cygpath -w "$SCRIPT" 2>/dev/null || echo "$SCRIPT")
    timeout "$timeout_secs" powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& '$win_script' $*" 2>&1
    return $?
}

# ── Core: pipe safety (the original bug) ─────────────────────────────────

@test "ps1: does not hang when piped through bash (pipe-safety)" {
    # This is THE test for the bug. The old Start-Process + redirect pattern
    # would hang indefinitely here. With the fix (System.Diagnostics.Process
    # + async readers), it should complete within seconds.
    local win_script win_project
    win_script=$(cygpath -w "$SCRIPT" 2>/dev/null || echo "$SCRIPT")
    win_project=$(cygpath -w "$PROJECT" 2>/dev/null || echo "$PROJECT")

    local output
    local exit_code=0

    # Pipe through tail (the exact repro from the bug report)
    output=$(timeout 30 bash -c "
        powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \
            \"& '$win_script' -ProjectRoot '$win_project' -SkipTests\" 2>&1 | tail -20
    ") || exit_code=$?

    # timeout returns 124 on hang — that's the failure we're testing against
    [ "$exit_code" -ne 124 ] || {
        echo "HANG DETECTED: script did not complete within 30s when piped"
        return 1
    }
}

@test "ps1: completes when invoked directly (no pipe)" {
    local win_project
    win_project=$(cygpath -w "$PROJECT" 2>/dev/null || echo "$PROJECT")
    local exit_code=0
    # We expect a non-zero exit (no modules in mock project) — we're testing it doesn't HANG
    run_with_timeout 30 -ProjectRoot "'$win_project'" -SkipTests || exit_code=$?

    # timeout returns 124 on hang — anything else means the script completed
    [ "$exit_code" -ne 124 ] || {
        echo "HANG DETECTED: script did not complete within 30s"
        return 1
    }
}

@test "ps1: completes with 2>&1 redirect (common AI agent pattern)" {
    local win_script win_project
    win_script=$(cygpath -w "$SCRIPT" 2>/dev/null || echo "$SCRIPT")
    win_project=$(cygpath -w "$PROJECT" 2>/dev/null || echo "$PROJECT")

    local exit_code=0
    timeout 30 powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \
        "& '$win_script' -ProjectRoot '$win_project' -SkipTests" 2>&1 >/dev/null || exit_code=$?

    [ "$exit_code" -ne 124 ] || {
        echo "HANG DETECTED with 2>&1 redirect"
        return 1
    }
}

# ── Process pattern validation (static analysis) ─────────────────────────

@test "ps1: does NOT use Start-Process with -RedirectStandardOutput" {
    # The root cause pattern — should not exist anymore
    ! grep -q "Start-Process.*-RedirectStandardOutput" "$SCRIPT"
}

@test "ps1: uses System.Diagnostics.Process for Gradle execution" {
    grep -q "System.Diagnostics.ProcessStartInfo" "$SCRIPT"
    grep -q "System.Diagnostics.Process" "$SCRIPT"
}

@test "ps1: uses async ReadToEndAsync for stdout/stderr capture" {
    grep -q "ReadToEndAsync" "$SCRIPT"
}

@test "ps1: disposes process after completion" {
    grep -q '\.Dispose()' "$SCRIPT"
}

@test "ps1: still has timeout watchdog loop" {
    grep -q 'HasExited' "$SCRIPT"
    grep -q 'Timeout' "$SCRIPT"
    grep -q 'TIMEOUT.*Killing' "$SCRIPT"
}

# ── Parity with bash version ─────────────────────────────────────────────

@test "parity: bash version uses background subshell (not Start-Process)" {
    local bash_script="$BATS_TEST_DIRNAME/../sh/run-parallel-coverage-suite.sh"
    [ -f "$bash_script" ] || skip "bash script not found"

    # Bash should use ( ... ) & pattern
    grep -q '&$' "$bash_script"
    grep -q 'GRADLE_PID' "$bash_script"
    grep -q 'wait.*GRADLE_PID' "$bash_script"
}

@test "parity: both scripts have timeout watchdog" {
    local bash_script="$BATS_TEST_DIRNAME/../sh/run-parallel-coverage-suite.sh"
    [ -f "$bash_script" ] || skip "bash script not found"

    grep -q "TIMEOUT" "$bash_script"
    grep -q "Timeout" "$SCRIPT"
}

@test "parity: both scripts have daemon recovery on timeout" {
    local bash_script="$BATS_TEST_DIRNAME/../sh/run-parallel-coverage-suite.sh"
    [ -f "$bash_script" ] || skip "bash script not found"

    grep -q "RECOVERY.*Stopping daemons" "$bash_script"
    grep -q "RECOVERY.*Stopping daemons" "$SCRIPT"
}

@test "parity: both scripts clean up temp files" {
    local bash_script="$BATS_TEST_DIRNAME/../sh/run-parallel-coverage-suite.sh"
    [ -f "$bash_script" ] || skip "bash script not found"

    grep -q 'rm -f.*TEMP_LOG' "$bash_script"
    grep -q 'Remove-Item.*tempLog' "$SCRIPT"
}
