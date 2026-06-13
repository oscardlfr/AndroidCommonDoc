#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const HOOK = path.resolve(__dirname, '../../.claude/hooks/context-provider-gate.js');

function runHook(payload, env = {}) {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const result = spawnSync('node', [HOOK], {
    input,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { exit: result.status, stdout: result.stdout, stderr: result.stderr };
}

function sanitize(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '-');
}

function sessionFlagPath(sessionId) {
  return path.join(os.tmpdir(), `claude-cp-consulted-${sessionId}.flag`);
}

function archResponseFlagPath(sessionId, agentType) {
  return path.join(os.tmpdir(), `claude-arch-responded-${sessionId}-${sanitize(agentType)}.flag`);
}

function writeSessionFlag(sessionId) {
  fs.writeFileSync(sessionFlagPath(sessionId), new Date().toISOString());
}

function clearSessionFlag(sessionId) {
  try { fs.unlinkSync(sessionFlagPath(sessionId)); } catch {}
}

function writeArchResponseFlag(sessionId, agentType) {
  fs.writeFileSync(archResponseFlagPath(sessionId, agentType), new Date().toISOString());
}

function clearArchResponseFlag(sessionId, agentType) {
  try { fs.unlinkSync(archResponseFlagPath(sessionId, agentType)); } catch {}
}

function writeJsonSessionFlag(sessionId, payload) {
  fs.writeFileSync(sessionFlagPath(sessionId), JSON.stringify(payload));
}

// F1: Grep on docs path, arch-platform, no flag → BLOCK (exit 2)
clearSessionFlag('s1');
const f1 = runHook({
  tool_name: 'Grep',
  tool_input: { pattern: 'test', path: '/project/docs/di/di-patterns-modules.md' },
  session_id: 's1',
  agent_type: 'arch-platform',
  agent_id: 'arch-platform'
});
assert.strictEqual(f1.exit, 2, 'F1: should block');
assert.ok(
  f1.stdout.includes('"decision":"block"') || f1.stdout.includes('"decision": "block"'),
  'F1: block decision in stdout'
);
console.log('F1 Grep no-flag block: PASS');

// F2: Grep on docs path, arch-platform, session flag exists → ALLOW (exit 0)
writeSessionFlag('s2');
const f2 = runHook({
  tool_name: 'Grep',
  tool_input: { pattern: 'test', path: '/project/docs/di/di-patterns-modules.md' },
  session_id: 's2',
  agent_type: 'arch-platform',
  agent_id: 'arch-platform'
});
assert.strictEqual(f2.exit, 0, 'F2: should allow when session flag exists');
clearSessionFlag('s2');
console.log('F2 Grep with session flag allow: PASS');

// F3: Grep, context-provider agent_type, no flag → ALLOW (exempt via agent_type)
clearSessionFlag('s3');
const f3 = runHook({
  tool_name: 'Grep',
  tool_input: { pattern: 'test' },
  session_id: 's3',
  agent_type: 'context-provider',
  agent_id: 'context-provider'
});
assert.strictEqual(f3.exit, 0, 'F3: context-provider exempt');
console.log('F3 context-provider exempt: PASS');

// F4: Grep, team-lead agent_type, no flag → ALLOW (exempt via agent_type)
clearSessionFlag('s4');
const f4 = runHook({
  tool_name: 'Grep',
  tool_input: { pattern: 'test' },
  session_id: 's4',
  agent_type: 'team-lead',
  agent_id: 'team-lead'
});
assert.strictEqual(f4.exit, 0, 'F4: team-lead exempt');
console.log('F4 team-lead exempt: PASS');

// F5: Bash with ./gradlew build, arch-platform, no flag → ALLOW (non-search bash)
// agent_type required: L5 made empty agent_type = main-exempt; arch-platform is a peer.
clearSessionFlag('s5');
const f5 = runHook({
  tool_name: 'Bash',
  tool_input: { command: './gradlew build' },
  session_id: 's5',
  agent_type: 'arch-platform',
  agent_id: 'arch-platform'
});
assert.strictEqual(f5.exit, 0, 'F5: non-search bash should allow');
console.log('F5 non-search Bash allow: PASS');

// F6: Bash with grep, arch-platform, no flag → BLOCK
// agent_type required: L5 made empty agent_type = main-exempt (exit 0); peer must carry
// agent_type so the gate sees a non-exempt identity and blocks (exit 2).
clearSessionFlag('s6');
const f6 = runHook({
  tool_name: 'Bash',
  tool_input: { command: 'grep -r libs.lifecycle .' },
  session_id: 's6',
  agent_type: 'arch-platform',
  agent_id: 'arch-platform'
});
assert.strictEqual(f6.exit, 2, 'F6: search bash should block');
console.log('F6 search Bash block: PASS');

// F7: Invalid JSON → ALLOW (fail open, exit 0)
const f7 = runHook('not valid json');
assert.strictEqual(f7.exit, 0, 'F7: invalid JSON must fail open');
console.log('F7 invalid JSON fail-open: PASS');

// F8: context-provider-2 agent_type suffix → ALLOW (exempt via agent_type prefix match)
clearSessionFlag('s8');
const f8 = runHook({
  tool_name: 'Grep',
  tool_input: { pattern: 'test' },
  session_id: 's8',
  agent_type: 'context-provider-2',
  agent_id: 'context-provider-2'
});
assert.strictEqual(f8.exit, 0, 'F8: context-provider-2 suffix exempt');
console.log('F8 context-provider-2 suffix exempt: PASS');

// F9: BL-W35-06 -- specialist blocked when only session CP flag set (no arch-response flag)
writeSessionFlag('s9');
clearArchResponseFlag('s9', 'test-specialist');
const f9 = runHook({
  tool_name: 'Grep',
  tool_input: { pattern: 'test', path: '/project/docs/di/di-patterns-modules.md' },
  session_id: 's9',
  agent_type: 'test-specialist',
  agent_id: 'test-specialist'
});
assert.strictEqual(f9.exit, 2, 'F9 BL-W35-06: specialist blocked when only session CP flag set');
clearSessionFlag('s9');
console.log('F9 specialist blocked without arch-response flag (BL-W35-06): PASS');

// F10: BL-W35-06 -- specialist allowed when arch-response flag set
writeArchResponseFlag('s10', 'test-specialist');
const f10 = runHook({
  tool_name: 'Grep',
  tool_input: { pattern: 'test', path: '/project/docs/di/di-patterns-modules.md' },
  session_id: 's10',
  agent_type: 'test-specialist',
  agent_id: 'test-specialist'
});
assert.strictEqual(f10.exit, 0, 'F10 BL-W35-06: specialist allowed when arch-response flag set');
clearArchResponseFlag('s10', 'test-specialist');
console.log('F10 specialist allowed with arch-response flag (BL-W35-06): PASS');

// F11: BL-W35-06 -- arch-response flag with hyphen in agent_type passes sanitize() correctly
const specialistWithHyphen = 'data-layer-specialist';
writeArchResponseFlag('s11', specialistWithHyphen);
const f11 = runHook({
  tool_name: 'Grep',
  tool_input: { pattern: 'x', path: '/project/docs/di/di-patterns-modules.md' },
  session_id: 's11',
  agent_type: specialistWithHyphen,
  agent_id: specialistWithHyphen
});
assert.strictEqual(f11.exit, 0, 'F11: hyphenated specialist agent_type matches arch-response flag path');
clearArchResponseFlag('s11', specialistWithHyphen);
console.log('F11 arch-response flag with hyphenated agent_type (BL-W35-06): PASS');

// F12: NEW — block reason does not reference hardcoded context-provider-2
// agent_type required: L5 made empty agent_type = main-exempt (exit 0); peer needs agent_type.
clearSessionFlag('s12');
const f12 = runHook({
  tool_name: 'Grep',
  tool_input: { pattern: 'x', path: '/project/docs/di/di-patterns-modules.md' },
  session_id: 's12',
  agent_type: 'arch-platform',
  agent_id: 'arch-platform'
});
assert.strictEqual(f12.exit, 2, 'F12: blocked');
assert.ok(!f12.stdout.includes('context-provider-2'), 'F12: reason must not hardcode context-provider-2 suffix');
assert.ok(f12.stdout.includes('context-provider'), 'F12: reason references context-provider generally');
console.log('F12 block reason generic (no hardcoded -2): PASS');

// F13: JSON-format flag → gate exits 0 and emits [CP-GATE] audit log
const sid13 = 's13-json';
clearSessionFlag(sid13);
writeJsonSessionFlag(sid13, {
  written_by: 'context-provider-consulted',
  agent_id: 'arch-platform-abc',
  session_id: sid13,
  ts: new Date().toISOString()
});
const f13 = runHook({
  tool_name: 'Grep',
  tool_input: { pattern: 'test', path: '/project/docs/di/di-patterns-modules.md' },
  session_id: sid13,
  agent_type: 'arch-platform',
  agent_id: 'arch-platform-abc'
});
assert.strictEqual(f13.exit, 0, 'F13: gate must exit 0 when JSON-format flag exists');
assert.ok(f13.stderr.includes('[CP-GATE]'), 'F13: stderr must contain [CP-GATE]');
assert.ok(f13.stderr.includes('session='), 'F13: stderr must contain session=');
assert.ok(f13.stderr.includes('flag_writer='), 'F13: stderr must contain flag_writer=');
assert.ok(f13.stderr.includes('flag_ts='), 'F13: stderr must contain flag_ts=');
assert.ok(f13.stderr.includes('tool='), 'F13: stderr must contain tool=');
clearSessionFlag(sid13);
console.log('F13 JSON-format flag gate exits 0 + [CP-GATE] stderr audit: PASS');

// F14: Legacy bare ISO string flag → gate STILL exits 0 (try/catch swallows JSON parse failure)
const sid14 = 's14-legacy';
clearSessionFlag(sid14);
writeSessionFlag(sid14);
const f14 = runHook({
  tool_name: 'Grep',
  tool_input: { pattern: 'test', path: '/project/docs/di/di-patterns-modules.md' },
  session_id: sid14,
  agent_type: 'arch-platform',
  agent_id: 'arch-platform'
});
assert.strictEqual(f14.exit, 0, 'F14: legacy ISO-string flag must still allow (JSON parse failure swallowed)');
clearSessionFlag(sid14);
console.log('F14 legacy ISO-string flag still exits 0 (legacy compat): PASS');

// CR2-A: Grep with bare 'docs' path (no leading slash) — BLOCK (CR-2 / 599548f)
clearSessionFlag('scr2a');
const fcr2a = runHook({
  tool_name: 'Grep',
  tool_input: { pattern: 'test', path: 'docs' },
  session_id: 'scr2a',
  agent_type: 'arch-platform',
  agent_id: 'arch-platform'
});
assert.strictEqual(fcr2a.exit, 2, 'CR2-A: Grep with bare docs path should block');
console.log('CR2-A Grep bare docs path blocks: PASS');

// CR2-B: Grep with 'docs/guides/foo.md' (no leading slash) — BLOCK
clearSessionFlag('scr2b');
const fcr2b = runHook({
  tool_name: 'Grep',
  tool_input: { pattern: 'test', path: 'docs/guides/foo.md' },
  session_id: 'scr2b',
  agent_type: 'arch-platform',
  agent_id: 'arch-platform'
});
assert.strictEqual(fcr2b.exit, 2, 'CR2-B: Grep with docs/guides path should block');
console.log('CR2-B Grep docs/guides path blocks: PASS');

// CR2-C: Read with repo-relative 'docs/guides/foo.md' (no leading sep), arch-platform, no flag → BLOCK
// Codex repro: the Read leg's isSelfTemplatePath/isPatternDiscovery regexes required
// a leading separator before 'docs', so 'docs/guides/foo.md' bypassed the gate.
clearSessionFlag('scr2c');
const fcr2c = runHook({
  tool_name: 'Read',
  tool_input: { file_path: 'docs/guides/foo.md' },
  session_id: 'scr2c',
  agent_type: 'arch-platform',
  agent_id: 'arch-platform'
});
assert.strictEqual(fcr2c.exit, 2, 'CR2-C: Read with repo-relative docs/guides path should block');
assert.ok(
  fcr2c.stdout.includes('"decision":"block"') || fcr2c.stdout.includes('"decision": "block"'),
  'CR2-C: block decision in stdout'
);
console.log('CR2-C Read repo-relative docs/guides path blocks: PASS');

// CR2-D: Read 'setup/agent-templates/foo.md' (no leading sep), arch-platform, no flag → BLOCK
clearSessionFlag('scr2d');
const fcr2d = runHook({
  tool_name: 'Read',
  tool_input: { file_path: 'setup/agent-templates/foo.md' },
  session_id: 'scr2d',
  agent_type: 'arch-platform',
  agent_id: 'arch-platform'
});
assert.strictEqual(fcr2d.exit, 2, 'CR2-D: Read with repo-relative setup/agent-templates path should block');
assert.ok(
  fcr2d.stdout.includes('"decision":"block"') || fcr2d.stdout.includes('"decision": "block"'),
  'CR2-D: block decision in stdout'
);
console.log('CR2-D Read repo-relative setup/agent-templates path blocks: PASS');

// CR2-E: Read '.claude/agents/foo.md' (no leading sep), arch-platform, no flag → BLOCK
clearSessionFlag('scr2e');
const fcr2e = runHook({
  tool_name: 'Read',
  tool_input: { file_path: '.claude/agents/foo.md' },
  session_id: 'scr2e',
  agent_type: 'arch-platform',
  agent_id: 'arch-platform'
});
assert.strictEqual(fcr2e.exit, 2, 'CR2-E: Read with repo-relative .claude/agents path should block');
assert.ok(
  fcr2e.stdout.includes('"decision":"block"') || fcr2e.stdout.includes('"decision": "block"'),
  'CR2-E: block decision in stdout'
);
console.log('CR2-E Read repo-relative .claude/agents path blocks: PASS');

// CR2-F: isSelfTemplatePath — Read 'setup/agent-templates/foo.md', test-specialist → C2 BLOCK
// C2 block fires regardless of session/arch-response flag (belt-and-suspenders).
clearSessionFlag('scr2f');
// Write arch-response flag so the isPatternDiscovery path would allow — C2 must STILL block.
writeArchResponseFlag('scr2f', 'test-specialist');
const fcr2f = runHook({
  tool_name: 'Read',
  tool_input: { file_path: 'setup/agent-templates/foo.md' },
  session_id: 'scr2f',
  agent_type: 'test-specialist',
  agent_id: 'test-specialist'
});
clearArchResponseFlag('scr2f', 'test-specialist');
assert.strictEqual(fcr2f.exit, 2, 'CR2-F: isSelfTemplatePath must block test-specialist regardless of flag');
assert.ok(
  fcr2f.stdout.includes('"decision":"block"') || fcr2f.stdout.includes('"decision": "block"'),
  'CR2-F: block decision in stdout'
);
// C2 block reason mentions the C2 code
assert.ok(fcr2f.stdout.includes('C2'), 'CR2-F: C2 block reason cited in stdout');
console.log('CR2-F isSelfTemplatePath C2 block for test-specialist (regardless of flag): PASS');

// CR2-G: positive control — Read 'docs/guides/foo.md', arch-platform, session flag set → ALLOW
// After the fix, a CP-consulted peer with the session flag must be allowed (no over-block).
const sid_cr2g = 'scr2g';
writeSessionFlag(sid_cr2g);
const fcr2g = runHook({
  tool_name: 'Read',
  tool_input: { file_path: 'docs/guides/foo.md' },
  session_id: sid_cr2g,
  agent_type: 'arch-platform',
  agent_id: 'arch-platform'
});
clearSessionFlag(sid_cr2g);
assert.strictEqual(fcr2g.exit, 0, 'CR2-G: Read docs path with session flag must be allowed');
console.log('CR2-G Read docs path with session flag allows (positive control): PASS');

console.log('\nAll context-provider-gate tests passed.');
