#!/usr/bin/env node
'use strict';

// WP3 unit-level coverage for runtime-role-lifecycle.cjs's role-binding state
// machine, action registry/generation, and CapabilityProvider seam. Sibling of
// runtime-role-lifecycle-registry.test.js (identity/registry/session/binding/
// grant) -- this file covers the layer built ON TOP of that foundation.

const assert = require('node:assert');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const IMPL = path.resolve(__dirname, '../lib/runtime-role-lifecycle.cjs');
const rll = require(IMPL);

function makeGitProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rll-sm-'));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'rll-sm-test@test.local']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'RLL SM Test']);
  execFileSync('git', ['-C', dir, 'commit', '-q', '--allow-empty', '-m', 'init']);
  return dir;
}

function cleanup(dir) {
  fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
}

// R4 round 3 (round 4 correction, finding 2): these MUST be genuinely
// hex-shaped (0-9a-f only) -- 'w'/'p'/'g' are not hex digits, so these
// fixtures were NEVER valid worktree_id/plan_digest/session_generation_id
// values, merely the right LENGTH. Nothing caught this before
// roleBindingExtraFieldsAreClosedForState started independently
// hex-validating these fields (previously they were never shape-checked
// at all, only compared for equality against themselves).
const W = 'a'.repeat(64);
const P = 'b'.repeat(64);
const PROF = rll.roleProfileDigestFor('arch-testing');
const GEN = 'd'.repeat(32);
const ROLE = 'arch-testing';
const FAKE_ACTION_ID = 'c'.repeat(32);

// ── State machine ────────────────────────────────────────────────────────────

test('readRoleBindingState: a never-created binding is the implicit ABSENT state', () => {
  const dir = makeGitProject();
  try {
    const result = rll.readRoleBindingState(dir, W, P, PROF, GEN, ROLE);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.state, 'ABSENT');
  } finally {
    cleanup(dir);
  }
});

