'use strict';

// The orchestrator's PREP recipe for an L1/L2 consumer is documented with exact launcher forms. This test runs those
// forms against a qualified consumer whose toolkit is a different directory, and pins that the doc carries them.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { installConsumerFixture } = require('./lib/consumer-runtime-fixture.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const DOC = fs.readFileSync(path.join(repoRoot, 'docs', 'agents', 'tl-session-start.md'), 'utf8');
const LAUNCHER = 'node .claude/runtime/l0-toolkit-launcher.cjs run';

function launcher(fixture, op, args) {
  return spawnSync(process.execPath, [fixture.launcher, 'run', op, '--project-root', fixture.consumerRoot, '--', ...args], {
    cwd: fixture.consumerRoot, encoding: 'utf8',
  });
}

function wave(fixture, slug) {
  const git = (...a) => assert.strictEqual(spawnSync('git', a, { cwd: fixture.consumerRoot, encoding: 'utf8' }).status, 0, a.join(' '));
  const dir = path.join(fixture.consumerRoot, '.planning', 'wave-' + slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'PLAN.md'), '### Wave Class\n\n- **Class**: HARNESS\n\n### Path-Manifest\n\n- x\n');
  fs.writeFileSync(path.join(dir, 'CLASS'), 'HARNESS\n');
  git('switch', '-q', '-c', 'feature/' + slug);
  git('add', '-A');
  git('-c', 'user.email=t@t.local', '-c', 'user.name=T', 'commit', '-q', '-m', 'wave fixture');
  return dir;
}

for (const layer of ['L1', 'L2']) test(`the documented standalone PREP recipe publishes request-bound verdicts in ${layer} with a distinct toolkit`, () => {
  const fixture = installConsumerFixture(layer);
  try {
    assert.notStrictEqual(fixture.consumerRoot, fixture.toolkitRoot);
    const dir = wave(fixture, 'prep-recipe');
    const init = launcher(fixture, 'wave-control', ['init', '--slug', 'prep-recipe']);
    assert.strictEqual(init.status, 0, init.stdout + init.stderr);
    for (const role of ['arch-platform', 'arch-testing', 'arch-integration']) {
      const made = launcher(fixture, 'verdict-request-write', ['--role', role, '--phase', 'prep', '--slug', 'prep-recipe']);
      assert.strictEqual(made.status, 0, role + ': ' + made.stdout + made.stderr);
      const line = made.stdout.trim();
      const requestPath = line.slice(0, line.lastIndexOf(' '));
      const digest = line.slice(line.lastIndexOf(' ') + 1);
      assert.match(digest, /^[0-9a-f]{64}$/);
      assert.ok(requestPath.startsWith(dir + path.sep) && fs.existsSync(requestPath), 'the request lives under the consumer wave: ' + requestPath);
      // Exercise the same standalone launcher argv shown to the architect,
      // without stdin, including the cwd-relative CLI variant of a request.
      const published = launcher(fixture, 'verdict-write', [
        '--role', role, '--phase', 'prep', '--slug', 'prep-recipe',
        '--request', role === 'arch-testing' ? path.relative(fixture.consumerRoot, requestPath) : requestPath,
        '--request-sha256', digest, '--decision', 'approve', '--rationale', 'Reviewed the canonical plan',
      ]);
      assert.strictEqual(published.status, 0, role + ': ' + published.stdout + published.stderr);
      const verdict = JSON.parse(fs.readFileSync(path.join(dir, role + '-verdict-prep.json'), 'utf8'));
      assert.strictEqual(verdict.rationale, 'Reviewed the canonical plan');
      assert.strictEqual(verdict.request_ref.path, 'verdict-requests/' + path.basename(requestPath));
      assert.strictEqual(verdict.request_ref.sha256, digest);
    }
    const refused = launcher(fixture, 'verdict-request-write', ['--role', 'toolkit-specialist', '--phase', 'prep', '--slug', 'prep-recipe']);
    assert.notStrictEqual(refused.status, 0, 'only arch-* roles get a request');
  } finally {
    fs.rmSync(fixture.consumerRoot, { recursive: true, force: true });
  }
});

test('tl-session-start documents the exact consumer launcher forms from PREP to COMPLETE in order', () => {
  const forms = [
    `${LAUNCHER} wave-control --project-root "$PWD" -- init --slug <slug>`,
    `${LAUNCHER} verdict-request-write --project-root "$PWD" -- --role <arch-*> --phase prep --slug <slug>`,
    `${LAUNCHER} verdict-write --project-root "$PWD" --`,
    `${LAUNCHER} wave-control --project-root "$PWD" -- transition --slug <slug> --to EXECUTE --expected-revision <revision> --verdict <arch-*>=<verdict-path>`,
    `${LAUNCHER} wave-control --project-root "$PWD" -- preverify --slug <slug> --expected-revision <revision>`,
    `${LAUNCHER} wave-control --project-root "$PWD" -- transition --slug <slug> --to VERIFY_FINAL --expected-revision <revision> --rebind-head true --preverify-receipt <path-from-preverify>`,
    `${LAUNCHER} verdict-request-write --project-root "$PWD" -- --role <arch-*> --phase verify-final --slug <slug>`,
    '--phase verify-final --slug <slug> --request <absolute-request-path> --request-sha256 <sha256> --decision approve --rationale "<concise rationale>" --evidence-text "<concise evidence>" --evidence-file <absolute-preverify-receipt>',
    `${LAUNCHER} wave-control --project-root "$PWD" -- transition --slug <slug> --to QG --expected-revision <revision> --verdict <arch-*>=<verdict-path>`,
    `${LAUNCHER} runtime-consumer-qg --project-root "$PWD" -- pre-pr --slug <slug> --expected-revision <revision> --project-gate PASS|FAIL`,
    `${LAUNCHER} runtime-consumer-qg --project-root "$PWD" -- mint --slug <slug> --qg-attempt <PASS-attempt-path>`,
    `${LAUNCHER} runtime-consumer-qg --project-root "$PWD" -- verify --slug <slug>`,
    `${LAUNCHER} wave-control --project-root "$PWD" -- transition --slug <slug> --to COMPLETE --expected-revision <revision> --qg-attempt <PASS-attempt-path>`,
  ];
  let cursor = -1;
  for (const form of forms) {
    const at = DOC.indexOf(form);
    assert.ok(at > cursor, 'missing or out of order: ' + form);
    cursor = at;
  }
});
