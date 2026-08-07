#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# WP2 macOS STRUCTURAL parity leg for the SH/PS1 runtime-consultation wrappers,
# Wave 1 (portable-runtime-messaging-adapters). Grounded in PLAN.md's "PS1 / SC-17
# (Option 2)" section (~L1555-1567), the Windows W01-W12 crosswalk (~L1490-1508),
# and the Frozen Production CLI ABI wrapper note ("Both wrappers are byte-for-byte
# argv forwarders to `node scripts/lib/runtime-consultation.cjs`", ~L750-755).
#
# SCOPE (single-owner, this task's dispatch): on THIS macOS host, WITHOUT a live
# pwsh, this file proves:
#   (a) scripts/sh/runtime-consultation.sh exists and is a thin argv->node
#       forwarder with zero embedded protocol/schema/security logic;
#   (b) scripts/ps1/runtime-consultation.ps1 is at minimum STRUCTURALLY the same
#       shape (file exists, references the node core, no embedded schema logic)
#       -- a static text check that needs no pwsh interpreter;
#   (c) W01 (paths-with-spaces), W03 (exactly one JSON object + trailing LF on
#       stdout), and W04 (stderr never a bare JSON object) hold when driven
#       THROUGH the .sh wrapper instead of `node` directly;
#   (d) W08 (Node/SH/PS1 equivalence): the same fixture invocation run via
#       `node` directly and via the `.sh` wrapper, both under the CLI's
#       `--fixed-ids --fixed-clock` test-capability mode, produce BYTE-IDENTICAL
#       `coordination/cli-result/v1` stdout -- proving the wrapper is a pure
#       forwarder, never a raw byte-diff of live-generated random output.
#
# This file deliberately never invokes `pwsh` (absent on this host), so it is
# NOT and can never BE Windows conformance evidence. The real W01-W12 EXECUTABLE
# leg is `scripts/tests/runtime-consultation-windows.ps1` (a separate file, not
# owned by this dispatch), run by the `windows-latest` CI job wired through
# `.github/workflows/runtime-consultation-windows.yml` (PLAN.md ~L1555-1567).
# SC-17 = PENDING_CI and closes ONLY when that job passes at final PR HEAD --
# this file's own green/red status never substitutes for it.
#
# STATUS (current, exact -- verify with `bats --count` rather than trusting
# this comment): both scripts/sh/runtime-consultation.sh and scripts/ps1/
# runtime-consultation.ps1 are now implemented; this file's original RED-by-
# design status (neither wrapper existed yet) is history, not current state --
# see git log, not this comment, for when they landed. 9 of this file's cases
# remain `skip`'d (not RED) -- 3 deferred beyond this dispatch's own scope, 6
# requiring windows-latest CI (SC-17, PENDING_CI, unaffected by this file's own
# green status per the SCOPE note above).
#
# W0x -> @test crosswalk (PLAN.md ~L1490-1508). The PLAN's own Test column says
# "same" for W02/W05/W06, meaning this bats file is a nominal co-owner alongside
# the .ps1 Windows leg -- but THIS dispatch's own "what to cover" narrows actual
# scope to W01/W03/W04/W08 now. W02/W05/W06 are therefore explicit, NOT-pwsh-
# blocked deferrals (a future task can add them directly against the .sh wrapper
# with no Windows host needed) -- distinct from W07/W09-W12, which genuinely
# require a live pwsh and are Windows-CI-only:
#   W01  implemented (via .sh)             W02  skip (deferred, not pwsh-blocked)
#   W03  implemented (via .sh)             W04  implemented (via .sh)
#   W05  skip (deferred, not pwsh-blocked) W06  skip (deferred, not pwsh-blocked)
#   W07  skip (pwsh-only)                  W08  implemented (node vs .sh equivalence)
#   W09  skip (pwsh-only)                  W10a skip (pwsh-only)
#   W10b skip (pwsh-only)                  W11  skip (pwsh-only)
#   W12  skip (pwsh-only)
#
# UPDATE (this cycle): the "known upstream gap" this section originally
# documented is RESOLVED. `--fixed-ids`/`--fixed-clock` are now genuinely wired
# in scripts/lib/runtime-consultation.cjs: under `--fixed-ids`, `genId()`
# returns a deterministic per-process zero-padded 32-char hex counter
# (confirmed empirically -- the first schema-visible mint, `request_id`, is
# exactly `'0'.repeat(32)`; `publishNoClobber`'s own internal temp-file-name
# nonces pass `{raw: true}`, which always draws real crypto randomness and
# never consumes a counter slot); under `--fixed-clock`, `nowIso()`/
# `currentClockMs()` return the frozen base `2025-01-01T00:00:00.000Z`
# (overridable via RUNTIME_CONSULTATION_FAKE_CLOCK), never real wall-clock
# time. W08 below has therefore been broadened from `root-init` (which never
# calls genId()/nowIso() at all -- zero real determinism coverage, as this
# note previously flagged) to `publish-request`, a genuinely request-scoped
# verb that exercises both. This is safe against the no-clobber primitive:
# `cmdPublishRequest`'s own `materializePlanRef`/`materializeRoutingPolicy`/
# `materializeSubjectBundle`/final-request-write calls all pass
# `{allowIdenticalIdempotent: true}` to `publishNoClobber`, so two invocations
# sharing the identical plan-root, intent, and frozen ids/clock produce
# byte-identical request content -- the SECOND invocation (via the .sh
# wrapper) republishes idempotently rather than losing a no-clobber race. That
# is exactly the property W08 needs: two independent entrypoints, identical
# fixed inputs, byte-identical output.
#
# Invocation: bats scripts/tests/runtime-consultation-windows.bats (from repo
# root), or scripts/sh/run-bats.sh --project-root "$(pwd)"
# scripts/tests/runtime-consultation-windows.bats

