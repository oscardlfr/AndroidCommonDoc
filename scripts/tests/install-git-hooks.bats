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
#   - installs lib/wave-slug.sh beside the git hooks so pre-commit does not
#     depend on falling back to the source tree copy
#   - installed pre-push PASSES scripts/sh/verify-git-hooks.sh — install↔verify
#     agreement (H1 Push Authority Bootstrap, IH-7)
#   - honors `core.hooksPath`: resolves the hooks DIRECTORY via
#     `git rev-parse --git-path hooks` (never a hardcoded .git/hooks),
#     joined against the target repo, never ambient $PWD (H1, IH-8)
#
# Env isolation (HARD — S4 lesson):
#   All tests create a temp git repo via mktemp -d + git init.
#   NEVER touch the live repo's .git/hooks.
#
# Invocation: bats scripts/tests/install-git-hooks.bats (from repo root)

SCRIPT="$BATS_TEST_DIRNAME/../sh/install-git-hooks.sh"
VERIFY_SCRIPT="$BATS_TEST_DIRNAME/../sh/verify-git-hooks.sh"
PRE_PUSH_HOOK_SRC="$BATS_TEST_DIRNAME/../sh/pre-push-hook.sh"

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

# Copies the REAL canonical scripts/sh/pre-push-hook.sh into the fixture repo
# so verify-git-hooks.sh (which resolves its comparison target off
# --repo-root, not off its own script location) has something to compare the
# installed hook against. Mirrors emit-push-proof.bats's corrected setup()
# discipline: copy the canonical source in, never re-derive/copy the
# installer's own transitive deps around it.
_seed_canonical_pre_push_hook() {
  mkdir -p "$TMP_REPO/scripts/sh"
  cp "$PRE_PUSH_HOOK_SRC" "$TMP_REPO/scripts/sh/pre-push-hook.sh"
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

@test "IH-5 PASS: installer copies wave-slug helper into .git/hooks/lib" {
  bash "$SCRIPT" "$TMP_REPO"
  [ -f "$TMP_REPO/.git/hooks/lib/wave-slug.sh" ]
}

@test "IH-6 PASS: installed pre-commit resolves wave-slug from .git/hooks/lib without repo fallback" {
  bash "$SCRIPT" "$TMP_REPO"
  mkdir -p "$TMP_REPO/.planning/wave-fixture" "$TMP_REPO/scripts"
  printf '# plan\n' > "$TMP_REPO/.planning/wave-fixture/PLAN.md"
  printf 'HARNESS\n' > "$TMP_REPO/.planning/wave-fixture/CLASS"
  printf '#!/usr/bin/env bash\n' > "$TMP_REPO/scripts/example.sh"
  git -C "$TMP_REPO" add .planning/wave-fixture/PLAN.md .planning/wave-fixture/CLASS scripts/example.sh

  run bash -c "VERBOSE=1 bash '$TMP_REPO/.git/hooks/pre-commit' '$TMP_REPO' 2>&1"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Gate 3: wave=fixture class=HARNESS"* ]]
  [[ "$output" != *"wave-slug.sh not found"* ]]
}

# ── IH-7: install→verify agreement (default, no core.hooksPath) ─────────────
# The installer's own output must be something scripts/sh/verify-git-hooks.sh
# (the single H1 clone-gating verifier — consumed by the mint, the JS gate,
# and setup-check Check 7) accepts as canonical. This is the install↔verify
# agreement smoke test — complementary to verify-git-hooks.bats, which only
# ever exercises the verifier against hand-built fixtures, never the REAL
# installer's actual output.

@test "IH-7 PASS: hook installed by install-git-hooks.sh passes verify-git-hooks.sh" {
  _seed_canonical_pre_push_hook

  bash "$SCRIPT" "$TMP_REPO"

  run bash "$VERIFY_SCRIPT" --repo-root "$TMP_REPO"
  [ "$status" -eq 0 ]
}

# ── IH-8: core.hooksPath — installer places the hook where --git-path
#          resolves, and verify-git-hooks.sh agrees ────────────────────────
# Sets git config core.hooksPath to a repo-relative custom directory BEFORE
# installing, then confirms the installer resolved the hooks DIRECTORY via
# `git rev-parse --git-path hooks` (never the hardcoded .git/hooks) and that
# verify-git-hooks.sh — which independently resolves the identical
# --git-path — accepts the result (installer↔verifier symmetric under
# core.hooksPath).
# Both sides of this comparison deliberately reuse the SAME unresolved
# $TMP_REPO string (never `git rev-parse --show-toplevel` / `pwd -P`), so a
# macOS mktemp /var vs /private/var symlink mismatch cannot arise here — see
# arch-testing Check 4's advisory above.

@test "IH-8 PASS: installer places pre-push at the core.hooksPath-resolved directory and verify-git-hooks.sh accepts it" {
  _seed_canonical_pre_push_hook
  git -C "$TMP_REPO" config core.hooksPath custom-hooks-dir

  bash "$SCRIPT" "$TMP_REPO"

  raw_git_path="$(git -C "$TMP_REPO" rev-parse --git-path hooks)"
  case "$raw_git_path" in
    /*) hooks_dir="$raw_git_path" ;;
    *)  hooks_dir="$TMP_REPO/$raw_git_path" ;;
  esac

  [ -f "$hooks_dir/pre-push" ]
  [ -x "$hooks_dir/pre-push" ]

  run bash "$VERIFY_SCRIPT" --repo-root "$TMP_REPO"
  [ "$status" -eq 0 ]
}
