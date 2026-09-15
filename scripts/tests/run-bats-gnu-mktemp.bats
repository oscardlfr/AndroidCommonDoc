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
echo "1..1"
echo "ok 1 fake"
FAKE
  chmod 0755 "$FAKEBIN/bats"

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
  LOG="$BATS_TEST_TMPDIR/out.log"
}

_make_gnu() {  # $1 = tool name to create as a GNU-shaped mktemp
  cat > "$FAKEBIN/$1" <<'FAKE'
#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "mktemp (GNU coreutils) 9.9"; exit 0; fi
exec /usr/bin/mktemp "$@"
FAKE
  chmod 0755 "$FAKEBIN/$1"
}

_run_runbats() {
  PATH="$FAKEBIN:/usr/bin:/bin" run bash "$RUNBATS" --project-root "$PROJ" --log "$LOG" "$@"
}

@test "GNU-MKTEMP-01 native GNU mktemp runs the suite directly and builds no shim" {
  _make_gnu mktemp
  _run_runbats "$PROJ/x.bats"
  [ "$status" -eq 0 ]
  grep -q "GNU coreutils" "$WITNESS"
  # No shim needed, so nothing may be left behind under the run-scoped prefix.
  run bash -c 'ls -d "${TMPDIR:-/tmp}"/run-bats-gnushim-* 2>/dev/null | wc -l'
  [ "$output" -eq 0 ]
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
  run bash -c 'ls -d "${TMPDIR:-/tmp}"/run-bats-gnushim-* 2>/dev/null | wc -l'
  [ "$output" -eq 0 ]

  # Failure path: make the fake bats exit non-zero; the shim must still go.
  cat > "$FAKEBIN/bats" <<'FAKE'
#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "Bats 1.0.0"; exit 0; fi
if [ "$1" = "--count" ]; then echo 1; exit 0; fi
echo "1..1"; echo "not ok 1 fake"; exit 1
FAKE
  chmod 0755 "$FAKEBIN/bats"
  _run_runbats "$PROJ/x.bats"
  run bash -c 'ls -d "${TMPDIR:-/tmp}"/run-bats-gnushim-* 2>/dev/null | wc -l'
  [ "$output" -eq 0 ]
}

@test "GNU-MKTEMP-06 --eval-only needs no GNU mktemp and builds no shim" {
  printf '1..1\nok 1 prior\n' > "$LOG"
  # Neither a GNU mktemp nor a gmktemp exists here.
  PATH="$FAKEBIN:/usr/bin:/bin" run bash "$RUNBATS" --project-root "$PROJ" --log "$LOG" --eval-only
  [ "$status" -eq 0 ]
  [[ "$output" != *"GNU coreutils required"* ]]
  run bash -c 'ls -d "${TMPDIR:-/tmp}"/run-bats-gnushim-* 2>/dev/null | wc -l'
  [ "$output" -eq 0 ]
}
