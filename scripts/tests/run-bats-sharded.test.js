#!/usr/bin/env node
'use strict';

// Unit tests for run-bats-sharded.cjs's aggregation/validation logic against
// SYNTHETIC fixture handoffs -- no real bats invocation, so this file runs in
// milliseconds. The one genuine end-to-end run (real bats, real shards, real
// serial-vs-parallel case-identity comparison) is a separate, deliberately
// slow suite (run-bats-sharded-e2e.bats), run once at the end per the
// small-tests-first discipline this wave has used throughout.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
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

// ── confineHandoffPath ───────────────────────────────────────────────────
// extractHandoffPath's return value is parsed from a shard's OWN stderr --
// fully attacker/bug controlled. These prove a hostile or malformed path
// never reaches the read-then-later-unlink path main() uses it for.

const confineFixtureDirs = [];
test.after(() => {
  for (const dir of confineFixtureDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function makeResultsDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rbs-confine-'));
  confineFixtureDirs.push(dir);
  return dir;
}

test('confineHandoffPath ok=true for a genuine regular file directly inside resultsDir', () => {
  const dir = makeResultsDir();
  const p = path.join(dir, 'bats-result.abc123.env');
  fs.writeFileSync(p, 'BATS_OK=1\n');
  const out = rbs.confineHandoffPath(p, dir);
  assert.equal(out.ok, true);
  assert.equal(out.canonicalPath, fs.realpathSync(p));
});

test('confineHandoffPath fails closed: path does not exist', () => {
  const dir = makeResultsDir();
  const out = rbs.confineHandoffPath(path.join(dir, 'bats-result.never-written.env'), dir);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'SHARD_HANDOFF_MISSING');
});

test('confineHandoffPath fails closed: null/empty raw path (extractHandoffPath found nothing)', () => {
  const dir = makeResultsDir();
  assert.equal(rbs.confineHandoffPath(null, dir).reason, 'SHARD_HANDOFF_MISSING');
  assert.equal(rbs.confineHandoffPath('', dir).reason, 'SHARD_HANDOFF_MISSING');
});

test('confineHandoffPath fails closed: a real file OUTSIDE resultsDir via literal path traversal', () => {
  const dir = makeResultsDir();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'rbs-confine-outside-'));
  confineFixtureDirs.push(outside);
  const secret = path.join(outside, 'bats-result.stolen.env');
  fs.writeFileSync(secret, 'BATS_OK=1\n');
  const traversal = path.join(dir, '..', path.basename(outside), 'bats-result.stolen.env');
  const out = rbs.confineHandoffPath(traversal, dir);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'SHARD_HANDOFF_PATH_ESCAPES_RESULTS_DIR');
});

test('confineHandoffPath fails closed: a symlinked ancestor directory smuggling the leaf elsewhere', () => {
  const dir = makeResultsDir();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'rbs-confine-outside-'));
  confineFixtureDirs.push(outside);
  fs.writeFileSync(path.join(outside, 'bats-result.smuggled.env'), 'BATS_OK=1\n');
  const trapdoor = path.join(dir, 'trapdoor');
  fs.symlinkSync(outside, trapdoor);
  const out = rbs.confineHandoffPath(path.join(trapdoor, 'bats-result.smuggled.env'), dir);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'SHARD_HANDOFF_PATH_ESCAPES_RESULTS_DIR');
});

test('confineHandoffPath fails closed: the leaf itself is a symlink, even to a valid-looking target inside resultsDir', () => {
  const dir = makeResultsDir();
  const real = path.join(dir, 'bats-result.real.env');
  fs.writeFileSync(real, 'BATS_OK=1\n');
  const link = path.join(dir, 'bats-result.link.env');
  fs.symlinkSync(real, link);
  const out = rbs.confineHandoffPath(link, dir);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'SHARD_HANDOFF_IS_SYMLINK');
});

test('confineHandoffPath fails closed: the leaf is a directory, not a regular file (recursive-delete bait)', () => {
  const dir = makeResultsDir();
  const trap = path.join(dir, 'bats-result.trap.env');
  fs.mkdirSync(trap);
  fs.writeFileSync(path.join(trap, 'anything'), 'x');
  const out = rbs.confineHandoffPath(trap, dir);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'SHARD_HANDOFF_NOT_REGULAR_FILE');
});

