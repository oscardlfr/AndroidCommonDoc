#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# M7 completeness FINAL PASS (2026-08-09, RED phase only, dispatch
# team-lead-20260809-final-completeness): PRE-FIX STATE this pass started
# from (superseded -- see "Part C follow-up" below for the current, fully-
# wired state): `claude-one-shot-binding/v1` (PLAN.md §15d, ~L612-614) had
# ZERO implementation anywhere in scripts/ (confirmed at the time: no
# occurrence of the schema literal "runtime/claude-one-shot-binding/v1", nor
# of a create/validate function pair following this codebase's own strict,
# universal naming convention for every OTHER binding type --
# createRequesterBinding/validateRequesterBindingFor,
# createRoleActorBinding/validateRoleActorBindingFor,
# createMainOrchestratorBinding -- existed for this one). PLAN.md ~L614 names
# `subagent-start-context-bundle.js` as the owning hook: "correlates that
# exact spawn action to one observed {session_id,agent_id,agent_type}...
# and creates exactly {schema:"runtime/claude-one-shot-binding/v1",...}".
# Direct read of that hook (2026-08-09) confirmed it THEN implemented ONLY
# the role-LIFECYCLE (ensure/ready, persistent RoleActorBinding) spawn-
# confirmation path -- it had no code path recognizing a consultation/
# dispatch-originated one-shot claude-agent spawn at all, and its own
# best-case (B2 CONFIRMED) branch created only a `runtime/role-actor-binding/v1`
# record, never `runtime/claude-one-shot-binding/v1`.
#
# Per PLAN.md ~L614: "The target gate may grant only current
# claim|lease-heartbeat|publish-result|worker-stop-ack" through this
# binding -- without it, a claude-agent-driven one-shot consultation target
# has no issuer for those target grants at all, i.e. claude-agent is
# UNAVAILABLE for the consultation target surface today, by construction
# (mirrors the ALREADY-established "no issuer -> unavailable before
# activation" pattern PLAN.md's own Claude-target paragraph, ~L606, states
# for runtime-spawn/noop).
#
# RED-test polarity (corrected, 2026-08-09; pre-fix rationale, kept for
# record): each test below was written to assert the DESIRED, PLAN-mandated
# end state directly (the binding primitive exists; a one-shot spawn
# genuinely gets one) -- which was false pre-fix, so every test in this file
# failed at the time and was expected to start passing once the primitive
# landed (it has -- see COSB-MISSING-CREATE/VALIDATE/SCHEMA-LITERAL above,
# all conformance-passing now). This was deliberately the OPPOSITE polarity
# from a "confirms absence" probe (which would have passed pre-fix and would
# not have been a RED test in the TDD sense this pass's dispatch asked for)
# -- mirrors this codebase's own "propose the minimal interface, then build
# it" precedent (context-provider-gate.test.js's own LG1 header comment)
# rather than runtime-consultation-roots.bats's Group K SKIP-gate idiom
# (which is a different tool, for a different purpose: gating tests that
# would otherwise vacuously run once a capability lands, not itself serving
# as the RED assertion).
#
# Current acceptance boundary: one-shot authority is created only after an
# observed SubagentStart correlates to the exact pre-committed ActivationAction
# and reservation. A bare SubagentStart is therefore an explicit negative
# control: it must remain non-owning and create no one-shot binding. The tests
# below cover both that negative and the real correlated round-trip path.
#
# ══════════════════════════════════════════════════════════════════════════
# Part C follow-up (2026-08-09, task #26 hook-wiring implementation, task #27
# this file's own test-specialist confirmation): the correlation/consumption/
# retirement chain PLAN.md §15d describes is now fully wired end to end --
# agent-spawn-execution-gate.js (PreToolUse) mints a ClaudeAgentSpawnReservation/v1
# for a genuine, pre-committed claude-agent ActivationAction;
# subagent-start-context-bundle.js (SubagentStart) correlates the observed
# {session_id,agent_id,agent_type} against that exact reservation before
# calling createClaudeOneShotBinding; the same file's SubagentStop handler
# retires the binding on Agent return; runtime-consultation-target-gate.js
# grants claim|lease-heartbeat|publish-result|worker-stop-ack only through a
# live, scope-matched binding; runtime-consultation.cjs's main() retires the
# binding on terminal-result and on cancellation; expiry is enforced by
# validateClaudeOneShotBindingFor itself. The "Point 7 completeness pass"
# section below has been updated accordingly: several items that were
# disclosed skips during the M7 completeness pass (2026-08-09, task #24,
# before this wiring existed) are now genuine, real tests driving the actual
# production hooks end to end -- never a reimplementation of hook logic, the
# same "drive production code directly, construct only the PRE-CONDITION
# fixture via real primitives" convention subagent-start-context-bundle.bats's
# own M7-RB2-CONFIRM/M7-B2-ACTORBINDING tests already established. One item
# (wrong session_id/agent_id specifically) remains genuinely disclosed --
# see COSB-POINT7-DISCLOSED-SESSION-AGENT-IDENTITY's own reason for why, a
# finding reported to arch-testing/team-lead, not silently worked around.
#
# PRODUCTION REALITY the E2E fixture below must work around (disclosed, not
# hidden -- cited identically in runtime-consultation.cjs's own
# findLiveClaudeAgentActivations doc comment and runtime-role-lifecycle.cjs's
# own ClaudeAgentSpawnReservation/v1 section header): cmdDispatch's own driver
# selection is unconditionally 'noop' -- no production code path ever
# produces an `activation/v1` record with `selected_driver:'claude-agent'`
# today (WP3 routing/driver-selection is a separate, not-yet-built layer).
# The E2E fixture therefore hand-constructs one directly (same schema, same
# publishNoClobber primitive cmdDispatch itself uses, at the exact path a
# real dispatch would have used) rather than reaching it through `dispatch`
# -- the ONLY way to reach `selected_driver:'claude-agent'` in this codebase
# today, mirrored exactly by this pass's own agent-spawn-execution-gate.js
# (whose own findOwningClaudeAgentActivationCandidates has the identical
# "production always returns []" disclosure).
# ══════════════════════════════════════════════════════════════════════════
#
# Invocation: bats scripts/tests/claude-one-shot-binding-red.bats (from repo root)

RLL_IMPL="$BATS_TEST_DIRNAME/../lib/runtime-role-lifecycle.cjs"
RC_IMPL="$BATS_TEST_DIRNAME/../lib/runtime-consultation.cjs"
HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/subagent-start-context-bundle.js"
# HARD NO-GO correction (2026-08-15): moved up from its own former spot
# (immediately before the COSB-CAPABILITY-* section) so the RESERVATION-STEAL
# test below can drive the real PreToolUse gate too -- bats sources this
# whole file top-to-bottom before invoking any single @test, so the OLD
# position was never a functional requirement, only a readability one; kept
# here now since two disjoint test groups need it.
RESERVATION_HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/agent-spawn-execution-gate.js"

_assert_isolated_runtime_tmp() {
  local dir="$1"
  local real_dir real_bats
  real_dir="$(cd "$dir" 2>/dev/null && pwd -P)" || return 1
  real_bats="$(cd "$BATS_TEST_TMPDIR" && pwd -P)" || return 1
  case "$real_dir" in
    "$real_bats"|"$real_bats"/*) ;;
    *) echo "# runtime-tmp escaped BATS_TEST_TMPDIR: $real_dir not under $real_bats" >&2; return 1 ;;
  esac
  node -e '
    const fs = require("fs");
    let st;
    try { st = fs.lstatSync(process.argv[1]); } catch (err) { console.error("runtime-tmp stat failed: " + err.message); process.exit(1); }
    if (st.isSymbolicLink()) { console.error("runtime-tmp is a symlink"); process.exit(1); }
    if (!st.isDirectory()) { console.error("runtime-tmp is not a directory"); process.exit(1); }
    if ((st.mode & 0o777) !== 0o700) { console.error("runtime-tmp wrong mode: " + (st.mode & 0o777).toString(8)); process.exit(1); }
    if (typeof process.getuid === "function" && st.uid !== process.getuid()) { console.error("runtime-tmp wrong owner"); process.exit(1); }
  ' "$dir"
}

# M6+M7 Bats registry isolation: this file has no pre-existing global setup()/
# teardown() -- every @test mints its own fixture project via
# _cosb_make_project/_cosb_e2e_make_project (or a raw mktemp -d for the
# COSB-CAPABILITY-* tests). Exporting TMPDIR here, before any test body runs,
# isolates registryBaseDir() (runtime-role-lifecycle.cjs) under bats' own
# per-test tmpdir for every one of those helpers transparently, without
# touching any of them.
setup() {
  RUNTIME_TMP="$BATS_TEST_TMPDIR/runtime-tmp"
  mkdir -p "$RUNTIME_TMP"
  chmod 0700 "$RUNTIME_TMP"
  _assert_isolated_runtime_tmp "$RUNTIME_TMP"
  export TMPDIR="$RUNTIME_TMP"
}

teardown() {
  # M7 FINAL REMEDIATION Part A correction (sequence 3, ONE-01): if an A
  # OneShot test's own body aborted on a failed assertion AFTER the
  # rendezvous child reached .ready but BEFORE it released/reaped it, this
  # state file (written immediately after fork, cleared on the test's own
  # normal completion path) is still present -- safely publish .go if
  # absent, wait the exact child, then remove the rendezvous directory, so
  # no paused child or rendezvous residue ever survives a mid-test failure.
  local _pending_state="${BATS_TEST_TMPDIR}/oneshot-pending-child"
  if [ -f "$_pending_state" ]; then
    local _pid _go_path _rendezvous_dir
    read -r _pid _go_path _rendezvous_dir < "$_pending_state"
    if [ -n "$_go_path" ] && [ ! -e "$_go_path" ]; then
      node -e '
        const fs = require("fs");
        try { fs.writeFileSync(process.argv[1], Buffer.from("go\n", "utf8"), { mode: 0o600, flag: "wx" }); } catch { /* already released or vanished -- best effort */ }
      ' "$_go_path" 2>/dev/null || true
    fi
    if [ -n "$_pid" ]; then
      # Bounded poll-then-kill, never an unbounded wait: covers BOTH "child
      # genuinely paused at the rendezvous" (releasing .go above lets it
      # finish well under testM7Rendezvous's own 5000ms internal bound) AND
      # "child never reached the rendezvous at all, hung elsewhere" (.go is
      # irrelevant there, so force-kill after the bound instead of hanging
      # teardown itself indefinitely).
      local _waited_ms=0
      while kill -0 "$_pid" 2>/dev/null; do
        sleep 0.1
        _waited_ms=$((_waited_ms + 100))
        if [ "$_waited_ms" -ge 6000 ]; then
          kill "$_pid" 2>/dev/null || true
          break
        fi
      done
      wait "$_pid" 2>/dev/null || true
    fi
    rm -f "$_pending_state"
    [ -n "$_rendezvous_dir" ] && rm -rf "$_rendezvous_dir" 2>/dev/null || true
  fi
  if [ -n "$RUNTIME_TMP" ] && _assert_isolated_runtime_tmp "$RUNTIME_TMP" >/dev/null 2>&1; then
    # M6+M7 SIXTEENTH Phase 2B follow-up: some fixtures materialize a
    # deliberately read-only projection under here (e.g. a role-read-view,
    # part of the production isolation model's own security posture) --
    # restore owner write+traverse on every path THIS test created before
    # sweeping, or a bare rm -rf leaves permission-denied debris behind
    # (which then also makes bats' own outer per-test tmpdir cleanup fail
    # non-silently).
    chmod -R u+rwX "$RUNTIME_TMP" 2>/dev/null || true
    rm -rf "$RUNTIME_TMP"
  fi
}

@test "COSB-MISSING-CREATE: runtime-role-lifecycle.cjs exports createClaudeOneShotBinding -- the PLAN.md §15d ~L614 binding-mint primitive (mirrors this codebase's own universal create<Type>/validate<Type>For naming convention for every OTHER binding: createRequesterBinding, createRoleActorBinding, createMainOrchestratorBinding). Pre-fix, this export did not exist at all. Do NOT retarget this test at an existing function, and do NOT satisfy it with a stub that does not genuinely mint a runtime/claude-one-shot-binding/v1 record." {
  run node -e '
    const rll = require(process.argv[1]);
    process.exit(typeof rll.createClaudeOneShotBinding === "function" ? 0 : 1);
  ' "$RLL_IMPL"
  [ "$status" -eq 0 ]
}

@test "COSB-MISSING-VALIDATE: runtime-role-lifecycle.cjs exports validateClaudeOneShotBindingFor -- the matching validator half of the same primitive. Same conformance discipline as COSB-MISSING-CREATE." {
  run node -e '
    const rll = require(process.argv[1]);
    process.exit(typeof rll.validateClaudeOneShotBindingFor === "function" ? 0 : 1);
  ' "$RLL_IMPL"
  [ "$status" -eq 0 ]
}

@test "COSB-MISSING-SCHEMA-LITERAL: either runtime-role-lifecycle.cjs or runtime-consultation.cjs contains the literal schema string 'runtime/claude-one-shot-binding/v1' -- confirms the schema itself, not merely a conveniently-named constructor pair, lands (a differently-named implementation using the correct literal schema would still satisfy THIS check, so it does not silently miss a same-behavior/different-name landing). Pre-fix, neither file contained this literal anywhere." {
  run node -e '
    const fs = require("fs");
    const needle = "runtime/claude-one-shot-binding/v1";
    const files = [process.argv[1], process.argv[2]];
    let found = false;
    for (const f of files) {
      if (fs.readFileSync(f, "utf8").includes(needle)) { found = true; break; }
    }
    process.exit(found ? 0 : 1);
  ' "$RLL_IMPL" "$RC_IMPL"
  [ "$status" -eq 0 ]
}

@test "COSB-HOOK-BARE-SUBAGENTSTART-NONOWNING: a bare SubagentStart without an exact committed action/reservation creates no one-shot authority" {
  local proj; proj="$(_cosb_e2e_make_project)"
  local before after
  before="$(node -e '
    const fs = require("fs");
    const path = require("path");
    const rll = require(process.argv[1]);
    const dir = path.join(rll.registryRepoDir(process.argv[2]), "claude-one-shot-bindings");
    const count = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith(".json")).length : 0;
    process.stdout.write(String(count));
  ' "$RLL_IMPL" "$proj")"

  run _cosb_e2e_subagent_start "$proj" "arch-testing" "cosb-bare-session" "cosb-bare-agent"
  [ "$status" -eq 0 ]

  after="$(node -e '
    const fs = require("fs");
    const path = require("path");
    const rll = require(process.argv[1]);
    const dir = path.join(rll.registryRepoDir(process.argv[2]), "claude-one-shot-bindings");
    const count = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith(".json")).length : 0;
    process.stdout.write(String(count));
  ' "$RLL_IMPL" "$proj")"
  [ "$before" = "0" ]
  [ "$after" = "$before" ]
  _cosb_cleanup_project "$proj"
}

# ══════════════════════════════════════════════════════════════════════════
# M7 completeness GREEN-phase (2026-08-09, task #24): point-7 discriminating
# tests for claude-one-shot-binding. createClaudeOneShotBinding and
# validateClaudeOneShotBindingFor now exist and hook-side correlation is wired;
# the negative above proves a bare event cannot mint by elimination. This
# section exercises the function pair directly, mirroring this codebase's own
# validateRequesterBindingFor/
# validateRoleActorBindingFor adversarial-matrix precedent exactly. User's
# own 7-point spec, point 4: a caller "solo puede mintar ... grants cuando
# resuelvan al mismo claude-one-shot-binding vigente" (may only mint grants
# when they resolve to the SAME live claude-one-shot-binding) -- the
# scope-mismatch tests below are the direct proof of that requirement at the
# validator level.
# ══════════════════════════════════════════════════════════════════════════

# Mints a REAL ClaudeOneShotBinding/v1 with fully-controlled field values,
# prints "<binding_id> <worktree_id> <plan_digest>". Caller supplies a fresh
# PROJ (git+PLAN-backed, mirrors this file's own COSB-HOOK-NO-ONESHOT-BINDING
# fixture pattern) so worktree_id/plan_digest are genuine, not placeholders.
_cosb_mint_binding() {
  local proj="$1" ttl="${2:-3600}"
  node -e '
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const ttl = Number(process.argv[3]);
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    if (!planResult.ok) { process.stderr.write("no PLAN discovered"); process.exit(1); }
    const genResult = rll.resolveSessionGeneration(projectRoot, { provider: "claude-hook", runtime_session_key: "cosb-session" });
    if (!genResult.ok) { process.stderr.write("session generation resolve failed: " + JSON.stringify(genResult)); process.exit(1); }
    const result = rll.createClaudeOneShotBinding(
      projectRoot, "cosb-session", genResult.generationId, "cosb-agent-id", "arch-testing",
      "a".repeat(32), "b".repeat(64), "c".repeat(64), 0, "arch-testing",
      worktreeId, planResult.planDigest, ttl
    );
    if (!result.ok) { process.stderr.write("mint failed: " + JSON.stringify(result)); process.exit(1); }
    process.stdout.write(result.binding.binding_id + " " + worktreeId + " " + planResult.planDigest);
  ' "$RLL_IMPL" "$proj" "$ttl"
}

# Runs validateClaudeOneShotBindingFor against `binding_id` with the given
# expected-scope fields (all six required params); prints "true"/"false" and
# the reason (if any) as "<ok> <reason>".
_cosb_validate() {
  local proj="$1" binding_id="$2" request_id="$3" attempt_id="$4" lease_epoch="$5" role="$6" worktree_id="$7" plan_digest="$8"
  node -e '
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const bindingId = process.argv[3];
    const expected = {
      requestId: process.argv[4], attemptId: process.argv[5], leaseEpoch: Number(process.argv[6]),
      role: process.argv[7], worktreeId: process.argv[8], planDigest: process.argv[9],
    };
    const result = rll.validateClaudeOneShotBindingFor(projectRoot, bindingId, expected);
    process.stdout.write((result.ok ? "true" : "false") + " " + (result.reason || "NONE"));
  ' "$RLL_IMPL" "$proj" "$binding_id" "$request_id" "$attempt_id" "$lease_epoch" "$role" "$worktree_id" "$plan_digest"
}

_cosb_make_project() {
  local proj; proj="$(mktemp -d)"
  git -C "$proj" init -q 2>/dev/null
  git -C "$proj" config user.email "bats@test.local"
  git -C "$proj" config user.name "Bats Test"
  git -C "$proj" commit -q --allow-empty -m init 2>/dev/null
  mkdir -p "$proj/.planning/wave-cosb-validate-wave"
  printf '# fixture PLAN for claude-one-shot-binding-red.bats point-7 tests\n' > "$proj/.planning/wave-cosb-validate-wave/PLAN.md"
  printf '%s' "$proj"
}

_cosb_cleanup_project() {
  local proj="$1"
  node -e 'const rll=require(process.argv[1]);try{require("fs").rmSync(rll.registryRepoDir(process.argv[2]),{recursive:true,force:true});}catch{}' "$RLL_IMPL" "$proj"
  rm -rf "$proj"
}

@test "COSB-VALIDATE-ROUNDTRIP PASS: a genuinely-minted binding validates true when every expected-scope field (request/attempt/epoch/role/worktree/plan) matches exactly -- control case establishing every mismatch below is attributable to the tamper" {
  local proj; proj="$(_cosb_make_project)"
  local out binding_id worktree_id plan_digest
  out="$(_cosb_mint_binding "$proj")"; read -r binding_id worktree_id plan_digest <<< "$out"
  [ -n "$binding_id" ]
  local result; result="$(_cosb_validate "$proj" "$binding_id" "$(printf 'b%.0s' {1..64})" "$(printf 'c%.0s' {1..64})" 0 arch-testing "$worktree_id" "$plan_digest")"
  [ "$result" = "true NONE" ]
  _cosb_cleanup_project "$proj"
}

@test "COSB-VALIDATE-ABSENT BLOCK: a random, never-minted binding_id is rejected 'claude-one-shot-binding-absent', never treated as a valid reference" {
  local proj; proj="$(_cosb_make_project)"
  local forged; forged="$(node -e 'process.stdout.write(require("crypto").randomBytes(16).toString("hex"))')"
  local result; result="$(_cosb_validate "$proj" "$forged" "$(printf 'b%.0s' {1..64})" "$(printf 'c%.0s' {1..64})" 0 arch-testing "0000000000000000000000000000000000000000000000000000000000000000" "0000000000000000000000000000000000000000000000000000000000000000")"
  [ "$result" = "false claude-one-shot-binding-absent" ]
  _cosb_cleanup_project "$proj"
}

@test "COSB-VALIDATE-EXPIRED BLOCK: a binding whose on-disk expiry has already passed (created_at itself ALSO in the past, created_at < expiry < now -- isolated from the SEPARATE 'timestamp order invalid' check, which fires first if expiry were simply set before created_at, confirmed empirically 2026-08-09) is rejected 'claude-one-shot-binding-expired', never treated as still-live" {
  local proj; proj="$(_cosb_make_project)"
  local out binding_id worktree_id plan_digest
  out="$(_cosb_mint_binding "$proj")"; read -r binding_id worktree_id plan_digest <<< "$out"
  node -e '
    const rll = require(process.argv[1]);
    const fs = require("fs");
    const p = rll.claudeOneShotBindingPathFor(process.argv[2], process.argv[3]);
    const rec = JSON.parse(fs.readFileSync(p, "utf8"));
    rec.created_at = "1999-01-01T00:00:00Z";
    rec.expiry = "2000-01-01T00:00:00Z";
    fs.writeFileSync(p, JSON.stringify(rec));
  ' "$RLL_IMPL" "$proj" "$binding_id"
  local result; result="$(_cosb_validate "$proj" "$binding_id" "$(printf 'b%.0s' {1..64})" "$(printf 'c%.0s' {1..64})" 0 arch-testing "$worktree_id" "$plan_digest")"
  [ "$result" = "false claude-one-shot-binding-expired" ]
  _cosb_cleanup_project "$proj"
}

@test "COSB-VALIDATE-SCOPE-MISMATCH-REQUEST BLOCK: a genuinely-minted binding presented against the WRONG expected request_id is rejected 'claude-one-shot-binding-scope-mismatch' -- proves point 4 of the user's 7-point spec (grants only for the SAME live binding) at the request dimension" {
  local proj; proj="$(_cosb_make_project)"
  local out binding_id worktree_id plan_digest
  out="$(_cosb_mint_binding "$proj")"; read -r binding_id worktree_id plan_digest <<< "$out"
  local wrong_request; wrong_request="$(printf '9%.0s' {1..64})"
  local result; result="$(_cosb_validate "$proj" "$binding_id" "$wrong_request" "$(printf 'c%.0s' {1..64})" 0 arch-testing "$worktree_id" "$plan_digest")"
  [ "$result" = "false claude-one-shot-binding-scope-mismatch" ]
  _cosb_cleanup_project "$proj"
}

@test "COSB-VALIDATE-SCOPE-MISMATCH-ROLE BLOCK: a genuinely-minted binding presented against the WRONG expected role is rejected 'claude-one-shot-binding-scope-mismatch' -- the target-role dimension of the SAME point-4 requirement, isolated from request_id" {
  local proj; proj="$(_cosb_make_project)"
  local out binding_id worktree_id plan_digest
  out="$(_cosb_mint_binding "$proj")"; read -r binding_id worktree_id plan_digest <<< "$out"
  local result; result="$(_cosb_validate "$proj" "$binding_id" "$(printf 'b%.0s' {1..64})" "$(printf 'c%.0s' {1..64})" 0 test-specialist "$worktree_id" "$plan_digest")"
  [ "$result" = "false claude-one-shot-binding-scope-mismatch" ]
  _cosb_cleanup_project "$proj"
}

@test "COSB-VALIDATE-SCOPE-MISMATCH-EPOCH BLOCK: a genuinely-minted binding presented against the WRONG expected lease_epoch is rejected 'claude-one-shot-binding-scope-mismatch' -- proves the epoch dimension specifically (a stale/superseded lease attempt must not resolve to a binding minted for a different one)" {
  local proj; proj="$(_cosb_make_project)"
  local out binding_id worktree_id plan_digest
  out="$(_cosb_mint_binding "$proj")"; read -r binding_id worktree_id plan_digest <<< "$out"
  local result; result="$(_cosb_validate "$proj" "$binding_id" "$(printf 'b%.0s' {1..64})" "$(printf 'c%.0s' {1..64})" 1 arch-testing "$worktree_id" "$plan_digest")"
  [ "$result" = "false claude-one-shot-binding-scope-mismatch" ]
  _cosb_cleanup_project "$proj"
}

@test "COSB-VALIDATE-SHAPE-TAMPER BLOCK: a binding whose on-disk 'native_spawn_action_id' field is corrupted post-mint (no longer a well-formed hex action id) is rejected 'claude-one-shot-binding-shape-invalid', never treated as valid" {
  local proj; proj="$(_cosb_make_project)"
  local out binding_id worktree_id plan_digest
  out="$(_cosb_mint_binding "$proj")"; read -r binding_id worktree_id plan_digest <<< "$out"
  node -e '
    const rll = require(process.argv[1]);
    const fs = require("fs");
    const p = rll.claudeOneShotBindingPathFor(process.argv[2], process.argv[3]);
    const rec = JSON.parse(fs.readFileSync(p, "utf8"));
    rec.native_spawn_action_id = "not-a-valid-hex-action-id";
    fs.writeFileSync(p, JSON.stringify(rec));
  ' "$RLL_IMPL" "$proj" "$binding_id"
  local result; result="$(_cosb_validate "$proj" "$binding_id" "$(printf 'b%.0s' {1..64})" "$(printf 'c%.0s' {1..64})" 0 arch-testing "$worktree_id" "$plan_digest")"
  [ "$result" = "false claude-one-shot-binding-shape-invalid" ]
  _cosb_cleanup_project "$proj"
}

# ══════════════════════════════════════════════════════════════════════════
# Point 7 completeness pass, against the verbatim spec at
# .planning/wave-portable-runtime-messaging-adapters/m7-completeness-verdict-2026-08-09.md
# Block 2, point 7: "wrong session_id; wrong agent_id; wrong agent_type;
# cross-action/request/attempt/epoch; expired/replayed/retired binding;
# intento de sustituir RoleActorBinding; prose-only Agent return sin
# resultado durable; exact happy path completo." Every one of the 8 items is
# addressed below EXPLICITLY -- current mapping (2026-08-09, task #27, now
# that Part C's hook wiring landed):
#   wrong session_id / wrong agent_id  -> M7 FINAL IDENTITY CLOSURE
#     (2026-08-09) closed this: COSB-IDENTITY-SESSION-MISMATCH-REJECTED-UNCONSUMED,
#     COSB-TARGET-GATE-WRONG-SESSION-ID, COSB-TARGET-GATE-WRONG-AGENT-ID,
#     COSB-TARGET-GATE-EXACT-IDENTITY-GRANTS (real, E2E -- in the E2E section
#     below, next to COSB-E2E-HAPPY-PATH/COSB-E2E-TARGET-GATE-WRONG-AGENT-TYPE)
#   wrong agent_type                   -> COSB-E2E-TARGET-GATE-WRONG-AGENT-TYPE (real, E2E)
#   cross-action/request/attempt/epoch -> COSB-VALIDATE-SCOPE-MISMATCH-REQUEST/
#     -ATTEMPT/-EPOCH below (real, function-level; native_spawn_action_id's own
#     shape is covered by COSB-VALIDATE-SHAPE-TAMPER, and a binding is
#     structurally reachable only via its own unique native_spawn_action_id in
#     the first place, so a request/attempt/epoch mismatch already IS the
#     cross-action case)
#   expired binding                    -> COSB-VALIDATE-EXPIRED above (real)
#   replayed / retired binding         -> COSB-RETIRE-THEN-REPLAY-REJECTED (real)
#   RoleActorBinding substitution      -> COSB-VALIDATE-ROLEACTORBINDING-SUBSTITUTION above (real)
#   prose-only Agent return            -> COSB-E2E-SUBAGENTSTOP-RETIRES-PROSE-ONLY-RETURN (real, E2E)
#   exact happy path completo          -> COSB-E2E-HAPPY-PATH (real, E2E)
# Never silently omitted -- every item above is either a real test or a
# precisely-cited, evidence-based disclosed finding.
# ══════════════════════════════════════════════════════════════════════════

@test "COSB-VALIDATE-SCOPE-MISMATCH-ATTEMPT BLOCK: a genuinely-minted binding presented against the WRONG expected attempt_id is rejected 'claude-one-shot-binding-scope-mismatch' -- completes point 7's 'cross-action/request/attempt/epoch' item at the attempt dimension" {
  local proj; proj="$(_cosb_make_project)"
  local out binding_id worktree_id plan_digest
  out="$(_cosb_mint_binding "$proj")"; read -r binding_id worktree_id plan_digest <<< "$out"
  local wrong_attempt; wrong_attempt="$(printf '8%.0s' {1..64})"
  local result; result="$(_cosb_validate "$proj" "$binding_id" "$(printf 'b%.0s' {1..64})" "$wrong_attempt" 0 arch-testing "$worktree_id" "$plan_digest")"
  [ "$result" = "false claude-one-shot-binding-scope-mismatch" ]
  _cosb_cleanup_project "$proj"
}

@test "COSB-VALIDATE-SCOPE-MISMATCH-WORKTREE BLOCK: a genuinely-minted binding presented against the WRONG expected worktree_id is rejected 'claude-one-shot-binding-scope-mismatch' -- a binding minted in one worktree must never authorize a grant in another" {
  local proj; proj="$(_cosb_make_project)"
  local out binding_id worktree_id plan_digest
  out="$(_cosb_mint_binding "$proj")"; read -r binding_id worktree_id plan_digest <<< "$out"
  local wrong_worktree; wrong_worktree="$(printf '7%.0s' {1..64})"
  local result; result="$(_cosb_validate "$proj" "$binding_id" "$(printf 'b%.0s' {1..64})" "$(printf 'c%.0s' {1..64})" 0 arch-testing "$wrong_worktree" "$plan_digest")"
  [ "$result" = "false claude-one-shot-binding-scope-mismatch" ]
  _cosb_cleanup_project "$proj"
}

@test "COSB-VALIDATE-SCOPE-MISMATCH-PLANDIGEST BLOCK: a genuinely-minted binding presented against the WRONG expected plan_digest is rejected 'claude-one-shot-binding-scope-mismatch' -- a binding minted for one PLAN must never authorize a grant under a stale/different PLAN" {
  local proj; proj="$(_cosb_make_project)"
  local out binding_id worktree_id plan_digest
  out="$(_cosb_mint_binding "$proj")"; read -r binding_id worktree_id plan_digest <<< "$out"
  local wrong_plan; wrong_plan="$(printf '6%.0s' {1..64})"
  local result; result="$(_cosb_validate "$proj" "$binding_id" "$(printf 'b%.0s' {1..64})" "$(printf 'c%.0s' {1..64})" 0 arch-testing "$worktree_id" "$wrong_plan")"
  [ "$result" = "false claude-one-shot-binding-scope-mismatch" ]
  _cosb_cleanup_project "$proj"
}

@test "COSB-VALIDATE-ROLEACTORBINDING-SUBSTITUTION BLOCK: a genuine RoleActorBinding/v1's own bytes, written at a ClaudeOneShotBinding-shaped path, are rejected as shape-invalid -- proves point 7's 'intento de sustituir RoleActorBinding' cannot succeed even if the substitute is planted directly on disk at the exact expected path (bypassing any minting call entirely), since the two schemas' own closed key-sets are provably disjoint (hasExactKeys rejects RoleActorBinding's own field set against CLAUDE_ONE_SHOT_BINDING_KEYS)" {
  local proj; proj="$(_cosb_make_project)"
  local worktree_id plan_digest
  worktree_id="$(node -e 'const rll=require(process.argv[1]);process.stdout.write(rll.computeWorktreeId(process.argv[2]));' "$RLL_IMPL" "$proj")"
  plan_digest="$(node -e 'const rll=require(process.argv[1]);const r=rll.discoverPlan(process.argv[2]);process.stdout.write(r.ok?r.planDigest:"");' "$RLL_IMPL" "$proj")"
  local fake_binding_id; fake_binding_id="$(node -e 'process.stdout.write(require("crypto").randomBytes(16).toString("hex"))')"
  node -e '
    const rll = require(process.argv[1]);
    const fs = require("fs");
    const projectRoot = process.argv[2];
    const bindingId = process.argv[3];
    const worktreeId = process.argv[4];
    const planDigest = process.argv[5];
    // A genuine RoleActorBinding/v1, minted via the real production
    // primitive -- not a hand-fabricated shape.
    const result = rll.createRoleActorBinding(projectRoot, "arch-testing", worktreeId, planDigest, "a".repeat(32), 60);
    if (!result.ok) { process.stderr.write("RoleActorBinding mint failed: " + JSON.stringify(result)); process.exit(1); }
    // Plant its EXACT bytes directly at the ClaudeOneShotBinding path a
    // substitution attempt would target -- bypassing createClaudeOneShotBinding
    // entirely, proving the rejection is a genuine schema/shape check, not
    // merely "this mint function was never called". Written via the SAME
    // secure-write primitive every real registry record uses (never a plain
    // fs.writeFileSync -- empirically confirmed 2026-08-09 that a plain write
    // here produces a file with the WRONG mode and gets rejected earlier, at
    // the fd-bound SECURITY_INVALID read-security layer, before content is
    // even parsed -- a real, but different and less targeted, rejection than
    // the schema/shape mismatch this test means to isolate).
    const targetPath = rll.claudeOneShotBindingPathFor(projectRoot, bindingId);
    const roleActorBytes = fs.readFileSync(rll.roleActorBindingPathFor(projectRoot, result.binding.binding_id));
    const writeResult = rll.writeRegistryRecordReplace(targetPath, roleActorBytes);
    if (!writeResult.ok) { process.stderr.write("substitute write failed: " + JSON.stringify(writeResult)); process.exit(1); }
  ' "$RLL_IMPL" "$proj" "$fake_binding_id" "$worktree_id" "$plan_digest"
  local result; result="$(_cosb_validate "$proj" "$fake_binding_id" "$(printf 'b%.0s' {1..64})" "$(printf 'c%.0s' {1..64})" 0 arch-testing "$worktree_id" "$plan_digest")"
  [ "$result" = "false claude-one-shot-binding-shape-invalid" ]
  _cosb_cleanup_project "$proj"
}

# COSB-POINT7-DISCLOSED-SESSION-AGENT-IDENTITY (formerly a disclosed SKIP at
# this exact spot -- see git history) is CLOSED as of M7 FINAL IDENTITY
# CLOSURE (2026-08-09). The gap its own disclosure named -- MINT time never
# compared the observed session_id against an expected prior value, and
# CONSUME time (the target gate) read session_id/agent_id for PRESENCE only,
# never a stored-value comparison -- is now real, enforced behavior:
#   - tryConsumeClaudeAgentOneShotReservation (subagent-start-context-
#     bundle.js) now derives the session generation from the observed
#     SubagentStart session_id (peekSessionGeneration, provider
#     'claude-hook') and requires exact equality with the reservation's own
#     session_generation_id BEFORE consuming it.
#   - handleConsultationTargetOwning's ClaudeOneShotBinding branch
#     (runtime-consultation-target-gate.js) now requires exact equality on
#     all three of binding.runtime_session_key/agent_id/agent_type against
#     this call's own observed session_id/agent_id/agent_type before minting
#     any grant.
# agent_id remains first-observed-at-SubagentStart (there is no prior
# expected value to compare it against at mint time) -- unchanged, per the
# same reasoning this disclosure already gave.
# Real discriminating coverage, in the E2E section below (needs the E2E
# fixture helpers, which this file defines further down):
# COSB-IDENTITY-SESSION-MISMATCH-REJECTED-UNCONSUMED (next to
# COSB-E2E-HAPPY-PATH), COSB-TARGET-GATE-WRONG-SESSION-ID,
# COSB-TARGET-GATE-WRONG-AGENT-ID, COSB-TARGET-GATE-EXACT-IDENTITY-GRANTS
# (next to COSB-E2E-TARGET-GATE-WRONG-AGENT-TYPE).

# ══════════════════════════════════════════════════════════════════════════
# E2E fixture helpers (Part C follow-up, 2026-08-09, task #27). Constructs
# the full mint chain PLAN.md §15d describes -- publish a real request,
# hand-construct the claude-agent activation cmdDispatch cannot yet produce
# (see this file's own header "PRODUCTION REALITY" note), mint the B1
# reservation directly (mirrors subagent-start-context-bundle.bats's own
# _mint_reserved_role_spawn convention: drive production primitives directly
# for the PRE-CONDITION, then drive the REAL hook under test via an actual
# child-process invocation) -- then feeds a genuine SubagentStart to the real
# subagent-start-context-bundle.js hook, which performs the actual
# correlation and mint. Every test below reuses this SAME chain rather than
# re-deriving it, so a fixture defect would surface identically everywhere,
# never silently in just one test.
# ══════════════════════════════════════════════════════════════════════════

COSB_E2E_WAVE_SLUG="cosb-e2e-wave"
TARGET_GATE_HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/runtime-consultation-target-gate.js"

# M7/WP4 hook-protocol cleanup: asserts a genuine PreToolUse deny per the
# official contract (code.claude.com/docs/en/hooks) against a given
# status/output pair (positional, since several call sites here capture
# $status/$output into locals before a second `run` overwrites them) -- exit
# 0, hookSpecificOutput.hookEventName:"PreToolUse", permissionDecision:
# "deny", a non-empty permissionDecisionReason, and no deprecated top-level
# "decision" field.
_assert_pretooluse_deny_values() {
  local status_code="$1" body_json="$2"
  [ "$status_code" = "0" ]
  node -e '
    let body;
    try { body = JSON.parse(process.argv[1]); } catch (e) { process.stderr.write("not JSON: " + e.message + "\n"); process.exit(1); }
    if (!body || typeof body !== "object") { process.stderr.write("body not an object\n"); process.exit(1); }
    if (Object.prototype.hasOwnProperty.call(body, "decision")) { process.stderr.write("deprecated top-level decision field present\n"); process.exit(1); }
    const hso = body.hookSpecificOutput;
    if (!hso || hso.hookEventName !== "PreToolUse") { process.stderr.write("hookEventName mismatch: " + JSON.stringify(hso) + "\n"); process.exit(1); }
    if (hso.permissionDecision !== "deny") { process.stderr.write("permissionDecision mismatch: " + JSON.stringify(hso) + "\n"); process.exit(1); }
    if (typeof hso.permissionDecisionReason !== "string" || hso.permissionDecisionReason.length === 0) { process.stderr.write("permissionDecisionReason missing/empty\n"); process.exit(1); }
  ' "$body_json"
}

# Same contract, against the last `run` ($status/$output) directly.
_assert_pretooluse_deny() {
  _assert_pretooluse_deny_values "$status" "$output"
}

# Asserts a genuine SubagentStop block per the official contract: exit 0,
# top-level decision:"block", non-empty reason -- against the last `run`
# ($status/$output).
_assert_subagentstop_block() {
  [ "$status" -eq 0 ]
  node -e '
    let body;
    try { body = JSON.parse(process.argv[1]); } catch (e) { process.stderr.write("not JSON: " + e.message + "\n"); process.exit(1); }
    if (!body || body.decision !== "block") { process.stderr.write("decision mismatch: " + JSON.stringify(body) + "\n"); process.exit(1); }
    if (typeof body.reason !== "string" || body.reason.length === 0) { process.stderr.write("reason missing/empty\n"); process.exit(1); }
  ' "$output"
}