// Point 1.5 (R4): closed shape PER STATE, not merely an allowed-superset --
// a field legitimate for ONE state can never silently co-occur with a
// DIFFERENT one. Proven for each of the three cross-state leak classes a
// flat allowed-superset key-set cannot catch on its own.
test('readRoleBindingState: fields legitimate for one state are rejected when found on a DIFFERENT state -- a flat allowed-superset alone would have missed all three (point 1.5)', () => {
  const dir = makeGitProject();
  const recordPath = rll.roleBindingPathFor(dir, W, P, PROF, GEN, ROLE);
  try {
    const base = {
      schema: 'runtime/role-binding/v1', binding_id: 'b'.repeat(32), role: ROLE,
      worktree_id: W, plan_digest: P, profile_digest: PROF, session_generation_id: GEN,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      driver: 'claude-sendmessage', respawn_count: 0,
    };

    // (a) pending_action_id is only ever legitimate for STARTING/REHYDRATING
    // -- a READY record carrying one (the pre-1.5 stale-carry-forward bug,
    // point 1.5 also fixes AT THE SOURCE in transitionRoleBinding) must be
    // rejected here too, as defense in depth against any OTHER writer.
    fs.mkdirSync(path.dirname(recordPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(recordPath, JSON.stringify(Object.assign({}, base, { state: 'READY', pending_action_id: 'a'.repeat(32) })), { mode: 0o600 });
    let result = rll.readRoleBindingState(dir, W, P, PROF, GEN, ROLE);
    assert.strictEqual(result.ok, false, 'pending_action_id on READY must be rejected');
    assert.strictEqual(result.reason, 'role-binding-shape-invalid');

    // (b) failure_reason is only ever legitimate for UNAVAILABLE/QUARANTINED
    // -- a READY record carrying one must be rejected.
    fs.writeFileSync(recordPath, JSON.stringify(Object.assign({}, base, { state: 'READY', failure_reason: 'expired' })), { mode: 0o600 });
    result = rll.readRoleBindingState(dir, W, P, PROF, GEN, ROLE);
    assert.strictEqual(result.ok, false, 'failure_reason on READY must be rejected');
    assert.strictEqual(result.reason, 'role-binding-shape-invalid');

    // (c) team_ensure_action_id is only ever legitimate for a
    // claude-sendmessage STARTING/REHYDRATING record -- a codex-app-server
    // STARTING record carrying one (a driver-family mismatch) must be
    // rejected even though its OWN state IS pending-eligible.
    fs.writeFileSync(recordPath, JSON.stringify(Object.assign({}, base, { state: 'STARTING', driver: 'codex-app-server', pending_action_id: 'a'.repeat(32), team_ensure_action_id: 'c'.repeat(32) })), { mode: 0o600 });
    result = rll.readRoleBindingState(dir, W, P, PROF, GEN, ROLE);
    assert.strictEqual(result.ok, false, 'team_ensure_action_id on a codex-app-server STARTING record must be rejected');
    assert.strictEqual(result.reason, 'role-binding-shape-invalid');

    // Positive control: the SAME team_ensure_action_id IS accepted on a
    // claude-sendmessage STARTING record -- proving the rejection above is
    // about the driver-family correlation, not the field's mere presence.
    fs.writeFileSync(recordPath, JSON.stringify(Object.assign({}, base, { state: 'STARTING', pending_action_id: 'a'.repeat(32), team_ensure_action_id: 'c'.repeat(32) })), { mode: 0o600 });
    result = rll.readRoleBindingState(dir, W, P, PROF, GEN, ROLE);
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    assert.strictEqual(result.state, 'STARTING');
  } finally {
    cleanup(dir);
  }
});

// R4 round 2, point 4: RoleBinding/v1 closed BIDIRECTIONALLY, plus hex-ID
// and canonical-ISO-UTC timestamp validation -- a record that is well-formed
// per the OLDER, looser (presence-implies-eligible-only) rules can still be
// malformed in ways that check now catches.
test('readRoleBindingState: bidirectional pending_action_id closure (STARTING/REHYDRATING WITHOUT one is now rejected too), hex-shaped IDs, and canonical ISO-UTC timestamps (R4 round 2, point 4)', () => {
  const dir = makeGitProject();
  const recordPath = rll.roleBindingPathFor(dir, W, P, PROF, GEN, ROLE);
  try {
    const base = {
      schema: 'runtime/role-binding/v1', binding_id: 'b'.repeat(32), role: ROLE,
      worktree_id: W, plan_digest: P, profile_digest: PROF, session_generation_id: GEN,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      driver: 'claude-sendmessage', respawn_count: 0,
    };

    // (a) STARTING with NO pending_action_id at all -- the bidirectional
    // closure's new half. Point 4's atomic-waypoint mechanism eliminated the
    // one honest transient-absence case (noop's former two-write hop), so
    // this is now unconditionally rejected.
    fs.mkdirSync(path.dirname(recordPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(recordPath, JSON.stringify(Object.assign({}, base, { state: 'STARTING' })), { mode: 0o600 });
    let result = rll.readRoleBindingState(dir, W, P, PROF, GEN, ROLE);
    assert.strictEqual(result.ok, false, 'STARTING with no pending_action_id must now be rejected');
    assert.strictEqual(result.reason, 'role-binding-shape-invalid');

    // (b) pending_action_id present but NOT hex-shaped.
    fs.writeFileSync(recordPath, JSON.stringify(Object.assign({}, base, { state: 'STARTING', pending_action_id: 'not-hex-at-all!!' })), { mode: 0o600 });
    result = rll.readRoleBindingState(dir, W, P, PROF, GEN, ROLE);
    assert.strictEqual(result.ok, false, 'a non-hex pending_action_id must be rejected');

    // (c) binding_id not hex-shaped.
    fs.writeFileSync(recordPath, JSON.stringify(Object.assign({}, base, { state: 'STARTING', pending_action_id: 'a'.repeat(32), binding_id: 'not-hex' })), { mode: 0o600 });
    result = rll.readRoleBindingState(dir, W, P, PROF, GEN, ROLE);
    assert.strictEqual(result.ok, false, 'a non-hex binding_id must be rejected');

    // (d) created_at with milliseconds -- Date.parse-able but NOT canonical
    // ISO-8601 UTC (mirrors peekSessionGeneration's own "ISO UTC canonico,
    // not merely Date.parse-able" standard).
    fs.writeFileSync(recordPath, JSON.stringify(Object.assign({}, base, { state: 'READY', created_at: '2026-01-01T00:00:00.123Z' })), { mode: 0o600 });
    result = rll.readRoleBindingState(dir, W, P, PROF, GEN, ROLE);
    assert.strictEqual(result.ok, false, 'a non-canonical (milliseconds) created_at must be rejected');

    // (e) updated_at with a non-Z offset instead of Z.
    fs.writeFileSync(recordPath, JSON.stringify(Object.assign({}, base, { state: 'READY', updated_at: '2026-01-01T00:00:00+00:00' })), { mode: 0o600 });
    result = rll.readRoleBindingState(dir, W, P, PROF, GEN, ROLE);
    assert.strictEqual(result.ok, false, 'a non-canonical (non-Z offset) updated_at must be rejected');

    // Positive control: a genuinely well-formed STARTING record (hex IDs,
    // canonical timestamps, pending_action_id present) is accepted.
    fs.writeFileSync(recordPath, JSON.stringify(Object.assign({}, base, { state: 'STARTING', pending_action_id: 'a'.repeat(32) })), { mode: 0o600 });
    result = rll.readRoleBindingState(dir, W, P, PROF, GEN, ROLE);
    assert.strictEqual(result.ok, true, JSON.stringify(result));
  } finally {
    cleanup(dir);
  }
});

// R4 round 2, point 4: the WRITER (transitionRoleBinding) validates the
// FULL assembled nextRecord via the SAME closed-shape check a reader would
// apply, BEFORE ever persisting it -- it can never durably write a record
// its own sibling reader would immediately reject. Proven both by the
// caller-visible {ok:false} AND by confirming NOTHING was actually written
// (the prior, valid on-disk state survives byte-identical).
test('transitionRoleBinding: refuses to persist a nextRecord that would be shape-invalid (missing driver) -- caller sees {ok:false}, and NOTHING is written to disk (R4 round 2, point 4)', () => {
  const dir = makeGitProject();
  try {
    const t1 = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'ABSENT', 'STARTING', null, { driver: 'noop', respawn_count: 0, pending_action_id: 'a'.repeat(32) });
    assert.strictEqual(t1.ok, true, JSON.stringify(t1));
    const before = fs.readFileSync(rll.roleBindingPathFor(dir, W, P, PROF, GEN, ROLE), 'utf8');

    // STARTING->READY, but extraFields OMITS driver -- wait, driver would
    // carry forward from t1.record via Object.assign. Force the gap
    // directly: WAITING requires driver too, and a caller that (bug)
    // passes a non-string driver override must be rejected, never persisted.
    const bad = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'STARTING', 'READY', t1.record, { driver: '' });
    assert.strictEqual(bad.ok, false, JSON.stringify(bad));
    assert.strictEqual(bad.reason, 'nextrecord-shape-invalid');

    const after = fs.readFileSync(rll.roleBindingPathFor(dir, W, P, PROF, GEN, ROLE), 'utf8');
    assert.strictEqual(after, before, 'a rejected write must leave the prior on-disk state COMPLETELY untouched, byte-identical');

    // The binding is still genuinely usable afterward -- a subsequent
    // LEGITIMATE transition from the SAME (never-advanced) t1.record
    // succeeds normally.
    const good = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'STARTING', 'READY', t1.record, {});
    assert.strictEqual(good.ok, true, JSON.stringify(good));
  } finally {
    cleanup(dir);
  }
});

// R4 round 3 (round 4 correction, finding 2): end-to-end WRITER proof --
// the auditor's exact empirical reproduction (worktree_id 63-hex,
// plan_digest 65-hex, profile_digest 63-hex, session_generation_id
// malformed, all silently accepted). Unlike a caller TAMPERING extraFields
// relative to a correct value (already caught by validateRoleBindingRecordForScope's
// equality check, Block 2a), THIS reproduces a caller passing a malformed
// value directly AS THE FUNCTION'S OWN PARAMETER in the first place (the
// realistic vector: a corrupted computeWorktreeId/discoverPlan result, or
// -- as this file's own top-level W/P/GEN fixtures turned out to be before
// this exact fix caught them -- a test-authoring typo). One test per
// field, each on a fresh ABSENT->STARTING creation (no pre-existing record
// to interfere), proving rejection AND that nothing is durably written.
for (const badField of ['worktreeId', 'planDigest', 'profileDigest', 'generationId']) {
  test('transitionRoleBinding (WRITER, end-to-end): a malformed-length ' + badField + ' passed as this call\'s OWN parameter (not merely tampered via extraFields) is rejected as nextrecord-shape-invalid, and NOTHING is durably written (R4 round 3, round 4 correction, finding 2)', () => {
    const dir = makeGitProject();
    const badWorktreeId = badField === 'worktreeId' ? 'a'.repeat(63) : W;
    const badPlanDigest = badField === 'planDigest' ? 'b'.repeat(65) : P;
    const badProfileDigest = badField === 'profileDigest' ? 'd'.repeat(63) : PROF;
    const badGenerationId = badField === 'generationId' ? 'not-a-csprng-id' : GEN;
    const badValues = { worktreeId: badWorktreeId, planDigest: badPlanDigest, profileDigest: badProfileDigest, generationId: badGenerationId };
    try {
      const recordPath = rll.roleBindingPathFor(dir, badWorktreeId, badPlanDigest, badProfileDigest, badGenerationId, ROLE);
      const result = rll.transitionRoleBinding(dir, badWorktreeId, badPlanDigest, badProfileDigest, badGenerationId, ROLE, 'ABSENT', 'STARTING', null, { driver: 'noop', respawn_count: 0, pending_action_id: FAKE_ACTION_ID });
      assert.strictEqual(result.ok, false, badField + '=' + JSON.stringify(badValues[badField]) + ' must be rejected: ' + JSON.stringify(result));
      assert.strictEqual(result.reason, 'nextrecord-shape-invalid');
      assert.strictEqual(fs.existsSync(recordPath), false, 'a rejected creation must never durably write a role-binding record at all');
    } finally {
      cleanup(dir);
    }
  });
}

// R4 round 3 (round 4 correction, finding 2): end-to-end READER proof --
// a role-binding record already sitting on disk (however it got there --
// registry corruption, an older/buggy writer, direct tampering) with a
// malformed-length worktree_id/plan_digest/profile_digest/binding_id/
// session_generation_id is rejected by readRoleBindingState, never
// silently accepted merely because it happens to equal the caller's own
// (also malformed, self-consistent) parameters. binding_id specifically
// is reachable ONLY here -- it is always internally minted or preserved
// from an already-validated fromRecord through the writer's own public
// API, so a malformed one can only ever originate from direct disk
// corruption, exactly what this proves the reader still catches.
for (const badField of ['worktree_id', 'plan_digest', 'profile_digest', 'binding_id', 'session_generation_id']) {
  test('readRoleBindingState (READER, end-to-end): an on-disk record with a malformed-length ' + badField + ' is rejected as role-binding-shape-invalid, never silently accepted merely because it matches the caller\'s own (also malformed) parameters (R4 round 3, round 4 correction, finding 2)', () => {
    const dir = makeGitProject();
    try {
      // Read with parameters matching the record's OWN (malformed) claim --
      // proving the rejection is about the VALUE's shape, never merely an
      // earlier equality mismatch against the caller's expectation. The
      // record path is a HASH of this exact tuple (roleBindingPathFor), so
      // it MUST be computed from the SAME (possibly-tampered) values used
      // for the read below, or the path would silently resolve elsewhere
      // and the planted record would never even be found (ABSENT).
      const readWorktreeId = badField === 'worktree_id' ? 'a'.repeat(63) : W;
      const readPlanDigest = badField === 'plan_digest' ? 'b'.repeat(65) : P;
      const readProfileDigest = badField === 'profile_digest' ? 'd'.repeat(63) : PROF;
      const readGenerationId = badField === 'session_generation_id' ? 'not-a-csprng-id' : GEN;
      const recordPath = rll.roleBindingPathFor(dir, readWorktreeId, readPlanDigest, readProfileDigest, readGenerationId, ROLE);

      const rec = {
        schema: 'runtime/role-binding/v1', binding_id: 'a'.repeat(32), role: ROLE,
        worktree_id: readWorktreeId, plan_digest: readPlanDigest, profile_digest: readProfileDigest, session_generation_id: readGenerationId,
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
        driver: 'noop', respawn_count: 0, state: 'READY',
      };
      if (badField === 'binding_id') rec.binding_id = 'e'.repeat(31);

      fs.mkdirSync(path.dirname(recordPath), { recursive: true, mode: 0o700 });
      fs.writeFileSync(recordPath, JSON.stringify(rec), { mode: 0o600 });

      const result = rll.readRoleBindingState(dir, readWorktreeId, readPlanDigest, readProfileDigest, readGenerationId, ROLE);
      assert.strictEqual(result.ok, false, badField + ' must be rejected even when self-consistent with the caller\'s own params: ' + JSON.stringify(result));
      assert.strictEqual(result.reason, 'role-binding-shape-invalid');
    } finally {
      cleanup(dir);
    }
  });
}

// R4 round 3 (block 2b): the empirically-reproduced identity-overwrite bug
// -- `nextRecord` is assembled via Object.assign(base, fromRecord||{},
// {state,updated_at}, extraFields||{}), so a caller-supplied extraFields
// carrying its OWN role/worktree_id/plan_digest/profile_digest/
// session_generation_id silently overwrote the correct base values.
// Reproduced concretely: extraFields.role='verifier' on the arch-testing
// path returned {ok:true} and wrote role:"verifier" onto that path; the
// NEXT read correctly rejected it, but the WRITE itself should never have
// succeeded. One test per identity field, each proving BOTH the rejection
// AND that the prior on-disk state survives completely byte-unchanged.
for (const field of ['role', 'worktree_id', 'plan_digest', 'profile_digest', 'session_generation_id']) {
  test('transitionRoleBinding: extraFields.' + field + ' cannot overwrite the identity field this call was scoped for -- rejected as next-record-scope-mismatch, prior on-disk state left byte-unchanged (R4 round 3, block 2b)', () => {
    const dir = makeGitProject();
    try {
      const t1 = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'ABSENT', 'STARTING', null, { driver: 'noop', respawn_count: 0, pending_action_id: FAKE_ACTION_ID });
      assert.strictEqual(t1.ok, true, JSON.stringify(t1));
      const recordPath = rll.roleBindingPathFor(dir, W, P, PROF, GEN, ROLE);
      const before = fs.readFileSync(recordPath, 'utf8');

      const tamperedValue = field === 'role' ? 'toolkit-specialist' : 'z'.repeat(field === 'session_generation_id' ? 32 : 64);
      const extraFields = {};
      extraFields[field] = tamperedValue;
      const bad = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'STARTING', 'READY', t1.record, extraFields);
      assert.strictEqual(bad.ok, false, 'extraFields.' + field + ' must never silently overwrite the identity field: ' + JSON.stringify(bad));
      assert.strictEqual(bad.reason, 'next-record-scope-mismatch');

      const after = fs.readFileSync(recordPath, 'utf8');
      assert.strictEqual(after, before, 'a rejected identity-overwrite attempt must leave the prior on-disk state COMPLETELY untouched, byte-identical');

      // The binding is still genuinely usable afterward -- a subsequent
      // LEGITIMATE transition from the SAME (never-advanced) t1.record
      // succeeds normally.
      const good = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'STARTING', 'READY', t1.record, {});
      assert.strictEqual(good.ok, true, JSON.stringify(good));
    } finally {
      cleanup(dir);
    }
  });
}