IMPL="$BATS_TEST_DIRNAME/../lib/runtime-consultation.cjs"
SH_WRAPPER="$BATS_TEST_DIRNAME/../sh/runtime-consultation.sh"
PS1_WRAPPER="$BATS_TEST_DIRNAME/../ps1/runtime-consultation.ps1"
# "Harness-created" test capability (PLAN.md ~L752-753, ~L796) -- same idiom as
# runtime-consultation-cli.bats's own TEST_CAPABILITY constant, distinct value
# so suite-of-origin is obvious in any shared log output.
TEST_CAPABILITY="bats-runtime-consultation-windows-fixture-capability"

setup() {
  PROJ="$(mktemp -d)"
  # WP3 root-confinement (RCR-confine-*, runtime-consultation-roots.bats) requires
  # `--coordination-root` to resolve inside a real git worktree -- mirrors
  # runtime-consultation-roots.bats's own setup() so this file's root-init/
  # root-validate fixtures reflect realistic usage, not an artifact of never
  # having exercised the confinement check before it existed.
  git -C "$PROJ" init -q 2>/dev/null
  git -C "$PROJ" config user.email "bats@test.local"
  git -C "$PROJ" config user.name "Bats Test"
  git -C "$PROJ" commit -q --allow-empty -m init 2>/dev/null
}

teardown() {
  chmod -R u+rwx "$PROJ" 2>/dev/null || true
  rm -rf "$PROJ"
}

# ── CLI invocation helpers (same idiom as runtime-consultation-cli.bats) ────

_run_node() {
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" "$@"
}

_run_sh() {
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    bash "$SH_WRAPPER" "$@"
}

# Parses $output (most recent `run`) as the frozen coordination/cli-result/v1
# envelope (PLAN.md ~L779-781) -- verbatim copy of runtime-consultation-cli.bats's
# own _assert_cli_result, reused here for consistency across the two suites.
_assert_cli_result() {
  local expected_status="$1" expected_detail="$2"
  node -e '
    let data;
    try {
      data = JSON.parse(process.argv[1]);
    } catch (err) {
      console.error("stdout is not valid JSON: " + err.message);
      process.exit(1);
    }
    const expectedStatus = process.argv[2];
    const expectedDetail = process.argv[3];
    const allowedKeys = ["schema","command","ok","status","code","request_id","artifact_ref","detail_code","content_ref","activation_action"];
    const keys = Object.keys(data);
    const extra = keys.filter((k) => !allowedKeys.includes(k));
    const missing = allowedKeys.filter((k) => !keys.includes(k));
    if (extra.length) { console.error("unexpected extra keys: " + extra.join(",")); process.exit(1); }
    if (missing.length) { console.error("missing required keys: " + missing.join(",")); process.exit(1); }
    if (data.schema !== "coordination/cli-result/v1") { console.error("wrong schema: " + data.schema); process.exit(1); }
    if (data.status !== expectedStatus) { console.error("expected status " + expectedStatus + " got " + data.status); process.exit(1); }
    if (expectedDetail && data.detail_code !== expectedDetail) { console.error("expected detail_code " + expectedDetail + " got " + data.detail_code); process.exit(1); }
    if (typeof data.ok !== "boolean") { console.error("ok is not boolean"); process.exit(1); }
    if ((data.status === "SUCCESS") !== data.ok) { console.error("ok/status inconsistent"); process.exit(1); }
  ' "$output" "$expected_status" "$expected_detail"
}

