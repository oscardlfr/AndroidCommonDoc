#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Tests for scripts/sh/write-specialist-dispatch.sh (wave-runtime-topology-disk-first-binding, WS-1).
# Canonical dispatch-artifact writer: architect -> specialist authorization JSON.
# Confinement: .planning/wave-<slug>/specialist-dispatches/<specialist>/<architect>-<ts>.json
#
# CORE NON-VACUITY MANDATE: every "current" fixture derives head/plan_sha256 from a REAL
# `git rev-parse HEAD` + REAL sha256 of the seeded PLAN.md computed at test-run time —
# never hardcoded matching constants. See
# .planning/wave-runtime-topology-disk-first-binding/DECISIONS.md ("Test suite amendments").
#
# No --plan-path test here (F4 — flag was dropped; plan_path is always
# .planning/wave-<slug>/PLAN.md, hardcoded, symmetric with write-verdict.sh).
#
# Invocation: bats scripts/tests/write-specialist-dispatch.bats  (from repo root)

SCRIPT="$BATS_TEST_DIRNAME/../sh/write-specialist-dispatch.sh"
WAVE_SLUG="rtdfb-wsd-test"

setup() {
  PROJ="$(mktemp -d)"
  # Initialise a throwaway git repo so git rev-parse HEAD / --show-toplevel resolve to
  # PROJ, never the live repo.
  git -C "$PROJ" init -q 2>/dev/null
  git -C "$PROJ" -c user.email=test@example.com -c user.name=test \
      commit -q --allow-empty -m init 2>/dev/null
  # Prevent ambient CLAUDE_WAVE_SLUG from leaking into error-case tests.
  unset CLAUDE_WAVE_SLUG
}

teardown() {
  rm -rf "$PROJ"
}

# _seed_plan <slug> — writes a minimal PLAN.md at .planning/wave-<slug>/PLAN.md inside PROJ.
# Content is deterministic per-slug so an independently-computed sha256 (via _real_sha256)
# always matches what the script itself hashes.
_seed_plan() {
  local slug="$1"
  mkdir -p "$PROJ/.planning/wave-$slug"
  printf '# Plan\n\nSome plan content for %s.\n' "$slug" > "$PROJ/.planning/wave-$slug/PLAN.md"
}

# _real_sha256 <file> — portable sha256 (mirrors _sha256_file in write-specialist-dispatch.sh
# and write-verdict.sh; matches the Node crypto Buffer-based hash used by the gate — F2).
_real_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# _json_get <file> <field> — prints a top-level JSON field's value via python3
# (bool -> true/false, list -> compact JSON re-serialization, else raw string).
# Used for non-vacuous exact-value assertions against independently-computed expectations.
_json_get() {
  python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
v = d[sys.argv[2]]
if isinstance(v, bool):
    print('true' if v else 'false')
elif isinstance(v, list):
    print(json.dumps(v))
else:
    print(v)
" "$1" "$2"
}

# ── Valid write: canonical path, filename pattern, current head + plan_sha256 ─────────────

@test "WSD-1 PASS: valid write produces dispatch JSON at canonical path with current head+plan_sha256" {
  _seed_plan "$WAVE_SLUG"
  local real_head real_plan_sha256
  real_head="$(git -C "$PROJ" rev-parse HEAD)"
  real_plan_sha256="$(_real_sha256 "$PROJ/.planning/wave-$WAVE_SLUG/PLAN.md")"

  run bash -c "cd '$PROJ' && printf 'Implement the thing.\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --architect arch-testing --specialist test-specialist \
    --file docs/foo.md --file docs/bar.md --slug '$WAVE_SLUG' --summary 'do it'"
  [ "$status" -eq 0 ]

  local dispatch_dir="$PROJ/.planning/wave-$WAVE_SLUG/specialist-dispatches/test-specialist"
  [ -d "$dispatch_dir" ]

  local matches=("$dispatch_dir"/arch-testing-*.json)
  [ -f "${matches[0]}" ]
  [ "${#matches[@]}" -eq 1 ]

  # Filename timestamp pattern: <architect>-<YYYYMMDDTHHMMSSZ>.json (colon-free ts).
  local fname
  fname="$(basename "${matches[0]}")"
  [[ "$fname" =~ ^arch-testing-[0-9]{8}T[0-9]{6}Z\.json$ ]]

  local dispatch_file="${matches[0]}"
  [ "$(_json_get "$dispatch_file" schema)" = "specialist-dispatch/v1" ]
  [ "$(_json_get "$dispatch_file" wave_slug)" = "$WAVE_SLUG" ]
  [ "$(_json_get "$dispatch_file" architect)" = "arch-testing" ]
  [ "$(_json_get "$dispatch_file" specialist)" = "test-specialist" ]
  [ "$(_json_get "$dispatch_file" head)" = "$real_head" ]
  [ "$(_json_get "$dispatch_file" plan_sha256)" = "$real_plan_sha256" ]
  [ "$(_json_get "$dispatch_file" files)" = '["docs/foo.md", "docs/bar.md"]' ]
  [ "$(_json_get "$dispatch_file" bash_only)" = "false" ]
  [ "$(_json_get "$dispatch_file" allowed_tools)" = '[]' ]
  [ "$(_json_get "$dispatch_file" task)" = "Implement the thing." ]
}

