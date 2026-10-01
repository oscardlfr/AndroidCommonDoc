'use strict';

// A target subcommand chained with other shell work never receives an injected grant, so the CLI rejected it with an
// opaque AUTHORITY_INVALID. The gate denies the recognisable chained form with the recovery; the canonical single
// command and unrelated chained commands stay untouched.

const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const hook = path.resolve(__dirname, '..', '..', '.claude', 'hooks', 'runtime-consultation-target-gate.js');
const cli = path.resolve(__dirname, '..', '..', 'scripts', 'lib', 'runtime-consultation.cjs');

function run(command) {
  const result = spawnSync(process.execPath, [hook], {
    encoding: 'utf8',
    cwd: os.tmpdir(),
    env: { ...process.env, CLAUDE_PROJECT_DIR: os.tmpdir() },
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', session_id: 's', agent_id: 'a', agent_type: 'context-provider', tool_input: { command } }),
  });
  assert.strictEqual(result.status, 0, result.stderr);
  return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput : null;
}

const RECOVERY = /\[RC-TARGET-GATE\] run publish-result as ONE standalone command \(no heredoc, pipe, &&, ;, \$\(\.\.\.\)\)/;

test('chained target subcommands are denied with the standalone recovery', () => {
  const forms = [
    `cat > /tmp/f <<'EOF'\nresult\nEOF\nnode ${cli} publish-result --request x`,
    `echo hi | base64 && node ${cli} publish-result --request x`,
    `node ${cli} publish-result --request x; echo done`,
    `node ${cli} publish-result --content "$(cat /tmp/f)"`,
    `cat > f <<'EOF'\nresult\nEOF\n'node' '${cli}' 'publish-result' '--claim' 'K' '--content' "$(base64 f)"`,
    `cat > f <<'EOF'\nresult\nEOF\n"node" "${cli}" "publish-result" "--claim" "K" "--content" "$(base64 f)"`,
    `cat > f <<'EOF'\nresult\nEOF\nnode ${cli} publish-result --claim K --content "$(base64 f)"`,
  ];
  for (const form of forms) {
    const out = run(form);
    assert.ok(out, form);
    assert.strictEqual(out.permissionDecision, 'deny', form);
    assert.match(out.permissionDecisionReason, RECOVERY, form);
  }
});

test('every target subcommand is named in its own denial', () => {
  for (const sub of ['claim', 'lease-heartbeat', 'publish-result', 'worker-stop-ack']) {
    const out = run(`echo x && node ${cli} ${sub} --request x`);
    assert.strictEqual(out.permissionDecision, 'deny', sub);
    assert.ok(out.permissionDecisionReason.includes('run ' + sub + ' as ONE standalone command'), sub);
  }
});

test('the canonical single command and unrelated chained commands are not denied here', () => {
  const single = run(`node ${cli} publish-result --request x`);
  assert.ok(single === null || !RECOVERY.test(single.permissionDecisionReason || ''));
  assert.strictEqual(run('echo hi && ls'), null);
  assert.strictEqual(run(`echo ${cli} && ls`), null);
  assert.strictEqual(run(`node ${cli} consult --question q && ls`), null);
});