# Asserts $output is exactly one JSON object plus a trailing newline -- no
# prose/second line/BOM (Frozen CLI ABI, PLAN.md ~L779; W03). Verbatim copy of
# runtime-consultation-cli.bats's own helper.
_assert_stdout_single_json_line() {
  local line_count; line_count="$(printf '%s\n' "$output" | wc -l | tr -d ' ')"
  [ "$line_count" -eq 1 ]
  local first_bytes; first_bytes="$(printf '%s' "$output" | head -c3 | od -An -tx1 | tr -d ' \n')"
  [ "$first_bytes" != "efbbbf" ]
}

# Asserts $stderr (most recent `run --separate-stderr`) never carries a bare
# JSON object (PLAN.md ~L779; W04). Verbatim copy of runtime-consultation-cli.bats's
# own helper.
_assert_stderr_no_json() {
  if [ -z "$stderr" ]; then
    return 0
  fi
  node -e '
    try {
      JSON.parse(process.argv[1]);
      console.error("stderr parsed as JSON -- must be diagnostics only");
      process.exit(1);
    } catch (err) {
      process.exit(0);
    }
  ' "$stderr"
}

# ══════════════════════════════════════════════════════════════════════════
# Wrapper presence + shape -- prerequisite for every W0x case below
# ══════════════════════════════════════════════════════════════════════════

@test "STRUCTURE-01 scripts/sh/runtime-consultation.sh exists as a regular file" {
  [ -f "$SH_WRAPPER" ]
}

@test "STRUCTURE-02 scripts/sh/runtime-consultation.sh is a thin argv->node forwarder with zero embedded protocol/schema logic" {
  [ -f "$SH_WRAPPER" ]

  run grep -Fq 'runtime-consultation.cjs' "$SH_WRAPPER"
  [ "$status" -eq 0 ]
  # "$@" is the standard/expected forwarding idiom, not the ONLY valid one --
  # a false RED here (once the wrapper lands) would be a reasonable heuristic
  # miss, not a contract violation; the behavioral W01/W08 cases below are the
  # authoritative forwarding proof.
  run grep -Fq '"$@"' "$SH_WRAPPER"
  [ "$status" -eq 0 ]

  # A thin forwarder never needs to know these frozen record/envelope schema
  # literals itself (Frozen CLI ABI wrapper note, PLAN.md ~L750: "zero
  # protocol/state logic in either wrapper").
  run grep -Fq 'coordination/consult/v2' "$SH_WRAPPER"
  [ "$status" -ne 0 ]
  run grep -Fq 'coordination/result/v2' "$SH_WRAPPER"
  [ "$status" -ne 0 ]
  run grep -Fq 'coordination/cli-result/v1' "$SH_WRAPPER"
  [ "$status" -ne 0 ]
  run grep -Fq 'coordination/activation/v1' "$SH_WRAPPER"
  [ "$status" -ne 0 ]
}

@test "STRUCTURE-03 scripts/ps1/runtime-consultation.ps1 exists as a regular file (structural only, no pwsh)" {
  [ -f "$PS1_WRAPPER" ]
}

@test "STRUCTURE-04 scripts/ps1/runtime-consultation.ps1 references the node core with zero embedded protocol/schema logic (static text check, no pwsh)" {
  [ -f "$PS1_WRAPPER" ]

  run grep -Fq 'runtime-consultation.cjs' "$PS1_WRAPPER"
  [ "$status" -eq 0 ]

  run grep -Fq 'coordination/consult/v2' "$PS1_WRAPPER"
  [ "$status" -ne 0 ]
  run grep -Fq 'coordination/result/v2' "$PS1_WRAPPER"
  [ "$status" -ne 0 ]
  run grep -Fq 'coordination/cli-result/v1' "$PS1_WRAPPER"
  [ "$status" -ne 0 ]
  run grep -Fq 'coordination/activation/v1' "$PS1_WRAPPER"
  [ "$status" -ne 0 ]
}

