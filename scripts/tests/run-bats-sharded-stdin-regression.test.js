#!/usr/bin/env node
'use strict';

// Regression test for a real, empirically-found hang: run-bats-sharded.cjs's
// spawn('bash', [...], { cwd: root }) left stdio[0] at Node's default (an
// open pipe this process never writes to or closes). write-verdict.sh:605
// -- `[[ -t 0 ]] || stdin_content="$(cat)"` -- is correct, ordinary behavior
// for a script that accepts optional piped content when stdin is not a
// terminal; but against an open, never-closed pipe that `cat` blocks
// forever waiting for an EOF that never arrives.
//
// Found live: a real 6-shard run over the full suite hung for over an hour
// on write-verdict.bats's V7 case. Diagnosed via `lsof` on the stuck PID
// (fd 0 was an unread unix socket, not /dev/null or a terminal) BEFORE
// assuming it was a concurrency defect in the test suite itself -- it
// wasn't; the identical test completed in under a second run alone. Fixed
// by setting stdio explicitly to ['ignore', 'pipe', 'pipe']. Reverting that
// one line reproduces the hang against this exact fixture (verified via an
// isolated mutation before this file was written), which is what makes this
// a real regression test rather than a check that cannot fail.
//
// A .bats fixture is used rather than a pure unit test because this is
// fundamentally an OS process/stdio behavior, not something the pure
// exported functions in run-bats-sharded.cjs (tested in
// run-bats-sharded.test.js) touch at all.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const TOOL = path.join(ROOT, 'scripts', 'tools', 'run-bats-sharded.cjs');

function cleanupHandoffs(before) {
  const dir = path.join(ROOT, '.androidcommondoc');
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if ((f.startsWith('bats-result.') || f.startsWith('suite-bats.')) && !before.has(f)) {
      fs.rmSync(path.join(dir, f), { force: true });
    }
  }
}

test('a shard containing a script that reads stdin like write-verdict.sh does not hang', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rbs-stdin-regression-'));
  try {
    fs.writeFileSync(path.join(tmp, 'stdin-reader.bats'), [
      '#!/usr/bin/env bats',
      '',
      '@test "reads stdin exactly like write-verdict.sh and must not hang" {',
      '  local content=""',
      '  if [[ -t 0 ]]; then',
      '    content=""',
      '  else',
      '    content="$(cat)"',
      '  fi',
      '  [ -z "$content" ]',
      '}',
      '',
    ].join('\n'));

    const dir = path.join(ROOT, '.androidcommondoc');
    const before = new Set(fs.existsSync(dir) ? fs.readdirSync(dir) : []);

    const start = Date.now();
    // A generous but finite timeout: this must complete in well under a
    // second in practice (confirmed empirically), so 20s only needs to be
    // "clearly not infinite", not tightly tuned -- a hang and a slow CI
    // runner must not be confused with each other.
    const result = spawnSync('node', [
      TOOL, '--project-root', ROOT, '--suite-root', tmp, '--shard-count', '1', '--max-parallel', '1',
    ], { cwd: ROOT, encoding: 'utf8', timeout: 20000 });
    const elapsedMs = Date.now() - start;

    cleanupHandoffs(before);

    assert.notEqual(result.signal, 'SIGTERM', 'the process was killed by the timeout -- it hung, exactly the regressed bug');
    assert.equal(result.status, 0, 'expected a clean pass: ' + result.stderr);
    assert.ok(elapsedMs < 15000, 'took ' + elapsedMs + 'ms -- suspiciously close to the timeout for a single trivial case; investigate before raising the bound');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
