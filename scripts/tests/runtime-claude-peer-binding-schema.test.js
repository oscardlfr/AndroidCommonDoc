#!/usr/bin/env node
'use strict';

require('./lib/private-registry-tmpdir-preload.cjs');

const assert = require('node:assert');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const IMPL = path.resolve(__dirname, '../lib/runtime-role-lifecycle.cjs');
const rll = require(IMPL);

function makeGitProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-peer-binding-'));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'claude-peer-binding-test@test.local']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Claude Peer Binding Test']);
  execFileSync('git', ['-C', dir, 'commit', '-q', '--allow-empty', '-m', 'init']);
  return dir;
}

function withProject(fn) {
  const projectRoot = makeGitProject();
  try {
    fn(projectRoot);
  } finally {
    fs.rmSync(rll.registryRepoDir(projectRoot), { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
}

function hex(byteLength) {
  return crypto.randomBytes(byteLength).toString('hex');
}

function isoNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function isoPlusSeconds(iso, seconds) {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function makeValidPeerBindingFixture() {
  const bindingId = hex(16);
  const createdAt = isoNow();
  return {
    actor_binding_id: hex(16),
    agent_id: 'agent-' + hex(4),
    binding_id: bindingId,
    created_at: createdAt,
    expiry: isoPlusSeconds(createdAt, 120),
    plan_digest: hex(32),
    role: 'arch-testing',
    schema: rll.CLAUDE_PEER_BINDING_SCHEMA,
    session: 'session-' + hex(4),
    teammate_name: 'arch-testing',
    worktree_id: hex(32),
  };
}

function writeOwnedFixture(projectRoot, record) {
  const filePath = rll.claudePeerBindingPathFor(projectRoot, record.binding_id);
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(filePath), 0o700);
  fs.writeFileSync(filePath, JSON.stringify(record), { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
  return filePath;
}

// ── 1. schema + key-set exports ─────────────────────────────────────────────

test('exports exact schema literal and exact closed key set', () => {
  withProject(() => {
    assert.strictEqual(rll.CLAUDE_PEER_BINDING_SCHEMA, 'runtime/claude-peer-binding/v1');
    assert.deepStrictEqual(rll.CLAUDE_PEER_BINDING_KEYS, [
      'actor_binding_id', 'agent_id', 'binding_id', 'created_at', 'expiry',
      'plan_digest', 'role', 'schema', 'session', 'teammate_name', 'worktree_id',
    ]);
    assert.strictEqual(rll.CLAUDE_PEER_BINDING_KEYS.length, 11);
    assert.ok(Object.isFrozen(rll.CLAUDE_PEER_BINDING_KEYS));
  });
});

// ── 2. canonical path ────────────────────────────────────────────────────────

test('canonical path is exactly under claude-peer-bindings/<binding_id>.json', () => {
  withProject((projectRoot) => {
    const bindingId = hex(16);
    const expected = path.join(rll.registryRepoDir(projectRoot), 'claude-peer-bindings', bindingId + '.json');
    assert.strictEqual(rll.claudePeerBindingPathFor(projectRoot, bindingId), expected);
  });
});

// ── 3. valid record accepted by identity ────────────────────────────────────

test('valid exact record is accepted and returned by identity', () => {
  withProject(() => {
    const record = makeValidPeerBindingFixture();
    const result = rll.validateClaudePeerBindingRecord(record, record.binding_id);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.record, record);
    assert.deepStrictEqual(Object.keys(result).sort(), ['ok', 'record']);
  });
});

// ── 4. shape/schema/id/correlation failures ─────────────────────────────────

test('missing key, extra key, wrong schema, malformed id, or path/field id mismatch is INVALID', () => {
  withProject(() => {
    const base = makeValidPeerBindingFixture();

    for (const key of rll.CLAUDE_PEER_BINDING_KEYS) {
      const withMissingKey = { ...base };
      delete withMissingKey[key];
      assert.deepStrictEqual(
        rll.validateClaudePeerBindingRecord(withMissingKey, base.binding_id),
        { ok: false, reason: 'INVALID' },
      );
    }

    const withExtraKey = { ...base, extra_field: 'x' };
    assert.deepStrictEqual(
      rll.validateClaudePeerBindingRecord(withExtraKey, base.binding_id),
      { ok: false, reason: 'INVALID' },
    );

    const withWrongSchema = { ...base, schema: 'runtime/other-schema/v1' };
    assert.deepStrictEqual(
      rll.validateClaudePeerBindingRecord(withWrongSchema, base.binding_id),
      { ok: false, reason: 'INVALID' },
    );

    assert.deepStrictEqual(
      rll.validateClaudePeerBindingRecord(base, 'not-a-hex-id'),
      { ok: false, reason: 'INVALID' },
    );

    const withMalformedRecordId = { ...base, binding_id: 'not-a-hex-id' };
    assert.deepStrictEqual(
      rll.validateClaudePeerBindingRecord(withMalformedRecordId, 'not-a-hex-id'),
      { ok: false, reason: 'INVALID' },
    );

    const withMalformedActorId = { ...base, actor_binding_id: 'zz' };
    assert.deepStrictEqual(
      rll.validateClaudePeerBindingRecord(withMalformedActorId, base.binding_id),
      { ok: false, reason: 'INVALID' },
    );

    assert.deepStrictEqual(
      rll.validateClaudePeerBindingRecord(base, hex(16)),
      { ok: false, reason: 'INVALID' },
    );
  });
});

// ── 5. string/role/teammate/digest failures ─────────────────────────────────

test('empty raw string, noncanonical role, mismatched teammate, or malformed worktree/plan is INVALID', () => {
  withProject(() => {
    const base = makeValidPeerBindingFixture();

    for (const key of ['agent_id', 'session', 'role', 'teammate_name']) {
      const withEmptyString = { ...base, [key]: '' };
      assert.deepStrictEqual(
        rll.validateClaudePeerBindingRecord(withEmptyString, base.binding_id),
        { ok: false, reason: 'INVALID' },
      );
    }

    const withNoncanonicalRole = { ...base, role: 'not-a-canonical-role', teammate_name: 'not-a-canonical-role' };
    assert.deepStrictEqual(
      rll.validateClaudePeerBindingRecord(withNoncanonicalRole, base.binding_id),
      { ok: false, reason: 'INVALID' },
    );

    const withMismatchedTeammate = { ...base, teammate_name: 'some-other-role' };
    assert.deepStrictEqual(
      rll.validateClaudePeerBindingRecord(withMismatchedTeammate, base.binding_id),
      { ok: false, reason: 'INVALID' },
    );

    const withMalformedWorktree = { ...base, worktree_id: 'z'.repeat(64) };
    assert.deepStrictEqual(
      rll.validateClaudePeerBindingRecord(withMalformedWorktree, base.binding_id),
      { ok: false, reason: 'INVALID' },
    );

    const withMalformedPlan = { ...base, plan_digest: base.plan_digest.slice(0, 63) };
    assert.deepStrictEqual(
      rll.validateClaudePeerBindingRecord(withMalformedPlan, base.binding_id),
      { ok: false, reason: 'INVALID' },
    );
  });
});

// ── 6. timestamp/chronology failures ────────────────────────────────────────

test('noncanonical, impossible, reversed, future-created, or expired timestamp is INVALID', () => {
  withProject(() => {
    const base = makeValidPeerBindingFixture();

    const withNoncanonicalTimestamp = { ...base, created_at: '2026-09-01 00:00:00Z' };
    assert.deepStrictEqual(
      rll.validateClaudePeerBindingRecord(withNoncanonicalTimestamp, base.binding_id),
      { ok: false, reason: 'INVALID' },
    );

    const withImpossibleDate = { ...base, created_at: '2026-02-30T00:00:00Z' };
    assert.deepStrictEqual(
      rll.validateClaudePeerBindingRecord(withImpossibleDate, base.binding_id),
      { ok: false, reason: 'INVALID' },
    );

    const withReversedChronology = { ...base, created_at: base.expiry, expiry: base.created_at };
    assert.deepStrictEqual(
      rll.validateClaudePeerBindingRecord(withReversedChronology, base.binding_id),
      { ok: false, reason: 'INVALID' },
    );

    const futureCreatedAt = isoPlusSeconds(isoNow(), 3600);
    const withFutureCreated = {
      ...base, created_at: futureCreatedAt, expiry: isoPlusSeconds(futureCreatedAt, 120),
    };
    assert.deepStrictEqual(
      rll.validateClaudePeerBindingRecord(withFutureCreated, base.binding_id),
      { ok: false, reason: 'INVALID' },
    );

    const pastCreatedAt = isoPlusSeconds(isoNow(), -3600);
    const withExpired = { ...base, created_at: pastCreatedAt, expiry: isoPlusSeconds(pastCreatedAt, 60) };
    assert.deepStrictEqual(
      rll.validateClaudePeerBindingRecord(withExpired, base.binding_id),
      { ok: false, reason: 'INVALID' },
    );
  });
});

// ── 7. exact-path reader: absence + valid on-disk record ────────────────────

test('exact-path reader returns UNAVAILABLE for absence and the valid record for a regular mode-0600 JSON file', () => {
  withProject((projectRoot) => {
    const missingId = hex(16);
    assert.deepStrictEqual(
      rll.readClaudePeerBinding(projectRoot, missingId),
      { ok: false, reason: 'UNAVAILABLE' },
    );

    const record = makeValidPeerBindingFixture();
    writeOwnedFixture(projectRoot, record);

    assert.deepStrictEqual(
      rll.readClaudePeerBinding(projectRoot, record.binding_id),
      { ok: true, record },
    );
  });
});

// ── 8. malformed/symlink/structurally-invalid on-disk records ──────────────

test(
  'malformed JSON, symlink leaf, or structurally invalid JSON is INVALID, '
  + 'and no returned reason contains the fixture agent/session/teammate values',
  () => {
    withProject((projectRoot) => {
      const record = makeValidPeerBindingFixture();
      const sensitiveValues = [record.agent_id, record.session, record.teammate_name];

      const malformedId = hex(16);
      const malformedPath = rll.claudePeerBindingPathFor(projectRoot, malformedId);
      fs.mkdirSync(path.dirname(malformedPath), { recursive: true, mode: 0o700 });
      fs.chmodSync(path.dirname(malformedPath), 0o700);
      fs.writeFileSync(
        malformedPath,
        '{"agent_id":"' + record.agent_id + '","session":"' + record.session + '"',
        { mode: 0o600 },
      );
      fs.chmodSync(malformedPath, 0o600);
      const malformedResult = rll.readClaudePeerBinding(projectRoot, malformedId);
      assert.deepStrictEqual(malformedResult, { ok: false, reason: 'INVALID' });

      const symlinkId = hex(16);
      const symlinkTargetPath = writeOwnedFixture(projectRoot, record);
      const symlinkPath = rll.claudePeerBindingPathFor(projectRoot, symlinkId);
      fs.symlinkSync(symlinkTargetPath, symlinkPath);
      const symlinkResult = rll.readClaudePeerBinding(projectRoot, symlinkId);
      assert.deepStrictEqual(symlinkResult, { ok: false, reason: 'INVALID' });

      const structuralId = hex(16);
      const structuralPath = rll.claudePeerBindingPathFor(projectRoot, structuralId);
      fs.mkdirSync(path.dirname(structuralPath), { recursive: true, mode: 0o700 });
      fs.chmodSync(path.dirname(structuralPath), 0o700);
      fs.writeFileSync(
        structuralPath,
        JSON.stringify({ agent_id: record.agent_id, session: record.session, teammate_name: record.teammate_name }),
        { mode: 0o600 },
      );
      fs.chmodSync(structuralPath, 0o600);
      const structuralResult = rll.readClaudePeerBinding(projectRoot, structuralId);
      assert.deepStrictEqual(structuralResult, { ok: false, reason: 'INVALID' });

      for (const result of [malformedResult, symlinkResult, structuralResult]) {
        assert.strictEqual(typeof result.reason, 'string');
        for (const value of sensitiveValues) {
          assert.ok(!result.reason.includes(value));
        }
      }
    });
  },
);
