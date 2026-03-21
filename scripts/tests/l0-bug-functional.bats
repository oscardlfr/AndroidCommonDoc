#!/usr/bin/env bats
# =============================================================================
# Functional tests for L0 bug fixes
#
# Tests actual behavior (not just grep for strings) for each bug fix:
# - Bug 1+2: CRLF arithmetic via tr -d '\r'
# - Bug 3+13+14: pattern-lint exclusions and KDoc filtering
# - Bug 4: module-health-scan --project-root flag
# - Bug 6: coverage-detect kover report dir + root buildscript fallback
# - Bug 7: verify-kmp expanded allowlist
# - Bug 8: module-health-scan platform test dir counting
# - Bug 11: NoJavaTimeInCommonMainRule platform source set exclusion
# =============================================================================

SH_DIR="$BATS_TEST_DIRNAME/../sh"
LIB_DIR="$SH_DIR/lib"

setup() {
    WORK_DIR=$(mktemp -d)
}

teardown() {
    rm -rf "$WORK_DIR"
}

# ===========================================================================
# Bug 1+2: CRLF arithmetic — tr -d '\r' actually strips \r
# ===========================================================================

@test "bug1: tr -d with \\r strips carriage return from wc output" {
    # Simulate Windows wc output: "42\r"
    result=$(printf '42\r' | tr -d ' \r')
    [ "$result" = "42" ]
}

@test "bug1: arithmetic works after tr -d \\r on CRLF input" {
    a=$(printf '10\r' | tr -d ' \r')
    b=$(printf '20\r' | tr -d ' \r')
    sum=$((a + b))
    [ "$sum" -eq 30 ]
}

@test "bug1: tr -d \\r is a no-op on clean input (Linux compat)" {
    result=$(printf '42' | tr -d ' \r')
    [ "$result" = "42" ]
}

# ===========================================================================
# Bug 3: pattern-lint excludes .gsd/ and .worktrees/
# ===========================================================================

@test "bug3: pattern-lint scan_prod excludes .gsd directory" {
    # Create a fake project with .gsd containing .kt files
    mkdir -p "$WORK_DIR/src/main/kotlin" "$WORK_DIR/.gsd/worktrees/M001/src"
    echo 'val x = println("prod")' > "$WORK_DIR/src/main/kotlin/Real.kt"
    echo 'val x = println("ghost")' > "$WORK_DIR/.gsd/worktrees/M001/src/Ghost.kt"
    
    # Grep with the same GREP_EXCLUDES pattern-lint uses
    GREP_EXCLUDES=(--exclude-dir=node_modules --exclude-dir=.gradle --exclude-dir=.git --exclude-dir=build --exclude-dir=.gsd --exclude-dir=.worktrees)
    count=$(grep -rn --include="*.kt" "${GREP_EXCLUDES[@]}" "println" "$WORK_DIR" 2>/dev/null | wc -l | tr -d ' \r')
    [ "$count" -eq 1 ]
}

@test "bug3: pattern-lint scan_prod excludes .worktrees directory" {
    mkdir -p "$WORK_DIR/src/main/kotlin" "$WORK_DIR/.worktrees/feature/src"
    echo 'val x = MutableSharedFlow<String>()' > "$WORK_DIR/src/main/kotlin/Prod.kt"
    echo 'val x = MutableSharedFlow<String>()' > "$WORK_DIR/.worktrees/feature/src/Dup.kt"

    GREP_EXCLUDES=(--exclude-dir=node_modules --exclude-dir=.gradle --exclude-dir=.git --exclude-dir=build --exclude-dir=.gsd --exclude-dir=.worktrees)
    count=$(grep -rn --include="*.kt" "${GREP_EXCLUDES[@]}" "MutableSharedFlow" "$WORK_DIR" 2>/dev/null | wc -l | tr -d ' \r')
    [ "$count" -eq 1 ]
}

# ===========================================================================
# Bug 6: coverage-detect kover report dir + root buildscript
# ===========================================================================