# Git+PLAN.md fixture on a feature/<slug> branch -- unlike _cosb_make_project
# above, the E2E chain needs getWaveSlug (subagent-start-context-bundle.js's
# own branch-derived slug resolution) to genuinely resolve, which a bare
# default-branch init (that helper's own convention, sufficient for the
# function-level tests above) never provides.
_cosb_e2e_make_project() {
  local proj; proj="$(mktemp -d)"
  git -C "$proj" init -q 2>/dev/null
  git -C "$proj" config user.email "bats@test.local"
  git -C "$proj" config user.name "Bats Test"
  git -C "$proj" commit -q --allow-empty -m init 2>/dev/null
  git -C "$proj" checkout -q -b "feature/$COSB_E2E_WAVE_SLUG" 2>/dev/null
  mkdir -p "$proj/.planning/wave-$COSB_E2E_WAVE_SLUG"
  printf '# fixture PLAN for claude-one-shot-binding-red.bats E2E tests\n' > "$proj/.planning/wave-$COSB_E2E_WAVE_SLUG/PLAN.md"
  printf '%s' "$proj"
}

# Establishes the generation-scoped CLAUDE-ID-01 capability with two real,
# distinct role-spawn actions. Peer A supplies the complete bounded sequence;
# peer B supplies the required same-role/different-agent observation. A
# disjoint probe role avoids polluting the activation candidates exercised by
# the one-shot tests themselves.
_cosb_prime_claude_id01_capability() {
  local proj="$1" session_id="$2" agent_id="$3"
  node -e '
    const crypto = require("crypto");
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const sessionId = process.argv[3];
    const agentId = process.argv[4];
    const role = "context-provider";
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: sessionId };
    const generation = rll.resolveSessionGeneration(projectRoot, identity);
    const plan = rll.discoverPlan(projectRoot);
    if (!generation.ok || !plan.ok) { process.stderr.write("CLAUDE-ID-01 scope resolution failed"); process.exit(1); }
    const worktreeId = rll.computeWorktreeId(projectRoot);
    function mintAction(suffix) {
      const actionId = rll.generateActionId();
      const expiry = new Date(Date.now() + 600000).toISOString().replace(/\.\d{3}Z$/, "Z");
      const minted = rll.mintRoleLifecycleAction(
        projectRoot, actionId, "role-spawn", "claude-native",
        rll.computeRepoId(projectRoot), worktreeId, plan.planDigest,
        crypto.createHash("sha256").update("cosb-claude-id01:" + suffix).digest("hex"),
        generation.generationId, role,
        rll.buildRoleSpawnPayload("claude-id01-probe", role, role, "fixture", "fixture"),
        expiry,
      );
      if (!minted.ok) { process.stderr.write("probe action mint failed: " + JSON.stringify(minted)); process.exit(1); }
      return actionId;
    }
    const actionA = mintAction("a-" + agentId);
    const actionB = mintAction("b-" + agentId);
    rll.recordClaudeId01SubagentStartObservation(projectRoot, { sessionId, agentId, agentType: role, actionId: actionA });
    rll.recordClaudeId01PreToolUseObservation(projectRoot, { sessionId, agentId, agentType: role, toolUseId: "cosb-prime-1-" + agentId });
    rll.recordClaudeId01PreToolUseObservation(projectRoot, { sessionId, agentId, agentType: role, toolUseId: "cosb-prime-2-" + agentId });
    rll.recordClaudeId01SubagentStartObservation(projectRoot, { sessionId, agentId, agentType: role, actionId: actionA });
    rll.recordClaudeId01PreToolUseObservation(projectRoot, { sessionId, agentId, agentType: role, toolUseId: "cosb-prime-3-" + agentId });
    rll.recordClaudeId01SubagentStartObservation(projectRoot, { sessionId, agentId: agentId + "-distinct-peer-b", agentType: role, actionId: actionB });
    const proof = rll.checkClaudeId01RuntimeCapability(projectRoot, sessionId, worktreeId, plan.planDigest);
    if (!proof.ok) { process.stderr.write("global CLAUDE-ID-01 capability absent: " + JSON.stringify(proof)); process.exit(1); }
  ' "$RLL_IMPL" "$proj" "$session_id" "$agent_id"
}

# Mints a real requester role-command-grant/v1 for `publish-request` and
# calls the REAL CLI -- same pattern this suite's own sibling files
# (runtime-consultation-windows.bats's _w08_mint_publish_request_grant)
# already established, reused here rather than re-derived. Publishes into
# the CANONICAL coordination-root (rll.coordinationRootPathFor) -- the exact,
# non-configurable path every real hook in this chain (agent-spawn-execution-
# gate.js, subagent-start-context-bundle.js) resolves via
# process.env.CLAUDE_PROJECT_DIR, never an arbitrary --coordination-root a
# test happens to choose. Prints "<request_id> <artifact_ref>".
_cosb_e2e_publish_request() {
  local proj="$1" role="${2:-arch-testing}"
  _cosb_prime_claude_id01_capability "$proj" "cosb-e2e-grant-session" "cosb-e2e-capability-primary"
  local coord_root; coord_root="$(node -e 'const rll=require(process.argv[1]);process.stdout.write(rll.coordinationRootPathFor(process.argv[2]));' "$RLL_IMPL" "$proj")"
  mkdir -p "$coord_root"
  local subject_bundle_file="$proj/.planning/coordination-subject-bundle-manifest.json"
  printf '{"schema":"coordination/subject-bundle-manifest/v1","entries":[]}' > "$subject_bundle_file"
  local expiry; expiry="$(node -e 'process.stdout.write(new Date(Date.now() + 1800000).toISOString())')"
  local intent; intent="$(printf '{"target_role":"%s","question":"COSB E2E fixture question","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$role" "$expiry")"
  local intent_b64; intent_b64="$(printf '%s' "$intent" | node -e 'process.stdout.write(Buffer.from(require("fs").readFileSync(0)).toString("base64url"))')"
  local plan_file="$proj/.planning/wave-$COSB_E2E_WAVE_SLUG/PLAN.md"
  local rest_args=(--coordination-root "$coord_root" --plan "$plan_file" --subject-bundle "$subject_bundle_file" --intent "$intent_b64")
  local grant
  grant="$(node -e '
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const rest = process.argv.slice(4);
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    if (!planResult.ok) { process.stderr.write("no PLAN discovered"); process.exit(1); }
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: "cosb-e2e-grant-session" };
    // M6+M7 requester-authority closure (Group A): createRequesterBinding now
    // rejects an empty agentKey outright -- a stable, non-empty, explicitly
    // test-only agent id is required.
    const bindingResult = rll.createRequesterBinding(projectRoot, identity, "cosb-e2e-grant-agent", "arch-testing", worktreeId, planResult.planDigest, 3600);
    if (!bindingResult.ok) { process.stderr.write("createRequesterBinding failed: " + JSON.stringify(bindingResult)); process.exit(1); }
    const argvDigest = rc.sha256String(rc.canonicalJSONStringify(rest));
    const mintResult = rll.mintRoleCommandGrant(projectRoot, bindingResult.binding, "requester", "publish-request", argvDigest, null, null, null);
    if (!mintResult.ok) { process.stderr.write("mintRoleCommandGrant failed: " + JSON.stringify(mintResult)); process.exit(1); }
    process.stdout.write(mintResult.grantId);
  ' "$RLL_IMPL" "$RC_IMPL" "$proj" "${rest_args[@]}")"
  local output
  output="$(NODE_ENV=test node "$RC_IMPL" publish-request "${rest_args[@]}" --requester-binding "$grant" 2>/dev/null)"
  node -e '
    const d = JSON.parse(process.argv[1]);
    if (!d.ok) { process.stderr.write("publish-request failed: " + process.argv[1]); process.exit(1); }
    process.stdout.write(d.request_id + " " + d.artifact_ref);
  ' "$output"
}

# Hand-constructs the claude-agent activation cmdDispatch cannot yet produce
# (this file's own header "PRODUCTION REALITY" note) -- same schema, same
# publishNoClobber primitive, at the exact path a real dispatch would use
# (path.join(txnDir, "activations", attemptId + ".json"), confirmed by direct
# read of both cmdDispatch and findLiveClaudeAgentActivations). Reads every
# OTHER field (routing_policy_version/digest, target_role_profile_digest,
# initial_attempt_id/lease_epoch) off the just-published request -- never
# invented -- so the activation is a genuine, schema-correct sibling of what
# WP3 driver-selection would produce, differing only in selected_driver.
# Prints the freshly-generated native_spawn_action_id.
_cosb_e2e_construct_claude_agent_activation() {
  local proj="$1" artifact_ref="$2"
  NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="rcc-cosb-e2e-activation-fixture-capability" node -e '
    const fs = require("fs");
    const path = require("path");
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const requestPath = process.argv[3];
    const reqObj = JSON.parse(fs.readFileSync(requestPath, "utf8"));
    const txnDir = path.dirname(requestPath);
    const activationsDir = path.join(txnDir, "activations");
    fs.mkdirSync(activationsDir, { recursive: true });
    const attemptId = reqObj.initial_attempt_id;
    const activationPath = path.join(activationsDir, attemptId + ".json");
    const nativeSpawnActionId = rll.generateActionId();
    const activationObj = {
      schema: "coordination/activation/v1",
      version: 1,
      request_id: reqObj.request_id,
      request_digest: rc.sha256File(requestPath),
      attempt_id: attemptId,
      lease_epoch: reqObj.initial_lease_epoch,
      target_role_profile_digest: reqObj.target_role_profile_digest,
      routing_policy_version: reqObj.routing_policy_version,
      routing_policy_digest: reqObj.routing_policy_digest,
      selected_driver: "claude-agent",
      native_target_binding_id: null,
      native_spawn_action_id: nativeSpawnActionId,
      created_at: new Date().toISOString(),
      activation_liveness_expiry: rc.activationLivenessDeadline(reqObj),
    };
    rc.publishNoClobber(activationPath, Buffer.from(rc.canonicalJSONStringify(activationObj), "utf8"), { raceDetailCode: "AUTHORITY_INVALID" });
    process.stdout.write(nativeSpawnActionId);
  ' "$RLL_IMPL" "$RC_IMPL" "$artifact_ref"
}

# Mints the B1 ClaudeAgentSpawnReservation/v1 directly (mirrors
# agent-spawn-execution-gate.js's own mint call exactly, minus the PreToolUse
# stdin/hook plumbing this helper deliberately bypasses -- that hook is
# exercised separately by agent-spawn-execution-gate.test.js, not this file).
# ready_timeout_seconds is capped at 60s here (well under
# validateAndConsumeClaudeAgentSpawnReservation's own min(policy,120)s
# re-validation ceiling, confirmed empirically 2026-08-09 -- a value near the
# real policy default trips claude-agent-spawn-reservation-expiry-exceeds-policy
# at SubagentStart-consumption time, not at mint time).
_cosb_e2e_mint_b1_reservation() {
  local proj="$1" role="$2" request_id="$3"
  node -e '
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const role = process.argv[4];
    const requestId = process.argv[5];
    const waveSlug = process.argv[6];
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    const coordRoot = rll.coordinationRootPathFor(projectRoot);
    const repoId = rll.computeRepoId(projectRoot);
    const found = rc.findLiveClaudeAgentActivations(coordRoot, repoId, waveSlug, planResult.planDigest, role);
    if (found.length !== 1) { process.stderr.write("expected exactly 1 live activation, got " + found.length); process.exit(1); }
    const { activation } = found[0];
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: "cosb-e2e-orchestrator-session" };
    const bindingResult = rll.createMainOrchestratorBinding(projectRoot, identity, worktreeId, planResult.planDigest, 3600);
    if (!bindingResult.ok) { process.stderr.write("createMainOrchestratorBinding failed: " + JSON.stringify(bindingResult)); process.exit(1); }
    const genResult = rll.peekSessionGeneration(projectRoot, identity);
    if (!genResult.ok) { process.stderr.write("peekSessionGeneration failed: " + JSON.stringify(genResult)); process.exit(1); }
    const toolInputDigest = rc.sha256String(rc.canonicalJSONStringify({ subagent_type: role, name: role }));
    const mintResult = rll.mintClaudeAgentSpawnReservation(
      { repoId }, activation, requestId, role, worktreeId, planResult.planDigest,
      genResult.generationId, bindingResult.binding.binding_id, toolInputDigest, 60
    );
    if (!mintResult.ok) { process.stderr.write("mintClaudeAgentSpawnReservation failed: " + JSON.stringify(mintResult)); process.exit(1); }
  ' "$RLL_IMPL" "$RC_IMPL" "$proj" "$role" "$request_id" "$COSB_E2E_WAVE_SLUG"
}

# Identical to _cosb_e2e_mint_b1_reservation, except the tool_input_digest
# models a REAL custom-named spawn (mirrors agent-spawn-execution-gate.js's
# own formula, agent-spawn-execution-gate.js:365, sha256(canonicalJSON(
# {subagent_type,name})) computed from the ACTUAL tool_input.name of the
# Agent() call this reservation covers) -- `customName` must equal the
# agent_type this same test later feeds to the real SubagentStart, exactly
# as a genuine agent-spawn-execution-gate.js mint would compute it from the
# real tool_input.name at PreToolUse(Agent) time.
_cosb_e2e_mint_b1_reservation_custom_name() {
  local proj="$1" role="$2" request_id="$3" custom_name="$4"
  node -e '
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const role = process.argv[4];
    const requestId = process.argv[5];
    const waveSlug = process.argv[6];
    const customName = process.argv[7];
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    const coordRoot = rll.coordinationRootPathFor(projectRoot);
    const repoId = rll.computeRepoId(projectRoot);
    const found = rc.findLiveClaudeAgentActivations(coordRoot, repoId, waveSlug, planResult.planDigest, role);
    if (found.length !== 1) { process.stderr.write("expected exactly 1 live activation, got " + found.length); process.exit(1); }
    const { activation } = found[0];
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: "cosb-e2e-orchestrator-session" };
    const bindingResult = rll.createMainOrchestratorBinding(projectRoot, identity, worktreeId, planResult.planDigest, 3600);
    if (!bindingResult.ok) { process.stderr.write("createMainOrchestratorBinding failed: " + JSON.stringify(bindingResult)); process.exit(1); }
    const genResult = rll.peekSessionGeneration(projectRoot, identity);
    if (!genResult.ok) { process.stderr.write("peekSessionGeneration failed: " + JSON.stringify(genResult)); process.exit(1); }
    const toolInputDigest = rc.sha256String(rc.canonicalJSONStringify({ subagent_type: role, name: customName }));
    const mintResult = rll.mintClaudeAgentSpawnReservation(
      { repoId }, activation, requestId, role, worktreeId, planResult.planDigest,
      genResult.generationId, bindingResult.binding.binding_id, toolInputDigest, 60
    );
    if (!mintResult.ok) { process.stderr.write("mintClaudeAgentSpawnReservation failed: " + JSON.stringify(mintResult)); process.exit(1); }
  ' "$RLL_IMPL" "$RC_IMPL" "$proj" "$role" "$request_id" "$COSB_E2E_WAVE_SLUG" "$custom_name"
}

# Feeds a genuine SubagentStart payload to the REAL subagent-start-context-
# bundle.js hook -- the actual mint call under test. Prints "<status>".
_cosb_e2e_subagent_start() {
  local proj="$1" role="$2" session_id="$3" agent_id="$4"
  local input_file; input_file="$(mktemp)"
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({
      hook_event_name: "SubagentStart", agent_type: process.argv[2],
      session_id: process.argv[3], agent_id: process.argv[4],
    }));
  ' "$input_file" "$role" "$session_id" "$agent_id"
  local status
  cat "$input_file" | CLAUDE_PROJECT_DIR="$proj" node "$HOOK" >/dev/null 2>&1
  status=$?
  rm -f "$input_file"
  printf '%s' "$status"
}

# Scans claude-one-shot-bindings/ for the single live binding whose
# native_spawn_action_id matches -- mirrors subagent-start-context-
# bundle.bats's own _find_role_actor_binding convention (a real directory
# scan + real validator, never a raw guess at what the hook must have
# written). Prints the binding_id on success, empty otherwise.
_cosb_e2e_find_binding_by_action_id() {
  local proj="$1" native_spawn_action_id="$2"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const nativeSpawnActionId = process.argv[3];
    const dir = path.join(rll.registryRepoDir(projectRoot), "claude-one-shot-bindings");
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { entries = []; }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".json")) continue;
      const obj = JSON.parse(fs.readFileSync(path.join(dir, e.name), "utf8"));
      if (obj.native_spawn_action_id === nativeSpawnActionId) { process.stdout.write(obj.binding_id); process.exit(0); }
    }
  ' "$RLL_IMPL" "$proj" "$native_spawn_action_id"
}

# CIERRE FINAL correction (2026-08-15): a single stable hash of the WHOLE
# registry tree's file list + contents -- reused by every "zero mutation on
# block" assertion below (a genuine before/after byte-identical manifest
# proof, never a spot-check on one file). GNU find/sort/xargs (this repo's
# own canonical macOS bats PATH already provides them, see
# feedback_hub_windows_tooling) -- "EMPTY" when the registry dir does not
# exist yet at all.
_cosb_registry_snapshot() {
  local proj="$1"
  local dir; dir="$(node -e 'const rll=require(process.argv[1]);process.stdout.write(rll.registryRepoDir(process.argv[2]));' "$RLL_IMPL" "$proj")"
  if [ ! -d "$dir" ]; then printf 'EMPTY'; return; fi
  find "$dir" -type f -print0 | sort -z | xargs -0 sha256sum 2>/dev/null | sha256sum | awk '{print $1}'
}

@test "COSB-E2E-HAPPY-PATH: a genuine SubagentStart, correlating exactly against a real pre-committed claude-agent ActivationAction and its B1 reservation, mints a real claude-one-shot-binding/v1 through the actual production hook -- spec point 7's 'exact happy path completo'" {
  local proj; proj="$(_cosb_e2e_make_project)"
  local pub; pub="$(_cosb_e2e_publish_request "$proj" "arch-testing")"
  local request_id artifact_ref; read -r request_id artifact_ref <<< "$pub"
  [ -n "$request_id" ]

  local native_spawn_action_id
  native_spawn_action_id="$(_cosb_e2e_construct_claude_agent_activation "$proj" "$artifact_ref")"
  [ -n "$native_spawn_action_id" ]

  run _cosb_e2e_mint_b1_reservation "$proj" "arch-testing" "$request_id"
  [ "$status" -eq 0 ]

  local hook_status
  hook_status="$(_cosb_e2e_subagent_start "$proj" "arch-testing" "cosb-e2e-orchestrator-session" "cosb-e2e-spawned-agent-id")"
  [ "$hook_status" = "0" ]

  local binding_id; binding_id="$(_cosb_e2e_find_binding_by_action_id "$proj" "$native_spawn_action_id")"
  [ -n "$binding_id" ]

  # Every correlated field genuinely traces back to the real chain, never a
  # placeholder -- proves this is the hook's OWN correlation, not merely "a
  # binding exists somewhere".
  run node -e '
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const bindingId = process.argv[3];
    const nativeSpawnActionId = process.argv[4];
    const requestId = process.argv[5];
    const bindingRead = rll.readRegistryRecord(rll.claudeOneShotBindingPathFor(projectRoot, bindingId));
    if (!bindingRead.ok || bindingRead.absent) process.exit(1);
    const b = bindingRead.obj;
    if (b.runtime_session_key !== "cosb-e2e-orchestrator-session") { process.stderr.write("session mismatch: " + b.runtime_session_key); process.exit(1); }
    if (b.agent_id !== "cosb-e2e-spawned-agent-id") { process.stderr.write("agent_id mismatch: " + b.agent_id); process.exit(1); }
    if (b.agent_type !== "arch-testing") { process.stderr.write("agent_type mismatch: " + b.agent_type); process.exit(1); }
    if (b.native_spawn_action_id !== nativeSpawnActionId) { process.stderr.write("action mismatch"); process.exit(1); }
    if (b.request_id !== requestId) { process.stderr.write("request mismatch"); process.exit(1); }
    if (b.role !== "arch-testing") { process.stderr.write("role mismatch: " + b.role); process.exit(1); }
  ' "$RLL_IMPL" "$proj" "$binding_id" "$native_spawn_action_id" "$request_id"
  [ "$status" -eq 0 ]

  rm -rf "$proj"
}

@test "COSB-IDENTITY-SESSION-MISMATCH-REJECTED-UNCONSUMED: a B1 reservation minted under the orchestrator's own session (_cosb_e2e_mint_b1_reservation's hardcoded 'cosb-e2e-orchestrator-session' identity) is rejected by a REAL SubagentStart arriving under a DIFFERENT session -- no ClaudeOneShotBinding is created, and the reservation is provably NEVER consumed: a subsequent SubagentStart under the CORRECT session still succeeds against the SAME still-live reservation (a genuinely consumed/wasted reservation would instead hit claude-agent-spawn-reservation-not-issued). M7 FINAL IDENTITY CLOSURE point 1 (tryConsumeClaudeAgentOneShotReservation's new peekSessionGeneration equality check)." {
  local proj; proj="$(_cosb_e2e_make_project)"
  local pub; pub="$(_cosb_e2e_publish_request "$proj" "arch-testing")"
  local request_id artifact_ref; read -r request_id artifact_ref <<< "$pub"
  local native_spawn_action_id
  native_spawn_action_id="$(_cosb_e2e_construct_claude_agent_activation "$proj" "$artifact_ref")"
  run _cosb_e2e_mint_b1_reservation "$proj" "arch-testing" "$request_id"
  [ "$status" -eq 0 ]

  # SubagentStart arrives under a session that never minted anything.
  local hook_status
  hook_status="$(_cosb_e2e_subagent_start "$proj" "arch-testing" "cosb-identity-WRONG-session" "cosb-e2e-spawned-agent-id")"
  [ "$hook_status" = "0" ]
  local binding_id; binding_id="$(_cosb_e2e_find_binding_by_action_id "$proj" "$native_spawn_action_id")"
  [ -z "$binding_id" ]

  # Proof of "unconsumed", not merely "no binding this time".
  hook_status="$(_cosb_e2e_subagent_start "$proj" "arch-testing" "cosb-e2e-orchestrator-session" "cosb-e2e-spawned-agent-id")"
  [ "$hook_status" = "0" ]
  binding_id="$(_cosb_e2e_find_binding_by_action_id "$proj" "$native_spawn_action_id")"
  [ -n "$binding_id" ]
  run node -e '
    const rll = require(process.argv[1]);
    const bindingRead = rll.readRegistryRecord(rll.claudeOneShotBindingPathFor(process.argv[2], process.argv[3]));
    if (!bindingRead.ok || bindingRead.absent) process.exit(1);
    if (bindingRead.obj.runtime_session_key !== "cosb-e2e-orchestrator-session") { process.stderr.write("session mismatch: " + bindingRead.obj.runtime_session_key); process.exit(1); }
  ' "$RLL_IMPL" "$proj" "$binding_id"
  [ "$status" -eq 0 ]

  rm -rf "$proj"
}

# ══════════════════════════════════════════════════════════════════════════
# M7 GREEN correction round 2, R1: the pre-fix tryConsumeClaudeAgentOneShotReservation
# (subagent-start-context-bundle.js) calls validateAndConsumeClaudeAgentSpawnReservation
# (which publishes the reservation's own no-clobber `.consumed` marker
# unconditionally once ITS OWN, narrower validation passes -- confirmed by
# direct read that this validation never calls classifyClaudeAuthorityForIdentity
# or checks the identity fence at all) as a fully separate, already-complete
# operation, THEN separately calls createClaudeOneShotBinding (whose OWN
# admitClaudeAuthorityOperation is the ONLY place the fence is actually
# checked). A durable fence for the spawning identity therefore lets the
# reservation-consume step succeed BLIND to it, and only the SEPARATE,
# LATER binding-creation step denies -- a cut-first terminal leaves a
# consumed marker with no binding, exactly the "admit-before-consume" defect
# this ruling names. This is a deterministic sequential negative (M7 section
# 10.3: "the cut-first side makes the immutable cut fully durable before
# invoking the final admission pass"), not a race requiring rendezvous --
# the fence is published before the hook ever runs at all.
# ══════════════════════════════════════════════════════════════════════════

@test "M7-R1-CUTFIRST-FENCE-LEAVES-RESERVATION-ISSUED: a durable identity fence for the spawning session/agent, published BEFORE a real SubagentStart ever runs, must leave the B1 reservation genuinely ISSUED (no .consumed marker) and create no binding -- correction round 2's R1 ruling (admit before consume)" {
  local proj; proj="$(_cosb_e2e_make_project)"
  local pub; pub="$(_cosb_e2e_publish_request "$proj" "arch-testing")"
  local request_id artifact_ref; read -r request_id artifact_ref <<< "$pub"
  [ -n "$request_id" ]

  local native_spawn_action_id
  native_spawn_action_id="$(_cosb_e2e_construct_claude_agent_activation "$proj" "$artifact_ref")"
  [ -n "$native_spawn_action_id" ]

  run _cosb_e2e_mint_b1_reservation "$proj" "arch-testing" "$request_id"
  [ "$status" -eq 0 ]

  # Publish the durable identity fence for the EXACT (session,agent) that is
  # about to attempt the spawn -- a real, immutable cut, fully durable
  # before the hook ever runs (never a rendezvous-timed race).
  run node -e '
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const repoDescriptor = { repoId: rll.computeRepoId(projectRoot) };
    const authorityIdentityId = rll.computeClaudeAuthorityIdentityId(repoDescriptor, "claude-hook", "cosb-e2e-orchestrator-session", "cosb-e2e-spawned-agent-id");
    const fenced = rll.publishClaudeAuthorityFence(repoDescriptor, authorityIdentityId);
    if (!fenced.ok) { process.stderr.write("fence publish failed: " + JSON.stringify(fenced)); process.exit(1); }
  ' "$RLL_IMPL" "$proj"
  [ "$status" -eq 0 ]

  local hook_status
  hook_status="$(_cosb_e2e_subagent_start "$proj" "arch-testing" "cosb-e2e-orchestrator-session" "cosb-e2e-spawned-agent-id")"
  [ "$hook_status" = "0" ]

  local binding_id; binding_id="$(_cosb_e2e_find_binding_by_action_id "$proj" "$native_spawn_action_id")"
  [ -z "$binding_id" ]

  # The load-bearing assertion: the reservation's OWN no-clobber consumed
  # marker must be ABSENT -- proving admission (which sees the fence) ran
  # BEFORE consumption, never after it. Pre-fix, this marker exists (the
  # narrower reservation-only validation is fence-blind and consumes first).
  run node -e '
    const fs = require("fs");
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const nativeSpawnActionId = process.argv[3];
    const markerPath = rll.claudeAgentSpawnReservationConsumedMarkerPathFor(projectRoot, nativeSpawnActionId);
    if (fs.existsSync(markerPath)) { process.stderr.write("consumed marker unexpectedly present at " + markerPath); process.exit(1); }
    const reservationRead = rll.readRegistryRecord(rll.claudeAgentSpawnReservationPathFor(projectRoot, nativeSpawnActionId));
    if (!reservationRead.ok || reservationRead.absent) { process.stderr.write("reservation unexpectedly absent: " + JSON.stringify(reservationRead)); process.exit(1); }
    if (reservationRead.obj.execution_state !== "ISSUED") { process.stderr.write("reservation not ISSUED: " + JSON.stringify(reservationRead.obj)); process.exit(1); }
  ' "$RLL_IMPL" "$proj" "$native_spawn_action_id"
  [ "$status" -eq 0 ]

  rm -rf "$proj"
}

# ══════════════════════════════════════════════════════════════════════════
# M7 defect 3 / checklist item 5 (2026-08-17 correction pass): "Reserva G1,
# rotacion G2, create one-shot: generation mismatch y cero binding." Unlike
# COSB-IDENTITY-SESSION-MISMATCH-REJECTED-UNCONSUMED above (a DIFFERENT
# session_id), this exercises the SAME orchestrator session whose OWN
# generation rotates between B1 reservation-mint time and SubagentStart-
# consumption time. Direct read of tryConsumeClaudeAgentOneShotReservation
# (subagent-start-context-bundle.js) confirms this is ALREADY correctly
# enforced today (peekSessionGeneration re-derived fresh at consumption time,
# compared by exact equality against the reservation's own stored
# session_generation_id, `owning:false` -- i.e. zero binding -- on any
# mismatch) -- this is a POSITIVE regression guard proving the item 5
# requirement already holds end-to-end through the real hook, not a RED.
# createClaudeOneShotBinding itself has no session_generation_id parameter to
# mismatch against in isolation (confirmed by direct read) -- the generation
# check necessarily lives at this caller, which this test drives directly.
# ══════════════════════════════════════════════════════════════════════════

@test "COSB-E2E-GENERATION-ROTATION-REJECTED-ZERO-BINDING: a B1 reservation minted under session generation G1 is rejected by a REAL SubagentStart arriving AFTER that SAME session's generation has rotated to a live G2 -- zero ClaudeOneShotBinding is created, never one silently bound to the new generation" {
  local proj; proj="$(_cosb_e2e_make_project)"
  local pub; pub="$(_cosb_e2e_publish_request "$proj" "arch-testing")"
  local request_id artifact_ref; read -r request_id artifact_ref <<< "$pub"
  local native_spawn_action_id
  native_spawn_action_id="$(_cosb_e2e_construct_claude_agent_activation "$proj" "$artifact_ref")"
  run _cosb_e2e_mint_b1_reservation "$proj" "arch-testing" "$request_id"
  [ "$status" -eq 0 ]

  # Force G1 -> G2 rotation for the IDENTICAL orchestrator session the
  # reservation was minted under: expire G1's own record directly (tamper,
  # never a raw delete -- mirrors this file's own established tamper
  # convention), then resolveSessionGeneration (mint-or-reuse, exported)
  # mints a genuinely fresh, live G2 in its place.
  run node -e '
    const rll = require(process.argv[1]);
    const fs = require("fs");
    const projectRoot = process.argv[2];
    const identity = { provider: "claude-hook", runtime_session_key: "cosb-e2e-orchestrator-session" };
    const genPath = rll.sessionGenerationPathFor(projectRoot, identity);
    const before = JSON.parse(fs.readFileSync(genPath, "utf8"));
    before.expires_at = "2000-01-01T00:00:00Z";
    fs.writeFileSync(genPath, JSON.stringify(before));
    const rotated = rll.resolveSessionGeneration(projectRoot, identity);
    if (!rotated.ok) { process.stderr.write("G2 mint failed: " + JSON.stringify(rotated)); process.exit(1); }
    if (rotated.generationId === before.generation_id) { process.stderr.write("fixture sanity: G2 must differ from G1"); process.exit(1); }
    process.stdout.write(before.generation_id + " " + rotated.generationId);
  ' "$RLL_IMPL" "$proj"
  [ "$status" -eq 0 ]
  local g1_id g2_id; read -r g1_id g2_id <<< "$output"
  [ -n "$g1_id" ]
  [ -n "$g2_id" ]
  [ "$g1_id" != "$g2_id" ]

  # Confirm the reservation itself genuinely still carries G1 (never silently
  # updated by the rotation above) -- isolates "the reservation is stale" from
  # "the reservation was somehow mutated along with the generation".
  run node -e '
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const coordRoot = rll.coordinationRootPathFor(projectRoot);
    const repoId = rll.computeRepoId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    const found = rc.findLiveClaudeAgentActivations(coordRoot, repoId, process.argv[4], planResult.planDigest, "arch-testing");
    if (found.length !== 1) { process.stderr.write("expected exactly 1 live activation"); process.exit(1); }
    process.stdout.write("checked");
  ' "$RLL_IMPL" "$RC_IMPL" "$proj" "$COSB_E2E_WAVE_SLUG"
  [ "$status" -eq 0 ]

  local hook_status
  hook_status="$(_cosb_e2e_subagent_start "$proj" "arch-testing" "cosb-e2e-orchestrator-session" "cosb-e2e-spawned-agent-id")"
  [ "$hook_status" = "0" ]
  local binding_id; binding_id="$(_cosb_e2e_find_binding_by_action_id "$proj" "$native_spawn_action_id")"
  [ -z "$binding_id" ]

  rm -rf "$proj"
}

@test "COSB-E2E-TARGET-GATE-WRONG-AGENT-TYPE: a claim command from a DIFFERENT calling role than the one the binding was minted for is BLOCKED by runtime-consultation-target-gate.js's universal request-resolved scope gate, never silently resolved" {
  local proj; proj="$(_cosb_e2e_make_project)"
  local pub; pub="$(_cosb_e2e_publish_request "$proj" "arch-testing")"
  local request_id artifact_ref; read -r request_id artifact_ref <<< "$pub"
  local native_spawn_action_id
  native_spawn_action_id="$(_cosb_e2e_construct_claude_agent_activation "$proj" "$artifact_ref")"
  run _cosb_e2e_mint_b1_reservation "$proj" "arch-testing" "$request_id"
  [ "$status" -eq 0 ]
  local hook_status
  hook_status="$(_cosb_e2e_subagent_start "$proj" "arch-testing" "cosb-e2e-orchestrator-session" "cosb-e2e-spawned-agent-id")"
  [ "$hook_status" = "0" ]
  local binding_id; binding_id="$(_cosb_e2e_find_binding_by_action_id "$proj" "$native_spawn_action_id")"
  [ -n "$binding_id" ]

  local coord_root; coord_root="$(node -e 'const rll=require(process.argv[1]);process.stdout.write(rll.coordinationRootPathFor(process.argv[2]));' "$RLL_IMPL" "$proj")"
  local target_input_file; target_input_file="$(mktemp)"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const rll = require(process.argv[5]);
    const IMPL = path.resolve(process.argv[1]);
    const command = rll.renderPosixDirect(["node", IMPL, "claim", "--coordination-root", process.argv[2], "--request", process.argv[3]]);
    fs.writeFileSync(process.argv[4], JSON.stringify({
      tool_name: "Bash", tool_input: { command },
      agent_type: "test-specialist", session_id: "cosb-e2e-wrong-role-session", agent_id: "cosb-e2e-wrong-role-agent-id",
    }));
  ' "$RC_IMPL" "$coord_root" "$artifact_ref" "$target_input_file" "$RLL_IMPL"

  run bash -c "cat '$target_input_file' | CLAUDE_PROJECT_DIR='$proj' node '$TARGET_GATE_HOOK'"
  _assert_pretooluse_deny
  [[ "$output" == *"request-resolved target_role/worktree_id/plan_digest does not match the calling identity/current project scope."* ]]
  rm -f "$target_input_file"
  rm -rf "$proj"
}

# Shared prefix for the three COSB-TARGET-GATE-* identity tests below: runs
# the full E2E chain to a genuine ClaudeOneShotBinding (runtime_session_key
# "cosb-e2e-orchestrator-session", agent_id "cosb-e2e-spawned-agent-id",
# agent_type "arch-testing" -- _cosb_e2e_happy_path_to_binding's own fixed
# identity), then feeds a claim command to the REAL target-gate hook with the
# given session_id/agent_id, printing "<status>\n<output>".
_cosb_target_gate_claim_with_identity() {
  local proj="$1" coord_root="$2" artifact_ref="$3" session_id="$4" agent_id="$5"
  local target_input_file; target_input_file="$(mktemp)"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const rll = require(process.argv[7]);
    const IMPL = path.resolve(process.argv[1]);
    const command = rll.renderPosixDirect(["node", IMPL, "claim", "--coordination-root", process.argv[2], "--request", process.argv[3]]);
    fs.writeFileSync(process.argv[6], JSON.stringify({
      tool_name: "Bash", tool_input: { command },
      agent_type: "arch-testing", session_id: process.argv[4], agent_id: process.argv[5],
    }));
  ' "$RC_IMPL" "$coord_root" "$artifact_ref" "$session_id" "$agent_id" "$target_input_file" "$RLL_IMPL"
  local status_code
  cat "$target_input_file" | CLAUDE_PROJECT_DIR="$proj" node "$TARGET_GATE_HOOK" >"${target_input_file}.out" 2>/dev/null
  status_code=$?
  printf '%s\n' "$status_code"
  cat "${target_input_file}.out"
  rm -f "$target_input_file" "${target_input_file}.out"
}

@test "COSB-TARGET-GATE-WRONG-SESSION-ID: a claim command whose session_id does NOT match the ClaudeOneShotBinding's own runtime_session_key is BLOCKED, even though role/agent_id are otherwise exactly correct -- no grant minted. M7 FINAL IDENTITY CLOSURE point 2 (handleConsultationTargetOwning's new three-field equality check)." {
  local proj; proj="$(_cosb_e2e_make_project)"
  local chain; chain="$(_cosb_e2e_happy_path_to_binding "$proj")"
  local binding_id coord_root artifact_ref; read -r binding_id coord_root artifact_ref <<< "$chain"
  [ -n "$binding_id" ]

  local result; result="$(_cosb_target_gate_claim_with_identity "$proj" "$coord_root" "$artifact_ref" "cosb-identity-WRONG-session" "cosb-e2e-spawned-agent-id")"
  local status_code; status_code="$(printf '%s' "$result" | head -1)"
  local output; output="$(printf '%s' "$result" | tail -n +2)"
  _assert_pretooluse_deny_values "$status_code" "$output"
  [[ "$output" == *"identity"* ]]
  rm -rf "$proj"
}

@test "COSB-TARGET-GATE-WRONG-AGENT-ID: a claim command whose agent_id does NOT match the ClaudeOneShotBinding's own agent_id is BLOCKED, even though role/session_id are otherwise exactly correct -- no grant minted. M7 FINAL IDENTITY CLOSURE point 2." {
  local proj; proj="$(_cosb_e2e_make_project)"
  local chain; chain="$(_cosb_e2e_happy_path_to_binding "$proj")"
  local binding_id coord_root artifact_ref; read -r binding_id coord_root artifact_ref <<< "$chain"
  [ -n "$binding_id" ]

  local result; result="$(_cosb_target_gate_claim_with_identity "$proj" "$coord_root" "$artifact_ref" "cosb-e2e-orchestrator-session" "cosb-identity-WRONG-agent-id")"
  local status_code; status_code="$(printf '%s' "$result" | head -1)"
  local output; output="$(printf '%s' "$result" | tail -n +2)"
  _assert_pretooluse_deny_values "$status_code" "$output"
  [[ "$output" == *"identity"* ]]
  rm -rf "$proj"
}

@test "COSB-TARGET-GATE-EXACT-IDENTITY-GRANTS: a claim command whose session_id/agent_id/agent_type ALL match the ClaudeOneShotBinding exactly is ALLOWED, with a real --target-binding grant injected -- control case proving the two BLOCK tests above are attributable to their own specific mismatch, not a blanket rejection. M7 FINAL IDENTITY CLOSURE point 2." {
  local proj; proj="$(_cosb_e2e_make_project)"
  local chain; chain="$(_cosb_e2e_happy_path_to_binding "$proj")"
  local binding_id coord_root artifact_ref; read -r binding_id coord_root artifact_ref <<< "$chain"
  [ -n "$binding_id" ]

  local result; result="$(_cosb_target_gate_claim_with_identity "$proj" "$coord_root" "$artifact_ref" "cosb-e2e-orchestrator-session" "cosb-e2e-spawned-agent-id")"
  local status_code; status_code="$(printf '%s' "$result" | head -1)"
  local output; output="$(printf '%s' "$result" | tail -n +2)"
  [ "$status_code" = "0" ]
  [[ "$output" == *'"permissionDecision":"allow"'* ]]
  [[ "$output" == *"--target-binding"* ]]
  rm -rf "$proj"
}

