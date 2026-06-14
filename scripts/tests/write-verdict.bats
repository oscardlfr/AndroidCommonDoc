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

# ── VS-1: --supersede with different HEAD replaces old block ─────────────────
#
# Contract: PLAN.md §Strict Contract #2 + #3
# Setup: prep → verify-final (first; HEAD=H1) → new commit (HEAD=H2) →
#        verify-final --supersede
# Expected: exit 0; EXACTLY ONE **HEAD**: line in file == H2; old H1 absent;
#           APPROVED-PREP present; APPROVED-VERIFY-FINAL present.

@test "VS-1 PASS: --supersede with different HEAD replaces old block, preserves PREP" {
  run_verdict --role arch-testing --phase prep --slug "$WAVE_SLUG"
  [ "$status" -eq 0 ]

  local verdict="$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict.md"

  # First verify-final — captures H1
  run bash -c "cd '$PROJ' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --role arch-testing --phase verify-final --slug '$WAVE_SLUG' < /dev/null"
  [ "$status" -eq 0 ]

  # Capture H1 (the HEAD at first verify-final write)
  local h1
  h1="$(git -C "$PROJ" rev-parse HEAD)"

  # Advance HEAD so H2 != H1
  git -C "$PROJ" -c user.email=test@example.com -c user.name=test \
      commit -q --allow-empty -m second 2>/dev/null
  local h2
  h2="$(git -C "$PROJ" rev-parse HEAD)"

  # --supersede must succeed
  run bash -c "cd '$PROJ' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --role arch-testing --phase verify-final --supersede --slug '$WAVE_SLUG' < /dev/null"
  [ "$status" -eq 0 ]

  # Exactly ONE **HEAD**: line in the file
  local head_count
  head_count="$(grep -c '^\*\*HEAD\*\*:' "$verdict")"
  [ "$head_count" -eq 1 ]

  # That line must reference H2, not H1
  grep -q "^\*\*HEAD\*\*: $h2$" "$verdict"
  ! grep -q "$h1" "$verdict"

  # Both required tokens present
  grep -q "APPROVED-PREP" "$verdict"
  grep -q "APPROVED-VERIFY-FINAL" "$verdict"
}

# ── VS-2: --supersede same HEAD — idempotent NO-OP ───────────────────────────
#
# Contract: PLAN.md §Strict Contract #2 (stored HEAD == current HEAD → NO-OP)
# Setup: prep → verify-final → verify-final --supersede (no new commit between)
# Expected: exit 0; file byte-identical to pre-supersede snapshot;
#           EXACTLY ONE **HEAD**: line.

@test "VS-2 PASS: --supersede same HEAD is idempotent — file unchanged" {
  run_verdict --role arch-testing --phase prep --slug "$WAVE_SLUG"
  [ "$status" -eq 0 ]

  local verdict="$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict.md"

  # First verify-final
  run bash -c "cd '$PROJ' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --role arch-testing --phase verify-final --slug '$WAVE_SLUG' < /dev/null"
  [ "$status" -eq 0 ]

  # Snapshot the file content (byte-level)
  local snapshot
  snapshot="$(cat "$verdict")"

  # --supersede with same HEAD — must be a NO-OP
  run bash -c "cd '$PROJ' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --role arch-testing --phase verify-final --supersede --slug '$WAVE_SLUG' < /dev/null"
  [ "$status" -eq 0 ]

  # File content must be byte-identical to pre-supersede snapshot
  local after
  after="$(cat "$verdict")"
  [ "$snapshot" = "$after" ]

  # Still exactly one **HEAD**: line (no duplicate block)
  local head_count
  head_count="$(grep -c '^\*\*HEAD\*\*:' "$verdict")"
  [ "$head_count" -eq 1 ]
}

# ── VS-3: replay guard WITHOUT --supersede still fires ───────────────────────
#
# Contract: PLAN.md §Strict Contract #1 + §Test Matrix VS-3
# --supersede is OPT-IN; without it the dual-token replay guard must be unchanged.
# Setup: prep → verify-final → verify-final (no flag)
# Expected: exit 2; "dual-token" in stderr; "APPROVED-VERIFY-FINAL" in stderr.
# NOTE: This is a distinct case from VN-3 (VN-3 uses arch-platform; VS-3 adds
#       explicit context that the absence of --supersede is what fires the guard).

