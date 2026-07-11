#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Tests for scripts/sh/verify-git-hooks.sh (H1 -- Push Authority Bootstrap, W-A).
#
# The single clone-gating verifier: confirms the git-layer pre-push hook is
# installed AND byte-identical (marker + sha256, CRLF-normalized on both
# sides) to the checked-in canonical source scripts/sh/pre-push-hook.sh.
# This is the primitive both the mint (emit-push-proof.sh, W-B) and the JS
# gate (push-authorization-gate.js, W-C) delegate to -- it does not itself
# gate a push, it only reports.
#
# Interface (PLAN v2, Path-Manifest Group A):
#   scripts/sh/verify-git-hooks.sh --repo-root <path>
#   exit 0    -> pass (hook installed, executable, marker-bearing, and
#                byte-identical to canonical)
#   exit != 0 -> fail, with one of 5 reason codes printed to output:
#                canonical-source-missing | hook-absent | hook-not-executable
#                | hook-marker-missing | hook-drifted
#
# CONFIRMED check order (arch-platform, load-bearing -- restated here so
# every failure fixture below can be verified against the chain by
# inspection, per arch-testing Check 1's recommendation):
#   1. canonical-source-missing -- checked FIRST, unconditionally. Cheapest,
#      most fundamental check; never allow a "both sides unreadable ->
#      vacuous match" path. scripts/sh/pre-push-hook.sh (resolved off
#      --repo-root) must be read unconditionally and early.
#   2. hook-absent               -- -f test on the --git-path-resolved hook.
#   3. hook-not-executable       -- -x test (symlink-safe: -f/-x follow
#      symlinks and correctly fail-closed on a dangling target).
#   4. hook-marker-missing       -- ACDOC-PRE-PUSH-GATE substring/regex
#      test (no CRLF-sensitivity needed).
#   5. hook-drifted               -- sha256 comparison, CRLF-dual-normalized
#      on BOTH the installed hook and the canonical source.
#   -> exit 0 only if all 5 checks pass, in this order.
#
# Revert-one-prove-red discipline: every failure fixture below independently
# satisfies every EARLIER check in the chain above while tripping exactly
# the ONE check under test -- e.g. the hook-drifted fixture (VGH-5) provides
# a present canonical source (1), an installed (2), executable (3),
# marker-bearing (4) hook that differs from canonical by exactly one byte
# (5). Reverting (or breaking) exactly one check in verify-git-hooks.sh
# therefore turns exactly one of VGH-2..VGH-6 red -- never zero, never more
# than one. Hand-traced per-check against all 7 cases at authoring time; see
# the per-test comments below for the specific chain-satisfaction of each
# fixture.
#
# Fixture pattern: symlink-resolved $REPO, mirroring pre-push-hook.bats's
# setup() ("REPO=$(cd "$(mktemp -d)" && pwd -P)"), NOT install-git-hooks.bats's
# simpler unresolved "$(mktemp -d)" pattern -- required here (arch-testing
# Check 1) because this verifier does path COMPARISON (--git-path resolution
# + a canonical-source sha match), where an unresolved macOS /var/... vs
# git's own canonicalized /private/var/... would be exactly the class of
# false-drift bug this file exists to catch.
#
# VGH-1..VGH-7 map onto PLAN v2 Path-Manifest Group D's lettered cases
# (a)..(g) 1:1, in the same order.
#
# Bats footgun (project memory feedback_bats_double_bracket_silent_pass.md):
# a bare `[[ ]]` that is not the LAST statement in a @test body does not
# reliably abort the test on failure. Every `[[ ]]` below carries
# `|| return 1`; plain `[ ]` checks (no such footgun) do not need it.

SCRIPT="$BATS_TEST_DIRNAME/../sh/verify-git-hooks.sh"
CANONICAL_SRC="$BATS_TEST_DIRNAME/../sh/pre-push-hook.sh"

