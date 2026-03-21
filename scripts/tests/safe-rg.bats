#!/usr/bin/env bats
# =============================================================================
# Tests for safe_rg() — cross-platform ripgrep wrapper with find+grep fallback
# =============================================================================

LIB="$BATS_TEST_DIRNAME/../sh/lib/script-utils.sh"

setup() {
    source "$LIB"
    WORK_DIR=$(mktemp -d)

    # Create test fixtures
    mkdir -p "$WORK_DIR/src/main/kotlin"
    mkdir -p "$WORK_DIR/src/test/kotlin"
    mkdir -p "$WORK_DIR/build/generated"
    mkdir -p "$WORK_DIR/.gradle/cache"

    echo 'import java.time.Instant'     > "$WORK_DIR/src/main/kotlin/Repo.kt"
    echo 'import kotlinx.datetime.Clock' >> "$WORK_DIR/src/main/kotlin/Repo.kt"
    echo 'fun test() = println("ok")'    >> "$WORK_DIR/src/main/kotlin/Repo.kt"

    echo 'import java.time.ZoneId'       > "$WORK_DIR/src/main/kotlin/Helper.kt"

    echo 'class RepoTest'                > "$WORK_DIR/src/test/kotlin/RepoTest.kt"
    echo 'import java.time.Instant'      >> "$WORK_DIR/src/test/kotlin/RepoTest.kt"

    echo 'generated code java.time'      > "$WORK_DIR/build/generated/Gen.kt"
    echo 'cache java.time'               > "$WORK_DIR/.gradle/cache/Cache.kt"
}

teardown() {
    rm -rf "$WORK_DIR"
}

# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------

@test "safe_rg: returns error when no pattern given" {
    run safe_rg
    [ "$status" -eq 1 ]
    echo "$output" | grep -q "pattern required"
}

# ---------------------------------------------------------------------------
# Basic search — finds matching lines
# ---------------------------------------------------------------------------

@test "safe_rg: finds pattern in files" {
    result=$(safe_rg "java.time" "$WORK_DIR")
    echo "$result" | grep -q "java.time.Instant"
    echo "$result" | grep -q "java.time.ZoneId"
}

@test "safe_rg: returns matching content with file path prefix" {
    result=$(safe_rg "java.time.Instant" "$WORK_DIR")
    echo "$result" | grep -q "Repo.kt"
}

# ---------------------------------------------------------------------------
# --include flag — file glob filtering
# ---------------------------------------------------------------------------

@test "safe_rg: --include filters by file extension" {
    # Create a non-.kt file with matching content
    echo "java.time.Instant" > "$WORK_DIR/src/main/kotlin/notes.txt"
    result=$(safe_rg "java.time" "$WORK_DIR" --include='*.kt')
    echo "$result" | grep -q "Repo.kt"
    # txt file should NOT appear
    if echo "$result" | grep -q "notes.txt"; then
        echo "FAIL: notes.txt should have been excluded"
        return 1
    fi
}

# ---------------------------------------------------------------------------
# --exclude-dir flag — directory exclusion
# ---------------------------------------------------------------------------

@test "safe_rg: --exclude-dir skips build directory" {
    result=$(safe_rg "java.time" "$WORK_DIR" --exclude-dir=build)
    if echo "$result" | grep -q "Gen.kt"; then
        echo "FAIL: build/generated should have been excluded"
        return 1
    fi
    # Should still find src files
    echo "$result" | grep -q "Repo.kt"
}

@test "safe_rg: --exclude-dir skips .gradle directory" {
    result=$(safe_rg "java.time" "$WORK_DIR" --exclude-dir=.gradle)
    if echo "$result" | grep -q "Cache.kt"; then
        echo "FAIL: .gradle should have been excluded"
        return 1
    fi
}

@test "safe_rg: multiple --exclude-dir flags work" {
    result=$(safe_rg "java.time" "$WORK_DIR" --exclude-dir=build --exclude-dir=.gradle)
    if echo "$result" | grep -q "Gen.kt"; then
        echo "FAIL: build should have been excluded"
        return 1
    fi
    if echo "$result" | grep -q "Cache.kt"; then
        echo "FAIL: .gradle should have been excluded"
        return 1
    fi
    echo "$result" | grep -q "Repo.kt"
}

# ---------------------------------------------------------------------------
# Combined --include + --exclude-dir
# ---------------------------------------------------------------------------

@test "safe_rg: --include and --exclude-dir combined" {
    echo "java.time.Clock" > "$WORK_DIR/src/main/kotlin/readme.md"
    result=$(safe_rg "java.time" "$WORK_DIR" --include='*.kt' --exclude-dir=build --exclude-dir=.gradle)
    echo "$result" | grep -q "Repo.kt"
    if echo "$result" | grep -q "Gen.kt"; then return 1; fi
    if echo "$result" | grep -q "Cache.kt"; then return 1; fi
    if echo "$result" | grep -q "readme.md"; then return 1; fi
}