@test "COSB-FENCE-THEN-REPLAY-REJECTED: a binding whose identity is fenced fails closed on any subsequent use with 'authority-fenced' -- proves spec point 7's 'retired binding' AND 'replayed binding' together (replaying a binding IS attempting to use it after its authority was cut in this design), corrected for M7 (fence replaces the removed .retired marker/writer)" {
  local proj; proj="$(_cosb_make_project)"
  local out binding_id worktree_id plan_digest
  out="$(_cosb_mint_binding "$proj")"; read -r binding_id worktree_id plan_digest <<< "$out"
  [ -n "$binding_id" ]

  # Control: genuinely live before the fence.
  local before; before="$(_cosb_validate "$proj" "$binding_id" "$(printf 'b%.0s' {1..64})" "$(printf 'c%.0s' {1..64})" 0 arch-testing "$worktree_id" "$plan_digest")"
  [ "$before" = "true NONE" ]

  # _cosb_mint_binding's own fixed identity tuple (confirmed by direct read
  # of its own hardcoded params): session "cosb-session", agent "cosb-agent-id".
  run _cosb_plant_fence "$proj" "cosb-session" "cosb-agent-id"
  [ "$status" -eq 0 ]

  # A replay attempt (any subsequent validate against the SAME still-correct
  # scope) fails closed -- never "still valid because nothing changed about
  # the scope fields themselves".
  local after; after="$(_cosb_validate "$proj" "$binding_id" "$(printf 'b%.0s' {1..64})" "$(printf 'c%.0s' {1..64})" 0 arch-testing "$worktree_id" "$plan_digest")"
  [ "$after" = "false authority-fenced" ]

  # Idempotent fence publish (M7 section 3.2: "published via fd-accredited
  # publishNoClobber (idempotent no-clobber)") -- a SECOND plant call for the
  # SAME identity is still ok:true, never an error, and the identity stays
  # fenced.
  run _cosb_plant_fence "$proj" "cosb-session" "cosb-agent"
  [ "$status" -eq 0 ]

  _cosb_cleanup_project "$proj"
}

@test "COSB-E2E-SUBAGENTSTOP-FENCES-PROSE-ONLY-RETURN: a SubagentStop for a binding that NEVER had a durable result published still cuts the binding's authority via a real, durable identity fence -- proves spec point 7's 'prose-only Agent return sin resultado durable' can never leave the one-shot window open, corrected for M7 (fence replaces the removed .retired marker)" {
  local proj; proj="$(_cosb_e2e_make_project)"
  local out binding_id worktree_id plan_digest
  out="$(_cosb_mint_binding "$proj" 3600)"; read -r binding_id worktree_id plan_digest <<< "$out"
  [ -n "$binding_id" ]

  # Control: genuinely live before the spawn ever "returns".
  local before; before="$(_cosb_validate "$proj" "$binding_id" "$(printf 'b%.0s' {1..64})" "$(printf 'c%.0s' {1..64})" 0 arch-testing "$worktree_id" "$plan_digest")"
  [ "$before" = "true NONE" ]

  # Fixture sanity: no fence exists yet for this exact identity before the
  # stop -- proves the SUBSEQUENT fence-existence check below is genuinely
  # attributable to the real hook run, never a pre-existing artifact.
  local fence_before
  fence_before="$(node -e '
    const rll = require(process.argv[1]);
    const repoDescriptor = { repoId: rll.computeRepoId(process.argv[2]) };
    const id = rll.computeClaudeAuthorityIdentityId(repoDescriptor, "claude-hook", "cosb-session", "cosb-agent-id");
    const read = rll.readClaudeAuthorityFence(repoDescriptor, id);
    process.stdout.write(String(read.ok && read.absent));
  ' "$RLL_IMPL" "$proj")"
  [ "$fence_before" = "true" ]

  # No publish-result / terminal-result trigger anywhere in this test -- the
  # Agent() call is simulated as returning PURE PROSE, no durable artifact at
  # all. SubagentStop is the ONLY authority-cutting trigger exercised here.
  local input_file; input_file="$(mktemp)"
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({
      hook_event_name: "SubagentStop", agent_type: "arch-testing",
      session_id: "cosb-session", agent_id: "cosb-agent-id",
    }));
  ' "$input_file"
  run bash -c "cat '$input_file' | CLAUDE_PROJECT_DIR='$proj' node '$HOOK'"
  [ "$status" -eq 0 ]
  rm -f "$input_file"

  # M7 correction (2026-08-17): the binding's own authority is cut via the
  # durable identity fence, never a per-binding .retired marker (removed --
  # M7 section 4/8.5). validateClaudeOneShotBindingFor's own fence check
  # (confirmed by direct read) now rejects with authority-fenced, not
  # claude-one-shot-binding-retired.
  local after; after="$(_cosb_validate "$proj" "$binding_id" "$(printf 'b%.0s' {1..64})" "$(printf 'c%.0s' {1..64})" 0 arch-testing "$worktree_id" "$plan_digest")"
  [ "$after" = "false authority-fenced" ]

  # The fence is genuinely durable (non-absent) for THIS exact identity --
  # proves the real hook run above is what produced it, not a coincidental
  # side effect of the (superseded) validate call.
  run node -e '
    const rll = require(process.argv[1]);
    const repoDescriptor = { repoId: rll.computeRepoId(process.argv[2]) };
    const id = rll.computeClaudeAuthorityIdentityId(repoDescriptor, "claude-hook", "cosb-session", "cosb-agent-id");
    const read = rll.readClaudeAuthorityFence(repoDescriptor, id);
    if (!read.ok) { process.stderr.write("fence read failed: " + JSON.stringify(read)); process.exit(1); }
    if (read.absent) { process.stderr.write("fence unexpectedly absent after a real SubagentStop for a canonical owning role"); process.exit(1); }
  ' "$RLL_IMPL" "$proj"
  [ "$status" -eq 0 ]

  _cosb_cleanup_project "$proj"
}

# ══════════════════════════════════════════════════════════════════════════
# Terminal retirement-trigger matrix (Block 4, verdict doc point 8, relayed
# from Codex 2026-08-09): "terminal-result retira; cancellation retira;
# SubagentStop exacto retira; expiry invalida; wrong session/agent/type no
# retira; Agent ad-hoc sin binding es no-op; dos bindings coincidentes =>
# STOP; RoleActorBinding nunca se retira por esta ruta; fallo de escritura/
# fsync del marker no se presenta como éxito; segundo trigger concurrente/
# idempotente acepta solo marker válido; después de retirar, target gate no
# puede mintar otro grant; settings/sync registran SubagentStop exactamente
# una vez." Mapping: SubagentStop-exact/expiry/settings-sync were already
# covered above (COSB-E2E-SUBAGENTSTOP-RETIRES-PROSE-ONLY-RETURN,
# COSB-VALIDATE-EXPIRED, mcp-server/tests/integration/sync-settings-merge.test.ts
# respectively) -- the remaining 9 items are covered by the tests below.
# ══════════════════════════════════════════════════════════════════════════

# Mints a target-authority role-command-grant/v1 backed by the given
# ClaudeOneShotBinding, mirroring runtime-consultation-target-gate.js's own
# handleConsultationTargetOwning mint call exactly (same requestId/attemptId/
# leaseEpoch resolution via rc.resolveActivationForRequestPath off the
# argv's own --request value, same argv-digest formula). Prints the grant_id.
_cosb_e2e_mint_target_grant() {
  local proj="$1" binding_id="$2" subcommand="$3"; shift 3
  node -e '
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const bindingId = process.argv[4];
    const subcommand = process.argv[5];
    const rest = process.argv.slice(6);
    const reqIdx = rest.indexOf("--request");
    const requestPath = reqIdx !== -1 ? rest[reqIdx + 1] : null;
    let grantRequestId = null, grantAttemptId = null, grantLeaseEpoch = null;
    if (requestPath) {
      const resolved = rc.resolveActivationForRequestPath(requestPath);
      if (resolved.ok) { grantRequestId = resolved.requestId; grantAttemptId = resolved.attemptId; grantLeaseEpoch = resolved.leaseEpoch; }
    }
    const bindingRead = rll.readRegistryRecord(rll.claudeOneShotBindingPathFor(projectRoot, bindingId));
    if (!bindingRead.ok || bindingRead.absent) { process.stderr.write("binding read failed"); process.exit(1); }
    const argvDigest = rc.sha256String(rc.canonicalJSONStringify(rest));
    const mintResult = rll.mintRoleCommandGrant(projectRoot, bindingRead.obj, "target", subcommand, argvDigest, grantRequestId, grantAttemptId, grantLeaseEpoch);
    if (!mintResult.ok) { process.stderr.write("mintRoleCommandGrant failed: " + JSON.stringify(mintResult)); process.exit(1); }
    process.stdout.write(mintResult.grantId);
  ' "$RLL_IMPL" "$RC_IMPL" "$proj" "$binding_id" "$subcommand" "$@"
}

# Mints a requester-authority role-command-grant/v1 -- same pattern
# _cosb_e2e_publish_request already uses inline for publish-request,
# generalized here over subcommand for cancel's own use below.
_cosb_e2e_mint_requester_grant() {
  local proj="$1" subcommand="$2"; shift 2
  node -e '
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const subcommand = process.argv[4];
    const rest = process.argv.slice(5);
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    if (!planResult.ok) { process.stderr.write("no PLAN discovered"); process.exit(1); }
    // M6+M7 requester-authority closure (Group D) fix: this helper has ONE
    // caller (COSB-E2E-CANCELLATION-RETIRES), which mints a cancel grant
    // against a request that was ALREADY durably published (via
    // _cosb_e2e_publish_request, identity session
    // "cosb-e2e-grant-session"/agent "cosb-e2e-grant-agent") -- cancel own
    // consumption now cross-references the grant backing binding
    // actor_instance_id against that request own requester_instance_id
    // (runtime-consultation.cjs validateAndConsumeRoleCommandGrantForCommand),
    // so this identity must be the EXACT SAME tuple the publisher used,
    // not an independently-different one: createRequesterBinding own
    // idempotent lookup-or-reuse then returns the SAME (already-live)
    // binding/actor_instance_id the request was published under, never a
    // fresh, unrelated one.
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: "cosb-e2e-grant-session" };
    const bindingResult = rll.createRequesterBinding(projectRoot, identity, "cosb-e2e-grant-agent", "arch-testing", worktreeId, planResult.planDigest, 3600);
    if (!bindingResult.ok) { process.stderr.write("createRequesterBinding failed: " + JSON.stringify(bindingResult)); process.exit(1); }
    // M6+M7 requester-authority closure (Group B) fix: cancel is a
    // TRANSACTIONAL requester-gated subcommand -- the grant own
    // request_id/attempt_id/lease_epoch triple must be the CURRENT
    // authoritative one (resolveRequesterGrantScope), never null/null/null,
    // or validateAndConsumeRoleCommandGrantForCommand own
    // request/attempt/epoch cross-check rejects it as AUTHORITY_INVALID
    // even once the identity tuple above already correlates correctly.
    function extractFlag(flagName) {
      const idx = rest.indexOf(flagName);
      return (idx !== -1 && idx + 1 < rest.length) ? rest[idx + 1] : undefined;
    }
    const scopeResult = rc.resolveRequesterGrantScope(subcommand, {
      "coordination-root": extractFlag("--coordination-root"),
      request: extractFlag("--request"),
      kind: extractFlag("--kind"),
    });
    if (!scopeResult.ok) { process.stderr.write("resolveRequesterGrantScope failed: " + JSON.stringify(scopeResult)); process.exit(1); }
    const argvDigest = rc.sha256String(rc.canonicalJSONStringify(rest));
    const mintResult = rll.mintRoleCommandGrant(projectRoot, bindingResult.binding, "requester", subcommand, argvDigest, scopeResult.requestId, scopeResult.attemptId, scopeResult.leaseEpoch);
    if (!mintResult.ok) { process.stderr.write("mintRoleCommandGrant failed: " + JSON.stringify(mintResult)); process.exit(1); }
    process.stdout.write(mintResult.grantId);
  ' "$RLL_IMPL" "$RC_IMPL" "$proj" "$subcommand" "$@"
}

# Drives the E2E chain through _cosb_e2e_subagent_start and prints
# "<binding_id> <coord_root>" -- the common prefix every test below needs.
_cosb_e2e_happy_path_to_binding() {
  local proj="$1" pub request_id artifact_ref native_spawn_action_id hook_status binding_id coord_root
  pub="$(_cosb_e2e_publish_request "$proj" "arch-testing")"
  read -r request_id artifact_ref <<< "$pub"
  native_spawn_action_id="$(_cosb_e2e_construct_claude_agent_activation "$proj" "$artifact_ref")"
  _cosb_e2e_mint_b1_reservation "$proj" "arch-testing" "$request_id" >/dev/null || return 1
  # M7 FINAL IDENTITY CLOSURE: SubagentStart's own session_id must now
  # re-derive the SAME session generation the reservation was minted under
  # (_cosb_e2e_mint_b1_reservation's own hardcoded "cosb-e2e-orchestrator-
  # session" identity) -- a genuinely different session string is exactly
  # what COSB-IDENTITY-SESSION-MISMATCH-REJECTED-UNCONSUMED below tests.
  hook_status="$(_cosb_e2e_subagent_start "$proj" "arch-testing" "cosb-e2e-orchestrator-session" "cosb-e2e-spawned-agent-id")"
  [ "$hook_status" = "0" ] || return 1
  binding_id="$(_cosb_e2e_find_binding_by_action_id "$proj" "$native_spawn_action_id")"
  [ -n "$binding_id" ] || return 1
  coord_root="$(node -e 'const rll=require(process.argv[1]);process.stdout.write(rll.coordinationRootPathFor(process.argv[2]));' "$RLL_IMPL" "$proj")"
  printf '%s %s %s' "$binding_id" "$coord_root" "$artifact_ref"
}

# Asserts binding is retired with EXACTLY `reason`. Fails if absent or wrong reason.
_cosb_assert_retired_reason() {
  local proj="$1" binding_id="$2" expected_reason="$3"
  node -e '
    const rll = require(process.argv[1]);
    const rec = rll.readRegistryRecord(rll.claudeOneShotBindingRetiredMarkerPathFor(process.argv[2], process.argv[3]));
    if (!rec.ok || rec.absent) { process.stderr.write("not retired"); process.exit(1); }
    if (rec.obj.reason !== process.argv[4]) { process.stderr.write("wrong reason: " + rec.obj.reason); process.exit(1); }
  ' "$RLL_IMPL" "$proj" "$binding_id" "$expected_reason"
}

# Asserts binding is NOT retired (marker absent).
_cosb_assert_not_retired() {
  local proj="$1" binding_id="$2"
  node -e '
    const rll = require(process.argv[1]);
    const rec = rll.readRegistryRecord(rll.claudeOneShotBindingRetiredMarkerPathFor(process.argv[2], process.argv[3]));
    if (!rec.ok) process.exit(1);
    if (!rec.absent) { process.stderr.write("unexpectedly retired: " + JSON.stringify(rec.obj)); process.exit(1); }
  ' "$RLL_IMPL" "$proj" "$binding_id"
}

# M7 defect 10/9 retirement-mechanics redesign (2026-08-17 correction pass):
# authority is cut via the durable identity fence now (M7 section 3.2/8.4),
# never a per-binding .retired marker (retireClaudeOneShotBinding, the
# former writer, no longer exists at all -- confirmed by direct read,
# typeof rll.retireClaudeOneShotBinding === "undefined"). These two helpers
# replace this file's own former retire-call convention for every test in
# the "Terminal retirement-trigger matrix" section that genuinely needs a
# fenced identity as its fixture precondition, mirroring runtime-role-
# lifecycle-registry.test.js's own m7PlantFence/m7ComputeAuthorityIdentityId
# convention (established in that file's own M7 race-fence tests) rather
# than inventing a third, divergent helper shape.

# Computes the exact authority_identity_id for a claude-hook (session,agent)
# tuple -- the SAME closed section-3.1 identity shape classifyClaudeAuthorityForIdentity
# itself derives internally, never re-implemented by hand here.
_cosb_authority_identity_id() {
  local proj="$1" session_id="$2" agent_id="$3"
  node -e '
    const rll = require(process.argv[1]);
    const identity = {
      schema: rll.CLAUDE_AUTHORITY_IDENTITY_SCHEMA, provider: "claude-hook",
      repo_id: rll.computeRepoId(process.argv[2]), runtime_session_key: process.argv[3], agent_id: process.argv[4],
    };
    process.stdout.write(rll.computeClaudeAuthorityIdentityId({ repoId: identity.repo_id }, "claude-hook", process.argv[3], process.argv[4]));
  ' "$RLL_IMPL" "$proj" "$session_id" "$agent_id"
}

# Publishes a REAL, durable identity fence via the production primitive
# (publishClaudeAuthorityFence, no-clobber -- idempotent per M7 section 3.2)
# for the given (session,agent) tuple, simulating "this actor has already
# genuinely stopped" without needing to drive a full SubagentStop event.
_cosb_plant_fence() {
  local proj="$1" session_id="$2" agent_id="$3"
  node -e '
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const repoDescriptor = { repoId: rll.computeRepoId(projectRoot) };
    const authorityIdentityId = rll.computeClaudeAuthorityIdentityId(repoDescriptor, "claude-hook", process.argv[3], process.argv[4]);
    const result = rll.publishClaudeAuthorityFence(repoDescriptor, authorityIdentityId);
    if (!result.ok) { process.stderr.write("fence plant failed: " + JSON.stringify(result)); process.exit(1); }
  ' "$RLL_IMPL" "$proj" "$session_id" "$agent_id"
}

@test "COSB-E2E-TERMINAL-RESULT-BLOCKS-FURTHER-MINT: after a real target-gated publish-result durably succeeds through its ClaudeOneShotBinding, a FURTHER target-authority mint against that same transaction is denied claude-one-shot-transaction-terminal -- verdict Block 4 point 3, corrected for M7" {
  local proj; proj="$(_cosb_e2e_make_project)"
  local chain; chain="$(_cosb_e2e_happy_path_to_binding "$proj")"
  local binding_id coord_root artifact_ref; read -r binding_id coord_root artifact_ref <<< "$chain"
  [ -n "$binding_id" ]

  local claim_grant
  claim_grant="$(_cosb_e2e_mint_target_grant "$proj" "$binding_id" claim --coordination-root "$coord_root" --request "$artifact_ref" --role arch-testing)"
  [ -n "$claim_grant" ]
  local claim_output
  claim_output="$(NODE_ENV=test node "$RC_IMPL" claim --coordination-root "$coord_root" --request "$artifact_ref" --role arch-testing --target-binding "$claim_grant" 2>/dev/null)"
  local claim_artifact_ref
  claim_artifact_ref="$(node -e '
    const d = JSON.parse(process.argv[1]);
    if (!d.ok) { process.stderr.write("claim failed: " + process.argv[1]); process.exit(1); }
    process.stdout.write(d.artifact_ref);
  ' "$claim_output")"
  [ -n "$claim_artifact_ref" ]

  local content_b64; content_b64="$(printf 'test result content' | node -e 'process.stdout.write(Buffer.from(require("fs").readFileSync(0)).toString("base64url"))')"
  local pr_grant
  pr_grant="$(_cosb_e2e_mint_target_grant "$proj" "$binding_id" publish-result --coordination-root "$coord_root" --request "$artifact_ref" --claim "$claim_artifact_ref" --content "$content_b64")"
  [ -n "$pr_grant" ]
  run node "$RC_IMPL" publish-result --coordination-root "$coord_root" --request "$artifact_ref" --claim "$claim_artifact_ref" --content "$content_b64" --target-binding "$pr_grant"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"status":"SUCCESS"'* ]]

  # M7 defect 6 / checklist item 9 (2026-08-17 correction pass, replaces this
  # test's own former final assertion): "no new retirement artifact is ever
  # written" (M7 section 4/8.5, confirmed by direct read of runtime-
  # consultation.cjs's own main()) -- retireClaudeOneShotBinding and its own
  # .retired marker are gone; the CORRECT oracle per section 8.5 ("one-shot
  # publish-result is cut by the authoritative result") is the durable
  # results/<attempt>.json (result/v2, status ANSWERED) itself, proven here
  # by attempting a FURTHER target-authority mint against the SAME
  # now-terminal transaction and confirming denial. NOT a near-duplicate of
  # RED17 (M7-ONESHOT-TERMINAL-CUT-17, runtime-consultation-cli.test.js,
  # which proves this same mint-time denial via the cancel.json path only):
  # this test exercises the result/v2 (publish-result) path specifically,
  # which mintRoleCommandGrant's own terminal check does NOT currently
  # examine at all (defect 6 -- it only checks accepted-result.json/
  # cancel.json via a bare fs.existsSync, never the real results/ directory).
  run node -e '
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const path = require("path");
    const projectRoot = process.argv[3];
    const bindingId = process.argv[4];
    const artifactRef = process.argv[5];
    const bindingRead = rll.readRegistryRecord(rll.claudeOneShotBindingPathFor(projectRoot, bindingId));
    if (!bindingRead.ok || bindingRead.absent) { process.stderr.write("binding read failed"); process.exit(1); }
    const binding = bindingRead.obj;
    const txnDir = path.dirname(artifactRef);
    // Fixture sanity: a real, durable ANSWERED result/v2 now exists --
    // proves the chain above genuinely produced the authoritative artifact
    // this assertion targets, never a vacuous "nothing to find" pass.
    const found = rc.findResultWithStatus(txnDir, "ANSWERED");
    if (!found) { process.stderr.write("fixture sanity: no durable ANSWERED result found under " + txnDir); process.exit(1); }
    const argvDigest = rc.sha256String(rc.canonicalJSONStringify(["fixture-item9-argv"]));
    const grant = rll.mintRoleCommandGrant(projectRoot, binding, "target", "claim", argvDigest, binding.request_id, binding.attempt_id, binding.lease_epoch);
    if (grant.ok) {
      process.stderr.write("M7 defect 6 / checklist item 9: mintRoleCommandGrant must deny a FURTHER target-authority grant once a durable ANSWERED result/v2 already exists for this transaction -- today it only checks accepted-result.json/cancel.json via existsSync, never the actual results/ directory, so this wrongly succeeds: " + JSON.stringify(grant));
      process.exit(1);
    }
    if (grant.reason !== "claude-one-shot-transaction-terminal") { process.stderr.write("wrong denial reason: " + JSON.stringify(grant)); process.exit(1); }
  ' "$RLL_IMPL" "$RC_IMPL" "$proj" "$binding_id" "$artifact_ref"
  [ "$status" -eq 0 ]
  rm -rf "$proj"
}

# M7 defect 6 / checklist item 9 correction pass (2026-08-17): the former
# COSB-E2E-CANCELLATION-RETIRES test asserted retireClaudeOneShotBinding's own
# .retired marker (reason 'cancellation') as the terminal-cut mechanism after
# a real cancel -- that marker/writer no longer exists (M7 section 4/8.5, "no
# new retirement artifact is ever written... cancellation of a one-shot
# target is cut by canonical cancel.json"). Deleted rather than rewritten:
# the corrected oracle (mintRoleCommandGrant denies a further target-authority
# grant, reason claude-one-shot-transaction-terminal, once cancel.json is
# durable) would be a near-duplicate of an ALREADY-EXISTING, already-verified
# test -- M7-ONESHOT-TERMINAL-CUT-17 (runtime-consultation-cli.test.js),
# which proves exactly this denial via the cancel.json path directly against
# a ClaudeOneShotBinding. The one property this test additionally exercised
# (the binding being real-hook-derived via the full B1/SubagentStart E2E
# chain, rather than minted directly) is not specific to the cancellation
# path -- it is already covered generically by COSB-E2E-HAPPY-PATH and this
# file's other E2E tests using the identical _cosb_e2e_happy_path_to_binding
# chain.

@test "COSB-E2E-SUBAGENTSTOP-WRONG-IDENTITY-DOES-NOT-RETIRE: a SubagentStop whose session_id/agent_id/agent_type do NOT match any live binding leaves the actual live binding completely untouched -- verdict Block 4 point 8 'wrong session/agent/type no retira'" {
  local proj; proj="$(_cosb_make_project)"
  local out binding_id worktree_id plan_digest
  out="$(_cosb_mint_binding "$proj")"; read -r binding_id worktree_id plan_digest <<< "$out"
  [ -n "$binding_id" ]

  local input_file; input_file="$(mktemp)"
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({
      hook_event_name: "SubagentStop", agent_type: "test-specialist",
      session_id: "totally-different-session", agent_id: "totally-different-agent-id",
    }));
  ' "$input_file"
  run bash -c "cat '$input_file' | CLAUDE_PROJECT_DIR='$proj' node '$HOOK'"
  [ "$status" -eq 0 ]
  rm -f "$input_file"

  run _cosb_assert_not_retired "$proj" "$binding_id"
  [ "$status" -eq 0 ]
  local still_live; still_live="$(_cosb_validate "$proj" "$binding_id" "$(printf 'b%.0s' {1..64})" "$(printf 'c%.0s' {1..64})" 0 arch-testing "$worktree_id" "$plan_digest")"
  [ "$still_live" = "true NONE" ]
  _cosb_cleanup_project "$proj"
}

@test "COSB-E2E-SUBAGENTSTOP-NO-BINDING-NOOP: a SubagentStop for an ordinary ad-hoc Agent with NO one-shot binding at all is a silent no-op -- verdict Block 4 point 8 'Agent ad-hoc sin binding es no-op'" {
  local proj; proj="$(_cosb_make_project)"
  local input_file; input_file="$(mktemp)"
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({
      hook_event_name: "SubagentStop", agent_type: "arch-testing",
      session_id: "no-binding-session", agent_id: "no-binding-agent-id",
    }));
  ' "$input_file"
  run bash -c "cat '$input_file' | CLAUDE_PROJECT_DIR='$proj' node '$HOOK' 2>&1 1>/dev/null"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  rm -f "$input_file"
  _cosb_cleanup_project "$proj"
}

# M7 CORRECTION (2026-08-17): defects 1/2's now-landed admission-time
# duplicate/cross-family rejection mean a SECOND createClaudeOneShotBinding
# call for the identical (session,agent) identity no longer mints an
# independently-live second binding -- it now correctly reuses the SAME
# binding_id (M7-ONESHOT-DUPLICATE-IDENTICAL-CREATE,
# runtime-role-lifecycle-registry.test.js). Tests below that need TWO
# simultaneously-live one-shot bindings for the SAME identity (to exercise
# handleSubagentStop's own ambiguity handling -- a SEPARATE property from
# creation-time admission, already covered by M7-CROSS-FAMILY-CREATE-REJECTED
# and its siblings) must construct the second one directly, mirroring
# runtime-role-lifecycle-registry.test.js's own M7-CROSS-FAMILY-AMBIGUITY-21
# precedent: plant a byte-for-byte valid runtime/claude-one-shot-binding/v2
# record via the SAME secure writeRegistryRecordReplace primitive every real
# creator uses, at the exact path a real createClaudeOneShotBinding call
# would occupy -- simulating the diagnostic-record-left-behind scenario M7
# section 6 itself anticipates ("Concurrent cross-family writers may leave
# two diagnostic records..."), never going through the (now correctly
# stricter) creation API a second time. Mints with the SAME session/agent/
# role/action/request/attempt/epoch field values _cosb_mint_binding itself
# hardcodes (so both bindings validate identically, matching this file's own
# pre-existing test expectations, and matching what a second
# _cosb_mint_binding call would itself have produced pre-fix), but a
# genuinely fresh binding_id/actor_instance_id. Prints
# "<binding_id> <worktree_id> <plan_digest>", matching _cosb_mint_binding's
# own output contract exactly so callers need no other change.
_cosb_plant_conflicting_binding() {
  local proj="$1"
  node -e '
    const crypto = require("crypto");
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    if (!planResult.ok) { process.stderr.write("no PLAN discovered"); process.exit(1); }
    const identity = { provider: "claude-hook", runtime_session_key: "cosb-session" };
    const genResult = rll.resolveSessionGeneration(projectRoot, identity);
    if (!genResult.ok) { process.stderr.write("session generation failed: " + JSON.stringify(genResult)); process.exit(1); }
    const bindingId = crypto.randomBytes(16).toString("hex");
    const record = {
      schema: "runtime/claude-one-shot-binding/v2",
      binding_id: bindingId,
      actor_instance_id: crypto.randomBytes(16).toString("hex"),
      runtime_session_key: "cosb-session",
      agent_id: "cosb-agent-id",
      agent_type: "arch-testing",
      native_spawn_action_id: "a".repeat(32),
      request_id: "b".repeat(64),
      attempt_id: "c".repeat(64),
      lease_epoch: 0,
      role: "arch-testing",
      worktree_id: worktreeId,
      plan_digest: planResult.planDigest,
      session_generation_id: genResult.generationId,
      created_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      expiry: new Date(Date.now() + 3600000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    };
    const recordPath = rll.claudeOneShotBindingPathFor(projectRoot, bindingId);
    const planted = rll.writeRegistryRecordReplace(recordPath, Buffer.from(JSON.stringify(record), "utf8"));
    if (!planted.ok) { process.stderr.write("plant failed: " + JSON.stringify(planted)); process.exit(1); }
    process.stdout.write(bindingId + " " + worktreeId + " " + planResult.planDigest);
  ' "$RLL_IMPL" "$proj"
}

@test "COSB-E2E-SUBAGENTSTOP-AMBIGUOUS-TWO-BINDINGS-STOP: two genuinely live bindings sharing the identical session_id/agent_id/agent_type refuse to retire EITHER one, and say so via a real SubagentStop blocking decision -- verdict Block 4 point 8 'dos bindings coincidentes => STOP', M7 FINAL IDENTITY CLOSURE point 3 (SubagentStop can genuinely block, so this is decision:block + exit 0 per the official hookSpecificOutput-era SubagentStop protocol, never a stderr-only exit(0) with no decision)" {
  local proj; proj="$(_cosb_make_project)"
  local out1 binding_id_1 out2 binding_id_2 worktree_id plan_digest
  out1="$(_cosb_mint_binding "$proj")"; read -r binding_id_1 worktree_id plan_digest <<< "$out1"
  out2="$(_cosb_plant_conflicting_binding "$proj")"; read -r binding_id_2 worktree_id plan_digest <<< "$out2"
  [ -n "$binding_id_1" ]; [ -n "$binding_id_2" ]
  [ "$binding_id_1" != "$binding_id_2" ]

  local input_file; input_file="$(mktemp)"
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({
      hook_event_name: "SubagentStop", agent_type: "arch-testing",
      session_id: "cosb-session", agent_id: "cosb-agent-id",
    }));
  ' "$input_file"
  run bash -c "cat '$input_file' | CLAUDE_PROJECT_DIR='$proj' node '$HOOK'"
  _assert_subagentstop_block
  [[ "$output" == *"mbigu"* ]]
  rm -f "$input_file"

  run _cosb_assert_not_retired "$proj" "$binding_id_1"
  [ "$status" -eq 0 ]
  run _cosb_assert_not_retired "$proj" "$binding_id_2"
  [ "$status" -eq 0 ]
  # M7 CORRECTION (2026-08-17): _cosb_assert_not_retired above checks the
  # legacy .retired marker path, which is now permanently absent regardless
  # of outcome (the marker WRITER no longer exists -- M7 section 4/8.5) --
  # kept for continuity but no longer discriminating on its own. The real
  # proof both bindings survive the ambiguous block untouched is that each
  # STILL independently validates live via the real validator.
  local still_live_1; still_live_1="$(_cosb_validate "$proj" "$binding_id_1" "$(printf 'b%.0s' {1..64})" "$(printf 'c%.0s' {1..64})" 0 arch-testing "$worktree_id" "$plan_digest")"
  [ "$still_live_1" = "true NONE" ]
  local still_live_2; still_live_2="$(_cosb_validate "$proj" "$binding_id_2" "$(printf 'b%.0s' {1..64})" "$(printf 'c%.0s' {1..64})" 0 arch-testing "$worktree_id" "$plan_digest")"
  [ "$still_live_2" = "true NONE" ]
  _cosb_cleanup_project "$proj"
}

@test "COSB-E2E-SUBAGENTSTOP-STOP-HOOK-ACTIVE-DOES-NOT-BYPASS-AMBIGUOUS: stop_hook_active:true on an otherwise-ambiguous SubagentStop (two live bindings sharing identity) still blocks -- a retry signal must never be read as license to let an unresolved ambiguous retirement pass through and leave authority live" {
  local proj; proj="$(_cosb_make_project)"
  local out1 binding_id_1 out2 binding_id_2 worktree_id plan_digest
  out1="$(_cosb_mint_binding "$proj")"; read -r binding_id_1 worktree_id plan_digest <<< "$out1"
  out2="$(_cosb_plant_conflicting_binding "$proj")"; read -r binding_id_2 worktree_id plan_digest <<< "$out2"
  [ -n "$binding_id_1" ]; [ -n "$binding_id_2" ]
  [ "$binding_id_1" != "$binding_id_2" ]

  local input_file; input_file="$(mktemp)"
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({
      hook_event_name: "SubagentStop", agent_type: "arch-testing",
      session_id: "cosb-session", agent_id: "cosb-agent-id",
      stop_hook_active: true,
    }));
  ' "$input_file"
  run bash -c "cat '$input_file' | CLAUDE_PROJECT_DIR='$proj' node '$HOOK'"
  _assert_subagentstop_block
  [[ "$output" == *"mbigu"* ]]
  rm -f "$input_file"

  run _cosb_assert_not_retired "$proj" "$binding_id_1"
  [ "$status" -eq 0 ]
  run _cosb_assert_not_retired "$proj" "$binding_id_2"
  [ "$status" -eq 0 ]
  # M7 CORRECTION (2026-08-17): see the sibling AMBIGUOUS-TWO-BINDINGS-STOP
  # test's own identical rationale -- _cosb_assert_not_retired is no longer
  # discriminating on its own (legacy .retired marker path, permanently
  # absent). Real proof: each binding still independently validates live.
  local still_live_1; still_live_1="$(_cosb_validate "$proj" "$binding_id_1" "$(printf 'b%.0s' {1..64})" "$(printf 'c%.0s' {1..64})" 0 arch-testing "$worktree_id" "$plan_digest")"
  [ "$still_live_1" = "true NONE" ]
  local still_live_2; still_live_2="$(_cosb_validate "$proj" "$binding_id_2" "$(printf 'b%.0s' {1..64})" "$(printf 'c%.0s' {1..64})" 0 arch-testing "$worktree_id" "$plan_digest")"
  [ "$still_live_2" = "true NONE" ]
  _cosb_cleanup_project "$proj"
}

@test "COSB-E2E-SUBAGENTSTOP-MALFORMED-FENCE-BLOCKS: a genuine malformed pre-existing fence file for this exact identity blocks the stop via a real classification failure, never a silent stderr-only exit(0) -- M7 FINAL IDENTITY CLOSURE point 3, corrected for M7 (fence replaces the removed .retired marker/writer). A file that does not readClaudeAuthorityFence-parse as a well-formed fence is planted directly at the exact fence path (publishClaudeAuthorityFence's own writer no longer exists as a callable, hand-craftable success case since its LEGITIMATE output would just re-satisfy this same identity's ONE candidate). Empirically confirmed (2026-08-17): handleSubagentStop's own classifyClaudeAuthorityForIdentity call is the FIRST thing to read this exact path (its own very first statement, before shouldFence/publish is ever reached) -- so this test's genuine, verified failure point is classification, not the later publish call; named and documented accordingly rather than force-fit into the originally-intended (but unreachable, given the classifier reads first) publish-failure scenario." {
  local proj; proj="$(_cosb_make_project)"
  local out binding_id worktree_id plan_digest
  out="$(_cosb_mint_binding "$proj")"; read -r binding_id worktree_id plan_digest <<< "$out"
  [ -n "$binding_id" ]

  local fence_path
  fence_path="$(node -e '
    const rll = require(process.argv[1]);
    const repoDescriptor = { repoId: rll.computeRepoId(process.argv[2]) };
    const id = rll.computeClaudeAuthorityIdentityId(repoDescriptor, "claude-hook", "cosb-session", "cosb-agent-id");
    const p = rll.claudeAuthorityFencePathFor(process.argv[2], id);
    require("fs").mkdirSync(require("path").dirname(p), { recursive: true, mode: 0o700 });
    require("fs").writeFileSync(p, JSON.stringify({ schema: "runtime/claude-authority-fence/v1", not_a_real_fence: true }));
    process.stdout.write(p);
  ' "$RLL_IMPL" "$proj")"
  [ -n "$fence_path" ]

  local input_file; input_file="$(mktemp)"
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({
      hook_event_name: "SubagentStop", agent_type: "arch-testing",
      session_id: "cosb-session", agent_id: "cosb-agent-id",
    }));
  ' "$input_file"
  run bash -c "cat '$input_file' | CLAUDE_PROJECT_DIR='$proj' node '$HOOK'"
  _assert_subagentstop_block
  [[ "$output" == *"authority classification FAILED"* ]]
  [[ "$output" == *"authority-fence-invalid"* ]]
  rm -f "$input_file"

  # The failed write left no destructive trace on the underlying binding --
  # clear the malformed tamper and confirm the binding still validates live,
  # never silently fenced by the failed attempt.
  rm -f "$fence_path"
  local still_live; still_live="$(_cosb_validate "$proj" "$binding_id" "$(printf 'b%.0s' {1..64})" "$(printf 'c%.0s' {1..64})" 0 arch-testing "$worktree_id" "$plan_digest")"
  [ "$still_live" = "true NONE" ]

  _cosb_cleanup_project "$proj"
}

@test "COSB-RETIREMENT-NEVER-TOUCHES-ROLEACTORBINDING: a genuinely live RoleActorBinding is never found or fenced via the ClaudeOneShotBinding SubagentStop path, even when a matching one-shot binding ALSO exists -- verdict Block 4 point 8 'RoleActorBinding nunca se retira por esta ruta', corrected for M7 (fence replaces the removed .retired marker)" {
  local proj; proj="$(_cosb_make_project)"
  local worktree_id plan_digest
  worktree_id="$(node -e 'const rll=require(process.argv[1]);process.stdout.write(rll.computeWorktreeId(process.argv[2]));' "$RLL_IMPL" "$proj")"
  plan_digest="$(node -e 'const rll=require(process.argv[1]);const r=rll.discoverPlan(process.argv[2]);process.stdout.write(r.ok?r.planDigest:"");' "$RLL_IMPL" "$proj")"

  local role_actor_binding_id
  role_actor_binding_id="$(node -e '
    const rll = require(process.argv[1]);
    const result = rll.createRoleActorBinding(process.argv[2], "arch-testing", process.argv[3], process.argv[4], "a".repeat(32), 60);
    if (!result.ok) { process.stderr.write("mint failed: " + JSON.stringify(result)); process.exit(1); }
    process.stdout.write(result.binding.binding_id);
  ' "$RLL_IMPL" "$proj" "$worktree_id" "$plan_digest")"
  [ -n "$role_actor_binding_id" ]

  local out binding_id
  out="$(_cosb_mint_binding "$proj")"; read -r binding_id worktree_id plan_digest <<< "$out"
  [ -n "$binding_id" ]

  local input_file; input_file="$(mktemp)"
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({
      hook_event_name: "SubagentStop", agent_type: "arch-testing",
      session_id: "cosb-session", agent_id: "cosb-agent-id",
    }));
  ' "$input_file"
  run bash -c "cat '$input_file' | CLAUDE_PROJECT_DIR='$proj' node '$HOOK'"
  [ "$status" -eq 0 ]
  rm -f "$input_file"

  # The identity fence was genuinely published (regression anchor -- proves
  # the RUN above genuinely did something, not a vacuous pass). M7 correction
  # (2026-08-17): replaces the former .retired-marker regression anchor
  # (retireClaudeOneShotBinding no longer exists -- M7 section 4/8.5).
  run node -e '
    const rll = require(process.argv[1]);
    const repoDescriptor = { repoId: rll.computeRepoId(process.argv[2]) };
    const id = rll.computeClaudeAuthorityIdentityId(repoDescriptor, "claude-hook", "cosb-session", "cosb-agent-id");
    const read = rll.readClaudeAuthorityFence(repoDescriptor, id);
    if (!read.ok || read.absent) { process.stderr.write("fence unexpectedly absent: " + JSON.stringify(read)); process.exit(1); }
  ' "$RLL_IMPL" "$proj"
  [ "$status" -eq 0 ]

  # The RoleActorBinding is completely unaffected -- still validates true,
  # never scanned/matched/fenced by this path (RoleActorBinding remains
  # structurally outside the M7 Claude-actor-cut contract entirely -- M7
  # section 2.2, mirrors guard 27's own structural-isolation property).
  run node -e '
    const rll = require(process.argv[1]);
    const result = rll.validateRoleActorBindingFor(process.argv[2], process.argv[3], "arch-testing", process.argv[4], process.argv[5]);
    if (!result.ok) { process.stderr.write("unexpectedly invalid: " + result.reason); process.exit(1); }
  ' "$RLL_IMPL" "$proj" "$role_actor_binding_id" "$worktree_id" "$plan_digest"
  [ "$status" -eq 0 ]
  _cosb_cleanup_project "$proj"
}


