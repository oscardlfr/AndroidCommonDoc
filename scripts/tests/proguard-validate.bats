#!/usr/bin/env bats
#
# Smoke tests for scripts/sh/proguard-validate.sh — the bash wrapper around
# mcp-server/build/cli/proguard-validate.js.
#
# Pattern: mirrors generate-template.bats (setup_file() build guard).
# Location: scripts/tests/ (not tests/tools/ — that dir doesn't exist).

SCRIPT="$BATS_TEST_DIRNAME/../sh/proguard-validate.sh"
PS1_SCRIPT="$BATS_TEST_DIRNAME/../ps1/proguard-validate.ps1"
REAL_PROJECT_ROOT="$BATS_TEST_DIRNAME/../.."
REAL_CLI="$REAL_PROJECT_ROOT/mcp-server/build/cli/proguard-validate.js"
TMP_DIR="${BATS_TEST_TMPDIR:-/tmp}/proguard-validate-smoke-$$"

# Build guard: run once per file, not before every test case (setup_file vs setup).
# setup() would re-run npm build for every case — prohibitively slow.
setup_file() {
  local cli="$REAL_CLI"
  if [ ! -f "$cli" ]; then
    if ! command -v npm >/dev/null 2>&1; then
      skip "npm not on PATH; cannot build mcp-server CLI for bats suite"
    fi
    (cd "$REAL_PROJECT_ROOT/mcp-server" && npm ci --silent >/dev/null 2>&1 && npm run build --silent >/dev/null 2>&1) \
      || skip "mcp-server build failed; bats suite cannot run"
    [ -f "$cli" ] || skip "mcp-server build did not produce $cli"
  fi
}

# Build a minimal clean project (settings.gradle.kts with no modules referencing
# consumer rules) so --check-agp9-globals exits 0.
make_clean_project() {
  local root="$TMP_DIR/clean-$$-$RANDOM"
  mkdir -p "$root"
  echo '' > "$root/settings.gradle.kts"
  echo "$root"
}

# Build a project with one library module whose consumer-rules.pro contains
# a confirmed AGP 9 banned directive (-dontobfuscate).
make_invalid_consumer_project() {
  local root="$TMP_DIR/invalid-$$-$RANDOM"
  local lib="$root/lib"
  mkdir -p "$lib"
  cat > "$root/settings.gradle.kts" <<'GRADLE'
include(":lib")
GRADLE
  cat > "$lib/build.gradle.kts" <<'GRADLE'
plugins {
    id("com.android.library")
}
android {
    defaultConfig {
        consumerProguardFiles("consumer-rules.pro")
    }
}
GRADLE
  cat > "$lib/consumer-rules.pro" <<'PRO'
-dontobfuscate
-keep class com.example.Foo { *; }
PRO
  echo "$root"
}

setup() {
  mkdir -p "$TMP_DIR"
}

teardown() {
  rm -rf "$TMP_DIR" 2>/dev/null || true
}

# ── Script existence ──────────────────────────────────────────────────────────

@test "proguard-validate.sh exists and is executable" {
  [ -f "$SCRIPT" ]
  [ -x "$SCRIPT" ]
}

@test "proguard-validate.ps1 exists" {
  [ -f "$PS1_SCRIPT" ]
}

# ── Case 1: --check-agp9-globals on clean project exits 0 ────────────────────

@test "--check-agp9-globals flag: exits 0 on clean project" {
  local root
  root=$(make_clean_project)
  run node "$REAL_CLI" --project-root "$root" --check-agp9-globals
  [ "$status" -eq 0 ]
}

# ── Case 2: --check-agp9-globals + invalid consumer-rules.pro exits non-zero ─

@test "--check-agp9-globals flag: exits non-zero on project with banned directive in consumer rules" {
  local root
  root=$(make_invalid_consumer_project)
  run node "$REAL_CLI" --project-root "$root" --check-agp9-globals
  [ "$status" -ne 0 ]
}

# Build a project with a sealed class + proguard rules missing one subtype keep.
# The validator finds the WARN violation and renderMarkdown emits the section header.
make_sealed_class_violation_project() {
  local root="$TMP_DIR/sealed-$$-$RANDOM"
  local lib="$root/lib"
  local src="$lib/src/main/kotlin/com/example/test"
  mkdir -p "$src"
  cat > "$root/settings.gradle.kts" <<'GRADLE'
include(":lib")
GRADLE
  cat > "$lib/build.gradle.kts" <<'GRADLE'
plugins {
    id("com.android.library")
}
android {
    buildTypes {
        release {
            proguardFiles("proguard-rules.pro")
        }
    }
}
GRADLE
  cat > "$src/SealedParent.kt" <<'KT'
package com.example.test
sealed class SealedParent
class SubtypeA : SealedParent()
class SubtypeB : SealedParent()
KT
  cat > "$lib/proguard-rules.pro" <<'PRO'
-keep class com.example.test.SealedParent { *; }
-keep class com.example.test.SubtypeA { *; }
# SubtypeB keep is intentionally missing
PRO
  echo "$root"
}

# ── Case 3: --sealed-parents flag parsed → output contains sealed-class section

@test "--sealed-parents flag: output contains sealed-class section header when violation found" {
  local root
  root=$(make_sealed_class_violation_project)
  run node "$REAL_CLI" --project-root "$root" --sealed-parents "com.example.test.SealedParent"
  [[ "$output" == *"Sealed Class"* ]] || [[ "$output" == *"sealed"* ]]
}