// R4 round 3 (block 2b): the SAME overwrite vector via `fromRecord` (not
// merely `extraFields`) -- a caller-supplied fromRecord carrying a
// DIFFERENT role than this call's own verified parameter must ALSO be
// rejected, distinctly (from-record-scope-mismatch, checked BEFORE
// nextRecord is even assembled), never silently accepted because
// extraFields itself was clean.
test('transitionRoleBinding: a fromRecord carrying a DIFFERENT role than this call was scoped for is rejected as from-record-scope-mismatch, prior on-disk state left byte-unchanged (R4 round 3, block 2b)', () => {
  const dir = makeGitProject();
  try {
    const t1 = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'ABSENT', 'STARTING', null, { driver: 'noop', respawn_count: 0, pending_action_id: FAKE_ACTION_ID });
    assert.strictEqual(t1.ok, true, JSON.stringify(t1));
    const recordPath = rll.roleBindingPathFor(dir, W, P, PROF, GEN, ROLE);
    const before = fs.readFileSync(recordPath, 'utf8');

    // A fromRecord that is otherwise byte-identical to the genuine t1.record
    // except for its OWN role field -- exactly the shape a confused/buggy
    // caller (e.g. one that accidentally threaded a DIFFERENT role's prior
    // record through) would produce.
    const poisonedFromRecord = Object.assign({}, t1.record, { role: 'toolkit-specialist' });
    const bad = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'STARTING', 'READY', poisonedFromRecord, {});
    assert.strictEqual(bad.ok, false, 'a fromRecord with the wrong role must never be accepted: ' + JSON.stringify(bad));
    assert.strictEqual(bad.reason, 'from-record-scope-mismatch');

    const after = fs.readFileSync(recordPath, 'utf8');
    assert.strictEqual(after, before, 'a rejected poisoned-fromRecord attempt must leave the prior on-disk state COMPLETELY untouched, byte-identical');
  } finally {
    cleanup(dir);
  }
});