# ══════════════════════════════════════════════════════════════════════════
# W01 argv & paths-with-spaces (PLAN.md ~L1496) -- via the .sh wrapper
# ══════════════════════════════════════════════════════════════════════════

@test "W01 sh wrapper: root-init then root-validate succeed against a --coordination-root path containing spaces" {
  local root_with_spaces="$PROJ/coordination root with spaces"

  _run_sh root-init --coordination-root "$root_with_spaces"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  _assert_stdout_single_json_line
  _assert_stderr_no_json

  [ -d "$root_with_spaces" ]

  _run_sh root-validate --coordination-root "$root_with_spaces"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  _assert_stdout_single_json_line
  _assert_stderr_no_json
}

@test "W02 sh wrapper: UTF-8 + JSON-quote/backslash question round-trips byte-exact through base64url --intent" {
  skip "deferred beyond this dispatch's explicit W01/W03/W04/W08 scope (PLAN.md ~L1490-1508 crosswalk) -- NOT pwsh-blocked, exercisable directly against scripts/sh/runtime-consultation.sh once authorized"
}

# ══════════════════════════════════════════════════════════════════════════
# W03 exactly one JSON object + trailing LF on stdout (PLAN.md ~L1498) -- .sh
# ══════════════════════════════════════════════════════════════════════════

@test "W03 sh wrapper: root-init prints exactly one JSON object plus one trailing LF on stdout, no prose/second-line/BOM" {
  local fresh_root="$PROJ/coordination-w03"

  _run_sh root-init --coordination-root "$fresh_root"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  _assert_stdout_single_json_line
  _assert_stderr_no_json
}

# ══════════════════════════════════════════════════════════════════════════
# W04 diagnostics only on stderr -- never a bare JSON object (PLAN.md ~L1499)
# ══════════════════════════════════════════════════════════════════════════

@test "W04 sh wrapper: an error path (unknown subcommand) never emits a bare JSON object on stderr" {
  _run_sh totally-not-a-real-subcommand-xyz
  [ "$status" -eq 2 ]
  _assert_cli_result "USAGE_ERROR" "UNKNOWN_COMMAND"
  _assert_stdout_single_json_line
  _assert_stderr_no_json
}

@test "W05 sh wrapper: an unknown subcommand yields a nonzero exit code" {
  skip "deferred beyond this dispatch's explicit W01/W03/W04/W08 scope (PLAN.md ~L1490-1508 crosswalk) -- NOT pwsh-blocked, exercisable directly against scripts/sh/runtime-consultation.sh once authorized"
}

@test "W06 sh wrapper: success/validation-error/timeout/unknown-subcommand exit codes are pairwise distinct" {
  skip "deferred beyond this dispatch's explicit W01/W03/W04/W08 scope (PLAN.md ~L1490-1508 crosswalk) -- NOT pwsh-blocked, exercisable directly against scripts/sh/runtime-consultation.sh once authorized"
}

@test "W07 ps1 wrapper: same-worktree E2E round trip (+ W07b deterministic app-server/mcp rendezvous)" {
  skip "requires windows-latest CI (runtime-consultation-windows.ps1) -- live pwsh E2E publish->claim->result->accept round trip plus deterministic backend rendezvous, not reproducible on this macOS host"
}

# ══════════════════════════════════════════════════════════════════════════
# W08 Node/SH equivalence (PLAN.md ~L1503) -- broadened this cycle from
# `root-init` to `publish-request`, a genuinely request-scoped verb that
# exercises both genId() and nowIso() (root-init calls neither -- zero real
# determinism coverage, see this file's header "UPDATE" note). --fixed-ids
# --fixed-clock make the invocation deterministic BY CONSTRUCTION, so a raw
# byte-diff of stdout across entrypoints is meaningful (no normalization
# fallback needed).
# ══════════════════════════════════════════════════════════════════════════

