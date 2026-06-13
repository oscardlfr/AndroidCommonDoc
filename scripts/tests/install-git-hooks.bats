#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Tests for scripts/sh/install-git-hooks.sh (BL-W47 PR-0c.1 P1b).
# Installer contract: accepts an optional target-dir argument so tests can
# install into a temp repo without touching the live .git/hooks.
#
# Contract:
#   - run with target-dir arg → installs pre-push into <target-dir>/.git/hooks/
#   - installed pre-push contains the ACDOC-PRE-PUSH-GATE marker
#   - installed pre-push is executable
#
# Env isolation (HARD — S4 lesson):
#   All tests create a temp git repo via mktemp -d + git init.
#   NEVER touch the live repo's .git/hooks.
#
# Invocation: bats scripts/tests/install-git-hooks.bats (from repo root)

SCRIPT="$BATS_TEST_DIRNAME/../sh/install-git-hooks.sh"

setup() {
  # Isolated git repo for each test.
  TMP_REPO="$(mktemp -d)"
  git -C "$TMP_REPO" init -q 2>/dev/null
  git -C "$TMP_REPO" config user.email "bats@test.local"
  git -C "$TMP_REPO" config user.name "Bats Test"
}

teardown() {
  rm -rf "$TMP_REPO"
}

# ── IH-1: installer places pre-push hook with ACDOC marker ──────────────────
# This test is the PRIMARY lock: if the marker ever drops out of pre-push-hook.sh,
# this test goes RED immediately — catching the producer/consumer drift.

@test "IH-1 PASS: install-git-hooks.sh installs pre-push with ACDOC-PRE-PUSH-GATE marker" {
  # Toolkit-specialist will add target-dir support to install-git-hooks.sh.
  # Test is written against that interface: bash scripts/sh/install-git-hooks.sh <target-dir>
  # For the RED run this test WILL FAIL because the installer doesn't yet accept a target arg.
  bash "$SCRIPT" "$TMP_REPO"
  run grep -q 'ACDOC-PRE-PUSH-GATE' "$TMP_REPO/.git/hooks/pre-push"
  [ "$status" -eq 0 ]
}

@test "IH-2 PASS: installed pre-push hook is executable" {
  bash "$SCRIPT" "$TMP_REPO"
  [ -x "$TMP_REPO/.git/hooks/pre-push" ]
}

@test "IH-3 PASS: installed pre-push hook file exists at the correct path" {
  bash "$SCRIPT" "$TMP_REPO"
  [ -f "$TMP_REPO/.git/hooks/pre-push" ]
}

@test "IH-4 PASS: installer exits 0 when given a valid target-dir" {
  run bash "$SCRIPT" "$TMP_REPO"
  [ "$status" -eq 0 ]
}