// R4 round 3 (block 2b): the EARLIEST of the three checks -- if the
// on-disk record itself (read fresh, under the lock) somehow already
// belongs to a DIFFERENT tuple than this call is scoped for, the
// transition must refuse to build on it AT ALL, even before ever
// inspecting fromRecord/extraFields. Simulates a hypothetical "the record
// at this path is corrupted/foreign" scenario no writer in this codebase
// actually produces, proving this is genuine defense in depth, not a
// no-op given the writer's own guarantees.
test('transitionRoleBinding: an on-disk record that already belongs to a DIFFERENT role than this call is scoped for is rejected as current-record-scope-mismatch, BEFORE fromRecord/extraFields are ever consulted (R4 round 3, block 2b)', () => {
  const dir = makeGitProject();
  const recordPath = rll.roleBindingPathFor(dir, W, P, PROF, GEN, ROLE);
  try {
    const foreignBindingId = 'e'.repeat(32);
    const foreignOnDisk = {
      schema: 'runtime/role-binding/v1', binding_id: foreignBindingId, role: 'toolkit-specialist', state: 'STARTING',
      worktree_id: W, plan_digest: P, profile_digest: PROF, session_generation_id: GEN,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      driver: 'noop', respawn_count: 0, pending_action_id: FAKE_ACTION_ID,
    };
    fs.mkdirSync(path.dirname(recordPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(recordPath, JSON.stringify(foreignOnDisk), { mode: 0o600 });
    const before = fs.readFileSync(recordPath, 'utf8');

    // A fromRecord that IS correctly scoped for THIS call (role: ROLE) --
    // proving the rejection below is genuinely about the ON-DISK record,
    // not merely a re-detection of an already-poisoned fromRecord.
    const correctlyScopedFromRecord = Object.assign({}, foreignOnDisk, { role: ROLE, binding_id: foreignBindingId });
    const bad = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'STARTING', 'READY', correctlyScopedFromRecord, {});
    assert.strictEqual(bad.ok, false, 'a foreign on-disk record must never be transitioned, even with an otherwise-correct fromRecord: ' + JSON.stringify(bad));
    assert.strictEqual(bad.reason, 'current-record-scope-mismatch');

    const after = fs.readFileSync(recordPath, 'utf8');
    assert.strictEqual(after, before, 'a rejected foreign-current attempt must leave the on-disk state COMPLETELY untouched, byte-identical');
  } finally {
    cleanup(dir);
  }
});

// R4 round 2, point 4: transitionRoleBindingAtomicViaWaypoint validates
// BOTH hops (fromState->waypointState AND waypointState->toState) against
// the SAME closed graph transitionRoleBinding itself enforces, but the
// direct fromState->toState jump is NEVER added as a public graph edge --
// ordinary transitionRoleBinding must keep rejecting it.
test('transitionRoleBindingAtomicViaWaypoint: validates BOTH hops against the closed graph; the direct fromState->toState jump is NEVER a legal PUBLIC edge; only ONE record is ever durably written (R4 round 2, point 4)', () => {
  const dir = makeGitProject();
  try {
    // (a) A genuinely legal two-hop journey (ABSENT->STARTING->READY)
    // succeeds via the atomic waypoint helper, in ONE call.
    const ok = rll.transitionRoleBindingAtomicViaWaypoint(dir, W, P, PROF, GEN, ROLE, 'ABSENT', 'STARTING', 'READY', null, { driver: 'noop', respawn_count: 0 });
    assert.strictEqual(ok.ok, true, JSON.stringify(ok));
    assert.strictEqual(ok.record.state, 'READY');
    // The published record is a genuinely CLEAN READY record -- no leftover
    // pending_action_id from an intermediate write that was never made.
    assert.strictEqual(Object.prototype.hasOwnProperty.call(ok.record, 'pending_action_id'), false);

    // (b) Ordinary transitionRoleBinding still correctly rejects the SAME
    // direct jump as illegal -- the waypoint helper's own two-hop
    // validation never widens the PUBLIC single-hop graph.
    const direct = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'READY', 'DEAD', ok.record, {});
    assert.strictEqual(direct.ok, true, 'fixture: READY->DEAD is a genuinely legal single hop, sanity only: ' + JSON.stringify(direct));
    const illegalDirect = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'ABSENT', 'READY', null, { driver: 'noop', respawn_count: 0 });
    assert.strictEqual(illegalDirect.ok, false, 'ABSENT->READY must stay illegal on the PUBLIC single-hop graph even though the waypoint helper can reach it via ABSENT->STARTING->READY');
    assert.strictEqual(illegalDirect.reason, 'illegal-state-transition');

    // (c) Each hop is independently checked -- an illegal FIRST hop is
    // rejected even when the SECOND hop alone would be legal.
    const dir2 = makeGitProject();
    try {
      const badFirstHop = rll.transitionRoleBindingAtomicViaWaypoint(dir2, W, P, PROF, GEN, ROLE, 'READY', 'STARTING', 'READY', null, { driver: 'noop', respawn_count: 0 });
      assert.strictEqual(badFirstHop.ok, false, 'READY->STARTING is not a legal first hop: ' + JSON.stringify(badFirstHop));
      assert.strictEqual(badFirstHop.reason, 'illegal-state-transition');
    } finally {
      cleanup(dir2);
    }

    // (d) Each hop is independently checked -- an illegal SECOND hop is
    // rejected even when the FIRST hop alone would be legal.
    const dir3 = makeGitProject();
    try {
      const badSecondHop = rll.transitionRoleBindingAtomicViaWaypoint(dir3, W, P, PROF, GEN, ROLE, 'ABSENT', 'STARTING', 'STOPPED', null, { driver: 'noop', respawn_count: 0 });
      assert.strictEqual(badSecondHop.ok, false, 'STARTING->STOPPED is not a legal second hop: ' + JSON.stringify(badSecondHop));
      assert.strictEqual(badSecondHop.reason, 'illegal-state-transition');
      // Nothing was durably created either -- the illegal second hop must
      // never leave a stranded STARTING record from a "partial" attempt.
      const afterBad = rll.readRoleBindingState(dir3, W, P, PROF, GEN, ROLE);
      assert.strictEqual(afterBad.state, 'ABSENT', 'an illegal second hop must leave the binding COMPLETELY untouched, never a stranded first-hop write');
    } finally {
      cleanup(dir3);
    }
  } finally {
    cleanup(dir);
  }
});