# M7 retirement-mechanics correction pass (2026-08-17): the two tests former
# occupying this spot -- COSB-RETIRE-MARKER-WRITE-FAILURE-NEVER-SUCCESS
# ("a marker-write failure is propagated as ok:false, never silently
# presented as success") and COSB-RETIRE-IDEMPOTENT-REJECTS-CORRUPT-MARKER
# ("a corrupted existing marker is never trusted as idempotent success") --
# both called retireClaudeOneShotBinding directly (confirmed removed:
# typeof rll.retireClaudeOneShotBinding === "undefined", M7 section 4/8.5).
# Deleted rather than rewritten: their combined property (a malformed/
# unwritable authority artifact is never silently accepted as valid) is
# already proven, for the new fence-based mechanism, by
# COSB-E2E-SUBAGENTSTOP-MALFORMED-FENCE-BLOCKS above (same file) -- a
# malformed pre-existing fence file for a live identity genuinely blocks the
# real SubagentStop hook, never silently treated as "already fenced,
# therefore fine". A further rewrite here would be a near-duplicate of that
# already-verified coverage.

@test "COSB-E2E-POST-FENCE-TARGET-GATE-CANNOT-MINT: once the spawned actor's identity is fenced, runtime-consultation-target-gate.js can no longer resolve its binding for claim -- BLOCKED, never mints another grant -- verdict Block 4 point 8 'después de retirar, target gate no puede mintar otro grant', corrected for M7 (fence replaces the removed .retired marker)" {
  local proj; proj="$(_cosb_e2e_make_project)"
  local chain; chain="$(_cosb_e2e_happy_path_to_binding "$proj")"
  local binding_id coord_root artifact_ref; read -r binding_id coord_root artifact_ref <<< "$chain"
  [ -n "$binding_id" ]

  # _cosb_e2e_happy_path_to_binding's own fixed identity tuple (confirmed by
  # direct read of _cosb_e2e_mint_b1_reservation/_cosb_e2e_subagent_start's
  # own hardcoded params): session "cosb-e2e-orchestrator-session", agent
  # "cosb-e2e-spawned-agent-id".
  run _cosb_plant_fence "$proj" "cosb-e2e-orchestrator-session" "cosb-e2e-spawned-agent-id"
  [ "$status" -eq 0 ]
  # ATTRIBUTION DISCLOSURE (2026-08-17, mirrors the identical finding already
  # made and reported for the defect-9 context-gate half): this denial is
  # empirically produced by mintRoleCommandGrant's own downstream
  # admitClaudeAuthorityOperation('mint-grant',...) call (which DOES already
  # consult the classifier/fence), not by findLiveClaudeOneShotBindings
  # itself becoming fence-aware -- that resolver is still the defect-9
  # structural-absence target elsewhere in this suite. This test's own claim
  # (target-gate cannot mint once fenced) is genuinely true and worth
  # keeping; it is not, by itself, proof that the superseded resolver was
  # fixed.

  local target_input_file; target_input_file="$(mktemp)"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const rll = require(process.argv[5]);
    const IMPL = path.resolve(process.argv[1]);
    const command = rll.renderPosixDirect(["node", IMPL, "claim", "--coordination-root", process.argv[2], "--request", process.argv[3]]);
    fs.writeFileSync(process.argv[4], JSON.stringify({
      tool_name: "Bash", tool_input: { command },
      agent_type: "arch-testing", session_id: "cosb-e2e-spawned-session", agent_id: "cosb-e2e-spawned-agent-id",
    }));
  ' "$RC_IMPL" "$coord_root" "$artifact_ref" "$target_input_file" "$RLL_IMPL"

  run bash -c "cat '$target_input_file' | CLAUDE_PROJECT_DIR='$proj' node '$TARGET_GATE_HOOK'"
  _assert_pretooluse_deny
  [[ "$output" == *"no single live ClaudeOneShotBinding"* ]]
  rm -f "$target_input_file"
  rm -rf "$proj"
}

# ══════════════════════════════════════════════════════════════════════════
# M7 SUBAGENTSTOP CUSTOM-NAME (2026-08-15): Claude Code's real hook contract
# (code.claude.com/docs/en/hooks) reports agent_type as the Agent tool's
# custom `name` param, not `subagent_type`, whenever the two diverge -- for
# BOTH SubagentStart and SubagentStop. Confirmed by direct empirical capture
# of a live Agent(subagent_type=X, name=Y) spawn in this exact repo/session
# (a temporary capture-only wrapper substituted for the real hook in
# .claude/settings.json for one spawn, then reverted and diffed clean).
# There is NO second field (camelCase or snake_case) anywhere in the real
# payload carrying the canonical role -- confirmed by an exhaustive dump of
# the official docs AND a repo-wide grep, both empty. The fix therefore
# correlates by session_id+agent_id alone (both reliable per the same docs)
# and recovers the authoritative role from the durable record itself, never
# from any observed agent_type string. Pre-fix, this was empirically
# confirmed broken on BOTH sides, not merely at SubagentStop: a reservation
# minted under a real canonical role was left completely unconsumed and NO
# ClaudeOneShotBinding was ever created, because
# tryConsumeClaudeAgentOneShotReservation searched reservations BY the raw
# (customer-name) agent_type value AS IF it were the role. This section
# therefore covers the SubagentStart mint-side correlation AND the
# SubagentStop retire-side correlation together -- fixing SubagentStop alone
# would leave every custom-named claude-agent spawn permanently unable to
# get a one-shot binding at all.
# ══════════════════════════════════════════════════════════════════════════

# Mirrors _cosb_mint_binding but with independently-specifiable session_id/
# agent_id/role -- needed since this section's tests must not collide with
# the fixed "cosb-session"/"cosb-agent-id"/"arch-testing" identity every
# OTHER direct-mint test in this file already relies on. agent_type and role
# are always minted equal here, matching today's own universal invariant
# (never diverging) -- proving the fix's identity correlation works without
# ever needing the binding itself to store a custom name.
_cosb_customname_mint_binding() {
  local proj="$1" session_id="$2" agent_id="$3" role="$4" ttl="${5:-3600}"
  node -e '
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const sessionId = process.argv[3];
    const agentId = process.argv[4];
    const role = process.argv[5];
    const ttl = Number(process.argv[6]);
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    if (!planResult.ok) { process.stderr.write("no PLAN discovered"); process.exit(1); }
    const genResult = rll.resolveSessionGeneration(projectRoot, { provider: "claude-hook", runtime_session_key: sessionId });
    if (!genResult.ok) { process.stderr.write("session generation resolve failed: " + JSON.stringify(genResult)); process.exit(1); }
    const result = rll.createClaudeOneShotBinding(
      projectRoot, sessionId, genResult.generationId, agentId, role,
      "a".repeat(32), "b".repeat(64), "c".repeat(64), 0, role,
      worktreeId, planResult.planDigest, ttl
    );
    if (!result.ok) { process.stderr.write("mint failed: " + JSON.stringify(result)); process.exit(1); }
    process.stdout.write(result.binding.binding_id);
  ' "$RLL_IMPL" "$proj" "$session_id" "$agent_id" "$role" "$ttl"
}

# Feeds a SubagentStop event to the REAL hook with an independently-
# specifiable agent_type (custom name or canonical role), session_id and
# agent_id. Includes the FULL byte-exact real field set captured empirically
# (transcript_path/cwd/prompt_id/permission_mode/effort/stop_hook_active/
# agent_transcript_path/last_assistant_message/background_tasks/
# session_crons) so these tests double as proof the extra real-world fields
# are tolerated, never required. Prints "<status>\n<stdout>".
_cosb_customname_stop_event() {
  local proj="$1" agent_type="$2" session_id="$3" agent_id="$4"
  local input_file; input_file="$(mktemp)"
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({
      session_id: process.argv[3],
      transcript_path: "/fixture/transcript.jsonl",
      cwd: "/fixture/cwd",
      prompt_id: "fixture-prompt-id",
      permission_mode: "bypassPermissions",
      agent_id: process.argv[4],
      agent_type: process.argv[2],
      effort: { level: "max" },
      hook_event_name: "SubagentStop",
      stop_hook_active: false,
      agent_transcript_path: "/fixture/agent-transcript.jsonl",
      last_assistant_message: "OK",
      background_tasks: [],
      session_crons: [],
    }));
  ' "$input_file" "$agent_type" "$session_id" "$agent_id"
  local out status
  out="$(cat "$input_file" | CLAUDE_PROJECT_DIR="$proj" node "$HOOK" 2>/dev/null)"
  status=$?
  rm -f "$input_file"
  printf '%s\n%s' "$status" "$out"
}

# Same real-shape idea for SubagentStart -- the exact field set captured
# empirically (session_id/transcript_path/cwd/prompt_id/agent_id/agent_type/
# hook_event_name, no more).
_cosb_customname_start_event() {
  local proj="$1" agent_type="$2" session_id="$3" agent_id="$4"
  local input_file; input_file="$(mktemp)"
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({
      session_id: process.argv[3],
      transcript_path: "/fixture/transcript.jsonl",
      cwd: "/fixture/cwd",
      prompt_id: "fixture-prompt-id",
      agent_id: process.argv[4],
      agent_type: process.argv[2],
      hook_event_name: "SubagentStart",
    }));
  ' "$input_file" "$agent_type" "$session_id" "$agent_id"
  local out status
  out="$(cat "$input_file" | CLAUDE_PROJECT_DIR="$proj" node "$HOOK" 2>/dev/null)"
  status=$?
  rm -f "$input_file"
  printf '%s\n%s' "$status" "$out"
}

@test "COSB-CUSTOMNAME-E2E-SUBAGENTSTART-NEVER-MINTS-FOR-CUSTOM-NAME: HARD NO-GO correction (2026-08-15) -- REPLACES this file's own former COSB-CUSTOMNAME-E2E-SUBAGENTSTART-MINTS-BINDING-DESPITE-CUSTOM-NAME, whose title named exactly the behavior the ruling withdrew. Even a reservation that (via this test's own bypass helper, mirroring production code's own present inability to reach selected_driver:'claude-agent' through cmdDispatch) exists with a custom-diverging name is NEVER consumed by a REAL SubagentStart reporting that same custom agent_type: the reservation stays ISSUED and zero binding is minted -- proves the SubagentStart-side defense-in-depth (findLiveClaudeAgentReservationsForRole never matches a non-canonical role string; the generation-scoped anomaly probe catches the reservation's mere presence) closes this even when the mint-time gate is bypassed, as a real production Agent() call never could be" {
  local proj; proj="$(_cosb_e2e_make_project)"
  local pub; pub="$(_cosb_e2e_publish_request "$proj" "test-specialist")"
  local request_id artifact_ref; read -r request_id artifact_ref <<< "$pub"
  local native_spawn_action_id
  native_spawn_action_id="$(_cosb_e2e_construct_claude_agent_activation "$proj" "$artifact_ref")"
  run _cosb_e2e_mint_b1_reservation_custom_name "$proj" "test-specialist" "$request_id" "partb-example"
  [ "$status" -eq 0 ]

  local result; result="$(_cosb_customname_start_event "$proj" "partb-example" "cosb-e2e-orchestrator-session" "cosb-customname-agent-id")"
  local hook_status; hook_status="$(printf '%s' "$result" | head -1)"
  [ "$hook_status" = "0" ]

  local binding_id; binding_id="$(_cosb_e2e_find_binding_by_action_id "$proj" "$native_spawn_action_id")"
  [ -z "$binding_id" ]

  run node -e '
    const rll = require(process.argv[1]);
    const read = rll.readRegistryRecord(rll.claudeAgentSpawnReservationPathFor(process.argv[2], process.argv[3]));
    if (!read.ok || read.absent) { process.stderr.write("reservation missing"); process.exit(1); }
    if (read.obj.execution_state !== "ISSUED") { process.stderr.write("execution_state=" + read.obj.execution_state); process.exit(1); }
  ' "$RLL_IMPL" "$proj" "$native_spawn_action_id"
  [ "$status" -eq 0 ]

  rm -rf "$proj"
}

@test "COSB-CUSTOMNAME-E2E-NO-ROUND-TRIP-FOR-CUSTOM-NAME: HARD NO-GO correction (2026-08-15) -- REPLACES this file's own former COSB-CUSTOMNAME-E2E-HAPPY-PATH-START-THEN-STOP, whose asserted 'mission's own core objective' the ruling explicitly withdrew (custom-named OWNING one-shot support requires a future launch-ticket primitive, not this mission). Full real round trip now proves the OPPOSITE: SubagentStart never mints a binding for a custom-diverging name (as the sibling test above proves in isolation), so the matching real SubagentStop finds zero live claude-one-shot candidates for this identity and is a silent, unblocked no-op -- never a retirement, since there was never anything to retire" {
  local proj; proj="$(_cosb_e2e_make_project)"
  local pub; pub="$(_cosb_e2e_publish_request "$proj" "verifier")"
  local request_id artifact_ref; read -r request_id artifact_ref <<< "$pub"
  local native_spawn_action_id
  native_spawn_action_id="$(_cosb_e2e_construct_claude_agent_activation "$proj" "$artifact_ref")"
  run _cosb_e2e_mint_b1_reservation_custom_name "$proj" "verifier" "$request_id" "qa-worker-42"
  [ "$status" -eq 0 ]

  local start_result; start_result="$(_cosb_customname_start_event "$proj" "qa-worker-42" "cosb-e2e-orchestrator-session" "cosb-happy-agent-id")"
  local start_status; start_status="$(printf '%s' "$start_result" | head -1)"
  [ "$start_status" = "0" ]
  local binding_id; binding_id="$(_cosb_e2e_find_binding_by_action_id "$proj" "$native_spawn_action_id")"
  [ -z "$binding_id" ]

  local stop_result; stop_result="$(_cosb_customname_stop_event "$proj" "qa-worker-42" "cosb-e2e-orchestrator-session" "cosb-happy-agent-id")"
  local stop_status; stop_status="$(printf '%s' "$stop_result" | head -1)"
  local stop_output; stop_output="$(printf '%s' "$stop_result" | tail -n +2)"
  [ "$stop_status" = "0" ]
  [ -z "$stop_output" ]

  rm -rf "$proj"
}

@test "COSB-CUSTOMNAME-NEG-WRONG-CUSTOM-NAME-BLOCKS: HARD NO-GO correction (2026-08-15) -- session_id+agent_id correlation ALONE is no longer sufficient authority to retire a live claude-one-shot binding. A SubagentStop whose agent_type is a genuinely non-canonical custom name that does NOT exactly equal the correlated binding's own role is BLOCKED, never retired -- REPLACES this file's own former COSB-CUSTOMNAME-STOP-RETIRES-VIA-SESSION-AGENT-CORRELATION, whose 'retires via session+agent alone, agent_type ignored entirely' contract the HARD NO-GO ruling named as an unbacked security relaxation (an owning one-shot binding can now only ever be minted for name-absent-or-exactly-canonical, per the SAME ruling's SubagentStart-side correction, so a genuinely owning spawn's real SubagentStop agent_type always equals binding.role exactly; any OTHER value reaching this exact session_id/agent_id is treated as a contradiction, not a trusted custom label" {
  local proj; proj="$(_cosb_make_project)"
  local binding_id; binding_id="$(_cosb_customname_mint_binding "$proj" "cnt-session-3" "cnt-agent-3" "arch-testing")"
  [ -n "$binding_id" ]

  local result; result="$(_cosb_customname_stop_event "$proj" "totally-different-custom-name-xyz" "cnt-session-3" "cnt-agent-3")"
  local status_code; status_code="$(printf '%s' "$result" | head -1)"
  local out; out="$(printf '%s' "$result" | tail -n +2)"
  [ "$status_code" = "0" ]
  node -e '
    let body;
    try { body = JSON.parse(process.argv[1]); } catch (e) { process.stderr.write("not JSON\n"); process.exit(1); }
    if (body.decision !== "block") { process.stderr.write("decision mismatch: " + JSON.stringify(body)); process.exit(1); }
  ' "$out"

  _cosb_assert_not_retired "$proj" "$binding_id"
  _cosb_cleanup_project "$proj"
}

@test "COSB-CUSTOMNAME-NEG-DIFFERENT-CANONICAL-ROLE-BLOCKS: a SubagentStop whose agent_type IS itself a real, DIFFERENT canonical role than the one the correlated binding was minted for is BLOCKED, never retired -- a canonical-looking claim must still agree with the durable binding's own role; only a genuinely non-canonical custom name is exempt from this check" {
  local proj; proj="$(_cosb_make_project)"
  local binding_id; binding_id="$(_cosb_customname_mint_binding "$proj" "cnt-session-4" "cnt-agent-4" "arch-testing")"
  [ -n "$binding_id" ]

  local result; result="$(_cosb_customname_stop_event "$proj" "test-specialist" "cnt-session-4" "cnt-agent-4")"
  local status_code; status_code="$(printf '%s' "$result" | head -1)"
  local out; out="$(printf '%s' "$result" | tail -n +2)"
  [ "$status_code" = "0" ]
  node -e '
    let body;
    try { body = JSON.parse(process.argv[1]); } catch (e) { process.stderr.write("not JSON\n"); process.exit(1); }
    if (body.decision !== "block") { process.stderr.write("decision mismatch: " + JSON.stringify(body)); process.exit(1); }
  ' "$out"

  _cosb_assert_not_retired "$proj" "$binding_id"
  _cosb_cleanup_project "$proj"
}

@test "COSB-CUSTOMNAME-NEG-WRONG-SESSION-NOOP: a custom-agent_type SubagentStop under the WRONG session_id is a silent no-op -- the actual live binding is left completely untouched, never retired, never blocked" {
  local proj; proj="$(_cosb_make_project)"
  local binding_id; binding_id="$(_cosb_customname_mint_binding "$proj" "cnt-session-5" "cnt-agent-5" "arch-testing")"
  [ -n "$binding_id" ]

  local result; result="$(_cosb_customname_stop_event "$proj" "custom-name-5" "cnt-session-5-WRONG" "cnt-agent-5")"
  local status_code; status_code="$(printf '%s' "$result" | head -1)"
  local out; out="$(printf '%s' "$result" | tail -n +2)"
  [ "$status_code" = "0" ]
  [ -z "$out" ]

  _cosb_assert_not_retired "$proj" "$binding_id"
  _cosb_cleanup_project "$proj"
}

@test "COSB-CUSTOMNAME-NEG-WRONG-AGENT-ID-NOOP: a custom-agent_type SubagentStop under the WRONG agent_id is a silent no-op -- the actual live binding is left completely untouched, never retired, never blocked" {
  local proj; proj="$(_cosb_make_project)"
  local binding_id; binding_id="$(_cosb_customname_mint_binding "$proj" "cnt-session-6" "cnt-agent-6" "arch-testing")"
  [ -n "$binding_id" ]

  local result; result="$(_cosb_customname_stop_event "$proj" "custom-name-6" "cnt-session-6" "cnt-agent-6-WRONG")"
  local status_code; status_code="$(printf '%s' "$result" | head -1)"
  local out; out="$(printf '%s' "$result" | tail -n +2)"
  [ "$status_code" = "0" ]
  [ -z "$out" ]

  _cosb_assert_not_retired "$proj" "$binding_id"
  _cosb_cleanup_project "$proj"
}

@test "COSB-CUSTOMNAME-NEG-NO-BINDING-NOOP: an ordinary ad-hoc custom-named agent with NO one-shot binding at all is a silent no-op through the real hook -- proves the fix does not start blocking every custom-named stop unconditionally" {
  local proj; proj="$(_cosb_make_project)"
  local result; result="$(_cosb_customname_stop_event "$proj" "brand-new-custom-name" "cnt-session-7-never-minted" "cnt-agent-7-never-minted")"
  local status_code; status_code="$(printf '%s' "$result" | head -1)"
  local out; out="$(printf '%s' "$result" | tail -n +2)"
  [ "$status_code" = "0" ]
  [ -z "$out" ]
  _cosb_cleanup_project "$proj"
}

# M7 CORRECTION (2026-08-17): same fixture-construction gap
# _cosb_plant_conflicting_binding above closes, for the customname-mint
# helper variant (independently-specifiable session_id/agent_id/role rather
# than _cosb_mint_binding's own hardcoded identity) -- see that helper's own
# comment for the full defects-1/2 rationale. Prints ONLY the binding_id,
# matching _cosb_customname_mint_binding's own output contract exactly.
_cosb_customname_plant_conflicting_binding() {
  local proj="$1" session_id="$2" agent_id="$3" role="$4"
  node -e '
    const crypto = require("crypto");
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const sessionId = process.argv[3];
    const agentId = process.argv[4];
    const role = process.argv[5];
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    if (!planResult.ok) { process.stderr.write("no PLAN discovered"); process.exit(1); }
    const identity = { provider: "claude-hook", runtime_session_key: sessionId };
    const genResult = rll.resolveSessionGeneration(projectRoot, identity);
    if (!genResult.ok) { process.stderr.write("session generation failed: " + JSON.stringify(genResult)); process.exit(1); }
    const bindingId = crypto.randomBytes(16).toString("hex");
    const record = {
      schema: "runtime/claude-one-shot-binding/v2",
      binding_id: bindingId,
      actor_instance_id: crypto.randomBytes(16).toString("hex"),
      runtime_session_key: sessionId,
      agent_id: agentId,
      agent_type: role,
      native_spawn_action_id: "a".repeat(32),
      request_id: "b".repeat(64),
      attempt_id: "c".repeat(64),
      lease_epoch: 0,
      role: role,
      worktree_id: worktreeId,
      plan_digest: planResult.planDigest,
      session_generation_id: genResult.generationId,
      created_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      expiry: new Date(Date.now() + 3600000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    };
    const recordPath = rll.claudeOneShotBindingPathFor(projectRoot, bindingId);
    const planted = rll.writeRegistryRecordReplace(recordPath, Buffer.from(JSON.stringify(record), "utf8"));
    if (!planted.ok) { process.stderr.write("plant failed: " + JSON.stringify(planted)); process.exit(1); }
    process.stdout.write(bindingId);
  ' "$RLL_IMPL" "$proj" "$session_id" "$agent_id" "$role"
}

@test "COSB-CUSTOMNAME-NEG-AMBIGUOUS-TWO-BINDINGS-STOP: two genuinely live bindings sharing the identical session_id+agent_id refuse to retire EITHER one when a custom-agent_type SubagentStop arrives -- mirrors this file's own established COSB-E2E-SUBAGENTSTOP-AMBIGUOUS-TWO-BINDINGS-STOP precedent, now for a custom name" {
  local proj; proj="$(_cosb_make_project)"
  local binding_id_1; binding_id_1="$(_cosb_customname_mint_binding "$proj" "cnt-session-8" "cnt-agent-8" "arch-testing")"
  local binding_id_2; binding_id_2="$(_cosb_customname_plant_conflicting_binding "$proj" "cnt-session-8" "cnt-agent-8" "verifier")"
  [ -n "$binding_id_1" ]; [ -n "$binding_id_2" ]
  [ "$binding_id_1" != "$binding_id_2" ]

  local result; result="$(_cosb_customname_stop_event "$proj" "ambiguous-custom-name" "cnt-session-8" "cnt-agent-8")"
  local status_code; status_code="$(printf '%s' "$result" | head -1)"
  local out; out="$(printf '%s' "$result" | tail -n +2)"
  [ "$status_code" = "0" ]
  node -e '
    let body;
    try { body = JSON.parse(process.argv[1]); } catch (e) { process.stderr.write("not JSON\n"); process.exit(1); }
    if (body.decision !== "block") { process.stderr.write("decision mismatch: " + JSON.stringify(body)); process.exit(1); }
  ' "$out"
  # Must block because genuine session_id+agent_id ambiguity was detected
  # (reached only by actually finding 2 live candidates), never merely
  # because "ambiguous-custom-name" fails an agent_type-canonicality gate --
  # that would ALSO produce decision:block, but for the wrong reason, and
  # would pass this test even pre-fix (confirmed empirically: pre-fix this
  # test passes vacuously on the decision:block check alone, since the
  # initial CANONICAL_ROLES gate blocks first and never even reaches the
  # candidate scan -- this substring is what actually discriminates the two).
  # M7 correction (2026-08-17): "more than one" was this file's own pre-M7
  # per-family ambiguity prose, superseded by the ONE canonical classifier
  # (classifyClaudeAuthorityForIdentity), whose own closed reason string is
  # authority-current-binding-ambiguous -- confirmed failing on the OLD
  # substring against today's real hook output (direct empirical check,
  # 2026-08-17). Not a retirement-marker issue; a stale-prose-string issue
  # found and fixed while working the retirement-mechanics cluster.
  [[ "$out" == *"ambigu"* ]] || [[ "$out" == *"AMBIGU"* ]]
  [[ "$out" != *"missing or malformed"* ]]

  _cosb_assert_not_retired "$proj" "$binding_id_1"
  _cosb_assert_not_retired "$proj" "$binding_id_2"
  # M7 CORRECTION (2026-08-17): see COSB-E2E-SUBAGENTSTOP-AMBIGUOUS-TWO-BINDINGS-STOP's
  # own identical rationale -- _cosb_assert_not_retired is no longer
  # discriminating on its own (legacy .retired marker path, permanently
  # absent). Real proof: each binding still independently validates live,
  # each against its OWN role (the two bindings deliberately differ here).
  local worktree_id plan_digest
  worktree_id="$(node -e 'const rll=require(process.argv[1]);process.stdout.write(rll.computeWorktreeId(process.argv[2]));' "$RLL_IMPL" "$proj")"
  plan_digest="$(node -e 'const rll=require(process.argv[1]);const r=rll.discoverPlan(process.argv[2]);process.stdout.write(r.ok?r.planDigest:"");' "$RLL_IMPL" "$proj")"
  local still_live_1; still_live_1="$(_cosb_validate "$proj" "$binding_id_1" "$(printf 'b%.0s' {1..64})" "$(printf 'c%.0s' {1..64})" 0 arch-testing "$worktree_id" "$plan_digest")"
  [ "$still_live_1" = "true NONE" ]
  local still_live_2; still_live_2="$(_cosb_validate "$proj" "$binding_id_2" "$(printf 'b%.0s' {1..64})" "$(printf 'c%.0s' {1..64})" 0 verifier "$worktree_id" "$plan_digest")"
  [ "$still_live_2" = "true NONE" ]
  _cosb_cleanup_project "$proj"
}

@test "COSB-CUSTOMNAME-NEG-FENCED-BINDING-REPLAY-NOOP: a binding whose identity is already fenced does not cause a block when a custom-agent_type SubagentStop replay arrives for the same identity -- idempotent no-clobber fence republish (M7 section 3.2), corrected for M7 (fence replaces the removed .retired marker). classification.state FENCED sets shouldFence true regardless of agentType canonicality (confirmed by direct read: shouldFence = CANONICAL_ROLES.includes(agentType) || classification.state !== 'ABSENT'), so this replay still durably reaches publishClaudeAuthorityFence's own idempotent branch, never a hard error." {
  local proj; proj="$(_cosb_make_project)"
  local binding_id; binding_id="$(_cosb_customname_mint_binding "$proj" "cnt-session-9" "cnt-agent-9" "arch-testing")"
  [ -n "$binding_id" ]

  run _cosb_plant_fence "$proj" "cnt-session-9" "cnt-agent-9"
  [ "$status" -eq 0 ]

  local result; result="$(_cosb_customname_stop_event "$proj" "replay-custom-name" "cnt-session-9" "cnt-agent-9")"
  local status_code; status_code="$(printf '%s' "$result" | head -1)"
  local out; out="$(printf '%s' "$result" | tail -n +2)"
  [ "$status_code" = "0" ]
  [ -z "$out" ]

  run node -e '
    const rll = require(process.argv[1]);
    const repoDescriptor = { repoId: rll.computeRepoId(process.argv[2]) };
    const id = rll.computeClaudeAuthorityIdentityId(repoDescriptor, "claude-hook", "cnt-session-9", "cnt-agent-9");
    const read = rll.readClaudeAuthorityFence(repoDescriptor, id);
    if (!read.ok || read.absent) { process.stderr.write("fence unexpectedly absent after idempotent replay: " + JSON.stringify(read)); process.exit(1); }
  ' "$RLL_IMPL" "$proj"
  [ "$status" -eq 0 ]
  _cosb_cleanup_project "$proj"
}

@test "COSB-CUSTOMNAME-NEVER-CROSSES-SESSION-BOUNDARY: HARD NO-GO correction (2026-08-15) -- a mismatched agent_type BLOCKS rather than retires (see COSB-CUSTOMNAME-NEG-WRONG-CUSTOM-NAME-BLOCKS), so this test's own former 'retires session A, never session B' outcome no longer applies; re-scoped to what remains true and worth proving: a custom-agent_type SubagentStop for session A, deliberately chosen to resemble session B's own real role as a string, BLOCKS session A's own binding (contradiction, agentType!=binding.role) while leaving session B's genuinely live, completely unrelated binding untouched either way -- proves the custom name is never used as a role-lookup or cross-session correlation key in EITHER direction, mutate-nothing or mutate-the-wrong-one" {
  local proj; proj="$(_cosb_make_project)"
  local binding_a; binding_a="$(_cosb_customname_mint_binding "$proj" "cnt-session-10a" "cnt-agent-10a" "arch-testing")"
  local binding_b; binding_b="$(_cosb_customname_mint_binding "$proj" "cnt-session-10b" "cnt-agent-10b" "verifier")"
  [ -n "$binding_a" ]; [ -n "$binding_b" ]

  # "verifier-clone" is NOT itself a canonical role (CANONICAL_ROLES has no
  # such entry) -- deliberately resembles session B's real role as a string,
  # to prove the fix never does any string-level role matching at all.
  local result; result="$(_cosb_customname_stop_event "$proj" "verifier-clone" "cnt-session-10a" "cnt-agent-10a")"
  local status_code; status_code="$(printf '%s' "$result" | head -1)"
  local out; out="$(printf '%s' "$result" | tail -n +2)"
  [ "$status_code" = "0" ]
  node -e '
    let body;
    try { body = JSON.parse(process.argv[1]); } catch (e) { process.stderr.write("not JSON\n"); process.exit(1); }
    if (body.decision !== "block") { process.stderr.write("decision mismatch: " + JSON.stringify(body)); process.exit(1); }
  ' "$out"

  _cosb_assert_not_retired "$proj" "$binding_a"
  _cosb_assert_not_retired "$proj" "$binding_b"
  _cosb_cleanup_project "$proj"
}

# ══════════════════════════════════════════════════════════════════════════
# HARD NO-GO correction (2026-08-15): the FIRST customname pass above closed
# the literal SubagentStop gate but left two real gaps a rigorous adversarial
# review caught. (1) RESERVATION-STEAL: tryConsumeClaudeAgentOneShotReservation
# searched live claude-agent-spawn-reservations by session_generation_id
# ALONE -- "the sole live reservation in this generation" is not proof it
# belongs to THIS spawn; a second, differently-ROLED Agent() call sharing the
# same generation and (coincidentally or not) the same custom name could
# consume a reservation that was never minted for it. (2) the SubagentStop
# side's own "agent_type is a claim, checked against binding.role only when
# it looks canonical" carve-out let ANY non-canonical string retire a
# binding via session_id+agent_id alone, silently narrowing "wrong type
# never retires" down to "wrong type sometimes retires." Both are closed by
# the SAME structural decision (RULING #2): an OWNING claude-agent one-shot
# spawn is no longer supported with a custom name AT ALL -- name must be
# absent or EXACTLY the canonical role, enforced at PreToolUse mint time
# (agent-spawn-execution-gate.js) AND, defense-in-depth, at SubagentStart
# consumption time (subagent-start-context-bundle.js). Custom names remain
# fully supported for the ordinary NON-owning case (ad-hoc specialist/
# architect dispatch, zero bindings in any family) -- see the
# NO-BINDING-NOOP test above, re-verified, not touched by this correction.
# ══════════════════════════════════════════════════════════════════════════

# Feeds a genuine PreToolUse(Agent) payload to the REAL agent-spawn-
# execution-gate.js hook -- mirrors agent-spawn-execution-gate.test.js's own
# runMainOrchestratorAgentCall (tool_name:'Agent', tool_input:
# {subagent_type,name,prompt}, session_id, agent_type:'', agent_id:'' --
# main-orchestrator-only per that hook's own RB4 gate) exactly, just spoken
# in bats rather than node:test. Prints "<status>\n<stdout>".
_cosb_e2e_pretooluse_agent() {
  local proj="$1" subagent_type="$2" name="$3" prompt="$4" session_id="$5"
  local input_file; input_file="$(mktemp)"
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({
      tool_name: "Agent",
      tool_input: { subagent_type: process.argv[2], name: process.argv[3], prompt: process.argv[4] },
      session_id: process.argv[5], agent_type: "", agent_id: "",
    }));
  ' "$input_file" "$subagent_type" "$name" "$prompt" "$session_id"
  local out status
  out="$(cat "$input_file" | CLAUDE_PROJECT_DIR="$proj" node "$RESERVATION_HOOK" 2>/dev/null)"
  status=$?
  rm -f "$input_file"
  printf '%s\n%s' "$status" "$out"
}

@test "COSB-RESERVATION-STEAL-BLOCKED: CIERRE FINAL correction (2026-08-15) -- CANONICAL-NAME-RESERVATION-STEAL. REPLACES this test's own prior body, which used 'partb-example' (a non-canonical shared name) as the theft vector; the real reviewer-confirmed attack uses the VICTIM'S OWN canonical role as the adversary's name: legitimate reservation subagent_type=test-specialist name=test-specialist (both canonical, matching -- the ONLY shape the prior HARD NO-GO correction still allowed to mint); adversary subagent_type=verifier name=test-specialist, SAME session_generation. The gate's new global canonical-namespace rule (name in CANONICAL_ROLES && name!==subagent_type => DENY, independent of whether subagent_type itself owns anything) must deny the adversary's real PreToolUse outright -- proven by driving it against the REAL gate. Proves 'reserva sin consumir y cero binding [para el adversario]' not by crafting a hypothetical adversary SubagentStart (Claude Code's own runtime never fires one for a denied PreToolUse -- there is no real agent_id to correlate, and this file's own established discipline never fabricates a fixture for a scenario that cannot occur in production), but by driving the REAL, legitimate holder's own real SubagentStart afterward and proving it still succeeds cleanly against the SAME still-live, never-stolen, never-corrupted reservation -- zero collateral damage from the denied attack attempt." {
  local proj; proj="$(_cosb_e2e_make_project)"
  local pub; pub="$(_cosb_e2e_publish_request "$proj" "test-specialist")"
  local request_id artifact_ref; read -r request_id artifact_ref <<< "$pub"
  local native_spawn_action_id
  native_spawn_action_id="$(_cosb_e2e_construct_claude_agent_activation "$proj" "$artifact_ref")"
  # Legitimate reservation: name===subagent_type, the only shape the gate
  # still allows to mint an owning claude-agent reservation for.
  run _cosb_e2e_mint_b1_reservation "$proj" "test-specialist" "$request_id"
  [ "$status" -eq 0 ]

  # The adversary: a genuinely different real role (verifier) whose custom
  # `name` is deliberately crafted to equal the VICTIM's own canonical role
  # -- driven through the REAL gate, same orchestrator session (misma
  # session_generation, the mission's own explicit precondition).
  local adv_gate_result; adv_gate_result="$(_cosb_e2e_pretooluse_agent "$proj" "verifier" "test-specialist" "placeholder" "cosb-e2e-orchestrator-session")"
  local adv_gate_status; adv_gate_status="$(printf '%s' "$adv_gate_result" | head -1)"
  local adv_gate_out; adv_gate_out="$(printf '%s' "$adv_gate_result" | tail -n +2)"
  _assert_pretooluse_deny_values "$adv_gate_status" "$adv_gate_out"
  [[ "$adv_gate_out" == *"reserved canonical role"* ]]

  # The reservation must be completely untouched by the denied attack --
  # still ISSUED, never consumed, never corrupted.
  run node -e '
    const rll = require(process.argv[1]);
    const read = rll.readRegistryRecord(rll.claudeAgentSpawnReservationPathFor(process.argv[2], process.argv[3]));
    if (!read.ok || read.absent) { process.stderr.write("reservation missing"); process.exit(1); }
    if (read.obj.execution_state !== "ISSUED") { process.stderr.write("execution_state=" + read.obj.execution_state); process.exit(1); }
  ' "$RLL_IMPL" "$proj" "$native_spawn_action_id"
  [ "$status" -eq 0 ]
  local binding_id; binding_id="$(_cosb_e2e_find_binding_by_action_id "$proj" "$native_spawn_action_id")"
  [ -z "$binding_id" ]

  # The LEGITIMATE holder's own real SubagentStart, same session, a fresh
  # genuinely-its-own agent_id: must still succeed cleanly, proving the
  # denied attack left zero collateral damage on the real flow.
  local legit_start_result; legit_start_result="$(_cosb_customname_start_event "$proj" "test-specialist" "cosb-e2e-orchestrator-session" "legit-agent-id")"
  local legit_start_status; legit_start_status="$(printf '%s' "$legit_start_result" | head -1)"
  [ "$legit_start_status" = "0" ]
  local legit_binding_id; legit_binding_id="$(_cosb_e2e_find_binding_by_action_id "$proj" "$native_spawn_action_id")"
  [ -n "$legit_binding_id" ]

  # And the binding genuinely belongs to the legitimate agent_id, never the
  # adversary's -- the denied attack could not smuggle its own identity in.
  run node -e '
    const rll = require(process.argv[1]);
    const read = rll.readRegistryRecord(rll.claudeOneShotBindingPathFor(process.argv[2], process.argv[3]));
    if (!read.ok || read.absent) { process.stderr.write("binding missing"); process.exit(1); }
    if (read.obj.agent_id !== "legit-agent-id") { process.stderr.write("wrong agent_id: " + read.obj.agent_id); process.exit(1); }
  ' "$RLL_IMPL" "$proj" "$legit_binding_id"
  [ "$status" -eq 0 ]

  rm -rf "$proj"
}

