#!/usr/bin/env bats
# =============================================================================
# Tests for scripts/lib/parse-coverage-xml.py
#
# Validates:
#   - Kotlin inner/sealed class deduplication (one row per sourcefile)
#   - Correct coverage percentage calculation
#   - Missed-line extraction and ordering
#   - Multi-package aggregation
#   - 100% and 0% edge cases
#   - Gaps mode output
#   - Malformed / missing XML handling
# =============================================================================

FIXTURES="$BATS_TEST_DIRNAME/fixtures/jacoco"
PARSER="$BATS_TEST_DIRNAME/../lib/parse-coverage-xml.py"

# ---------------------------------------------------------------------------
# Helper: run parser and capture output
# ---------------------------------------------------------------------------
run_parser() {
    python3 "$PARSER" "$@"
}

# ---------------------------------------------------------------------------
# 1. Kotlin sealed class — inner class deduplication
# ---------------------------------------------------------------------------

@test "sealed class: emits ONE row per sourcefile, not per JVM class" {
    run run_parser "$FIXTURES/aes-algorithm.xml" "security:api"
    [ "$status" -eq 0 ]
    # AesAlgorithm.kt should appear exactly once
    count=$(echo "$output" | grep -c "AesAlgorithm.kt")
    [ "$count" -eq 1 ]
}

@test "sealed class: row is for module security:api" {
    run run_parser "$FIXTURES/aes-algorithm.xml" "security:api"
    [ "$status" -eq 0 ]
    echo "$output" | grep -q "^security:api|"
}

@test "sealed class: 100% coverage — missed=0" {
    run run_parser "$FIXTURES/aes-algorithm.xml" "security:api"
    [ "$status" -eq 0 ]
    # Field 6 (0-indexed 5) is missed count
    missed=$(echo "$output" | grep "AesAlgorithm.kt" | cut -d'|' -f6)
    [ "$missed" -eq 0 ]
}

@test "sealed class: coverage percentage is 100.0" {
    run run_parser "$FIXTURES/aes-algorithm.xml" "security:api"
    [ "$status" -eq 0 ]
    pct=$(echo "$output" | grep "AesAlgorithm.kt" | cut -d'|' -f8)
    [ "$pct" = "100.0" ]
}

@test "sealed class: no duplicate rows for inner variants" {
    run run_parser "$FIXTURES/aes-algorithm.xml" "security:api"
    [ "$status" -eq 0 ]
    # Output should be exactly 1 line (one sourcefile)
    line_count=$(echo "$output" | grep -c "|")
    [ "$line_count" -eq 1 ]
}

# ---------------------------------------------------------------------------
# 2. Partial coverage — missed lines extraction
# ---------------------------------------------------------------------------

@test "partial coverage: StorageRepository.kt has 3 missed lines" {
    run run_parser "$FIXTURES/partial-coverage.xml" "storage:api"
    [ "$status" -eq 0 ]
    missed=$(echo "$output" | grep "StorageRepository.kt" | cut -d'|' -f6)
    [ "$missed" -eq 3 ]
}

@test "partial coverage: StorageRepository.kt missed lines are 18,21,27" {
    run run_parser "$FIXTURES/partial-coverage.xml" "storage:api"
    [ "$status" -eq 0 ]
    missed_lines=$(echo "$output" | grep "StorageRepository.kt" | cut -d'|' -f9)
    [ "$missed_lines" = "18,21,27" ]
}

@test "partial coverage: RestrictedApi.kt is 0% with 9 missed" {
    run run_parser "$FIXTURES/partial-coverage.xml" "storage:api"
    [ "$status" -eq 0 ]
    pct=$(echo "$output" | grep "RestrictedApi.kt" | cut -d'|' -f8)
    [ "$pct" = "0.0" ]
    missed=$(echo "$output" | grep "RestrictedApi.kt" | cut -d'|' -f6)
    [ "$missed" -eq 9 ]
}

@test "partial coverage: emits exactly 2 rows (one per sourcefile)" {
    run run_parser "$FIXTURES/partial-coverage.xml" "storage:api"
    [ "$status" -eq 0 ]
    row_count=$(echo "$output" | grep -c "^storage:api|")
    [ "$row_count" -eq 2 ]
}

@test "partial coverage: Companion class does NOT appear as separate row" {
    run run_parser "$FIXTURES/partial-coverage.xml" "storage:api"
    [ "$status" -eq 0 ]
    # Should not have a row with Companion in the class name field (col 4)
    companion_rows=$(echo "$output" | awk -F'|' '{print $4}' | grep -c "Companion" || true)
    [ "$companion_rows" -eq 0 ]
}

# ---------------------------------------------------------------------------
# 3. Full coverage — 100%, no missed lines
# ---------------------------------------------------------------------------

@test "full coverage: User.kt is 100%" {
    run run_parser "$FIXTURES/full-coverage.xml" "core:model"
    [ "$status" -eq 0 ]
    pct=$(echo "$output" | grep "User.kt" | cut -d'|' -f8)
    [ "$pct" = "100.0" ]
}