@test "VS-3 FAIL: replay guard fires on second verify-final without --supersede flag" {
  run_verdict --role arch-testing --phase prep --slug "$WAVE_SLUG"
  [ "$status" -eq 0 ]

  # First verify-final — must succeed
  run bash -c "cd '$PROJ' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --role arch-testing --phase verify-final --slug '$WAVE_SLUG' < /dev/null"
  [ "$status" -eq 0 ]

  # Second verify-final without --supersede — replay guard must fire
  run bash -c "cd '$PROJ' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --role arch-testing --phase verify-final --slug '$WAVE_SLUG' < /dev/null"
  [ "$status" -eq 2 ]
  [[ "$output" == *"dual-token"* ]]
  [[ "$output" == *"APPROVED-VERIFY-FINAL"* ]]
}

# ── VS-4: fail-closed when HEAD unresolvable ─────────────────────────────────
#
# Contract: PLAN.md §Strict Contract #2 (HEAD must resolve to 40-hex or ABORT)
# Setup: SEPARATE fresh git init with NO seed commit (HEAD unresolvable).
#        Hand-write a prep file so the script reaches the HEAD-resolution code.
# Expected: exit 2; stderr names HEAD resolution failure.
# NOTE: Must NOT reuse the setup() PROJ (which has a seed commit).

@test "VS-4 FAIL: --supersede fails closed when HEAD is unresolvable" {
  # Fresh repo with no commits — HEAD cannot be resolved to 40-hex
  local empty_proj
  empty_proj="$(mktemp -d)"
  git -C "$empty_proj" init -q 2>/dev/null

  # Hand-write a prep verdict so the script reaches HEAD resolution
  mkdir -p "$empty_proj/.planning/wave-$WAVE_SLUG"
  printf '**Status**: APPROVED-PREP\n' \
    > "$empty_proj/.planning/wave-$WAVE_SLUG/arch-testing-verdict.md"

  run bash -c "cd '$empty_proj' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --role arch-testing --phase verify-final --supersede --slug '$WAVE_SLUG' < /dev/null"
  [ "$status" -eq 2 ]
  # stderr must name HEAD resolution failure
  [[ "$output" == *"HEAD"* ]]

  rm -rf "$empty_proj"
}

# ── VS-5: --supersede on PREP-only file (no prior verify-final) ──────────────
#
# Contract: PLAN.md §Strict Contract #2 ("No existing VERIFY-FINAL block →
#           behave like a normal first verify-final append (with delimiters)")
# Setup: prep only (no prior verify-final), then verify-final --supersede
# Expected: exit 0; APPROVED-PREP preserved; APPROVED-VERIFY-FINAL present;
#           EXACTLY ONE **HEAD**: line.

@test "VS-5 PASS: --supersede on PREP-only file behaves like normal first append" {
  run_verdict --role arch-testing --phase prep --slug "$WAVE_SLUG"
  [ "$status" -eq 0 ]

  local verdict="$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict.md"

  # --supersede on a file with only APPROVED-PREP (no verify-final block yet)
  run bash -c "cd '$PROJ' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --role arch-testing --phase verify-final --supersede --slug '$WAVE_SLUG' < /dev/null"
  [ "$status" -eq 0 ]

  # APPROVED-PREP must be preserved
  grep -q "APPROVED-PREP" "$verdict"

  # APPROVED-VERIFY-FINAL must be present
  grep -q "APPROVED-VERIFY-FINAL" "$verdict"

  # Exactly one **HEAD**: line
  local head_count
  head_count="$(grep -c '^\*\*HEAD\*\*:' "$verdict")"
  [ "$head_count" -eq 1 ]
}

# ── VS-6: legacy un-delimited VERIFY-FINAL fallback ──────────────────────────
#
# Contract: PLAN.md §Implementation Approach — "Belt-and-suspenders fallback:
#           if --supersede finds an un-delimited (legacy) VERIFY-FINAL block
#           (file written by the old script before this wave), fall back to
#           excising from the first **HEAD**: line through EOF."
# Setup: hand-write a prep file containing an OLD-style VERIFY-FINAL block:
#        APPROVED-VERIFY-FINAL + a **HEAD**: line at a fake 40-hex SHA,
#        NO <!-- BEGIN VERIFY-FINAL --> / <!-- END VERIFY-FINAL --> delimiters.
#        Then call verify-final --supersede.
# Expected: exit 0; old block excised (fake SHA absent); EXACTLY ONE **HEAD**:
#           line == current HEAD; APPROVED-PREP preserved; APPROVED-VERIFY-FINAL
#           present.