@test "COSB-GATE-DENIES-DIVERGING-NAME-FOR-OWNING-SPAWN: RED-A (gate half). A fresh, never-yet-reserved claude-agent activation exists for test-specialist. The FIRST and ONLY real PreToolUse against it, subagent_type=test-specialist but name=partb-example (a genuinely diverging custom name) with the REAL, correctly-computed bootstrap message -- so a pre-fix gate has every OTHER check satisfied and would cleanly ALLOW + mint -- is now DENIED specifically for the name divergence, never reaching mintClaudeAgentSpawnReservation at all. Control case immediately below (same activation's own request cannot be reused, so this is deliberately its own separate fixture) proves name===subagent_type is still allowed, unaffected." {
  local proj; proj="$(_cosb_e2e_make_project)"
  local pub; pub="$(_cosb_e2e_publish_request "$proj" "test-specialist")"
  local request_id artifact_ref; read -r request_id artifact_ref <<< "$pub"
  _cosb_e2e_construct_claude_agent_activation "$proj" "$artifact_ref" >/dev/null

  local real_prompt; real_prompt="$(node -e '
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const role = process.argv[4];
    const requestId = process.argv[5];
    const waveSlug = process.argv[6];
    const coordRoot = rll.coordinationRootPathFor(projectRoot);
    const repoId = rll.computeRepoId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    const found = rc.findLiveClaudeAgentActivations(coordRoot, repoId, waveSlug, planResult.planDigest, role);
    if (found.length !== 1) { process.stderr.write("expected exactly 1 live activation, got " + found.length); process.exit(1); }
    process.stdout.write(rll.claudeAgentBootstrapMessageFor(role, requestId, found[0].activation.attempt_id));
  ' "$RLL_IMPL" "$RC_IMPL" "$proj" "test-specialist" "$request_id" "$COSB_E2E_WAVE_SLUG")"
  [ -n "$real_prompt" ]

  local legit_result; legit_result="$(_cosb_e2e_pretooluse_agent "$proj" "test-specialist" "partb-example" "$real_prompt" "cosb-e2e-orchestrator-session")"
  local legit_status; legit_status="$(printf '%s' "$legit_result" | head -1)"
  local legit_out; legit_out="$(printf '%s' "$legit_result" | tail -n +2)"
  _assert_pretooluse_deny_values "$legit_status" "$legit_out"
  [[ "$legit_out" == *"diverges"* ]]

  rm -rf "$proj"
}

@test "COSB-SUBAGENTSTOP-ONESHOT-LOOKUP-ERROR-BLOCKS: RED-C. A genuine read error scanning claude-one-shot-bindings/ (the directory replaced by a non-directory file -> ENOTDIR, deliberately never ENOENT, which stays the ordinary 'ok:true, zero candidates' case identical to every other scanner in this codebase) BLOCKS the stop -- HARD NO-GO correction item 3: an error must never silently degrade to 'absent', which would let the stop proceed while the durable binding stays live and unretired" {
  local proj; proj="$(_cosb_make_project)"
  local out binding_id worktree_id plan_digest
  out="$(_cosb_mint_binding "$proj")"; read -r binding_id worktree_id plan_digest <<< "$out"
  [ -n "$binding_id" ]

  node -e '
    const fs = require("fs");
    const path = require("path");
    const rll = require(process.argv[1]);
    const markerPath = rll.claudeOneShotBindingRetiredMarkerPathFor(process.argv[2], process.argv[3]);
    const bindingsDir = path.dirname(markerPath);
    const realDir = bindingsDir + "-real";
    fs.renameSync(bindingsDir, realDir);
    fs.writeFileSync(bindingsDir, "not a directory");
  ' "$RLL_IMPL" "$proj" "$binding_id"

  local input_file; input_file="$(mktemp)"
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({
      hook_event_name: "SubagentStop", agent_type: "arch-testing",
      session_id: "cosb-session", agent_id: "cosb-agent-id",
    }));
  ' "$input_file"
  run bash -c "cat '$input_file' | CLAUDE_PROJECT_DIR='$proj' node '$HOOK'"
  _assert_subagentstop_block
  rm -f "$input_file"

  node -e '
    const fs = require("fs");
    const path = require("path");
    const rll = require(process.argv[1]);
    const markerPath = rll.claudeOneShotBindingRetiredMarkerPathFor(process.argv[2], process.argv[3]);
    const bindingsDir = path.dirname(markerPath);
    const realDir = bindingsDir + "-real";
    fs.unlinkSync(bindingsDir);
    fs.renameSync(realDir, bindingsDir);
  ' "$RLL_IMPL" "$proj" "$binding_id"
  local still_live; still_live="$(_cosb_validate "$proj" "$binding_id" "$(printf 'b%.0s' {1..64})" "$(printf 'c%.0s' {1..64})" 0 arch-testing "$worktree_id" "$plan_digest")"
  [ "$still_live" = "true NONE" ]

  _cosb_cleanup_project "$proj"
}

@test "COSB-ONESHOT-LEAF-READ-ERROR-BLOCKS: CIERRE FINAL RED-2. A genuinely live claude-one-shot binding whose OWN individual record file is corrupted (invalid JSON, never a directory-level ENOENT/ENOTDIR) BLOCKS the stop with zero mutation -- an individual leaf-record read error must never silently fold into 'not a candidate', which would let the durable authority disappear from the live set and the stop proceed while it stays live and unretired." {
  local proj; proj="$(_cosb_make_project)"
  local out binding_id worktree_id plan_digest
  out="$(_cosb_mint_binding "$proj")"; read -r binding_id worktree_id plan_digest <<< "$out"
  [ -n "$binding_id" ]

  node -e '
    const rll = require(process.argv[1]);
    const bindingPath = rll.claudeOneShotBindingPathFor(process.argv[2], process.argv[3]);
    require("fs").writeFileSync(bindingPath, "{ not valid json ");
  ' "$RLL_IMPL" "$proj" "$binding_id"

  # Snapshot AFTER the corruption (the corruption itself is this test's own
  # fixture setup, not a mutation the hook is responsible for) -- "zero
  # mutation" means the STOP call itself changes nothing further.
  local before; before="$(_cosb_registry_snapshot "$proj")"

  local input_file; input_file="$(mktemp)"
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({
      hook_event_name: "SubagentStop", agent_type: "arch-testing",
      session_id: "cosb-session", agent_id: "cosb-agent-id",
    }));
  ' "$input_file"
  run bash -c "cat '$input_file' | CLAUDE_PROJECT_DIR='$proj' node '$HOOK'"
  rm -f "$input_file"
  _assert_subagentstop_block

  local after; after="$(_cosb_registry_snapshot "$proj")"
  [ "$before" = "$after" ]

  _cosb_cleanup_project "$proj"
}

@test "COSB-ONESHOT-RETIREMENT-MARKER-INERT: CIERRE FINAL RED-3, M7 CORRECTION (2026-08-17). REPLACES this file's own former COSB-ONESHOT-RETIREMENT-MARKER-ERROR-BLOCKS, whose premise (a corrupt retirement-marker file causes a real read error the scanner must propagate as a block) can no longer occur by construction: M7 section 4.4 makes the .retired marker inert diagnostics-only -- retireClaudeOneShotBinding (the former marker WRITER) no longer exists, and classifyClaudeAuthorityForIdentity's own one-shot scan no longer reads the marker at all (confirmed directly by M7-ONESHOT-V2-LEGACY-MARKER-INERT-08, runtime-role-lifecycle-registry.test.js, at the classifier level). This is that same property proven end to end through the REAL SubagentStop hook instead: a genuinely live, well-formed claude-one-shot binding whose (never-written-by-current-code) retirement-marker path holds illegible/corrupt content has ZERO effect on a real SubagentStop's outcome -- the stop completes as an ordinary, clean fence-publish regardless of the marker's content, and the corrupt marker itself is left completely untouched (never read, never repaired, never deleted), proving true inertness rather than merely 'does not crash'." {
  local proj; proj="$(_cosb_make_project)"
  local out binding_id worktree_id plan_digest
  out="$(_cosb_mint_binding "$proj")"; read -r binding_id worktree_id plan_digest <<< "$out"
  [ -n "$binding_id" ]

  node -e '
    const rll = require(process.argv[1]);
    const markerPath = rll.claudeOneShotBindingRetiredMarkerPathFor(process.argv[2], process.argv[3]);
    require("fs").mkdirSync(require("path").dirname(markerPath), { recursive: true });
    require("fs").writeFileSync(markerPath, "{ not valid json ");
  ' "$RLL_IMPL" "$proj" "$binding_id"

  local input_file; input_file="$(mktemp)"
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({
      hook_event_name: "SubagentStop", agent_type: "arch-testing",
      session_id: "cosb-session", agent_id: "cosb-agent-id",
    }));
  ' "$input_file"
  run bash -c "cat '$input_file' | CLAUDE_PROJECT_DIR='$proj' node '$HOOK'"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  rm -f "$input_file"

  # The real identity fence was genuinely published -- regression anchor
  # proving the RUN above genuinely completed an ordinary clean retire, never
  # a vacuous pass (e.g. an early unrelated error that also happens to leave
  # empty stdout).
  run node -e '
    const rll = require(process.argv[1]);
    const repoDescriptor = { repoId: rll.computeRepoId(process.argv[2]) };
    const id = rll.computeClaudeAuthorityIdentityId(repoDescriptor, "claude-hook", "cosb-session", "cosb-agent-id");
    const read = rll.readClaudeAuthorityFence(repoDescriptor, id);
    if (!read.ok || read.absent) { process.stderr.write("fence unexpectedly absent: " + JSON.stringify(read)); process.exit(1); }
  ' "$RLL_IMPL" "$proj"
  [ "$status" -eq 0 ]

  # The corrupt marker itself is byte-identical to what this test planted --
  # never read, never repaired, never deleted.
  run node -e '
    const rll = require(process.argv[1]);
    const markerPath = rll.claudeOneShotBindingRetiredMarkerPathFor(process.argv[2], process.argv[3]);
    const bytes = require("fs").readFileSync(markerPath, "utf8");
    if (bytes !== "{ not valid json ") { process.stderr.write("marker was touched: " + bytes); process.exit(1); }
  ' "$RLL_IMPL" "$proj" "$binding_id"
  [ "$status" -eq 0 ]

  _cosb_cleanup_project "$proj"
}

@test "COSB-REQUESTER-PREFLIGHT-ZERO-MUTATION-BLOCKS: CIERRE FINAL RED-6. A genuinely VALID CLAUDE-ID-01 trace (real role-spawn actions + real observations, this file's own established _cosb_prime_claude_id01_capability ceremony) coexists with a malformed requester-binding record elsewhere in the registry. The stop BLOCKS on the malformed requester-binding during READ-ONLY preflight -- before deleteClaudeId01TraceForSession's own (separately two-phase: trace-record-delete THEN requester-binding-delete) mutation ever runs -- proving the valid trace is never partially deleted ahead of a later, requester-side failure: the full registry manifest stays byte-identical before and after." {
  local proj; proj="$(_cosb_e2e_make_project)"
  _cosb_prime_claude_id01_capability "$proj" "red6-session" "red6-agent-id"

  local req_dir; req_dir="$(node -e 'const rll=require(process.argv[1]);process.stdout.write(require("path").join(rll.registryRepoDir(process.argv[2]),"requester-bindings"));' "$RLL_IMPL" "$proj")"
  mkdir -p "$req_dir"
  printf '{"schema":"coordination/requester-binding/v1","not_a_real_field":true}' > "$req_dir/deadbeefdeadbeefdeadbeefdeadbeef.json"

  local before; before="$(_cosb_registry_snapshot "$proj")"

  local input_file; input_file="$(mktemp)"
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({
      hook_event_name: "SubagentStop", agent_type: "context-provider",
      session_id: "red6-session", agent_id: "red6-agent-id",
    }));
  ' "$input_file"
  run bash -c "cat '$input_file' | CLAUDE_PROJECT_DIR='$proj' node '$HOOK'"
  rm -f "$input_file"
  _assert_subagentstop_block
  # M7 correction (2026-08-17): the three-substring check below is unrelated
  # to retirement mechanics (flagged separately from the marker-based
  # redesign) -- confirmed by direct empirical run that this test's OWN
  # substring check was written before classifyClaudeAuthorityForIdentity
  # existed. Today's real handleSubagentStop calls the classifier BEFORE
  # preflightClaudeId01TraceForSession, and the classifier's own bounded scan
  # (scanClaudeAuthorityFamily) ALSO reads requester-bindings/ unconditionally
  # -- it hits this SAME malformed record first and blocks with "authority
  # classification FAILED: authority-record-malformed", which contained none
  # of the original three substrings, causing a false failure even though the
  # zero-mutation property this test actually cares about (asserted below via
  # the byte-identical registry snapshot) already held. Broadened to accept
  # either the classifier's own current reason or the original preflight-era
  # ones, so this test is robust to which of the two (classifier vs
  # preflight) catches the malformed record first.
  [[ "$output" == *"preflight"* || "$output" == *"requester"* || "$output" == *"CLAUDE-ID-01"* || "$output" == *"authority-record-malformed"* || "$output" == *"classification FAILED"* ]]

  local after; after="$(_cosb_registry_snapshot "$proj")"
  [ "$before" = "$after" ]

  rm -rf "$proj"
}

@test "COSB-SCOPE-ERROR-BLOCKS: CIERRE FINAL RED-8. A genuinely live one-shot binding exists, but THIS exact SubagentStop invocation's own scope resolution (computeRepoId/computeWorktreeId, both git-backed) genuinely throws (the project's own .git directory removed outright, never merely 'no PLAN yet' -- that well-defined negative result remains the pre-existing, non-exceptional exit-0 passthrough, unaffected by this correction) -- must BLOCK, never silently exit 0 as 'mechanism inapplicable'. A transient/real scope-resolution failure can never be told apart from 'a live authority exists but this call could not confirm it'." {
  local proj; proj="$(_cosb_make_project)"
  local out binding_id worktree_id plan_digest
  out="$(_cosb_mint_binding "$proj")"; read -r binding_id worktree_id plan_digest <<< "$out"
  [ -n "$binding_id" ]

  mv "$proj/.git" "$proj/.git.moved-for-red8"

  local input_file; input_file="$(mktemp)"
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({
      hook_event_name: "SubagentStop", agent_type: "arch-testing",
      session_id: "cosb-session", agent_id: "cosb-agent-id",
    }));
  ' "$input_file"
  # 2>/dev/null: with .git genuinely missing, the underlying git subprocess
  # (gitRevParse) writes its own "fatal: not a git repository" text to this
  # PROCESS's inherited stderr -- combined with $output by bats' own `run`
  # otherwise, which would make the hook's OWN clean {"decision":"block",...}
  # stdout fail to parse as JSON for the wrong reason. Mirrors this file's
  # own _cosb_customname_stop_event helper, which redirects the SAME way.
  run bash -c "cat '$input_file' | CLAUDE_PROJECT_DIR='$proj' node '$HOOK' 2>/dev/null"
  rm -f "$input_file"
  mv "$proj/.git.moved-for-red8" "$proj/.git"
  _assert_subagentstop_block

  _cosb_assert_not_retired "$proj" "$binding_id"
  _cosb_cleanup_project "$proj"
}

@test "COSB-REAL-PAYLOAD-FIXTURE-CONSUMED: CIERRE FINAL RED-10. Genuinely reads and parses the preserved real-capture fixture (scripts/tests/fixtures/claude-code-real-subagent-hook-payloads.jsonl) at test-run time -- never a synthetic payload merely modeled after it -- substitutes ONLY the dynamic session_id/agent_id/path fields, and drives the REAL hook with the FULL real-world SubagentStart then SubagentStop shape (permission_mode/effort/stop_hook_active/agent_transcript_path/last_assistant_message/background_tasks/session_crons, all genuinely captured, never invented). The captured agent_type ('partb-diag-probe') is non-canonical with zero live authority in any family -- both events must be silent, unblocked no-ops, proving the real payload's extra fields are tolerated, never required or misinterpreted." {
  local proj; proj="$(_cosb_e2e_make_project)"
  local fixture_path="$BATS_TEST_DIRNAME/fixtures/claude-code-real-subagent-hook-payloads.jsonl"
  [ -f "$fixture_path" ]
  local session_id="red10-real-payload-session" agent_id="red10-real-payload-agent"

  local start_payload; start_payload="$(node -e '
    const fs = require("fs");
    const lines = fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean);
    const rec = JSON.parse(lines[1]);
    if (rec.hook_event_name !== "SubagentStart") { process.stderr.write("fixture line 2 is not SubagentStart"); process.exit(1); }
    rec.session_id = process.argv[2];
    rec.agent_id = process.argv[3];
    if (typeof rec.transcript_path === "string") rec.transcript_path = process.argv[4] + "/transcript.jsonl";
    if (typeof rec.cwd === "string") rec.cwd = process.argv[4];
    process.stdout.write(JSON.stringify(rec));
  ' "$fixture_path" "$session_id" "$agent_id" "$proj")"
  [[ "$start_payload" == *'"agent_type":"partb-diag-probe"'* ]]

  local start_out start_status
  start_out="$(printf '%s' "$start_payload" | CLAUDE_PROJECT_DIR="$proj" node "$HOOK" 2>/dev/null)"
  start_status=$?
  [ "$start_status" = "0" ]

  local stop_payload; stop_payload="$(node -e '
    const fs = require("fs");
    const lines = fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean);
    const rec = JSON.parse(lines[2]);
    if (rec.hook_event_name !== "SubagentStop") { process.stderr.write("fixture line 3 is not SubagentStop"); process.exit(1); }
    rec.session_id = process.argv[2];
    rec.agent_id = process.argv[3];
    if (typeof rec.transcript_path === "string") rec.transcript_path = process.argv[4] + "/transcript.jsonl";
    if (typeof rec.cwd === "string") rec.cwd = process.argv[4];
    if (typeof rec.agent_transcript_path === "string") rec.agent_transcript_path = process.argv[4] + "/agent-transcript.jsonl";
    process.stdout.write(JSON.stringify(rec));
  ' "$fixture_path" "$session_id" "$agent_id" "$proj")"
  [[ "$stop_payload" == *'"background_tasks"'* ]]
  [[ "$stop_payload" == *'"effort"'* ]]
  [[ "$stop_payload" == *'"stop_hook_active":false'* ]]

  local stop_out stop_status
  stop_out="$(printf '%s' "$stop_payload" | CLAUDE_PROJECT_DIR="$proj" node "$HOOK" 2>/dev/null)"
  stop_status=$?
  [ "$stop_status" = "0" ]
  [ -z "$stop_out" ]

  rm -rf "$proj"
}

# ══════════════════════════════════════════════════════════════════════════
# checkClaudeAgentCapabilityAvailable (runtime-role-lifecycle.cjs, verdict
# Block 4 point 7): pure, standalone verification that the full claude-agent
# one-shot chain is functionally present -- PreToolUse Agent reservation
# (agent-spawn-execution-gate.js), SubagentStart mint, SubagentStop
# retirement (both subagent-start-context-bundle.js, two DISTINCT
# registrations). Deliberately unwired (no production call site consults it
# yet -- a future WP3 driver-selection pass should, per its own doc comment).
# toolkit-specialist verified 6 cases manually; this section gives them
# permanent, real test-file coverage.
# ══════════════════════════════════════════════════════════════════════════

# Writes a minimal .claude/settings.json under `proj` with exactly the
# hook-registration shape checkClaudeAgentCapabilityAvailable's own
# isRegisteredUnder scans for: {hooks:{<event>:[{hooks:[{command:"...file..."}]}]}}.
# Args after proj: repeated "<event>:<fileBasename>" pairs to register.
_cosb_write_capability_settings() {
  local proj="$1"; shift
  mkdir -p "$proj/.claude"
  node -e '
    const fs = require("fs");
    const proj = process.argv[1];
    const pairs = process.argv.slice(2);
    const hooks = {};
    for (const pair of pairs) {
      const [event, file] = pair.split(":");
      hooks[event] = hooks[event] || [{ hooks: [] }];
      hooks[event][0].hooks.push({ type: "command", command: "node .claude/hooks/" + file });
    }
    fs.writeFileSync(proj + "/.claude/settings.json", JSON.stringify({ hooks }));
  ' "$proj" "$@"
}

_cosb_capability_check() {
  local proj="$1"
  node -e '
    const rll = require(process.argv[1]);
    process.stdout.write(JSON.stringify(rll.checkClaudeAgentCapabilityAvailable(process.argv[2])));
  ' "$RLL_IMPL" "$proj"
}

@test "COSB-CAPABILITY-1-FULL-CHAIN: settings.json registers all three legs and both hook files exist on disk -- available:true" {
  local proj; proj="$(mktemp -d)"
  mkdir -p "$proj/.claude/hooks"
  printf '' > "$proj/.claude/hooks/agent-spawn-execution-gate.js"
  printf '' > "$proj/.claude/hooks/subagent-start-context-bundle.js"
  _cosb_write_capability_settings "$proj" "PreToolUse:agent-spawn-execution-gate.js" "SubagentStart:subagent-start-context-bundle.js" "SubagentStop:subagent-start-context-bundle.js"
  local result; result="$(_cosb_capability_check "$proj")"
  [ "$result" = '{"available":true}' ]
  rm -rf "$proj"
}

@test "COSB-CAPABILITY-2-MISSING-SETTINGS: no .claude/settings.json at all -- available:false, missing:reservation" {
  local proj; proj="$(mktemp -d)"
  local result; result="$(_cosb_capability_check "$proj")"
  [[ "$result" == *'"available":false'* ]]
  [[ "$result" == *'"missing":"reservation"'* ]]
  rm -rf "$proj"
}

@test "COSB-CAPABILITY-3-MISSING-PRETOOLUSE-REGISTRATION: PreToolUse registration absent (SubagentStart/Stop present) -- available:false, missing:reservation" {
  local proj; proj="$(mktemp -d)"
  mkdir -p "$proj/.claude/hooks"
  printf '' > "$proj/.claude/hooks/agent-spawn-execution-gate.js"
  printf '' > "$proj/.claude/hooks/subagent-start-context-bundle.js"
  _cosb_write_capability_settings "$proj" "SubagentStart:subagent-start-context-bundle.js" "SubagentStop:subagent-start-context-bundle.js"
  local result; result="$(_cosb_capability_check "$proj")"
  [[ "$result" == *'"available":false'* ]]
  [[ "$result" == *'"missing":"reservation"'* ]]
  rm -rf "$proj"
}

@test "COSB-CAPABILITY-4-MISSING-SUBAGENTSTART-REGISTRATION: SubagentStart registration absent (PreToolUse/SubagentStop present) -- available:false, missing:mint" {
  local proj; proj="$(mktemp -d)"
  mkdir -p "$proj/.claude/hooks"
  printf '' > "$proj/.claude/hooks/agent-spawn-execution-gate.js"
  printf '' > "$proj/.claude/hooks/subagent-start-context-bundle.js"
  _cosb_write_capability_settings "$proj" "PreToolUse:agent-spawn-execution-gate.js" "SubagentStop:subagent-start-context-bundle.js"
  local result; result="$(_cosb_capability_check "$proj")"
  [[ "$result" == *'"available":false'* ]]
  [[ "$result" == *'"missing":"mint"'* ]]
  rm -rf "$proj"
}

@test "COSB-CAPABILITY-5-MISSING-SUBAGENTSTOP-REGISTRATION: SubagentStop registration absent (PreToolUse/SubagentStart present) -- available:false, missing:retirement" {
  local proj; proj="$(mktemp -d)"
  mkdir -p "$proj/.claude/hooks"
  printf '' > "$proj/.claude/hooks/agent-spawn-execution-gate.js"
  printf '' > "$proj/.claude/hooks/subagent-start-context-bundle.js"
  _cosb_write_capability_settings "$proj" "PreToolUse:agent-spawn-execution-gate.js" "SubagentStart:subagent-start-context-bundle.js"
  local result; result="$(_cosb_capability_check "$proj")"
  [[ "$result" == *'"available":false'* ]]
  [[ "$result" == *'"missing":"retirement"'* ]]
  rm -rf "$proj"
}

@test "COSB-CAPABILITY-6-REGISTERED-BUT-ABSENT-ON-DISK: all three legs registered in settings.json, but the reservation hook file does not actually exist on disk -- available:false, missing:reservation" {
  local proj; proj="$(mktemp -d)"
  mkdir -p "$proj/.claude/hooks"
  # Deliberately NOT created: agent-spawn-execution-gate.js
  printf '' > "$proj/.claude/hooks/subagent-start-context-bundle.js"
  _cosb_write_capability_settings "$proj" "PreToolUse:agent-spawn-execution-gate.js" "SubagentStart:subagent-start-context-bundle.js" "SubagentStop:subagent-start-context-bundle.js"
  local result; result="$(_cosb_capability_check "$proj")"
  [[ "$result" == *'"available":false'* ]]
  [[ "$result" == *'"missing":"reservation"'* ]]
  rm -rf "$proj"
}

# ══════════════════════════════════════════════════════════════════════════
# M6+M7 FINAL AUTHORITY/ORACLE CORRECTION (2026-08-11, RED phase, dispatch
# team-lead "M6+M7 FINAL AUTHORITY/ORACLE CORRECTION"): Group 4 -- distinguish
# mechanism from live claude-agent capability. Confirmed by direct read
# (2026-08-11) of cmdDispatch (runtime-consultation.cjs, ~L8091-8126) and
# checkClaudeAgentCapabilityAvailable (runtime-role-lifecycle.cjs,
# ~L2011-2047): cmdDispatch's claude-agent branch calls ONLY
# checkClaudeAgentCapabilityAvailable(claudeAgentCapabilityProjectRoot()) --
# claudeAgentCapabilityProjectRoot() (runtime-consultation.cjs ~L8036-8038)
# is HARDCODED to path.resolve(__dirname,'..','..'), i.e. THIS repo's own
# checkout root, deliberately independent of any test fixture's own
# --coordination-root -- and that mechanism check proves only that
# .claude/settings.json registers agent-spawn-execution-gate.js under
# PreToolUse and subagent-start-context-bundle.js under SubagentStart+
# SubagentStop (confirmed both ARE registered in this real checkout, so
# available:true unconditionally in this test environment). There is no live
# session/PLAN/worktree/action/reservation/SubagentStart correlation check
# anywhere in cmdDispatch's own claude-agent branch.
#
# Every test below drives the REAL `dispatch` subcommand end to end (never a
# hand-constructed activation/v1 -- unlike this file's own earlier E2E
# fixtures, which pre-date WP3's real per-request driver-selection landing
# and hand-build selected_driver:"claude-agent" for a DIFFERENT reason,
# documented in this file's own header "PRODUCTION REALITY" note; that note
# is now STALE relative to current bytes -- confirmed empirically this
# session that cmdDispatch DOES genuinely select claude-agent live once a
# materialized routing policy lists it, which is exactly this group's own
# defect), reusing _cosb_e2e_make_project/_cosb_e2e_publish_request/
# _cosb_e2e_mint_requester_grant (already established above in this file) for
# the fixture, plus a routing-policy materializer (below) that writes a REAL
# routing-policies/<digest>.json at the EXACT path/digest the just-published
# request itself carries -- never a fabricated/mismatched digest.
# ══════════════════════════════════════════════════════════════════════════

# Materializes a REAL routing-policies/<routing_policy_digest>.json (PLAN.md's
# own Namespace & Root Security tree: <plan_root>/routing-policies/<sha256>.json)
# for the request at `request_path`, admitting exactly `drivers` (in order) for
# that request's own target_role -- mirrors cmdDispatch's own planRootFromArtifact
# path math (coordRoot/repoId/waveSlug/planDigest, confirmed by direct read
# against runtime-consultation-cli.test.js's own planRootPathFor helper).
# R2-C (M6-M7-R2C-TEST-SEAM-CLOSURE-20260820) seam, mirrors
# runtime-consultation-role-gate.bats' own _s16e2e_arm_test_routing_seam:
# GROUP4 correction round 1 -- the prior helper (materialize a synthetic
# routing-policies/<digest>.json AFTER publish) never updated the just-
# published request's own routing_policy_digest field, so every dispatch
# call downstream failed CORRELATION_INVALID before ever reaching driver
# selection (confirmed empirically: ENOENT reading the activation file that
# dispatch never got to write) -- never actually exercising claude-agent
# eligibility at all. Arming the REAL canonical module's own
# RUNTIME_CONSULTATION_TEST_ROUTING_POLICY_PATH seam BEFORE publish-request
# (so the recorded digest is correct from the start, for every child process
# this test spawns afterward -- both mint helpers and dispatch itself all
# inherit the exported env) is the same fix-shape already proven in
# runtime-consultation-role-gate.bats. $RUNTIME_TMP is this file's own
# setup()-exported TMPDIR (mode 0700), the seam's own containment check target.
_cosb_g4_arm_test_routing_seam() {
  local target_role="$1"; shift
  local override_path="$RUNTIME_TMP/g4-routing-policy.json"
  node -e '
    const fs = require("fs");
    const rc = require(process.argv[1]);
    const outPath = process.argv[2];
    const targetRole = process.argv[3];
    const drivers = process.argv.slice(4);
    const policyObj = { schema: "runtime-routing/v1", routes: { [targetRole]: drivers } };
    fs.writeFileSync(outPath, rc.canonicalJSONStringify(policyObj), { mode: 0o600 });
  ' "$RC_IMPL" "$override_path" "$target_role" "$@"
  chmod 0600 "$override_path"
  export RUNTIME_CONSULTATION_TEST_ROUTING_POLICY_PATH="$(cd "$(dirname "$override_path")" && pwd -P)/$(basename "$override_path")"
  export NODE_ENV=test
  export RUNTIME_CONSULTATION_TEST_CAPABILITY="cosb-g4-routing-seam-capability"
}

_cosb_g4_disarm_test_routing_seam() {
  unset RUNTIME_CONSULTATION_TEST_ROUTING_POLICY_PATH
  unset RUNTIME_CONSULTATION_TEST_CAPABILITY
}

# Drives the real `dispatch` subcommand (minting its own real, correctly-scoped
# requester grant via this file's own established _cosb_e2e_mint_requester_grant),
# then reads back the resulting activation/v1's own `selected_driver` field
# straight off disk (never trusted from the CLI's own stdout claim alone --
# durable-record ground truth). Prints the selected_driver string.
_cosb_g4_dispatch_and_read_selected_driver() {
  local proj="$1" coord_root="$2" artifact_ref="$3"
  local rest_dispatch=(--coordination-root "$coord_root" --request "$artifact_ref")
  local dispatch_grant; dispatch_grant="$(_cosb_e2e_mint_requester_grant "$proj" dispatch "${rest_dispatch[@]}")"
  [ -n "$dispatch_grant" ] || return 1
  # Item 11 (M6+M7 RESIDUAL AUTHORITY CORRECTION, arch-testing-20260811T162225Z):
  # the CLI's own stdout envelope (printResultAndExit, runtime-consultation.cjs
  # ~L6106) is now captured to a fixed per-test path instead of discarded, so
  # callers can also assert on its own activation_action field (cmdDispatch,
  # ~L8381) -- never trusted ALONE (the activation/v1 record on disk below
  # remains the durable ground truth this helper's own doc comment already
  # established for selected_driver), but a genuine, real field that was
  # silently going unchecked by every caller of this helper.
  node "$RC_IMPL" dispatch "${rest_dispatch[@]}" --requester-binding "$dispatch_grant" >"$BATS_TEST_TMPDIR/g4-dispatch-cli-stdout.json" 2>/dev/null
  node -e '
    const fs = require("fs");
    const path = require("path");
    const requestPath = process.argv[1];
    const reqObj = JSON.parse(fs.readFileSync(requestPath, "utf8"));
    const activationPath = path.join(path.dirname(requestPath), "activations", reqObj.initial_attempt_id + ".json");
    const activationObj = JSON.parse(fs.readFileSync(activationPath, "utf8"));
    process.stdout.write(activationObj.selected_driver);
  ' "$artifact_ref"
}

# HARD NO-GO correction (2026-08-11, spec item 9): proves "zero partial
# activation" EMPIRICALLY -- not merely that dispatch's own selected_driver
# read back as noop, but that NOTHING claude-agent-shaped was ever durably
# written as a side effect. Content-based (schema-driven) checks throughout,
# never a hand-guessed path: activationPathFor/activationIntentPathFor/
# deliveryPathFor are NOT exported from runtime-consultation.cjs, so a test
# hardcoding a directory-naming convention for them would risk silently
# becoming a "check that cannot fail" if the guess were ever wrong. Checks:
#   - the activation/v1 record's own native_spawn_action_id is null (only
#     ever non-null when selectedDriver==='claude-agent', cmdDispatch ~L8218);
#   - NO file anywhere in the transaction directory carries schema
#     'coordination/activation-intent/v1' (the claude-intent WAL --
#     REQUESTER_OWNED_DISPATCH_DRIVERS never includes 'noop', so this WAL is
#     written ONLY for claude-sendmessage/claude-agent/runtime-spawn
#     selection, cmdDispatch ~L8068-8075/8246-8260);
#   - a 'coordination/delivery/v1' record with driver:'noop' DOES exist
#     instead (positive control -- proves the correct, non-WAL branch
#     genuinely executed, so the WAL-absence check above is not vacuously
#     true from some unrelated failure to write anything at all);
#   - ZERO ClaudeAgentSpawnReservation/v1 and ZERO claude-one-shot-binding/v1
#     records exist ANYWHERE in the registry (both are minted only by a LATER,
#     separate Agent()-tool call this fixture never drives -- checked anyway
#     for maximal discriminating power, via the EXPORTED schema constants
#     rll.CLAUDE_AGENT_SPAWN_RESERVATION_SCHEMA/CLAUDE_ONE_SHOT_BINDING_SCHEMA,
#     never a hardcoded literal or guessed directory name).
_cosb_g4_assert_zero_partial_activation() {
  local proj="$1" artifact_ref="$2"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const rll = require(process.argv[1]);
    const artifactRef = process.argv[2];
    const projectRoot = process.argv[3];
    const reqObj = JSON.parse(fs.readFileSync(artifactRef, "utf8"));
    const txnDir = path.dirname(artifactRef);
    const attemptId = reqObj.initial_attempt_id;

    const activationPath = path.join(txnDir, "activations", attemptId + ".json");
    const activationObj = JSON.parse(fs.readFileSync(activationPath, "utf8"));
    if (activationObj.selected_driver !== "noop") { process.stderr.write("fixture precondition failed: selected_driver must be noop for this assertion to be meaningful, got: " + activationObj.selected_driver); process.exit(1); }
    if (activationObj.native_spawn_action_id !== null) { process.stderr.write("native_spawn_action_id must be null when the fallback is genuinely selected, got: " + JSON.stringify(activationObj.native_spawn_action_id)); process.exit(1); }

    let foundIntentWal = false;
    let foundNoopDelivery = false;
    function walkTxn(dir) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walkTxn(full); continue; }
        if (!entry.name.endsWith(".json")) continue;
        let obj;
        try { obj = JSON.parse(fs.readFileSync(full, "utf8")); } catch { continue; }
        if (obj && obj.schema === "coordination/activation-intent/v1") foundIntentWal = true;
        if (obj && obj.schema === "coordination/delivery/v1" && obj.driver === "noop") foundNoopDelivery = true;
      }
    }
    walkTxn(txnDir);
    if (foundIntentWal) { process.stderr.write("a claude-intent WAL (activation-intent/v1) must never exist anywhere in the transaction directory when the fallback is genuinely selected"); process.exit(1); }
    if (!foundNoopDelivery) { process.stderr.write("a noop delivery/v1 record must exist -- proves the correct (non-WAL) branch genuinely executed, not merely that neither branch ran"); process.exit(1); }

    let foundReservation = false;
    let foundOneShotBinding = false;
    function walkRegistry(dir) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walkRegistry(full); continue; }
        if (!entry.name.endsWith(".json")) continue;
        let obj;
        try { obj = JSON.parse(fs.readFileSync(full, "utf8")); } catch { continue; }
        if (obj && obj.schema === rll.CLAUDE_AGENT_SPAWN_RESERVATION_SCHEMA) foundReservation = true;
        if (obj && obj.schema === rll.CLAUDE_ONE_SHOT_BINDING_SCHEMA) foundOneShotBinding = true;
      }
    }
    walkRegistry(rll.registryRepoDir(projectRoot));
    if (foundReservation) { process.stderr.write("zero ClaudeAgentSpawnReservation records must exist anywhere in the registry"); process.exit(1); }
    if (foundOneShotBinding) { process.stderr.write("zero claude-one-shot-binding records must exist anywhere in the registry"); process.exit(1); }
  ' "$RLL_IMPL" "$artifact_ref" "$proj"
}

# Narrower sibling of _cosb_g4_assert_zero_partial_activation above -- ONLY
# the transaction-scoped checks (native_spawn_action_id null, no
# activation-intent WAL, a noop delivery record exists), never the
# registry-wide reservation/one-shot-binding scan. GROUP4-STALE-PROOF's own
# fixture deliberately plants a genuine (retired) claude-one-shot-binding
# BEFORE dispatch to prove it is IRRELEVANT to selection -- the absolute-zero
# registry scan in the full helper would misfire against that INTENTIONAL
# pre-existing record, which is not a partial-activation side effect of
# dispatch at all.
_cosb_g4_assert_zero_partial_activation_txn_only() {
  local proj="$1" artifact_ref="$2"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const artifactRef = process.argv[1];
    const reqObj = JSON.parse(fs.readFileSync(artifactRef, "utf8"));
    const txnDir = path.dirname(artifactRef);
    const attemptId = reqObj.initial_attempt_id;

    const activationPath = path.join(txnDir, "activations", attemptId + ".json");
    const activationObj = JSON.parse(fs.readFileSync(activationPath, "utf8"));
    if (activationObj.selected_driver !== "noop") { process.stderr.write("fixture precondition failed: selected_driver must be noop for this assertion to be meaningful, got: " + activationObj.selected_driver); process.exit(1); }
    if (activationObj.native_spawn_action_id !== null) { process.stderr.write("native_spawn_action_id must be null when the fallback is genuinely selected, got: " + JSON.stringify(activationObj.native_spawn_action_id)); process.exit(1); }

    let foundIntentWal = false;
    let foundNoopDelivery = false;
    function walkTxn(dir) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walkTxn(full); continue; }
        if (!entry.name.endsWith(".json")) continue;
        let obj;
        try { obj = JSON.parse(fs.readFileSync(full, "utf8")); } catch { continue; }
        if (obj && obj.schema === "coordination/activation-intent/v1") foundIntentWal = true;
        if (obj && obj.schema === "coordination/delivery/v1" && obj.driver === "noop") foundNoopDelivery = true;
      }
    }
    walkTxn(txnDir);
    if (foundIntentWal) { process.stderr.write("a claude-intent WAL (activation-intent/v1) must never exist anywhere in the transaction directory when the fallback is genuinely selected"); process.exit(1); }
    if (!foundNoopDelivery) { process.stderr.write("a noop delivery/v1 record must exist -- proves the correct (non-WAL) branch genuinely executed, not merely that neither branch ran"); process.exit(1); }
  ' "$artifact_ref"
}