test('confineHandoffPath fails closed: basename does not match the bats-result.*.env shape', () => {
  const dir = makeResultsDir();
  const p = path.join(dir, 'not-a-handoff.txt');
  fs.writeFileSync(p, 'x');
  const out = rbs.confineHandoffPath(p, dir);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'SHARD_HANDOFF_NAME_INVALID');
});

// ── cleanupRunArtifacts ──────────────────────────────────────────────────

test('cleanupRunArtifacts removes a tracked regular file', () => {
  const dir = makeResultsDir();
  const p = path.join(dir, 'suite-bats.shard0.stamp.log');
  fs.writeFileSync(p, 'x');
  const state = rbs.createRunState();
  state.shardLogPaths.push(p);
  rbs.cleanupRunArtifacts(state);
  assert.equal(fs.existsSync(p), false);
});

test('cleanupRunArtifacts is idempotent -- a second call is a no-op, never a double-delete error', () => {
  const dir = makeResultsDir();
  const p = path.join(dir, 'suite-bats.shard0.stamp.log');
  fs.writeFileSync(p, 'x');
  const state = rbs.createRunState();
  state.shardLogPaths.push(p);
  rbs.cleanupRunArtifacts(state);
  assert.doesNotThrow(() => rbs.cleanupRunArtifacts(state));
});

test('cleanupRunArtifacts never recursively deletes -- a path swapped for a directory after being tracked is skipped entirely', () => {
  // Models a TOCTOU window: confineHandoffPath only ever tracks a path that
  // WAS a genuine regular file at confinement time, but cleanup can run
  // arbitrarily later. rmSync(..., {recursive:true}) would happily delete an
  // entire directory tree if something replaced the leaf in between; this
  // proves the fix skips it instead, belt-and-suspenders beyond confinement
  // itself.
  const dir = makeResultsDir();
  const trapPath = path.join(dir, 'bats-result.trap.env');
  fs.writeFileSync(trapPath, 'BATS_OK=1\n');
  const state = rbs.createRunState();
  state.completedHandoffPaths.push(trapPath);
  fs.unlinkSync(trapPath);
  fs.mkdirSync(trapPath);
  const precious = path.join(trapPath, 'precious.txt');
  fs.writeFileSync(precious, 'must survive');
  rbs.cleanupRunArtifacts(state);
  assert.equal(fs.existsSync(precious), true, 'a directory swapped in after tracking must never be recursively deleted');
});

// ── validateShardResult ─────────────────────────────────────────────────

const FROZEN_HEAD = 'a'.repeat(40);
const EXPECTED_LOG_PATH = '/fake/root/.androidcommondoc/suite-bats.shard0.stamp.log';

function baseHandoff(overrides) {
  return Object.assign({
    BATS_OK: '10', BATS_NOT_OK: '0', BATS_EXPECTED: '10', BATS_TOTAL: '10',
    BATS_COMPLETE: 'true', BATS_VERDICT: 'pass', BATS_HEAD: FROZEN_HEAD,
    BATS_RUN_ID: 'shard0-run', BATS_SCOPE: 'targeted', BATS_LOG: EXPECTED_LOG_PATH,
    BATS_TARGET_DIGEST: rbs.computeTargetDigest(['x.bats', 'y.bats']),
  }, overrides);
}

/** Every existing-behavior test below fixes frozenHead/expectedLogPath to the
 * SAME values baseHandoff() already reports, so they exercise exactly the
 * checks their own name describes -- adversarial cases for the NEW frozen-
 * head/log-path/count-coherence checks live in their own section further
 * down, each changing exactly one of these two inputs instead. */
function validate(handoff, expectedFiles, overrides) {
  return rbs.validateShardResult(Object.assign({
    handoff, expectedFiles, gitBin: 'git', frozenHead: FROZEN_HEAD, expectedLogPath: EXPECTED_LOG_PATH,
  }, overrides));
}

