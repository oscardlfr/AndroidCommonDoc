#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# RED-first end-to-end tests for scripts/lib/verdict-evidence-contract-cli.cjs (does not
# exist yet, P1 of wave structured-verdict-evidence-contract). Tests the CLI adapter via
# real shell invocation (`node ... cli.cjs ...`), proving it correctly wires argv into
# the contract/store modules for the ONE JS-level signature toolkit-specialist has
# confirmed final for P1:
#
#   validateVerdict({path, expectRole, expectPhase, expectWaveSlug, expectPlanSha256,
#                     expectHead}) -> {exists,wellFormed,roleBound,requestBound,
#                     headBound,planBound,evidenceValid,decisionAuthorized,authorizes,reason}
#
# Mapped to a `validate` subcommand here (argv flag names are my own choice, not
# dictated by the JS param names, but chosen to mirror them 1:1 for clarity):
#   validate --path <verdict-path> --expect-role <role> --expect-phase <phase>
#            --expect-wave-slug <slug> --expect-plan-sha256 <64hex> --expect-head <40hex>
#       -> compact single-line JSON of the result fields, exit 0 (even when
#          authorizes=false -- a normal report, not a CLI usage error); exit 2 with
#          {"status":"USAGE_ERROR","detail_code":"..."} on bad/missing flags.
#   read-field --path <verdict-path> --field rationale
#       -> {"status":"OK","field":"rationale","value":"..."}, exit 0; or
#          {"status":"REJECTED","detail_code":"..."}, exit 2 if not well-formed.
#
# SCOPE NOTE (toolkit-specialist sync): the CLI's write-side subcommands
# (create-request/publish-verdict, backed by createRequest()/publishVerdict()) have an
# argv surface toolkit-specialist explicitly flagged as "not frozen yet, P2's job" --
# this file therefore does NOT test them via shell invocation yet (would very likely be
# thrown away once P2 pins that grammar). Their underlying store primitives
# (publishNoClobber/publishSupersede, including the already-exists/compare-mismatch/
# lock-timeout/identity-drift/durability-unproven/confinement-failed RED cases and the
# replayed-request pure primitive) are already fully RED-tested directly as JS functions
# in verdict-artifact-store.test.cjs / verdict-evidence-contract.test.cjs -- that
# coverage is not lost, just at the right layer for what's actually pinned right now.
# End-to-end CLI coverage for create-request/publish-verdict (including the
# replayed-request refusal enforced by publishVerdict before ever calling
# store.publishSupersede) belongs in a P2 dispatch once that grammar is frozen.
#
# Wrong filenames are rejected centrally by publish-record and validate; callers do not
# get to substitute a path for the role/phase encoded in the signed record.
#
# Isolation mirrors write-verdict.bats exactly: mktemp -d PROJ, throwaway git init -q,
# explicit per-invocation cd (never ambient CWD) -- the CLI resolves its git repo root
# from process.cwd(), so every invocation below runs via `cd '$PROJ' && node ...`,
# exactly mirroring write-verdict.bats's own run_verdict() pattern. All sha256/commit
# values are computed/created at test-run time -- never hardcoded (CORE NON-VACUITY
# MANDATE). Multiple REAL commits are created per test so the headBound ancestor-vs-exact
# discriminating pair (arch-platform's critical case, relayed by arch-testing) exercises
# genuine `git merge-base --is-ancestor`, not a synthetic/injected boolean.

CLI="$BATS_TEST_DIRNAME/../lib/verdict-evidence-contract-cli.cjs"

setup() {
  PROJ="$(mktemp -d)"
  git -C "$PROJ" init -q 2>/dev/null
  WAVE_DIR="$PROJ/.planning/wave-$WAVE_SLUG"
  mkdir -p "$WAVE_DIR"
  printf 'fixture plan\n' > "$WAVE_DIR/PLAN.md"
  PLAN64="$(_real_sha256 "$WAVE_DIR/PLAN.md")"
  git -C "$PROJ" -c user.email=test@example.com -c user.name=test add .
  git -C "$PROJ" -c user.email=test@example.com -c user.name=test commit -qm fixture
}