@test "VS-6 PASS: --supersede excises legacy un-delimited VERIFY-FINAL block via fallback" {
  local old_fake_sha="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  local verdict="$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict.md"

  # Hand-write a file that looks like it was produced by the pre-wave script:
  # APPROVED-PREP block + old-style (un-delimited) VERIFY-FINAL block.
  mkdir -p "$PROJ/.planning/wave-$WAVE_SLUG"
  printf '**Status**: APPROVED-PREP\n\n**HEAD**: %s\n**Phase**: VERIFY-FINAL\n**Timestamp**: 2026-01-01T00:00:00Z\n**Status**: APPROVED-VERIFY-FINAL\n\n' \
    "$old_fake_sha" > "$verdict"

  # Capture current HEAD (real SHA from setup() seed commit)
  local current_head
  current_head="$(git -C "$PROJ" rev-parse HEAD)"

  # --supersede must trigger the legacy fallback and succeed
  run bash -c "cd '$PROJ' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --role arch-testing --phase verify-final --supersede --slug '$WAVE_SLUG' < /dev/null"
  [ "$status" -eq 0 ]

  # Old fake SHA must be gone
  ! grep -q "$old_fake_sha" "$verdict"

  # Exactly ONE **HEAD**: line, pointing at the current HEAD
  local head_count
  head_count="$(grep -c '^\*\*HEAD\*\*:' "$verdict")"
  [ "$head_count" -eq 1 ]
  grep -q "^\*\*HEAD\*\*: $current_head$" "$verdict"

  # APPROVED-PREP preserved
  grep -q "APPROVED-PREP" "$verdict"

  # APPROVED-VERIFY-FINAL present
  grep -q "APPROVED-VERIFY-FINAL" "$verdict"
}

# ── VS-7: stdin body with <!-- END VERIFY-FINAL --> closes block early ────────
#
# Contract: B1 — body line matching the closing delimiter must NOT close the
# block early. After write: exactly ONE **HEAD**: == current HEAD.

@test "VS-7 FAIL: body containing <!-- END VERIFY-FINAL --> must not break block structure" {
  run_verdict --role arch-testing --phase prep --slug "$WAVE_SLUG"
  [ "$status" -eq 0 ]

  local verdict="$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict.md"
  local current_head
  current_head="$(git -C "$PROJ" rev-parse HEAD)"

  run bash -c "cd '$PROJ' && printf '## verdict\n<!-- END VERIFY-FINAL -->\nsome prose\n' | \
    CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase verify-final --slug '$WAVE_SLUG'"
  [ "$status" -eq 0 ]

  # Exactly ONE **HEAD**: line in the file
  local head_count
  head_count="$(grep -c '^\*\*HEAD\*\*:' "$verdict")"
  [ "$head_count" -eq 1 ]

  # That HEAD must be the current (script-authored) HEAD
  grep -q "^\*\*HEAD\*\*: $current_head$" "$verdict"

  # APPROVED-VERIFY-FINAL present
  grep -q "APPROVED-VERIFY-FINAL" "$verdict"
}

# ── VS-8: stdin body with **HEAD**: prose line → stored_head must be script HEAD
#
# Contract: B1a — body-injected **HEAD**: line must NOT poison stored_head
# extraction. Supersede called on same HEAD must be a NO-OP (idempotent),
# not a replacement triggered by fake SHA.

@test "VS-8 FAIL: body **HEAD**: prose line must not poison stored_head extraction" {
  run_verdict --role arch-testing --phase prep --slug "$WAVE_SLUG"
  [ "$status" -eq 0 ]

  local verdict="$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict.md"
  local current_head
  current_head="$(git -C "$PROJ" rev-parse HEAD)"

  # First verify-final: pipe stdin containing a fake **HEAD**: prose line
  run bash -c "cd '$PROJ' && printf '**HEAD**: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nsome prose\n' | \
    CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase verify-final --slug '$WAVE_SLUG'"
  [ "$status" -eq 0 ]

  # --supersede with same HEAD (no new commit) — must be idempotent NO-OP
  run bash -c "cd '$PROJ' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --role arch-testing --phase verify-final --supersede --slug '$WAVE_SLUG' < /dev/null"
  [ "$status" -eq 0 ]

  # Exactly ONE **HEAD**: line — the real current HEAD, not the fake body SHA
  local head_count
  head_count="$(grep -c '^\*\*HEAD\*\*:' "$verdict")"
  [ "$head_count" -eq 1 ]

  # The body-injected fake SHA must NOT be the **HEAD**: value
  ! grep -q "^\*\*HEAD\*\*: aaaa" "$verdict"
}