@test "full coverage: missed lines field is empty" {
    run run_parser "$FIXTURES/full-coverage.xml" "core:model"
    [ "$status" -eq 0 ]
    missed_lines=$(echo "$output" | grep "User.kt" | cut -d'|' -f9)
    [ -z "$missed_lines" ]
}

# ---------------------------------------------------------------------------
# 4. Multi-package
# ---------------------------------------------------------------------------

@test "multi-package: emits one row per sourcefile across packages" {
    run run_parser "$FIXTURES/multi-package.xml" "core:domain"
    [ "$status" -eq 0 ]
    row_count=$(echo "$output" | grep -c "^core:domain|")
    [ "$row_count" -eq 2 ]
}

@test "multi-package: UserUseCase.kt has 2 missed lines" {
    run run_parser "$FIXTURES/multi-package.xml" "core:domain"
    [ "$status" -eq 0 ]
    missed=$(echo "$output" | grep "UserUseCase.kt" | cut -d'|' -f6)
    [ "$missed" -eq 2 ]
}

@test "multi-package: UserRepository.kt is 100%" {
    run run_parser "$FIXTURES/multi-package.xml" "core:domain"
    [ "$status" -eq 0 ]
    pct=$(echo "$output" | grep "UserRepository.kt" | cut -d'|' -f9)
    # col 8 (1-indexed) is pct
    pct=$(echo "$output" | grep "UserRepository.kt" | cut -d'|' -f8)
    [ "$pct" = "100.0" ]
}

@test "multi-package: package names are correct" {
    run run_parser "$FIXTURES/multi-package.xml" "core:domain"
    [ "$status" -eq 0 ]
    echo "$output" | grep "UserUseCase.kt" | grep -q "com/example/domain"
    echo "$output" | grep "UserRepository.kt" | grep -q "com/example/domain/repo"
}

# ---------------------------------------------------------------------------
# 5. Gaps mode
# ---------------------------------------------------------------------------

@test "gaps mode: partial-coverage returns 2 gaps (StorageRepository + RestrictedApi)" {
    run run_parser "$FIXTURES/partial-coverage.xml" "storage:api" --mode gaps
    [ "$status" -eq 0 ]
    gap_count=$(echo "$output" | grep -c "|")
    [ "$gap_count" -eq 2 ]
}

@test "gaps mode: sorted by missed lines descending (RestrictedApi first)" {
    run run_parser "$FIXTURES/partial-coverage.xml" "storage:api" --mode gaps
    [ "$status" -eq 0 ]
    first=$(echo "$output" | head -1 | cut -d'|' -f1)
    [ "$first" = "RestrictedApi.kt" ]
}

@test "gaps mode: full-coverage returns no gaps" {
    run run_parser "$FIXTURES/full-coverage.xml" "core:model" --mode gaps
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "gaps mode: missed ranges are formatted correctly for RestrictedApi" {
    run run_parser "$FIXTURES/partial-coverage.xml" "storage:api" --mode gaps
    [ "$status" -eq 0 ]
    ranges=$(echo "$output" | grep "RestrictedApi.kt" | cut -d'|' -f6)
    # lines 14,19,25,30,35,40,46,52,58 — all individual (no consecutive)
    [ -n "$ranges" ]
    echo "$ranges" | grep -q "14"
    echo "$ranges" | grep -q "58"
}

# ---------------------------------------------------------------------------
# 6. Error handling
# ---------------------------------------------------------------------------

@test "missing xml file: exits 0 silently (no crash)" {
    run run_parser "/tmp/does-not-exist-$$.xml" "core:api"
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "malformed xml: exits 0 silently (no crash)" {
    local bad_xml
    bad_xml=$(mktemp)
    echo "this is not xml <unclosed" > "$bad_xml"
    run run_parser "$bad_xml" "core:api"
    rm -f "$bad_xml"
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "empty xml report: exits 0, produces no output" {
    local empty_xml
    empty_xml=$(mktemp)
    echo '<?xml version="1.0"?><report name="empty"></report>' > "$empty_xml"
    run run_parser "$empty_xml" "core:api"
    rm -f "$empty_xml"
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

# ---------------------------------------------------------------------------
# 7. Output format validation
# ---------------------------------------------------------------------------

@test "report mode: each row has exactly 9 pipe-delimited fields" {
    run run_parser "$FIXTURES/partial-coverage.xml" "storage:api"
    [ "$status" -eq 0 ]
    while IFS= read -r line; do
        fields=$(echo "$line" | awk -F'|' '{print NF}')
        [ "$fields" -eq 9 ]
    done <<< "$output"
}

@test "report mode: field 1 is always the module name" {
    run run_parser "$FIXTURES/multi-package.xml" "core:domain"
    [ "$status" -eq 0 ]
    while IFS= read -r line; do
        module=$(echo "$line" | cut -d'|' -f1)
        [ "$module" = "core:domain" ]
    done <<< "$output"
}

@test "report mode: coverage pct field is a valid float 0-100" {
    run run_parser "$FIXTURES/partial-coverage.xml" "storage:api"
    [ "$status" -eq 0 ]
    while IFS= read -r line; do
        pct=$(echo "$line" | cut -d'|' -f8)
        python3 -c "v=float('$pct'); assert 0.0 <= v <= 100.0, f'Invalid pct: {v}'"
    done <<< "$output"
}