@test "GROUP4-CORE (regression): dispatch, with a materialized routing policy admitting claude-agent before noop and ZERO live session/PLAN/worktree/action correlation of any kind, must select the frozen fallback (noop) -- pre-fix it wrongly selects claude-agent purely from checkClaudeAgentCapabilityAvailable's own mechanism-only (files-present + settings-registered) evidence, which is unconditionally true in this real checkout" {
  local proj; proj="$(_cosb_e2e_make_project)"
  _cosb_g4_arm_test_routing_seam "arch-testing" claude-agent noop
  local pub; pub="$(_cosb_e2e_publish_request "$proj" "arch-testing")"
  local request_id artifact_ref; read -r request_id artifact_ref <<< "$pub"
  [ -n "$artifact_ref" ]
  local coord_root; coord_root="$(node -e 'const rll=require(process.argv[1]);process.stdout.write(rll.coordinationRootPathFor(process.argv[2]));' "$RLL_IMPL" "$proj")"

  local selected; selected="$(_cosb_g4_dispatch_and_read_selected_driver "$proj" "$coord_root" "$artifact_ref")"
  [ "$selected" = "noop" ]
  # Item 11 (M6+M7 RESIDUAL AUTHORITY CORRECTION, arch-testing-20260811T162225Z):
  # activation_action must be null on the CLI's own dispatch result too
  # (cmdDispatch, runtime-consultation.cjs ~L8381 / printResultAndExit ~L6106)
  # -- a genuinely real field, previously never asserted anywhere in this file
  # despite the noop-selection outcome already being locked in immediately above.
  [[ "$(cat "$BATS_TEST_TMPDIR/g4-dispatch-cli-stdout.json")" == *'"activation_action":null'* ]]
  # HARD NO-GO correction (item 9): "zero partial activation" proven
  # empirically, not merely via the dispatch result value.
  run _cosb_g4_assert_zero_partial_activation "$proj" "$artifact_ref"
  [ "$status" -eq 0 ]
  _cosb_g4_disarm_test_routing_seam
  rm -rf "$proj"
}

@test "GROUP4-STALE-PROOF (regression): a genuine, but STALE/UNRELATED, claude-one-shot-binding already exists in the registry (from a completely different prior dispatch) at dispatch time for a NEW request -- must NOT influence selection toward claude-agent; the frozen fallback must still be chosen. Covers the 'stale session' and 'wrong PLAN/worktree' scenarios together: cmdDispatch's own claude-agent branch never reads the claude-one-shot-bindings/ registry at all, so ANY prior binding (live, matching, or foreign-scope) is equally irrelevant to it today -- confirmed by direct read." {
  local proj; proj="$(_cosb_e2e_make_project)"

  # A genuine, but unrelated, prior binding -- proves real registry content,
  # not merely "nothing exists yet". M7 correction (2026-08-17): this test's
  # OWN core claim (cmdDispatch never reads claude-one-shot-bindings/ at all)
  # does not depend on the prior binding's own retirement status -- a LIVE
  # unrelated binding is an equally (arguably stronger) valid proof of
  # irrelevance. retireClaudeOneShotBinding (the former writer this fixture
  # used to call) no longer exists at all (M7 section 4/8.5, no new
  # retirement artifact is ever written) -- the call is removed rather than
  # replaced with anything, since nothing here actually needed it to succeed.
  local prior; prior="$(_cosb_mint_binding "$proj")"
  local prior_binding_id; prior_binding_id="$(printf '%s' "$prior" | awk '{print $1}')"
  [ -n "$prior_binding_id" ]

  _cosb_g4_arm_test_routing_seam "arch-testing" claude-agent noop
  local pub; pub="$(_cosb_e2e_publish_request "$proj" "arch-testing")"
  local request_id artifact_ref; read -r request_id artifact_ref <<< "$pub"
  [ -n "$artifact_ref" ]
  local coord_root; coord_root="$(node -e 'const rll=require(process.argv[1]);process.stdout.write(rll.coordinationRootPathFor(process.argv[2]));' "$RLL_IMPL" "$proj")"

  local selected; selected="$(_cosb_g4_dispatch_and_read_selected_driver "$proj" "$coord_root" "$artifact_ref")"
  [ "$selected" = "noop" ]
  # Item 11 (M6+M7 RESIDUAL AUTHORITY CORRECTION, arch-testing-20260811T162225Z):
  # activation_action must be null on the CLI's own dispatch result too, same
  # as GROUP4-CORE above (cmdDispatch, runtime-consultation.cjs ~L8381 /
  # printResultAndExit ~L6106) -- the stale/unrelated prior binding this test
  # seeds must be just as irrelevant to this field as it is to selected_driver.
  [[ "$(cat "$BATS_TEST_TMPDIR/g4-dispatch-cli-stdout.json")" == *'"activation_action":null'* ]]
  # HARD NO-GO correction (item 9): txn-scoped "zero partial activation"
  # proof (narrow variant -- the registry-wide scan is skipped here since
  # this fixture deliberately pre-seeds a genuine, unrelated, retired
  # one-shot binding to prove IT is irrelevant, which the absolute-zero
  # registry check would otherwise misfire against).
  run _cosb_g4_assert_zero_partial_activation_txn_only "$proj" "$artifact_ref"
  [ "$status" -eq 0 ]
  _cosb_g4_disarm_test_routing_seam
  rm -rf "$proj"
}

@test "GROUP4-PLANNER-CALLER (regression): a request whose own source_role is the real canonical 'planner' role (rll.CANONICAL_ROLES; PLAN.md's own 'Planner draft bootstrap' section, ~L606, describes this exact actor -- 'this is exactly two bounded invocations of the canonical phase-scoped planner') -- PLAN.md §15d: 'the requester is not the running planner-bootstrap subagent' is one of claude-agent's own eligibility preconditions -- must NOT be eligible for claude-agent selection; the frozen fallback must be chosen instead. cmdDispatch never reads/branches on source_role for driver selection at all today (confirmed by direct read) -- ANY source_role, including this one, reaches the identical mechanism-only check. NOTE: PLAN.md ~L606 also names other bootstrap-specific narrowing (Pass B's own bounded command allowlist, project-mode auto|ephemeral) this test does not attempt to reproduce -- it isolates the caller-role dimension only, disclosed here rather than silently assumed complete." {
  local proj; proj="$(_cosb_e2e_make_project)"
  _cosb_g4_arm_test_routing_seam "arch-testing" claude-agent noop
  local pub; pub="$(_cosb_e2e_publish_request "$proj" "arch-testing")"
  local request_id artifact_ref; read -r request_id artifact_ref <<< "$pub"
  [ -n "$artifact_ref" ]
  local coord_root; coord_root="$(node -e 'const rll=require(process.argv[1]);process.stdout.write(rll.coordinationRootPathFor(process.argv[2]));' "$RLL_IMPL" "$proj")"

  # Mints the dispatch requester grant's OWN backing binding for the real
  # canonical 'planner' role FIRST (capturing its actor_instance_id), THEN
  # rewrites BOTH source_role AND requester_instance_id on the request to
  # that SAME actor -- keeping the fixture internally coherent end to end
  # (never leaving grant/request scope mismatched, which would fail dispatch
  # for an unrelated AUTHORITY_INVALID reason instead of exercising driver
  # selection specifically).
  local rest_dispatch=(--coordination-root "$coord_root" --request "$artifact_ref")
  local planner_actor_instance_id
  _cosb_prime_claude_id01_capability "$proj" "group4-planner-session" "group4-planner-capability-primary"
  planner_actor_instance_id="$(node -e '
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: "group4-planner-session" };
    const bindingResult = rll.createRequesterBinding(projectRoot, identity, "group4-planner-agent", "planner", worktreeId, planResult.planDigest, 3600);
    if (!bindingResult.ok) { process.stderr.write("createRequesterBinding failed: " + JSON.stringify(bindingResult)); process.exit(1); }
    process.stdout.write(bindingResult.binding.actor_instance_id);
  ' "$RLL_IMPL" "$proj")"
  [ -n "$planner_actor_instance_id" ]
  node -e '
    const fs = require("fs");
    const obj = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (obj.source_role !== "arch-testing") { process.stderr.write("fixture sanity failed: unexpected default source_role " + obj.source_role); process.exit(1); }
    obj.source_role = "planner";
    obj.requester_instance_id = process.argv[2];
    fs.writeFileSync(process.argv[1], JSON.stringify(obj), { mode: 0o600 });
    fs.chmodSync(process.argv[1], 0o600);
  ' "$artifact_ref" "$planner_actor_instance_id"

  local dispatch_grant
  dispatch_grant="$(node -e '
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const rest = process.argv.slice(4);
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: "group4-planner-session" };
    // Idempotent lookup-or-reuse (createRequesterBinding, GROUP-A semantics)
    // -- the IDENTICAL tuple already minted above returns the SAME binding
    // (same actor_instance_id), never a fresh one.
    const bindingResult = rll.createRequesterBinding(projectRoot, identity, "group4-planner-agent", "planner", worktreeId, planResult.planDigest, 3600);
    if (!bindingResult.ok) { process.stderr.write("createRequesterBinding failed: " + JSON.stringify(bindingResult)); process.exit(1); }
    function extractFlag(flagName) { const idx = rest.indexOf(flagName); return (idx !== -1 && idx + 1 < rest.length) ? rest[idx + 1] : undefined; }
    const scopeResult = rc.resolveRequesterGrantScope("dispatch", { "coordination-root": extractFlag("--coordination-root"), request: extractFlag("--request"), kind: extractFlag("--kind") });
    if (!scopeResult.ok) { process.stderr.write("resolveRequesterGrantScope failed: " + JSON.stringify(scopeResult)); process.exit(1); }
    const argvDigest = rc.sha256String(rc.canonicalJSONStringify(rest));
    const mintResult = rll.mintRoleCommandGrant(projectRoot, bindingResult.binding, "requester", "dispatch", argvDigest, scopeResult.requestId, scopeResult.attemptId, scopeResult.leaseEpoch);
    if (!mintResult.ok) { process.stderr.write("mintRoleCommandGrant failed: " + JSON.stringify(mintResult)); process.exit(1); }
    process.stdout.write(mintResult.grantId);
  ' "$RLL_IMPL" "$RC_IMPL" "$proj" "${rest_dispatch[@]}")"
  [ -n "$dispatch_grant" ]

  run node "$RC_IMPL" dispatch "${rest_dispatch[@]}" --requester-binding "$dispatch_grant"
  [ "$status" -eq 0 ]
  # Item 11 (M6+M7 RESIDUAL AUTHORITY CORRECTION, arch-testing-20260811T162225Z):
  # activation_action must be null on the CLI's own dispatch result too, same
  # as GROUP4-CORE/GROUP4-STALE-PROOF above (cmdDispatch, runtime-
  # consultation.cjs ~L8381 / printResultAndExit ~L6106) -- $output here is
  # already this exact CLI stdout envelope, captured via `run` immediately
  # above, so this is a direct assertion on the already-captured result.
  [[ "$output" == *'"activation_action":null'* ]]
  local selected; selected="$(node -e '
    const fs = require("fs");
    const path = require("path");
    const requestPath = process.argv[1];
    const reqObj = JSON.parse(fs.readFileSync(requestPath, "utf8"));
    const activationPath = path.join(path.dirname(requestPath), "activations", reqObj.initial_attempt_id + ".json");
    process.stdout.write(JSON.parse(fs.readFileSync(activationPath, "utf8")).selected_driver);
  ' "$artifact_ref")"
  [ "$selected" = "noop" ]
  # HARD NO-GO correction (item 9): "zero partial activation" proven
  # empirically, not merely via the dispatch result value. No pre-existing
  # registry content is seeded by this fixture, so the full (registry-wide)
  # variant is safe here.
  run _cosb_g4_assert_zero_partial_activation "$proj" "$artifact_ref"
  [ "$status" -eq 0 ]
  _cosb_g4_disarm_test_routing_seam
  rm -rf "$proj"
}

# ══════════════════════════════════════════════════════════════════════════
# M7 FINAL CORRECTION (test-specialist, batch 2 of 3, R11):
# handleConsultationTargetOwning (runtime-consultation-target-gate.js,
# ~line 321-329) treats "no activation resolvable" identically whether the
# activation is legitimately absent (dispatch has not run yet, or genuinely
# selected noop with zero live correlation) OR genuinely present but
# malformed/shape-invalid -- both collapse to resolvedActivation.activation
# === null via resolveActivationForRequestPath's own catch-all
# (runtime-consultation.cjs:10814-10825, "malformed/non-durable -- 'no
# activation yet', never thrown"). The hook's own comment (confirmed by
# direct read) explicitly documents falling through to the RoleActorBinding
# path as deliberate for the LEGITIMATE-absence case ("Resolution failure
# here is NEVER a block by itself"). But a MALFORMED activation is not
# legitimate absence -- it is evidence of tampering/corruption, and R11
# requires it to block outright ("absent, malformed, unreadable or
# indeterminate activation -> explicit block"), never silently fall through
# to mint a RoleActorBinding-backed grant as if the activation had simply
# never been written.
# ══════════════════════════════════════════════════════════════════════════

# Hand-constructs a MALFORMED activation/v1 record at the exact per-attempt
# path a real dispatch would use (mirrors _cosb_e2e_construct_claude_agent_activation's
# own technique) -- syntactically valid JSON, every OTHER required field
# genuinely correct, but selected_driver is missing entirely, so
# assertClosedShape(obj, ACTIVATION_V1_FIELDS) rejects it inside
# resolveActivationForRequestPath's own try/catch.
_r11_construct_malformed_activation() {
  local proj="$1" artifact_ref="$2"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const rc = require(process.argv[1]);
    const requestPath = process.argv[2];
    const reqObj = JSON.parse(fs.readFileSync(requestPath, "utf8"));
    const txnDir = path.dirname(requestPath);
    const activationsDir = path.join(txnDir, "activations");
    fs.mkdirSync(activationsDir, { recursive: true });
    const attemptId = reqObj.initial_attempt_id;
    const activationPath = path.join(activationsDir, attemptId + ".json");
    const malformedActivation = {
      schema: "coordination/activation/v1",
      version: 1,
      request_id: reqObj.request_id,
      request_digest: rc.sha256File(requestPath),
      attempt_id: attemptId,
      lease_epoch: reqObj.initial_lease_epoch,
      target_role_profile_digest: reqObj.target_role_profile_digest,
      routing_policy_version: reqObj.routing_policy_version,
      routing_policy_digest: reqObj.routing_policy_digest,
      native_target_binding_id: null,
      native_spawn_action_id: null,
      created_at: new Date().toISOString(),
      activation_liveness_expiry: new Date(Date.now() + 3600000).toISOString(),
      // selected_driver deliberately OMITTED.
    };
    rc.publishNoClobber(activationPath, Buffer.from(rc.canonicalJSONStringify(malformedActivation), "utf8"), { raceDetailCode: "AUTHORITY_INVALID" });
  ' "$RC_IMPL" "$artifact_ref"
}

@test "R11-TARGET-GATE-MALFORMED-ACTIVATION-BLOCKS-NOT-SILENT-ROLEACTOR (RED): a genuinely malformed (shape-invalid, missing selected_driver) activation/v1 record for the current attempt must BLOCK the target gate outright for claim, never silently fall through to mint a RoleActorBinding-backed grant as if the activation had simply never been written -- today resolveActivationForRequestPath's own catch-all collapses 'malformed' and 'legitimately absent' into the identical activation:null, so this wrongly proceeds and mints a real grant despite a tampered/corrupt activation record" {
  local proj; proj="$(_cosb_e2e_make_project)"
  local pub; pub="$(_cosb_e2e_publish_request "$proj" "arch-testing")"
  local request_id artifact_ref; read -r request_id artifact_ref <<< "$pub"
  [ -n "$request_id" ]

  run _r11_construct_malformed_activation "$proj" "$artifact_ref"
  [ "$status" -eq 0 ]

  local worktree_id plan_digest
  worktree_id="$(node -e 'const rll=require(process.argv[1]);process.stdout.write(rll.computeWorktreeId(process.argv[2]));' "$RLL_IMPL" "$proj")"
  plan_digest="$(node -e 'const rll=require(process.argv[1]);const r=rll.discoverPlan(process.argv[2]);process.stdout.write(r.ok?r.planDigest:"");' "$RLL_IMPL" "$proj")"

  # A real, live RoleActorBinding for the SAME {role, worktree, plan} DOES
  # exist -- proves this test isolates the malformed-activation gap
  # specifically, never merely "no RoleActorBinding to mint against either".
  run node -e '
    const rll = require(process.argv[1]);
    const result = rll.createRoleActorBinding(process.argv[2], "arch-testing", process.argv[3], process.argv[4], "a".repeat(32), 60);
    if (!result.ok) { process.stderr.write("RoleActorBinding mint failed: " + JSON.stringify(result)); process.exit(1); }
  ' "$RLL_IMPL" "$proj" "$worktree_id" "$plan_digest"
  [ "$status" -eq 0 ]

  local coord_root; coord_root="$(node -e 'const rll=require(process.argv[1]);process.stdout.write(rll.coordinationRootPathFor(process.argv[2]));' "$RLL_IMPL" "$proj")"
  local registry_before; registry_before="$(_cosb_registry_snapshot "$proj")"

  local target_input_file; target_input_file="$(mktemp)"
  node -e '
    const fs = require("fs");
    const rll = require(process.argv[5]);
    const IMPL = require("path").resolve(process.argv[1]);
    const command = rll.renderPosixDirect(["node", IMPL, "claim", "--coordination-root", process.argv[2], "--request", process.argv[3]]);
    fs.writeFileSync(process.argv[4], JSON.stringify({
      tool_name: "Bash", tool_input: { command },
      agent_type: "arch-testing", session_id: "r11-malformed-session", agent_id: "r11-malformed-agent-id",
    }));
  ' "$RC_IMPL" "$coord_root" "$artifact_ref" "$target_input_file" "$RLL_IMPL"

  run bash -c "cat '$target_input_file' | CLAUDE_PROJECT_DIR='$proj' node '$TARGET_GATE_HOOK'"
  _assert_pretooluse_deny
  rm -f "$target_input_file"

  local registry_after; registry_after="$(_cosb_registry_snapshot "$proj")"
  [ "$registry_after" = "$registry_before" ]

  rm -rf "$proj"
}

# ══════════════════════════════════════════════════════════════════════════
# M7 FINAL CORRECTION (test-specialist, batch 2 of 3, R15):
# validateAndConsumeRoleCommandGrantForCommand (runtime-consultation.cjs
# ~6626-6629) admits the consume-grant capability with
# `admitClaudeAuthorityOperation(..., 'consume-grant', validated.binding.expiry,
# ...)` -- the BACKING BINDING's own (long-lived) expiry, never the GRANT's
# own short (<=30s ceiling, ROLE_COMMAND_GRANT_TTL_SECONDS) expiry.
# validateRoleCommandGrantOrThrow (confirmed by direct read, ~6117) DOES
# reject an already-expired grant, but only at the moment IT runs -- BEFORE
# admission, BEFORE the command-after-admission-before-consume rendezvous
# pause. If the grant's OWN expiry elapses DURING that pause (real wall-clock
# time passing while the child sits at the rendezvous), the eventual guarded
# write (writeGuardedByClaudeAuthorityAdmission) only re-checks the
# capability's deadline -- which is bound to the STILL-LIVE binding expiry,
# never the now-stale grant -- so the write wrongly proceeds. Uses
# lease-heartbeat (no activation/dispatch dependency, confirmed by direct
# read of cmdLeaseHeartbeat) with a genuine ClaudeOneShotBinding (minted with
# a long TTL via the real B1/SubagentStart E2E chain, so its own expiry is
# far beyond the grant's 30s window) -- this is the SAME
# command-after-admission-before-consume rendezvous stage R6 uses, since
# admitClaudeAuthorityOperation has no transaction/grant-expiry visibility of
# its own (only a binding identity + operationKind + caller-supplied
# deadline), so this exact after-admission/before-write window is where any
# staleness that develops AFTER admission but BEFORE the write can only ever
# be caught -- or, today, silently missed.
#
# The CLI's own frozen envelope carries no message field (confirmed
# elsewhere in this file), so the internal 'binding-expired' reason string
# is not independently observable through this command's own stdout --
# this test instead proves the CORRECT, observable consequence: the CLI
# call itself must be denied (INVALID/AUTHORITY_INVALID), the grant's own
# one-time consumed marker must never be written, and the active-lease
# (indeed nothing under either the RLL registry or the transaction
# directory) must be byte-for-byte unchanged.
# ══════════════════════════════════════════════════════════════════════════

# Creates the M7 §10.1 rendezvous dir via fs.mkdtempSync(os.tmpdir()) INSIDE
# a node process (never bash mktemp -- see this file's own established
# warning elsewhere), so it is guaranteed to realpath-match what the spawned
# child's own resolveSafeM7RendezvousDir will independently resolve.
_r15_make_rendezvous_dir() {
  node -e 'const fs=require("fs"),os=require("os"),path=require("path");process.stdout.write(fs.mkdtempSync(path.join(os.tmpdir(),"m7-r15-rendezvous-")));'
}

@test "R15-GRANT-EXPIRY-IS-CONSUME-DEADLINE (RED): a target role-command-grant whose OWN 30s TTL elapses during the command-after-admission-before-consume window (while its backing ClaudeOneShotBinding remains genuinely live) must deny lease-heartbeat (INVALID/AUTHORITY_INVALID), write zero one-time consumed marker, and mutate nothing -- today admitClaudeAuthorityOperation is called with the BACKING BINDING's own long-lived expiry as the capability deadline, never the grant's own short expiry, so the guarded write wrongly proceeds once the grant has gone stale during this exact window" {
  local proj; proj="$(_cosb_e2e_make_project)"
  local pub; pub="$(_cosb_e2e_publish_request "$proj" "arch-testing")"
  local request_id artifact_ref; read -r request_id artifact_ref <<< "$pub"
  local native_spawn_action_id
  native_spawn_action_id="$(_cosb_e2e_construct_claude_agent_activation "$proj" "$artifact_ref")"
  run _cosb_e2e_mint_b1_reservation "$proj" "arch-testing" "$request_id"
  [ "$status" -eq 0 ]
  local hook_status
  hook_status="$(_cosb_e2e_subagent_start "$proj" "arch-testing" "cosb-e2e-orchestrator-session" "cosb-e2e-spawned-agent-id")"
  [ "$hook_status" = "0" ]
  local binding_id; binding_id="$(_cosb_e2e_find_binding_by_action_id "$proj" "$native_spawn_action_id")"
  [ -n "$binding_id" ]

  local coord_root; coord_root="$(node -e 'const rll=require(process.argv[1]);process.stdout.write(rll.coordinationRootPathFor(process.argv[2]));' "$RLL_IMPL" "$proj")"

  # Real claim first (no result exists yet -- the ordinary, unaffected path)
  # so a genuine claim.json + active-lease.json exist to heartbeat against.
  local claim_grant
  claim_grant="$(_cosb_e2e_mint_target_grant "$proj" "$binding_id" claim --coordination-root "$coord_root" --request "$artifact_ref" --role arch-testing)"
  [ -n "$claim_grant" ]
  local claim_output
  claim_output="$(NODE_ENV=test node "$RC_IMPL" claim --coordination-root "$coord_root" --request "$artifact_ref" --role arch-testing --target-binding "$claim_grant" 2>/dev/null)"
  local claim_artifact_ref
  claim_artifact_ref="$(node -e '
    const d = JSON.parse(process.argv[1]);
    if (!d.ok) { process.stderr.write("claim failed: " + process.argv[1]); process.exit(1); }
    process.stdout.write(d.artifact_ref);
  ' "$claim_output")"
  [ -n "$claim_artifact_ref" ]

  # A FRESH heartbeat grant -- its own 30s TTL starts now, well before the
  # binding's own multi-minute reservation-derived expiry.
  local heartbeat_grant
  heartbeat_grant="$(_cosb_e2e_mint_target_grant "$proj" "$binding_id" lease-heartbeat --coordination-root "$coord_root" --request "$artifact_ref" --claim "$claim_artifact_ref")"
  [ -n "$heartbeat_grant" ]

  local txn_dir; txn_dir="$(node -e 'process.stdout.write(require("path").dirname(process.argv[1]));' "$artifact_ref")"
  local registry_before; registry_before="$(_cosb_registry_snapshot "$proj")"
  local txn_before; txn_before="$(find "$txn_dir" -type f -print0 | sort -z | xargs -0 sha256sum 2>/dev/null | sha256sum | awk '{print $1}')"

  # Parse the grant's OWN expiry BEFORE starting the race -- the wait below
  # is computed against this parsed value, never a blind guessed sleep.
  local grant_expiry_ms
  grant_expiry_ms="$(node -e '
    const rll = require(process.argv[1]);
    const fs = require("fs");
    const rec = JSON.parse(fs.readFileSync(rll.roleCommandGrantPathFor(process.argv[2], process.argv[3]), "utf8"));
    process.stdout.write(String(Date.parse(rec.expiry)));
  ' "$RLL_IMPL" "$proj" "$heartbeat_grant")"
  [ -n "$grant_expiry_ms" ]

  local rendezvous_dir; rendezvous_dir="$(_r15_make_rendezvous_dir)"
  [ -n "$rendezvous_dir" ]
  local stage="command-after-admission-before-consume"
  local ready_path="$rendezvous_dir/${stage}.ready"
  local go_path="$rendezvous_dir/${stage}.go"

  # testM7Rendezvous's own poll is capped at 5000ms
  # (RUNTIME_M7_RENDEZVOUS_MAX_WAIT_MS, confirmed by direct read of
  # runtime-consultation.cjs) -- most of the grant's 30s TTL must therefore
  # elapse BEFORE the child is even spawned, leaving only a small margin
  # (comfortably under 5s) between the child reaching its own rendezvous
  # pause and the grant's real expiry.
  local pre_spawn_margin_ms=3000
  local now_ms pre_spawn_wait_ms
  now_ms="$(node -e 'process.stdout.write(String(Date.now()));')"
  pre_spawn_wait_ms=$((grant_expiry_ms - now_ms - pre_spawn_margin_ms))
  if [ "$pre_spawn_wait_ms" -gt 0 ]; then
    sleep "$(node -e 'process.stdout.write((Number(process.argv[1]) / 1000).toFixed(3));' "$pre_spawn_wait_ms")"
  fi

  local heartbeat_stdout_file heartbeat_stderr_file
  heartbeat_stdout_file="$(mktemp)"
  heartbeat_stderr_file="$(mktemp)"

  NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="rcc-r15-fixture-capability" \
    RUNTIME_M7_TEST_STAGE="$stage" \
    RUNTIME_M7_TEST_RENDEZVOUS_DIR="$rendezvous_dir" \
    node "$RC_IMPL" lease-heartbeat --coordination-root "$coord_root" --request "$artifact_ref" \
    --claim "$claim_artifact_ref" --target-binding "$heartbeat_grant" \
    >"$heartbeat_stdout_file" 2>"$heartbeat_stderr_file" &
  local heartbeat_pid=$!

  # Deterministic wait for the child to genuinely reach the pause point
  # (poll for the -ready sentinel; never a blind sleep as the race oracle).
  local waited_ms=0
  while [ ! -f "$ready_path" ]; do
    sleep 0.05
    waited_ms=$((waited_ms + 50))
    if [ "$waited_ms" -ge 4000 ]; then break; fi
  done
  if [ ! -f "$ready_path" ]; then
    kill "$heartbeat_pid" 2>/dev/null || true
    wait "$heartbeat_pid" 2>/dev/null || true
    echo "# R15 fixture failure: child never reached the rendezvous pause point within 4000ms; stderr=[$(cat "$heartbeat_stderr_file")]" >&2
    rm -f "$heartbeat_stdout_file" "$heartbeat_stderr_file"
    rm -rf "$rendezvous_dir"
    false
  fi

  # Wait the SMALL remainder against the PARSED grant expiry, real
  # wall-clock, comfortably inside testM7Rendezvous's own 5000ms budget.
  local remaining_ms
  now_ms="$(node -e 'process.stdout.write(String(Date.now()));')"
  remaining_ms=$((grant_expiry_ms - now_ms + 300))
  if [ "$remaining_ms" -gt 0 ]; then
    sleep "$(node -e 'process.stdout.write((Number(process.argv[1]) / 1000).toFixed(3));' "$remaining_ms")"
  fi
  now_ms="$(node -e 'process.stdout.write(String(Date.now()));')"
  # Fixture sanity: genuinely past the grant's own expiry before releasing.
  [ "$now_ms" -ge "$grant_expiry_ms" ]

  # Release the rendezvous -- exact bytes/mode the production reader requires.
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], Buffer.from("go\n", "utf8"), { mode: 0o600 });
  ' "$go_path"

  local heartbeat_exit=0
  wait "$heartbeat_pid" || heartbeat_exit=$?
  local heartbeat_stdout; heartbeat_stdout="$(cat "$heartbeat_stdout_file")"
  rm -f "$heartbeat_stdout_file" "$heartbeat_stderr_file"
  rm -rf "$rendezvous_dir"

  [ -n "$heartbeat_stdout" ]
  run node -e '
    const data = JSON.parse(process.argv[1]);
    if (data.status !== "INVALID" || data.detail_code !== "AUTHORITY_INVALID") {
      process.stderr.write("M7 checklist R15: a grant whose OWN expiry elapses during the after-admission-before-consume window must deny INVALID/AUTHORITY_INVALID -- today admission binds its capability deadline to the BACKING BINDING expiry (long-lived), never the grant own short expiry, so this wrongly succeeds: " + process.argv[1]);
      process.exit(1);
    }
  ' "$heartbeat_stdout"
  [ "$status" -eq 0 ]
  [ "$heartbeat_exit" -eq 3 ]

  local registry_after; registry_after="$(_cosb_registry_snapshot "$proj")"
  [ "$registry_after" = "$registry_before" ]
  local txn_after; txn_after="$(find "$txn_dir" -type f -print0 | sort -z | xargs -0 sha256sum 2>/dev/null | sha256sum | awk '{print $1}')"
  [ "$txn_after" = "$txn_before" ]

  rm -rf "$proj"
}

# ══════════════════════════════════════════════════════════════════════════
# M7 FINAL CORRECTION, correction round 1 (2026-08-18, C4): createClaudeOneShotBinding
# has TWO paths that must each include the applicable transaction terminal in
# their own predicate, and today neither does:
#   - the pre-classification dedup/reuse block (~L4019-4037): once
#     preClassification finds a live one-shot binding for the SAME identity
#     whose 8 correlated fields (native_spawn_action_id/request_id/attempt_id/
#     lease_epoch/agent_type/role/worktree_id/plan_digest) all match the
#     caller's proposed values, it returns { ok:true, binding:existing }
#     immediately -- no terminal check, no admission, no post-write predicate
#     at all. A terminal landing on that transaction AFTER the original mint
#     but BEFORE a repeat call is therefore silently invisible to the reuse
#     decision.
#   - the brand-new-create path: admitClaudeAuthorityOperation is called with
#     operationKind:'create-binding' (~L4053), and admission's own step 4/5
#     terminal read is explicitly gated `if (operationKind !== 'create-binding')`
#     (runtime-role-lifecycle.cjs ~4603) -- i.e. skipped entirely for
#     create-binding. The post-write predicate re-check (~4085-4088) is
#     classifyClaudeAuthorityForIdentity + checkClaudeAuthorityClassificationAgainstExpected
#     only -- fence/ambiguity, never a transaction terminal. So a genuinely
#     NEW one-shot binding can be minted today for a request/attempt that
#     already has a durable authoritative result, with zero check anywhere in
#     the function blocking it.
# Target (per Codex's correction ruling): a repeat/reuse call must rerun the
# complete predicate including the terminal before trusting the dedup match;
# a new create must validate the proposed request/attempt's terminal BEFORE
# the write. Both land on checkOneShotTransactionTerminalAbsent's own
# established reason, 'claude-one-shot-transaction-terminal' (the same
# reason mintRoleCommandGrant's own post-ingress one-shot terminal check
# already uses, runtime-role-lifecycle.cjs ~4959) -- inferred from that
# established convention, not dictated verbatim by the dispatch; flag if
# toolkit-specialist lands a differently-named reason.
# Race variant (terminal lands between admission and write on a NEW create)
# is explicitly NOT included here -- time-boxed per the dispatch's own P0
# minimum ("the pre-write case alone is the P0 minimum, flag if you skip the
# race variant"). Flagged in the report, not silently dropped.
# ══════════════════════════════════════════════════════════════════════════

# Constructs and durably publishes a real coordination/result/v2 for the
# transaction at `artifact_ref`, status ANSWERED -- every mirrored field read
# directly off the real request.json, never invented, same technique as R6's
# own inline construction above (extracted here since C4 needs it twice).
_c4_publish_terminal_result() {
  local artifact_ref="$1"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const rc = require(process.argv[2]);
    const requestPath = process.argv[1];
    const reqObj = JSON.parse(fs.readFileSync(requestPath, "utf8"));
    const txnDir = path.dirname(requestPath);
    const resultPath = path.join(txnDir, "results", reqObj.initial_attempt_id + ".json");
    const resultObj = {
      schema: "coordination/result/v2", in_reply_to: reqObj.request_id,
      request_digest: rc.sha256File(requestPath), plan_digest: reqObj.plan_digest,
      repo_id: reqObj.repo_id, wave_slug: reqObj.wave_slug, protocol_profile: reqObj.protocol_profile,
      max_depth: reqObj.max_depth, routing_policy_version: reqObj.routing_policy_version,
      routing_policy_digest: reqObj.routing_policy_digest, root_request_id: reqObj.root_request_id,
      parent_request_id: reqObj.parent_request_id, depth: reqObj.depth,
      attempt_id: reqObj.initial_attempt_id, lease_epoch: reqObj.initial_lease_epoch,
      driver: "noop", claimant_instance_id: "c".repeat(64), worker_session_id: null,
      claim_digest: "1".repeat(64), target_role_profile_version: reqObj.target_role_profile_version,
      target_role_profile_digest: reqObj.target_role_profile_digest, from_role: reqObj.target_role,
      to_role: reqObj.source_role, result_kind: reqObj.expected_result_kind, status: "ANSWERED", reason: null,
      content: "C4 fixture terminal content", subject_repo_id: reqObj.subject_repo_id,
      subject_worktree_id: reqObj.subject_worktree_id, subject_head: reqObj.subject_head,
      subject_scope_digest: reqObj.subject_scope_digest, consultation_dependencies: [],
      producer_worktree_id: reqObj.subject_worktree_id, producer_head: reqObj.subject_head,
      created_at: new Date().toISOString(), pattern_evidence_dependency: null,
    };
    rc.publishNoClobber(resultPath, Buffer.from(rc.canonicalJSONStringify(resultObj), "utf8"), { raceDetailCode: "AUTHORITY_INVALID" });
  ' "$artifact_ref" "$RC_IMPL"
}

@test "COSB-CREATE-REUSE-DENIED-ONCE-TERMINAL (RED): a repeat createClaudeOneShotBinding call for an identical logical spawn (all 8 correlated fields matching a live existing one-shot binding) must NOT return the cached binding once its transaction has acquired a durable terminal since the original mint -- today the pre-classification dedup block returns the existing binding on field-match alone, never re-running the terminal check" {
  local proj; proj="$(_cosb_e2e_make_project)"
  local chain; chain="$(_cosb_e2e_happy_path_to_binding "$proj")"
  local binding_id coord_root artifact_ref; read -r binding_id coord_root artifact_ref <<< "$chain"
  [ -n "$binding_id" ]

  run _c4_publish_terminal_result "$artifact_ref"
  [ "$status" -eq 0 ]

  run node -e '
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const bindingId = process.argv[3];
    const bindingRead = rll.readRegistryRecord(rll.claudeOneShotBindingPathFor(projectRoot, bindingId));
    if (!bindingRead.ok || bindingRead.absent) { process.stderr.write("fixture: binding read failed: " + JSON.stringify(bindingRead)); process.exit(1); }
    const b = bindingRead.obj;
    const result = rll.createClaudeOneShotBinding(
      projectRoot, b.runtime_session_key, b.session_generation_id, b.agent_id, b.agent_type,
      b.native_spawn_action_id, b.request_id, b.attempt_id, b.lease_epoch, b.role,
      b.worktree_id, b.plan_digest, 3600,
    );
    if (result.ok) {
      process.stderr.write("M7 C4: a repeat createClaudeOneShotBinding call for an identical logical spawn must rerun the complete predicate (terminal included) rather than trusting the pre-classification dedup match -- today it wrongly reuses the existing binding even though its transaction now has a durable terminal: " + JSON.stringify(result));
      process.exit(1);
    }
    if (result.reason !== "claude-one-shot-transaction-terminal") {
      process.stderr.write("M7 C4: expected reason claude-one-shot-transaction-terminal, got: " + JSON.stringify(result));
      process.exit(1);
    }
  ' "$RLL_IMPL" "$proj" "$binding_id"
  [ "$status" -eq 0 ]

  rm -rf "$proj"
}

@test "COSB-CREATE-REUSE-POSITIVE-CONTROL-STILL-OPEN: a repeat createClaudeOneShotBinding call for an identical logical spawn whose transaction genuinely has NO terminal yet still succeeds and returns the SAME cached binding_id -- control proving the denial above is attributable specifically to the terminal, not to the repeat call itself" {
  local proj; proj="$(_cosb_e2e_make_project)"
  local chain; chain="$(_cosb_e2e_happy_path_to_binding "$proj")"
  local binding_id coord_root artifact_ref; read -r binding_id coord_root artifact_ref <<< "$chain"
  [ -n "$binding_id" ]

  run node -e '
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const bindingId = process.argv[3];
    const bindingRead = rll.readRegistryRecord(rll.claudeOneShotBindingPathFor(projectRoot, bindingId));
    if (!bindingRead.ok || bindingRead.absent) { process.stderr.write("fixture: binding read failed: " + JSON.stringify(bindingRead)); process.exit(1); }
    const b = bindingRead.obj;
    const result = rll.createClaudeOneShotBinding(
      projectRoot, b.runtime_session_key, b.session_generation_id, b.agent_id, b.agent_type,
      b.native_spawn_action_id, b.request_id, b.attempt_id, b.lease_epoch, b.role,
      b.worktree_id, b.plan_digest, 3600,
    );
    if (!result.ok) { process.stderr.write("M7 C4 positive control: reuse must still succeed while genuinely open: " + JSON.stringify(result)); process.exit(1); }
    if (result.binding.binding_id !== bindingId) { process.stderr.write("M7 C4 positive control: reuse must return the SAME cached binding_id, got a different one: " + JSON.stringify(result)); process.exit(1); }
  ' "$RLL_IMPL" "$proj" "$binding_id"
  [ "$status" -eq 0 ]

  rm -rf "$proj"
}