setup() {
  # Canonical (symlink-resolved) path -- see header comment / arch-testing
  # Check 1. verify-git-hooks.sh compares resolved paths and file contents,
  # so an unresolved macOS /var/... vs /private/var/... would produce a
  # false hook-drifted (or a false-negative resolution mismatch).
  REPO="$(cd "$(mktemp -d)" && pwd -P)"
  git init "$REPO" --quiet
  git -C "$REPO" config user.email "test@test.com"
  git -C "$REPO" config user.name "Test"
  git -C "$REPO" commit --allow-empty --quiet -m "feat(core): init"
}

teardown() {
  rm -rf "$REPO"
}

# ── Fixture writers ───────────────────────────────────────────────────────────

# provide_canonical_source: places the real, checked-in pre-push-hook.sh at
# $REPO/scripts/sh/pre-push-hook.sh -- the file verify-git-hooks.sh reads as
# its comparison source, resolved off --repo-root (never off the verifier
# script's own $BATS_TEST_DIRNAME location -- mirrors emit-push-proof.bats's
# corrected setup(), which copies the real source into the fixture rather
# than referencing the source tree directly).
provide_canonical_source() {
  mkdir -p "$REPO/scripts/sh"
  cp "$CANONICAL_SRC" "$REPO/scripts/sh/pre-push-hook.sh"
}

# write_canonical_hook: installs a byte-identical, executable copy of the
# canonical source at $REPO/.git/hooks/pre-push -- the clean-PASS shape.
# Uses a direct cp+chmod rather than routing through install-git-hooks.sh,
# to keep this file's fixtures decoupled from that script's own transitive
# dependency chain (pre-commit-hook.sh, lib/wave-slug.sh, commit-msg-hook.sh)
# -- install-git-hooks.bats already covers the installer itself, and the
# new CI install-then-verify smoke step (Group C) covers installer<->verifier
# agreement against the real committed source; this file's job is only
# verify-git-hooks.sh in isolation.
write_canonical_hook() {
  cp "$CANONICAL_SRC" "$REPO/.git/hooks/pre-push"
  chmod +x "$REPO/.git/hooks/pre-push"
}

# write_marker_missing_hook: a foreign, executable stub carrying no
# ACDOC-PRE-PUSH-GATE marker at all (case d).
write_marker_missing_hook() {
  printf '#!/bin/sh\nexit 0\n' > "$REPO/.git/hooks/pre-push"
  chmod +x "$REPO/.git/hooks/pre-push"
}

# write_drifted_hook: byte-identical to canonical (marker on line 2 fully
# intact) except the file's LAST line ("exit 0" -> "exit 1") -- exactly one
# byte differs. Targeted by list-index (last element), never by text search,
# so it can never accidentally collide with the marker line or an earlier
# "exit 0" occurrence in the file body (there are two: the SKIP_PUSH_GATE
# bypass branch and the final line). sha256 mismatches; marker substring
# still present (case e). Guarded by an assertion so a future edit to
# pre-push-hook.sh's last line fails this fixture loudly instead of quietly
# testing the wrong thing.
write_drifted_hook() {
  python3 - "$CANONICAL_SRC" "$REPO/.git/hooks/pre-push" <<'PYEOF'
import sys
src, dst = sys.argv[1], sys.argv[2]
with open(src, "rb") as f:
    lines = f.readlines()
last = lines[-1]
assert last.rstrip(b"\n") == b"exit 0", "canonical source's last line changed: " + repr(last)
lines[-1] = last.replace(b"exit 0", b"exit 1")
with open(dst, "wb") as f:
    f.writelines(lines)
PYEOF
  chmod +x "$REPO/.git/hooks/pre-push"
}

