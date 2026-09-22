'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const record = require('../lib/evidence-run-record.cjs');

function valid(id) {
  return {
    schema: record.SCHEMA, run_id: id, producer: 'test', head: 'a'.repeat(40),
    wave_slug: 'demo', plan_sha256: 'b'.repeat(64), target: 'suite', scope: 'full',
    target_sha256: 'c'.repeat(64), environment_fingerprint: 'd'.repeat(64),
    tool_versions: { node: 'v24' }, started_at: '2026-01-01T00:00:00.000Z',
    finished_at: '2026-01-01T00:01:00.000Z', complete: true, verdict: 'pass',
    counts: { total: 3, failed: 0 }, artifact_sha256: 'e'.repeat(64),
    artifact_identity: (id === 'run-a' ? 'f' : '9').repeat(64),
  };
}

test('accepts two independent agreeing records', () => {
  assert.strictEqual(record.requireAgreement([valid('run-a'), valid('run-b')]).length, 2);
});
test('rejects reuse of one run id', () => {
  assert.throws(() => record.requireAgreement([valid('run-a'), valid('run-a')]), /INSUFFICIENT/);
});
test('rejects two run ids that reuse one retained artifact', () => {
  const reused = valid('run-b'); reused.artifact_identity = valid('run-a').artifact_identity;
  assert.throws(() => record.requireAgreement([valid('run-a'), reused]), /INSUFFICIENT/);
});
test('identical deterministic bytes in distinct retained files have one digest and two artifact identities', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-run-identities-'));
  const first = path.join(root, 'first.tap');
  const second = path.join(root, 'second.tap');
  fs.writeFileSync(first, '1..1\nok 1 deterministic\n');
  fs.writeFileSync(second, '1..1\nok 1 deterministic\n');
  try {
    const a = record.stableReadArtifact(first, { root });
    const b = record.stableReadArtifact(second, { root });
    assert.strictEqual(a.sha256, b.sha256);
    assert.notStrictEqual(a.identity, b.identity);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('rejects disagreement instead of choosing newest', () => {
  const changed = valid('run-b'); changed.counts = { total: 4, failed: 0 };
  assert.throws(() => record.requireAgreement([valid('run-a'), changed]), /INSUFFICIENT/);
});
test('rejects incoherent pass counts and unbound tool metadata', () => {
  const badCounts = valid('run-a'); badCounts.counts = { total: 3, failed: 1 };
  assert.throws(() => record.validate(badCounts), /INVALID_EVIDENCE_COUNTS/);
  const noTools = valid('run-b'); noTools.tool_versions = {};
  assert.throws(() => record.validate(noTools), /INVALID_EVIDENCE_RUN/);
});
test('rejects a wave without a PLAN binding', () => {
  const bad = valid('run-a'); bad.plan_sha256 = 'none';
  assert.throws(() => record.validate(bad), /INVALID_EVIDENCE_RUN/);
});
test('rejects completion before start time', () => {
  const bad = valid('run-a'); bad.finished_at = '2025-12-31T23:59:59.000Z';
  assert.throws(() => record.validate(bad), /INVALID_EVIDENCE_TIME_ORDER/);
});

test('rejects unknown record and count keys instead of accepting ambiguous evidence', () => {
  const extraRecord = valid('run-a'); extraRecord.untrusted = true;
  assert.throws(() => record.validate(extraRecord), /INVALID_EVIDENCE_RUN/);
  const extraCounts = valid('run-b'); extraCounts.counts.cached = 3;
  assert.throws(() => record.validate(extraCounts), /INVALID_EVIDENCE_COUNTS/);
});

test('a completed record cannot be finalized again with a different artifact', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-run-finalized-'));
  const artifact = path.join(root, 'artifact.tap');
  fs.writeFileSync(artifact, '1..1\nok 1 example\n');
  try {
    assert.throws(() => record.finish(valid('run-a'), {
      verdict: 'pass', counts: { total: 1, failed: 0 }, artifact,
    }), /EVIDENCE_RUN_ALREADY_FINALIZED/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