# ── VS-9: orphan-final (VERIFY-FINAL, no PREP) + --supersede → exit 2 ─────────
#
# Contract: B2 — --supersede with APPROVED-VERIFY-FINAL but NO APPROVED-PREP
# must exit 2 (not fall through to normal append and mint a second block).

@test "VS-9 FAIL: --supersede with orphan VERIFY-FINAL (no PREP) must exit 2" {
  # Hand-write a verdict with only APPROVED-VERIFY-FINAL — no APPROVED-PREP
  mkdir -p "$PROJ/.planning/wave-$WAVE_SLUG"
  printf '**Status**: APPROVED-VERIFY-FINAL\n' \
    > "$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict.md"

  run bash -c "cd '$PROJ' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --role arch-testing --phase verify-final --supersede --slug '$WAVE_SLUG' < /dev/null"
  [ "$status" -eq 2 ]
  [[ "$output" == *"PREP"* ]]
}

# ── VS-10: legacy fallback with content below old block → WARN emitted ─────────
#
# Contract: B3 — legacy fallback (first-**HEAD**:-through-EOF excision) silently
# destroys content below the old block. Fix must emit WARN to stderr.

@test "VS-10 FAIL: legacy fallback with content below old block must emit WARN" {
  run_verdict --role arch-testing --phase prep --slug "$WAVE_SLUG"
  [ "$status" -eq 0 ]

  local verdict="$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict.md"

  # Hand-append a legacy un-delimited VERIFY-FINAL block with content below it
  printf '\n**HEAD**: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n**Phase**: VERIFY-FINAL\n**Status**: APPROVED-VERIFY-FINAL\n\nsome content below old block\n' \
    >> "$verdict"

  run bash -c "cd '$PROJ' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --role arch-testing --phase verify-final --supersede --slug '$WAVE_SLUG' < /dev/null 2>&1"
  [ "$status" -eq 0 ]

  # WARN must be emitted about dropped content
  [[ "$output" == *"WARN"* ]]

  # APPROVED-VERIFY-FINAL present
  grep -q "APPROVED-VERIFY-FINAL" "$verdict"

  # Exactly ONE **HEAD**: line
  local head_count
  head_count="$(grep -c '^\*\*HEAD\*\*:' "$verdict")"
  [ "$head_count" -eq 1 ]

  # Old fake SHA absent
  ! grep -q "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" "$verdict"
}

# ── VS-11: BEGIN delimiter in PREP prose → only trailing real block excised ────
#
# Contract: B4 — sed range-delete must NOT start at the first occurrence of
# <!-- BEGIN VERIFY-FINAL --> in prose; it must target only the real trailing
# delimited block. PREP content and prose mention must be preserved.

@test "VS-11 FAIL: BEGIN delimiter in PREP prose must not cause PREP content to be excised" {
  mkdir -p "$PROJ/.planning/wave-$WAVE_SLUG"
  # Build file manually: PREP block + prose mentioning the delimiter + real delimited block
  printf '**Status**: APPROVED-PREP\n\nSome prose mentioning <!-- BEGIN VERIFY-FINAL --> inline.\n\n<!-- BEGIN VERIFY-FINAL -->\n**HEAD**: cccccccccccccccccccccccccccccccccccccccc\n**Phase**: VERIFY-FINAL\n**Status**: APPROVED-VERIFY-FINAL\n\n<!-- END VERIFY-FINAL -->\n' \
    > "$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict.md"

  local verdict="$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict.md"
  local current_head
  current_head="$(git -C "$PROJ" rev-parse HEAD)"

  # --supersede: old block has fake SHA != current HEAD → should excise real block only
  run bash -c "cd '$PROJ' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --role arch-testing --phase verify-final --supersede --slug '$WAVE_SLUG' < /dev/null"
  [ "$status" -eq 0 ]

  # APPROVED-PREP preserved
  grep -q "APPROVED-PREP" "$verdict"

  # Prose mention of the delimiter preserved
  grep -q "<!-- BEGIN VERIFY-FINAL --> inline" "$verdict"

  # Exactly ONE **HEAD**: line == current HEAD
  local head_count
  head_count="$(grep -c '^\*\*HEAD\*\*:' "$verdict")"
  [ "$head_count" -eq 1 ]
  grep -q "^\*\*HEAD\*\*: $current_head$" "$verdict"

  # Old fake SHA absent
  ! grep -q "cccccccccccccccccccccccccccccccccccccccc" "$verdict"
}

