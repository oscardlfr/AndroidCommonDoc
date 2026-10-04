'use strict';

// A negative host-pin test must not inherit the test runner's signed Claude
// ancestor. Reuse the process isolation used by the diagnostic-hook suite.
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function runOrphanedSessionStart({ event, hookPath, projectRoot }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-diagnostic-orphan-'));
  try {
    const files = { input: path.join(dir, 'in.json'), out: path.join(dir, 'out'),
      err: path.join(dir, 'err'), status: path.join(dir, 'status') };
    fs.writeFileSync(files.input, JSON.stringify(event));
    const q = (value) => "'" + value.replace(/'/g, "'\\''") + "'";
    const launched = spawnSync('/bin/sh', ['-c', '( ' + q(process.execPath) + ' ' + q(hookPath)
      + ' < ' + q(files.input) + ' > ' + q(files.out) + ' 2> ' + q(files.err) + '; echo $? > ' + q(files.status)
      + ' ) > /dev/null 2>&1 &'], { cwd: projectRoot, env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot } });
    assert.strictEqual(launched.status, 0);
    const deadline = Date.now() + 25000;
    while (!fs.existsSync(files.status) || fs.readFileSync(files.status, 'utf8').trim() === '') {
      assert.ok(Date.now() < deadline, 'orphaned SessionStart hook did not finish');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
    return { status: Number(fs.readFileSync(files.status, 'utf8').trim()),
      stdout: fs.readFileSync(files.out, 'utf8'), stderr: fs.readFileSync(files.err, 'utf8') };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

module.exports = { runOrphanedSessionStart };
