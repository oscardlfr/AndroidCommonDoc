#!/usr/bin/env node
'use strict';

// M7 LIFECYCLE -- ATOMIC REVOCATION PREP + NODE HARNESS CONTAINMENT (2026-08-16),
// PART A: must be the FIRST require in this file, before any require of
// runtime-role-lifecycle.cjs/runtime-bridge-codex.cjs -- see that file's own
// doc comment for why (registryBaseDir() is os.tmpdir()-rooted and shared
// with real production registry data on this machine without this).
require('./lib/private-registry-tmpdir-preload.cjs');

// WP3 unit-level coverage for runtime-role-lifecycle.cjs's role-binding state
// machine, action registry/generation, and CapabilityProvider seam. Sibling of
// runtime-role-lifecycle-registry.test.js (identity/registry/session/binding/
// grant) -- this file covers the layer built ON TOP of that foundation.

const assert = require('node:assert');
const { test } = require('node:test');
const { execFileSync, spawnSync } = require('node:child_process');
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

// ─────────────────────────────────────────────────────────────────────────────
// M6 (production lifecycle + canonical-role activation): the tests above pin
// a real, still-correct invariant -- production must NEVER honor the TEST-ONLY
// FAKE_CAPABILITIES escape hatch. That is orthogonal to the M6 gap: production
// has NO OTHER path either, so a genuinely retained, READY codex-app-server
// supervisor -- proof this repo's OWN registry can already honestly produce,
// via the SAME public transition primitive production itself uses, no
// external TeamCreate/Claude-Agent-Teams probing involved -- is still
// reported unavailable. Interpretive note (documented per this suite's own
// sibling-file precedent of flagging assumed interfaces): this deliberately
// stays scoped to REGISTRY-DERIVED evidence only; external Claude Agent Teams
// capability probing is a documented pre-M6 WP4 concern this test does not
// touch. getCapabilityManifest currently takes zero parameters -- this test
// specifies the minimal additional parameter (projectRoot) a real
// implementation needs to ever consult that registry at all.
// ─────────────────────────────────────────────────────────────────────────────