@test "COSB-CREATE-NEW-DENIED-PROPOSED-TERMINAL-PRE-WRITE (RED): a brand-new createClaudeOneShotBinding call (no prior one-shot binding for this identity at all) proposing a request/attempt that ALREADY has a durable authoritative result must be denied BEFORE any write -- today admission's own step-5 terminal read is explicitly skipped for operationKind:'create-binding', and the post-write predicate is fence/ambiguity-only, so nothing anywhere in this function ever examines the transaction terminal for a genuinely new create" {
  local proj; proj="$(_cosb_e2e_make_project)"
  local pub; pub="$(_cosb_e2e_publish_request "$proj" "arch-testing")"
  local request_id artifact_ref; read -r request_id artifact_ref <<< "$pub"
  [ -n "$request_id" ]

  # Someone else already published a real, durable authoritative result for
  # this exact request/attempt -- deliberately WITHOUT ever minting a one-shot
  # binding for it (a result/v2 needs no backing binding to exist).
  run _c4_publish_terminal_result "$artifact_ref"
  [ "$status" -eq 0 ]

  # A genuinely fresh, never-before-used claude-hook identity -- proves
  # preClassification is ABSENT (the dedup/reuse branch above is never
  # reached), isolating this test to the new-create path specifically.
  # Resolved BEFORE the zero-write snapshot below: resolveSessionGeneration
  # legitimately mints a new session-generation record on first use for a
  # never-before-seen identity (its own documented mint-or-reuse contract) --
  # capturing registry_before beforehand would wrongly attribute that
  # unrelated, legitimate mint to createClaudeOneShotBinding's own denial.
  local session_id="c4-new-create-session"
  local agent_id="c4-new-create-agent-id"
  local generation_id
  generation_id="$(node -e '
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const sessionId = process.argv[3];
    const genResult = rll.resolveSessionGeneration(projectRoot, { provider: "claude-hook", runtime_session_key: sessionId });
    if (!genResult.ok) { process.stderr.write("fixture: session generation resolve failed: " + JSON.stringify(genResult)); process.exit(1); }
    process.stdout.write(genResult.generationId);
  ' "$RLL_IMPL" "$proj" "$session_id")"
  [ -n "$generation_id" ]

  local registry_before; registry_before="$(_cosb_registry_snapshot "$proj")"

  run node -e '
    const fs = require("fs");
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const requestPath = process.argv[3];
    const sessionId = process.argv[4];
    const agentId = process.argv[5];
    const generationId = process.argv[6];
    const reqObj = JSON.parse(fs.readFileSync(requestPath, "utf8"));

    const result = rll.createClaudeOneShotBinding(
      projectRoot, sessionId, generationId, agentId, reqObj.target_role,
      rll.generateActionId(), reqObj.request_id, reqObj.initial_attempt_id, reqObj.initial_lease_epoch,
      reqObj.target_role, rll.computeWorktreeId(projectRoot), reqObj.plan_digest, 3600,
    );
    if (result.ok) {
      process.stderr.write("M7 C4: a brand-new createClaudeOneShotBinding call for a request/attempt that already has a durable authoritative result must be denied before any write -- today nothing checks this and it wrongly succeeds: " + JSON.stringify(result));
      process.exit(1);
    }
    if (result.reason !== "claude-one-shot-transaction-terminal") {
      process.stderr.write("M7 C4: expected reason claude-one-shot-transaction-terminal, got: " + JSON.stringify(result));
      process.exit(1);
    }
  ' "$RLL_IMPL" "$proj" "$artifact_ref" "$session_id" "$agent_id" "$generation_id"
  [ "$status" -eq 0 ]

  # Zero write: the denial must leave the registry byte-for-byte unchanged
  # (no inert one-shot-binding record left behind).
  local registry_after; registry_after="$(_cosb_registry_snapshot "$proj")"
  [ "$registry_after" = "$registry_before" ]

  rm -rf "$proj"
}

# ══════════════════════════════════════════════════════════════════════════
# M7 FINAL CORRECTION, correction round 1 (2026-08-18, C2): the one-shot
# transaction-substitution bypass. checkAuthorityOperationTransactionTerminal
# (runtime-role-lifecycle.cjs ~4807-4824) reads the applicable terminal from
# `operationContext.txnDir` for the 'one-shot' family -- a value the ONLY
# real caller (validateAndConsumeRoleCommandGrantForCommand,
# runtime-consultation.cjs ~6613-6622) builds from `path.dirname(resolveAbsolute(
# flags.request))`, i.e. the CURRENT CLI invocation's own --request flag,
# never independently re-derived from the classified binding's own
# request_id/attempt_id. Empirically confirmed (scratch diagnostics, not
# committed) that a naive "mint for A, consume with --request pointed at B"
# swap on the SAME grant is blocked by an unrelated protection
# (validateAndConsumeRoleCommandGrantForCommand's own argv-digest binds
# --request's exact string between mint and consume) -- reaching the real gap
# requires a grant whose requestId/attemptId/leaseEpoch parameters are A's
# (satisfying mintRoleCommandGrant's own requestId!==binding.request_id
# check, ~4958) while its OWN argvDigest parameter is independently computed
# over an argv containing --request <decoy B>. mintRoleCommandGrant's
# argvDigest parameter is a caller-supplied opaque hash, never cross-derived
# from requestId -- nothing in the function ties the two together. A real CLI
# call using --request B (matching that digest) and --target-binding <this
# grant> then passes validateRoleCommandGrantOrThrow cleanly (validated.requestId
# comes back as A, the grant's own stored field) while
# consumeOperationContext.txnDir is built from the CURRENT --request = B.
# Reproduced end to end against the real `claim` CLI both directions:
#   - A terminal, B open: `claim` wrongly SUCCEEDS (should deny).
#   - A open, B terminal: `claim` wrongly DENIES AUTHORITY_INVALID (should
#     succeed) -- this is Codex's own flagged "ok:false-only assertion is
#     insufficient" case: a broken implementation checking B instead of A
#     denies here too, for the wrong reason, so this positive-direction test
#     is what actually proves the fix examines the RIGHT transaction.
# The CLI's own JSON envelope carries no message field and collapses every
# admission-denial reason to the same coarse detail_code:"AUTHORITY_INVALID"
# (confirmed empirically, both scenarios produce byte-identical envelope
# shape) -- the internal reason string is never observable through a CLI
# subprocess call. Each test below therefore asserts BOTH layers: a direct
# rll.admitClaudeAuthorityOperation call (same pattern this file's own
# _cosb_validate already uses for direct RLL calls) for the exact reason, and
# a full CLI round-trip for the user-observable behavior -- belt and
# suspenders, mirrors this file's own R6/R15 style of combining a CLI-status
# assertion with a registry-state assertion in the same test.
# Root-source's mintRoleCommandGrant branch (~4918-4947, own requestId!==
# ingress.request_id check at mint time, same decoupled argvDigest parameter)
# is structurally identical -- covered separately in
# runtime-consultation-role-gate.bats, which already owns this codebase's
# real root-source binding/ingress fixture chain.
# ══════════════════════════════════════════════════════════════════════════

# Publishes a real, unrelated decoy transaction for `role` and gives it its
# own real activation (cmdClaim requires resolveActivationForRequestPath to
# resolve for whatever --request points at, regardless of driver) -- never a
# one-shot binding, which the decoy must never have. Prints "<request_id>
# <artifact_ref>".
_c2_build_decoy_transaction() {
  local proj="$1" role="$2"
  local pub; pub="$(_cosb_e2e_publish_request "$proj" "$role")"
  local request_id artifact_ref; read -r request_id artifact_ref <<< "$pub"
  _cosb_e2e_construct_claude_agent_activation "$proj" "$artifact_ref" >/dev/null
  printf '%s %s' "$request_id" "$artifact_ref"
}

# Publishes a real, schema-correct coordination/result/v2 record at the
# EXACT HYBRID path checkAuthorityOperationTransactionTerminal's own one-shot
# branch actually constructs (runtime-role-lifecycle.cjs ~4808-4812:
# checkOneShotTransactionTerminalAbsentAtTxnDir(operationContext.txnDir,
# binding.attempt_id) -- the DECOY's caller-supplied directory combined with
# the REAL binding's own attempt_id, never the decoy's own natural attempt_id).
# Empirically confirmed necessary: a terminal published at the decoy's own
# natural result path (its own initial_attempt_id) is never consulted by this
# lookup formula at all and would make the positive-direction test below
# vacuous (always "absent" regardless of vulnerable-vs-fixed code) --
# real_artifact_ref supplies the attempt_id, decoy_artifact_ref supplies only
# the containing directory. Every mirrored field is read off the REAL (A's)
# request, never invented.
_c2_plant_hybrid_path_terminal() {
  local real_artifact_ref="$1" decoy_artifact_ref="$2"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const rc = require(process.argv[3]);
    const realRequestPath = process.argv[1];
    const decoyArtifactRef = process.argv[2];
    const reqObj = JSON.parse(fs.readFileSync(realRequestPath, "utf8"));
    const decoyTxnDir = path.dirname(decoyArtifactRef);
    const resultPath = path.join(decoyTxnDir, "results", reqObj.initial_attempt_id + ".json");
    const resultObj = {
      schema: "coordination/result/v2", in_reply_to: reqObj.request_id,
      request_digest: rc.sha256File(realRequestPath), plan_digest: reqObj.plan_digest,
      repo_id: reqObj.repo_id, wave_slug: reqObj.wave_slug, protocol_profile: reqObj.protocol_profile,
      max_depth: reqObj.max_depth, routing_policy_version: reqObj.routing_policy_version,
      routing_policy_digest: reqObj.routing_policy_digest, root_request_id: reqObj.root_request_id,
      parent_request_id: reqObj.parent_request_id, depth: reqObj.depth,
      attempt_id: reqObj.initial_attempt_id, lease_epoch: reqObj.initial_lease_epoch,
      driver: "noop", claimant_instance_id: "c".repeat(64), worker_session_id: null,
      claim_digest: "1".repeat(64), target_role_profile_version: reqObj.target_role_profile_version,
      target_role_profile_digest: reqObj.target_role_profile_digest, from_role: reqObj.target_role,
      to_role: reqObj.source_role, result_kind: reqObj.expected_result_kind, status: "ANSWERED", reason: null,
      content: "C2 hybrid-path fixture terminal content", subject_repo_id: reqObj.subject_repo_id,
      subject_worktree_id: reqObj.subject_worktree_id, subject_head: reqObj.subject_head,
      subject_scope_digest: reqObj.subject_scope_digest, consultation_dependencies: [],
      producer_worktree_id: reqObj.subject_worktree_id, producer_head: reqObj.subject_head,
      created_at: new Date().toISOString(), pattern_evidence_dependency: null,
    };
    rc.publishNoClobber(resultPath, Buffer.from(rc.canonicalJSONStringify(resultObj), "utf8"), { raceDetailCode: "AUTHORITY_INVALID" });
  ' "$real_artifact_ref" "$decoy_artifact_ref" "$RC_IMPL"
}

@test "C2-ONESHOT-WRONG-TRANSACTION-REAL-TERMINAL-DECOY-OPEN (RED): real transaction A (the grant's own backing) has a durable terminal; an unrelated decoy transaction B exists and is open. Admission must FAIL with the real transaction's own terminal reason, regardless of decoy B's presence -- today the terminal check examines B (open), wrongly finds nothing wrong, and admission wrongly succeeds. M7 correction round 1 test-side reconciliation (2026-08-18): the original Layer 2 (real CLI --request-pointed-at-decoy round-trip, via a grant crafted with A's own request_id but an argv naming B) is REMOVED, not merely fixed -- C2's own newly-landed Phase A correlation (runtime-consultation.cjs validateAndConsumeRoleCommandGrantForCommand, 'accredited --request does not correlate to the validated role-command-grant') now structurally requires --request's own request_id to exactly equal the grant's stored request_id, so no CLI-reachable construction can any longer point --request at a transaction other than the grant's own real backing -- the substitution vector this Layer 2 targeted is closed at an earlier checkpoint than the terminal-check itself, making a CLI-level decoy unbuildable. Layer 1 (this test) remains the correct, still-genuinely-discriminating proof of the terminal-check's own internal path derivation." {
  local proj; proj="$(_cosb_e2e_make_project)"
  local chain; chain="$(_cosb_e2e_happy_path_to_binding "$proj")"
  local binding_id coord_root artifact_ref; read -r binding_id coord_root artifact_ref <<< "$chain"
  [ -n "$binding_id" ]

  local decoy; decoy="$(_c2_build_decoy_transaction "$proj" "arch-testing")"
  local decoy_request_id decoy_artifact_ref; read -r decoy_request_id decoy_artifact_ref <<< "$decoy"
  [ -n "$decoy_artifact_ref" ]
  [ "$decoy_artifact_ref" != "$artifact_ref" ]

  run _c4_publish_terminal_result "$artifact_ref"
  [ "$status" -eq 0 ]

  # Layer 1: direct admission call, exact reason.
  run node -e '
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const bindingId = process.argv[3];
    const bindingRead = rll.readRegistryRecord(rll.claudeOneShotBindingPathFor(projectRoot, bindingId));
    const binding = bindingRead.obj;
    const identity = {
      schema: rll.CLAUDE_AUTHORITY_IDENTITY_SCHEMA, provider: "claude-hook",
      repo_id: rll.computeRepoId(projectRoot), runtime_session_key: binding.runtime_session_key, agent_id: binding.agent_id,
    };
    const admission = rll.admitClaudeAuthorityOperation(
      projectRoot, identity, "consume-grant", binding.expiry,
      { family: "one-shot", bindingId },
    );
    if (admission.ok) {
      process.stderr.write("M7 C2: admission must FAIL when the real backing transaction A has a durable terminal -- today it wrongly succeeds: " + JSON.stringify(admission));
      process.exit(1);
    }
    if (admission.reason !== "claude-one-shot-transaction-terminal") {
      process.stderr.write("M7 C2: expected reason claude-one-shot-transaction-terminal, got: " + JSON.stringify(admission));
      process.exit(1);
    }
  ' "$RLL_IMPL" "$proj" "$binding_id"
  [ "$status" -eq 0 ]

  rm -rf "$proj"
}

@test "C2-ONESHOT-WRONG-TRANSACTION-REAL-OPEN-DECOY-TERMINAL (positive direction, RED): real transaction A (the grant's own backing) is genuinely open; an unrelated decoy transaction B has a durable terminal. Admission must SUCCEED -- since A itself has no terminal, B's terminal is correctly irrelevant. Today the terminal check wrongly examines B, finds ITS terminal, and admission wrongly denies -- this is the case that actually proves a fix examines the RIGHT transaction rather than merely 'some' transaction (an ok:false-only assertion elsewhere would not catch this). M7 correction round 1 test-side reconciliation (2026-08-18): Layer 2 removed for the identical reason documented on this test's REAL-TERMINAL-DECOY-OPEN sibling above -- C2's own Phase A correlation now makes a CLI-reachable --request-pointed-at-decoy construction structurally impossible, so only Layer 1 (this test) remains buildable and discriminating." {
  local proj; proj="$(_cosb_e2e_make_project)"
  local chain; chain="$(_cosb_e2e_happy_path_to_binding "$proj")"
  local binding_id coord_root artifact_ref; read -r binding_id coord_root artifact_ref <<< "$chain"
  [ -n "$binding_id" ]

  local decoy; decoy="$(_c2_build_decoy_transaction "$proj" "arch-testing")"
  local decoy_request_id decoy_artifact_ref; read -r decoy_request_id decoy_artifact_ref <<< "$decoy"
  [ -n "$decoy_artifact_ref" ]
  [ "$decoy_artifact_ref" != "$artifact_ref" ]

  # Plants a terminal-shaped result at the EXACT path the vulnerable lookup
  # (decoy directory + A's own attempt_id, never the decoy's own natural
  # attempt_id) actually constructs -- see _c2_plant_hybrid_path_terminal's
  # own doc comment for why this is the only construction that makes this
  # positive-direction test genuinely discriminating rather than vacuous.
  run _c2_plant_hybrid_path_terminal "$artifact_ref" "$decoy_artifact_ref"
  [ "$status" -eq 0 ]

  # Layer 1: direct admission call must SUCCEED (A itself is open).
  run node -e '
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const bindingId = process.argv[3];
    const bindingRead = rll.readRegistryRecord(rll.claudeOneShotBindingPathFor(projectRoot, bindingId));
    const binding = bindingRead.obj;
    const identity = {
      schema: rll.CLAUDE_AUTHORITY_IDENTITY_SCHEMA, provider: "claude-hook",
      repo_id: rll.computeRepoId(projectRoot), runtime_session_key: binding.runtime_session_key, agent_id: binding.agent_id,
    };
    const admission = rll.admitClaudeAuthorityOperation(
      projectRoot, identity, "consume-grant", binding.expiry,
      { family: "one-shot", bindingId },
    );
    if (!admission.ok) {
      process.stderr.write("M7 C2 positive direction: admission must SUCCEED when the real backing transaction A is genuinely open, regardless of an unrelated decoy transaction own terminal -- today it wrongly denies: " + JSON.stringify(admission));
      process.exit(1);
    }
  ' "$RLL_IMPL" "$proj" "$binding_id"
  [ "$status" -eq 0 ]

  rm -rf "$proj"
}

# ══════════════════════════════════════════════════════════════════════════
# M7 correction round 1 (2026-08-18, GAP-3, task #56): mutation #12 (task
# #55) confirmed disabling Phase A's own accreditCanonicalRequest
# correlation check (validateAndConsumeRoleCommandGrantForCommand,
# runtime-consultation.cjs) let the full 69-test claude-one-shot-binding-red
# suite stay green -- ZERO CLI-level coverage exercised it. This is the SAME
# crafted-grant construction the (now Layer-1-only) C2-ONESHOT tests above
# used for THEIR OWN property before C2's Phase A correlation made their CLI
# leg vacuous for it -- reused here because it is exactly the right vehicle
# for Phase A's OWN correlation property instead: decoy B carries NO
# terminal at all (ruling out the terminal-check as the cause) and its own
# genuinely resolvable activation (ruling out LP1 admission, whose
# expectedBacking match is against the classifier's family/bindingId, never
# --request), isolating the denial to Phase A's own request-vs-grant field
# correlation specifically.
# ══════════════════════════════════════════════════════════════════════════

# Mints a target role-command-grant/v1 whose requestId/attemptId/leaseEpoch
# are `binding_id`'s OWN (satisfying mintRoleCommandGrant's own
# requestId!==binding.request_id check), but whose argvDigest is computed
# over an argv using `--request <decoy_artifact_ref>` instead -- i.e. exactly
# what a REAL consume-time CLI call with --request pointed at the decoy would
# hash to. Prints the grant_id.
_gap3_mint_crafted_target_grant() {
  local proj="$1" binding_id="$2" subcommand="$3" coord_root="$4" decoy_artifact_ref="$5" role="$6"
  node -e '
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const bindingId = process.argv[4];
    const subcommand = process.argv[5];
    const coordRoot = process.argv[6];
    const decoyArtifactRef = process.argv[7];
    const role = process.argv[8];
    const bindingRead = rll.readRegistryRecord(rll.claudeOneShotBindingPathFor(projectRoot, bindingId));
    if (!bindingRead.ok || bindingRead.absent) { process.stderr.write("fixture: binding read failed"); process.exit(1); }
    const binding = bindingRead.obj;
    const consumeArgvWithDecoy = ["--coordination-root", coordRoot, "--request", decoyArtifactRef, "--role", role];
    const craftedDigest = rc.sha256String(rc.canonicalJSONStringify(consumeArgvWithDecoy));
    const mintResult = rll.mintRoleCommandGrant(projectRoot, binding, "target", subcommand, craftedDigest, binding.request_id, binding.attempt_id, binding.lease_epoch);
    if (!mintResult.ok) { process.stderr.write("crafted mint failed: " + JSON.stringify(mintResult)); process.exit(1); }
    process.stdout.write(mintResult.grantId);
  ' "$RLL_IMPL" "$RC_IMPL" "$proj" "$binding_id" "$subcommand" "$coord_root" "$decoy_artifact_ref" "$role"
}

@test "C2-PHASEA-CORRELATION-WRONG-REQUEST (GAP-3): a grant genuinely minted+consumable for real transaction A (argv-digest and requestId/attemptId/leaseEpoch all match A) is presented via a REAL CLI call whose --request instead points at an unrelated, genuinely OPEN transaction B with its own genuinely resolvable activation -- Phase A's own accreditCanonicalRequest correlation must reject AUTHORITY_INVALID before ever reaching LP1 admission or the terminal-check, zero registry mutation. Mutation #12 (task #55) confirmed disabling ONLY this check leaves the full suite green -- nothing downstream catches this substitution on its own." {
  local proj; proj="$(_cosb_e2e_make_project)"
  local chain; chain="$(_cosb_e2e_happy_path_to_binding "$proj")"
  local binding_id coord_root artifact_ref; read -r binding_id coord_root artifact_ref <<< "$chain"
  [ -n "$binding_id" ]

  local decoy; decoy="$(_c2_build_decoy_transaction "$proj" "arch-testing")"
  local decoy_request_id decoy_artifact_ref; read -r decoy_request_id decoy_artifact_ref <<< "$decoy"
  [ -n "$decoy_artifact_ref" ]
  [ "$decoy_artifact_ref" != "$artifact_ref" ]

  local crafted_grant
  crafted_grant="$(_gap3_mint_crafted_target_grant "$proj" "$binding_id" claim "$coord_root" "$decoy_artifact_ref" arch-testing)"
  [ -n "$crafted_grant" ]

  local registry_before; registry_before="$(_cosb_registry_snapshot "$proj")"
  run node "$RC_IMPL" claim --coordination-root "$coord_root" --request "$decoy_artifact_ref" --role arch-testing --target-binding "$crafted_grant"
  [[ "$output" == *'"ok":false'* ]]
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
  local registry_after; registry_after="$(_cosb_registry_snapshot "$proj")"
  [ "$registry_after" = "$registry_before" ]

  rm -rf "$proj"
}

# ══════════════════════════════════════════════════════════════════════════
# M7 GREEN correction round 2, R2: validateAndConsumeRoleCommandGrantForCommand's
# own Phase A --request correlation block (runtime-consultation.cjs, the
# same block C2-PHASEA-CORRELATION-WRONG-REQUEST above exercises) checks
# repo_id, plan_digest, request_id, attempt_id, lease_epoch and role -- but,
# confirmed by direct read, never worktree_id at all. The classifier itself
# (classifyClaudeAuthorityForIdentity) deliberately does not filter
# candidates by worktree either (M7 section 6: "a current unexpired v2
# record matching the exact session+agent is a candidate even when its
# PLAN/worktree/role differs"), relying entirely on THIS layer for
# cross-worktree rejection. Unlike the decoy-transaction test above (a
# DIFFERENT request_id, caught by the request_id equality check alone),
# this tampers ONLY subject_worktree_id inside the SAME real, otherwise
# untouched request.json -- every other correlated field (repo_id,
# plan_digest, request_id, attempt_id, lease_epoch, role) still matches
# exactly, so only a genuine worktree_id check can catch it.
# ══════════════════════════════════════════════════════════════════════════

@test "M7-R2-PHASEA-WORKTREE-CORRELATION-TAMPERED-SUBJECT: a real request.json whose subject_worktree_id is tampered to a different (but still well-formed) worktree id, while every other Phase A field stays genuinely correlated, must be rejected AUTHORITY_INVALID -- correction round 2's R2 ruling" {
  local proj; proj="$(_cosb_e2e_make_project)"
  local chain; chain="$(_cosb_e2e_happy_path_to_binding "$proj")"
  local binding_id coord_root artifact_ref; read -r binding_id coord_root artifact_ref <<< "$chain"
  [ -n "$binding_id" ]

  local claim_grant
  claim_grant="$(_cosb_e2e_mint_target_grant "$proj" "$binding_id" claim --coordination-root "$coord_root" --request "$artifact_ref" --role arch-testing)"
  [ -n "$claim_grant" ]

  # Tamper ONLY subject_worktree_id in the real request.json to a different,
  # still well-formed (64-hex) worktree id -- everything else (repo_id,
  # plan_digest, request_id, role) is untouched.
  run node -e '
    const fs = require("fs");
    const crypto = require("crypto");
    const artifactRef = process.argv[1];
    const obj = JSON.parse(fs.readFileSync(artifactRef, "utf8"));
    if (typeof obj.subject_worktree_id !== "string" || obj.subject_worktree_id.length === 0) {
      process.stderr.write("fixture: request.json has no subject_worktree_id field: " + JSON.stringify(Object.keys(obj)));
      process.exit(1);
    }
    let tampered = crypto.randomBytes(32).toString("hex");
    if (tampered === obj.subject_worktree_id) tampered = crypto.randomBytes(32).toString("hex");
    obj.subject_worktree_id = tampered;
    fs.writeFileSync(artifactRef, JSON.stringify(obj));
  ' "$artifact_ref"
  [ "$status" -eq 0 ]

  local registry_before; registry_before="$(_cosb_registry_snapshot "$proj")"
  run node "$RC_IMPL" claim --coordination-root "$coord_root" --request "$artifact_ref" --role arch-testing --target-binding "$claim_grant"
  [[ "$output" == *'"ok":false'* ]]
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
  local registry_after; registry_after="$(_cosb_registry_snapshot "$proj")"
  [ "$registry_after" = "$registry_before" ]

  rm -rf "$proj"
}

# ══════════════════════════════════════════════════════════════════════════
# M7 FINAL CORRECTION, correction round 1 (2026-08-18, C1 -- PARTIAL, Boundary
# 1 + positive control only). Codex's own final ruling defines ONE authority
# linearization point (LP1, admitClaudeAuthorityOperation itself): a cut
# durable BEFORE LP1 denies with zero consumed marker; a cut after LP1 must
# never trigger re-admission. Grant consumption happens unconditionally once
# LP1 succeeds (via writeGuardedByClaudeAuthorityAdmission) -- it is no longer
# gated by the standalone terminal recheck at command-after-admission-before-
# consume (~6662-6669), which this correction round deletes; command-before-
# admission also relocates to sit immediately before admitClaudeAuthorityOperation
# itself, after Phase A validation.
#
# Boundary 1 (this test) needs NO rendezvous at all: a terminal durable
# BEFORE the command even starts is caught by admission's own already-
# existing step-5 terminal read (checkAuthorityOperationTransactionTerminal,
# called from inside admitClaudeAuthorityOperation for every non-create-binding
# operation) -- this holds regardless of exactly where command-before-admission
# itself is positioned, since admission's own step 5 runs after ANY possible
# relocation. Publishes the terminal synchronously before invoking
# lease-heartbeat at all.
#
# Boundary 2 (the genuinely subtle "grant consumed but zero lease mutation"
# case -- a cut landing between LP1's own consumption and cmdLeaseHeartbeat's
# own unrelated LP2 check) is NOT included here -- confirmed empirically
# (direct read of cmdLeaseHeartbeat, runtime-consultation.cjs ~9165-9179) that
# LP2's own terminal read runs BEFORE the existing heartbeat-after-admission-
# before-write rendezvous pause, not after, so pausing there and publishing a
# terminal during the pause does not reach LP2 at all under CURRENT code --
# reported to team-lead, resolution pending (does the pause move earlier, or
# something else). The current-R6 test below (command-after-admission-before-
# consume window, the redundant recheck being deleted) is left UNTOUCHED
# pending that answer -- deleting it now, before Boundary 2 lands, would
# remove the only regression coverage for behavior still live in production
# today.
#
# The clean positive control (a terminal published AFTER LP2 releases clean
# must let the operation complete normally) IS included here since it does
# not depend on Boundary 2's own open question -- it only requires that
# releasing the EXISTING heartbeat-after-admission-before-write rendezvous
# with nothing published lets the write proceed normally, which is true
# regardless of where a future fix positions that pause relative to LP2.
# ══════════════════════════════════════════════════════════════════════════

@test "C1-BOUNDARY1-TERMINAL-BEFORE-COMMAND-ZERO-CONSUME (RED): a valid authoritative result/v2 durable for the current attempt BEFORE lease-heartbeat is even invoked must deny INVALID/AUTHORITY_INVALID via admission's own existing step-5 terminal read, write zero role-command-grant consumed marker, and mutate nothing" {
  local proj; proj="$(_cosb_e2e_make_project)"
  local chain; chain="$(_cosb_e2e_happy_path_to_binding "$proj")"
  local binding_id coord_root artifact_ref; read -r binding_id coord_root artifact_ref <<< "$chain"
  [ -n "$binding_id" ]

  local claim_grant
  claim_grant="$(_cosb_e2e_mint_target_grant "$proj" "$binding_id" claim --coordination-root "$coord_root" --request "$artifact_ref" --role arch-testing)"
  [ -n "$claim_grant" ]
  local claim_output
  claim_output="$(NODE_ENV=test node "$RC_IMPL" claim --coordination-root "$coord_root" --request "$artifact_ref" --role arch-testing --target-binding "$claim_grant" 2>/dev/null)"
  local claim_artifact_ref
  claim_artifact_ref="$(node -e '
    const d = JSON.parse(process.argv[1]);
    if (!d.ok) { process.stderr.write("claim failed: " + process.argv[1]); process.exit(1); }
    process.stdout.write(d.artifact_ref);
  ' "$claim_output")"
  [ -n "$claim_artifact_ref" ]

  local heartbeat_grant
  heartbeat_grant="$(_cosb_e2e_mint_target_grant "$proj" "$binding_id" lease-heartbeat --coordination-root "$coord_root" --request "$artifact_ref" --claim "$claim_artifact_ref")"
  [ -n "$heartbeat_grant" ]

  # Terminal durable BEFORE the command even starts -- no rendezvous needed.
  run _c4_publish_terminal_result "$artifact_ref"
  [ "$status" -eq 0 ]

  local registry_before; registry_before="$(_cosb_registry_snapshot "$proj")"
  local txn_dir; txn_dir="$(node -e 'process.stdout.write(require("path").dirname(process.argv[1]));' "$artifact_ref")"
  local txn_before; txn_before="$(find "$txn_dir" -type f -print0 | sort -z | xargs -0 sha256sum 2>/dev/null | sha256sum | awk '{print $1}')"

  run node -e '
    const data = JSON.parse(process.argv[1]);
    if (data.status !== "INVALID" || data.detail_code !== "AUTHORITY_INVALID") {
      process.stderr.write("M7 C1 Boundary 1: a terminal durable before the command even starts must deny INVALID/AUTHORITY_INVALID via admission own existing step-5 terminal read: " + process.argv[1]);
      process.exit(1);
    }
  ' "$(NODE_ENV=test node "$RC_IMPL" lease-heartbeat --coordination-root "$coord_root" --request "$artifact_ref" --claim "$claim_artifact_ref" --target-binding "$heartbeat_grant" 2>/dev/null)"
  [ "$status" -eq 0 ]

  local registry_after; registry_after="$(_cosb_registry_snapshot "$proj")"
  [ "$registry_after" = "$registry_before" ]
  local txn_after; txn_after="$(find "$txn_dir" -type f -print0 | sort -z | xargs -0 sha256sum 2>/dev/null | sha256sum | awk '{print $1}')"
  [ "$txn_after" = "$txn_before" ]

  rm -rf "$proj"
}

@test "C1-POSITIVE-CONTROL-TERMINAL-AFTER-LP2-RELEASE-SUCCEEDS: a terminal published AFTER the heartbeat-after-admission-before-write rendezvous releases clean (i.e. genuinely ordered after cmdLeaseHeartbeat's own section-4.6 check already ran) must let the operation complete normally -- regression guard proving cuts genuinely ordered after LP2 are never retroactively punished" {
  local proj; proj="$(_cosb_e2e_make_project)"
  local pub; pub="$(_cosb_e2e_publish_request "$proj" "arch-testing")"
  local request_id artifact_ref; read -r request_id artifact_ref <<< "$pub"
  local native_spawn_action_id
  native_spawn_action_id="$(_cosb_e2e_construct_claude_agent_activation "$proj" "$artifact_ref")"
  run _cosb_e2e_mint_b1_reservation "$proj" "arch-testing" "$request_id"
  [ "$status" -eq 0 ]
  local hook_status
  hook_status="$(_cosb_e2e_subagent_start "$proj" "arch-testing" "cosb-e2e-orchestrator-session" "cosb-e2e-spawned-agent-id")"
  [ "$hook_status" = "0" ]
  local binding_id; binding_id="$(_cosb_e2e_find_binding_by_action_id "$proj" "$native_spawn_action_id")"
  [ -n "$binding_id" ]

  local coord_root; coord_root="$(node -e 'const rll=require(process.argv[1]);process.stdout.write(rll.coordinationRootPathFor(process.argv[2]));' "$RLL_IMPL" "$proj")"

  local claim_grant
  claim_grant="$(_cosb_e2e_mint_target_grant "$proj" "$binding_id" claim --coordination-root "$coord_root" --request "$artifact_ref" --role arch-testing)"
  [ -n "$claim_grant" ]
  local claim_output
  claim_output="$(NODE_ENV=test node "$RC_IMPL" claim --coordination-root "$coord_root" --request "$artifact_ref" --role arch-testing --target-binding "$claim_grant" 2>/dev/null)"
  local claim_artifact_ref
  claim_artifact_ref="$(node -e '
    const d = JSON.parse(process.argv[1]);
    if (!d.ok) { process.stderr.write("claim failed: " + process.argv[1]); process.exit(1); }
    process.stdout.write(d.artifact_ref);
  ' "$claim_output")"
  [ -n "$claim_artifact_ref" ]

  local heartbeat_grant
  heartbeat_grant="$(_cosb_e2e_mint_target_grant "$proj" "$binding_id" lease-heartbeat --coordination-root "$coord_root" --request "$artifact_ref" --claim "$claim_artifact_ref")"
  [ -n "$heartbeat_grant" ]

  local rendezvous_dir; rendezvous_dir="$(_r15_make_rendezvous_dir)"
  [ -n "$rendezvous_dir" ]
  local stage="heartbeat-after-admission-before-write"
  local ready_path="$rendezvous_dir/${stage}.ready"
  local go_path="$rendezvous_dir/${stage}.go"

  local heartbeat_stdout_file heartbeat_stderr_file
  heartbeat_stdout_file="$(mktemp)"
  heartbeat_stderr_file="$(mktemp)"

  NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="rcc-c1-poscontrol-fixture-capability" \
    RUNTIME_M7_TEST_STAGE="$stage" \
    RUNTIME_M7_TEST_RENDEZVOUS_DIR="$rendezvous_dir" \
    node "$RC_IMPL" lease-heartbeat --coordination-root "$coord_root" --request "$artifact_ref" \
    --claim "$claim_artifact_ref" --target-binding "$heartbeat_grant" \
    >"$heartbeat_stdout_file" 2>"$heartbeat_stderr_file" &
  local heartbeat_pid=$!

  local waited_ms=0
  while [ ! -f "$ready_path" ]; do
    sleep 0.05
    waited_ms=$((waited_ms + 50))
    if [ "$waited_ms" -ge 4000 ]; then break; fi
  done
  if [ ! -f "$ready_path" ]; then
    kill "$heartbeat_pid" 2>/dev/null || true
    wait "$heartbeat_pid" 2>/dev/null || true
    echo "# C1 positive control fixture failure: child never reached the rendezvous pause point within 4000ms; stderr=[$(cat "$heartbeat_stderr_file")]" >&2
    rm -f "$heartbeat_stdout_file" "$heartbeat_stderr_file"
    rm -rf "$rendezvous_dir"
    false
  fi

  # Release immediately -- nothing published during the pause.
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], Buffer.from("go\n", "utf8"), { mode: 0o600 });
  ' "$go_path"

  local heartbeat_exit=0
  wait "$heartbeat_pid" || heartbeat_exit=$?
  local heartbeat_stdout; heartbeat_stdout="$(cat "$heartbeat_stdout_file")"
  rm -f "$heartbeat_stdout_file" "$heartbeat_stderr_file"
  rm -rf "$rendezvous_dir"

  [ -n "$heartbeat_stdout" ]
  [ "$heartbeat_exit" -eq 0 ]
  run node -e '
    const data = JSON.parse(process.argv[1]);
    if (data.status !== "SUCCESS") {
      process.stderr.write("M7 C1 positive control: a heartbeat with nothing published during the rendezvous pause must succeed normally: " + process.argv[1]);
      process.exit(1);
    }
  ' "$heartbeat_stdout"
  [ "$status" -eq 0 ]

  rm -rf "$proj"
}

