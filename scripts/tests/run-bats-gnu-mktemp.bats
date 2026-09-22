#!/usr/bin/env bats
#
# F-22c: run-bats.sh must prove the effective `mktemp` is GNU before running the
# suite. BSD `mktemp` ignores $TMPDIR; GNU's honours it. Suites such as
# runtime-consultation-bridge.bats export TMPDIR to bats' own per-test tmpdir and
# then call `mktemp -d`, so under BSD mktemp the project root escapes the sandbox
# and every test in the file dies in shared setup(). Observed on darwin: 368
# failures from exactly that, plus a truncated run.
#
# The preflight runs ONLY in run mode; --eval-only never requires GNU mktemp and
# never builds a shim.

setup() {
  RUNBATS="$BATS_TEST_DIRNAME/../sh/run-bats.sh"
  FAKEBIN="$BATS_TEST_TMPDIR/fake bin"     # deliberate space: paths must survive quoting
  PROJ="$BATS_TEST_TMPDIR/proj"
  mkdir -p "$FAKEBIN" "$PROJ"

  # Minimal bats stand-in: emits a valid 1-test TAP log and records the GNU-ness
  # of whatever `mktemp` it inherits, so the shim's effect is asserted from the
  # CHILD's point of view, never from the parent's.
  cat > "$FAKEBIN/bats" <<'FAKE'
#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "Bats 1.0.0"; exit 0; fi
if [ "$1" = "--count" ]; then echo 1; exit 0; fi
{ mktemp --version 2>/dev/null | head -n 1; } > "$FAKE_BATS_MKTEMP_WITNESS" || true
printf '%s\n' "${TMPDIR:-}" > "$FAKE_BATS_TMPDIR_WITNESS" || true
echo "1..1"
echo "ok 1 fake"
FAKE
  chmod 0755 "$FAKEBIN/bats"

  # The production wrapper probes npm-managed bats before the plain PATH
  # fallback. Force that first probe to fail deterministically so these tests
  # exercise the fake PATH bats declared above rather than a host-global npm
  # installation that happens to be present on the runner.
  cat > "$FAKEBIN/npx" <<'FAKE'
#!/usr/bin/env bash
exit 1
FAKE
  chmod 0755 "$FAKEBIN/npx"

  # BSD-shaped mktemp: rejects --version exactly like /usr/bin/mktemp does.
  cat > "$FAKEBIN/mktemp" <<'FAKE'
#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "mktemp: illegal option -- -" >&2; exit 1; fi
exec /usr/bin/mktemp "$@"
FAKE
  chmod 0755 "$FAKEBIN/mktemp"

  WITNESS="$BATS_TEST_TMPDIR/witness.txt"
  : > "$WITNESS"
  export FAKE_BATS_MKTEMP_WITNESS="$WITNESS"
  TMPDIR_WITNESS="$BATS_TEST_TMPDIR/tmpdir-witness.txt"
  : > "$TMPDIR_WITNESS"
  export FAKE_BATS_TMPDIR_WITNESS="$TMPDIR_WITNESS"
  LOG="$BATS_TEST_TMPDIR/out.log"
  SHIMS_BEFORE="$(_shim_snapshot)"
  BUDGET_SCOPED_TMPDIR=""
}

# Runs after EVERY case, including one aborted mid-way by a failed assertion, so
# a run-scoped short TMPDIR can never outlive the test that created it.
teardown() {
  if [ -n "${BUDGET_SCOPED_TMPDIR:-}" ] && [ -d "$BUDGET_SCOPED_TMPDIR" ]; then
    rm -rf -- "$BUDGET_SCOPED_TMPDIR"
  fi
}

_make_gnu() {  # $1 = tool name to create as a GNU-shaped mktemp
  cat > "$FAKEBIN/$1" <<'FAKE'
#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "mktemp (GNU coreutils) 9.9"; exit 0; fi
exec /usr/bin/mktemp "$@"
FAKE
  chmod 0755 "$FAKEBIN/$1"
}

# The shim prefix is shared by every run-bats invocation, including an OUTER one
# that may be running this very file. Asserting "no shim dirs exist" would then
# observe the parent's shim. Snapshot before/after instead and assert the inner
# run added none of its own.
_shim_snapshot() {
  ls -d "${TMPDIR:-/tmp}"/run-bats-gnushim-* 2>/dev/null | sort || true
}

_assert_no_new_shim() {  # $1 = snapshot taken before the inner run
  local after; after="$(_shim_snapshot)"
  local added; added="$(comm -13 <(printf '%s\n' "$1") <(printf '%s\n' "$after") || true)"
  [ -z "$added" ]
}

_run_runbats() {
  PATH="$FAKEBIN:/usr/bin:/bin" run bash "$RUNBATS" --project-root "$PROJ" --log "$LOG" "$@"
}

@test "GNU-MKTEMP-01 native GNU mktemp runs the suite directly and builds no shim" {
  _make_gnu mktemp
  _run_runbats "$PROJ/x.bats"
  [ "$status" -eq 0 ]
  grep -q "GNU coreutils" "$WITNESS"
  # No shim needed, so this run must add nothing under the run-scoped prefix.
  _assert_no_new_shim "$SHIMS_BEFORE"
}

@test "GNU-MKTEMP-02 BSD mktemp plus GNU gmktemp shims the child PATH" {
  _make_gnu gmktemp
  _run_runbats "$PROJ/x.bats"
  [ "$status" -eq 0 ]
  # The CHILD must see a GNU mktemp even though the parent's is BSD.
  grep -q "GNU coreutils" "$WITNESS"
}