test('transitionRoleBinding: full happy chain ABSENT->STARTING->READY->WAITING->BUSY->WAITING, binding_id stable throughout', () => {
  const dir = makeGitProject();
  try {
    const t1 = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'ABSENT', 'STARTING', null, { driver: 'noop', respawn_count: 0, pending_action_id: FAKE_ACTION_ID });
    assert.strictEqual(t1.ok, true, JSON.stringify(t1));
    const bindingId = t1.record.binding_id;
    const t2 = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'STARTING', 'READY', t1.record, {});
    assert.strictEqual(t2.ok, true);
    const t3 = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'READY', 'WAITING', t2.record, {});
    assert.strictEqual(t3.ok, true);
    const t4 = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'WAITING', 'BUSY', t3.record, {});
    assert.strictEqual(t4.ok, true);
    const t5 = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'BUSY', 'WAITING', t4.record, {});
    assert.strictEqual(t5.ok, true);
    for (const t of [t1, t2, t3, t4, t5]) assert.strictEqual(t.record.binding_id, bindingId);
  } finally {
    cleanup(dir);
  }
});

test('transitionRoleBinding: DEAD->REHYDRATING->READY respawn chain', () => {
  const dir = makeGitProject();
  try {
    let t = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'ABSENT', 'STARTING', null, { driver: 'noop', respawn_count: 0, pending_action_id: FAKE_ACTION_ID });
    t = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'STARTING', 'READY', t.record, {});
    t = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'READY', 'DEAD', t.record, {});
    assert.strictEqual(t.ok, true, JSON.stringify(t));
    t = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'DEAD', 'REHYDRATING', t.record, { pending_action_id: FAKE_ACTION_ID });
    assert.strictEqual(t.ok, true, JSON.stringify(t));
    t = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'REHYDRATING', 'READY', t.record, {});
    assert.strictEqual(t.ok, true);
  } finally {
    cleanup(dir);
  }
});