teardown() {
  rm -rf "$PROJ"
}

_real_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

_hex() { # _hex <count> <char>
  printf "$2%.0s" $(seq 1 "$1")
}

# _win_path <path> -> Windows-form (forward-slash) absolute path, for embedding in JSON
# CONTENT the CLI (a native Windows Node process) reads via fs.readFileSync+JSON.parse.
# MSYS only auto-translates a POSIX-style path when it is an argv ARGUMENT to a native
# exe (why --path/--verdict below work unmodified) -- it never touches an opaque string
# VALUE sitting inside file content. Without this, mktemp -d's MSYS-style $PROJ embedded
# verbatim into a JSON path field gets misinterpreted by Node's path resolution (a
# leading `/` is read as "root of the current drive"), which confinement then correctly
# (but confusingly, for the FIXTURE's purposes) rejects as escaping. Uses `-m`, not `-w`
# -- `-w` emits backslashes, which are JSON's own escape character and would corrupt the
# JSON grammar itself; `-m` gives forward slashes, matching this codebase's own existing
# Windows-compat convention (git rev-parse --show-toplevel, write-verdict.sh). POSIX/
# Linux CI passthrough when cygpath is absent.
_win_path() {
  cygpath -m "$1" 2>/dev/null || printf '%s' "$1"
}

# _commit <message> -> creates a real commit in $PROJ and prints its 40-hex SHA.
_commit() {
  git -C "$PROJ" -c user.email=test@example.com -c user.name=test \
      commit -q --allow-empty -m "$1" 2>/dev/null
  git -C "$PROJ" rev-parse HEAD
}

_run_cli() { # mirrors write-verdict.bats's run_verdict(): explicit cd, never ambient.
  run bash -c "cd '$PROJ' && node '$CLI' $*"
}

_run_cli_with_stdin() { # _run_cli_with_stdin <stdin-file> <cli-args...> -- same as
  # _run_cli but pipes a specific byte sequence in on stdin instead of the caller's own.
  local stdin_file="$1"; shift
  run bash -c "cd '$PROJ' && node '$CLI' $* < '$stdin_file'"
}

WAVE_SLUG="cli-fixture-wave"
PLAN64=""
REQID32="$(_hex 32 3)"

# _seed_request <phase> <head_sha> -> prints the absolute request path.
_seed_request() {
  local phase="$1" head_sha="$2"
  local subject_kind="plan"
  [ "$phase" = "verify-final" ] && subject_kind="source-manifest"
  mkdir -p "$WAVE_DIR/verdict-requests" "$WAVE_DIR/source-manifests"
  local subject_path="$WAVE_DIR/PLAN.md" subject_rel="PLAN.md"
  if [ "$phase" = "verify-final" ]; then
    subject_path="$WAVE_DIR/source-manifests/$REQID32.json"
    subject_rel="source-manifests/$REQID32.json"
    printf '{"schema":"source-manifest/v1","files":[]}\n' > "$subject_path"
  fi
  local subject_sha256
  subject_sha256="$(_real_sha256 "$subject_path")"
  local req_path="$WAVE_DIR/verdict-requests/$REQID32.json"
  cat > "$req_path" <<EOF
{"schema":"verdict-request/v1","request_id":"$REQID32","role":"arch-testing","phase":"$phase","wave_slug":"$WAVE_SLUG","plan_sha256":"$PLAN64","head":"$head_sha","subject":{"kind":"$subject_kind","path":"$subject_rel","sha256":"$subject_sha256"},"created_at":"2026-09-21T00:00:00Z"}
EOF
  printf '%s' "$req_path"
}