@test "GNU-MKTEMP-03 BSD mktemp with no gmktemp fails closed with exit 2" {
  _run_runbats "$PROJ/x.bats"
  [ "$status" -eq 2 ]
  [[ "$output" == *"GNU"* ]]
  [[ "$output" == *"coreutils"* ]]
  # Must never have run the suite.
  [ ! -s "$WITNESS" ]
}

@test "GNU-MKTEMP-04 a non-GNU gmktemp is rejected, not trusted by name" {
  cat > "$FAKEBIN/gmktemp" <<'FAKE'
#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "mktemp (definitely not coreutils) 1.0"; exit 0; fi
exec /usr/bin/mktemp "$@"
FAKE
  chmod 0755 "$FAKEBIN/gmktemp"
  _run_runbats "$PROJ/x.bats"
  [ "$status" -eq 2 ]
  [ ! -s "$WITNESS" ]
}

@test "GNU-MKTEMP-05 the shim is cleaned up on success and on failure" {
  _make_gnu gmktemp
  _run_runbats "$PROJ/x.bats"
  [ "$status" -eq 0 ]
  _assert_no_new_shim "$SHIMS_BEFORE"

  # Failure path: make the fake bats exit non-zero; the shim must still go.
  cat > "$FAKEBIN/bats" <<'FAKE'
#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "Bats 1.0.0"; exit 0; fi
if [ "$1" = "--count" ]; then echo 1; exit 0; fi
echo "1..1"; echo "not ok 1 fake"; exit 1
FAKE
  chmod 0755 "$FAKEBIN/bats"
  _run_runbats "$PROJ/x.bats"
  _assert_no_new_shim "$SHIMS_BEFORE"
}

@test "GNU-MKTEMP-06 --eval-only needs no GNU mktemp and builds no shim" {
  printf '1..1\nok 1 prior\n' > "$LOG"
  # Neither a GNU mktemp nor a gmktemp exists here.
  PATH="$FAKEBIN:/usr/bin:/bin" run bash "$RUNBATS" --project-root "$PROJ" --log "$LOG" --eval-only
  [ "$status" -eq 0 ]
  [[ "$output" != *"GNU coreutils required"* ]]
  _assert_no_new_shim "$SHIMS_BEFORE"
}

# --- isolation-root child-state path budget ---
#
# scripts/lib/runtime-bridge-codex/isolation-topology.cjs caps a codex child's
# own state path at 254 characters. The deepest path this suite builds beneath
# $TMPDIR is
#   /bats-run-XXXXXX/test/<n>/runtime-tmp/android-common-doc-runtime/uid-501/<64 hex>/isolation-roots/<32 hex>/cx/memories_1.sqlite-shm
# i.e. 212 characters, so the base must be at most 42. macOS hands every user a
# 48-character per-user TMPDIR, so the ambient default cannot satisfy it and
# isolation roots fail to provision with ISOLATION_ROOT_PATH_BUDGET_EXCEEDED --
# for SOME tests only, because the remaining margin moves with the bats run-dir
# name and the test index. That is exactly why the same commit passed and
# failed in different sessions.

_child_tmpdir() { cat "$TMPDIR_WITNESS"; }

@test "TMPDIR-BUDGET-01 an over-long ambient TMPDIR is replaced for the bats child with one inside the budget" {
  _make_gnu mktemp
  local long_tmp="$BATS_TEST_TMPDIR/aaaaaaaaaa/bbbbbbbbbb/cccccccccc/dddddddddd/eeeeeeeeee"
  mkdir -p "$long_tmp"
  [ "${#long_tmp}" -gt 42 ]
  TMPDIR="$long_tmp" _run_runbats "$PROJ/x.bats"
  [ "$status" -eq 0 ]
  local child; child="$(_child_tmpdir)"
  [ -n "$child" ]
  [ "${#child}" -le 42 ]
  [ "$child" != "$long_tmp" ]
}

@test "TMPDIR-BUDGET-02 an ambient TMPDIR already inside the budget is left exactly as it is" {
  _make_gnu mktemp
  # mktemp -d, never a PID-derived literal: two concurrent runs share a PID
  # namespace only by luck, and the directory is registered for cleanup on the
  # line after it is created so a failing assertion below still cannot leak it.
  local short_tmp; short_tmp="$(mktemp -d /tmp/l0b-XXXXXXXX)"
  BUDGET_SCOPED_TMPDIR="$short_tmp"
  [ "${#short_tmp}" -le 42 ]
  TMPDIR="$short_tmp" _run_runbats "$PROJ/x.bats"
  [ "$status" -eq 0 ]
  [ "$(_child_tmpdir)" = "$short_tmp" ]
}

@test "TMPDIR-BUDGET-03 a run-scoped short TMPDIR is removed when the run ends" {
  _make_gnu mktemp
  local long_tmp="$BATS_TEST_TMPDIR/aaaaaaaaaa/bbbbbbbbbb/cccccccccc/dddddddddd/eeeeeeeeee"
  mkdir -p "$long_tmp"
  TMPDIR="$long_tmp" _run_runbats "$PROJ/x.bats"
  [ "$status" -eq 0 ]
  local child; child="$(_child_tmpdir)"
  [ -n "$child" ]
  [ ! -e "$child" ]
}
