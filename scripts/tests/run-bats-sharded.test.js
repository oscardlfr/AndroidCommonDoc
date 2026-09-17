#!/usr/bin/env node
'use strict';

// Unit tests for run-bats-sharded.cjs's aggregation/validation logic against
// SYNTHETIC fixture handoffs -- no real bats invocation, so this file runs in
// milliseconds. The one genuine end-to-end run (real bats, real shards, real
// serial-vs-parallel case-identity comparison) is a separate, deliberately
// slow suite (run-bats-sharded-e2e.bats), run once at the end per the
// small-tests-first discipline this wave has used throughout.

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const rbs = require(path.resolve(__dirname, '../tools/run-bats-sharded.cjs'));

// ── computeTargetDigest ─────────────────────────────────────────────────

test('computeTargetDigest matches order-independent input (sorted before hashing)', () => {
  const a = rbs.computeTargetDigest(['b.bats', 'a.bats', 'c.bats']);
  const b = rbs.computeTargetDigest(['c.bats', 'b.bats', 'a.bats']);
  assert.equal(a, b, 'digest must be order-independent, matching run-bats.sh\'s own sort');
  assert.match(a, /^[0-9a-f]{40}$/, 'git hash-object --stdin produces a 40-char sha1');
});

test('computeTargetDigest is sensitive to the exact file set (one file added changes it)', () => {
  const a = rbs.computeTargetDigest(['a.bats', 'b.bats']);
  const b = rbs.computeTargetDigest(['a.bats', 'b.bats', 'c.bats']);
  assert.notEqual(a, b);
});

// ── parseHandoffEnv / extractHandoffPath ────────────────────────────────

test('parseHandoffEnv reads KEY=value lines, ignoring anything else', () => {
  const parsed = rbs.parseHandoffEnv('BATS_OK=5\nBATS_NOT_OK=0\n\n# not a real comment, just noise\nBATS_COMPLETE=true\n');
  assert.equal(parsed.BATS_OK, '5');
  assert.equal(parsed.BATS_NOT_OK, '0');
  assert.equal(parsed.BATS_COMPLETE, 'true');
});

test('extractHandoffPath parses run-bats.sh\'s own stderr line format', () => {
  const stderr = 'some preflight noise\n[run-bats] handoff written: /root/.androidcommondoc/bats-result.abc123.env (verdict=pass complete=true)\n';
  assert.equal(rbs.extractHandoffPath(stderr), '/root/.androidcommondoc/bats-result.abc123.env');
});

test('extractHandoffPath returns null when the line never appears (a shard that crashed before writing one)', () => {
  assert.equal(rbs.extractHandoffPath('some unrelated crash output\n'), null);
});

// ── validateShardResult ─────────────────────────────────────────────────

function baseHandoff(overrides) {
  return Object.assign({
    BATS_OK: '10', BATS_NOT_OK: '0', BATS_EXPECTED: '10', BATS_TOTAL: '10',
    BATS_COMPLETE: 'true', BATS_VERDICT: 'pass', BATS_HEAD: 'a'.repeat(40),
    BATS_RUN_ID: 'shard0-run', BATS_SCOPE: 'targeted',
    BATS_TARGET_DIGEST: rbs.computeTargetDigest(['x.bats', 'y.bats']),
  }, overrides);
}

test('validateShardResult ok=true when the handoff is complete, count-consistent, and the digest matches', () => {
  const out = rbs.validateShardResult({ handoff: baseHandoff(), expectedFiles: ['x.bats', 'y.bats'] });
  assert.deepEqual(out, { ok: true });
});

test('validateShardResult fails closed: missing handoff', () => {
  const out = rbs.validateShardResult({ handoff: null, expectedFiles: ['x.bats'] });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'SHARD_HANDOFF_MISSING');
});

test('validateShardResult fails closed: an incomplete shard (BATS_COMPLETE=false)', () => {
  const out = rbs.validateShardResult({ handoff: baseHandoff({ BATS_COMPLETE: 'false' }), expectedFiles: ['x.bats', 'y.bats'] });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'SHARD_INCOMPLETE');
});

test('validateShardResult fails closed: total/expected mismatch inside one shard', () => {
  const out = rbs.validateShardResult({ handoff: baseHandoff({ BATS_TOTAL: '9' }), expectedFiles: ['x.bats', 'y.bats'] });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'SHARD_COUNT_MISMATCH');
});

test('validateShardResult fails closed: a shard that silently ran a DIFFERENT file set than assigned', () => {
  // This is the case that matters most: run-bats.sh exited 0 and produced a
  // perfectly well-formed, internally-consistent handoff -- but for the
  // wrong files. Only the digest cross-check catches it.
  const out = rbs.validateShardResult({ handoff: baseHandoff(), expectedFiles: ['x.bats', 'z.bats'] });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'SHARD_FILE_SET_MISMATCH');
});

test('validateShardResult fails closed: a shard that ran a SUBSET of its assigned files (one silently dropped)', () => {
  const out = rbs.validateShardResult({ handoff: baseHandoff(), expectedFiles: ['x.bats', 'y.bats', 'z.bats'] });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'SHARD_FILE_SET_MISMATCH');
});

// ── aggregateHandoffs ────────────────────────────────────────────────────

function shardHandoff(i, overrides) {
  return baseHandoff(Object.assign({ BATS_RUN_ID: 'shard' + i + '-run-' + i }, overrides));
}