test('transitionRoleBinding: ROTATING->REHYDRATING->READY rotation chain', () => {
  const dir = makeGitProject();
  try {
    let t = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'ABSENT', 'STARTING', null, { driver: 'noop', respawn_count: 0, pending_action_id: FAKE_ACTION_ID });
    t = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'STARTING', 'READY', t.record, {});
    t = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'READY', 'ROTATING', t.record, {});
    assert.strictEqual(t.ok, true, JSON.stringify(t));
    t = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'ROTATING', 'REHYDRATING', t.record, { pending_action_id: FAKE_ACTION_ID });
    assert.strictEqual(t.ok, true, JSON.stringify(t));
    t = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'REHYDRATING', 'READY', t.record, {});
    assert.strictEqual(t.ok, true);
  } finally {
    cleanup(dir);
  }
});

test('transitionRoleBinding: READY->STOPPING->STOPPED is terminal (no further transitions defined)', () => {
  const dir = makeGitProject();
  try {
    let t = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'ABSENT', 'STARTING', null, { driver: 'noop', respawn_count: 0, pending_action_id: FAKE_ACTION_ID });
    t = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'STARTING', 'READY', t.record, {});
    t = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'READY', 'STOPPING', t.record, { stop_reason: 'session-close' });
    assert.strictEqual(t.ok, true, JSON.stringify(t));
    t = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'STOPPING', 'STOPPED', t.record, {});
    assert.strictEqual(t.ok, true, JSON.stringify(t));
    assert.strictEqual(rll.ROLE_BINDING_TRANSITIONS.STOPPED.size, 0, 'STOPPED must have zero outgoing transitions');
  } finally {
    cleanup(dir);
  }
});

