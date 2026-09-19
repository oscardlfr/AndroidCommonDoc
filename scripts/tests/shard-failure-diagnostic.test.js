#!/usr/bin/env node
'use strict';

// SFD-* : unit tests for scripts/tests/lib/shard-failure-diagnostic.cjs.
//
// Uses a synthetic SHARD_INCOMPLETE scenario (a real handoff file and a real
// TAP log written to a temp dir, plus a spawnSync-shaped `result` object with
// the exact stderr format run-bats-sharded.cjs's main() actually produces --
// see its `throw new Error('shard ' + run.shard.index + ': ' + verdict.reason
// + ' (handoff=' + ... + ')')`) rather than a real, flaky end-to-end spawn --
// this suite must be deterministic, and the whole point of this helper is to
// work from exactly the terse text production already emits on stderr.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { buildShardFailureDiagnostic } = require('./lib/shard-failure-diagnostic.cjs');

const REQUIRED_MARKERS = [
  'head:', 'platform:', 'shard-id:', 'command:', 'cwd:',
  'exit code:', 'signal:', '--- child stdout ---', '--- child stderr ---',
  'expected handoff path:', 'handoff exists:', '--- handoff content ---',
  'expected=', 'ok=', 'not_ok=', 'total=', 'complete=', 'scope=', 'verdict=',
  'run-id:', 'tap/log path:', 'tap/log exists:', '--- tap/log tail',
  'known bats/run-bats processes still visible:',
  'validateShardResult reason:',
];

function makeSyntheticScenario() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfd-test-'));
  const handoffPath = path.join(tmp, 'bats-result.20260101T000000Z-1-2.env');
  const tapLogPath = path.join(tmp, 'suite-bats.shard0.20260101T000000Z.log');
  fs.writeFileSync(
    handoffPath,
    [
      'BATS_OK=0',
      'BATS_NOT_OK=0',
      'BATS_EXPECTED=1',
      'BATS_TOTAL=0',
      'BATS_COMPLETE=false',
      'BATS_VERDICT=fail',
      'BATS_LOG=' + tapLogPath,
      'BATS_HEAD=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      'BATS_RUN_ID=20260101T000000Z-1-2',
      'BATS_SCOPE=targeted',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(tapLogPath, '1..1\n# a truncated run, no ok/not-ok line ever appeared\n');
  const stderr = '[run-bats-sharded] launching 1 shard(s), max-parallel=1\n'
    + '[run-bats-sharded] FATAL: Error: shard 0: SHARD_INCOMPLETE (handoff=' + handoffPath + ')\n';
  return {
    tmp,
    handoffPath,
    tapLogPath,
    result: { status: 1, signal: null, stdout: '', stderr },
  };
}

test('SFD-RED empirical: the bare stderr text alone (today\'s only failure evidence) does not expose the handoff content, counts, or TAP tail', () => {
  const { result } = makeSyntheticScenario();
  const oldStyleMessage = 'expected a clean pass: ' + result.stderr;
  const missing = REQUIRED_MARKERS.filter((marker) => !oldStyleMessage.includes(marker));
  assert.ok(
    missing.length >= 15,
    'expected the bare stderr message to be missing most diagnostic markers, found only missing: ' + JSON.stringify(missing),
  );
});

test('SFD-01 buildShardFailureDiagnostic includes every required diagnostic field', () => {
  const { tmp, result } = makeSyntheticScenario();
  try {
    const command = ['node', 'run-bats-sharded.cjs', '--shard-count', '1'];
    const diagnostic = buildShardFailureDiagnostic({
      result, command, cwd: tmp, head: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    });
    const missing = REQUIRED_MARKERS.filter((marker) => !diagnostic.includes(marker));
    assert.deepEqual(missing, [], 'diagnostic is missing required field markers');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('SFD-02 surfaces the real handoff counts and TAP tail content, not just labels', () => {
  const { tmp, result } = makeSyntheticScenario();
  try {
    const diagnostic = buildShardFailureDiagnostic({
      result, command: ['node'], cwd: tmp, head: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    });
    assert.match(diagnostic, /expected=1 ok=0 not_ok=0 total=0 complete=false scope=targeted verdict=fail/);
    assert.match(diagnostic, /a truncated run, no ok\/not-ok line ever appeared/);
    assert.match(diagnostic, /validateShardResult reason: SHARD_INCOMPLETE/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('SFD-03 fails closed, not silently, when the handoff path cannot be found in stderr at all', () => {
  const diagnostic = buildShardFailureDiagnostic({
    result: { status: 1, signal: null, stdout: '', stderr: 'some unrelated crash with no handoff= mention' },
    command: ['node'],
    cwd: os.tmpdir(),
    head: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  });
  assert.match(diagnostic, /expected handoff path: \(not found in stderr\)/);
  assert.match(diagnostic, /run-id: \(unknown, no handoff path found\)/);
  assert.match(diagnostic, /validateShardResult reason: SHARD_HANDOFF_MISSING/);
});

test('SFD-04 never includes a raw environment dump', () => {
  const { tmp, result } = makeSyntheticScenario();
  try {
    const diagnostic = buildShardFailureDiagnostic({
      result, command: ['node'], cwd: tmp, head: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    });
    assert.ok(!diagnostic.includes('process.env'), 'diagnostic must never dump process.env');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