# ── VS-12: two stale delimited blocks → collapsed to exactly one current HEAD ──
#
# Contract: after supersede on a file with two stale delimited blocks, the result
# must be exactly ONE **HEAD**: == current HEAD; both fake SHAs absent; APPROVED-PREP
# and APPROVED-VERIFY-FINAL present.

@test "VS-12 FAIL: two stale delimited blocks must collapse to exactly one current-HEAD block" {
  mkdir -p "$PROJ/.planning/wave-$WAVE_SLUG"
  printf '**Status**: APPROVED-PREP\n\n<!-- BEGIN VERIFY-FINAL -->\n**HEAD**: dddddddddddddddddddddddddddddddddddddddd\n**Status**: APPROVED-VERIFY-FINAL\n\n<!-- END VERIFY-FINAL -->\n\n<!-- BEGIN VERIFY-FINAL -->\n**HEAD**: eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\n**Status**: APPROVED-VERIFY-FINAL\n\n<!-- END VERIFY-FINAL -->\n' \
    > "$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict.md"

  local verdict="$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict.md"
  local current_head
  current_head="$(git -C "$PROJ" rev-parse HEAD)"

  run bash -c "cd '$PROJ' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --role arch-testing --phase verify-final --supersede --slug '$WAVE_SLUG' < /dev/null"
  [ "$status" -eq 0 ]

  # Exactly ONE **HEAD**: line == current HEAD
  local head_count
  head_count="$(grep -c '^\*\*HEAD\*\*:' "$verdict")"
  [ "$head_count" -eq 1 ]
  grep -q "^\*\*HEAD\*\*: $current_head$" "$verdict"

  # Both fake SHAs absent
  ! grep -q "dddddddddddddddddddddddddddddddddddddddd" "$verdict"
  ! grep -q "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" "$verdict"

  # Both required tokens present
  grep -q "APPROVED-PREP" "$verdict"
  grep -q "APPROVED-VERIFY-FINAL" "$verdict"
}

# ── VS-13: stale-first + current-last block → must normalize, not short-circuit ─
#
# Contract: when file has TWO delimited blocks where the LAST block's stored HEAD
# == current HEAD, --supersede must NOT take the idempotent no-op exit. It must
# excise ALL blocks and leave exactly ONE **HEAD**: == current HEAD.
# (emit-push-proof reads FIRST **HEAD**: match; a stale first block blocks the gate.)

@test "VS-13 FAIL: stale-first + current-last two blocks must normalize to one block, not no-op" {
  mkdir -p "$PROJ/.planning/wave-$WAVE_SLUG"
  local current_head
  current_head="$(git -C "$PROJ" rev-parse HEAD)"

  local verdict="$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict.md"

  # File: PREP + stale first block + current-HEAD last block
  printf '**Status**: APPROVED-PREP\n\n<!-- BEGIN VERIFY-FINAL -->\n**HEAD**: ffffffffffffffffffffffffffffffffffffffff\n**Status**: APPROVED-VERIFY-FINAL\n\n<!-- END VERIFY-FINAL -->\n\n<!-- BEGIN VERIFY-FINAL -->\n**HEAD**: %s\n**Status**: APPROVED-VERIFY-FINAL\n\n<!-- END VERIFY-FINAL -->\n' \
    "$current_head" > "$verdict"

  run bash -c "cd '$PROJ' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --role arch-testing --phase verify-final --supersede --slug '$WAVE_SLUG' < /dev/null"
  [ "$status" -eq 0 ]

  # Exactly ONE **HEAD**: line == current HEAD
  local head_count
  head_count="$(grep -c '^\*\*HEAD\*\*:' "$verdict")"
  [ "$head_count" -eq 1 ]
  grep -q "^\*\*HEAD\*\*: $current_head$" "$verdict"

  # Stale SHA absent
  ! grep -q "ffffffffffffffffffffffffffffffffffffffff" "$verdict"

  # Both required tokens present
  grep -q "APPROVED-PREP" "$verdict"
  grep -q "APPROVED-VERIFY-FINAL" "$verdict"
}