# M7 FINAL CORRECTION, correction round 1 (2026-08-18, C1 -- Boundary 2,
# per Codex's exact ruling, team-lead confirmed proceed-as-specified): a
# terminal published DURING heartbeat-after-admission-before-write -- after
# LP1 (admission + grant consumption, which runs entirely inside main(),
# BEFORE cmdLeaseHeartbeat's own body even starts) has already happened, but
# BEFORE cmdLeaseHeartbeat's own unrelated LP2 check (section 4.6,
# UNCHANGED by this correction) runs -- must deny INVALID/AUTHORITY_INVALID
# via LP2, while the grant's own one-time .consumed marker (already written
# by LP1, unconditionally, before this pause was ever reached) remains
# genuinely present and the active-lease file stays byte-for-byte unchanged.
# This is the decisive proof of the "consumed but not mutated" decoupling --
# a loose assertion that would also pass under the OLD, wrong "always deny,
# zero everything" shape would not distinguish these two facts; both are
# checked here against DIFFERENT evidence sources (the marker file directly,
# never inferred; a byte-for-byte lease comparison, never a status-only
# check).
@test "C1-BOUNDARY2-CONSUMED-MARKER-EXISTS-ZERO-LEASE-MUTATION (RED): a valid authoritative result/v2 published DURING the heartbeat-after-admission-before-write window (after LP1 has already admitted and consumed the grant) must deny INVALID/AUTHORITY_INVALID via cmdLeaseHeartbeat's own unrelated LP2 check, while the role-command-grant's own .consumed marker (already durable before this pause was reached) remains present and the active-lease file stays byte-for-byte unchanged" {
  local proj; proj="$(_cosb_e2e_make_project)"
  local chain; chain="$(_cosb_e2e_happy_path_to_binding "$proj")"
  local binding_id coord_root artifact_ref; read -r binding_id coord_root artifact_ref <<< "$chain"
  [ -n "$binding_id" ]

  local claim_grant
  claim_grant="$(_cosb_e2e_mint_target_grant "$proj" "$binding_id" claim --coordination-root "$coord_root" --request "$artifact_ref" --role arch-testing)"
  [ -n "$claim_grant" ]
  local claim_output
  claim_output="$(NODE_ENV=test node "$RC_IMPL" claim --coordination-root "$coord_root" --request "$artifact_ref" --role arch-testing --target-binding "$claim_grant" 2>/dev/null)"
  local claim_artifact_ref
  claim_artifact_ref="$(node -e '
    const d = JSON.parse(process.argv[1]);
    if (!d.ok) { process.stderr.write("claim failed: " + process.argv[1]); process.exit(1); }
    process.stdout.write(d.artifact_ref);
  ' "$claim_output")"
  [ -n "$claim_artifact_ref" ]

  local heartbeat_grant
  heartbeat_grant="$(_cosb_e2e_mint_target_grant "$proj" "$binding_id" lease-heartbeat --coordination-root "$coord_root" --request "$artifact_ref" --claim "$claim_artifact_ref")"
  [ -n "$heartbeat_grant" ]

  local txn_dir attempt_id lease_path
  txn_dir="$(node -e 'process.stdout.write(require("path").dirname(process.argv[1]));' "$artifact_ref")"
  attempt_id="$(node -e '
    const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    process.stdout.write(c.attempt_id);
  ' "$claim_artifact_ref")"
  [ -n "$attempt_id" ]
  lease_path="$txn_dir/active-leases/${attempt_id}.json"
  [ -f "$lease_path" ]
  local lease_before; lease_before="$(sha256sum "$lease_path" | awk '{print $1}')"

  local consumed_marker_path
  consumed_marker_path="$(node -e '
    const rll = require(process.argv[1]);
    process.stdout.write(rll.roleCommandGrantConsumedMarkerPathFor(process.argv[2], process.argv[3]));
  ' "$RLL_IMPL" "$proj" "$heartbeat_grant")"
  [ -n "$consumed_marker_path" ]

  local rendezvous_dir; rendezvous_dir="$(_r15_make_rendezvous_dir)"
  [ -n "$rendezvous_dir" ]
  local stage="heartbeat-after-admission-before-write"
  local ready_path="$rendezvous_dir/${stage}.ready"
  local go_path="$rendezvous_dir/${stage}.go"

  local heartbeat_stdout_file heartbeat_stderr_file
  heartbeat_stdout_file="$(mktemp)"
  heartbeat_stderr_file="$(mktemp)"

  NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="rcc-c1-boundary2-fixture-capability" \
    RUNTIME_M7_TEST_STAGE="$stage" \
    RUNTIME_M7_TEST_RENDEZVOUS_DIR="$rendezvous_dir" \
    node "$RC_IMPL" lease-heartbeat --coordination-root "$coord_root" --request "$artifact_ref" \
    --claim "$claim_artifact_ref" --target-binding "$heartbeat_grant" \
    >"$heartbeat_stdout_file" 2>"$heartbeat_stderr_file" &
  local heartbeat_pid=$!

  local waited_ms=0
  while [ ! -f "$ready_path" ]; do
    sleep 0.05
    waited_ms=$((waited_ms + 50))
    if [ "$waited_ms" -ge 4000 ]; then break; fi
  done
  if [ ! -f "$ready_path" ]; then
    kill "$heartbeat_pid" 2>/dev/null || true
    wait "$heartbeat_pid" 2>/dev/null || true
    echo "# C1 Boundary 2 fixture failure: child never reached the rendezvous pause point within 4000ms; stderr=[$(cat "$heartbeat_stderr_file")]" >&2
    rm -f "$heartbeat_stdout_file" "$heartbeat_stderr_file"
    rm -rf "$rendezvous_dir"
    false
  fi

  # By the time the child is paused here, LP1 (admission + consumption) has
  # ALREADY run inside main(), entirely before cmdLeaseHeartbeat's own body
  # even started -- proved directly here, not by inference.
  [ -f "$consumed_marker_path" ]

  # Immediately before the actual lease-data write (while still paused),
  # publish a valid authoritative result/v2 for the current attempt.
  run node -e '
    const fs = require("fs");
    const path = require("path");
    const rc = require(process.argv[2]);
    const requestPath = process.argv[1];
    const reqObj = JSON.parse(fs.readFileSync(requestPath, "utf8"));
    const txnDir = path.dirname(requestPath);
    const resultPath = path.join(txnDir, "results", reqObj.initial_attempt_id + ".json");
    const resultObj = {
      schema: "coordination/result/v2", in_reply_to: reqObj.request_id,
      request_digest: rc.sha256File(requestPath), plan_digest: reqObj.plan_digest,
      repo_id: reqObj.repo_id, wave_slug: reqObj.wave_slug, protocol_profile: reqObj.protocol_profile,
      max_depth: reqObj.max_depth, routing_policy_version: reqObj.routing_policy_version,
      routing_policy_digest: reqObj.routing_policy_digest, root_request_id: reqObj.root_request_id,
      parent_request_id: reqObj.parent_request_id, depth: reqObj.depth,
      attempt_id: reqObj.initial_attempt_id, lease_epoch: reqObj.initial_lease_epoch,
      driver: "noop", claimant_instance_id: "c".repeat(64), worker_session_id: null,
      claim_digest: "1".repeat(64), target_role_profile_version: reqObj.target_role_profile_version,
      target_role_profile_digest: reqObj.target_role_profile_digest, from_role: reqObj.target_role,
      to_role: reqObj.source_role, result_kind: reqObj.expected_result_kind, status: "ANSWERED", reason: null,
      content: "C1 Boundary 2 fixture terminal content", subject_repo_id: reqObj.subject_repo_id,
      subject_worktree_id: reqObj.subject_worktree_id, subject_head: reqObj.subject_head,
      subject_scope_digest: reqObj.subject_scope_digest, consultation_dependencies: [],
      producer_worktree_id: reqObj.subject_worktree_id, producer_head: reqObj.subject_head,
      created_at: new Date().toISOString(), pattern_evidence_dependency: null,
    };
    rc.publishNoClobber(resultPath, Buffer.from(rc.canonicalJSONStringify(resultObj), "utf8"), { raceDetailCode: "AUTHORITY_INVALID" });
  ' "$artifact_ref" "$RC_IMPL"
  [ "$status" -eq 0 ]

  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], Buffer.from("go\n", "utf8"), { mode: 0o600 });
  ' "$go_path"

  local heartbeat_exit=0
  wait "$heartbeat_pid" || heartbeat_exit=$?
  local heartbeat_stdout; heartbeat_stdout="$(cat "$heartbeat_stdout_file")"
  rm -f "$heartbeat_stdout_file" "$heartbeat_stderr_file"
  rm -rf "$rendezvous_dir"

  [ -n "$heartbeat_stdout" ]
  run node -e '
    const data = JSON.parse(process.argv[1]);
    if (data.status !== "INVALID" || data.detail_code !== "AUTHORITY_INVALID") {
      process.stderr.write("M7 C1 Boundary 2: a terminal published during heartbeat-after-admission-before-write must deny INVALID/AUTHORITY_INVALID via cmdLeaseHeartbeat own unrelated LP2 check: " + process.argv[1]);
      process.exit(1);
    }
  ' "$heartbeat_stdout"
  [ "$status" -eq 0 ]
  [ "$heartbeat_exit" -eq 3 ]

  # The decisive proof: the consumed marker EXISTS (LP1 already consumed the
  # grant, unconditionally, before this window began) but the lease file is
  # BYTE-FOR-BYTE unchanged (LP2 blocked the actual data effect).
  [ -f "$consumed_marker_path" ]
  local lease_after; lease_after="$(sha256sum "$lease_path" | awk '{print $1}')"
  [ "$lease_after" = "$lease_before" ]

  rm -rf "$proj"
}

# M7 FINAL CORRECTION, correction round 1 (2026-08-18): the former R6 test
# (R6-COMMAND-TERMINAL-BEFORE-ADMISSION-ZERO-CONSUME, pausing at the
# command-after-admission-before-consume stage) is REMOVED, not merely
# superseded in place -- it tested the standalone terminal recheck at
# runtime-consultation.cjs ~6662-6669, which this correction round's own
# production work deletes entirely (grant consumption becomes unconditional
# once LP1/admission succeeds, per Codex's linearization ruling). Keeping
# that test alive would have silently regressed to a false failure the
# moment production removes the code path it depends on. Its own coverage is
# now provided by C1-BOUNDARY1-TERMINAL-BEFORE-COMMAND-ZERO-CONSUME (cut
# before command-before-admission), C1-BOUNDARY2-CONSUMED-MARKER-EXISTS-ZERO-LEASE-MUTATION
# (cut between LP1 consumption and LP2's own write-time check), and
# C1-POSITIVE-CONTROL-TERMINAL-AFTER-LP2-RELEASE-SUCCEEDS (cut genuinely
# after LP2), all three above in this file.

# ══════════════════════════════════════════════════════════════════════════
# M7 FINAL REMEDIATION Part A (2026-08-18, A_RED_TESTS): OneShot
# admit-before-consume atomicity, transaction-terminal dimension. Distinct
# from C1 above (C1 is about lease-heartbeat's grant-consumption
# linearization point, LP1/LP2) -- this is about createClaudeOneShotBindingInternal's
# own NEW CREATE path (~4100-4170). Direct read confirms: `proposedTerminalCheck`
# (checkOneShotTransactionTerminalAbsent against the PROPOSED request/attempt
# scope) runs once, BEFORE admitClaudeAuthorityOperation -- and
# admitClaudeAuthorityOperation itself explicitly SKIPS its own step-5
# terminal check for operationKind==='create-binding' (~4808-4817: "A
# create-binding operation has no backing yet... so has no applicable
# terminal to check"). consumeClaudeAgentSpawnReservationAndCreateOneShotBinding's
# own preWriteHook (consumeClaudeAgentSpawnReservationMarker, writing the
# reservation's one-time consumed marker) then runs INSIDE the guarded write,
# strictly AFTER admission -- so a terminal that becomes durable in the
# window between proposedTerminalCheck and the guarded write is never
# rechecked before the marker and the binding both land; only the post-write
# `postWriteTerminalCheck` (~4167-4168) catches it, too late to stop either
# write. This is precisely the race variant COSB-CREATE-REUSE-DENIED-ONCE-TERMINAL's
# own header (above, ~3474-3477) flagged as explicitly time-boxed OUT at the
# time: "Race variant (terminal lands between admission and write on a NEW
# create) is explicitly NOT included here... Flagged in the report, not
# silently dropped." This is that flagged gap, now closed with a real test.
#
# The ONE authorized Fase-A rendezvous instrumentation point for this pass
# (runtime-role-lifecycle.cjs, inside createClaudeOneShotBindingInternal,
# immediately after proposedTerminalCheck and before admitClaudeAuthorityOperation):
#   testM7Rendezvous('create-one-shot-after-phase-a-before-admission', projectRoot);
# Same M7 §10.1 mechanism R15 above already uses -- zero I/O unless
# NODE_ENV=test + a non-empty RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY + this
# exact RUNTIME_M7_TEST_STAGE + a safely-scoped RUNTIME_M7_TEST_RENDEZVOUS_DIR
# are all present.
#
# A-ONESHOT-CONTROL-01 proves the same real chain, paused at this exact
# stage and released with nothing published, is not vacuous: exactly one
# reservation consumed marker, one correlated claude-one-shot-binding/v2.
# ══════════════════════════════════════════════════════════════════════════

_a1_txn_dir_for() {
  node -e 'process.stdout.write(require("path").dirname(process.argv[1]));' "$1"
}

# Recursive sorted file listing of the transaction subtree -- the snapshot
# both the RED test's before/after diff and the leak check are built on.
_a1_txn_snapshot() {
  find "$1" -type f 2>/dev/null | sort
}

# Stage-local authoritative result/v2 publisher. Deliberately NOT the shared
# _c4_publish_terminal_result helper above (Codex correction: "do not alter
# or reuse the shared C4 helper") -- an independent implementation. Every
# request/plan/repo/role field is read directly off the real request.json
# (never invented, same technique as C4); claimant_instance_id/claim_digest
# are FRESH real random hex via crypto.randomBytes, never a repeated-literal
# placeholder. Prints the resolved result path.
_a1_publish_oneshot_terminal_result() {
  local artifact_ref="$1"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const rc = require(process.argv[2]);
    const requestPath = process.argv[1];
    const reqObj = JSON.parse(fs.readFileSync(requestPath, "utf8"));
    const txnDir = path.dirname(requestPath);
    const resultPath = path.join(txnDir, "results", reqObj.initial_attempt_id + ".json");
    const resultObj = {
      schema: "coordination/result/v2", in_reply_to: reqObj.request_id,
      request_digest: rc.sha256File(requestPath), plan_digest: reqObj.plan_digest,
      repo_id: reqObj.repo_id, wave_slug: reqObj.wave_slug, protocol_profile: reqObj.protocol_profile,
      max_depth: reqObj.max_depth, routing_policy_version: reqObj.routing_policy_version,
      routing_policy_digest: reqObj.routing_policy_digest, root_request_id: reqObj.root_request_id,
      parent_request_id: reqObj.parent_request_id, depth: reqObj.depth,
      attempt_id: reqObj.initial_attempt_id, lease_epoch: reqObj.initial_lease_epoch,
      driver: "noop", claimant_instance_id: crypto.randomBytes(32).toString("hex"), worker_session_id: null,
      claim_digest: crypto.randomBytes(32).toString("hex"), target_role_profile_version: reqObj.target_role_profile_version,
      target_role_profile_digest: reqObj.target_role_profile_digest, from_role: reqObj.target_role,
      to_role: reqObj.source_role, result_kind: reqObj.expected_result_kind, status: "ANSWERED", reason: null,
      content: "A-RED-ONESHOT-01 stage-local fixture terminal " + crypto.randomBytes(8).toString("hex"),
      subject_repo_id: reqObj.subject_repo_id,
      subject_worktree_id: reqObj.subject_worktree_id, subject_head: reqObj.subject_head,
      subject_scope_digest: reqObj.subject_scope_digest, consultation_dependencies: [],
      producer_worktree_id: reqObj.subject_worktree_id, producer_head: reqObj.subject_head,
      created_at: new Date().toISOString(), pattern_evidence_dependency: null,
    };
    rc.publishNoClobber(resultPath, Buffer.from(rc.canonicalJSONStringify(resultObj), "utf8"), { raceDetailCode: "AUTHORITY_INVALID" });
    process.stdout.write(resultPath);
  ' "$artifact_ref" "$RC_IMPL"
}

_a1_oneshot_binding_count_for_action() {
  node -e '
    const fs = require("fs");
    const path = require("path");
    const rll = require(process.argv[1]);
    const dir = path.join(rll.registryRepoDir(process.argv[2]), "claude-one-shot-bindings");
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { entries = []; }
    const records = entries
      .filter((e) => e.isFile() && e.name.endsWith(".json"))
      .map((e) => JSON.parse(fs.readFileSync(path.join(dir, e.name), "utf8")))
      .filter((r) => r.native_spawn_action_id === process.argv[3]);
    process.stdout.write(String(records.length));
  ' "$RLL_IMPL" "$1" "$2"
}

# Full real-primitive parse+validate of the B1 ClaudeAgentSpawnReservation at
# `projectRoot`/`nativeSpawnActionId`: exact schema (rll.CLAUDE_AGENT_SPAWN_RESERVATION_SCHEMA,
# an exported constant) + closed key set (hand-listed here, verbatim from
# runtime-role-lifecycle.cjs ~6380-6384, read directly before writing this
# check -- peekValidateClaudeAgentSpawnReservation itself is not exported)
# + execution_state==='ISSUED' + deadline not yet passed. M7 FINAL
# REMEDIATION Part A correction (sequence 3, ONE-06): every correlated field
# is now cross-checked against an INDEPENDENT source, never derived from the
# reservation record itself -- request_id/attempt_id/lease_epoch/role/
# plan_digest/worktree_id against the real, freshly-read request.json;
# native_spawn_action_id + the same tuple against the real activation record
# (re-read from its own real path); tool_input_digest independently
# recomputed via the exact real formula (agent-spawn-execution-gate.js's
# own sha256(canonicalJSON({subagent_type,name})), confirmed by direct
# source read); main_binding_id resolved via the real production validator
# rll.validateMainOrchestratorBindingFor; session_generation_id re-derived
# via rll.peekSessionGeneration against the CURRENT live generation. Prints
# "VALID" only if every check passes.
_a1_parse_and_validate_reservation() {
  local project_root="$1" native_spawn_action_id="$2" artifact_ref="$3" role="$4" session_id="$5"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const actionId = process.argv[4];
    const requestPath = process.argv[5];
    const role = process.argv[6];
    const sessionId = process.argv[7];

    const reservationPath = rll.claudeAgentSpawnReservationPathFor(projectRoot, actionId);
    const record = JSON.parse(fs.readFileSync(reservationPath, "utf8"));

    const expectedKeys = [
      "attempt_id", "bootstrap_message", "created_at", "execution_state", "expiry",
      "lease_epoch", "main_binding_id", "native_spawn_action_id", "plan_digest",
      "request_id", "reservation_id", "role", "schema", "session_generation_id",
      "tool_input_digest", "worktree_id",
    ].sort();
    const actualKeys = Object.keys(record).sort();
    if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) { process.stderr.write("reservation key set not closed: " + JSON.stringify(actualKeys)); process.exit(1); }
    if (record.schema !== rll.CLAUDE_AGENT_SPAWN_RESERVATION_SCHEMA) { process.stderr.write("schema mismatch: " + record.schema); process.exit(1); }
    if (record.execution_state !== "ISSUED") { process.stderr.write("execution_state not ISSUED: " + record.execution_state); process.exit(1); }

    // Independent correlation against the real, freshly-read request.json --
    // never against fields already parsed from the reservation itself.
    const reqObj = JSON.parse(fs.readFileSync(requestPath, "utf8"));
    if (record.request_id !== reqObj.request_id) { process.stderr.write("request_id does not match request.json"); process.exit(1); }
    if (record.attempt_id !== reqObj.initial_attempt_id) { process.stderr.write("attempt_id does not match request.initial_attempt_id"); process.exit(1); }
    if (record.lease_epoch !== reqObj.initial_lease_epoch) { process.stderr.write("lease_epoch does not match request.initial_lease_epoch"); process.exit(1); }
    if (record.role !== reqObj.target_role) { process.stderr.write("role does not match request.target_role"); process.exit(1); }
    if (record.plan_digest !== reqObj.plan_digest) { process.stderr.write("plan_digest does not match request.plan_digest"); process.exit(1); }
    if (record.worktree_id !== reqObj.subject_worktree_id) { process.stderr.write("worktree_id does not match request.subject_worktree_id"); process.exit(1); }
    if (role !== reqObj.target_role) { process.stderr.write("caller-supplied role does not match request.target_role either"); process.exit(1); }

    // Independent correlation against the real activation record.
    const txnDir = path.dirname(requestPath);
    const activationPath = path.join(txnDir, "activations", record.attempt_id + ".json");
    const activation = JSON.parse(fs.readFileSync(activationPath, "utf8"));
    if (record.native_spawn_action_id !== actionId || record.native_spawn_action_id !== activation.native_spawn_action_id
        || record.request_id !== activation.request_id || record.attempt_id !== activation.attempt_id
        || record.lease_epoch !== activation.lease_epoch) {
      process.stderr.write("reservation<->activation correlation invalid"); process.exit(1);
    }

    // Independent recomputation of tool_input_digest -- the exact real
    // formula agent-spawn-execution-gate.js uses at real mint time
    // (sha256(canonicalJSON({subagent_type,name})) of the actual Agent-tool
    // call), confirmed by direct source read, never trusted from the record.
    const expectedToolInputDigest = rc.sha256String(rc.canonicalJSONStringify({ subagent_type: role, name: role }));
    if (record.tool_input_digest !== expectedToolInputDigest) { process.stderr.write("tool_input_digest does not match the independently recomputed digest"); process.exit(1); }

    // main_binding_id resolves to a real, live, correctly-scoped
    // MainOrchestratorBinding/v1 -- via the real production validator.
    // `action.session_generation_id` is REQUIRED (the own final check inside
    // validateMainOrchestratorBindingFor, ~5744-5748, reuses the SAME
    // generic "main-binding-shape-mismatch" reason for a generation
    // mismatch -- confirmed empirically, not assumed -- so this field is
    // never optional in practice even though a caller could otherwise
    // believe worktree_id/plan_digest alone were sufficient).
    const mainCheck = rll.validateMainOrchestratorBindingFor(projectRoot, record.main_binding_id, { worktree_id: record.worktree_id, plan_digest: record.plan_digest, session_generation_id: record.session_generation_id });
    if (!mainCheck.ok) { process.stderr.write("main_binding_id does not resolve to a live binding: " + JSON.stringify(mainCheck)); process.exit(1); }

    // session_generation_id resolves to the CURRENT live generation.
    const generation = rll.peekSessionGeneration(projectRoot, { provider: "claude-hook", runtime_session_key: sessionId });
    if (!generation.ok || generation.generationId !== record.session_generation_id) {
      process.stderr.write("session generation not live or mismatched: " + JSON.stringify(generation)); process.exit(1);
    }

    const nowMs = Date.now();
    const expiryMs = Date.parse(record.expiry);
    if (!(nowMs < expiryMs)) { process.stderr.write("reservation deadline already passed"); process.exit(1); }

    process.stdout.write("VALID");
  ' "$RLL_IMPL" "$RC_IMPL" "$project_root" "$native_spawn_action_id" "$artifact_ref" "$role" "$session_id"
}

@test "A-ONESHOT-CONTROL-01: releasing the create-one-shot-after-phase-a-before-admission rendezvous with nothing published during the pause lets the real SubagentStart mint proceed normally -- exactly one reservation consumed marker and one correlated claude-one-shot-binding/v2" {
  local proj; proj="$(_cosb_e2e_make_project)"
  local pub; pub="$(_cosb_e2e_publish_request "$proj" "arch-testing")"
  local request_id artifact_ref; read -r request_id artifact_ref <<< "$pub"
  [ -n "$request_id" ]
  local native_spawn_action_id
  native_spawn_action_id="$(_cosb_e2e_construct_claude_agent_activation "$proj" "$artifact_ref")"
  [ -n "$native_spawn_action_id" ]
  run _cosb_e2e_mint_b1_reservation "$proj" "arch-testing" "$request_id"
  [ "$status" -eq 0 ]

  # ONE-07: the tuple validateClaudeOneShotBindingFor will be checked
  # against below, sourced INDEPENDENTLY from the real request.json -- never
  # from the binding record that gets created later in this test.
  local expected_request_id expected_attempt_id expected_lease_epoch expected_role expected_worktree_id expected_plan_digest
  read -r expected_request_id expected_attempt_id expected_lease_epoch expected_role expected_worktree_id expected_plan_digest <<< "$(node -e '
    const fs = require("fs");
    const reqObj = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write([reqObj.request_id, reqObj.initial_attempt_id, reqObj.initial_lease_epoch, reqObj.target_role, reqObj.subject_worktree_id, reqObj.plan_digest].join(" "));
  ' "$artifact_ref")"
  [ -n "$expected_request_id" ]

  run _a1_parse_and_validate_reservation "$proj" "$native_spawn_action_id" "$artifact_ref" "arch-testing" "cosb-e2e-orchestrator-session"
  [ "$status" -eq 0 ]
  [ "$output" = "VALID" ]

  local rendezvous_dir; rendezvous_dir="$(_r15_make_rendezvous_dir)"
  [ -n "$rendezvous_dir" ]
  local stage="create-one-shot-after-phase-a-before-admission"
  local ready_path="$rendezvous_dir/${stage}.ready"
  local go_path="$rendezvous_dir/${stage}.go"

  local input_file stdout_file stderr_file
  input_file="$(mktemp)"; stdout_file="$(mktemp)"; stderr_file="$(mktemp)"
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({
      hook_event_name: "SubagentStart", agent_type: process.argv[2],
      session_id: process.argv[3], agent_id: process.argv[4],
    }));
  ' "$input_file" "arch-testing" "cosb-e2e-orchestrator-session" "a-oneshot-control-01-agent"

  NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="a-oneshot-control-01-fixture-capability" \
    RUNTIME_M7_TEST_STAGE="$stage" \
    RUNTIME_M7_TEST_RENDEZVOUS_DIR="$rendezvous_dir" \
    CLAUDE_PROJECT_DIR="$proj" \
    node "$HOOK" <"$input_file" >"$stdout_file" 2>"$stderr_file" &
  local hook_pid=$!
  # ONE-01: pending-child state, cleared only on this test's own normal
  # completion path below -- if ANY assertion from here on fails, teardown()
  # picks this up and safely releases/reaps/cleans up.
  printf '%s %s %s\n' "$hook_pid" "$go_path" "$rendezvous_dir" > "${BATS_TEST_TMPDIR}/oneshot-pending-child"

  local waited_ms=0
  while [ ! -f "$ready_path" ]; do
    sleep 0.05
    waited_ms=$((waited_ms + 50))
    if [ "$waited_ms" -ge 4000 ]; then break; fi
  done
  if [ ! -f "$ready_path" ]; then
    echo "# A-ONESHOT-CONTROL-01 fixture failure: child never reached the rendezvous pause point within 4000ms; stderr=[$(cat "$stderr_file")]" >&2
    false
  fi
  # lstat + fd-bound read of .ready: regular, not symlink, current owner,
  # mode 0600, exact "ready\n" bytes -- never trust bare existence alone.
  run node -e '
    const fs = require("fs");
    const st = fs.lstatSync(process.argv[1]);
    if (st.isSymbolicLink() || !st.isFile() || (st.mode & 0o777) !== 0o600) { process.stderr.write("ready sentinel invalid stat"); process.exit(1); }
    if (typeof process.getuid === "function" && st.uid !== process.getuid()) { process.stderr.write("ready sentinel not owned by the current uid"); process.exit(1); }
    const fd = fs.openSync(process.argv[1], fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const buf = fs.readFileSync(fd);
    fs.closeSync(fd);
    if (!buf.equals(Buffer.from("ready\n", "utf8"))) { process.stderr.write("ready sentinel bytes wrong"); process.exit(1); }
  ' "$ready_path"
  [ "$status" -eq 0 ]

  # Release immediately -- nothing published during the pause. No-clobber
  # go write, mode 0600, exact bytes.
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], Buffer.from("go\n", "utf8"), { mode: 0o600, flag: "wx" });
  ' "$go_path"

  # ONE-01: real exit captured via if/then/else, never `wait PID || true`.
  local hook_exit
  if wait "$hook_pid"; then hook_exit=0; else hook_exit=$?; fi
  rm -f "${BATS_TEST_TMPDIR}/oneshot-pending-child"
  rm -rf "$rendezvous_dir"
  [ "$hook_exit" -eq 0 ]

  # ONE-04: real child exit 0 (just proven) + stdout/stderr BOTH exactly
  # empty, checked before validating any artifact.
  local hook_stdout hook_stderr
  hook_stdout="$(cat "$stdout_file")"
  hook_stderr="$(cat "$stderr_file")"
  rm -f "$input_file" "$stdout_file" "$stderr_file"
  [ -z "$hook_stdout" ]
  [ -z "$hook_stderr" ]

  run _a1_oneshot_binding_count_for_action "$proj" "$native_spawn_action_id"
  [ "$output" = "1" ]
  local binding_id; binding_id="$(_cosb_e2e_find_binding_by_action_id "$proj" "$native_spawn_action_id")"
  [ -n "$binding_id" ]

  local marker_path
  marker_path="$(node -e 'const rll=require(process.argv[1]);process.stdout.write(rll.claudeAgentSpawnReservationConsumedMarkerPathFor(process.argv[2], process.argv[3]));' "$RLL_IMPL" "$proj" "$native_spawn_action_id")"
  [ -f "$marker_path" ]
  # ONE-08: the OneShot marker's real closed shape is exactly {consumed_at}
  # -- never a reservation_digest or schema field (that is RootSource's
  # marker shape, not this one; confirmed by direct read of
  # consumeClaudeAgentSpawnReservationMarker).
  run node -e '
    const fs = require("fs");
    const marker = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const keys = Object.keys(marker).sort();
    if (JSON.stringify(keys) !== JSON.stringify(["consumed_at"])) { process.stderr.write("marker shape not closed: " + JSON.stringify(keys)); process.exit(1); }
    if (Number.isNaN(Date.parse(marker.consumed_at))) { process.stderr.write("marker consumed_at not a valid timestamp"); process.exit(1); }
  ' "$marker_path"
  [ "$status" -eq 0 ]

  # ONE-07: real production validator, fed the INDEPENDENTLY-sourced tuple
  # captured above -- never b.request_id/b.attempt_id/etc. read back off the
  # binding record itself (that would be circular).
  run node -e '
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const bindingId = process.argv[3];
    const check = rll.validateClaudeOneShotBindingFor(projectRoot, bindingId, {
      requestId: process.argv[4], attemptId: process.argv[5], leaseEpoch: Number(process.argv[6]),
      role: process.argv[7], worktreeId: process.argv[8], planDigest: process.argv[9],
    });
    if (!check.ok) { process.stderr.write("validateClaudeOneShotBindingFor failed: " + JSON.stringify(check)); process.exit(1); }
  ' "$RLL_IMPL" "$proj" "$binding_id" "$expected_request_id" "$expected_attempt_id" "$expected_lease_epoch" "$expected_role" "$expected_worktree_id" "$expected_plan_digest"
  [ "$status" -eq 0 ]

  rm -rf "$proj"
}

@test "A-RED-ONESHOT-01 (RED): a real authoritative result/v2 published for the exact request/attempt DURING the create-one-shot-after-phase-a-before-admission pause (after the early proposedTerminalCheck already ran, before admission) must deny the mint before the reservation's own consumed marker or the binding are ever written -- today the marker and binding both land, and only the post-write terminal recheck catches the terminal too late" {
  local proj; proj="$(_cosb_e2e_make_project)"
  local pub; pub="$(_cosb_e2e_publish_request "$proj" "arch-testing")"
  local request_id artifact_ref; read -r request_id artifact_ref <<< "$pub"
  [ -n "$request_id" ]
  local native_spawn_action_id
  native_spawn_action_id="$(_cosb_e2e_construct_claude_agent_activation "$proj" "$artifact_ref")"
  [ -n "$native_spawn_action_id" ]
  run _cosb_e2e_mint_b1_reservation "$proj" "arch-testing" "$request_id"
  [ "$status" -eq 0 ]

  local reservation_path
  reservation_path="$(node -e 'const rll=require(process.argv[1]);process.stdout.write(rll.claudeAgentSpawnReservationPathFor(process.argv[2], process.argv[3]));' "$RLL_IMPL" "$proj" "$native_spawn_action_id")"
  [ -f "$reservation_path" ]
  local reservation_json_before; reservation_json_before="$(cat "$reservation_path")"
  local reservation_sha_before; reservation_sha_before="$(shasum -a 256 "$reservation_path" | awk '{print $1}')"

  # Before-release oracle: real schema + closed key set + full correlation
  # (against the real activation) + execution_state ISSUED + live session
  # generation + deadline not yet passed.
  run _a1_parse_and_validate_reservation "$proj" "$native_spawn_action_id" "$artifact_ref" "arch-testing" "cosb-e2e-orchestrator-session"
  [ "$status" -eq 0 ]
  [ "$output" = "VALID" ]

  local marker_path
  marker_path="$(node -e 'const rll=require(process.argv[1]);process.stdout.write(rll.claudeAgentSpawnReservationConsumedMarkerPathFor(process.argv[2], process.argv[3]));' "$RLL_IMPL" "$proj" "$native_spawn_action_id")"
  [ ! -e "$marker_path" ]
  run _a1_oneshot_binding_count_for_action "$proj" "$native_spawn_action_id"
  [ "$output" = "0" ]

  local txn_dir; txn_dir="$(_a1_txn_dir_for "$artifact_ref")"
  local coord_root; coord_root="$(node -e 'const rll=require(process.argv[1]);process.stdout.write(rll.coordinationRootPathFor(process.argv[2]));' "$RLL_IMPL" "$proj")"
  local plan_digest attempt_id
  plan_digest="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).plan_digest);' "$artifact_ref")"
  attempt_id="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).initial_attempt_id);' "$artifact_ref")"
  [ -n "$plan_digest" ]; [ -n "$attempt_id" ]

  local rendezvous_dir; rendezvous_dir="$(_r15_make_rendezvous_dir)"
  [ -n "$rendezvous_dir" ]
  local stage="create-one-shot-after-phase-a-before-admission"
  local ready_path="$rendezvous_dir/${stage}.ready"
  local go_path="$rendezvous_dir/${stage}.go"

  local input_file stdout_file stderr_file
  input_file="$(mktemp)"; stdout_file="$(mktemp)"; stderr_file="$(mktemp)"
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({
      hook_event_name: "SubagentStart", agent_type: process.argv[2],
      session_id: process.argv[3], agent_id: process.argv[4],
    }));
  ' "$input_file" "arch-testing" "cosb-e2e-orchestrator-session" "a-red-oneshot-01-agent"

  NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="a-red-oneshot-01-fixture-capability" \
    RUNTIME_M7_TEST_STAGE="$stage" \
    RUNTIME_M7_TEST_RENDEZVOUS_DIR="$rendezvous_dir" \
    CLAUDE_PROJECT_DIR="$proj" \
    node "$HOOK" <"$input_file" >"$stdout_file" 2>"$stderr_file" &
  local hook_pid=$!
  # ONE-01: pending-child state, cleared only on this test's own normal
  # completion path below.
  printf '%s %s %s\n' "$hook_pid" "$go_path" "$rendezvous_dir" > "${BATS_TEST_TMPDIR}/oneshot-pending-child"

  local waited_ms=0
  while [ ! -f "$ready_path" ]; do
    sleep 0.05
    waited_ms=$((waited_ms + 50))
    if [ "$waited_ms" -ge 4000 ]; then break; fi
  done
  if [ ! -f "$ready_path" ]; then
    echo "# A-RED-ONESHOT-01 fixture failure: child never reached the rendezvous pause point within 4000ms; stderr=[$(cat "$stderr_file")]" >&2
    false
  fi
  run node -e '
    const fs = require("fs");
    const st = fs.lstatSync(process.argv[1]);
    if (st.isSymbolicLink() || !st.isFile() || (st.mode & 0o777) !== 0o600) { process.stderr.write("ready sentinel invalid stat"); process.exit(1); }
    if (typeof process.getuid === "function" && st.uid !== process.getuid()) { process.stderr.write("ready sentinel not owned by the current uid"); process.exit(1); }
    const fd = fs.openSync(process.argv[1], fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const buf = fs.readFileSync(fd);
    fs.closeSync(fd);
    if (!buf.equals(Buffer.from("ready\n", "utf8"))) { process.stderr.write("ready sentinel bytes wrong"); process.exit(1); }
  ' "$ready_path"
  [ "$status" -eq 0 ]

  # Snapshot the transaction subtree BEFORE publishing the terminal.
  local txn_before; txn_before="$(_a1_txn_snapshot "$txn_dir")"

  # Publish a REAL, freshly-identified authoritative result/v2 for this
  # exact transaction while the child is paused (proposedTerminalCheck
  # already ran and passed; admission has not run yet). Stage-local helper,
  # never the shared C4 one.
  local result_path
  result_path="$(_a1_publish_oneshot_terminal_result "$artifact_ref")"
  [ -f "$result_path" ]

  # The ONLY new file in the transaction subtree during the pause must be
  # this exact result/v2 path -- proves no other artifact leaked in.
  local txn_after; txn_after="$(_a1_txn_snapshot "$txn_dir")"
  local txn_diff; txn_diff="$(comm -13 <(printf '%s\n' "$txn_before") <(printf '%s\n' "$txn_after"))"
  [ "$txn_diff" = "$result_path" ]

  # Before releasing: the real runtime-consultation `validate --kind
  # result-v2` CLI surface must accept the just-published artifact, AND the
  # real exported RLL terminal checker must independently observe the exact
  # expected terminal for this transaction. `validate` requires an
  # authenticated requester role-command-grant like every other command
  # (ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND.validate === 'requester',
  # confirmed by direct source read) -- minted here the same way
  # _cosb_e2e_publish_request mints one for publish-request.
  local validate_rest_args=(--coordination-root "$coord_root" --kind result-v2 --artifact "$result_path")
  local validate_grant
  validate_grant="$(node -e '
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const rest = process.argv.slice(4);
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    if (!planResult.ok) { process.stderr.write("no PLAN discovered"); process.exit(1); }
    // Reuses the SAME identity _cosb_e2e_publish_request already primed with
    // a CLAUDE-ID-01 capability earlier in this test (createRequesterBinding
    // requires proof of that capability) -- never re-primes a second one.
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: "cosb-e2e-grant-session" };
    const bindingResult = rll.createRequesterBinding(projectRoot, identity, "cosb-e2e-capability-primary", "arch-testing", worktreeId, planResult.planDigest, 3600);
    if (!bindingResult.ok) { process.stderr.write("createRequesterBinding failed: " + JSON.stringify(bindingResult)); process.exit(1); }
    const argvDigest = rc.sha256String(rc.canonicalJSONStringify(rest));
    const mintResult = rll.mintRoleCommandGrant(projectRoot, bindingResult.binding, "requester", "validate", argvDigest, null, null, null);
    if (!mintResult.ok) { process.stderr.write("mintRoleCommandGrant failed: " + JSON.stringify(mintResult)); process.exit(1); }
    process.stdout.write(mintResult.grantId);
  ' "$RLL_IMPL" "$RC_IMPL" "$proj" "${validate_rest_args[@]}")"
  [ -n "$validate_grant" ]

  run node "$RC_IMPL" validate "${validate_rest_args[@]}" --requester-binding "$validate_grant"
  [ "$status" -eq 0 ]
  # ONE-05: parse the envelope and require ok===true/status==="SUCCESS" --
  # exit code alone is insufficient.
  run node -e '
    const d = JSON.parse(process.argv[1]);
    if (d.ok !== true || d.status !== "SUCCESS") {
      process.stderr.write("validate --kind result-v2 did not report ok:true/status:SUCCESS: " + process.argv[1]); process.exit(1);
    }
  ' "$output"
  [ "$status" -eq 0 ]

  run node -e '
    const rll = require(process.argv[1]);
    const check = rll.checkAuthorityOperationTransactionTerminal(process.argv[2], "one-shot", {
      plan_digest: process.argv[3], request_id: process.argv[4], attempt_id: process.argv[5],
    });
    if (check.ok || check.reason !== "claude-one-shot-transaction-terminal") {
      process.stderr.write("terminal checker did not observe the exact expected terminal: " + JSON.stringify(check)); process.exit(1);
    }
  ' "$RLL_IMPL" "$proj" "$plan_digest" "$request_id" "$attempt_id"
  [ "$status" -eq 0 ]

  # Release -- no-clobber go write, mode 0600, exact bytes.
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], Buffer.from("go\n", "utf8"), { mode: 0o600, flag: "wx" });
  ' "$go_path"

  # ONE-01: real exit captured via if/then/else, never `wait PID || true`.
  local hook_exit
  if wait "$hook_pid"; then hook_exit=0; else hook_exit=$?; fi
  rm -f "${BATS_TEST_TMPDIR}/oneshot-pending-child"
  rm -rf "$rendezvous_dir"
  [ "$hook_exit" -eq 0 ]

  # ONE-03: stdout exactly empty; stderr exactly the one expected closed
  # denial line (never a substring match, an empty stderr, a crash, or a
  # timeout) -- the exact literal the hook writes, confirmed by direct
  # source read of tryConsumeClaudeAgentOneShotReservation's own caller
  # (subagent-start-context-bundle.js): agentType="arch-testing" (this
  # test's own fixture), oneShotResult.reason ===
  # "claude-one-shot-binding-creation-failed:" + the RLL postWriteTerminalCheck
  # reason "claude-one-shot-transaction-terminal".
  local hook_stdout hook_stderr
  hook_stdout="$(cat "$stdout_file")"
  hook_stderr="$(cat "$stderr_file")"
  rm -f "$input_file" "$stdout_file" "$stderr_file"
  local expected_stderr_line='[subagent-start-context-bundle] claude-agent one-shot reservation invalid for "arch-testing": claude-one-shot-binding-creation-failed:claude-one-shot-transaction-terminal -- STOP, bundle injection skipped'
  [ -z "$hook_stdout" ]
  [ "$hook_stderr" = "$expected_stderr_line" ]

  local reservation_sha_after; reservation_sha_after="$(shasum -a 256 "$reservation_path" | awk '{print $1}')"
  [ "$reservation_sha_after" = "$reservation_sha_before" ]
  [ "$(cat "$reservation_path")" = "$reservation_json_before" ]

  # After-release oracle: re-parse (not merely re-hash) via the same real
  # checks -- explicit, load-bearing.
  run _a1_parse_and_validate_reservation "$proj" "$native_spawn_action_id" "$artifact_ref" "arch-testing" "cosb-e2e-orchestrator-session"
  [ "$status" -eq 0 ]
  [ "$output" = "VALID" ]

  # Discriminating oracle (the ONLY assertion that differs between the
  # current buggy bytes and the desired fix): neither the reservation's own
  # consumed marker nor the binding may exist. Today both do -- the
  # proposedTerminalCheck already passed before the pause,
  # admitClaudeAuthorityOperation skips its own terminal check for
  # create-binding, and the guarded write (marker via preWriteHook, then the
  # binding) proceeds; only postWriteTerminalCheck catches the terminal,
  # after both are already durable.
  run _a1_oneshot_binding_count_for_action "$proj" "$native_spawn_action_id"
  local binding_count_after="$output"
  if [ -e "$marker_path" ] || [ "$binding_count_after" != "0" ]; then
    echo "A-RED-ONESHOT-01: terminal-not-in-create-admission" >&2
    rm -rf "$proj"
    false
  fi

  rm -rf "$proj"
}