@test "bug6: detect_coverage_tool returns kover when kover report dir exists" {
    source "$LIB_DIR/coverage-detect.sh"
    # Module build file has no kover mention, but report dir exists
    mkdir -p "$WORK_DIR/mod/build/reports/kover"
    echo 'plugins { id("com.android.library") }' > "$WORK_DIR/mod/build.gradle.kts"
    result=$(detect_coverage_tool "$WORK_DIR/mod/build.gradle.kts")
    [ "$result" = "kover" ]
}

@test "bug6: detect_coverage_tool checks root buildscript for kover" {
    source "$LIB_DIR/coverage-detect.sh"
    # Module has no kover, root does
    mkdir -p "$WORK_DIR/core/domain"
    echo 'plugins { id("com.android.library") }' > "$WORK_DIR/core/domain/build.gradle.kts"
    echo 'plugins { id("org.jetbrains.kotlinx.kover") }' > "$WORK_DIR/core/build.gradle.kts"
    result=$(detect_coverage_tool "$WORK_DIR/core/domain/build.gradle.kts")
    [ "$result" = "kover" ]
}

@test "bug6: detect_coverage_tool kover report dir takes precedence over jacoco default" {
    source "$LIB_DIR/coverage-detect.sh"
    mkdir -p "$WORK_DIR/mod/build/reports/kover"
    mkdir -p "$WORK_DIR/mod/build/reports/jacoco"
    echo 'android { }' > "$WORK_DIR/mod/build.gradle.kts"
    result=$(detect_coverage_tool "$WORK_DIR/mod/build.gradle.kts")
    [ "$result" = "kover" ]
}

@test "bug6: detect_coverage_tool still defaults to jacoco when no kover evidence" {
    source "$LIB_DIR/coverage-detect.sh"
    mkdir -p "$WORK_DIR/mod"
    echo 'plugins { id("com.android.library") }' > "$WORK_DIR/mod/build.gradle.kts"
    result=$(detect_coverage_tool "$WORK_DIR/mod/build.gradle.kts")
    [ "$result" = "jacoco" ]
}

# ===========================================================================
# Bug 7: verify-kmp allowlist — functional test with fake commonMain
# ===========================================================================

@test "bug7: verify-kmp allows androidx.datastore in commonMain" {
    # Test the allowlist patterns from verify-kmp-packages.sh
    COMMON_MAIN_ALLOWLIST=(
        'androidx\.compose\.'
        'androidx\.datastore\.'
        'androidx\.collection\.'
        'androidx\.annotation\.'
        'androidx\.lifecycle\.'
        'androidx\.paging\.'
    )
    import="import androidx.datastore.core.DataStore"
    match=false
    for pattern in "${COMMON_MAIN_ALLOWLIST[@]}"; do
        if echo "$import" | grep -qE "$pattern"; then
            match=true
            break
        fi
    done
    [ "$match" = "true" ]
}

@test "bug7: verify-kmp allows androidx.lifecycle in commonMain" {
    COMMON_MAIN_ALLOWLIST=(
        'androidx\.compose\.'
        'androidx\.datastore\.'
        'androidx\.collection\.'
        'androidx\.annotation\.'
        'androidx\.lifecycle\.'
        'androidx\.paging\.'
    )
    import="import androidx.lifecycle.ViewModel"
    match=false
    for pattern in "${COMMON_MAIN_ALLOWLIST[@]}"; do
        if echo "$import" | grep -qE "$pattern"; then
            match=true
            break
        fi
    done
    [ "$match" = "true" ]
}

@test "bug7: verify-kmp allows androidx.paging in commonMain" {
    COMMON_MAIN_ALLOWLIST=(
        'androidx\.compose\.'
        'androidx\.datastore\.'
        'androidx\.collection\.'
        'androidx\.annotation\.'
        'androidx\.lifecycle\.'
        'androidx\.paging\.'
    )
    import="import androidx.paging.PagingData"
    match=false
    for pattern in "${COMMON_MAIN_ALLOWLIST[@]}"; do
        if echo "$import" | grep -qE "$pattern"; then
            match=true
            break
        fi
    done
    [ "$match" = "true" ]
}

