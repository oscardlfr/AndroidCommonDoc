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