# _seed_verdict <phase> <decision> <head_sha> <request_path> <evidence_json_or_empty>
# -> prints the absolute verdict path (arch-testing-verdict-<phase>.json).
_seed_verdict() {
  local phase="$1" decision="$2" head_sha="$3" req_path="$4" evidence="${5:-[]}"
  local req_sha256
  req_sha256="$(_real_sha256 "$req_path")"
  local reason_field=""
  [ "$decision" = "escalate" ] && reason_field='"reason_code":"other",'
  local verdict_path="$WAVE_DIR/arch-testing-verdict-$phase.json"
  cat > "$verdict_path" <<EOF
{"schema":"verdict/v1","role":"arch-testing","wave_slug":"$WAVE_SLUG","phase":"$phase","decision":"$decision",${reason_field}"rationale":"reviewed","evidence":$evidence,"head":"$head_sha","plan_sha256":"$PLAN64","in_reply_to":"$REQID32","request_ref":{"path":"verdict-requests/$REQID32.json","sha256":"$req_sha256"},"created_at":"2026-09-21T00:00:00Z","supersedes":null}
EOF
  printf '%s' "$verdict_path"
}

# ── validate: happy paths ────────────────────────────────────────────────────────────

@test "RED validate: PREP approve authorizes true (verdict.head == current HEAD exactly)" {
  local head req verdict
  head="$(_commit c1)"
  req="$(_seed_request prep "$head")"
  verdict="$(_seed_verdict prep approve "$head" "$req")"
  _run_cli "validate --path '$verdict' --expect-role arch-testing --expect-phase prep --expect-wave-slug '$WAVE_SLUG' --expect-plan-sha256 '$PLAN64' --expect-head '$head'"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"authorizes":true'* ]]
  [[ "$output" == *'"exists":true'* ]]
}