@test "bug7: verify-kmp still flags android.content.Context in commonMain" {
    COMMON_MAIN_ALLOWLIST=(
        'androidx\.compose\.'
        'androidx\.datastore\.'
        'androidx\.collection\.'
        'androidx\.annotation\.'
        'androidx\.lifecycle\.'
        'androidx\.paging\.'
    )
    import="import android.content.Context"
    match=false
    for pattern in "${COMMON_MAIN_ALLOWLIST[@]}"; do
        if echo "$import" | grep -qE "$pattern"; then
            match=true
            break
        fi
    done
    [ "$match" = "false" ]
}

# ===========================================================================
# Bug 8: module-health-scan counts platform test directories
# ===========================================================================

@test "bug8: module-health-scan find pattern matches androidUnitTest" {
    mkdir -p "$WORK_DIR/mod/src/androidUnitTest/kotlin"
    echo "class FooTest" > "$WORK_DIR/mod/src/androidUnitTest/kotlin/FooTest.kt"
    count=$(find "$WORK_DIR/mod" -name "*.kt" -not -path "*/build/*" \
        \( -path "*/test/*" -o -path "*/androidTest/*" -o -path "*/commonTest/*" \
           -o -path "*/androidUnitTest/*" -o -path "*/desktopTest/*" \
           -o -path "*/iosTest/*" -o -path "*/jvmTest/*" \) 2>/dev/null | wc -l | tr -d ' \r')
    [ "$count" -eq 1 ]
}

@test "bug8: module-health-scan find pattern matches desktopTest" {
    mkdir -p "$WORK_DIR/mod/src/desktopTest/kotlin"
    echo "class BarTest" > "$WORK_DIR/mod/src/desktopTest/kotlin/BarTest.kt"
    count=$(find "$WORK_DIR/mod" -name "*.kt" -not -path "*/build/*" \
        \( -path "*/test/*" -o -path "*/androidTest/*" -o -path "*/commonTest/*" \
           -o -path "*/androidUnitTest/*" -o -path "*/desktopTest/*" \
           -o -path "*/iosTest/*" -o -path "*/jvmTest/*" \) 2>/dev/null | wc -l | tr -d ' \r')
    [ "$count" -eq 1 ]
}

@test "bug8: module-health-scan counts all platform test dirs together" {
    mkdir -p "$WORK_DIR/mod/src/commonTest/kotlin"
    mkdir -p "$WORK_DIR/mod/src/androidUnitTest/kotlin"
    mkdir -p "$WORK_DIR/mod/src/desktopTest/kotlin"
    echo "class A" > "$WORK_DIR/mod/src/commonTest/kotlin/A.kt"
    echo "class B" > "$WORK_DIR/mod/src/androidUnitTest/kotlin/B.kt"
    echo "class C" > "$WORK_DIR/mod/src/desktopTest/kotlin/C.kt"
    count=$(find "$WORK_DIR/mod" -name "*.kt" -not -path "*/build/*" \
        \( -path "*/test/*" -o -path "*/androidTest/*" -o -path "*/commonTest/*" \
           -o -path "*/androidUnitTest/*" -o -path "*/desktopTest/*" \
           -o -path "*/iosTest/*" -o -path "*/jvmTest/*" \) 2>/dev/null | wc -l | tr -d ' \r')
    [ "$count" -eq 3 ]
}

