#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Tests for scripts/sh/write-verdict.sh (BL-W47-hook-surgery).
# Canonical two-phase verdict writer: --role / --phase / --slug interface,
# confinement to .planning/<wave-slug>/arch-<role>-verdict.md, and
# integrity guards (traversal, duplicate, orphan-final, dual-token).
#
# ★ = contract-mandated minimum cases (V1-V7 from PLAN)
#
# Invocation: bats scripts/tests/write-verdict.bats  (from repo root)

SCRIPT="$BATS_TEST_DIRNAME/../sh/write-verdict.sh"
WAVE_SLUG="bl-w47-hook-surgery-test"

setup() {
  PROJ="$(mktemp -d)"
  # Initialise a throwaway git repo so git rev-parse --show-toplevel resolves
  # to PROJ, never the live repo.
  git -C "$PROJ" init -q 2>/dev/null
  # Fix #5 (a62fe89): write-verdict.sh verify-final now fail-closes if HEAD is not a
  # 40-hex SHA. Add an empty commit so HEAD resolves to a real SHA in verify-final tests.
  git -C "$PROJ" -c user.email=test@example.com -c user.name=test \
      commit -q --allow-empty -m init 2>/dev/null
  # Prevent ambient CLAUDE_WAVE_SLUG from leaking into error-case tests.
  unset CLAUDE_WAVE_SLUG
}

teardown() {
  rm -rf "$PROJ"
}

# Run the script from PROJ so git resolves there.
# Usage: run_verdict [extra args...]
# CLAUDE_WAVE_SLUG is passed inline per call to keep each test explicit.
run_verdict() {
  run bash -c "cd '$PROJ' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' $*"
}

# Variant: pass a custom slug inline (overrides the default WAVE_SLUG).
run_verdict_slug() {
  local slug="$1"
  shift
  run bash -c "cd '$PROJ' && CLAUDE_WAVE_SLUG='$slug' bash '$SCRIPT' $*"
}

# ── ★V1 PASS: prep creates verdict file at correct confinement path ───────────

@test "★V1 PASS: prep creates verdict file with APPROVED-PREP at correct path" {
  run_verdict --role arch-testing --phase prep --slug "$WAVE_SLUG"
  [ "$status" -eq 0 ]
  [ -f "$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict.md" ]
  grep -q "APPROVED-PREP" "$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict.md"
}

# ── ★V2 FAIL: verify-final without prior prep file → exit 2 ──────────────────

@test "★V2 FAIL: verify-final without prior prep file exits 2" {
  run_verdict --role arch-testing --phase verify-final --slug "$WAVE_SLUG"
  [ "$status" -eq 2 ]
  [[ "$output" == *"No prep verdict found"* ]]
}

# ── ★V3 FAIL: dual-token in body → verify-final exits 2 (replay guard) ───────

@test "★V3 FAIL: verify-final with both APPROVED-PREP and APPROVED-VERIFY-FINAL present exits 2" {
  # dual-token guard scans for APPROVED-VERIFY-FINAL (4c51929 rename from APPROVED-FINAL)
  mkdir -p "$PROJ/.planning/wave-$WAVE_SLUG"
  printf '**Status**: APPROVED-PREP\n**Status**: APPROVED-VERIFY-FINAL\n' \
    > "$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict.md"
  run_verdict --role arch-testing --phase verify-final --slug "$WAVE_SLUG"
  [ "$status" -eq 2 ]
  [[ "$output" == *"dual-token"* ]]
  [[ "$output" == *"APPROVED-VERIFY-FINAL"* ]]
}

# ── ★V4 FAIL: prep duplicate → exit 2 ────────────────────────────────────────

@test "★V4 FAIL: duplicate prep exits 2 when verdict file already exists" {
  mkdir -p "$PROJ/.planning/wave-$WAVE_SLUG"
  printf '**Status**: APPROVED-PREP\n' \
    > "$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict.md"
  run_verdict --role arch-testing --phase prep --slug "$WAVE_SLUG"
  [ "$status" -eq 2 ]
  [[ "$output" == *"already exists"* ]]
}

# ── ★V5 PASS: verify-final appends without overwriting APPROVED-PREP ─────────

