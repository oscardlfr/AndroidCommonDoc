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

# ── PA-6+ Over-parse / boundary / missing-header tests ───────────────────────

# Write a PLAN.md with a prose intro line, bold sub-headers, real path bullets,
# a --- rule, and a ### Excluded Paths section with path-looking bullets.
# Returns (via $WAVE_DIR/PLAN.md) a plan whose manifest section contains exactly
# 3 real path entries — the exact count to assert in PA-6.
write_overparse_plan() {
  local class_val="${1:-HARNESS}"
  cat > "$WAVE_DIR/PLAN.md" <<'PLANEOF'
### Wave Class

- **Class**: HARNESS

### Path-Manifest

This section lists every file this wave may touch.

**New files (create)**

- scripts/sh/qg-path-audit.sh
- scripts/sh/secret-scan-report.sh

**Modified files (edit)**

- scripts/tests/qg-path-audit.bats

---

### Excluded Paths

**Excluded** files that should NOT be parsed as manifest entries:

- docs/agents/quality-gater.md
- .planning/wave-test/PLAN.md

### Spawn Table

| Role | Count | Reason |
|---|---|---|
| arch-testing | 1 | owns tests |
PLANEOF
  # Patch the Class line if a different class was requested
  if [[ "$class_val" != "HARNESS" ]]; then
    sed -i "s/- \*\*Class\*\*: HARNESS/- **Class**: ${class_val}/" "$WAVE_DIR/PLAN.md"
  fi
}

@test "PA-6 PASS: over-parse fixture — parser counts exactly 3 real path bullets" {
  # Fixture has: 2 bold sub-headers, 3 real path bullets, 1 '---' rule,
  # and a ### Excluded Paths section with 2 path-looking bullets.
  # Parser must count ONLY the 3 real bullets inside ### Path-Manifest.
  write_class "HARNESS"
  write_overparse_plan "HARNESS"
  # Touch all 3 in-manifest files so the run hits exit 0
  touch_file "scripts/sh/qg-path-audit.sh"
  touch_file "scripts/sh/secret-scan-report.sh"
  touch_file "scripts/tests/qg-path-audit.bats"

  run bash "$SCRIPT" --wave-dir "$WAVE_DIR" --plan "$WAVE_DIR/PLAN.md" --base "$BASE"
  [ "$status" -eq 0 ]
  # Verify count via the manifest-has-N-entries stderr line
  [[ "$output" == *"Manifest has 3 entries."* ]]
}

@test "PA-7 FAIL: file only in Excluded Paths section is out-of-manifest → exit 1" {
  # docs/agents/quality-gater.md appears only in ### Excluded Paths — touching it
  # must produce an out-of-manifest failure.
  write_class "HARNESS"
  write_overparse_plan "HARNESS"
  # Touch only the excluded file (not a real manifest entry)
  touch_file "docs/agents/quality-gater.md"

  run bash "$SCRIPT" --wave-dir "$WAVE_DIR" --plan "$WAVE_DIR/PLAN.md" --base "$BASE"
  [ "$status" -eq 1 ]
  [[ "$output" == *"out-of-manifest"* ]]
}

@test "PA-8 PASS: '---' rule and bold label inside manifest are NOT counted as entries" {
  # The fixture contains a '---' separator and two '**bold**' sub-headers inside
  # ### Path-Manifest; none should be counted as path entries.
  # If they were mis-counted the total would be >3; we verify count==3.
  write_class "HARNESS"
  write_overparse_plan "HARNESS"
  touch_file "scripts/sh/qg-path-audit.sh"
  touch_file "scripts/sh/secret-scan-report.sh"
  touch_file "scripts/tests/qg-path-audit.bats"

  run bash "$SCRIPT" --wave-dir "$WAVE_DIR" --plan "$WAVE_DIR/PLAN.md" --base "$BASE"
  [ "$status" -eq 0 ]
  # Count must be exactly 3 — not 4, 5, or more from mis-parsed rules/labels
  [[ "$output" == *"Manifest has 3 entries."* ]]
  [[ "$output" != *"Manifest has 4 entries."* ]]
  [[ "$output" != *"Manifest has 5 entries."* ]]
}