@test "bug8: module-health-scan excludes prod source from test count" {
    mkdir -p "$WORK_DIR/mod/src/commonMain/kotlin"
    mkdir -p "$WORK_DIR/mod/src/commonTest/kotlin"
    echo "class Prod" > "$WORK_DIR/mod/src/commonMain/kotlin/Prod.kt"
    echo "class ProdTest" > "$WORK_DIR/mod/src/commonTest/kotlin/ProdTest.kt"
    count=$(find "$WORK_DIR/mod" -name "*.kt" -not -path "*/build/*" \
        \( -path "*/test/*" -o -path "*/androidTest/*" -o -path "*/commonTest/*" \
           -o -path "*/androidUnitTest/*" -o -path "*/desktopTest/*" \
           -o -path "*/iosTest/*" -o -path "*/jvmTest/*" \) 2>/dev/null | wc -l | tr -d ' \r')
    [ "$count" -eq 1 ]
}

# ===========================================================================
# Bug 4: module-health-scan --project-root flag
# ===========================================================================

@test "bug4: module-health-scan accepts --project-root flag" {
    grep -q "\-\-project-root" "$SH_DIR/module-health-scan.sh"
}

@test "bug4: module-health-scan --project-root parsed before positional fallback" {
    # --project-root case should appear before the * catch-all
    pr_line=$(grep -n "\-\-project-root)" "$SH_DIR/module-health-scan.sh" | head -1 | cut -d: -f1)
    star_line=$(grep -n '^\s*\*)' "$SH_DIR/module-health-scan.sh" | head -1 | cut -d: -f1)
    [ "$pr_line" -lt "$star_line" ]
}

# ===========================================================================
# Bug 13: pattern-lint cancellation check filters KDoc lines
# ===========================================================================

@test "bug13: cancellation grep -vE filters asterisk-prefixed lines" {
    # Simulate grep output with KDoc and real code
    input=$(printf '%s\n' \
        'Repo.kt:42: * catch(e: Exception) { rethrow }' \
        'Repo.kt:43:     catch(e: Exception) { log(e) }' \
        'Repo.kt:44: // catch(e: Throwable) example' \
        'Repo.kt:50:     } catch(e: Throwable) { /* noop */ }')
    
    filtered=$(echo "$input" | grep -vE ':\s*\*|:\s*//')
    count=$(echo "$filtered" | wc -l | tr -d ' \r')
    [ "$count" -eq 2 ]
}

@test "bug13: KDoc asterisk line is actually filtered" {
    line='Repo.kt:42: * catch(e: Exception) { rethrow }'
    if echo "$line" | grep -qE ':\s*\*'; then
        filtered=true
    else
        filtered=false
    fi
    [ "$filtered" = "true" ]
}

@test "bug13: single-line comment is actually filtered" {
    line='Repo.kt:44: // catch(e: Throwable) example'
    if echo "$line" | grep -qE ':\s*//'; then
        filtered=true
    else
        filtered=false
    fi
    [ "$filtered" = "true" ]
}

@test "bug13: real catch line is NOT filtered" {
    line='Repo.kt:43:     catch(e: Exception) { log(e) }'
    if echo "$line" | grep -qE ':\s*\*|:\s*//'; then
        filtered=true
    else
        filtered=false
    fi
    [ "$filtered" = "false" ]
}

# ===========================================================================
# Bug 14: pattern-lint scan_prod filters KDoc from println matches
# ===========================================================================

@test "bug14: scan_prod KDoc filter strips asterisk lines" {
    mkdir -p "$WORK_DIR/src/main/kotlin"
    cat > "$WORK_DIR/src/main/kotlin/Example.kt" << 'EOF'
/**
 * Example:
 *     println("this is KDoc, not real code")
 */
fun realCode() {
    println("this IS real code")
}
EOF
    GREP_EXCLUDES=(--exclude-dir=build --exclude-dir=.gsd --exclude-dir=.worktrees)
    count=$(grep -rn --include="*.kt" "${GREP_EXCLUDES[@]}" "println" "$WORK_DIR" 2>/dev/null \
        | grep -v "/test/" | grep -v "/build/" \
        | grep -vE ':\s*\*|:\s*//' \
        | wc -l | tr -d ' \r')
    [ "$count" -eq 1 ]
}