@test "★V5 PASS: verify-final appends APPROVED-VERIFY-FINAL while preserving APPROVED-PREP" {
  # Token renamed to APPROVED-VERIFY-FINAL in 4c51929
  mkdir -p "$PROJ/.planning/wave-$WAVE_SLUG"
  printf '**Status**: APPROVED-PREP\n' \
    > "$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict.md"

  run_verdict --role arch-testing --phase verify-final --slug "$WAVE_SLUG" < /dev/null
  [ "$status" -eq 0 ]

  local verdict="$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict.md"
  grep -q "APPROVED-VERIFY-FINAL" "$verdict"
  grep -q "APPROVED-PREP"         "$verdict"
}

# ── V6: path traversal in slug → exit 2, nothing written ─────────────────────

@test "V6 FAIL: slug with .. traversal exits 2 and writes nothing" {
  run_verdict --role arch-testing --phase prep --slug "../evil"
  [ "$status" -eq 2 ]
  [[ "$output" == *"Traversal"* ]]
  # Nothing should be written outside PROJ.
  [ ! -d "$PROJ/.planning/wave-../evil" ]
}

@test "V6 FAIL: slug with / traversal exits 2" {
  run_verdict --role arch-testing --phase prep --slug "foo/bar"
  [ "$status" -eq 2 ]
  [[ "$output" == *"Traversal"* ]]
}

# ── V7: legacy heredoc dual-token → WARN on stderr, exit 0 ───────────────────

@test "V7 WARN: APPROVED-FINAL without APPROVED-PREP emits WARN on stderr and exits 0" {
  mkdir -p "$PROJ/.planning/wave-$WAVE_SLUG"
  # Simulate a legacy heredoc write: APPROVED-FINAL present, no APPROVED-PREP.
  printf '**Status**: APPROVED-FINAL\n' \
    > "$PROJ/.planning/wave-$WAVE_SLUG/arch-platform-verdict.md"

  run bash -c "cd '$PROJ' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' \
    --role arch-platform --phase verify-final --slug '$WAVE_SLUG'"
  # Must not block.
  [ "$status" -eq 0 ]
  # WARN and "legacy heredoc" must appear (bats captures stderr in $output).
  [[ "$output" == *"WARN"* ]]
  [[ "$output" == *"legacy heredoc"* ]]
}

# ── VN-1: stdin content prepended before closing block ───────────────────────

@test "VN-1 PASS: verify-final prepends stdin content with separator before APPROVED-VERIFY-FINAL" {
  mkdir -p "$PROJ/.planning/wave-$WAVE_SLUG"
  printf '**Status**: APPROVED-PREP\n' \
    > "$PROJ/.planning/wave-$WAVE_SLUG/arch-platform-verdict.md"

  run bash -c "echo '## My verdict body' | cd '$PROJ' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --role arch-platform --phase verify-final --slug '$WAVE_SLUG'"
  # Direct pipe run — bypass run_verdict helper to control stdin
  (
    cd "$PROJ"
    echo "## My verdict body" | CLAUDE_WAVE_SLUG="$WAVE_SLUG" \
      bash "$SCRIPT" --role arch-platform --phase verify-final --slug "$WAVE_SLUG"
  )
  local verdict="$PROJ/.planning/wave-$WAVE_SLUG/arch-platform-verdict.md"
  # stdin body appears before the closing token
  grep -q "## My verdict body" "$verdict"
  # separator line present between body and closing block
  grep -q "^---$" "$verdict"
  # closing token present
  grep -q "APPROVED-VERIFY-FINAL" "$verdict"
  # body must appear BEFORE the token (line number check)
  local body_line token_line
  body_line="$(grep -n "## My verdict body" "$verdict" | cut -d: -f1)"
  token_line="$(grep -n "APPROVED-VERIFY-FINAL" "$verdict" | cut -d: -f1)"
  [ "$body_line" -lt "$token_line" ]
}

# ── VN-2: no stdin (terminal redirect) → closing block only, no separator ────