# ---------------------------------------------------------------------------
# -l flag — list files only
# ---------------------------------------------------------------------------

@test "safe_rg: -l lists matching files without content" {
    result=$(safe_rg -l "java.time" "$WORK_DIR" --include='*.kt' --exclude-dir=build --exclude-dir=.gradle)
    echo "$result" | grep -q "Repo.kt"
    echo "$result" | grep -q "Helper.kt"
    # Should NOT contain the import line itself
    if echo "$result" | grep -q "import"; then
        echo "FAIL: -l should only list file names"
        return 1
    fi
}

# ---------------------------------------------------------------------------
# -n flag — show line numbers
# ---------------------------------------------------------------------------

@test "safe_rg: -n shows line numbers" {
    result=$(safe_rg -n "java.time.Instant" "$WORK_DIR/src/main/kotlin" --include='*.kt')
    # Should contain :1: (first line)
    echo "$result" | grep -qE ':[0-9]+:'
}

# ---------------------------------------------------------------------------
# -c flag — count matches per file
# ---------------------------------------------------------------------------

@test "safe_rg: -c shows match count per file" {
    result=$(safe_rg -c "java.time" "$WORK_DIR/src/main/kotlin" --include='*.kt')
    # Repo.kt has 1 java.time match, Helper.kt has 1
    echo "$result" | grep -q "Repo.kt:1"
    echo "$result" | grep -q "Helper.kt:1"
}

# ---------------------------------------------------------------------------
# No matches — returns empty, not error
# ---------------------------------------------------------------------------

@test "safe_rg: returns empty for no matches (no error)" {
    result=$(safe_rg "NONEXISTENT_PATTERN_xyz123" "$WORK_DIR")
    [ -z "$result" ]
}

# ---------------------------------------------------------------------------
# Default directory — uses current dir
# ---------------------------------------------------------------------------

@test "safe_rg: defaults to current directory" {
    cd "$WORK_DIR"
    result=$(safe_rg "java.time.Instant")
    echo "$result" | grep -q "java.time.Instant"
}

# ---------------------------------------------------------------------------
# Force fallback path (simulate Windows)
# ---------------------------------------------------------------------------

@test "safe_rg: find+grep fallback finds files" {
    # Override uname to force fallback — rename rg temporarily
    # Instead, test the find+grep path directly by calling with unset PATH for rg
    (
        # Remove rg from PATH to force fallback
        _original_path="$PATH"
        PATH=$(echo "$PATH" | tr ':' '\n' | grep -v "rg" | tr '\n' ':')
        # If rg is still available, skip — the test validates the fallback logic
        if command -v rg &>/dev/null; then
            # Can't easily remove rg, test the find path via a clean subshell
            skip "rg still in PATH, can't force fallback"
        fi
        source "$LIB"
        result=$(safe_rg "java.time" "$WORK_DIR" --include='*.kt' --exclude-dir=build)
        echo "$result" | grep -q "Repo.kt"
    )
}

@test "safe_rg: find+grep fallback with -l" {
    (
        PATH=$(echo "$PATH" | tr ':' '\n' | grep -v "rg" | tr '\n' ':')
        if command -v rg &>/dev/null; then
            skip "rg still in PATH"
        fi
        source "$LIB"
        result=$(safe_rg -l "java.time" "$WORK_DIR" --include='*.kt' --exclude-dir=build)
        echo "$result" | grep -q "Repo.kt"
        if echo "$result" | grep -q "import"; then return 1; fi
    )
}

@test "safe_rg: find+grep fallback with -n" {
    (
        PATH=$(echo "$PATH" | tr ':' '\n' | grep -v "rg" | tr '\n' ':')
        if command -v rg &>/dev/null; then
            skip "rg still in PATH"
        fi
        source "$LIB"
        result=$(safe_rg -n "java.time.Instant" "$WORK_DIR/src/main/kotlin" --include='*.kt')
        echo "$result" | grep -qE ':[0-9]+:'
    )
}

@test "safe_rg: find+grep fallback with -c" {
    (
        PATH=$(echo "$PATH" | tr ':' '\n' | grep -v "rg" | tr '\n' ':')
        if command -v rg &>/dev/null; then
            skip "rg still in PATH"
        fi
        source "$LIB"
        result=$(safe_rg -c "java.time" "$WORK_DIR/src/main/kotlin" --include='*.kt')
        echo "$result" | grep -q ":1"
    )
}
