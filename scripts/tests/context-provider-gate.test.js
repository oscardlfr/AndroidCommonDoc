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

// ════════════════════════════════════════════════════════════════════════
// Wave 2 (portable-coordination-artifacts): disk-consult unblock mirror.
// Primary A-N adversarial-matrix home is cp-gate-read-blocker.bats (native
// stdin->exit-status idiom); these DC* cases exist because this file asserts
// stdout JSON + stderr [CP-GATE] CONTENT and would otherwise silently miss
// the new branch (see PLAN.md Planner Verification Note #2). Isolation
// mirrors the bats fixture: mktemp + throwaway git init, CLAUDE_PROJECT_DIR
// + CLAUDE_WAVE_SLUG always explicit — never touches the live repo tree.
//
// CONFIRMED against the landed context-provider-gate.js diff: the disk-consult
// branch (diskConsultUnblocks()) emits its OWN [CP-GATE] audit line on success
// only — `flag_writer=disk-consult wave_slug=<slug>` (distinct sentinel from
// the flag-based path's `flag_writer=<meta.written_by>`) — asserted in DC1
// below. On the BLOCK side there is no new/distinct reason string: a failed
// diskConsultUnblocks() falls through to the SAME pre-existing generic block
// message ("No agent in this session has consulted context-provider yet...").
// DC2-DC4 therefore assert decision:"block" + a non-empty reason structurally
// (there is nothing more specific to mirror) rather than hardcoding that
// unchanged generic string, which would just duplicate F1/F9's own assertions.
// ════════════════════════════════════════════════════════════════════════

const DC_WAVE_SLUG = 'cp-gate-consult-wave';

function makeTempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-gate-dc-proj-'));
  const opts = { cwd: dir, encoding: 'utf8' };
  spawnSync('git', ['init', '-q'], opts);
  spawnSync('git', ['config', 'user.email', 'bats@test.local'], opts);
  spawnSync('git', ['config', 'user.name', 'Bats Test'], opts);
  spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], opts);
  // Deterministic protected default branch, regardless of the host's
  // init.defaultBranch config — DC4's "no wave" control needs this fixed.
  spawnSync('git', ['branch', '-m', 'main'], opts);
  return dir;
}

function consultDir(projDir, slug) {
  return path.join(projDir, '.planning', `wave-${slug}`, 'inbox', 'context-provider');
}

function nowIso() { return new Date().toISOString(); }
function nowCompact() { return nowIso().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); }
function hoursAgoIso(n) { return new Date(Date.now() - n * 3600 * 1000).toISOString(); }

function writeConsult(dir, fname, waveSlug, to, createdAt) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fname), JSON.stringify({
    schema: 'coordination/consult/v1',
    wave_slug: waveSlug,
    from: 'test-specialist',
    to,
    created_at: createdAt,
  }));
}

function runHookInProject(projDir, extraEnv) {
  return runHook(
    {
      tool_name: 'Grep',
      tool_input: { pattern: 'test', path: '/project/docs/di/di-patterns-modules.md' },
      session_id: 'dc-' + Math.random().toString(36).slice(2),
      agent_type: 'arch-platform',
      agent_id: 'arch-platform',
    },
    { CLAUDE_PROJECT_DIR: projDir, CLAUDE_WAVE_SLUG: '', ...extraEnv }
  );
}

// DC1: valid fresh consult-*.json, correct wave + correct `to` -> ALLOW (NEW disk unblock)
{
  const proj = makeTempProject();
  writeConsult(consultDir(proj, DC_WAVE_SLUG), `consult-${nowCompact()}.json`, DC_WAVE_SLUG, 'context-provider', nowIso());
  const dc1 = runHookInProject(proj, { CLAUDE_WAVE_SLUG: DC_WAVE_SLUG });
  assert.strictEqual(dc1.exit, 0, 'DC1: valid fresh disk consult must unblock (exit 0)');
  assert.ok(dc1.stderr.includes('[CP-GATE]'), 'DC1: stderr must contain [CP-GATE]');
  assert.ok(dc1.stderr.includes('flag_writer=disk-consult'), 'DC1: stderr must attribute the unblock to disk-consult (distinct sentinel from flag-based flag_writer=<meta.written_by>)');
  assert.ok(dc1.stderr.includes(`wave_slug=${DC_WAVE_SLUG}`), 'DC1: stderr must log the wave_slug that unblocked');
  fs.rmSync(proj, { recursive: true, force: true });
  console.log('DC1 disk-consult unblock (valid fresh consult -> allow, [CP-GATE] audit confirmed): PASS');
}

// DC2: stale consult (created_at beyond CONSULT_TTL_SECONDS) -> BLOCK (fail-closed)
{
  const proj = makeTempProject();
  writeConsult(consultDir(proj, DC_WAVE_SLUG), `consult-${nowCompact()}.json`, DC_WAVE_SLUG, 'context-provider', hoursAgoIso(13));
  const dc2 = runHookInProject(proj, { CLAUDE_WAVE_SLUG: DC_WAVE_SLUG });
  assert.strictEqual(dc2.exit, 2, 'DC2: stale disk consult must block (exit 2, fail-closed)');
  const dc2Body = JSON.parse(dc2.stdout);
  assert.strictEqual(dc2Body.decision, 'block', 'DC2: decision must be block');
  assert.ok(typeof dc2Body.reason === 'string' && dc2Body.reason.length > 0, 'DC2: reason must be a non-empty string');
  fs.rmSync(proj, { recursive: true, force: true });
  console.log('DC2 disk-consult fail-closed (stale created_at -> block): PASS');
}

// DC3: wrong wave_slug -> BLOCK (fail-closed)
{
  const proj = makeTempProject();
  writeConsult(consultDir(proj, DC_WAVE_SLUG), `consult-${nowCompact()}.json`, 'some-other-wave', 'context-provider', nowIso());
  const dc3 = runHookInProject(proj, { CLAUDE_WAVE_SLUG: DC_WAVE_SLUG });
  assert.strictEqual(dc3.exit, 2, 'DC3: wrong-wave disk consult must block (exit 2, fail-closed)');
  const dc3Body = JSON.parse(dc3.stdout);
  assert.strictEqual(dc3Body.decision, 'block', 'DC3: decision must be block');
  fs.rmSync(proj, { recursive: true, force: true });
  console.log('DC3 disk-consult fail-closed (wrong wave_slug -> block): PASS');
}

// DC4: unresolvable/null wave slug (no env override, protected branch, no wave dir) -> BLOCK, not fail-open
// Distinct code path from DC3: DC3 is "slug resolves but mismatches"; DC4 is
// "slug does not resolve at all" (getWaveSlug returns null).
{
  const proj = makeTempProject();
  const dc4 = runHookInProject(proj, { CLAUDE_WAVE_SLUG: '' });
  assert.strictEqual(dc4.exit, 2, 'DC4: null/unresolvable wave slug must block (exit 2), never fail open');
  const dc4Body = JSON.parse(dc4.stdout);
  assert.strictEqual(dc4Body.decision, 'block', 'DC4: decision must be block');
  fs.rmSync(proj, { recursive: true, force: true });
  console.log('DC4 null-slug fail-closed (unresolvable wave -> block, distinct from DC3): PASS');
}

console.log('\nAll context-provider-gate tests passed.');