@test "VN-2 PASS: verify-final with no stdin emits APPROVED-VERIFY-FINAL but no separator" {
  mkdir -p "$PROJ/.planning/wave-$WAVE_SLUG"
  printf '**Status**: APPROVED-PREP\n' \
    > "$PROJ/.planning/wave-$WAVE_SLUG/arch-platform-verdict.md"

  # Redirect stdin from /dev/null — simulates no piped content (terminal detection fallback)
  run bash -c "cd '$PROJ' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --role arch-platform --phase verify-final --slug '$WAVE_SLUG' < /dev/null"
  [ "$status" -eq 0 ]

  local verdict="$PROJ/.planning/wave-$WAVE_SLUG/arch-platform-verdict.md"
  grep -q "APPROVED-VERIFY-FINAL" "$verdict"
  # No separator: stdin was empty so the '---' block should be absent
  ! grep -q "^---$" "$verdict"
}

# ── VN-3: second verify-final (replay guard) → exit 2 ────────────────────────

@test "VN-3 FAIL: second verify-final (replay guard) exits 2, stderr names APPROVED-VERIFY-FINAL" {
  mkdir -p "$PROJ/.planning/wave-$WAVE_SLUG"
  printf '**Status**: APPROVED-PREP\n' \
    > "$PROJ/.planning/wave-$WAVE_SLUG/arch-platform-verdict.md"

  # First verify-final — must succeed
  (
    cd "$PROJ"
    echo "## First body" | CLAUDE_WAVE_SLUG="$WAVE_SLUG" \
      bash "$SCRIPT" --role arch-platform --phase verify-final --slug "$WAVE_SLUG"
  )

  # Second verify-final — must be blocked by dual-token replay guard
  run bash -c "cd '$PROJ' && echo 'body2' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --role arch-platform --phase verify-final --slug '$WAVE_SLUG'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"dual-token"* ]]
  [[ "$output" == *"APPROVED-VERIFY-FINAL"* ]]
}

# ── VN-4: prose mentioning token in stdin body does NOT trigger dual-token guard

@test "VN-4 PASS: APPROVED-VERIFY-FINAL in prose (mid-sentence) does not trigger guard" {
  # Anchored grep (592a8b5): guard only fires when token is on its OWN line.
  # A mention inside a sentence must not trigger exit 2.
  mkdir -p "$PROJ/.planning/wave-$WAVE_SLUG"
  printf '**Status**: APPROVED-PREP\n' \
    > "$PROJ/.planning/wave-$WAVE_SLUG/arch-platform-verdict.md"

  run bash -c "cd '$PROJ' && \
    echo 'This supersedes the old APPROVED-VERIFY-FINAL block' | \
    CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' \
    --role arch-platform --phase verify-final --slug '$WAVE_SLUG'"
  [ "$status" -eq 0 ]
  local verdict="$PROJ/.planning/wave-$WAVE_SLUG/arch-platform-verdict.md"
  grep -q "APPROVED-VERIFY-FINAL" "$verdict"
}

# ── VN-5: bare APPROVED-PREP line (no **Status**: prefix) recognized by prep check

@test "VN-5 PASS: bare APPROVED-PREP line recognized as valid prep marker" {
  # 592a8b5 added bare-line anchor to has_prep grep — manually written prep files
  # without the **Status**: prefix must still be accepted.
  mkdir -p "$PROJ/.planning/wave-$WAVE_SLUG"
  printf 'APPROVED-PREP\n\nSome arch content here\n' \
    > "$PROJ/.planning/wave-$WAVE_SLUG/arch-platform-verdict.md"

  run bash -c "cd '$PROJ' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --role arch-platform --phase verify-final --slug '$WAVE_SLUG' < /dev/null"
  [ "$status" -eq 0 ]
  local verdict="$PROJ/.planning/wave-$WAVE_SLUG/arch-platform-verdict.md"
  grep -q "APPROVED-VERIFY-FINAL" "$verdict"
}

# ── VN-6: dual-token guard fires when APPROVED-VERIFY-FINAL is on its own line ─

@test "VN-6 FAIL: dual-token guard fires when APPROVED-VERIFY-FINAL is on its own line" {
  # Distinct from VN-3: explicitly plants bare APPROVED-VERIFY-FINAL line (not via script)
  # to confirm the anchored guard catches both **Status**: form and bare-line form.
  mkdir -p "$PROJ/.planning/wave-$WAVE_SLUG"
  printf '**Status**: APPROVED-PREP\nAPPROVED-VERIFY-FINAL\n' \
    > "$PROJ/.planning/wave-$WAVE_SLUG/arch-platform-verdict.md"

  run bash -c "cd '$PROJ' && echo 'attempt' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --role arch-platform --phase verify-final --slug '$WAVE_SLUG'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"dual-token"* ]]
}

