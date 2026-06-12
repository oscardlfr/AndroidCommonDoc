#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Tests for scripts/sh/write-bundle.sh (BL-W47 ex-PR2).
# Context bundle writer: flag+stdin interface, YAML header authoring,
# slug resolution, and output path contract.
#
# Schema contract: docs/agents/context-bundle-schema.md §Writer Contract
#   and §Header Format.
#
# ★ = contract-mandated minimum cases (arch-platform dispatch)

SCRIPT="$BATS_TEST_DIRNAME/../sh/write-bundle.sh"

# Minimal stdin body used by all happy-path tests.
BODY_CONTENT="## Patterns
- docs/testing/testing-patterns.md (slug: testing-patterns) — general test patterns

## Status Snapshot
- task: T4 (write-bundle bats) — state: IN-PROGRESS"

setup() {
  PROJ="$(mktemp -d)"
  # Ensure no ambient CLAUDE_WAVE_SLUG leaks into error-case tests.
  unset CLAUDE_WAVE_SLUG
}

teardown() {
  rm -rf "$PROJ"
}

# ── Helper: run the script with project root forced to PROJ ──────────────────
# Usage: run_writer [extra args...] <<'BODY'
# The script must respect PROJECT_ROOT env so tests never touch live .planning/.
run_writer() {
  run bash -c "cd '$PROJ' && printf '%s\n' \"$BODY_CONTENT\" | bash '$SCRIPT' $*"
}

run_writer_env() {
  local extra_env="$1"
  shift
  run bash -c "cd '$PROJ' && printf '%s\n' \"$BODY_CONTENT\" | $extra_env bash '$SCRIPT' $*"
}

# ── ★1 HAPPY PATH: --slug fixed, all required headers present ────────────────

@test "★1 PASS: output file created at correct path when --slug provided" {
  run_writer --role test-specialist \
    --plan-id "wave-bl-w47-bundles/PLAN.md#T4" \
    --slug bl-w47-test
  [ "$status" -eq 0 ]
  [ -f "$PROJ/.planning/wave-bl-w47-test/context-bundles/test-specialist.md" ]
}

@test "★2 PASS: wave_slug header matches --slug value" {
  run_writer --role test-specialist \
    --plan-id "wave-bl-w47-bundles/PLAN.md#T4" \
    --slug bl-w47-test
  [ "$status" -eq 0 ]
  local out="$PROJ/.planning/wave-bl-w47-test/context-bundles/test-specialist.md"
  grep -qF "wave_slug: bl-w47-test" "$out"
}

@test "★3 PASS: created_at is ISO-8601 UTC (seconds precision, Z suffix)" {
  run_writer --role test-specialist \
    --plan-id "wave-bl-w47-bundles/PLAN.md#T4" \
    --slug bl-w47-test
  [ "$status" -eq 0 ]
  local out="$PROJ/.planning/wave-bl-w47-test/context-bundles/test-specialist.md"
  grep -qE "^created_at: [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$" "$out"
}

@test "★4 PASS: bundle_role header matches --role value" {
  run_writer --role test-specialist \
    --plan-id "wave-bl-w47-bundles/PLAN.md#T4" \
    --slug bl-w47-test
  [ "$status" -eq 0 ]
  local out="$PROJ/.planning/wave-bl-w47-test/context-bundles/test-specialist.md"
  grep -qF "bundle_role: test-specialist" "$out"
}

@test "★5 PASS: stdin body appears after closing --- of frontmatter" {
  run_writer --role test-specialist \
    --plan-id "wave-bl-w47-bundles/PLAN.md#T4" \
    --slug bl-w47-test
  [ "$status" -eq 0 ]
  local out="$PROJ/.planning/wave-bl-w47-test/context-bundles/test-specialist.md"
  # Body line must appear somewhere after the second --- delimiter.
  # Use awk: skip content until second ---, then scan for the body marker.
  awk 'BEGIN{d=0} /^---/{d++; next} d>=2 && /## Patterns/{found=1} END{exit !found}' "$out"
}