test('validateShardResult ok=true when the handoff is complete, count-consistent, and the digest matches', () => {
  const out = validate(baseHandoff(), ['x.bats', 'y.bats']);
  assert.deepEqual(out, { ok: true });
});

test('validateShardResult fails closed: missing handoff', () => {
  const out = validate(null, ['x.bats']);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'SHARD_HANDOFF_MISSING');
});

test('validateShardResult fails closed: an incomplete shard (BATS_COMPLETE=false)', () => {
  const out = validate(baseHandoff({ BATS_COMPLETE: 'false' }), ['x.bats', 'y.bats']);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'SHARD_INCOMPLETE');
});

test('validateShardResult fails closed: total/expected mismatch inside one shard', () => {
  const out = validate(baseHandoff({ BATS_TOTAL: '9' }), ['x.bats', 'y.bats']);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'SHARD_COUNT_MISMATCH');
});

test('validateShardResult fails closed: a shard that silently ran a DIFFERENT file set than assigned', () => {
  // This is the case that matters most: run-bats.sh exited 0 and produced a
  // perfectly well-formed, internally-consistent handoff -- but for the
  // wrong files. Only the digest cross-check catches it.
  const out = validate(baseHandoff(), ['x.bats', 'z.bats']);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'SHARD_FILE_SET_MISMATCH');
});

test('validateShardResult fails closed: a shard that ran a SUBSET of its assigned files (one silently dropped)', () => {
  const out = validate(baseHandoff(), ['x.bats', 'y.bats', 'z.bats']);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'SHARD_FILE_SET_MISMATCH');
});

// ── validateShardResult: adversarial hardening (independent audit findings) ──
// Every case here starts from a handoff that is otherwise perfectly
// well-formed (baseHandoff()) and mutates EXACTLY the one field the check
// under test is responsible for -- proving each gate fires on its own, not
// as a side effect of an earlier one already rejecting the same input.

test('validateShardResult fails closed: BATS_OK is not an integer at all', () => {
  const out = validate(baseHandoff({ BATS_OK: 'five' }), ['x.bats', 'y.bats']);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'SHARD_COUNTS_NOT_NONNEGATIVE_INTEGERS');
});

test('validateShardResult fails closed: BATS_NOT_OK is negative', () => {
  const out = validate(baseHandoff({ BATS_OK: '11', BATS_NOT_OK: '-1' }), ['x.bats', 'y.bats']);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'SHARD_COUNTS_NOT_NONNEGATIVE_INTEGERS');
});

test('validateShardResult fails closed: BATS_EXPECTED is a non-integer float', () => {
  const out = validate(baseHandoff({ BATS_EXPECTED: '10.5', BATS_TOTAL: '10.5' }), ['x.bats', 'y.bats']);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'SHARD_COUNTS_NOT_NONNEGATIVE_INTEGERS');
});

test('validateShardResult fails closed: OK + NOT_OK does not sum to TOTAL, even though TOTAL===EXPECTED', () => {
  // A shard could satisfy the pre-existing TOTAL===EXPECTED check while its
  // own OK/NOT_OK breakdown is simply arithmetically wrong -- a distinct,
  // previously-unchecked way for a handoff to lie about what actually ran.
  const out = validate(baseHandoff({ BATS_OK: '7', BATS_NOT_OK: '2', BATS_EXPECTED: '10', BATS_TOTAL: '10' }), ['x.bats', 'y.bats']);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'SHARD_OK_NOTOK_SUM_MISMATCH');
});

test('validateShardResult fails closed: BATS_VERDICT=pass declared despite a real failure', () => {
  const out = validate(baseHandoff({ BATS_OK: '9', BATS_NOT_OK: '1', BATS_VERDICT: 'pass' }), ['x.bats', 'y.bats']);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'SHARD_VERDICT_INCOHERENT');
});

test('validateShardResult fails closed: BATS_VERDICT=fail declared despite zero real failures', () => {
  const out = validate(baseHandoff({ BATS_VERDICT: 'fail' }), ['x.bats', 'y.bats']);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'SHARD_VERDICT_INCOHERENT');
});