# ── VN-7: bold-verdict PREP form recognized as valid prep marker ─────────────

@test "VN-7 PASS: bold-verdict APPROVED-PREP form recognized, no WARN emitted" {
  # dd73cdf added bold form '**Verdict: APPROVED-PREP**' to the has_prep grep.
  # When has_prep=1, the legacy-WARN branch (has_prep=0) must NOT fire.
  mkdir -p "$PROJ/.planning/wave-$WAVE_SLUG"
  printf '**Verdict: APPROVED-PREP**\n\nSome arch content\n' \
    > "$PROJ/.planning/wave-$WAVE_SLUG/arch-platform-verdict.md"

  # Capture combined stdout+stderr to assert WARN absent
  run bash -c "cd '$PROJ' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --role arch-platform --phase verify-final --slug '$WAVE_SLUG' \
    < /dev/null 2>&1"
  [ "$status" -eq 0 ]
  [[ "$output" != *"WARN"* ]]
  local verdict="$PROJ/.planning/wave-$WAVE_SLUG/arch-platform-verdict.md"
  grep -q "APPROVED-VERIFY-FINAL" "$verdict"
}

# ── Extra: invalid role → exit 2 ─────────────────────────────────────────────

@test "invalid role exits 2" {
  run_verdict --role arch-bogus --phase prep --slug "$WAVE_SLUG"
  [ "$status" -eq 2 ]
  [[ "$output" == *"Invalid role"* ]]
}

# ── P2b: non-feature branch slug resolution ────────────────────────────────────
# After the P2b fix, write-verdict.sh must accept a slug derived from a non-feature
# branch last-segment. The --slug flag carries the pre-resolved slug, so the test
# simply checks that a 'codex/bl-w47-demo'-derived slug (last-segment: 'bl-w47-demo')
# is accepted and produces a verdict file.
# The reject-list guard is also tested: develop/master slugs must exit non-zero.

@test "P2b VWV-WIP PASS: wip branch (branch-detection path, no --slug) resolves to slug 'wip' (P2b regression)" {
  # The P2b regression fires on the branch-detection path. write-verdict.sh resolve_slug()
  # at line 124: `if [[ "$branch" == *"/"* ]]` — only strips the last segment when branch
  # contains a slash. A bare 'wip' branch falls through to the ERROR exit at line 129.
  # After fix: ${branch##*/} applied for any non-empty, non-protected branch name.
  # NOTE: This test exercises the branch-detection path (no --slug, no CLAUDE_WAVE_SLUG).
  git -C "$PROJ" checkout -b "wip" -q 2>/dev/null
  run bash -c "cd '$PROJ' && bash '$SCRIPT' --role arch-testing --phase prep"
  [ "$status" -eq 0 ]
  [ -f "$PROJ/.planning/wave-wip/arch-testing-verdict.md" ]
  grep -q "APPROVED-PREP" "$PROJ/.planning/wave-wip/arch-testing-verdict.md"
}

@test "P2b VWV-NF1 PASS: non-feature slug 'bl-w47-demo' (from codex/bl-w47-demo) accepted by --slug" {
  # write-verdict.sh receives the pre-resolved last-segment; this test confirms it works.
  run_verdict_slug "bl-w47-demo" --role arch-testing --phase prep --slug "bl-w47-demo"
  [ "$status" -eq 0 ]
  [ -f "$PROJ/.planning/wave-bl-w47-demo/arch-testing-verdict.md" ]
  grep -q "APPROVED-PREP" "$PROJ/.planning/wave-bl-w47-demo/arch-testing-verdict.md"
}

@test "P2b VWV-NF2 BLOCK: reject-list slug 'develop' → exit 2 (exact)" {
  # After the P2b fix, write-verdict.sh must reject the 'develop' slug with exit 2
  # specifically (not just non-zero — exact code confirms deliberate rejection, not crash).
  run_verdict_slug "" --role arch-testing --phase prep --slug "develop"
  [ "$status" -eq 2 ]
}

@test "P2b VWV-NF3 BLOCK: reject-list slug 'master' → exit 2 (exact)" {
  # Same for master — exact exit 2 required.
  run_verdict_slug "" --role arch-testing --phase prep --slug "master"
  [ "$status" -eq 2 ]
}