// M6 CORRECTION PASS (P0-1, independent Codex audit): the test this replaces
// asserted that a BARE fabricated READY role-binding -- with NO corroborating
// evidence that any real supervisor process/transaction ever produced it --
// proves capability. That is precisely today's circularity bug: READY is a
// later lifecycle RESULT, never the capability SOURCE, and a stale/hand-
// written READY record must never be indistinguishable from a genuine one.
// The replacement below asserts the OPPOSITE for the bare case, and the new
// tests following it prove the richer, real-evidence positive case, the
// death-revokes-capability case, and the clean-bootstrap case the audit
// requires (see arch-testing dispatch 20260808T092800Z, P0-1).
test('getCapabilityManifest negative control (P0-1): a BARE READY codex-app-server role-binding -- written directly via the low-level state-machine primitive, never produced by a real ensure()/mintSupervisorBatchUnderTransaction flow -- must NOT alone prove capability (today it wrongly does: this is the exact circularity the audit found)', () => {
  const dir = makeGitProject();
  const savedEnv = process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY;
  const savedNodeEnv = process.env.NODE_ENV;
  try {
    // A bare, directly-fabricated READY binding -- structurally identical to
    // what a stale/hand-written registry record would look like: no
    // SupervisorLifecycleOwner transaction, no owner/rendezvous evidence of
    // any kind behind it.
    const readyBinding = rll.transitionRoleBindingAtomicViaWaypoint(
      dir, W, P, PROF, GEN, 'verifier', 'ABSENT', 'STARTING', 'READY', null,
      { driver: 'codex-app-server', respawn_count: 0 },
    );
    assert.strictEqual(readyBinding.ok, true, JSON.stringify(readyBinding));

    delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY;
    process.env.NODE_ENV = 'production';
    const result = rll.getCapabilityManifest(dir);
    assert.ok(
      result && Array.isArray(result.availableDrivers) && !result.availableDrivers.includes('codex-app-server'),
      'a bare READY role-binding with no corroborating supervisor-transaction evidence must NEVER alone prove capability: ' + JSON.stringify(result),
    );
  } finally {
    if (savedEnv === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY; else process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = savedEnv;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
    cleanup(dir);
  }
});

/**
 * P0-1 shared fixture: mints a REAL supervisor batch through
 * mintSupervisorBatchUnderTransaction (the SAME primitive production ensure()
 * itself uses -- unlike the bare-fabrication negative control above, this
 * genuinely publishes a SupervisorLifecycleOwner/v1 ACTIVE record alongside
 * the role-binding), then advances the role-binding the rest of the way to
 * READY. Returns {coordinationRootId, actionId, worktreeId, planDigest,
 * generationId, profileDigest}.
 */
function mintRichSupervisorEvidence(dir, role) {
  // Unlike this file's own pre-existing tests (which operate directly on
  // registry state via the low-level primitives with manually-supplied W/P
  // constants, never deriving them from a real PLAN.md), this fixture goes
  // through the REAL mint path -- which requires an actually-discoverable
  // PLAN.md (discoverPlan) -- so one must genuinely exist on disk first.
  const waveDir = path.join(dir, '.planning', 'wave-p01-rich-evidence');
  fs.mkdirSync(waveDir, { recursive: true });
  fs.writeFileSync(path.join(waveDir, 'PLAN.md'), '# fixture plan for P0-1 rich-evidence tests\n');

  const pair = rll.resolvePolicyPair(dir);
  assert.strictEqual(pair.ok, true, 'fixture setup: resolvePolicyPair must succeed: ' + JSON.stringify(pair));
  const repoId = rll.computeRepoId(dir);
  const worktreeId = rll.computeWorktreeId(dir);
  const planResult = rll.discoverPlan(dir);
  assert.strictEqual(planResult.ok, true, 'fixture setup: discoverPlan must succeed: ' + JSON.stringify(planResult));
  const planDigest = planResult.planDigest;
  const identity = { ok: true, provider: 'claude-hook', runtime_session_key: 'p01-rich-' + Math.random().toString(16).slice(2) };
  const generationId = rll.resolveSessionGeneration(dir, identity).generationId;
  const profileDigest = PROF;
  const bindingExpiry = new Date(Date.now() + 120000).toISOString().replace(/\.\d{3}Z$/, 'Z');

  const minted = rll.mintSupervisorBatchUnderTransaction(dir, pair, repoId, worktreeId, planDigest, generationId, [
    { role, profileDigest, fromState: 'ABSENT', toState: 'STARTING', fromRecord: null, driver: 'codex-app-server', respawnCount: 0 },
  ], bindingExpiry);
  assert.strictEqual(minted.ok, true, 'fixture setup: mintSupervisorBatchUnderTransaction must succeed: ' + JSON.stringify(minted));
  assert.strictEqual(minted.unavailable, false, JSON.stringify(minted));

  const coordinationRootId = rll.computeCoordinationRootId(dir);
  const ownerState = rll.readSupervisorLifecycleOwnerState(dir, coordinationRootId);
  assert.strictEqual(ownerState.state, 'ACTIVE', 'fixture setup: SupervisorLifecycleOwner must genuinely be ACTIVE: ' + JSON.stringify(ownerState));

  const startingState = rll.readRoleBindingState(dir, worktreeId, planDigest, profileDigest, generationId, role);
  assert.strictEqual(startingState.state, 'STARTING', JSON.stringify(startingState));
  const toReady = rll.transitionRoleBinding(dir, worktreeId, planDigest, profileDigest, generationId, role, 'STARTING', 'READY', startingState.record, {});
  assert.strictEqual(toReady.ok, true, 'fixture setup: STARTING->READY must succeed: ' + JSON.stringify(toReady));

  return { coordinationRootId, actionId: minted.actionId, worktreeId, planDigest, generationId, profileDigest };
}

test('getCapabilityManifest (P0-1): a READY role-binding PLUS a genuinely ACTIVE SupervisorLifecycleOwner record for the SAME coordination root -- both produced via the REAL mintSupervisorBatchUnderTransaction primitive production ensure() itself uses, never a hand-written fixture shape -- DOES prove capability (this is the maximum real evidence achievable without a genuinely spawned child; see the file header\'s C3/spawn-evidence carve-out)', () => {
  const dir = makeGitProject();
  const savedEnv = process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY;
  const savedNodeEnv = process.env.NODE_ENV;
  try {
    mintRichSupervisorEvidence(dir, 'verifier');

    delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY;
    process.env.NODE_ENV = 'production';
    const result = rll.getCapabilityManifest(dir);
    assert.ok(
      result && Array.isArray(result.availableDrivers) && result.availableDrivers.includes('codex-app-server'),
      'a READY binding corroborated by a genuinely ACTIVE SupervisorLifecycleOwner record must count as real evidence: ' + JSON.stringify(result),
    );
  } finally {
    if (savedEnv === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY; else process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = savedEnv;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
    cleanup(dir);
  }
});

test('getCapabilityManifest (P0-1): once the SupervisorLifecycleOwner is terminalized (simulating child/control death) via the SAME terminalizeSupervisorLifecycleOwnerIfCurrent primitive action-failed itself uses, capability becomes UNAVAILABLE immediately -- even though the role-binding record itself still stale-claims READY (a dead supervisor never leaves a self-correcting role-binding behind it)', () => {
  const dir = makeGitProject();
  const savedEnv = process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY;
  const savedNodeEnv = process.env.NODE_ENV;
  try {
    const evidence = mintRichSupervisorEvidence(dir, 'verifier');

    delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY;
    process.env.NODE_ENV = 'production';
    const beforeDeath = rll.getCapabilityManifest(dir);
    assert.ok(beforeDeath.availableDrivers.includes('codex-app-server'), 'fixture sanity: must be available BEFORE the simulated death: ' + JSON.stringify(beforeDeath));

    const terminalized = rll.terminalizeSupervisorLifecycleOwnerIfCurrent(dir, evidence.coordinationRootId, evidence.actionId, 'test-simulated-child-death');
    assert.strictEqual(terminalized.ok, true, JSON.stringify(terminalized));
    const ownerAfter = rll.readSupervisorLifecycleOwnerState(dir, evidence.coordinationRootId);
    assert.strictEqual(ownerAfter.state, 'TERMINATED', JSON.stringify(ownerAfter));
    // Sanity: the role-binding itself was NOT touched by terminalization --
    // it is genuinely still (staleLY) claiming READY, proving the assertion
    // below is about the OWNER evidence, not a side effect of the binding
    // itself having changed.
    const staleBindingState = rll.readRoleBindingState(dir, evidence.worktreeId, evidence.planDigest, evidence.profileDigest, evidence.generationId, 'verifier');
    assert.strictEqual(staleBindingState.state, 'READY', 'fixture sanity: the role-binding must still stale-claim READY after owner termination');

    const afterDeath = rll.getCapabilityManifest(dir);
    assert.ok(
      afterDeath && Array.isArray(afterDeath.availableDrivers) && !afterDeath.availableDrivers.includes('codex-app-server'),
      'capability must become unavailable immediately once the owning supervisor transaction is TERMINATED, even with a stale READY role-binding still on disk: ' + JSON.stringify(afterDeath),
    );
  } finally {
    if (savedEnv === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY; else process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = savedEnv;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
    cleanup(dir);
  }
});

// P0-1's fourth required scenario ("a clean session can bootstrap the FIRST
// supervisor without already having a READY binding") names a CONTRACT
// (capability-to-START must be derivable from something other than an
// existing READY record: pin/profile accreditation + IsolationProvider/
// Broker prerequisites + host ability to start, PLAN.md ~L1169/~L917-926),
// not a specific function name -- this test proposes the minimal exported
// surface for it (mirroring this file's own established
// resolveHostOperationForAction precedent, "today it does not exist, which
// IS the RED"). toolkit-specialist may rename it; the behavioral contract
// (existence, and independence from any pre-existing READY registry state)
// is what this test actually pins.
test('resolveSupervisorStartability (P0-1, proposed minimal interface): a codex-app-server "can I START a fresh supervisor" query must exist and must NOT require an already-RETAINED/READY supervisor to answer -- a clean, empty registry is a well-formed (not thrown/crashed) input, and its answer is unaffected by an unrelated role\'s pre-existing READY binding (capability-to-START is derived from host/pin/profile evidence, never from "is anything already READY")', () => {
  assert.strictEqual(typeof rll.resolveSupervisorStartability, 'function', 'resolveSupervisorStartability (or an equivalently-named exported function answering "can a FIRST codex-app-server supervisor be started") must exist -- today it does not, which IS the RED');
  const dirClean = makeGitProject();
  const dirWithUnrelatedReady = makeGitProject();
  try {
    const cleanResult = rll.resolveSupervisorStartability(dirClean, 'codex-app-server');
    assert.ok(cleanResult && typeof cleanResult.ok === 'boolean', 'must return a well-formed result object, never throw, for a clean/empty registry: ' + JSON.stringify(cleanResult));

    // An unrelated role's pre-existing READY binding (for a DIFFERENT role,
    // 'toolkit-specialist') must never change the answer for 'verifier' --
    // startability is a host/pin capability question, never contingent on
    // some OTHER role happening to already be retained.
    rll.transitionRoleBindingAtomicViaWaypoint(
      dirWithUnrelatedReady, W, P, PROF, GEN, 'toolkit-specialist', 'ABSENT', 'STARTING', 'READY', null,
      { driver: 'codex-app-server', respawn_count: 0 },
    );
    const withUnrelatedReady = rll.resolveSupervisorStartability(dirWithUnrelatedReady, 'codex-app-server');
    assert.ok(withUnrelatedReady && typeof withUnrelatedReady.ok === 'boolean', JSON.stringify(withUnrelatedReady));
    assert.strictEqual(withUnrelatedReady.ok, cleanResult.ok, 'an unrelated role\'s pre-existing READY binding must not change whether a FRESH supervisor is startable: ' + JSON.stringify({ cleanResult, withUnrelatedReady }));
  } finally {
    cleanup(dirClean);
    cleanup(dirWithUnrelatedReady);
  }
});

// Negative/mutation control: proves the assertion technique above is
// genuinely discriminating (not vacuously true regardless of registry
// state) -- with NO retained binding on disk at all, codex-app-server must
// stay unavailable.
test('getCapabilityManifest negative control: production, with NO retained supervisor binding on disk at all, still reports codex-app-server unavailable', () => {
  const dir = makeGitProject();
  const savedEnv = process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY;
  const savedNodeEnv = process.env.NODE_ENV;
  try {
    delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY;
    process.env.NODE_ENV = 'production';
    const result = rll.getCapabilityManifest(dir);
    assert.ok(
      result && Array.isArray(result.availableDrivers) && !result.availableDrivers.includes('codex-app-server'),
      'with genuinely zero retained-binding evidence, codex-app-server must stay unavailable: ' + JSON.stringify(result),
    );
  } finally {
    if (savedEnv === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY; else process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = savedEnv;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
    cleanup(dir);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// M6: closed action-to-host-operation mapping. PLAN.md ~L176-183 freezes an
// EXACT kind(+runtime)->host-operation mapping ("Mapping is exact: team-ensure
// -> TeamCreate only when...", ~L185), executed by the active top-level
// orchestrator/bridge -- this file's own header already documents that "a
// separate top-level action interpreter (outside this file's scope) is the
// one that maps kind to an actual TeamCreate/Agent/SendMessage/
// supervisor-control call" (~L2378). Today NO exported function encodes this
// closed mapping anywhere in this module -- it exists only as PLAN.md prose.
// `runtime-role-lifecycle.cjs` itself must never CALL TeamCreate/Agent/
// SendMessage (PLAN.md ~L156, unchanged) -- this targets only the closed
// LOOKUP TABLE an interpreter would consult, never an executor.
// `resolveHostOperationForAction(kind, runtime)` is this test's own proposed
// minimal interface (a pure function, no side effects) for toolkit-specialist
// to implement against; the exact closed operation-label set below is
// transcribed verbatim from PLAN.md ~L176-183.
// ─────────────────────────────────────────────────────────────────────────────

const PLAN_L176_183_HOST_OPERATION_MAPPING = [
  { kind: 'team-ensure', runtime: 'claude-native', operation: 'TeamCreate' },
  { kind: 'role-spawn', runtime: 'claude-native', operation: 'Agent' },
  { kind: 'role-rebind', runtime: 'claude-native', operation: 'SendMessage' },
  { kind: 'role-rebind', runtime: 'host-process', operation: 'retained-supervisor-control' },
  { kind: 'role-notify', runtime: 'claude-native', operation: 'SendMessage' },
  { kind: 'role-stop-owned', runtime: 'claude-native', operation: 'owned-peer-shutdown' },
  { kind: 'supervisor-start', runtime: 'host-process', operation: 'bash-tool-launch' },
  { kind: 'supervisor-stop-owned', runtime: 'host-process', operation: 'owned-handle-stop' },
];

test('resolveHostOperationForAction: every PLAN.md ~L176-183 closed (kind,runtime) pair resolves to EXACTLY its documented host operation -- a pure lookup, never itself calling TeamCreate/Agent/SendMessage (M6: closed action-to-host-operation mapping; currently no code implements this at all)', () => {
  assert.strictEqual(typeof rll.resolveHostOperationForAction, 'function', 'resolveHostOperationForAction must exist as an exported pure function -- today it does not, which IS the RED');
  for (const row of PLAN_L176_183_HOST_OPERATION_MAPPING) {
    const resolved = rll.resolveHostOperationForAction(row.kind, row.runtime);
    assert.strictEqual(resolved, row.operation, row.kind + '/' + row.runtime + ' must resolve to exactly \'' + row.operation + '\' per PLAN.md ~L176-183, got ' + JSON.stringify(resolved));
  }
});

// Negative control: an unknown kind, or a (kind,runtime) pair outside the
// closed PLAN.md table (e.g. a kind crossed with the WRONG runtime for it),
// must resolve to nothing -- never silently guess a plausible-looking
// operation, proving this lookup is closed, not a permissive catch-all.
test('resolveHostOperationForAction negative control: an unknown kind, or a (kind,runtime) pair crossed OUTSIDE the closed PLAN.md table, resolves to null -- never a guessed/fallback operation', () => {
  assert.strictEqual(typeof rll.resolveHostOperationForAction, 'function', 'precondition for this negative control: the function must exist');
  assert.strictEqual(rll.resolveHostOperationForAction('totally-invalid-kind', 'claude-native'), null);
  assert.strictEqual(rll.resolveHostOperationForAction('team-ensure', 'host-process'), null, 'team-ensure is claude-native ONLY per PLAN.md -- the host-process cross pair must not resolve to anything');
  assert.strictEqual(rll.resolveHostOperationForAction('supervisor-start', 'claude-native'), null, 'supervisor-start is host-process ONLY -- the claude-native cross pair must not resolve to anything');
});

// ─────────────────────────────────────────────────────────────────────────────
// M6 CORRECTION PASS (P0-2, independent Codex audit): resolveHostOperationForAction
// above is proven to be EXACTLY the closed label lookup PLAN.md ~L176-185
// requires, and it must STAY exactly that -- a pure, side-effect-free lookup,
// never itself calling TeamCreate/Agent/SendMessage. The gap the audit found
// is that NOTHING validates or consumes an action before/around that lookup:
// no schema/scope/role/template-digest/session/expiry/ordering validation, no
// one-use/replay tracking, no executor call of any kind. The tests below
// propose the minimal CLOSED INTERPRETER BOUNDARY contract for that gap (name
// TBD by toolkit-specialist, per the dispatch's own "describe the CONTRACT,
// not prescribe an internal name" instruction) -- this file's own proposed
// name is `interpretRoleLifecycleAction`, mirroring
// resolveHostOperationForAction's own "this test's own proposed minimal
// interface" precedent immediately above. Every test below drives it with an
// INJECTED, purely-recording executor (never a real claude-native call) --
// proving calls are REQUESTED, never that TeamCreate/Agent/SendMessage
// actually occur, matching the dispatch's own constraint.
// ─────────────────────────────────────────────────────────────────────────────

function writeInterpreterPlanFixture(dir, slug) {
  const waveDir = path.join(dir, '.planning', 'wave-' + slug);
  fs.mkdirSync(waveDir, { recursive: true });
  fs.writeFileSync(path.join(waveDir, 'PLAN.md'), '# fixture plan for P0-2 interpreter tests (' + slug + ')\n');
}

/** Full real-identity scope for the P0-2 interpreter tests: never hand-typed constants. */
function makeInterpreterScope(dir, slug) {
  writeInterpreterPlanFixture(dir, slug);
  const repoId = rll.computeRepoId(dir);
  const worktreeId = rll.computeWorktreeId(dir);
  const planDigest = rll.discoverPlan(dir).planDigest;
  const identity = { ok: true, provider: 'claude-hook', runtime_session_key: 'p02-' + slug + '-' + Math.random().toString(16).slice(2) };
  const generationId = rll.resolveSessionGeneration(dir, identity).generationId;
  const policyDigest = 'e'.repeat(64); // opaque, self-consistent scope id -- the interpreter boundary this suite targets never itself re-derives a live routing.json digest.
  return { repoId, worktreeId, planDigest, generationId, policyDigest };
}

function makeRecordingExecutor() {
  const calls = [];
  const executor = (operation, action) => { calls.push({ operation, actionId: action && action.action_id }); };
  return { executor, calls };
}

/** Corrupts one field of an already-minted action's on-disk record (mirrors the bats suite's own `_corrupt_action_field` convention). */
function corruptInterpreterActionField(dir, actionId, field, value) {
  const p = rll.actionPathFor(dir, actionId);
  const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
  obj[field] = value;
  fs.writeFileSync(p, JSON.stringify(obj));
}

test('interpretRoleLifecycleAction (P0-2, proposed minimal interface): must exist as an exported function -- today NO closed interpreter boundary exists anywhere around resolveHostOperationForAction, which IS the RED', () => {
  assert.strictEqual(typeof rll.interpretRoleLifecycleAction, 'function', 'interpretRoleLifecycleAction (or an equivalently-named exported closed interpreter boundary) must exist -- today it does not');
});

test('interpretRoleLifecycleAction (P0-2): a well-formed, unexpired, first-use team-ensure action produces EXACTLY ONE executor call, whose resolved operation matches HOST_OPERATION_FOR_ACTION exactly', () => {
  assert.strictEqual(typeof rll.interpretRoleLifecycleAction, 'function', 'precondition: interpretRoleLifecycleAction must exist');
  const dir = makeGitProject();
  try {
    const scope = makeInterpreterScope(dir, 'happy');
    const actionId = rll.generateActionId();
    const expiresAt = new Date(Date.now() + 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const payload = rll.buildTeamEnsurePayload('team-x', 'ensure the support plane');
    const minted = rll.mintRoleLifecycleAction(dir, actionId, 'team-ensure', 'claude-native', scope.repoId, scope.worktreeId, scope.planDigest, scope.policyDigest, scope.generationId, null, payload, expiresAt);
    assert.strictEqual(minted.ok, true, JSON.stringify(minted));

    const { executor, calls } = makeRecordingExecutor();
    const result = rll.interpretRoleLifecycleAction(dir, actionId, { worktreeId: scope.worktreeId, planDigest: scope.planDigest, sessionGenerationId: scope.generationId, role: null }, executor);
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    assert.strictEqual(calls.length, 1, 'expected exactly one executor call: ' + JSON.stringify(calls));
    assert.strictEqual(calls[0].operation, rll.resolveHostOperationForAction('team-ensure', 'claude-native'));
    assert.strictEqual(calls[0].actionId, actionId);
  } finally {
    cleanup(dir);
  }
});

test('interpretRoleLifecycleAction (P0-2): an action whose (kind,runtime) pair is OUTSIDE the closed PLAN.md ~L176-185 table (well-formed individually, e.g. team-ensure crossed with host-process -- confirmed mintable today since mintRoleLifecycleAction does not itself enforce ACTION_KIND_RUNTIME co-variance) produces ZERO executor calls', () => {
  assert.strictEqual(typeof rll.interpretRoleLifecycleAction, 'function', 'precondition: interpretRoleLifecycleAction must exist');
  const dir = makeGitProject();
  try {
    const scope = makeInterpreterScope(dir, 'wrong-kind-runtime');
    const actionId = rll.generateActionId();
    const expiresAt = new Date(Date.now() + 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const payload = rll.buildTeamEnsurePayload('team-x', 'desc');
    const minted = rll.mintRoleLifecycleAction(dir, actionId, 'team-ensure', 'host-process', scope.repoId, scope.worktreeId, scope.planDigest, scope.policyDigest, scope.generationId, null, payload, expiresAt);
    assert.strictEqual(minted.ok, true, JSON.stringify(minted));
    assert.strictEqual(rll.resolveHostOperationForAction('team-ensure', 'host-process'), null, 'fixture sanity: this (kind,runtime) pair must genuinely be outside the closed table');

    const { executor, calls } = makeRecordingExecutor();
    const result = rll.interpretRoleLifecycleAction(dir, actionId, { worktreeId: scope.worktreeId, planDigest: scope.planDigest, sessionGenerationId: scope.generationId, role: null }, executor);
    assert.strictEqual(result.ok, false, 'an action outside the closed (kind,runtime) table must never be dispatched: ' + JSON.stringify(result));
    assert.strictEqual(calls.length, 0, 'zero executor calls for an unresolvable (kind,runtime) pair: ' + JSON.stringify(calls));
  } finally {
    cleanup(dir);
  }
});

test('interpretRoleLifecycleAction (P0-2): an action addressed with the WRONG role, or the WRONG worktree scope, produces ZERO executor calls (two distinct mismatches, same discriminating property)', () => {
  assert.strictEqual(typeof rll.interpretRoleLifecycleAction, 'function', 'precondition: interpretRoleLifecycleAction must exist');
  const dir = makeGitProject();
  try {
    const scope = makeInterpreterScope(dir, 'wrong-scope');
    const actionId = rll.generateActionId();
    const expiresAt = new Date(Date.now() + 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const payload = rll.buildRoleSpawnPayload('team-x', 'mate-1', 'verifier', 'bootstrap-ref', 'ready --action ' + actionId);
    const minted = rll.mintRoleLifecycleAction(dir, actionId, 'role-spawn', 'claude-native', scope.repoId, scope.worktreeId, scope.planDigest, scope.policyDigest, scope.generationId, 'verifier', payload, expiresAt);
    assert.strictEqual(minted.ok, true, JSON.stringify(minted));

    // (a) wrong role.
    const wrongRole = makeRecordingExecutor();
    const r1 = rll.interpretRoleLifecycleAction(dir, actionId, { worktreeId: scope.worktreeId, planDigest: scope.planDigest, sessionGenerationId: scope.generationId, role: 'quality-gater' }, wrongRole.executor);
    assert.strictEqual(r1.ok, false, JSON.stringify(r1));
    assert.strictEqual(wrongRole.calls.length, 0, 'a caller addressing the wrong role must get zero executor calls: ' + JSON.stringify(wrongRole.calls));

    // (b) wrong worktree scope (a well-formed but different 64-hex value).
    const wrongWorktree = makeRecordingExecutor();
    const foreignWorktreeId = scope.worktreeId.slice(0, 63) + (scope.worktreeId.slice(-1) === '0' ? '1' : '0');
    const r2 = rll.interpretRoleLifecycleAction(dir, actionId, { worktreeId: foreignWorktreeId, planDigest: scope.planDigest, sessionGenerationId: scope.generationId, role: 'verifier' }, wrongWorktree.executor);
    assert.strictEqual(r2.ok, false, JSON.stringify(r2));
    assert.strictEqual(wrongWorktree.calls.length, 0, 'a caller addressing the wrong worktree scope must get zero executor calls: ' + JSON.stringify(wrongWorktree.calls));

    // Positive control: the CORRECT role+scope for the SAME still-live action genuinely dispatches -- proving the rejections above are about the mismatch, not merely a broken fixture.
    const correct = makeRecordingExecutor();
    const r3 = rll.interpretRoleLifecycleAction(dir, actionId, { worktreeId: scope.worktreeId, planDigest: scope.planDigest, sessionGenerationId: scope.generationId, role: 'verifier' }, correct.executor);
    assert.strictEqual(r3.ok, true, JSON.stringify(r3));
    assert.strictEqual(correct.calls.length, 1, JSON.stringify(correct.calls));
  } finally {
    cleanup(dir);
  }
});

test('interpretRoleLifecycleAction (P0-2): a role-spawn action whose corresponding role-binding was created against a STALE profile_digest (simulating the role template changing after the binding was created) produces ZERO executor calls -- the interpreter must resolve the binding at the CURRENT canonical roleProfileDigestFor(role), never trust the action alone', () => {
  assert.strictEqual(typeof rll.interpretRoleLifecycleAction, 'function', 'precondition: interpretRoleLifecycleAction must exist');
  const dir = makeGitProject();
  try {
    const scope = makeInterpreterScope(dir, 'stale-digest');
    const actionId = rll.generateActionId();
    const expiresAt = new Date(Date.now() + 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const payload = rll.buildRoleSpawnPayload('team-x', 'mate-1', 'verifier', 'bootstrap-ref', 'ready --action ' + actionId);
    const minted = rll.mintRoleLifecycleAction(dir, actionId, 'role-spawn', 'claude-native', scope.repoId, scope.worktreeId, scope.planDigest, scope.policyDigest, scope.generationId, 'verifier', payload, expiresAt);
    assert.strictEqual(minted.ok, true, JSON.stringify(minted));

    // The paired role-binding is created at a STALE profile digest (never
    // the real, current rll.roleProfileDigestFor('verifier')) -- exactly
    // what a role whose template changed since the binding was created
    // would look like: findable only at the OLD path, absent at today's
    // canonical one.
    const staleProfileDigest = 'f'.repeat(64);
    assert.notStrictEqual(staleProfileDigest, rll.roleProfileDigestFor('verifier'), 'fixture sanity: this must genuinely differ from the real current digest');
    const staleBinding = rll.transitionRoleBinding(
      dir, scope.worktreeId, scope.planDigest, staleProfileDigest, scope.generationId, 'verifier', 'ABSENT', 'STARTING', null,
      { driver: 'claude-sendmessage', respawn_count: 0, pending_action_id: actionId },
    );
    assert.strictEqual(staleBinding.ok, true, JSON.stringify(staleBinding));

    const { executor, calls } = makeRecordingExecutor();
    const result = rll.interpretRoleLifecycleAction(dir, actionId, { worktreeId: scope.worktreeId, planDigest: scope.planDigest, sessionGenerationId: scope.generationId, role: 'verifier' }, executor);
    assert.strictEqual(result.ok, false, JSON.stringify(result));
    assert.strictEqual(calls.length, 0, 'a role-binding only reachable at a STALE profile digest must never be treated as pending this action: ' + JSON.stringify(calls));
  } finally {
    cleanup(dir);
  }
});

test('interpretRoleLifecycleAction (P0-2): a REPLAYED action (already consumed once) produces ZERO additional executor calls on the second attempt -- one-use is enforced, not merely documented', () => {
  assert.strictEqual(typeof rll.interpretRoleLifecycleAction, 'function', 'precondition: interpretRoleLifecycleAction must exist');
  const dir = makeGitProject();
  try {
    const scope = makeInterpreterScope(dir, 'replay');
    const actionId = rll.generateActionId();
    const expiresAt = new Date(Date.now() + 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const payload = rll.buildTeamEnsurePayload('team-x', 'desc');
    const minted = rll.mintRoleLifecycleAction(dir, actionId, 'team-ensure', 'claude-native', scope.repoId, scope.worktreeId, scope.planDigest, scope.policyDigest, scope.generationId, null, payload, expiresAt);
    assert.strictEqual(minted.ok, true, JSON.stringify(minted));
    const callerScope = { worktreeId: scope.worktreeId, planDigest: scope.planDigest, sessionGenerationId: scope.generationId, role: null };

    const first = makeRecordingExecutor();
    const r1 = rll.interpretRoleLifecycleAction(dir, actionId, callerScope, first.executor);
    assert.strictEqual(r1.ok, true, JSON.stringify(r1));
    assert.strictEqual(first.calls.length, 1, JSON.stringify(first.calls));

    const replay = makeRecordingExecutor();
    const r2 = rll.interpretRoleLifecycleAction(dir, actionId, callerScope, replay.executor);
    assert.strictEqual(r2.ok, false, 'a second interpretation of an already-consumed action must never succeed: ' + JSON.stringify(r2));
    assert.strictEqual(replay.calls.length, 0, 'a replayed action must produce ZERO further executor calls: ' + JSON.stringify(replay.calls));
  } finally {
    cleanup(dir);
  }
});

test('interpretRoleLifecycleAction (P0-2): an EXPIRED action (past its own expires_at) produces ZERO executor calls', () => {
  assert.strictEqual(typeof rll.interpretRoleLifecycleAction, 'function', 'precondition: interpretRoleLifecycleAction must exist');
  const dir = makeGitProject();
  try {
    const scope = makeInterpreterScope(dir, 'expired');
    const actionId = rll.generateActionId();
    const expiresAt = new Date(Date.now() + 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const payload = rll.buildTeamEnsurePayload('team-x', 'desc');
    const minted = rll.mintRoleLifecycleAction(dir, actionId, 'team-ensure', 'claude-native', scope.repoId, scope.worktreeId, scope.planDigest, scope.policyDigest, scope.generationId, null, payload, expiresAt);
    assert.strictEqual(minted.ok, true, JSON.stringify(minted));
    corruptInterpreterActionField(dir, actionId, 'expires_at', '2000-01-01T00:00:00Z');

    const { executor, calls } = makeRecordingExecutor();
    const result = rll.interpretRoleLifecycleAction(dir, actionId, { worktreeId: scope.worktreeId, planDigest: scope.planDigest, sessionGenerationId: scope.generationId, role: null }, executor);
    assert.strictEqual(result.ok, false, JSON.stringify(result));
    assert.strictEqual(calls.length, 0, 'an expired action must never dispatch: ' + JSON.stringify(calls));
  } finally {
    cleanup(dir);
  }
});

test('interpretRoleLifecycleAction (P0-2): a CROSS-SESSION action (session_generation_id with no live registry record) produces ZERO executor calls', () => {
  assert.strictEqual(typeof rll.interpretRoleLifecycleAction, 'function', 'precondition: interpretRoleLifecycleAction must exist');
  const dir = makeGitProject();
  try {
    const scope = makeInterpreterScope(dir, 'cross-session');
    const actionId = rll.generateActionId();
    const expiresAt = new Date(Date.now() + 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const payload = rll.buildTeamEnsurePayload('team-x', 'desc');
    const minted = rll.mintRoleLifecycleAction(dir, actionId, 'team-ensure', 'claude-native', scope.repoId, scope.worktreeId, scope.planDigest, scope.policyDigest, scope.generationId, null, payload, expiresAt);
    assert.strictEqual(minted.ok, true, JSON.stringify(minted));
    const foreignGenerationId = 'f'.repeat(32);
    corruptInterpreterActionField(dir, actionId, 'session_generation_id', foreignGenerationId);

    const { executor, calls } = makeRecordingExecutor();
    const result = rll.interpretRoleLifecycleAction(dir, actionId, { worktreeId: scope.worktreeId, planDigest: scope.planDigest, sessionGenerationId: foreignGenerationId, role: null }, executor);
    assert.strictEqual(result.ok, false, JSON.stringify(result));
    assert.strictEqual(calls.length, 0, 'an action whose session_generation_id has no live registry record must never dispatch, even when the caller\'s OWN claimed scope self-consistently matches the tampered value: ' + JSON.stringify(calls));
  } finally {
    cleanup(dir);
  }
});

test('interpretRoleLifecycleAction (P0-2): a role-spawn action whose paired role-binding references a team-ensure action that was NEVER registered SUCCEEDED is suppressed -- a dependent role-spawn never fires alone (PLAN.md ~L165: never execute role-spawn if its team-ensure predecessor failed/never satisfied)', () => {
  assert.strictEqual(typeof rll.interpretRoleLifecycleAction, 'function', 'precondition: interpretRoleLifecycleAction must exist');
  const dir = makeGitProject();
  try {
    const scope = makeInterpreterScope(dir, 'dependent-suppressed');
    const teamEnsureActionId = rll.generateActionId();
    const roleSpawnActionId = rll.generateActionId();
    const expiresAt = new Date(Date.now() + 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');

    const teamPayload = rll.buildTeamEnsurePayload('team-x', 'desc');
    const teamMinted = rll.mintRoleLifecycleAction(dir, teamEnsureActionId, 'team-ensure', 'claude-native', scope.repoId, scope.worktreeId, scope.planDigest, scope.policyDigest, scope.generationId, null, teamPayload, expiresAt);
    assert.strictEqual(teamMinted.ok, true, JSON.stringify(teamMinted));

    const spawnPayload = rll.buildRoleSpawnPayload('team-x', 'mate-1', 'verifier', 'bootstrap-ref', 'ready --action ' + roleSpawnActionId);
    const spawnMinted = rll.mintRoleLifecycleAction(dir, roleSpawnActionId, 'role-spawn', 'claude-native', scope.repoId, scope.worktreeId, scope.planDigest, scope.policyDigest, scope.generationId, 'verifier', spawnPayload, expiresAt);
    assert.strictEqual(spawnMinted.ok, true, JSON.stringify(spawnMinted));

    // Paired role-binding, genuinely pending THIS role-spawn action, but its
    // team_ensure_action_id predecessor was NEVER registered SUCCEEDED
    // (readTeamEnsureState for a never-created marker reports ABSENT, never
    // SUCCEEDED -- exactly the "never satisfied" case, distinct from an
    // explicit FAILED).
    const profileDigest = rll.roleProfileDigestFor('verifier');
    const binding = rll.transitionRoleBinding(
      dir, scope.worktreeId, scope.planDigest, profileDigest, scope.generationId, 'verifier', 'ABSENT', 'STARTING', null,
      { driver: 'claude-sendmessage', respawn_count: 0, pending_action_id: roleSpawnActionId, team_ensure_action_id: teamEnsureActionId },
    );
    assert.strictEqual(binding.ok, true, JSON.stringify(binding));
    const teamEnsureState = rll.readTeamEnsureState(dir, scope.generationId, scope.worktreeId, scope.planDigest);
    assert.notStrictEqual(teamEnsureState.state, 'SUCCEEDED', 'fixture sanity: the team-ensure predecessor must genuinely NOT be SUCCEEDED: ' + JSON.stringify(teamEnsureState));

    const { executor, calls } = makeRecordingExecutor();
    const result = rll.interpretRoleLifecycleAction(dir, roleSpawnActionId, { worktreeId: scope.worktreeId, planDigest: scope.planDigest, sessionGenerationId: scope.generationId, role: 'verifier' }, executor);
    assert.strictEqual(result.ok, false, JSON.stringify(result));
    assert.strictEqual(calls.length, 0, 'a role-spawn whose team-ensure predecessor never succeeded must never fire alone: ' + JSON.stringify(calls));
  } finally {
    cleanup(dir);
  }
});

test('interpretRoleLifecycleAction (P0-2): deadline enforcement + action-failed settlement -- interpreting an EXPIRED action settles the affected role-binding through the SAME terminalization path the CLI\'s own `action-failed` command uses (state leaves STARTING), never a silent drop that strands the binding forever', () => {
  assert.strictEqual(typeof rll.interpretRoleLifecycleAction, 'function', 'precondition: interpretRoleLifecycleAction must exist');
  const dir = makeGitProject();
  try {
    const scope = makeInterpreterScope(dir, 'deadline-settlement');
    const actionId = rll.generateActionId();
    const expiresAt = new Date(Date.now() + 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const payload = rll.buildRoleSpawnPayload('team-x', 'mate-1', 'verifier', 'bootstrap-ref', 'ready --action ' + actionId);
    const minted = rll.mintRoleLifecycleAction(dir, actionId, 'role-spawn', 'claude-native', scope.repoId, scope.worktreeId, scope.planDigest, scope.policyDigest, scope.generationId, 'verifier', payload, expiresAt);
    assert.strictEqual(minted.ok, true, JSON.stringify(minted));
    const profileDigest = rll.roleProfileDigestFor('verifier');
    const binding = rll.transitionRoleBinding(
      dir, scope.worktreeId, scope.planDigest, profileDigest, scope.generationId, 'verifier', 'ABSENT', 'STARTING', null,
      { driver: 'claude-sendmessage', respawn_count: 0, pending_action_id: actionId },
    );
    assert.strictEqual(binding.ok, true, JSON.stringify(binding));
    corruptInterpreterActionField(dir, actionId, 'expires_at', '2000-01-01T00:00:00Z');

    const { executor, calls } = makeRecordingExecutor();
    const result = rll.interpretRoleLifecycleAction(dir, actionId, { worktreeId: scope.worktreeId, planDigest: scope.planDigest, sessionGenerationId: scope.generationId, role: 'verifier' }, executor);
    assert.strictEqual(result.ok, false, JSON.stringify(result));
    assert.strictEqual(calls.length, 0, JSON.stringify(calls));

    const afterState = rll.readRoleBindingState(dir, scope.worktreeId, scope.planDigest, profileDigest, scope.generationId, 'verifier');
    assert.notStrictEqual(afterState.state, 'STARTING', 'a deadline-expired action must settle its binding through the SAME action-failed terminalization path, never leave it stranded in STARTING referencing a dead action: ' + JSON.stringify(afterState));
  } finally {
    cleanup(dir);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// M6 Block C + M7/WP4 dependency closure (dispatch arch-testing-20260808T142647Z,
// Section 1): productive disk-consumer registration. `hasRegisteredValidatedDiskConsumer`
// today ONLY ever consults RUNTIME_ROLE_LIFECYCLE_TEST_DISK_CONSUMERS under
// isTestCapability() -- production is unconditionally false (honest-empty,
// mirroring getCapabilityManifest's PRE-M6 shape, L2551-2574). This section
// proposes the minimal registration/query primitive pair toolkit-specialist
// implements against (this suite's own established "propose the minimal
// interface" precedent -- see resolveSupervisorStartability/
// interpretRoleLifecycleAction/resolveCanonicalRoleProfile above):
// `registerDiskConsumer` mints a durable, host-private, exactly-correlated
// registration record (never mere file/PID/text presence); `hasRegisteredValidatedDiskConsumer`
// gains worktree/plan/session/role correlation parameters and, when
// RUNTIME_ROLE_LIFECYCLE_TEST_DISK_CONSUMERS is ABSENT (production, or a test
// that deliberately omits it), consults the REAL registry instead of an
// unconditional false. The existing env-var seam is preserved EXACTLY as
// today whenever that var IS present under isTestCapability() -- additive,
// never a replacement -- so every pre-existing CLI-level "noop...disk
// consumer" test in runtime-role-lifecycle-handlers.test.js (which sets that
// env var) stays green unmodified.
// ─────────────────────────────────────────────────────────────────────────────

function makeDiskConsumerScope(dir, slug) {
  const waveDir = path.join(dir, '.planning', 'wave-' + slug);
  fs.mkdirSync(waveDir, { recursive: true });
  fs.writeFileSync(path.join(waveDir, 'PLAN.md'), '# fixture plan for disk-consumer-registration tests (' + slug + ')\n');
  const worktreeId = rll.computeWorktreeId(dir);
  const planDigest = rll.discoverPlan(dir).planDigest;
  const identity = { ok: true, provider: 'claude-hook', runtime_session_key: 'disk-consumer-' + slug + '-' + Math.random().toString(16).slice(2) };
  const generationId = rll.resolveSessionGeneration(dir, identity).generationId;
  return { worktreeId, planDigest, generationId };
}

/**
 * Runs `fn` with NODE_ENV=production and RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY
 * (and RUNTIME_ROLE_LIFECYCLE_TEST_DISK_CONSUMERS) deleted -- the SAME
 * convention this file's own P0-1 getCapabilityManifest production tests
 * already established (L731-733/L809-810/L830-831/L905-906), so the real
 * (non-test-capability) branch is genuinely exercised, never the env-var seam.
 */
function withProductionCapability(fn) {
  const savedCap = process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY;
  const savedNodeEnv = process.env.NODE_ENV;
  const savedDiskConsumers = process.env.RUNTIME_ROLE_LIFECYCLE_TEST_DISK_CONSUMERS;
  try {
    delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY;
    delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_DISK_CONSUMERS;
    process.env.NODE_ENV = 'production';
    return fn();
  } finally {
    if (savedCap === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY; else process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = savedCap;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
    if (savedDiskConsumers === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_DISK_CONSUMERS; else process.env.RUNTIME_ROLE_LIFECYCLE_TEST_DISK_CONSUMERS = savedDiskConsumers;
  }
}

test('registerDiskConsumer (proposed minimal interface): must exist as an exported function -- today no production registration mechanism is wired at all, which IS the RED', () => {
  assert.strictEqual(typeof rll.registerDiskConsumer, 'function', 'registerDiskConsumer (or an equivalently-named exported registration primitive) must exist -- today it does not');
});

test('diskConsumerRegistrationPathFor (proposed path helper, mirrors grantPathFor/roleBindingPathFor/actionPathFor): must exist as an exported function -- needed so tests can directly plant/tamper fixture records the same way every other registry primitive in this file already supports', () => {
  assert.strictEqual(typeof rll.diskConsumerRegistrationPathFor, 'function', 'diskConsumerRegistrationPathFor must exist -- today it does not');
});

test('hasRegisteredValidatedDiskConsumer (proposed extended signature): must accept (projectRoot, role, worktreeId, planDigest, sessionGenerationId) -- today it takes only (role), which IS the RED', () => {
  assert.strictEqual(typeof rll.hasRegisteredValidatedDiskConsumer, 'function', 'precondition: hasRegisteredValidatedDiskConsumer must exist');
  assert.ok(rll.hasRegisteredValidatedDiskConsumer.length >= 5, 'hasRegisteredValidatedDiskConsumer must accept at least 5 parameters (projectRoot, role, worktreeId, planDigest, sessionGenerationId) for exact correlation -- got declared arity ' + rll.hasRegisteredValidatedDiskConsumer.length);
});

test('hasRegisteredValidatedDiskConsumer (production, real registry): a FRESH, valid registerDiskConsumer() registration for the exact tuple makes the role available -- positive control for every negative case below', () => {
  assert.strictEqual(typeof rll.registerDiskConsumer, 'function', 'precondition: registerDiskConsumer must exist');
  const dir = makeGitProject();
  try {
    const scope = makeDiskConsumerScope(dir, 'disk-consumer-fresh');
    const reg = rll.registerDiskConsumer(dir, 'verifier', scope.worktreeId, scope.planDigest, scope.generationId, process.pid, 120);
    assert.strictEqual(reg.ok, true, JSON.stringify(reg));
    assert.match(reg.registrationId, /^[0-9a-f]{32}$/, 'registration_id must be a 128-bit CSPRNG hex id, mirroring every other registry id in this file');

    withProductionCapability(() => {
      const available = rll.hasRegisteredValidatedDiskConsumer(dir, 'verifier', scope.worktreeId, scope.planDigest, scope.generationId);
      assert.strictEqual(available, true, 'a fresh, exactly-correlated, live registration must make noop available');
    });
  } finally {
    cleanup(dir);
  }
});

test('hasRegisteredValidatedDiskConsumer (production, real registry): with NO registration at all, stays false -- the honest-empty-in-production default is preserved', () => {
  const dir = makeGitProject();
  try {
    const scope = makeDiskConsumerScope(dir, 'disk-consumer-none');
    withProductionCapability(() => {
      const available = rll.hasRegisteredValidatedDiskConsumer(dir, 'verifier', scope.worktreeId, scope.planDigest, scope.generationId);
      assert.strictEqual(available, false, 'zero registrations on disk must never be interpreted as an available consumer');
    });
  } finally {
    cleanup(dir);
  }
});

test('hasRegisteredValidatedDiskConsumer (production, real registry): a MALFORMED on-disk registration record (missing required fields) is rejected -- never trusted merely because a file exists at the expected path (binding user spec: mere file/PID/text presence never accredits)', () => {
  assert.strictEqual(typeof rll.diskConsumerRegistrationPathFor, 'function', 'precondition: diskConsumerRegistrationPathFor must exist');
  const dir = makeGitProject();
  try {
    const scope = makeDiskConsumerScope(dir, 'disk-consumer-malformed');
    const recPath = rll.diskConsumerRegistrationPathFor(dir, scope.worktreeId, scope.planDigest, scope.generationId, 'verifier');
    fs.mkdirSync(path.dirname(recPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(recPath, JSON.stringify({ schema: 'runtime/disk-consumer-registration/v1', role: 'verifier' }), { mode: 0o600 });

    withProductionCapability(() => {
      const available = rll.hasRegisteredValidatedDiskConsumer(dir, 'verifier', scope.worktreeId, scope.planDigest, scope.generationId);
      assert.strictEqual(available, false, 'a malformed (incomplete) registration record must never accredit a consumer');
    });
  } finally {
    cleanup(dir);
  }
});

test('hasRegisteredValidatedDiskConsumer (production, real registry): a STALE registration (now past its own expiry) is rejected, even though nothing else about it is wrong', () => {
  assert.strictEqual(typeof rll.registerDiskConsumer, 'function', 'precondition: registerDiskConsumer must exist');
  assert.strictEqual(typeof rll.diskConsumerRegistrationPathFor, 'function', 'precondition: diskConsumerRegistrationPathFor must exist');
  const dir = makeGitProject();
  try {
    const scope = makeDiskConsumerScope(dir, 'disk-consumer-stale');
    const reg = rll.registerDiskConsumer(dir, 'verifier', scope.worktreeId, scope.planDigest, scope.generationId, process.pid, 120);
    assert.strictEqual(reg.ok, true, JSON.stringify(reg));
    const recPath = rll.diskConsumerRegistrationPathFor(dir, scope.worktreeId, scope.planDigest, scope.generationId, 'verifier');
    const rec = JSON.parse(fs.readFileSync(recPath, 'utf8'));
    rec.expiry = '2000-01-01T00:00:00Z';
    fs.chmodSync(recPath, 0o600);
    fs.writeFileSync(recPath, JSON.stringify(rec), { mode: 0o600 });

    withProductionCapability(() => {
      const available = rll.hasRegisteredValidatedDiskConsumer(dir, 'verifier', scope.worktreeId, scope.planDigest, scope.generationId);
      assert.strictEqual(available, false, 'a registration past its own expiry must be rejected regardless of any other field being valid');
    });
  } finally {
    cleanup(dir);
  }
});

test('hasRegisteredValidatedDiskConsumer (production, real registry): a registration for a process that has SINCE DIED (real child process, spawned and already exited) is rejected -- distinct from mere expiry, proven with a genuinely dead PID rather than a fabricated one', () => {
  assert.strictEqual(typeof rll.registerDiskConsumer, 'function', 'precondition: registerDiskConsumer must exist');
  const dir = makeGitProject();
  try {
    const scope = makeDiskConsumerScope(dir, 'disk-consumer-dead');
    // Spawn a REAL child process and synchronously wait for it to exit --
    // by the time spawnSync returns, deadPid genuinely no longer exists.
    const spawned = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
    const deadPid = spawned.pid;
    assert.ok(Number.isInteger(deadPid) && deadPid > 0, 'fixture sanity: a real PID was captured: ' + JSON.stringify(spawned.error));
    const reg = rll.registerDiskConsumer(dir, 'verifier', scope.worktreeId, scope.planDigest, scope.generationId, deadPid, 120);
    assert.strictEqual(reg.ok, true, JSON.stringify(reg));

    withProductionCapability(() => {
      const available = rll.hasRegisteredValidatedDiskConsumer(dir, 'verifier', scope.worktreeId, scope.planDigest, scope.generationId);
      assert.strictEqual(available, false, 'a registration whose consumer_pid process has since exited must be rejected, even with an otherwise-unexpired TTL');
    });
  } finally {
    cleanup(dir);
  }
});

test('hasRegisteredValidatedDiskConsumer (production, real registry): WRONG role in an otherwise-valid, live, unexpired registration is rejected', () => {
  assert.strictEqual(typeof rll.registerDiskConsumer, 'function', 'precondition: registerDiskConsumer must exist');
  const dir = makeGitProject();
  try {
    const scope = makeDiskConsumerScope(dir, 'disk-consumer-wrong-role');
    const reg = rll.registerDiskConsumer(dir, 'verifier', scope.worktreeId, scope.planDigest, scope.generationId, process.pid, 120);
    assert.strictEqual(reg.ok, true, JSON.stringify(reg));

    withProductionCapability(() => {
      const wrongRole = rll.hasRegisteredValidatedDiskConsumer(dir, 'quality-gater', scope.worktreeId, scope.planDigest, scope.generationId);
      assert.strictEqual(wrongRole, false, 'a registration minted for verifier must never accredit a DIFFERENT role (quality-gater)');
      const rightRole = rll.hasRegisteredValidatedDiskConsumer(dir, 'verifier', scope.worktreeId, scope.planDigest, scope.generationId);
      assert.strictEqual(rightRole, true, 'positive control: the CORRECT role, same call, genuinely succeeds');
    });
  } finally {
    cleanup(dir);
  }
});

test('hasRegisteredValidatedDiskConsumer (production, real registry): WRONG worktree, PLAN, or session-generation in an otherwise-valid, live, unexpired registration is each independently rejected', () => {
  assert.strictEqual(typeof rll.registerDiskConsumer, 'function', 'precondition: registerDiskConsumer must exist');
  const dir = makeGitProject();
  try {
    const scope = makeDiskConsumerScope(dir, 'disk-consumer-wrong-scope');
    const reg = rll.registerDiskConsumer(dir, 'verifier', scope.worktreeId, scope.planDigest, scope.generationId, process.pid, 120);
    assert.strictEqual(reg.ok, true, JSON.stringify(reg));

    const foreignWorktreeId = scope.worktreeId.slice(0, 63) + (scope.worktreeId.slice(-1) === '0' ? '1' : '0');
    const foreignPlanDigest = scope.planDigest.slice(0, 63) + (scope.planDigest.slice(-1) === '0' ? '1' : '0');
    const foreignGenerationId = scope.generationId.slice(0, 31) + (scope.generationId.slice(-1) === '0' ? '1' : '0');

    withProductionCapability(() => {
      assert.strictEqual(rll.hasRegisteredValidatedDiskConsumer(dir, 'verifier', foreignWorktreeId, scope.planDigest, scope.generationId), false, 'wrong worktree_id must be rejected');
      assert.strictEqual(rll.hasRegisteredValidatedDiskConsumer(dir, 'verifier', scope.worktreeId, foreignPlanDigest, scope.generationId), false, 'wrong plan_digest must be rejected');
      assert.strictEqual(rll.hasRegisteredValidatedDiskConsumer(dir, 'verifier', scope.worktreeId, scope.planDigest, foreignGenerationId), false, 'wrong session_generation_id must be rejected');
      assert.strictEqual(rll.hasRegisteredValidatedDiskConsumer(dir, 'verifier', scope.worktreeId, scope.planDigest, scope.generationId), true, 'positive control: the exact original tuple genuinely succeeds');
    });
  } finally {
    cleanup(dir);
  }
});

test('hasRegisteredValidatedDiskConsumer (production, real registry): a REPLAYED/reused registration -- a validly-minted record for ONE tuple, its bytes copied onto a DIFFERENT tuple\'s own path -- is rejected (mirrors lifecycle-command-grant\'s own grant-id-path-mismatch defense, L991-1020: a self-consistent foreign record is never trusted merely because it sits at this path)', () => {
  assert.strictEqual(typeof rll.registerDiskConsumer, 'function', 'precondition: registerDiskConsumer must exist');
  const dir = makeGitProject();
  try {
    const scopeA = makeDiskConsumerScope(dir, 'disk-consumer-replay-a');
    const identityB = { ok: true, provider: 'claude-hook', runtime_session_key: 'disk-consumer-replay-b-' + Math.random().toString(16).slice(2) };
    const scopeB = { worktreeId: scopeA.worktreeId, planDigest: scopeA.planDigest, generationId: rll.resolveSessionGeneration(dir, identityB).generationId };
    assert.notStrictEqual(scopeB.generationId, scopeA.generationId, 'fixture sanity: genuinely two different session generations');

    const regA = rll.registerDiskConsumer(dir, 'verifier', scopeA.worktreeId, scopeA.planDigest, scopeA.generationId, process.pid, 120);
    assert.strictEqual(regA.ok, true, JSON.stringify(regA));
    const pathA = rll.diskConsumerRegistrationPathFor(dir, scopeA.worktreeId, scopeA.planDigest, scopeA.generationId, 'verifier');
    const pathB = rll.diskConsumerRegistrationPathFor(dir, scopeB.worktreeId, scopeB.planDigest, scopeB.generationId, 'verifier');
    assert.notStrictEqual(pathA, pathB, 'fixture sanity: the two tuples resolve to different registry paths');

    // Copy A's genuinely well-formed, self-consistent bytes onto B's own path
    // -- the file at B's path now legitimately claims to BE registration A.
    fs.mkdirSync(path.dirname(pathB), { recursive: true, mode: 0o700 });
    fs.writeFileSync(pathB, fs.readFileSync(pathA), { mode: 0o600 });

    withProductionCapability(() => {
      const available = rll.hasRegisteredValidatedDiskConsumer(dir, 'verifier', scopeB.worktreeId, scopeB.planDigest, scopeB.generationId);
      assert.strictEqual(available, false, 'a copied/replayed registration record must never be trusted merely because it sits at the queried path -- its OWN embedded tuple must independently correlate');
    });
  } finally {
    cleanup(dir);
  }
});

test('hasRegisteredValidatedDiskConsumer: RUNTIME_ROLE_LIFECYCLE_TEST_DISK_CONSUMERS regression is UNCHANGED -- when that env var is present under isTestCapability(), the extended (worktreeId,planDigest,sessionGenerationId) parameters are ignored and the exact prior role-membership behavior still governs', () => {
  const dir = makeGitProject();
  const savedNodeEnv = process.env.NODE_ENV;
  const savedCap = process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY;
  const savedDiskConsumers = process.env.RUNTIME_ROLE_LIFECYCLE_TEST_DISK_CONSUMERS;
  try {
    process.env.NODE_ENV = 'test';
    process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = 'disk-consumer-regression-cap';
    process.env.RUNTIME_ROLE_LIFECYCLE_TEST_DISK_CONSUMERS = JSON.stringify(['verifier']);
    // Deliberately WRONG/foreign scope params -- the regression path must
    // ignore them entirely and answer from the env var alone, exactly as
    // hasRegisteredValidatedDiskConsumer(role) did before this extension.
    const foreignWorktreeId = 'f'.repeat(64);
    const foreignPlanDigest = 'e'.repeat(64);
    const foreignGenerationId = 'd'.repeat(32);
    const available = rll.hasRegisteredValidatedDiskConsumer(dir, 'verifier', foreignWorktreeId, foreignPlanDigest, foreignGenerationId);
    assert.strictEqual(available, true, 'the legacy env-var seam must still answer purely from role-name membership, ignoring worktree/plan/session correlation entirely -- exact prior behavior');
    const notListed = rll.hasRegisteredValidatedDiskConsumer(dir, 'quality-gater', foreignWorktreeId, foreignPlanDigest, foreignGenerationId);
    assert.strictEqual(notListed, false, 'a role absent from the env var array must still be rejected, exactly as before');
  } finally {
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
    if (savedCap === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY; else process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = savedCap;
    if (savedDiskConsumers === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_DISK_CONSUMERS; else process.env.RUNTIME_ROLE_LIFECYCLE_TEST_DISK_CONSUMERS = savedDiskConsumers;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