test('transitionRoleBinding: STARTING->QUARANTINED (ambiguous owner) is terminal for this binding key', () => {
  const dir = makeGitProject();
  try {
    const t1 = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'ABSENT', 'STARTING', null, { driver: 'noop', respawn_count: 0, pending_action_id: FAKE_ACTION_ID });
    // failure_reason is the real field name (ROLE_BINDING_ALLOWED_KEYS) --
    // a bare `reason` was a pre-existing fixture typo the writer's own new
    // pre-persist validation now correctly catches too (an extra,
    // disallowed key).
    const t2 = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'STARTING', 'QUARANTINED', t1.record, { failure_reason: 'ambiguous-owner' });
    assert.strictEqual(t2.ok, true, JSON.stringify(t2));
    assert.strictEqual(rll.ROLE_BINDING_TRANSITIONS.QUARANTINED.size, 0, 'QUARANTINED must have zero outgoing transitions -- never reused');
  } finally {
    cleanup(dir);
  }
});

test('transitionRoleBinding: every illegal edge NOT in the closed graph is rejected -- exhaustive pairwise check', () => {
  const dir = makeGitProject();
  try {
    for (const from of rll.ROLE_BINDING_STATE_ENUM) {
      for (const to of rll.ROLE_BINDING_STATE_ENUM) {
        if (rll.ROLE_BINDING_TRANSITIONS[from].has(to)) continue; // legal edge, skip
        // Seed a record claiming to be in `from` state (best-effort direct write for
        // this exhaustive negative sweep only -- production never does this).
        const recPath = rll.roleBindingPathFor(dir, W, P, PROF, GEN, ROLE);
        fs.mkdirSync(path.dirname(recPath), { recursive: true, mode: 0o700 });
        const fakeRecord = { schema: 'runtime/role-binding/v1', binding_id: 'a'.repeat(32), role: ROLE, worktree_id: W, plan_digest: P, profile_digest: PROF, session_generation_id: GEN, state: from, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' };
        fs.writeFileSync(recPath, JSON.stringify(fakeRecord), { mode: 0o600 });
        const result = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, from, to, fakeRecord, {});
        assert.strictEqual(result.ok, false, `${from} -> ${to} must be rejected (not in the closed graph)`);
        assert.strictEqual(result.reason, 'illegal-state-transition');
        fs.rmSync(recPath, { force: true });
      }
    }
  } finally {
    cleanup(dir);
  }
});

test('transitionRoleBinding: a STALE fromRecord (already superseded by a concurrent transition) is rejected, never silently overwritten', () => {
  const dir = makeGitProject();
  try {
    const t1 = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'ABSENT', 'STARTING', null, { driver: 'noop', respawn_count: 0, pending_action_id: FAKE_ACTION_ID });
    const t2 = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'STARTING', 'READY', t1.record, {});
    assert.strictEqual(t2.ok, true);
    // Attempt a SECOND transition from the now-stale t1.record (as if a second,
    // slower reader tried to act on the pre-transition snapshot).
    const staleAttempt = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'STARTING', 'READY', t1.record, {});
    assert.strictEqual(staleAttempt.ok, false);
    assert.strictEqual(staleAttempt.reason, 'stale-binding-read');
  } finally {
    cleanup(dir);
  }
});

test('transitionRoleBinding: concurrent ABSENT->STARTING creation collides (second caller loses, never double-creates)', () => {
  const dir = makeGitProject();
  try {
    const first = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'ABSENT', 'STARTING', null, { driver: 'noop', respawn_count: 0, pending_action_id: FAKE_ACTION_ID });
    assert.strictEqual(first.ok, true);
    const second = rll.transitionRoleBinding(dir, W, P, PROF, GEN, ROLE, 'ABSENT', 'STARTING', null, { driver: 'noop', respawn_count: 0, pending_action_id: FAKE_ACTION_ID });
    assert.strictEqual(second.ok, false);
    assert.strictEqual(second.reason, 'concurrent-creation');
  } finally {
    cleanup(dir);
  }
});

// ── Action generation ────────────────────────────────────────────────────────

test('mintRoleLifecycleAction: exact envelope fields, action_id is 128-bit hex, one-use (no-clobber underneath)', () => {
  const dir = makeGitProject();
  try {
    const payload = rll.buildTeamEnsurePayload('team-x', 'ensure the support plane');
    const actionId = rll.generateActionId();
    const expiresAtIso = new Date(Date.now() + 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const result = rll.mintRoleLifecycleAction(dir, actionId, 'team-ensure', 'claude-native', 'r'.repeat(64), W, P, 'd'.repeat(64), GEN, null, payload, expiresAtIso);
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    assert.strictEqual(result.actionId, actionId);
    assert.match(result.actionId, /^[0-9a-f]{32}$/);
    const envelope = rll.actionForEnvelope(result.action);
    assert.strictEqual(envelope.schema, 'coordination/role-lifecycle-action/v1');
    assert.strictEqual(envelope.kind, 'team-ensure');
    assert.strictEqual(envelope.runtime, 'claude-native');
    assert.strictEqual(envelope.role, null);
    assert.strictEqual(envelope.expires_at, expiresAtIso, 'expires_at is the EXACT precomputed instant, never re-derived internally');
    assert.deepStrictEqual(envelope.payload, payload);
  } finally {
    cleanup(dir);
  }
});

test('mintRoleLifecycleAction: rejects an unknown kind (closed union enforcement)', () => {
  const dir = makeGitProject();
  try {
    const result = rll.mintRoleLifecycleAction(dir, rll.generateActionId(), 'totally-invalid-kind', 'claude-native', 'r'.repeat(64), W, P, 'd'.repeat(64), GEN, null, {});
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'invalid-kind');
  } finally {
    cleanup(dir);
  }
});