# ── Invalid architect / specialist ─────────────────────────────────────────────────────────

@test "WSD-2 FAIL: invalid architect exits 2" {
  run bash -c "cd '$PROJ' && printf 'task\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --architect arch-bogus --specialist test-specialist \
    --file docs/foo.md --slug '$WAVE_SLUG'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"Invalid architect"* ]]
}

@test "WSD-3 FAIL: invalid specialist exits 2" {
  run bash -c "cd '$PROJ' && printf 'task\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --architect arch-testing --specialist bogus-specialist \
    --file docs/foo.md --slug '$WAVE_SLUG'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"Invalid specialist"* ]]
}

@test "WSD-4 FAIL: doc-updater specialist is rejected (D4) with exit 2" {
  run bash -c "cd '$PROJ' && printf 'task\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --architect arch-testing --specialist doc-updater \
    --file docs/foo.md --slug '$WAVE_SLUG'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"doc-updater"* ]]
}

# ── Slug integrity: traversal + protected name ────────────────────────────────────────────

@test "WSD-5 FAIL: traversal slug (../evil) exits 2" {
  run bash -c "cd '$PROJ' && printf 'task\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --architect arch-testing --specialist test-specialist \
    --file docs/foo.md --slug '../evil'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"Traversal"* ]]
  [ ! -d "$PROJ/.planning/wave-../evil" ]
}

@test "WSD-6 FAIL: protected slug (develop) exits 2" {
  run bash -c "cd '$PROJ' && printf 'task\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --architect arch-testing --specialist test-specialist \
    --file docs/foo.md --slug develop"
  [ "$status" -eq 2 ]
  [[ "$output" == *"protected"* ]]
}

# ── PLAN.md / HEAD integrity (D5 fail-closed) ─────────────────────────────────────────────

@test "WSD-7 FAIL: missing PLAN.md exits 2" {
  # Deliberately do NOT _seed_plan — the wave dir has no PLAN.md.
  run bash -c "cd '$PROJ' && printf 'task\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --architect arch-testing --specialist test-specialist \
    --file docs/foo.md --slug '$WAVE_SLUG'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"Plan file not found"* ]]
}

@test "WSD-8 FAIL: missing/unresolvable HEAD (fresh repo, no commit) exits 2" {
  # SEPARATE fresh git init with NO seed commit — HEAD cannot be resolved to 40-hex.
  local empty_proj
  empty_proj="$(mktemp -d)"
  git -C "$empty_proj" init -q 2>/dev/null
  mkdir -p "$empty_proj/.planning/wave-$WAVE_SLUG"
  printf '# Plan\n' > "$empty_proj/.planning/wave-$WAVE_SLUG/PLAN.md"

  run bash -c "cd '$empty_proj' && printf 'task\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --architect arch-testing --specialist test-specialist \
    --file docs/foo.md --slug '$WAVE_SLUG'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"HEAD"* ]]

  local dispatch_dir="$empty_proj/.planning/wave-$WAVE_SLUG/specialist-dispatches/test-specialist"
  [ ! -d "$dispatch_dir" ]

  rm -rf "$empty_proj"
}

# ── files[] requirement / --bash-only ─────────────────────────────────────────────────────

@test "WSD-9 FAIL: empty --file (none given) without --bash-only exits 2" {
  _seed_plan "$WAVE_SLUG"
  run bash -c "cd '$PROJ' && printf 'task\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --architect arch-testing --specialist test-specialist --slug '$WAVE_SLUG'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"--file is required"* ]]
}

@test "WSD-10 FAIL: empty/absent stdin task (< /dev/null) exits 2" {
  _seed_plan "$WAVE_SLUG"
  run bash -c "cd '$PROJ' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --architect arch-testing --specialist test-specialist \
    --file docs/foo.md --slug '$WAVE_SLUG' < /dev/null"
  [ "$status" -eq 2 ]
  [[ "$output" == *"Task body"* ]]
}