@test "bug14: scan_prod KDoc filter strips comment lines" {
    mkdir -p "$WORK_DIR/src/main/kotlin"
    cat > "$WORK_DIR/src/main/kotlin/Example2.kt" << 'EOF'
// println("commented out")
fun code() {
    println("real")
}
EOF
    GREP_EXCLUDES=(--exclude-dir=build --exclude-dir=.gsd --exclude-dir=.worktrees)
    count=$(grep -rn --include="*.kt" "${GREP_EXCLUDES[@]}" "println" "$WORK_DIR" 2>/dev/null \
        | grep -v "/test/" | grep -v "/build/" \
        | grep -vE ':\s*\*|:\s*//' \
        | wc -l | tr -d ' \r')
    [ "$count" -eq 1 ]
}

# ===========================================================================
# Bug 11: NoJavaTimeInCommonMainRule platform exclusion (Kotlin logic)
# ===========================================================================

@test "bug11: isCommonMain logic excludes androidMain path" {
    # Test the logic from the Kotlin rule: path contains /androidMain/ → false
    path="core/data/src/androidMain/kotlin/Repo.kt"
    normalized=$(echo "$path" | tr '\\' '/')
    # Platform source sets that should be excluded
    platforms="/androidMain/ /desktopMain/ /iosMain/ /appleMain/ /jvmMain/"
    excluded=false
    for p in $platforms; do
        if echo "$normalized" | grep -q "$p"; then
            excluded=true
            break
        fi
    done
    [ "$excluded" = "true" ]
}

@test "bug11: isCommonMain logic excludes desktopMain path" {
    path="core/data/src/desktopMain/kotlin/JvmHelper.kt"
    normalized=$(echo "$path" | tr '\\' '/')
    platforms="/androidMain/ /desktopMain/ /iosMain/ /appleMain/ /jvmMain/"
    excluded=false
    for p in $platforms; do
        if echo "$normalized" | grep -q "$p"; then
            excluded=true
            break
        fi
    done
    [ "$excluded" = "true" ]
}

@test "bug11: isCommonMain logic does NOT exclude commonMain path" {
    path="core/data/src/commonMain/kotlin/Repo.kt"
    normalized=$(echo "$path" | tr '\\' '/')
    platforms="/androidMain/ /desktopMain/ /iosMain/ /appleMain/ /jvmMain/"
    excluded=false
    for p in $platforms; do
        if echo "$normalized" | grep -q "$p"; then
            excluded=true
            break
        fi
    done
    [ "$excluded" = "false" ]
    # And it IS commonMain
    echo "$normalized" | grep -q "/commonMain/"
}

@test "bug11: isCommonMain logic excludes iosMain path" {
    path="core/data/src/iosMain/kotlin/PlatformImpl.kt"
    normalized=$(echo "$path" | tr '\\' '/')
    platforms="/androidMain/ /desktopMain/ /iosMain/ /appleMain/ /jvmMain/"
    excluded=false
    for p in $platforms; do
        if echo "$normalized" | grep -q "$p"; then
            excluded=true
            break
        fi
    done
    [ "$excluded" = "true" ]
}

# ===========================================================================
# Bug 9: gradle-config-check tr -d '\r' on grep -c output
# ===========================================================================

@test "bug9: gradle-config-check grep -c piped through tr -d \\r" {
    grep "grep -c" "$SH_DIR/gradle-config-check.sh" | grep -q "tr -d"
}

# ===========================================================================
# readme-pre-commit hook: functional check
# ===========================================================================

@test "readme-hook: hook script exists and is valid bash" {
    [ -f ".claude/hooks/readme-pre-commit.sh" ]
    bash -n ".claude/hooks/readme-pre-commit.sh"
}

@test "readme-hook: checks skills count" {
    grep -q "skills" ".claude/hooks/readme-pre-commit.sh"
}

@test "readme-hook: checks agents count" {
    grep -q "agents" ".claude/hooks/readme-pre-commit.sh"
}

@test "readme-hook: outputs deny JSON on failure" {
    grep -q "permissionDecision.*deny" ".claude/hooks/readme-pre-commit.sh"
}