test('validateShardResult fails closed: BATS_SCOPE=full on a per-shard handoff (only the aggregate may ever claim full)', () => {
  const out = validate(baseHandoff({ BATS_SCOPE: 'full' }), ['x.bats', 'y.bats']);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'SHARD_SCOPE_NOT_TARGETED');
});

test('validateShardResult fails closed: caller did not supply a frozen HEAD to compare against', () => {
  const out = rbs.validateShardResult({ handoff: baseHandoff(), expectedFiles: ['x.bats', 'y.bats'], gitBin: 'git', expectedLogPath: EXPECTED_LOG_PATH });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'SHARD_FROZEN_HEAD_REQUIRED');
});

test('validateShardResult fails closed: HEAD drifted mid-run (a commit landed between the freeze and this shard finishing)', () => {
  const out = validate(baseHandoff(), ['x.bats', 'y.bats'], { frozenHead: 'b'.repeat(40) });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'SHARD_HEAD_DRIFTED');
});

test('validateShardResult fails closed: caller did not supply the log path this shard was assigned', () => {
  const out = rbs.validateShardResult({ handoff: baseHandoff(), expectedFiles: ['x.bats', 'y.bats'], gitBin: 'git', frozenHead: FROZEN_HEAD });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'SHARD_EXPECTED_LOG_PATH_REQUIRED');
});

test('validateShardResult fails closed: BATS_LOG does not match the path this orchestrator itself assigned', () => {
  // A shard reporting a DIFFERENT log path than the one it was launched with
  // is exactly the shape of "handoff for a different, unrelated run" -- must
  // never be silently accepted just because every other field looks fine.
  const out = validate(baseHandoff(), ['x.bats', 'y.bats'], { expectedLogPath: '/fake/root/.androidcommondoc/suite-bats.shard1.stamp.log' });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'SHARD_LOG_PATH_MISMATCH');
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

// ── decideExitCode ───────────────────────────────────────────────────────
// The late-signal exit-code race (main()'s post-runPool tail and a signal
// handler are both single synchronous spans with no await between them, so
// either can run first) is deliberately NOT reproduced via real timing here
// -- that would be inherently flaky. This is the pure decision the real
// race resolves to, tested directly and deterministically instead.

test('decideExitCode: no signal received at all uses the verdict-based code', () => {
  assert.equal(rbs.decideExitCode({ shutdownSignal: null }, 'pass'), 0);
  assert.equal(rbs.decideExitCode({ shutdownSignal: null }, 'fail'), 1);
});

test('decideExitCode: a signal received so late that publication already fully succeeded still wins over the verdict', () => {
  assert.equal(rbs.decideExitCode({ shutdownSignal: 'SIGTERM' }, 'pass'), 143);
  assert.equal(rbs.decideExitCode({ shutdownSignal: 'SIGINT' }, 'pass'), 130);
  assert.equal(rbs.decideExitCode({ shutdownSignal: 'SIGHUP' }, 'fail'), 129);
});

// ── resolvePlatform / win32 preflight ────────────────────────────────────

test('resolvePlatform reports the real process.platform when no test override is set', () => {
  const prior = process.env.RUN_BATS_SHARDED_TEST_PLATFORM;
  delete process.env.RUN_BATS_SHARDED_TEST_PLATFORM;
  try {
    assert.equal(rbs.resolvePlatform(), process.platform);
  } finally {
    if (prior !== undefined) process.env.RUN_BATS_SHARDED_TEST_PLATFORM = prior;
  }
});

test('resolvePlatform honors the test override so win32 fail-closed is exercisable from any host', () => {
  const prior = process.env.RUN_BATS_SHARDED_TEST_PLATFORM;
  process.env.RUN_BATS_SHARDED_TEST_PLATFORM = 'win32';
  try {
    assert.equal(rbs.resolvePlatform(), 'win32');
  } finally {
    if (prior === undefined) delete process.env.RUN_BATS_SHARDED_TEST_PLATFORM;
    else process.env.RUN_BATS_SHARDED_TEST_PLATFORM = prior;
  }
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