@test "WSD-11 PASS: --bash-only with empty files writes JSON (bash_only:true, allowed_tools:[Bash], files:[])" {
  _seed_plan "$WAVE_SLUG"
  run bash -c "cd '$PROJ' && printf 'run the migration\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --architect arch-testing --specialist test-specialist \
    --bash-only --slug '$WAVE_SLUG'"
  [ "$status" -eq 0 ]

  local dispatch_dir="$PROJ/.planning/wave-$WAVE_SLUG/specialist-dispatches/test-specialist"
  local matches=("$dispatch_dir"/arch-testing-*.json)
  [ -f "${matches[0]}" ]
  local dispatch_file="${matches[0]}"

  [ "$(_json_get "$dispatch_file" bash_only)" = "true" ]
  [ "$(_json_get "$dispatch_file" files)" = "[]" ]
  [ "$(_json_get "$dispatch_file" allowed_tools)" = '["Bash"]' ]
}

@test "WSD-12 FAIL: --bash-only combined with --file exits 2 (mutually exclusive, Codex P2)" {
  # A bash-only dispatch authorizes execution-Bash only and must carry no Write/Edit targets;
  # combining --bash-only with --file is rejected so the invariant bash_only <=> empty files[]
  # holds and the gate cannot be tricked into authorizing Write/Edit via a bash_only dispatch.
  _seed_plan "$WAVE_SLUG"
  run bash -c "cd '$PROJ' && printf 'run the migration\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --architect arch-testing --specialist test-specialist \
    --bash-only --file docs/foo.md --slug '$WAVE_SLUG'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"--bash-only cannot be combined with --file"* ]]
}

# ── P1 escape closure: --file must resolve inside REPO_ROOT ────────────────────────────────

@test "WSD-13 FAIL: --file resolving outside repo (absolute /tmp/foo) exits 2" {
  _seed_plan "$WAVE_SLUG"
  run bash -c "cd '$PROJ' && printf 'task\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --architect arch-testing --specialist test-specialist \
    --file /tmp/foo --slug '$WAVE_SLUG'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"outside the repository root"* ]]
  # Nothing written for an out-of-repo target.
  [ ! -d "$PROJ/.planning/wave-$WAVE_SLUG/specialist-dispatches/test-specialist" ]
}

@test "WSD-14 FAIL: --file with ../ escape (../foo) exits 2" {
  _seed_plan "$WAVE_SLUG"
  run bash -c "cd '$PROJ' && printf 'task\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --architect arch-testing --specialist test-specialist \
    --file ../foo --slug '$WAVE_SLUG'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"outside the repository root"* ]]
}

@test "WSD-15 FAIL: --file with mid-path escape (foo/../../bar) exits 2 and writes nothing (macOS/BSD portability, Codex)" {
  # foo/../../bar is NOT absolute and does NOT start with '..', so the fast lexical pre-checks
  # never fired — the old realpath -m path (absent on macOS/BSD) let it through with status=0.
  # Portable lexical normalization must collapse the mid-path '..' and reject the escape.
  _seed_plan "$WAVE_SLUG"
  run bash -c "cd '$PROJ' && printf 'task\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --architect arch-testing --specialist test-specialist \
    --file foo/../../bar --slug '$WAVE_SLUG'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"outside the repository root"* ]]
  # No dispatch written for an out-of-repo target.
  [ ! -d "$PROJ/.planning/wave-$WAVE_SLUG/specialist-dispatches/test-specialist" ]
}