@test "RED validate: VERIFY-FINAL approve with evidence authorizes true (exact HEAD match)" {
  local head req verdict evidence_file evidence_sha256
  head="$(_commit c1)"
  req="$(_seed_request verify-final "$head")"
  evidence_file="$WAVE_DIR/evidence.txt"
  printf 'evidence bytes\n' > "$evidence_file"
  evidence_sha256="$(_real_sha256 "$evidence_file")"
  verdict="$(_seed_verdict verify-final approve "$head" "$req" "[{\"kind\":\"opaque-file\",\"path\":\"evidence.txt\",\"sha256\":\"$evidence_sha256\"}]")"
  _run_cli "validate --path '$verdict' --expect-role arch-testing --expect-phase verify-final --expect-wave-slug '$WAVE_SLUG' --expect-plan-sha256 '$PLAN64' --expect-head '$head'"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"authorizes":true'* ]]
}

@test "RED validate: escalate reports decisionAuthorized false and authorizes false" {
  local head req verdict
  head="$(_commit c1)"
  req="$(_seed_request prep "$head")"
  verdict="$(_seed_verdict prep escalate "$head" "$req")"
  _run_cli "validate --path '$verdict' --expect-role arch-testing --expect-phase prep --expect-wave-slug '$WAVE_SLUG' --expect-plan-sha256 '$PLAN64' --expect-head '$head'"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"decisionAuthorized":false'* ]]
  [[ "$output" == *'"authorizes":false'* ]]
}

# ── validate: the critical headBound ancestor-vs-exact discriminating pair ──────────
# (arch-platform's correction, relayed by arch-testing: proves prep's ancestor leniency
# and verify-final's exact-match requirement are genuinely different code paths against
# REAL git ancestry, not one ancestor-check silently reused everywhere.)

@test "RED validate: PREP accepts a verdict.head that is a PROPER ancestor of the current HEAD (real git ancestry)" {
  local ancestor_head req verdict current_head
  ancestor_head="$(_commit c1)"
  current_head="$(_commit c2)"
  [ "$ancestor_head" != "$current_head" ]
  req="$(_seed_request prep "$ancestor_head")"
  verdict="$(_seed_verdict prep approve "$ancestor_head" "$req")"
  _run_cli "validate --path '$verdict' --expect-role arch-testing --expect-phase prep --expect-wave-slug '$WAVE_SLUG' --expect-plan-sha256 '$PLAN64' --expect-head '$current_head'"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"headBound":true'* ]]
  [[ "$output" == *'"authorizes":true'* ]]
}

@test "RED validate: VERIFY-FINAL REJECTS a verdict.head that is a proper ancestor (not exact) of the current HEAD (real git ancestry)" {
  local ancestor_head req verdict current_head evidence_file evidence_sha256
  ancestor_head="$(_commit c1)"
  current_head="$(_commit c2)"
  [ "$ancestor_head" != "$current_head" ]
  req="$(_seed_request verify-final "$ancestor_head")"
  evidence_file="$WAVE_DIR/evidence.txt"
  printf 'evidence bytes\n' > "$evidence_file"
  evidence_sha256="$(_real_sha256 "$evidence_file")"
  verdict="$(_seed_verdict verify-final approve "$ancestor_head" "$req" "[{\"kind\":\"opaque-file\",\"path\":\"evidence.txt\",\"sha256\":\"$evidence_sha256\"}]")"
  _run_cli "validate --path '$verdict' --expect-role arch-testing --expect-phase verify-final --expect-wave-slug '$WAVE_SLUG' --expect-plan-sha256 '$PLAN64' --expect-head '$current_head'"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"headBound":false'* ]]
  [[ "$output" == *'"authorizes":false'* ]]
}

# ── validate: usage / existence / mismatch ──────────────────────────────────────────

@test "RED validate: missing --path flag is a USAGE_ERROR, exit 2" {
  _run_cli "validate --expect-role arch-testing --expect-phase prep --expect-wave-slug '$WAVE_SLUG' --expect-plan-sha256 '$PLAN64' --expect-head '$(_hex 40 1)'"
  [ "$status" -eq 2 ]
  [[ "$output" == *'"status":"USAGE_ERROR"'* ]]
}

@test "RED validate: a nonexistent verdict file reports exists false, authorizes false, exit 0" {
  _run_cli "validate --path '$WAVE_DIR/arch-testing-verdict-prep.json' --expect-role arch-testing --expect-phase prep --expect-wave-slug '$WAVE_SLUG' --expect-plan-sha256 '$PLAN64' --expect-head '$(_hex 40 1)'"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"exists":false'* ]]
  [[ "$output" == *'"authorizes":false'* ]]
}

@test "RED validate: --expect-head naming an unrelated commit (not an ancestor) clears headBound for PREP" {
  local head other_head req verdict
  head="$(_commit c1)"
  req="$(_seed_request prep "$head")"
  verdict="$(_seed_verdict prep approve "$head" "$req")"
  git -C "$PROJ" checkout -q --orphan unrelated-branch 2>/dev/null
  other_head="$(_commit orphan-root)"
  _run_cli "validate --path '$verdict' --expect-role arch-testing --expect-phase prep --expect-wave-slug '$WAVE_SLUG' --expect-plan-sha256 '$PLAN64' --expect-head '$other_head'"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"headBound":false'* ]]
  [[ "$output" == *'"authorizes":false'* ]]
}

@test "RED validate: wrong --expect-role clears roleBound" {
  local head req verdict
  head="$(_commit c1)"
  req="$(_seed_request prep "$head")"
  verdict="$(_seed_verdict prep approve "$head" "$req")"
  _run_cli "validate --path '$verdict' --expect-role arch-platform --expect-phase prep --expect-wave-slug '$WAVE_SLUG' --expect-plan-sha256 '$PLAN64' --expect-head '$head'"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"roleBound":false'* ]]
  [[ "$output" == *'"authorizes":false'* ]]
}

# ── read-field ────────────────────────────────────────────────────────────────────

@test "RED read-field: rationale is readable from a well-formed verdict" {
  local head req verdict
  head="$(_commit c1)"
  req="$(_seed_request prep "$head")"
  verdict="$(_seed_verdict prep approve "$head" "$req")"
  _run_cli "read-field --path '$verdict' --field rationale"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"status":"OK"'* ]]
  [[ "$output" == *'reviewed'* ]]
}

@test "RED read-field: a malformed verdict file is rejected, exit 2" {
  local bad="$WAVE_DIR/arch-testing-verdict-prep.json"
  printf 'not json\n' > "$bad"
  _run_cli "read-field --path '$bad' --field rationale"
  [ "$status" -eq 2 ]
  [[ "$output" == *'"status":"REJECTED"'* ]]
}

# ── publish-record: canonicalization (PLAN.md sec 3.1 -- "JSON is pretty-printed with ──
# two spaces and a final newline") ────────────────────────────────────────────────────
#
# Empirically confirmed production bug: publishRecord() currently writes the caller's
# raw stdin bytes straight to disk instead of decoding then re-serializing through
# contract.serializeRecord(decoded.value) (which already exists and is already unit-
# tested in isolation -- it's just never wired into the actual write path). Both real
# producers (write-verdict.sh, write-verdict-request.sh) assemble JSON via python3
# `json.dump(..., separators=(",", ":"))` (compact, not pretty-printed) and, on this
# native-Windows machine, python3's default text-mode stdout additionally translates
# the trailing `\n` into `\r\n` -- so every real verdict/request artifact this wave has
# published so far is CRLF-corrupted. Confirmed directly: raw-byte inspection of this
# wave's own arch-platform-verdict-prep.json / arch-integration-verdict-prep.json /
# verdict-requests/*.json all end `...}\r\n` (0d0a), and store.cjs's own
# readConfinedFile (correct, already tested in isolation) rejects every one of them --
# running this CLI's own `validate` against arch-platform-verdict-prep.json reproduces
# {"exists":false,...,"authorizes":false,"reason":"exists"} on a file that is genuinely
# on disk and already architect-approved. These 4 cases prove the fix at the CLI layer,
# the single choke point both real producers and any future one flow through.

@test "RED publish-record: compact stdin JSON is canonicalized via contract.serializeRecord, not passed through raw" {
  local target="$WAVE_DIR/canon-target.json"
  local stdin_file="$PROJ/compact-input.json"
  printf '{"schema":"source-manifest/v1","files":["a.txt","b.txt"]}' > "$stdin_file"
  _run_cli_with_stdin "$stdin_file" "publish-record --path '$target'"
  [ "$status" -eq 0 ]
  [ -f "$target" ]
  node -e '
    const fs = require("fs");
    const contract = require(process.argv[2]);
    const onDisk = fs.readFileSync(process.argv[1]);
    const expected = contract.serializeRecord(JSON.parse(fs.readFileSync(process.argv[3], "utf8")));
    if (!onDisk.equals(expected)) {
      console.error("on-disk bytes do not match contract.serializeRecord output for the same logical object");
      console.error("on-disk: " + JSON.stringify(onDisk.toString("utf8")));
      console.error("expected: " + JSON.stringify(expected.toString("utf8")));
      process.exit(1);
    }
  ' "$target" "$BATS_TEST_DIRNAME/../lib/verdict-evidence-contract.cjs" "$stdin_file"
}

@test "RED publish-record: CRLF-terminated stdin (matches the real production bug byte-for-byte) is canonicalized to a clean single trailing LF, no CR anywhere" {
  local target="$WAVE_DIR/canon-crlf-target.json"
  local stdin_file="$PROJ/crlf-input.json"
  printf '{"schema":"source-manifest/v1","files":["a.txt"]}\r\n' > "$stdin_file"
  _run_cli_with_stdin "$stdin_file" "publish-record --path '$target'"
  [ "$status" -eq 0 ]
  [ -f "$target" ]
  node -e '
    const fs = require("fs");
    const buf = fs.readFileSync(process.argv[1]);
    if (buf.includes(0x0d)) { console.error("CR byte present on disk -- the real production bug, reproduced"); process.exit(1); }
    if (buf.length === 0 || buf[buf.length - 1] !== 0x0a || buf[buf.length - 2] === 0x0a) {
      console.error("target does not end with exactly one trailing LF"); process.exit(1);
    }
  ' "$target"
}

@test "RED publish-record + validate round-trip: a compact, CRLF-terminated verdict published via publish-record is fully authorizable afterward" {
  local head req req_sha256 verdict_target stdin_file
  head="$(_commit c1)"
  req="$(_seed_request prep "$head")"
  req_sha256="$(_real_sha256 "$req")"
  verdict_target="$WAVE_DIR/arch-testing-verdict-prep.json"
  stdin_file="$PROJ/compact-verdict-input.json"
  printf '{"schema":"verdict/v1","role":"arch-testing","wave_slug":"%s","phase":"prep","decision":"approve","rationale":"reviewed","evidence":[],"head":"%s","plan_sha256":"%s","in_reply_to":"%s","request_ref":{"path":"%s","sha256":"%s"},"created_at":"2026-09-21T00:00:00Z","supersedes":null}\r\n' \
    "$WAVE_SLUG" "$head" "$PLAN64" "$REQID32" "verdict-requests/$REQID32.json" "$req_sha256" > "$stdin_file"
  _run_cli_with_stdin "$stdin_file" "publish-record --kind verdict --path '$verdict_target'"
  [ "$status" -eq 0 ]
  # The published bytes themselves must already be clean (independent of validate below).
  node -e '
    const fs = require("fs");
    const buf = fs.readFileSync(process.argv[1]);
    if (buf.includes(0x0d)) { console.error("CR byte present in the published verdict"); process.exit(1); }
  ' "$verdict_target"
  _run_cli "validate --path '$verdict_target' --expect-role arch-testing --expect-phase prep --expect-wave-slug '$WAVE_SLUG' --expect-plan-sha256 '$PLAN64' --expect-head '$head'"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"exists":true'* ]]
  [[ "$output" == *'"authorizes":true'* ]]
}

@test "publish-record rejects a verdict written under a noncanonical filename" {
  local head req req_sha256 wrong_target stdin_file
  head="$(_commit c-wrong-name)"
  req="$(_seed_request prep "$head")"
  req_sha256="$(_real_sha256 "$req")"
  wrong_target="$WAVE_DIR/not-the-architect-verdict.json"
  stdin_file="$PROJ/wrong-name-verdict.json"
  printf '{"schema":"verdict/v1","role":"arch-testing","wave_slug":"%s","phase":"prep","decision":"approve","rationale":"reviewed","evidence":[],"head":"%s","plan_sha256":"%s","in_reply_to":"%s","request_ref":{"path":"%s","sha256":"%s"},"created_at":"2026-09-21T00:00:00Z","supersedes":null}\n' \
    "$WAVE_SLUG" "$head" "$PLAN64" "$REQID32" "verdict-requests/$REQID32.json" "$req_sha256" > "$stdin_file"
  _run_cli_with_stdin "$stdin_file" "publish-record --kind verdict --path '$wrong_target'"
  [ "$status" -eq 2 ]
  [[ "$output" == *'invalid-record:noncanonical-target'* ]]
  [ ! -e "$wrong_target" ]
}

@test "RED publish-record --supersede: CRLF-terminated stdin is ALSO canonicalized via the supersede call site, not just no-clobber" {
  local target="$WAVE_DIR/canon-supersede-target.json"
  local stdin_file1="$PROJ/supersede-input-1.json"
  local stdin_file2="$PROJ/supersede-input-2.json"
  printf '{"schema":"source-manifest/v1","files":["a.txt"]}\r\n' > "$stdin_file1"
  _run_cli_with_stdin "$stdin_file1" "publish-record --path '$target'"
  [ "$status" -eq 0 ]
  local current_sha256
  current_sha256="$(_real_sha256 "$target")"
  printf '{"schema":"source-manifest/v1","files":["a.txt","b.txt"]}\r\n' > "$stdin_file2"
  _run_cli_with_stdin "$stdin_file2" "publish-record --path '$target' --supersede --expected-current-sha256 '$current_sha256'"
  [ "$status" -eq 0 ]
  node -e '
    const fs = require("fs");
    const buf = fs.readFileSync(process.argv[1]);
    if (buf.includes(0x0d)) { console.error("CR byte present after supersede -- the production bug, reproduced on the supersede call site"); process.exit(1); }
    if (buf.length === 0 || buf[buf.length - 1] !== 0x0a || buf[buf.length - 2] === 0x0a) {
      console.error("target does not end with exactly one trailing LF after supersede"); process.exit(1);
    }
  ' "$target"
}