# write_crlf_hook: byte-for-byte canonical content but with EVERY line
# ending converted from LF to CRLF ("\n" -> "\r\n") -- a legitimate
# Windows-checked-out hook, not a drift. Positive control for the
# CRLF-normalization fix: sha256_of() is meant to treat a paired \r\n as
# equivalent to canonical, so this must PASS both before and after the fix.
write_crlf_hook() {
  python3 -c 'import sys;sys.stdout.buffer.write(open(sys.argv[1],"rb").read().replace(b"\n",b"\r\n"))' "$CANONICAL_SRC" > "$REPO/.git/hooks/pre-push"
  chmod +x "$REPO/.git/hooks/pre-push"
}

# write_lone_cr_hook: canonical content with exactly one standalone \r
# byte spliced into the middle of the shebang line (line 1), at byte
# offset 5 -- deliberately NOT immediately followed by "\n", so it can
# never be read as one half of a "\r\n" pair. The marker (line 2) and
# every other byte are untouched, so this fixture independently satisfies
# checks 1-4 (source present, hook present, executable, marker present)
# and trips ONLY check 5 under a correct CRLF-pair-only normalization.
# Discriminator for the tr -d '\r' bug: that primitive deletes every CR
# unconditionally, including this lone one, so the drifted hook falsely
# byte-matches canonical.
write_lone_cr_hook() {
  python3 -c 'import sys;d=open(sys.argv[1],"rb").read();sys.stdout.buffer.write(d[:5]+b"\r"+d[5:])' "$CANONICAL_SRC" > "$REPO/.git/hooks/pre-push"
  chmod +x "$REPO/.git/hooks/pre-push"
}

# ── VGH-1..VGH-7 (7 contract-mandated minimum cases, PLAN v2 Group D a-g) ────

@test "VGH-1 PASS: canonical hook installed + canonical source present -> exit 0" {
  # Chain: (1) source present (2) hook present (3) executable (4) marker
  # present (5) byte-identical -- all 5 pass.
  provide_canonical_source
  write_canonical_hook
  run bash "$SCRIPT" --repo-root "$REPO"
  [ "$status" -eq 0 ]
}

@test "VGH-2 BLOCK: no hook installed -> hook-absent" {
  # Chain: (1) source present [satisfied] -- (2) no hook file at the
  # resolved path [TRIPPED]. Checks 3-5 never reached.
  provide_canonical_source
  run bash "$SCRIPT" --repo-root "$REPO"
  [ "$status" -ne 0 ]
  [[ "$output" == *"hook-absent"* ]] || return 1
}

@test "VGH-3 BLOCK: hook present but not executable -> hook-not-executable" {
  # Chain: (1) source present (2) hook file present [both satisfied] --
  # (3) exec bit stripped after install [TRIPPED]. Content is otherwise a
  # byte-identical copy (would sha-match cleanly if executable), so checks
  # 4-5 are never what actually fires here.
  provide_canonical_source
  write_canonical_hook
  chmod -x "$REPO/.git/hooks/pre-push"
  run bash "$SCRIPT" --repo-root "$REPO"
  [ "$status" -ne 0 ]
  [[ "$output" == *"hook-not-executable"* ]] || return 1
}

@test "VGH-4 BLOCK: foreign stub hook (no ACDOC marker) -> hook-marker-missing" {
  # Chain: (1) source present (2) hook file present (3) executable [all
  # satisfied] -- (4) no ACDOC-PRE-PUSH-GATE marker in a foreign #!/bin/sh
  # stub [TRIPPED]. Check 5 never reached.
  provide_canonical_source
  write_marker_missing_hook
  run bash "$SCRIPT" --repo-root "$REPO"
  [ "$status" -ne 0 ]
  [[ "$output" == *"hook-marker-missing"* ]] || return 1
}

@test "VGH-5 BLOCK: marker intact, one byte drifted from canonical -> hook-drifted" {
  # Chain: (1) source present (2) hook file present (3) executable (4)
  # marker present [all satisfied] -- (5) sha256 mismatch from a single
  # flipped byte outside the marker line [TRIPPED].
  provide_canonical_source
  write_drifted_hook
  run bash "$SCRIPT" --repo-root "$REPO"
  [ "$status" -ne 0 ]
  [[ "$output" == *"hook-drifted"* ]] || return 1
}