# ── BL-W4-9: Check-2 confinement — macOS/BSD-parity, sibling collision rejected ──
#
# CORRECTED mid-wave (arch-platform + arch-integration, relayed by team-lead and
# toolkit-specialist): the shipped fix does NOT adopt _file_in_repo()'s pure-lexical
# idiom as PLAN.md originally sketched — it PORTS write-coordination-artifact.sh's
# Codex-hardened _realpath_resolve()/_confine_under_planning() helper pair (that
# file's own header names THIS block, write-specialist-dispatch.sh:340-349, as the bug
# it hardens — Wave 2 fixed the sibling but never backported here). `_realpath_resolve`
# legitimately STILL calls `realpath -m` as a harmless first attempt (it fails cleanly
# on macOS/BSD — "illegal option -- m", confirmed empirically — and falls through to a
# python3 os.path.realpath() fallback, failing closed if BOTH resolution paths come up
# empty). The bug was never "the script calls realpath -m"; it was the OLD silent
# `|| echo "$PLANNING_DIR")"` fallback (uses the literal, uncanonicalized path on
# failure/absence — no symlink resolution, no fail-closed check) combined with a bare
# "$canon_planning"* glob with no "/" separator boundary (a sibling like
# .planning-evil/... lexically matches it even though it is NOT a true child).
#
# NOTE ON TEST SHAPE: DISPATCH_DIR is programmatically derived from an
# already-validated WAVE_SLUG (_validate_slug() allowlists ^[A-Za-z0-9._-]+$, plus a
# separate ".."/"/"/"\\" substring reject applied unconditionally at L204-207) and an
# enum-locked --specialist — a bare CLI argument can never make DISPATCH_DIR's STRING
# representation escape .planning/ (by construction it is always a literal
# ".planning/wave-.../..." child). The only way to reach a GENUINE escape through the
# public CLI is a symlink planted on disk ahead of the run — which is also exactly the
# scenario `_realpath_resolve()`'s python3 fallback (os.path.realpath(), which DOES
# resolve symlinks — verified empirically: it correctly follows a symlinked
# intermediate directory and appends a non-existent trailing segment literally) exists
# to defend against. REJECTED-sibling behavior is verified two ways:
#   (a) a BEHAVIORAL end-to-end test driving the real script against a symlink planted
#       inside .planning/ pointing at a sibling ".planning-evil" — strong proof the
#       fix's canonicalization (not just its comparison operator) actually works;
#   (b) an ISOLATED test of the boundary-check comparison operator itself (below) —
#       proving the old bare-glob wrongly accepts / the new boundary idiom correctly
#       rejects the .planning-evil sibling collision, independent of canonicalization.

@test "BL-W4-9 Check-2 BEHAVIORAL: symlink planted inside .planning/ escaping to a '.planning-evil' sibling is rejected end-to-end" {
  _seed_plan "$WAVE_SLUG"
  local evil_dir="$PROJ/.planning-evil"
  mkdir -p "$evil_dir"
  # Plant the symlink AFTER _seed_plan (which creates the real wave dir + PLAN.md) —
  # replace just the specialist-dispatches parent with a symlink to the sibling, so
  # DISPATCH_DIR's literal string still reads ".planning/wave-.../specialist-dispatches/
  # test-specialist" but its REAL resolved location is ".planning-evil/test-specialist".
  ln -s "$evil_dir" "$PROJ/.planning/wave-$WAVE_SLUG/specialist-dispatches"

  run bash -c "cd '$PROJ' && printf 'task\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --architect arch-testing --specialist test-specialist \
    --file docs/foo.md --slug '$WAVE_SLUG'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"confinement"* ]] || return 1

  # Nothing written through the symlink to the sibling location — mkdir -p
  # "$DISPATCH_DIR" is only reached AFTER _confine_under_planning passes.
  [ -z "$(ls -A "$evil_dir" 2>/dev/null)" ] || return 1
}

@test "BL-W4-9 Check-2 CONFINEMENT IDIOM: old bare-glob wrongly accepts a '.planning-evil' sibling collision" {
  local root="/tmp/bl-w4-9-fixture/.planning"
  local sibling="/tmp/bl-w4-9-fixture/.planning-evil/wave-x/specialist-dispatches/test-specialist"
  # Pre-fix idiom reproduction ("$root"* has no separator boundary) — must match (bug).
  # `|| return 1`: defensive against the non-final-[[ ]] bats/bash abort quirk
  # (currently the sole/last statement, but future-proofed against later edits).
  [[ "$sibling" == "$root"* ]] || return 1
}

@test "BL-W4-9 Check-2 CONFINEMENT IDIOM: boundary-safe idiom (_file_in_repo()-style) rejects the same '.planning-evil' sibling collision" {
  local root="/tmp/bl-w4-9-fixture/.planning"
  local sibling="/tmp/bl-w4-9-fixture/.planning-evil/wave-x/specialist-dispatches/test-specialist"
  # Post-fix idiom: exact-match OR slash-bounded child — mirrors _file_in_repo() L298-301.
  ! [[ "$sibling" == "$root" || "$sibling" == "$root"/* ]] || return 1
}

@test "BL-W4-9 Check-2 CONFINEMENT IDIOM: boundary-safe idiom still accepts a genuine nested child" {
  local root="/tmp/bl-w4-9-fixture/.planning"
  local nested="/tmp/bl-w4-9-fixture/.planning/wave-x/specialist-dispatches/test-specialist"
  [[ "$nested" == "$root" || "$nested" == "$root"/* ]] || return 1
}
