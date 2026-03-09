#!/usr/bin/env bats
# Tests for scripts/sh/verify-kmp-packages.sh
# Focuses on the commonMain forbidden-import checks and CMP allowlist

setup() {
    SCRIPT="$BATS_TEST_DIRNAME/../sh/verify-kmp-packages.sh"
    # Create temp project root with KMP source structure
    PROJECT_ROOT="$(mktemp -d)"
    COMMON_MAIN="$PROJECT_ROOT/src/commonMain/kotlin/com/example"
    mkdir -p "$COMMON_MAIN"
}

teardown() {
    rm -rf "$PROJECT_ROOT"
}

# ---------------------------------------------------------------------------
# Helper: write a kotlin file to commonMain
# ---------------------------------------------------------------------------
write_common_file() {
    local name="$1"
    local content="$2"
    echo "$content" > "$COMMON_MAIN/${name}.kt"
}

# ---------------------------------------------------------------------------
# Forbidden imports — should error
# ---------------------------------------------------------------------------

@test "forbidden: android.content.Context import in commonMain" {
    write_common_file "Repo" "import android.content.Context

class Repo(val ctx: Context)"

    run bash "$SCRIPT" --project-root "$PROJECT_ROOT"
    [ "$status" -eq 1 ]
    [[ "$output" == *"Forbidden import"* ]]
    [[ "$output" == *"Android SDK"* ]]
}

@test "forbidden: javax.swing import in commonMain" {
    write_common_file "SwingHelper" "import javax.swing.JPanel

class SwingHelper"

    run bash "$SCRIPT" --project-root "$PROJECT_ROOT"
    [ "$status" -eq 1 ]
    [[ "$output" == *"Forbidden import"* ]]
    [[ "$output" == *"Swing"* ]]
}

@test "forbidden: platform.UIKit import in commonMain" {
    write_common_file "IOSHelper" "import platform.UIKit.UIViewController

class IOSHelper"

    run bash "$SCRIPT" --project-root "$PROJECT_ROOT"
    [ "$status" -eq 1 ]
    [[ "$output" == *"Forbidden import"* ]]
}

@test "forbidden: java.io.File import in commonMain" {
    write_common_file "FileReader" "import java.io.File

class FileReader"

    run bash "$SCRIPT" --project-root "$PROJECT_ROOT"
    [ "$status" -eq 1 ]
    [[ "$output" == *"Forbidden import"* ]]
}

# ---------------------------------------------------------------------------
# CMP allowlist — androidx.compose.* is legitimate in commonMain
# ---------------------------------------------------------------------------

@test "allowlist: androidx.compose.runtime import in commonMain is NOT an error (CMP)" {
    write_common_file "Screen" "import androidx.compose.runtime.Composable
import androidx.compose.material3.Text

@Composable
fun Screen() { Text(\"hello\") }"

    run bash "$SCRIPT" --project-root "$PROJECT_ROOT"
    [ "$status" -eq 0 ]
    [[ "$output" != *"Forbidden import"* ]]
}

@test "allowlist: mixed androidx.compose.* and androidx.compose.ui.* both pass" {
    write_common_file "Component" "import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.Column

@Composable
fun Component(modifier: Modifier = Modifier) { Column { } }"

    run bash "$SCRIPT" --project-root "$PROJECT_ROOT"
    [ "$status" -eq 0 ]
    [[ "$output" != *"Forbidden import"* ]]
}

@test "allowlist: androidx.compose.* passes but androidx.activity.* still errors" {
    write_common_file "Mixed" "import androidx.compose.runtime.Composable
import androidx.activity.ComponentActivity

@Composable
fun Mixed() {}"

    run bash "$SCRIPT" --project-root "$PROJECT_ROOT"
    [ "$status" -eq 1 ]
    # compose line is fine, activity line should error
    [[ "$output" == *"Forbidden import"* ]]
}

# ---------------------------------------------------------------------------
# Clean project — no errors
# ---------------------------------------------------------------------------

@test "clean: pure Kotlin commonMain with no forbidden imports passes" {
    write_common_file "Domain" "package com.example

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

class Domain {
    fun data(): Flow<String> = flow { emit(\"ok\") }
}"

    run bash "$SCRIPT" --project-root "$PROJECT_ROOT"
    [ "$status" -eq 0 ]
    [[ "$output" != *"[ERROR]"* ]]
}

@test "clean: empty commonMain directory passes" {
    # No files written — empty directory
    run bash "$SCRIPT" --project-root "$PROJECT_ROOT"
    [ "$status" -eq 0 ]
}