test('buildSupervisorStartPayload: bridge_command is the canonical render of bridge_argv, round-trips through parsePosixDirect', () => {
  const payload = rll.buildSupervisorStartPayload('/usr/bin/node', '/abs/bridge.cjs', 'a'.repeat(32), '/coord/root', ['arch-testing', 'context-provider'], '2026-01-01T00:00:00Z');
  assert.deepStrictEqual(payload.bridge_argv, [
    '/usr/bin/node', '/abs/bridge.cjs', 'session-run', '--action', 'a'.repeat(32),
    '--coordination-root', '/coord/root', '--role', 'arch-testing', '--role', 'context-provider',
    '--session-expiry', '2026-01-01T00:00:00Z',
  ]);
  const decoded = rll.parsePosixDirect(payload.bridge_command);
  assert.deepStrictEqual(decoded, payload.bridge_argv, 'bridge_command must parse back to the exact bridge_argv (canonical round-trip)');
});

// ── CapabilityProvider ───────────────────────────────────────────────────────

test('selectDriverForRole: picks the first ROUTING-ORDER driver that is actually available, never reorders by availability', () => {
  const routing = { routes: { 'arch-testing': ['claude-sendmessage', 'claude-agent', 'codex-app-server', 'noop'] } };
  // Only codex-app-server and claude-agent are "available" -- routing prefers
  // claude-agent (2nd) over codex-app-server (3rd); claude-sendmessage (1st) is
  // NOT available, so it must be skipped, not silently promoted.
  const manifest = { availableDrivers: ['codex-app-server', 'claude-agent'] };
  const selected = rll.selectDriverForRole(routing, 'arch-testing', manifest);
  assert.strictEqual(selected, 'claude-agent', 'must respect routing PREFERENCE ORDER among available drivers, not availableDrivers array order');
});

test('selectDriverForRole: with zero proven capability, falls through to noop ONLY if routing lists it for this role', () => {
  const routingWithNoop = { routes: { 'arch-testing': ['claude-agent', 'noop'] } };
  const selected = rll.selectDriverForRole(routingWithNoop, 'arch-testing', { availableDrivers: [] });
  assert.strictEqual(selected, 'noop');

  const routingWithoutNoop = { routes: { 'verifier': ['codex-app-server', 'codex-mcp'] } };
  const noneSelected = rll.selectDriverForRole(routingWithoutNoop, 'verifier', { availableDrivers: [] });
  assert.strictEqual(noneSelected, null, 'zero capability and no noop entry for this role must select nothing, never fabricate a driver');
});

test('getCapabilityManifest: production (no test capability) always reports zero available drivers -- never inferred from env/binary/model text', () => {
  const savedEnv = process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY;
  const savedNodeEnv = process.env.NODE_ENV;
  const savedFakeCap = process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES;
  try {
    delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY;
    process.env.NODE_ENV = 'production';
    process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES = JSON.stringify(['codex-app-server']);
    const result = rll.getCapabilityManifest();
    assert.deepStrictEqual(result, { ok: true, availableDrivers: [] }, 'even with a fake-capabilities env var set, production must ignore it entirely');
  } finally {
    if (savedEnv === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY; else process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = savedEnv;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
    if (savedFakeCap === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES; else process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES = savedFakeCap;
  }
});

test('getCapabilityManifest: test capability + well-formed fake manifest is honored', () => {
  const savedEnv = process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY;
  const savedNodeEnv = process.env.NODE_ENV;
  const savedFakeCap = process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES;
  try {
    process.env.NODE_ENV = 'test';
    process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = 'cap';
    process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES = JSON.stringify(['codex-app-server', 'noop']);
    const result = rll.getCapabilityManifest();
    assert.deepStrictEqual(result, { ok: true, availableDrivers: ['codex-app-server', 'noop'] });
  } finally {
    if (savedEnv === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY; else process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = savedEnv;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
    if (savedFakeCap === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES; else process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES = savedFakeCap;
  }
});

test('getCapabilityManifest: an unrecognized driver name in the fake manifest is rejected wholesale (fail closed, not a partial filter)', () => {
  const savedEnv = process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY;
  const savedNodeEnv = process.env.NODE_ENV;
  const savedFakeCap = process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES;
  try {
    process.env.NODE_ENV = 'test';
    process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = 'cap';
    process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES = JSON.stringify(['codex-app-server', 'not-a-real-driver']);
    const result = rll.getCapabilityManifest();
    assert.deepStrictEqual(result, { ok: true, availableDrivers: [] });
  } finally {
    if (savedEnv === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY; else process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = savedEnv;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
    if (savedFakeCap === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES; else process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES = savedFakeCap;
  }
});
