#!/usr/bin/env bats
#
# Tests for scripts/sh/qg-path-audit.sh (BL-W47 ex-PR4 D-7).
# QG declared-vs-touched verification step.
#
# Infra: fixture-driven (isolated git repos in BATS_TEST_TMPDIR).

SCRIPT="$BATS_TEST_DIRNAME/../sh/qg-path-audit.sh"

setup() {
  PROJ="$(mktemp -d)"
  git -C "$PROJ" init -q 2>/dev/null
  git -C "$PROJ" config user.email "bats@test.local"
  git -C "$PROJ" config user.name "Bats Test"
  git -C "$PROJ" commit --allow-empty -q -m "init"
  BASE="$(git -C "$PROJ" rev-parse HEAD)"

  WAVE_DIR="$PROJ/.planning/wave-bl-w47-expr4"
  mkdir -p "$WAVE_DIR"
}

teardown() {
  rm -rf "$PROJ"
}

write_class() {
  printf '%s' "$1" > "$WAVE_DIR/CLASS"
}

write_plan() {
  local class_val="${1:-HARNESS}"
  local manifest_files="${2:-- scripts/sh/pre-commit-hook.sh}"
  cat > "$WAVE_DIR/PLAN.md" <<PLANEOF
### Wave Class

- **Class**: ${class_val}

### Path-Manifest

${manifest_files}

### Spawn Table

| Role | Count | Reason |
|---|---|---|
| arch-platform | 1 | owns hooks |
PLANEOF
}

touch_file() {
  local filepath="$1"
  mkdir -p "$PROJ/$(dirname "$filepath")"
  printf 'content\n' > "$PROJ/$filepath"
  git -C "$PROJ" add "$filepath"
  git -C "$PROJ" commit -q -m "touch $filepath"
}

@test "PA-1 PASS: CLASS matches PLAN.md, touched file in manifest → exit 0" {
  write_class "HARNESS"
  write_plan "HARNESS" "- scripts/sh/pre-commit-hook.sh"
  touch_file "scripts/sh/pre-commit-hook.sh"

  run bash "$SCRIPT" --wave-dir "$WAVE_DIR" --plan "$WAVE_DIR/PLAN.md" --base "$BASE"
  [ "$status" -eq 0 ]
}

@test "PA-2 FAIL: CLASS sentinel (HARNESS) != PLAN.md class (DOC) → exit 1" {
  write_class "HARNESS"
  write_plan "DOC" "- docs/agents/tl-session-start.md"
  touch_file "docs/agents/tl-session-start.md"

  run bash "$SCRIPT" --wave-dir "$WAVE_DIR" --plan "$WAVE_DIR/PLAN.md" --base "$BASE"
  [ "$status" -eq 1 ]
  [[ "$output" == *"mismatch"* ]] || [[ "$output" == *"CLASS"* ]]
}

@test "PA-3 FAIL: touched file outside Path-Manifest → exit 1" {
  write_class "HARNESS"
  write_plan "HARNESS" "- scripts/sh/pre-commit-hook.sh"
  # Touch a file NOT in the manifest
  touch_file "scripts/sh/some-other-script.sh"

  run bash "$SCRIPT" --wave-dir "$WAVE_DIR" --plan "$WAVE_DIR/PLAN.md" --base "$BASE"
  [ "$status" -eq 1 ]
  [[ "$output" == *"manifest"* ]] || [[ "$output" == *"out-of-manifest"* ]]
}

@test "PA-4 PASS: SKIP_PATH_AUDIT=1 → exit 0 regardless of mismatch (escape hatch)" {
  write_class "HARNESS"
  write_plan "DOC" "- docs/agents/tl-session-start.md"
  touch_file "docs/agents/tl-session-start.md"

  run bash -c "SKIP_PATH_AUDIT=1 bash '$SCRIPT' --wave-dir '$WAVE_DIR' --plan '$WAVE_DIR/PLAN.md' --base '$BASE'"
  [ "$status" -eq 0 ]
}

@test "PA-5 FAIL: DOC-class + scripts/ path touched → under-declared class → exit 1" {
  write_class "DOC"
  write_plan "DOC" "- scripts/sh/some-hook.sh"
  touch_file "scripts/sh/some-hook.sh"

  run bash "$SCRIPT" --wave-dir "$WAVE_DIR" --plan "$WAVE_DIR/PLAN.md" --base "$BASE"
  [ "$status" -eq 1 ]
}