test('aggregateHandoffs sums counts across shards and returns the shared HEAD', () => {
  const out = rbs.aggregateHandoffs([
    shardHandoff(0, { BATS_OK: '10', BATS_NOT_OK: '0', BATS_EXPECTED: '10', BATS_TOTAL: '10' }),
    shardHandoff(1, { BATS_OK: '8', BATS_NOT_OK: '2', BATS_EXPECTED: '10', BATS_TOTAL: '10' }),
  ], 2);
  assert.equal(out.ok, true);
  assert.equal(out.head, 'a'.repeat(40));
  assert.deepEqual(out.facts, { ok: 18, notOk: 2, expected: 20, total: 20 });
});

test('aggregateHandoffs fails closed: fewer handoffs than shards launched (one went missing)', () => {
  const out = rbs.aggregateHandoffs([shardHandoff(0)], 3);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'SHARD_COUNT_MISSING');
  assert.equal(out.found, 1);
  assert.equal(out.expected, 3);
});

test('aggregateHandoffs fails closed: a HEAD that differs between shards (a commit landed mid-run)', () => {
  const out = rbs.aggregateHandoffs([
    shardHandoff(0, { BATS_HEAD: 'a'.repeat(40) }),
    shardHandoff(1, { BATS_HEAD: 'b'.repeat(40) }),
  ], 2);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'SHARD_HEAD_MISMATCH');
});

test('aggregateHandoffs fails closed: two shards reporting the SAME run-id (a real bug, or a replayed handoff)', () => {
  const out = rbs.aggregateHandoffs([
    shardHandoff(0, { BATS_RUN_ID: 'duplicate-id' }),
    shardHandoff(1, { BATS_RUN_ID: 'duplicate-id' }),
  ], 2);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'SHARD_RUN_ID_DUPLICATE');
});

test('aggregateHandoffs fails closed: non-integer counts in a handoff (malformed field)', () => {
  const out = rbs.aggregateHandoffs([shardHandoff(0, { BATS_OK: 'not-a-number' })], 1);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'SHARD_COUNTS_NOT_INTEGER');
});

test('aggregateHandoffs fails closed: aggregate total vs expected mismatch is an independent check, not merely inherited from per-shard validation', () => {
  // Both shards are individually consistent (each TOTAL===EXPECTED, which is
  // exactly what validateShardResult already checks) -- this can only occur
  // via tampered/hand-built inputs bypassing that per-shard gate, which is
  // precisely why this second, aggregate-level check earns its place rather
  // than being redundant with it.
  const a = shardHandoff(0, { BATS_OK: '5', BATS_NOT_OK: '0', BATS_EXPECTED: '5', BATS_TOTAL: '5' });
  const b = shardHandoff(1, { BATS_OK: '5', BATS_NOT_OK: '0', BATS_EXPECTED: '5', BATS_TOTAL: '5' });
  // Hand-craft a post-per-shard-validation inconsistency: this can only occur
  // if aggregateHandoffs is called with tampered inputs (e.g. a future
  // refactor bypassing validateShardResult) -- proving the aggregate check
  // is not merely decorative even though it is currently unreachable via the
  // CLI's own call order.
  b.BATS_EXPECTED = '6';
  const out = rbs.aggregateHandoffs([a, b], 2);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'AGGREGATE_COUNT_MISMATCH');
  assert.equal(out.total, 10);
  assert.equal(out.expected, 11);
});

// ── renumberTap ──────────────────────────────────────────────────────────

test('renumberTap merges two shard logs into one continuous, correctly renumbered plan', () => {
  const shard0 = '1..2\nok 1 alpha\nok 2 beta\n';
  const shard1 = '1..1\nok 1 gamma\n';
  const { text, total } = rbs.renumberTap([shard0, shard1]);
  assert.equal(total, 3);
  assert.equal(text, '1..3\nok 1 alpha\nok 2 beta\nok 3 gamma\n');
});

test('renumberTap preserves not-ok status and trailing diagnostic lines, in order', () => {
  const shard0 = '1..2\nok 1 alpha\nnot ok 2 beta\n# (in test file beta.bats, line 5)\n#   `false\' failed\n';
  const { text, total } = rbs.renumberTap([shard0]);
  assert.equal(total, 2);
  assert.equal(text, '1..2\nok 1 alpha\nnot ok 2 beta\n# (in test file beta.bats, line 5)\n#   `false\' failed\n');
});

test('renumberTap drops per-shard plan lines and any TAP version header, keeping only case lines and their diagnostics', () => {
  const shard0 = 'TAP version 13\n1..1\nok 1 alpha\n';
  const { text, total } = rbs.renumberTap([shard0]);
  assert.equal(total, 1);
  assert.equal(text, '1..1\nok 1 alpha\n');
});

test('renumberTap on zero shards produces an empty, honestly-zero plan rather than throwing', () => {
  const { text, total } = rbs.renumberTap([]);
  assert.equal(total, 0);
  assert.equal(text, '1..0\n\n');
});

// ── caseIdentities ───────────────────────────────────────────────────────

test('caseIdentities extracts and sorts case descriptions, independent of numbering or ok/not-ok status', () => {
  const tap = '1..3\nnot ok 1 zeta\nok 2 alpha\nok 3 mu\n';
  assert.deepEqual(rbs.caseIdentities(tap), ['alpha', 'mu', 'zeta']);
});

test('caseIdentities: two differently-sharded TAP streams covering the SAME roster produce IDENTICAL sorted identities', () => {
  // This is the serial/parallel equivalence property itself, proven here at
  // the unit level on synthetic data; the e2e suite proves it once for real.
  const serial = '1..3\nok 1 alpha\nok 2 beta\nok 3 gamma\n';
  const parallel = rbs.renumberTap(['1..2\nok 1 gamma\nok 2 alpha\n', '1..1\nok 1 beta\n']).text;
  assert.deepEqual(rbs.caseIdentities(serial), rbs.caseIdentities(parallel));
});