@test "PA-9 FAIL: missing ### Path-Manifest header in PLAN.md → exit 2" {
  write_class "HARNESS"
  # Write a PLAN.md that has no ### Path-Manifest header at all
  cat > "$WAVE_DIR/PLAN.md" <<'PLANEOF'
### Wave Class

- **Class**: HARNESS

### Spawn Table

| Role | Count | Reason |
|---|---|---|
| arch-testing | 1 | owns tests |
PLANEOF

  run bash "$SCRIPT" --wave-dir "$WAVE_DIR" --plan "$WAVE_DIR/PLAN.md" --base "$BASE"
  [ "$status" -eq 2 ]
  [[ "$output" == *"Path-Manifest header not found"* ]] || [[ "$output" == *"Path-Manifest"* ]]
}

# ── PA-10+ Wave 4 regressions: BL-W4-1 (decoy Class marker) + BL-W4-7 (sentinel exemption) ──

# write_decoy_class_plan <real_class> <decoy_class> — PLAN.md with a **Class**: marker
# in prose BEFORE the ### Wave Class heading (decoy), plus the real Class label under
# the heading itself. BL-W4-1: PLAN_CLASS extraction (Step 2) must anchor to the
# ### Wave Class section — mirroring Step 4's own Path-Manifest anchoring shape — not
# grab the first **Class**: match anywhere in the file via an unanchored `grep -m1`.
write_decoy_class_plan() {
  local real_class="$1" decoy_class="$2"
  cat > "$WAVE_DIR/PLAN.md" <<PLANEOF
### Context

Some prose mentioning a **Class**: ${decoy_class} label as an example, written
before the real ### Wave Class heading below — this is a decoy that an
unanchored \`grep -m1 '\*\*Class\*\*:'\` would match first.

### Wave Class

- **Class**: ${real_class}

### Path-Manifest

- scripts/sh/pre-commit-hook.sh

### Spawn Table

| Role | Count | Reason |
|---|---|---|
| arch-platform | 1 | owns hooks |
PLANEOF
}

@test "PA-10 PASS: decoy **Class**: marker in prose before ### Wave Class heading still resolves the real class (BL-W4-1)" {
  write_class "HARNESS"
  write_decoy_class_plan "HARNESS" "DOC"
  touch_file "scripts/sh/pre-commit-hook.sh"

  run bash "$SCRIPT" --wave-dir "$WAVE_DIR" --plan "$WAVE_DIR/PLAN.md" --base "$BASE"
  [ "$status" -eq 0 ]
  # Line-anchored proof the extracted PLAN_CLASS is the real (anchored) value, not the
  # decoy — an unanchored grep -m1 would have extracted "DOC" here and mismatched.
  # `|| return 1`: non-final [[ ]] does not abort a bats body on failure (bash/bats
  # quirk) — defensive even though currently the last statement (future-proofing).
  [[ "$output" == *"CLASS check: HARNESS == HARNESS OK"* ]] || return 1
}

@test "PA-11 PASS: committed sentinel .claude/wave-quality-gates/<slug>.md absent from manifest is exempted, not FAILed (BL-W4-7)" {
  write_class "HARNESS"
  write_plan "HARNESS" "- scripts/sh/pre-commit-hook.sh"
  touch_file "scripts/sh/pre-commit-hook.sh"
  # Sentinel matching THIS wave's own slug (WAVE_DIR basename minus "wave-" prefix is
  # "bl-w47-expr4") — deliberately NOT listed in the Path-Manifest above.
  touch_file ".claude/wave-quality-gates/bl-w47-expr4.md"

  run bash "$SCRIPT" --wave-dir "$WAVE_DIR" --plan "$WAVE_DIR/PLAN.md" --base "$BASE"
  [ "$status" -eq 0 ]
}

@test "PA-12 FAIL: .claude/wave-quality-gates/ file for a DIFFERENT slug is still out-of-manifest (BL-W4-7 exact-match, not dir-prefix)" {
  # The exemption is an exact single-file match against THIS wave's own slug — NOT a
  # directory-prefix allowlist over .claude/wave-quality-gates/. A sibling wave's
  # sentinel living in the same directory must not be silently exempted.
  write_class "HARNESS"
  write_plan "HARNESS" "- scripts/sh/pre-commit-hook.sh"
  touch_file "scripts/sh/pre-commit-hook.sh"
  touch_file ".claude/wave-quality-gates/some-other-wave.md"

  run bash "$SCRIPT" --wave-dir "$WAVE_DIR" --plan "$WAVE_DIR/PLAN.md" --base "$BASE"
  [ "$status" -eq 1 ]
  # `|| return 1`: defensive against the non-final-[[ ]] bats/bash abort quirk.
  [[ "$output" == *"out-of-manifest"* ]] || return 1
}