@test "W08 node vs sh wrapper equivalence: publish-request --fixed-ids --fixed-clock produces byte-identical cli-result/v1 stdout via both entrypoints" {
  # Self-contained git-backed fixture -- this file's own setup() intentionally
  # stays minimal for the other cases above (root-init/root-validate need no
  # git identity at all). publish-request's own computeRepoId/
  # computeWorktreeId/computeSubjectHead all shell out to
  # `git -C <coordination-root> rev-parse ...`, so $PROJ must itself be a git
  # working tree with at least one commit.
  git -C "$PROJ" init -q
  git -C "$PROJ" config user.email "bats-w08@test.local"
  git -C "$PROJ" config user.name "Bats W08"
  git -C "$PROJ" commit -q --allow-empty -m init

  # publish-request's computeRepoId/computeWorktreeId shell out to
  # `git -C <coordination-root> ...` BEFORE cmdPublishRequest's own
  # mkdirSync(planRoot) call -- `git -C` requires the directory to already
  # exist (it just chdirs there; it need not itself be a git repo root), so
  # the coordination-root must be pre-created here, unlike the plain
  # root-init/root-validate cases above which create it themselves.
  local shared_root="$PROJ/coordination-w08-request"
  mkdir -p "$shared_root"
  local wave_dir="$PROJ/.planning/wave-w08-request-wave"
  mkdir -p "$wave_dir"
  local plan_file="$wave_dir/PLAN.md"
  printf '# Fixture PLAN for runtime-consultation-windows.bats W08\n' > "$plan_file"

  local subject_bundle_file="$PROJ/.planning/coordination-subject-bundle-manifest.json"
  mkdir -p "$(dirname "$subject_bundle_file")"
  printf '{"schema":"coordination/subject-bundle-manifest/v1","entries":[]}' > "$subject_bundle_file"

  # Frozen-base-relative expiry (this file's header "UPDATE" note): created_at
  # is genuinely frozen to 2025-01-01T00:00:00.000Z under --fixed-clock, so
  # expiry must be computed relative to THAT base, via node -- never real
  # wall-clock `date` (sidesteps the documented BSD-date fallback bug, see
  # runtime-consultation-cli.test.js's own header note).
  local expiry; expiry="$(node -e 'process.stdout.write(new Date(Date.parse("2025-01-01T00:00:00.000Z") + 1800000).toISOString())')"
  local intent; intent="$(printf '{"target_role":"arch-testing","question":"W08 node-vs-sh publish-request fixture question","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$expiry")"
  local intent_b64; intent_b64="$(printf '%s' "$intent" | node -e 'process.stdout.write(Buffer.from(require("fs").readFileSync(0)).toString("base64url"))')"

  _run_node publish-request --coordination-root "$shared_root" --plan "$plan_file" \
    --subject-bundle "$subject_bundle_file" --intent "$intent_b64" --fixed-ids --fixed-clock
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  local node_output="$output"

  # Same exact argv against the SAME plan-root: --fixed-ids resets its counter
  # to 0 in this fresh process too, so this second (sh-wrapper) invocation
  # mints the IDENTICAL request_id/created_at/expiry as the node call above --
  # producing byte-identical request content that republishes idempotently
  # (allowIdenticalIdempotent:true) rather than losing the no-clobber race.
  _run_sh publish-request --coordination-root "$shared_root" --plan "$plan_file" \
    --subject-bundle "$subject_bundle_file" --intent "$intent_b64" --fixed-ids --fixed-clock
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  local sh_output="$output"

  [ "$node_output" = "$sh_output" ]
}

@test "W09 ps1 wrapper: root/registry owner-confined ACL contains only the frozen allowlisted SIDs" {
  skip "requires windows-latest CI (runtime-consultation-windows.ps1) -- Get-Acl/SID probe is Windows-only; runtime-consultation-roots.bats covers POSIX filesystem confinement instead"
}

@test "W10a ps1 wrapper: a readable-but-insecure world-SID ACL is rejected fail-closed" {
  skip "requires windows-latest CI (runtime-consultation-windows.ps1) -- deterministic construction via icacls */S-1-1-0:(OI)(CI)F is Windows-only"
}

@test "W10b ps1 wrapper: an unverifiable/indeterminate ACL disables sibling shared-root mode fail-closed" {
  skip "requires windows-latest CI (runtime-consultation-windows.ps1) -- RUNTIME_CONSULTATION_ACL_PROBE=unverifiable seam is exercised on the Windows leg"
}

@test "W11 ps1 wrapper: two independent processes race .lock/ and exactly one acquires, no age-reclaim" {
  skip "requires windows-latest CI (runtime-consultation-windows.ps1) -- SC-9 multiprocess transition-lock evidence is captured on the Windows leg"
}

@test "W12 ps1 wrapper: two processes race the no-clobber primitive and exactly one wins, whole winner durable" {
  skip "requires windows-latest CI (runtime-consultation-windows.ps1) -- CreateHardLinkW + both durability boundaries are Windows-specific, SC-9/17"
}