@test "6 PASS: plan_id header matches --plan-id value" {
  run_writer --role test-specialist \
    --plan-id "wave-bl-w47-bundles/PLAN.md#T4" \
    --slug bl-w47-test
  [ "$status" -eq 0 ]
  local out="$PROJ/.planning/wave-bl-w47-test/context-bundles/test-specialist.md"
  grep -qF "plan_id: wave-bl-w47-bundles/PLAN.md#T4" "$out"
}

@test "7 PASS: schema_version field present in frontmatter" {
  run_writer --role test-specialist \
    --plan-id "wave-bl-w47-bundles/PLAN.md#T4" \
    --slug bl-w47-test
  [ "$status" -eq 0 ]
  local out="$PROJ/.planning/wave-bl-w47-test/context-bundles/test-specialist.md"
  grep -qE "^schema_version:" "$out"
}

@test "8 PASS: CLAUDE_WAVE_SLUG env used when --slug not provided" {
  run_writer_env "CLAUDE_WAVE_SLUG=bl-w47-env" \
    --role test-specialist \
    --plan-id "wave-bl-w47-bundles/PLAN.md#T4"
  [ "$status" -eq 0 ]
  [ -f "$PROJ/.planning/wave-bl-w47-env/context-bundles/test-specialist.md" ]
  grep -qF "wave_slug: bl-w47-env" \
    "$PROJ/.planning/wave-bl-w47-env/context-bundles/test-specialist.md"
}

@test "9 PASS: --slug takes precedence over CLAUDE_WAVE_SLUG env" {
  run_writer_env "CLAUDE_WAVE_SLUG=bl-w47-env" \
    --role test-specialist \
    --plan-id "wave-bl-w47-bundles/PLAN.md#T4" \
    --slug bl-w47-flag
  [ "$status" -eq 0 ]
  [ -f "$PROJ/.planning/wave-bl-w47-flag/context-bundles/test-specialist.md" ]
  grep -qF "wave_slug: bl-w47-flag" \
    "$PROJ/.planning/wave-bl-w47-flag/context-bundles/test-specialist.md"
}

@test "10 PASS: intermediate directories created when absent" {
  # .planning/ and context-bundles/ must not pre-exist.
  [ ! -d "$PROJ/.planning" ]
  run_writer --role test-specialist \
    --plan-id "wave-bl-w47-bundles/PLAN.md#T4" \
    --slug bl-w47-test
  [ "$status" -eq 0 ]
  [ -d "$PROJ/.planning/wave-bl-w47-test/context-bundles" ]
}

@test "11 PASS: overwrite semantics — latest write wins (file replaced)" {
  run_writer --role test-specialist \
    --plan-id "wave-bl-w47-bundles/PLAN.md#T4" \
    --slug bl-w47-test
  [ "$status" -eq 0 ]
  local out="$PROJ/.planning/wave-bl-w47-test/context-bundles/test-specialist.md"
  local first_ts
  first_ts="$(grep '^created_at:' "$out")"
  # Second write with a different plan-id.
  run bash -c "cd '$PROJ' && printf '%s\n' 'second body' | bash '$SCRIPT' \
    --role test-specialist \
    --plan-id 'wave-bl-w47-bundles/PLAN.md#T9' \
    --slug bl-w47-test"
  [ "$status" -eq 0 ]
  grep -qF "plan_id: wave-bl-w47-bundles/PLAN.md#T9" "$out"
}

# ── ★ ERROR CASES ─────────────────────────────────────────────────────────────

@test "★E1 BLOCK: missing --role exits non-zero" {
  run_writer --plan-id "wave-bl-w47-bundles/PLAN.md#T4" --slug bl-w47-test
  [ "$status" -ne 0 ]
}

@test "★E2 BLOCK: unresolvable slug exits non-zero (no --slug, no env, non-git tmpdir)" {
  # PROJ is a plain tmpdir — not a git repo, no feature/ branch to parse.
  # No --slug, no CLAUDE_WAVE_SLUG → slug is unresolvable → must exit non-zero.
  run bash -c "cd '$PROJ' && printf '%s\n' '$BODY_CONTENT' | bash '$SCRIPT' \
    --role test-specialist \
    --plan-id 'wave-bl-w47-bundles/PLAN.md#T4'"
  [ "$status" -ne 0 ]
}

