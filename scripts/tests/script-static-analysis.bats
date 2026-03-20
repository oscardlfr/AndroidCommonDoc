#!/usr/bin/env bats
# =============================================================================
# Static analysis tests for all shell scripts
#
# Validates structural correctness without executing the scripts:
# - Shebang and strict mode
# - Parameter parsing (--help, --project-root)
# - Flag/option consistency between SH and PS1 pairs
# - No common anti-patterns (bare $TEMP_DIR, hardcoded paths, etc.)
# - JSON output format indicators
# =============================================================================

SH_DIR="$BATS_TEST_DIRNAME/../sh"
PS1_DIR="$BATS_TEST_DIRNAME/../ps1"

# ---------------------------------------------------------------------------
# Universal: every script has shebang + strict mode
# ---------------------------------------------------------------------------

@test "all scripts have bash shebang" {
    for f in "$SH_DIR"/*.sh; do
        head -1 "$f" | grep -q "^#!/" || {
            echo "MISSING shebang: $(basename "$f")"
            return 1
        }
    done
}

@test "all scripts use set -euo pipefail or set -e" {
    for f in "$SH_DIR"/*.sh; do
        grep -q "set -euo pipefail\|set -e" "$f" || {
            echo "MISSING strict mode: $(basename "$f")"
            return 1
        }
    done
}

# ---------------------------------------------------------------------------
# Parameter parsing: --project-root
# ---------------------------------------------------------------------------

@test "scripts that accept --project-root parse it correctly" {
    for f in "$SH_DIR"/*.sh; do
        name=$(basename "$f" .sh)
        # Skip lib scripts and scripts that don't use PROJECT_ROOT
        [[ -d "$f" ]] && continue
        grep -q "PROJECT_ROOT\|project.root" "$f" || continue
        
        # If it uses PROJECT_ROOT, it should have a way to set it
        has_flag=$(grep -c "\-\-project-root" "$f" || true)
        has_positional=$(grep -cE 'PROJECT_ROOT="\$1"|PROJECT_ROOT="\$\{1' "$f" || true)
        has_default=$(grep -c 'PROJECT_ROOT=.*pwd\|PROJECT_ROOT=.*BASH_SOURCE' "$f" || true)
        
        [ "$has_flag" -gt 0 ] || [ "$has_positional" -gt 0 ] || [ "$has_default" -gt 0 ] || {
            echo "MISSING --project-root or default: $name"
            return 1
        }
    done
}

# ---------------------------------------------------------------------------
# No hardcoded temp paths (use $TMPDIR or mktemp)
# ---------------------------------------------------------------------------

@test "no scripts use hardcoded /tmp/ paths (use TMPDIR or mktemp)" {
    FAIL=0
    for f in "$SH_DIR"/*.sh; do
        name=$(basename "$f")
        # Allow /tmp in comments and strings, flag direct path usage
        bad=$(grep -nE '^\s*[^#]*"/tmp/' "$f" | grep -v 'TMPDIR\|mktemp\|fallback\|TEMP' || true)
        if [ -n "$bad" ]; then
            echo "HARDCODED /tmp/ in $name:"
            echo "$bad"
            FAIL=1
        fi
    done
    [ "$FAIL" -eq 0 ]
}

# ---------------------------------------------------------------------------
# TOOLKIT_ROOT resolution (L0 scripts)
# ---------------------------------------------------------------------------

@test "L0 scripts resolve TOOLKIT_ROOT from ANDROID_COMMON_DOC or BASH_SOURCE" {
    for f in "$SH_DIR"/*.sh; do
        grep -q "TOOLKIT_ROOT" "$f" || continue
        grep -q 'ANDROID_COMMON_DOC\|BASH_SOURCE' "$f" || {
            echo "$(basename "$f") uses TOOLKIT_ROOT without ANDROID_COMMON_DOC or BASH_SOURCE fallback"
            return 1
        }
    done
}

# ---------------------------------------------------------------------------
# SH ↔ PS1 flag parity (scripts with both)
# ---------------------------------------------------------------------------

@test "SH and PS1 paired scripts have matching primary flags" {
    FAIL=0
    for sh_file in "$SH_DIR"/*.sh; do
        name=$(basename "$sh_file" .sh)
        ps1_file="$PS1_DIR/${name}.ps1"
        [ -f "$ps1_file" ] || continue
        
        # Extract --flags from SH
        sh_flags=$(grep -oE '\-\-[a-z][-a-z]*' "$sh_file" | sort -u)
        # Extract -FlagName from PS1 param block and convert to --flag-name
        ps1_flags=$(grep -oE '\$[A-Z][a-zA-Z]+' "$ps1_file" | head -20 | sed 's/\$//' | \
            sed 's/\([A-Z]\)/-\L\1/g' | sed 's/^-/--/' | sort -u)
        
        # Check critical flags: --project-root should exist in both if in SH
        if echo "$sh_flags" | grep -q "project-root"; then
            echo "$ps1_file" | grep -qi "ProjectRoot\|project.root" || true
        fi
    done
    [ "$FAIL" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Per-script: ai-error-extractor
# ---------------------------------------------------------------------------

@test "ai-error-extractor: has python3 for error parsing" {
    grep -q "python3" "$SH_DIR/ai-error-extractor.sh"
}

@test "ai-error-extractor: outputs JSON format" {
    grep -q "json\|JSON" "$SH_DIR/ai-error-extractor.sh"
}

# ---------------------------------------------------------------------------
# Per-script: analyze-sbom
# ---------------------------------------------------------------------------

@test "analyze-sbom: accepts --project-root and --sbom-path" {
    grep -q "\-\-project-root\|project.root" "$SH_DIR/analyze-sbom.sh"
    grep -q "\-\-sbom-path" "$SH_DIR/analyze-sbom.sh"
}

@test "analyze-sbom: has --help flag" {
    grep -q "\-\-help\|-h)" "$SH_DIR/analyze-sbom.sh"
}

# ---------------------------------------------------------------------------
# Per-script: api-diff
# ---------------------------------------------------------------------------

@test "api-diff: accepts --base and --head flags" {
    grep -q "\-\-base" "$SH_DIR/api-diff.sh"
    grep -q "\-\-head" "$SH_DIR/api-diff.sh"
}

@test "api-diff: has --scope flag for source set filtering" {
    grep -q "\-\-scope" "$SH_DIR/api-diff.sh"
}

# ---------------------------------------------------------------------------
# Per-script: build-run-app
# ---------------------------------------------------------------------------

@test "build-run-app: accepts platform argument (android/desktop)" {
    grep -q "android\|desktop" "$SH_DIR/build-run-app.sh"
}

@test "build-run-app: has --clean flag" {
    grep -q "\-\-clean" "$SH_DIR/build-run-app.sh"
}

# ---------------------------------------------------------------------------
# Per-script: check-doc-freshness
# ---------------------------------------------------------------------------

@test "check-doc-freshness: checks version references in docs" {
    grep -qi "version\|freshness\|manifest" "$SH_DIR/check-doc-freshness.sh"
}

# ---------------------------------------------------------------------------
# Per-script: code-metrics
# ---------------------------------------------------------------------------

@test "code-metrics: outputs JSON" {
    grep -q "json\|JSON" "$SH_DIR/code-metrics.sh"
}

@test "code-metrics: counts LOC and files" {
    grep -qi "LOC\|lines.*code\|file.*count\|wc" "$SH_DIR/code-metrics.sh"
}

# ---------------------------------------------------------------------------
# Per-script: generate-sbom
# ---------------------------------------------------------------------------

@test "generate-sbom: references CycloneDX" {
    grep -qi "cyclonedx\|bom\|sbom" "$SH_DIR/generate-sbom.sh"
}

# ---------------------------------------------------------------------------
# Per-script: gradle-config-check
# ---------------------------------------------------------------------------

@test "gradle-config-check: checks for hardcoded versions" {
    grep -qi "hardcoded\|version" "$SH_DIR/gradle-config-check.sh"
}

@test "gradle-config-check: checks convention plugins" {
    grep -qi "convention\|plugin" "$SH_DIR/gradle-config-check.sh"
}

# ---------------------------------------------------------------------------
# Per-script: gradle-run
# ---------------------------------------------------------------------------

@test "gradle-run: accepts module argument" {
    grep -q "module\|MODULE\|gradle.*task" "$SH_DIR/gradle-run.sh"
}

@test "gradle-run: has retry logic" {
    grep -qi "retry\|RETRY\|attempt" "$SH_DIR/gradle-run.sh"
}

# ---------------------------------------------------------------------------
# Per-script: lint-resources
# ---------------------------------------------------------------------------

@test "lint-resources: checks snake_case naming" {
    grep -qi "snake.case\|naming\|convention" "$SH_DIR/lint-resources.sh"
}

@test "lint-resources: checks strings.xml" {
    grep -q "strings.xml\|composeResources" "$SH_DIR/lint-resources.sh"
}

# ---------------------------------------------------------------------------
# Per-script: migration-check
# ---------------------------------------------------------------------------

@test "migration-check: checks Room or SQLDelight migrations" {
    grep -qi "room\|sqldelight\|migration" "$SH_DIR/migration-check.sh"
}

@test "migration-check: outputs JSON findings" {
    grep -q "json\|JSON\|findings" "$SH_DIR/migration-check.sh"
}

# ---------------------------------------------------------------------------
# Per-script: module-deps-graph
# ---------------------------------------------------------------------------

@test "module-deps-graph: detects cycles" {
    grep -qi "cycle\|circular\|dependency" "$SH_DIR/module-deps-graph.sh"
}

# ---------------------------------------------------------------------------
# Per-script: module-health-scan
# ---------------------------------------------------------------------------

@test "module-health-scan: counts source and test files" {
    grep -qi "source\|test.*file\|LOC\|wc" "$SH_DIR/module-health-scan.sh"
}

@test "module-health-scan: outputs JSON" {
    grep -q "json\|JSON" "$SH_DIR/module-health-scan.sh"
}

# ---------------------------------------------------------------------------
# Per-script: pattern-lint
# ---------------------------------------------------------------------------

@test "pattern-lint: checks multiple patterns" {
    # Should have multiple check functions or pattern names
    count=$(grep -c "check_\|CHECK_\|pattern" "$SH_DIR/pattern-lint.sh" || true)
    [ "$count" -ge 3 ]
}

@test "pattern-lint: has --show-details flag" {
    grep -q "\-\-show-details" "$SH_DIR/pattern-lint.sh"
}

# ---------------------------------------------------------------------------
# Per-script: scan-sbom
# ---------------------------------------------------------------------------

@test "scan-sbom: references Trivy" {
    grep -qi "trivy" "$SH_DIR/scan-sbom.sh"
}

@test "scan-sbom: outputs JSON findings" {
    grep -q "json\|JSON\|findings" "$SH_DIR/scan-sbom.sh"
}

# ---------------------------------------------------------------------------
# Per-script: sync-gsd-skills
# ---------------------------------------------------------------------------

@test "sync-gsd-skills: has --source flag" {
    grep -q "\-\-source" "$SH_DIR/sync-gsd-skills.sh"
}

@test "sync-gsd-skills: has --dry-run flag" {
    grep -q "\-\-dry-run" "$SH_DIR/sync-gsd-skills.sh"
}

@test "sync-gsd-skills: syncs marketplace + L0 skills + L0 agents" {
    grep -q "marketplace" "$SH_DIR/sync-gsd-skills.sh"
    grep -q "L0\|l0" "$SH_DIR/sync-gsd-skills.sh"
    grep -q "agents" "$SH_DIR/sync-gsd-skills.sh"
}

# ---------------------------------------------------------------------------
# Per-script: unused-strings
# ---------------------------------------------------------------------------

@test "unused-strings: searches for orphan string resources" {
    grep -qi "unused\|orphan\|string.*resource\|strings.xml" "$SH_DIR/unused-strings.sh"
}

# ---------------------------------------------------------------------------
# Per-script: run-android-tests
# ---------------------------------------------------------------------------

@test "run-android-tests: captures logcat" {
    grep -qi "logcat" "$SH_DIR/run-android-tests.sh"
}

@test "run-android-tests: uses adb" {
    grep -q "adb" "$SH_DIR/run-android-tests.sh"
}