@test "VGH-6 BLOCK (sanity floor): canonical source unresolvable -> canonical-source-missing, even with a flawless installed hook" {
  # Deliberately skip provide_canonical_source: $REPO/scripts/sh/pre-push-hook.sh
  # does not exist. Install an otherwise-perfect hook (present, executable,
  # marker-bearing, byte-identical to the REAL canonical source used by
  # every other case in this file) so this fixture proves
  # canonical-source-missing is checked FIRST and UNCONDITIONALLY -- a
  # verifier that skipped or reordered this check could otherwise crash,
  # silently pass, or misreport a downstream reason instead.
  write_canonical_hook
  run bash "$SCRIPT" --repo-root "$REPO"
  [ "$status" -ne 0 ]
  [[ "$output" == *"canonical-source-missing"* ]] || return 1
}

@test "VGH-7 PASS: invoked from a CWD different from --repo-root still resolves and verdicts correctly" {
  # arch-platform's relative-git-path case: the --git-path result is
  # RELATIVE in the default (core.hooksPath unset) case and MUST be resolved
  # against --repo-root, never against the verifier's ambient $PWD. Runs
  # from a THIRD directory (neither $REPO nor the real project root) with no
  # .git of its own at all, so any accidental fallback to ambient CWD would
  # produce a crash, a hook-absent, or a canonical-source-missing -- not a
  # clean exit 0. Mirrors the existing emit-push-proof.bats:423 convention
  # of invoking a source-tree script with an explicit --repo-root flag from
  # a fixture CWD that differs from the intended repo root.
  provide_canonical_source
  write_canonical_hook
  local other_cwd
  other_cwd="$(cd "$(mktemp -d)" && pwd -P)"
  run bash -c "cd '$other_cwd' && bash '$SCRIPT' --repo-root '$REPO'"
  rm -rf "$other_cwd"
  [ "$status" -eq 0 ]
}

# ── VGH-8..VGH-9 (CRLF-normalization discriminator, H1 Codex NO-GO fix round) ─
# sha256_of() currently normalizes with tr -d '\r', which deletes EVERY CR
# byte, including one that is NOT part of a "\r\n" pair -- a hook drifted
# by a lone \r false-hashes as canonical. The fix normalizes CRLF pairs
# only ("\r\n" -> "\n"). VGH-8 is the positive control (a legitimate CRLF
# checkout must PASS under either implementation); VGH-9 is the
# discriminator (a lone-\r drift must be caught as hook-drifted -- RED
# against the current tr -d '\r' primitive, GREEN once the fix lands).

@test "VGH-8 PASS: CRLF-equivalent hook (every LF -> CRLF) -> exit 0" {
  # Chain: (1) source present (2) hook present (3) executable (4) marker
  # present (5) sha256 match under CRLF-pair normalization -- all 5 pass.
  # Control case: a Windows-checked-out hook is legitimately equivalent to
  # canonical and must PASS both before and after the tr -d '\r' fix.
  provide_canonical_source
  write_crlf_hook
  run bash "$SCRIPT" --repo-root "$REPO"
  [ "$status" -eq 0 ]
}

@test "VGH-9 BLOCK (discriminator): lone mid-line \r (not part of a \r\n pair) -> hook-drifted" {
  # Chain: (1) source present (2) hook present (3) executable (4) marker
  # present [all satisfied] -- (5) sha256 mismatch from one standalone \r
  # byte outside any \r\n pair [TRIPPED under a correct implementation].
  # Against the CURRENT tr -d '\r' primitive (deletes every CR
  # unconditionally) this lone \r is stripped and the hook false-matches
  # canonical -- expected RED here until the fix (CRLF-pair-only
  # normalization) lands.
  provide_canonical_source
  write_lone_cr_hook
  run bash "$SCRIPT" --repo-root "$REPO"
  [ "$status" -ne 0 ]
  [[ "$output" == *"hook-drifted"* ]] || return 1
}