@test "E3 BLOCK: missing --plan-id exits non-zero" {
  run_writer --role test-specialist --slug bl-w47-test
  [ "$status" -ne 0 ]
}

@test "E4 BLOCK: no arguments at all exits non-zero" {
  run bash -c "cd '$PROJ' && printf '%s\n' '$BODY_CONTENT' | bash '$SCRIPT'"
  [ "$status" -ne 0 ]
}

@test "E5 BLOCK: output file NOT written on error (missing --role)" {
  run_writer --plan-id "wave-bl-w47-bundles/PLAN.md#T4" --slug bl-w47-test
  [ "$status" -ne 0 ]
  [ ! -f "$PROJ/.planning/wave-bl-w47-test/context-bundles/.md" ]
  # Confirm no partial bundle under the wave dir.
  [ ! -d "$PROJ/.planning/wave-bl-w47-test/context-bundles" ] || \
    [ -z "$(ls -A "$PROJ/.planning/wave-bl-w47-test/context-bundles/" 2>/dev/null)" ]
}

# ── TRAVERSAL / INJECTION VALIDATION ─────────────────────────────────────────

@test "E6 BLOCK: role path traversal exits non-zero and writes nothing outside context-bundles" {
  # A role value containing ../ must be rejected — the script must never
  # resolve a path that escapes the context-bundles/ directory.
  run bash -c "cd '$PROJ' && printf '%s\n' '$BODY_CONTENT' | bash '$SCRIPT' \
    --role '../../evil' \
    --plan-id 'test/PLAN.md' \
    --slug bl-w47-test"
  [ "$status" -ne 0 ]
  # Nothing containing "evil" must exist anywhere under the tmpdir.
  [ -z "$(find "$PROJ" -name 'evil*' -o -name '*evil*' 2>/dev/null)" ]
  # The context-bundles dir must not have been created (or must be empty).
  [ ! -d "$PROJ/.planning/wave-bl-w47-test/context-bundles" ] || \
    [ -z "$(ls -A "$PROJ/.planning/wave-bl-w47-test/context-bundles/" 2>/dev/null)" ]
}

@test "E7 BLOCK: slug containing slash exits non-zero" {
  # A slug with an embedded slash would escape the wave-dir naming convention.
  run bash -c "cd '$PROJ' && printf '%s\n' '$BODY_CONTENT' | bash '$SCRIPT' \
    --role test-specialist \
    --plan-id 'test/PLAN.md' \
    --slug 'bad/slug'"
  [ "$status" -ne 0 ]
}

@test "E8 BLOCK: body exceeding 60 lines exits non-zero and writes nothing" {
  # 61 lines is one over the allowed maximum — script must reject and write nothing.
  # Use echo (not printf with leading '-') to avoid printf flag-parsing on some shells.
  run bash -c "cd '$PROJ' && (for i in \$(seq 1 61); do echo \"line \$i\"; done) | bash '$SCRIPT' \
    --role test-specialist \
    --plan-id 'wave-bl-w47-bundles/PLAN.md#T4' \
    --slug bl-w47-test"
  [ "$status" -ne 0 ]
  [ ! -d "$PROJ/.planning/wave-bl-w47-test/context-bundles" ] || \
    [ -z "$(ls -A "$PROJ/.planning/wave-bl-w47-test/context-bundles/" 2>/dev/null)" ]
}

@test "E9 BLOCK: plan-id with embedded newline exits non-zero" {
  # A newline inside plan-id could inject arbitrary YAML fields into the frontmatter.
  # Write the payload to a file to safely carry it past bats quoting layers.
  local payload_file
  payload_file="$(mktemp "$PROJ/payload.XXXXXX")"
  printf 'wave-bl-w47/PLAN.md\ninjected: evil' > "$payload_file"
  local bad_plan_id
  bad_plan_id="$(cat "$payload_file")"
  run bash -c "cd '$PROJ' && printf '%s\n' '$BODY_CONTENT' | bash '$SCRIPT' \
    --role test-specialist \
    --plan-id \"$bad_plan_id\" \
    --slug bl-w47-test"
  [ "$status" -ne 0 ]
}
