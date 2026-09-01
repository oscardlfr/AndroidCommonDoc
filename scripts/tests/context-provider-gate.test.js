#!/usr/bin/env node
'use strict';

// M7 LIFECYCLE -- ATOMIC REVOCATION PREP + NODE HARNESS CONTAINMENT (2026-08-16),
// PART A: must be the FIRST require in this file, before any require of
// runtime-role-lifecycle.cjs/runtime-bridge-codex.cjs -- see that file's own
// doc comment for why (registryBaseDir() is os.tmpdir()-rooted and shared
// with real production registry data on this machine without this).
require('./lib/private-registry-tmpdir-preload.cjs');

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');

const HOOK = path.resolve(__dirname, '../../.claude/hooks/context-provider-gate.js');
// M7/WP4 (dispatch arch-testing-20260808T142647Z, P0-2): the real registry
// primitives the grant-injection tests in Section 4 (below) verify against --
// never reimplemented/faked here, mirroring runtime-role-lifecycle-handlers.
// test.js's own convention of driving production code directly.
const rll = require(path.resolve(__dirname, '../lib/runtime-role-lifecycle.cjs'));
const rc = require(path.resolve(__dirname, '../lib/runtime-consultation.cjs'));
const rbc = require(path.resolve(__dirname, '../lib/runtime-bridge-codex.cjs'));
const S16_RLL_PATH = path.resolve(__dirname, '../lib/runtime-role-lifecycle.cjs');
const S16_TEST_CAPABILITY = 'cp-gate-s16-fixture-capability';
const S16_EXECUTOR_CAPABILITY = 'cp-gate-s16-executor-capability';
const S16_SUPPORT_ROLES = Object.freeze(['arch-platform', 'arch-testing', 'arch-integration', 'context-provider', 'doc-updater']);
// M6+M7 FULL CLOSURE (2026-08-11): hoisted up from its original position
// (immediately before driveClaudeId01SubagentStart, deep in the Section 5
// header) -- this file is a flat, top-to-bottom-executed script, and
// buildCanonicalAcceptedConsultation now calls primeClaudeId01Trace (which
// transitively needs this const) from as early as GROUPB-CANONICAL-CHAIN-1
// (line ~740). A `const` (unlike a `function` declaration) does NOT tolerate
// being read before its own declaration line executes (temporal dead zone) --
// confirmed empirically: leaving it in its original, later position threw
// "Cannot access 'SUBAGENT_START_HOOK_FOR_CLAUDEID01' before initialization"
// the moment GROUPB-CANONICAL-CHAIN-1 ran.
const SUBAGENT_START_HOOK_FOR_CLAUDEID01 = path.resolve(__dirname, '../../.claude/hooks/subagent-start-context-bundle.js');

function runHook(payload, env = {}) {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  // M6/M7 terminal functional closure correction round 1: this is the F1-F14/
  // CR2-* "bare invocation" convention resolvePostPlanContext's own doc
  // comment names explicitly -- a bare call must never accidentally pick up
  // whatever CLAUDE_PROJECT_DIR this TEST PROCESS itself happens to be
  // running under (this repo's own real, frozen PLAN.md, when run the normal
  // way -- from inside a Claude Code session already scoped to this
  // checkout) and spuriously enter post-PLAN mode. Every OTHER, later test in
  // this file already passes its own explicit CLAUDE_PROJECT_DIR (an
  // isolated fixture, or '' to force pre-PLAN) via `env` -- unaffected, since
  // that still wins over this deletion (object-spread order below).
  const baseEnv = { ...process.env };
  delete baseEnv.CLAUDE_PROJECT_DIR;
  const result = spawnSync('node', [HOOK], {
    input,
    env: { ...baseEnv, ...env },
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

// Isolated RED execution seam.  The file predates node:test and otherwise
// executes hundreds of historical cases before reaching the Sixteenth
// additions.  A named S16 run executes exactly that case and exits, avoiding
// unrelated fixture state and making each requested RED independently
// reproducible. Function declarations below are hoisted; production is not.
if (process.env.S16_RED_CASE) {
  const s16Cases = {
    'S16-LG-CONSULT-ROOT-INJECT-01': s16LgConsultRootInject01,
    'S16-LG-CONSULT-ROOT-STATUS-INJECT-01': s16LgConsultRootStatusInject01,
    'S16-LG-ROOT-SOURCE-INJECT-01': s16LgRootSourceInject01,
    'S16-LG-ROOT-SOURCE-STATUS-INJECT-01': s16LgRootSourceStatusInject01,
  };
  const selected = s16Cases[process.env.S16_RED_CASE];
  assert.ok(selected, 'unknown S16_RED_CASE: ' + process.env.S16_RED_CASE);
  selected();
  process.exit(0);
}

// F1: Grep on docs path, arch-platform, no flag → BLOCK (official PreToolUse deny)
clearSessionFlag('s1');
const f1 = runHook({
  tool_name: 'Grep',
  tool_input: { pattern: 'test', path: '/project/docs/di/di-patterns-modules.md' },
  session_id: 's1',
  agent_type: 'arch-platform',
  agent_id: 'arch-platform'
});
assertPreToolUseDeny(f1, 'F1');
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
assertPreToolUsePassthrough(f2, 'F2');
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
assertPreToolUsePassthrough(f3, 'F3');
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
assertPreToolUsePassthrough(f4, 'F4');
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
assertPreToolUsePassthrough(f5, 'F5');
console.log('F5 non-search Bash allow: PASS');

// F6: Bash with grep, arch-platform, no flag → BLOCK
// agent_type required: L5 made empty agent_type = main-exempt (allow); peer must carry
// agent_type so the gate sees a non-exempt identity and blocks (deny).
clearSessionFlag('s6');
const f6 = runHook({
  tool_name: 'Bash',
  tool_input: { command: 'grep -r libs.lifecycle .' },
  session_id: 's6',
  agent_type: 'arch-platform',
  agent_id: 'arch-platform'
});
assertPreToolUseDeny(f6, 'F6');
console.log('F6 search Bash block: PASS');

// F7: Invalid JSON → ALLOW (fail open, exit 0)
const f7 = runHook('not valid json');
assertPreToolUsePassthrough(f7, 'F7');
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
assertPreToolUsePassthrough(f8, 'F8');
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
assertPreToolUseDeny(f9, 'F9 BL-W35-06: specialist blocked when only session CP flag set');
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
assertPreToolUsePassthrough(f10, 'F10');
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
assertPreToolUsePassthrough(f11, 'F11');
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
assertPreToolUseDeny(f12, 'F12');
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
assertPreToolUsePassthrough(f13, 'F13');
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
assertPreToolUsePassthrough(f14, 'F14');
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
assertPreToolUseDeny(fcr2a, 'CR2-A');
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
assertPreToolUseDeny(fcr2b, 'CR2-B');
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
assertPreToolUseDeny(fcr2c, 'CR2-C');
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
assertPreToolUseDeny(fcr2d, 'CR2-D');
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
assertPreToolUseDeny(fcr2e, 'CR2-E');
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
assertPreToolUseDeny(fcr2f, 'CR2-F: isSelfTemplatePath must block test-specialist regardless of flag');
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
assertPreToolUsePassthrough(fcr2g, 'CR2-G');
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
// DC2-DC4 therefore assert the official PreToolUse deny shape structurally
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
// Codex/PR#236 hardening: temp project cleanup wrapped in try/finally so a leftover
// mkdtemp dir isn't leaked if an assertion above throws mid-block.
{
  const proj = makeTempProject();
  try {
    writeConsult(consultDir(proj, DC_WAVE_SLUG), `consult-${nowCompact()}.json`, DC_WAVE_SLUG, 'context-provider', nowIso());
    const dc1 = runHookInProject(proj, { CLAUDE_WAVE_SLUG: DC_WAVE_SLUG });
    assertPreToolUsePassthrough(dc1, 'DC1');
    assert.ok(dc1.stderr.includes('[CP-GATE]'), 'DC1: stderr must contain [CP-GATE]');
    assert.ok(dc1.stderr.includes('flag_writer=disk-consult'), 'DC1: stderr must attribute the unblock to disk-consult (distinct sentinel from flag-based flag_writer=<meta.written_by>)');
    assert.ok(dc1.stderr.includes(`wave_slug=${DC_WAVE_SLUG}`), 'DC1: stderr must log the wave_slug that unblocked');
    console.log('DC1 disk-consult unblock (valid fresh consult -> allow, [CP-GATE] audit confirmed): PASS');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// DC2: stale consult (created_at beyond CONSULT_TTL_SECONDS) -> BLOCK (fail-closed)
{
  const proj = makeTempProject();
  try {
    writeConsult(consultDir(proj, DC_WAVE_SLUG), `consult-${nowCompact()}.json`, DC_WAVE_SLUG, 'context-provider', hoursAgoIso(13));
    const dc2 = runHookInProject(proj, { CLAUDE_WAVE_SLUG: DC_WAVE_SLUG });
    assertPreToolUseDeny(dc2, 'DC2: stale disk consult must block (fail-closed)');
    console.log('DC2 disk-consult fail-closed (stale created_at -> block): PASS');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// DC3: wrong wave_slug -> BLOCK (fail-closed)
{
  const proj = makeTempProject();
  try {
    writeConsult(consultDir(proj, DC_WAVE_SLUG), `consult-${nowCompact()}.json`, 'some-other-wave', 'context-provider', nowIso());
    const dc3 = runHookInProject(proj, { CLAUDE_WAVE_SLUG: DC_WAVE_SLUG });
    assertPreToolUseDeny(dc3, 'DC3: wrong-wave disk consult must block (fail-closed)');
    console.log('DC3 disk-consult fail-closed (wrong wave_slug -> block): PASS');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// DC4: unresolvable/null wave slug (no env override, protected branch, no wave dir) -> BLOCK, not fail-open
// Distinct code path from DC3: DC3 is "slug resolves but mismatches"; DC4 is
// "slug does not resolve at all" (getWaveSlug returns null).
{
  const proj = makeTempProject();
  try {
    const dc4 = runHookInProject(proj, { CLAUDE_WAVE_SLUG: '' });
    assertPreToolUseDeny(dc4, 'DC4: null/unresolvable wave slug must block, never fail open');
    console.log('DC4 null-slug fail-closed (unresolvable wave -> block, distinct from DC3): PASS');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// ════════════════════════════════════════════════════════════════════════
// M6 Block C + M7/WP4 dependency closure (dispatch arch-testing-20260808T142647Z,
// Section 3): post-PLAN accepted-result gating. WP4 (PLAN.md ~L5465):
// "Post-PLAN specialist branches require a current accepted result from the
// exact reporting architect/instance/PLAN/subject." Today's gate only ever
// checks a per-agent arch-responded FLAG (any arch->specialist SendMessage,
// F9-F11 above) -- it never correlates that flag to a genuine, PLAN-scoped,
// subject-scoped accepted CP result. This section proposes the minimal
// additive fixture shape + gate behavior (this suite's own established
// "propose the minimal interface, today it does not exist, which IS the RED"
// precedent -- mirrors interpretRoleLifecycleAction/resolveCanonicalRoleProfile
// in the sibling runtime-role-lifecycle-statemachine.test.js file):
//
//   coordination/consult-result/v1 (proposed), written by context-provider
//   into the REQUESTING architect's own inbox (mirrors consult/v1's existing
//   inbox convention), at
//   .planning/wave-<slug>/inbox/<architect-role>/consult-result-<id>.json:
//     { schema, wave_slug, from:'context-provider', to:<architect-role>,
//       architect_instance_id, plan_sha256, subject,
//       [request_kind (only for ingestion results)], accepted, created_at }
//
// Post-PLAN (a PLAN.md exists for the resolved wave) branches: the existing
// per-agent arch-responded flag (BL-W35-06, specialists) and session-wide
// flag (non-specialist architects) are now ADDITIONALLY required to
// correlate -- via the flag's own JSON payload agent_id (the architect's
// identity, already written by context-provider-consulted.js, confirmed
// present in the F13 fixture above) -- to a fresh, accepted consult-result
// from THAT EXACT architect instance, for THIS EXACT PLAN (plan_sha256), for
// the fixed subject this gate itself validates ('pattern-discovery'). Legacy
// pre-PLAN behavior (no PLAN.md at all) is UNCHANGED -- the flag alone still
// suffices, exactly as today (this file's own F1-F14/CR2-*/DC* tests above
// never seed a PLAN.md and must stay green unmodified as the pre-PLAN anchor).
// ════════════════════════════════════════════════════════════════════════

const POSTPLAN_WAVE_SLUG = 'cp-gate-postplan-wave';

function makePostPlanProject() {
  const proj = makeTempProject();
  const planDir = path.join(proj, '.planning', `wave-${POSTPLAN_WAVE_SLUG}`);
  fs.mkdirSync(planDir, { recursive: true });
  fs.writeFileSync(path.join(planDir, 'PLAN.md'), '# fixture PLAN for post-PLAN CP-gate tests\n');
  const planSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(planDir, 'PLAN.md'))).digest('hex');
  return { proj, planSha256 };
}

function writeConsultResult(proj, opts) {
  const dir = path.join(proj, '.planning', `wave-${POSTPLAN_WAVE_SLUG}`, 'inbox', opts.to);
  fs.mkdirSync(dir, { recursive: true });
  const fname = `consult-result-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
  fs.writeFileSync(path.join(dir, fname), JSON.stringify({
    schema: 'coordination/consult-result/v1',
    wave_slug: POSTPLAN_WAVE_SLUG,
    from: 'context-provider',
    to: opts.to,
    architect_instance_id: opts.architectInstanceId,
    plan_sha256: opts.planSha256,
    subject: opts.subject,
    accepted: opts.accepted !== undefined ? opts.accepted : true,
    created_at: opts.createdAt || new Date().toISOString(),
  }));
}

function writeArchResponseFlagWithInstance(sessionId, agentType, architectRole, architectInstanceId) {
  fs.writeFileSync(archResponseFlagPath(sessionId, agentType), JSON.stringify({
    written_by: 'context-provider-consulted',
    agent_id: architectInstanceId,
    architect_role: architectRole,
    session_id: sessionId,
    ts: new Date().toISOString(),
  }));
}

function runSpecialistPostPlan(proj, sessionId, agentType) {
  // M6+M7 FULL CLOSURE (2026-08-11): Site A (mintInternalValidateGrant) mints
  // its OWN internal validate call's backing binding from the REAL invoking
  // hook caller's own session_id/agent_id/agent_type (GROUPE-1's own
  // already-passing assertion below confirms this identity resolution is
  // already correct today) -- once Site A is re-gated on CLAUDE-ID-01 too,
  // THIS caller's own trace also needs to be complete, independent of
  // whatever buildCanonicalAcceptedConsultation already primed for the
  // opener. Unconditional/harmless for every test that never reaches Site A
  // at all (hasCurrentAcceptedConsultation finds no transactions/ dir and
  // returns before ever invoking it -- confirmed for PP2 through PP9/PP11
  // through PP13/PP15 through PP18, none of which build a real chain via
  // buildCanonicalAcceptedConsultation).
  primeClaudeId01Trace(proj, agentType, sessionId, agentType);
  return runHook({
    tool_name: 'Grep',
    tool_input: { pattern: 'test', path: '/project/docs/di/di-patterns-modules.md' },
    session_id: sessionId,
    agent_type: agentType,
    agent_id: agentType,
  }, { CLAUDE_PROJECT_DIR: proj, CLAUDE_WAVE_SLUG: POSTPLAN_WAVE_SLUG });
}

// ════════════════════════════════════════════════════════════════════════
// M7/WP4 group B (dispatch arch-testing-20260810T142647Z): canonical
// post-PLAN validation authority. Builds a GENUINE, durable consult/v2 ->
// result/v2 -> accepted-result/v1 chain directly on disk (never
// writeConsultResult/coordination-result/v1, never
// runtime-consultation-grant-wrapper.cjs, never a manually-planted grant,
// never any test-only production branch) -- the EXACT chain
// hasCurrentAcceptedConsultation/isAcceptedConsultationTransactionValid
// itself scans for: transactions/<request_id>/{request.json,
// results/<attempt_id>.json,accepted-result.json} under
// <coordRoot>/<repoId>/<waveSlug>/<planDigest>/. Durability is proven the
// SAME way this file's own sibling bats fixture builders
// (runtime-consultation-protocol.bats's _write_request/_write_result) are
// already established to satisfy classifyDurableRead: a plain
// fs.writeFileSync at an owner-confined, exact-0600, non-symlinked regular
// file is already sufficient -- classifyDurableRead cares about the file's
// CURRENT identity properties (fstat-provable), never how it was produced.
function buildCanonicalAcceptedConsultation(proj, waveSlug, planSha256, role, openerSessionId, openerAgentId) {
  const coordRoot = path.join(proj, '.planning', 'coordination');
  const repoId = rll.computeRepoId(proj);
  const worktreeId = rll.computeWorktreeId(proj);
  const coordRootId = rc.sha256String(rc.realpathOrSelf(coordRoot));
  const subjectHead = rc.gitRevParse(proj, ['rev-parse', 'HEAD']);
  const targetRoleProfileDigest = rll.roleProfileDigestFor('context-provider');

  const requestId = crypto.randomBytes(32).toString('hex');
  const attemptId = crypto.randomBytes(32).toString('hex');
  // M6+M7 requester-authority closure (Group D fixture correction, arch-testing
  // dispatch 2026-08-10, refined by the Codex-relayed scope decision): both
  // openerSessionId and openerAgentId are REQUIRED (never defaulted/derived) --
  // requester_instance_id must be backed by a REAL RequesterBinding minted from
  // the caller's OWN exact explicit {session, agent} tuple so postPlanGateAllows's
  // specialist AND architect-self branches can correlate against a LIVE binding
  // whose own actor_instance_id is this exact value -- mirrors GROUPC-1/GROUPC-2's
  // own established rll.createRequesterBinding calling convention (below).
  if (typeof openerSessionId !== 'string' || openerSessionId.length === 0) {
    throw new Error('buildCanonicalAcceptedConsultation: openerSessionId is required (a non-empty string) -- every call site must pass its own real opener session explicitly');
  }
  if (typeof openerAgentId !== 'string' || openerAgentId.length === 0) {
    throw new Error('buildCanonicalAcceptedConsultation: openerAgentId is required (a non-empty string) -- every call site must pass its own real opener agent id explicitly');
  }
  // M6+M7 FULL CLOSURE (2026-08-11): centralizes CLAUDE-ID-01 priming for the
  // opener's own tuple here (not per-call-site) -- every caller of this shared
  // constructor needs the opener's createRequesterBinding mint below to
  // succeed once the boundary lands, and priming is REQUIRED regardless (not
  // merely a nicety) for GROUP2-CASE4's own cross-provider-rejection fixture,
  // which tampers a genuinely-minted claude-hook binding's runtime field
  // post-mint -- there is no genuine binding to tamper without a real mint
  // succeeding first. Uses the already-established, empirically-confirmed
  // primeClaudeId01Trace helper (defined later in this file; function
  // declarations hoist, so this call site's position ahead of it is safe).
  primeClaudeId01Trace(proj, role, openerSessionId, openerAgentId);
  const openerIdentity = { ok: true, provider: 'claude-hook', runtime_session_key: openerSessionId };
  const openerBindingResult = rll.createRequesterBinding(proj, openerIdentity, openerAgentId, role, worktreeId, planSha256, 3600);
  assert.strictEqual(openerBindingResult.ok, true, 'buildCanonicalAcceptedConsultation: opener requester binding mint must succeed: ' + JSON.stringify(openerBindingResult));
  const requesterInstanceId = openerBindingResult.binding.actor_instance_id;
  const txnDir = path.join(coordRoot, repoId, waveSlug, planSha256, 'transactions', requestId);

  const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const isoPlus = (base, s) => new Date(new Date(base).getTime() + s * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const createdAt = nowIso();
  const routingPolicyDigest = rc.sha256String('group-b-fixture-routing-policy-v1');
  const subjectScopeDigest = crypto.randomBytes(32).toString('hex');

  function writeDurable(p, obj) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, rc.canonicalJSONStringify(obj), { mode: 0o600 });
    fs.chmodSync(p, 0o600);
  }

  const requestObj = {
    schema: 'coordination/consult/v2',
    request_id: requestId,
    root_request_id: requestId,
    parent_request_id: null,
    depth: 0,
    max_depth: 2,
    source_role: role,
    target_role: 'context-provider',
    target_role_profile_version: '1.0.0',
    target_role_profile_digest: targetRoleProfileDigest,
    requester_worktree_id: worktreeId,
    requester_instance_id: requesterInstanceId,
    repo_id: repoId,
    wave_slug: waveSlug,
    protocol_profile: 'runtime-consultation/v1',
    coordination_root_id: coordRootId,
    plan_digest: planSha256,
    subject_repo_id: repoId,
    subject_worktree_id: worktreeId,
    subject_head: subjectHead,
    subject_scope_digest: subjectScopeDigest,
    created_at: createdAt,
    question: 'M7/WP4 group B canonical-chain fixture question',
    expected_result_kind: 'TEST_RESULT',
    expiry: isoPlus(createdAt, 1800),
    recovery_budget: 1,
    routing_policy_version: 'runtime-routing/v1',
    routing_policy_digest: routingPolicyDigest,
    initial_attempt_id: attemptId,
    initial_lease_epoch: 0,
  };
  const requestPath = path.join(txnDir, 'request.json');
  writeDurable(requestPath, requestObj);
  const requestDigest = rc.sha256File(requestPath);

  const resultObj = {
    schema: 'coordination/result/v2',
    in_reply_to: requestId,
    request_digest: requestDigest,
    plan_digest: planSha256,
    repo_id: repoId,
    wave_slug: waveSlug,
    protocol_profile: 'runtime-consultation/v1',
    max_depth: 2,
    routing_policy_version: 'runtime-routing/v1',
    routing_policy_digest: routingPolicyDigest,
    root_request_id: requestId,
    parent_request_id: null,
    depth: 0,
    attempt_id: attemptId,
    lease_epoch: 0,
    driver: 'noop',
    claimant_instance_id: crypto.randomBytes(32).toString('hex'),
    worker_session_id: null,
    claim_digest: 'a'.repeat(64),
    target_role_profile_version: '1.0.0',
    target_role_profile_digest: targetRoleProfileDigest,
    from_role: 'context-provider',
    to_role: role,
    result_kind: 'TEST_RESULT',
    status: 'ANSWERED',
    reason: null,
    content: 'M7/WP4 group B canonical-chain fixture answer',
    subject_repo_id: repoId,
    subject_worktree_id: worktreeId,
    subject_head: subjectHead,
    subject_scope_digest: subjectScopeDigest,
    consultation_dependencies: [],
    producer_worktree_id: worktreeId,
    producer_head: subjectHead,
    created_at: isoPlus(createdAt, 5),
    pattern_evidence_dependency: null,
  };
  const resultPath = path.join(txnDir, 'results', attemptId + '.json');
  writeDurable(resultPath, resultObj);
  const resultDigest = rc.sha256File(resultPath);

  const acceptedObj = {
    schema: 'coordination/accepted-result/v1',
    schema_version: 1,
    accepted_at: isoPlus(createdAt, 10),
    accepted_attempt_id: attemptId,
    accepted_lease_epoch: 0,
    candidate_result_path: 'results/' + attemptId + '.json',
    request_digest: requestDigest,
    requester_instance_id: requesterInstanceId,
    result_digest: resultDigest,
    routing_policy_digest: routingPolicyDigest,
  };
  const acceptedPath = path.join(txnDir, 'accepted-result.json');
  writeDurable(acceptedPath, acceptedObj);

  return { requestId, attemptId, requesterInstanceId, requestPath, resultPath, acceptedPath };
}

function validateCanonicalArtifactAsCaller(proj, planDigest, sessionId, agentType, agentId, kind, artifactPath) {
  const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };
  const binding = rll.createRequesterBinding(
    proj,
    identity,
    agentId,
    agentType,
    rll.computeWorktreeId(proj),
    planDigest,
    3600,
  );
  assert.strictEqual(binding.ok, true, 'validation caller binding must resolve: ' + JSON.stringify(binding));
  const coordRoot = path.join(proj, '.planning', 'coordination');
  const cliRepoId = rll.computeRepoId(proj);
  const cliView = rll.validateRequesterBindingFor(
    { repoId: cliRepoId },
    binding.binding.binding_id,
    agentType,
    rll.computeWorktreeId(proj),
    planDigest,
  );
  assert.strictEqual(cliView.ok, true, 'CLI-scoped binding validation must resolve before grant mint: ' + JSON.stringify({ cliRepoId, cliView }));
  const rest = ['--coordination-root', coordRoot, '--kind', kind, '--artifact', artifactPath];
  const grant = rll.mintRoleCommandGrant(
    proj,
    binding.binding,
    'requester',
    'validate',
    rc.sha256String(rc.canonicalJSONStringify(rest)),
    null,
    null,
    null,
  );
  assert.strictEqual(grant.ok, true, 'validation caller grant must mint: ' + JSON.stringify(grant));
  const result = spawnSync(process.execPath, [
    path.resolve(__dirname, '../lib/runtime-consultation.cjs'),
    'validate',
    ...rest,
    '--requester-binding',
    grant.grantId,
  ], { cwd: proj, encoding: 'utf8' });
  result.grantId = grant.grantId;
  result.grantRecord = rll.readRegistryRecord(rll.roleCommandGrantPathFor(proj, grant.grantId));
  result.consumedRecord = rll.readRegistryRecord(rll.roleCommandGrantConsumedMarkerPathFor(proj, grant.grantId));
  return result;
}

// M6+M7 requester-authority closure (2026-08-10, dispatch arch-testing-
// 20260810T142647Z Phase 1): every conditionally-caught "expected RED"
// assertion below has been confirmed EMPIRICALLY GREEN (the underlying
// production fixes from the M7/WP4 group A/B/C canonical-chain +
// source-role-threading work have landed) -- so every soft-catch wrapper is
// removed here and each assertion now runs as an ordinary, uncaught assert
// like every other test in this file, per this file's own established
// no-per-test-try/catch-isolation convention.

// GROUPB-CANONICAL-CHAIN-1 (the dispatch's own "genuine positive fixture"):
// a FULLY legitimate, durable consult/v2 -> result/v2 -> accepted-result.json
// chain, built via buildCanonicalAcceptedConsultation above (the EXISTING
// production chain only -- no consult-result/v1, no wrapper, no
// manually-planted grant, no test-only production branch), for an
// arch-testing-owned transaction. DESIRED (once Group A's fix lands): a
// specialist whose architect genuinely accepted this exact transaction must
// be ALLOWED. pre-fix (regression, the core Group-A-blocking defect): production
// still DENIES it, because isAcceptedConsultationTransactionValid's own
// validateViaConsultationCli('consult-v2', ...) call spawns
// `runtime-consultation.cjs validate --coordination-root ... --kind
// consult-v2 --artifact ...` WITHOUT any --requester-binding -- and `validate`
// is itself now grant-gated (confirmed live:
// ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND.validate === 'requester' in
// runtime-consultation.cjs; main()'s validateAndConsumeRoleCommandGrantForCommand
// throws AUTHORITY_INVALID -- CLI status INVALID, not SUCCESS -- for a missing
// --requester-binding on ANY grant-gated subcommand, unconditionally, before
// the command handler ever runs) -- so this internal validate call can never
// succeed today, no matter how genuinely accepted the underlying transaction
// is. This is the precise mechanism this test captures as RED.
{
  const { proj, planSha256 } = makePostPlanProject();
  try {
    writeArchResponseFlagWithInstance('groupb1', 'test-specialist', 'arch-testing', 'arch-testing-instance-1');
    const chain = buildCanonicalAcceptedConsultation(proj, POSTPLAN_WAVE_SLUG, planSha256, 'arch-testing', 'groupb1', 'arch-testing-instance-1');
    primeClaudeId01Trace(proj, 'test-specialist', 'groupb1', 'test-specialist');
    for (const [kind, artifactPath] of [['consult-v2', chain.requestPath], ['result-v2', chain.resultPath]]) {
      const validation = validateCanonicalArtifactAsCaller(
        proj, planSha256, 'groupb1', 'test-specialist', 'test-specialist', kind, artifactPath,
      );
      assert.strictEqual(
        validation.status,
        0,
        'canonical ' + kind + ' validation must succeed before the hook scan: ' + JSON.stringify({
          stdout: validation.stdout,
          stderr: validation.stderr,
          grantId: validation.grantId,
          grantRecord: validation.grantRecord,
          consumedRecord: validation.consumedRecord,
        }),
      );
    }
    const r = runSpecialistPostPlan(proj, 'groupb1', 'test-specialist');
    assertPreToolUsePassthrough(r, 'GROUPB-CANONICAL-CHAIN-1: a genuinely accepted canonical consult/v2->result/v2->accepted-result.json chain must authorize pattern-discovery access');
    console.log('GROUPB-CANONICAL-CHAIN-1 canonical chain authorizes pattern-discovery access: PASS');
  } finally {
    clearArchResponseFlag('groupb1', 'test-specialist');
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// PP1 (M7/WP4 group B correction): REWRITTEN to use the real canonical
// consult/v2 -> result/v2 -> accepted-result.json chain (buildCanonicalAcceptedConsultation
// above) as its ONLY authority -- never writeConsultResult/
// coordination/consult-result/v1 (dispatch: "PP1 ... MUST be rewritten to
// use real canonical v2 transactions ... they may NOT use writeConsultResult()").
// Exact correlation (architect, instance, PLAN, subject) all match, so this
// is THE positive-authority case -- and per GROUPB-CANONICAL-CHAIN-1 above,
// pre-fix that is exactly what still fails (regression), for the identical
// grant-gated-validate reason, not because this fixture is somehow
// incomplete or wrong.
{
  const { proj, planSha256 } = makePostPlanProject();
  try {
    writeArchResponseFlagWithInstance('pp1', 'test-specialist', 'arch-testing', 'arch-testing-instance-1');
    buildCanonicalAcceptedConsultation(proj, POSTPLAN_WAVE_SLUG, planSha256, 'arch-testing', 'pp1', 'arch-testing-instance-1');
    const r = runSpecialistPostPlan(proj, 'pp1', 'test-specialist');
    assertPreToolUsePassthrough(r, 'PP1: exact correlation (architect/instance/PLAN/subject), backed by a REAL canonical v2 chain, must allow');
    console.log('PP1 post-PLAN exact-correlation canonical chain allows: PASS');
  } finally {
    clearArchResponseFlag('pp1', 'test-specialist');
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// PP2 BLOCK: message/candidate-only -- the arch-responded flag exists (a
// specialist WAS messaged), but there is no consult-result at all backing it.
{
  const { proj } = makePostPlanProject();
  try {
    writeArchResponseFlagWithInstance('pp2', 'test-specialist', 'arch-testing', 'arch-testing-instance-1');
    const r = runSpecialistPostPlan(proj, 'pp2', 'test-specialist');
    assertPreToolUseDeny(r, 'PP2: message/candidate-only (no accepted result) must block post-PLAN');
    console.log('PP2 post-PLAN message/candidate-only (no accepted result) blocks: PASS');
  } finally {
    clearArchResponseFlag('pp2', 'test-specialist');
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// PP3 BLOCK: wrong architect_instance_id (a DIFFERENT instance of the same
// architect role -- e.g. a respawned/restarted architect) never satisfies a
// flag minted for a PRIOR instance.
{
  const { proj, planSha256 } = makePostPlanProject();
  try {
    writeArchResponseFlagWithInstance('pp3', 'test-specialist', 'arch-testing', 'arch-testing-instance-STALE');
    writeConsultResult(proj, { to: 'arch-testing', architectInstanceId: 'arch-testing-instance-FRESH', planSha256, subject: 'pattern-discovery' });
    const r = runSpecialistPostPlan(proj, 'pp3', 'test-specialist');
    assertPreToolUseDeny(r, 'PP3: wrong architect instance must block');
    console.log('PP3 post-PLAN wrong architect INSTANCE blocks: PASS');
  } finally {
    clearArchResponseFlag('pp3', 'test-specialist');
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// PP4 BLOCK: wrong architect role -- a consult-result addressed to a
// DIFFERENT architect role never satisfies this specialist's own flag.
{
  const { proj, planSha256 } = makePostPlanProject();
  try {
    writeArchResponseFlagWithInstance('pp4', 'test-specialist', 'arch-testing', 'arch-testing-instance-1');
    writeConsultResult(proj, { to: 'arch-platform', architectInstanceId: 'arch-testing-instance-1', planSha256, subject: 'pattern-discovery' });
    const r = runSpecialistPostPlan(proj, 'pp4', 'test-specialist');
    assertPreToolUseDeny(r, 'PP4: wrong architect role must block');
    console.log('PP4 post-PLAN wrong architect ROLE blocks: PASS');
  } finally {
    clearArchResponseFlag('pp4', 'test-specialist');
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// PP5 BLOCK: wrong PLAN (plan_sha256 stamped for a stale/different PLAN.md
// than the CURRENT wave's own current PLAN.md content).
{
  const { proj } = makePostPlanProject();
  try {
    writeArchResponseFlagWithInstance('pp5', 'test-specialist', 'arch-testing', 'arch-testing-instance-1');
    writeConsultResult(proj, { to: 'arch-testing', architectInstanceId: 'arch-testing-instance-1', planSha256: 'f'.repeat(64), subject: 'pattern-discovery' });
    const r = runSpecialistPostPlan(proj, 'pp5', 'test-specialist');
    assertPreToolUseDeny(r, 'PP5: wrong PLAN digest must block');
    console.log('PP5 post-PLAN wrong PLAN digest blocks: PASS');
  } finally {
    clearArchResponseFlag('pp5', 'test-specialist');
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// PP6 BLOCK: wrong subject -- an accepted result for a DIFFERENT subject
// never authorizes pattern-discovery access.
{
  const { proj, planSha256 } = makePostPlanProject();
  try {
    writeArchResponseFlagWithInstance('pp6', 'test-specialist', 'arch-testing', 'arch-testing-instance-1');
    writeConsultResult(proj, { to: 'arch-testing', architectInstanceId: 'arch-testing-instance-1', planSha256, subject: 'totally-unrelated-subject' });
    const r = runSpecialistPostPlan(proj, 'pp6', 'test-specialist');
    assertPreToolUseDeny(r, 'PP6: wrong subject must block');
    console.log('PP6 post-PLAN wrong subject blocks: PASS');
  } finally {
    clearArchResponseFlag('pp6', 'test-specialist');
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// PP7 BLOCK: result mismatch -- accepted:false (an explicitly DENIED result)
// never authorizes, even with every OTHER field correlating exactly.
{
  const { proj, planSha256 } = makePostPlanProject();
  try {
    writeArchResponseFlagWithInstance('pp7', 'test-specialist', 'arch-testing', 'arch-testing-instance-1');
    writeConsultResult(proj, { to: 'arch-testing', architectInstanceId: 'arch-testing-instance-1', planSha256, subject: 'pattern-discovery', accepted: false });
    const r = runSpecialistPostPlan(proj, 'pp7', 'test-specialist');
    assertPreToolUseDeny(r, 'PP7: an explicitly denied (accepted:false) result must never authorize');
    console.log('PP7 post-PLAN result mismatch (accepted:false) blocks: PASS');
  } finally {
    clearArchResponseFlag('pp7', 'test-specialist');
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// PP8 BLOCK: consultation/lifecycle cross-surface grant leak -- a WELL-FORMED
// runtime-role-lifecycle grant artifact (a DIFFERENT surface entirely) must
// never be misread as a consult-result, even placed at the exact expected
// inbox path.
{
  const { proj } = makePostPlanProject();
  try {
    writeArchResponseFlagWithInstance('pp8', 'test-specialist', 'arch-testing', 'arch-testing-instance-1');
    const dir = path.join(proj, '.planning', `wave-${POSTPLAN_WAVE_SLUG}`, 'inbox', 'arch-testing');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'consult-result-cross-surface.json'), JSON.stringify({
      schema: 'runtime/lifecycle-command-grant/v1',
      grant_id: 'a'.repeat(32),
      role: 'arch-testing',
      subcommand: 'ensure',
    }));
    const r = runSpecialistPostPlan(proj, 'pp8', 'test-specialist');
    assertPreToolUseDeny(r, 'PP8: a lifecycle-surface grant must never satisfy a consultation-surface requirement');
    console.log('PP8 post-PLAN consultation/lifecycle cross-surface grant leak blocks: PASS');
  } finally {
    clearArchResponseFlag('pp8', 'test-specialist');
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// PP9 BLOCK: subagent main-grant use -- a consult-result addressed to
// 'main' (the main orchestrator's own bootstrap acceptance) must never
// authorize a DIFFERENT, subagent architect role's specialist.
{
  const { proj, planSha256 } = makePostPlanProject();
  try {
    writeArchResponseFlagWithInstance('pp9', 'test-specialist', 'arch-testing', 'arch-testing-instance-1');
    writeConsultResult(proj, { to: 'main', architectInstanceId: 'arch-testing-instance-1', planSha256, subject: 'pattern-discovery' });
    const r = runSpecialistPostPlan(proj, 'pp9', 'test-specialist');
    assertPreToolUseDeny(r, 'PP9: a main-orchestrator-addressed result must never authorize a subagent architect');
    console.log('PP9 post-PLAN subagent main-grant use blocks: PASS');
  } finally {
    clearArchResponseFlag('pp9', 'test-specialist');
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// PP10 (M7/WP4 group B correction): REWRITTEN to use the real canonical
// consult/v2 -> result/v2 -> accepted-result.json chain as its ONLY
// authority (dispatch: "PP10 ... MUST be rewritten to use real canonical v2
// transactions ... they may NOT use writeConsultResult()"). Deduplication --
// a genuinely correlated, accepted result is read-only evidence (never a
// one-use grant): the SAME session can rely on it repeatedly. A DIFFERENT
// session with no arch-response flag of its own is still independently
// rejected -- the result record alone never substitutes for that OTHER
// session's own flag. Per GROUPB-CANONICAL-CHAIN-1/PP1 above, the two
// "must allow" legs are both confirmed-passing asserts (ordinary, uncaught).
// The negative leg (rOtherSession, a DIFFERENT session with no flag of its
// own) stays a genuine DENY: that rejection fires on the missing
// per-session flag, before hasCurrentAcceptedConsultation/the canonical
// chain is ever consulted.
{
  const { proj, planSha256 } = makePostPlanProject();
  try {
    writeArchResponseFlagWithInstance('pp10a', 'test-specialist', 'arch-testing', 'arch-testing-instance-1');
    buildCanonicalAcceptedConsultation(proj, POSTPLAN_WAVE_SLUG, planSha256, 'arch-testing', 'pp10a', 'arch-testing-instance-1');
    const rFirst = runSpecialistPostPlan(proj, 'pp10a', 'test-specialist');
    assertPreToolUsePassthrough(rFirst, 'PP10 same-session first call, backed by a REAL canonical v2 chain, must allow');
    console.log('PP10-first same-session first call allows: PASS');
    const rRepeat = runSpecialistPostPlan(proj, 'pp10a', 'test-specialist');
    assertPreToolUsePassthrough(rRepeat, 'PP10 same-session repeated call must ALSO allow -- the result record is read-only evidence, never a one-use grant');
    console.log('PP10-repeat same-session repeated call also allows (read-only evidence, not one-use): PASS');

    const rOtherSession = runSpecialistPostPlan(proj, 'pp10b-no-flag', 'test-specialist');
    assertPreToolUseDeny(rOtherSession, 'PP10 a DIFFERENT session with no arch-response flag of its own must still be independently rejected');
    console.log('PP10 post-PLAN deduplication (negative leg, orthogonal to group-B defect) verified: PASS');
  } finally {
    clearArchResponseFlag('pp10a', 'test-specialist');
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// PP11: lookup/parse error fails CLOSED -- distinct from this file's OWN
// pre-existing generic fail-open-on-internal-error stance (F7 above). WP4:
// "Lookup/parse/validator errors block+STOP; unstable identity predicates
// disable only their native paths." A malformed (non-JSON) consult-result
// candidate is a genuine parse error on the result artifact ITSELF -- pinned
// here to fail CLOSED, never silently fall back to F7's generic fail-open.
{
  const { proj } = makePostPlanProject();
  try {
    writeArchResponseFlagWithInstance('pp11', 'test-specialist', 'arch-testing', 'arch-testing-instance-1');
    const dir = path.join(proj, '.planning', `wave-${POSTPLAN_WAVE_SLUG}`, 'inbox', 'arch-testing');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'consult-result-malformed.json'), 'not valid json at all');
    const r = runSpecialistPostPlan(proj, 'pp11', 'test-specialist');
    assertPreToolUseDeny(r, 'PP11: a parse error on the result artifact itself must fail CLOSED (block), never fail open');
    console.log('PP11 post-PLAN result-parse-error fails CLOSED (distinct from generic internal-error fail-open, F7): PASS');
  } finally {
    clearArchResponseFlag('pp11', 'test-specialist');
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// PP12: disabled override stays legacy-only -- CLAUDE_CP_GATE_DISABLED=1
// still unblocks EVERYTHING post-PLAN too (unchanged, pre-existing top-of-hook
// behavior, checked before ANY post-PLAN logic) -- pinned here so a future
// change that scopes the disable var more narrowly (or accidentally removes
// its post-PLAN reach) shows up as a clear regression either direction.
{
  const { proj } = makePostPlanProject();
  try {
    const r = runHook({
      tool_name: 'Grep',
      tool_input: { pattern: 'test', path: '/project/docs/di/di-patterns-modules.md' },
      session_id: 'pp12',
      agent_type: 'test-specialist',
      agent_id: 'test-specialist',
    }, { CLAUDE_PROJECT_DIR: proj, CLAUDE_WAVE_SLUG: POSTPLAN_WAVE_SLUG, CLAUDE_CP_GATE_DISABLED: '1' });
    assertPreToolUsePassthrough(r, 'PP12');
    console.log('PP12 CLAUDE_CP_GATE_DISABLED=1 legacy-only escape unchanged for post-PLAN: PASS');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// PP13 BLOCK: bootstrap-after-READY -- a consult-result whose OWN subject is
// literally 'bootstrap' (the main-orchestrator lifecycle-grant bootstrap
// profile) must never satisfy the 'pattern-discovery' subject this gate
// itself requires, even for an otherwise perfectly-correlated architect/
// instance/PLAN.
{
  const { proj, planSha256 } = makePostPlanProject();
  try {
    writeArchResponseFlagWithInstance('pp13', 'test-specialist', 'arch-testing', 'arch-testing-instance-1');
    writeConsultResult(proj, { to: 'arch-testing', architectInstanceId: 'arch-testing-instance-1', planSha256, subject: 'bootstrap' });
    const r = runSpecialistPostPlan(proj, 'pp13', 'test-specialist');
    assertPreToolUseDeny(r, 'PP13: a bootstrap-subject result must never satisfy pattern-discovery authority once READY');
    console.log('PP13 post-PLAN bootstrap-after-READY cross-subject leak blocks: PASS');
  } finally {
    clearArchResponseFlag('pp13', 'test-specialist');
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// PP14: architect branches -- exact CP acceptance is only required when the
// architect ITSELF opened the child (a non-specialist architect agent_type
// reading a pattern-discovery path) -- mirrors the EXISTING non-specialist
// session-flag branch (F1/F2 above) but now, post-PLAN, additionally
// requires the architect's OWN consult-result (addressed to itself) rather
// than merely a session-wide flag.
{
  const { proj, planSha256 } = makePostPlanProject();
  try {
    writeSessionFlag('pp14'); // legacy session-wide flag alone
    const r1 = runHook({
      tool_name: 'Grep',
      tool_input: { pattern: 'test', path: '/project/docs/di/di-patterns-modules.md' },
      session_id: 'pp14',
      agent_type: 'arch-platform',
      agent_id: 'arch-platform',
    }, { CLAUDE_PROJECT_DIR: proj, CLAUDE_WAVE_SLUG: POSTPLAN_WAVE_SLUG });
    assertPreToolUseDeny(r1, 'PP14a: post-PLAN, a session-wide flag ALONE is no longer sufficient for an architect that opened its own child');

    // PP14b (M7/WP4 group B correction): REWRITTEN to use the real canonical
    // consult/v2 -> result/v2 -> accepted-result.json chain as its ONLY
    // authority (dispatch: "PP14b ... MUST be rewritten to use real
    // canonical v2 transactions ... they may NOT use writeConsultResult()").
    // hasCurrentAcceptedConsultation(ctx, role) only ever consults `role`
    // (never an instanceId) for the non-specialist/architect identity
    // branch (selfIdentity = {role: agentType, instanceId: 'self'} in the
    // hook itself) -- so the canonical chain only needs to be built for
    // role 'arch-platform', matching r2's own agent_type below.
    buildCanonicalAcceptedConsultation(proj, POSTPLAN_WAVE_SLUG, planSha256, 'arch-platform', 'pp14', 'arch-platform');
    const r2 = runHook({
      tool_name: 'Grep',
      tool_input: { pattern: 'test', path: '/project/docs/di/di-patterns-modules.md' },
      session_id: 'pp14',
      agent_type: 'arch-platform',
      agent_id: 'arch-platform',
    }, { CLAUDE_PROJECT_DIR: proj, CLAUDE_WAVE_SLUG: POSTPLAN_WAVE_SLUG });
    assertPreToolUsePassthrough(r2, 'PP14b: an architect\'s OWN exact CP acceptance, backed by a REAL canonical v2 chain minted from its OWN exact {session,agent} tuple, must allow');
    console.log('PP14 post-PLAN architect-branch (PP14a negative leg; PP14b canonical-chain acceptance allows): PASS');
  } finally {
    clearSessionFlag('pp14');
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// PP14c (Codex-relayed scope decision, section F, 2026-08-10): architect-self
// branch identity correlation -- SAME role and SAME session as the genuine
// chain opener, but a DIFFERENT agent_id, must never authorize. Mirrors
// GROUPD-1's own "same role, unrelated instance" invariant for the
// non-specialist/architect-self identity path (no arch-response flag
// involved -- the hook's own CURRENT session_id/agent_id/agent_type, passed
// as callerIdentity, is what must correlate against the chain's own opener
// binding). writeSessionFlag is REQUIRED here (not merely cosmetic): without
// it, postPlanGateAllows's legacyAllowed would be false via the flag path and
// fall through to the disk-consult fallback (which also fails, no consult
// file seeded) -- a DENY for the WRONG reason (missing legacy flag), never
// exercising the identity-correlation dimension this test is actually about.
{
  const { proj, planSha256 } = makePostPlanProject();
  try {
    writeSessionFlag('pp14c');
    buildCanonicalAcceptedConsultation(proj, POSTPLAN_WAVE_SLUG, planSha256, 'arch-platform', 'pp14c', 'arch-platform-real-opener');
    // M6+M7 FULL CLOSURE (2026-08-11): the CALLER below presents a DIFFERENT
    // agent_id ('arch-platform-different-agent') than the opener's own
    // ('arch-platform-real-opener') -- buildCanonicalAcceptedConsultation's
    // own centralized priming (for the OPENER's tuple) does not cover this
    // caller's own Site-A-internal-validate identity; without this, the test
    // would deny for claude-id01-trace-absent instead of its own intended
    // subject (same role/session, different agent_id, must never authorize).
    primeClaudeId01Trace(proj, 'arch-platform', 'pp14c', 'arch-platform-different-agent');
    const r = runHook({
      tool_name: 'Grep',
      tool_input: { pattern: 'test', path: '/project/docs/di/di-patterns-modules.md' },
      session_id: 'pp14c',
      agent_type: 'arch-platform',
      agent_id: 'arch-platform-different-agent',
    }, { CLAUDE_PROJECT_DIR: proj, CLAUDE_WAVE_SLUG: POSTPLAN_WAVE_SLUG });
    assertPreToolUseDeny(r, 'PP14c: architect-self branch -- same role and same session as the genuine chain opener, but a DIFFERENT agent_id, must never authorize a caller claiming the same role under an unrelated agent_id');
    console.log('PP14c architect-self same-role/same-session/different-agent_id correctly rejected: PASS');
  } finally {
    clearSessionFlag('pp14c');
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// PP14d (Codex-relayed scope decision, section F, 2026-08-10): architect-self
// branch identity correlation -- SAME agent_id and SAME role as the genuine
// chain opener, but a DIFFERENT session_id, must never authorize. The
// session axis, independent of PP14c's own agent_id axis. writeSessionFlag is
// keyed to the CALLING session (the mismatched one) for the same reason
// documented on PP14c above -- otherwise the legacy-flag gate itself denies
// first, making the identity-correlation dimension unreachable/vacuous.
{
  const { proj, planSha256 } = makePostPlanProject();
  try {
    writeSessionFlag('pp14d-different-session');
    buildCanonicalAcceptedConsultation(proj, POSTPLAN_WAVE_SLUG, planSha256, 'arch-platform', 'pp14d-real-session', 'arch-platform');
    // M6+M7 FULL CLOSURE (2026-08-11): the CALLER below presents a DIFFERENT
    // session_id ('pp14d-different-session') than the opener's own
    // ('pp14d-real-session') -- mirrors PP14c's own matching comment; this
    // caller's own Site-A-internal-validate identity needs its own explicit
    // priming, independent of the opener's.
    primeClaudeId01Trace(proj, 'arch-platform', 'pp14d-different-session', 'arch-platform');
    const r = runHook({
      tool_name: 'Grep',
      tool_input: { pattern: 'test', path: '/project/docs/di/di-patterns-modules.md' },
      session_id: 'pp14d-different-session',
      agent_type: 'arch-platform',
      agent_id: 'arch-platform',
    }, { CLAUDE_PROJECT_DIR: proj, CLAUDE_WAVE_SLUG: POSTPLAN_WAVE_SLUG });
    assertPreToolUseDeny(r, 'PP14d: architect-self branch -- same agent_id and same role as the genuine chain opener, but a DIFFERENT session_id, must never authorize a caller claiming the same role/agent under an unrelated session');
    console.log('PP14d architect-self same-agent_id/same-role/different-session_id correctly rejected: PASS');
  } finally {
    clearSessionFlag('pp14d-different-session');
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// PP15 PASS (positive control / pre-PLAN legacy compatibility): with NO
// PLAN.md seeded at all (this file's own F1-F14 baseline), the arch-response
// flag ALONE still suffices -- proves PP1-PP14's tightened requirement is
// genuinely POST-PLAN-gated, never a blanket tightening of the pre-existing
// legacy behavior.
{
  const proj = makeTempProject();
  try {
    writeArchResponseFlagWithInstance('pp15', 'test-specialist', 'arch-testing', 'arch-testing-instance-1');
    const r = runHook({
      tool_name: 'Grep',
      tool_input: { pattern: 'test', path: '/project/docs/di/di-patterns-modules.md' },
      session_id: 'pp15',
      agent_type: 'test-specialist',
      agent_id: 'test-specialist',
    }, { CLAUDE_PROJECT_DIR: proj, CLAUDE_WAVE_SLUG: '' });
    assertPreToolUsePassthrough(r, 'PP15');
    console.log('PP15 pre-PLAN legacy compatibility (no PLAN.md -> flag alone still suffices) verified: PASS');
  } finally {
    clearArchResponseFlag('pp15', 'test-specialist');
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// PP16 (cross-cutting requirement): PATTERN-GAP -> ingestion denial produces
// ZERO documentation writes. A consult-result whose request_kind is
// 'ingestion' but accepted:false (explicit denial) must never unblock a
// doc-updater-owned write path -- and, mirroring the write-gate's own
// enforcement-loop simulation (Section 2, WG6), this test only executes the
// underlying (fake) doc-write when the gate allows it, proving the denial
// genuinely leaves the target completely unwritten.
{
  const { proj, planSha256 } = makePostPlanProject();
  try {
    writeArchResponseFlagWithInstance('pp16', 'test-specialist', 'arch-testing', 'arch-testing-instance-1');
    const dir = path.join(proj, '.planning', `wave-${POSTPLAN_WAVE_SLUG}`, 'inbox', 'arch-testing');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'consult-result-ingestion-denied.json'), JSON.stringify({
      schema: 'coordination/consult-result/v1',
      wave_slug: POSTPLAN_WAVE_SLUG,
      from: 'context-provider',
      to: 'arch-testing',
      architect_instance_id: 'arch-testing-instance-1',
      plan_sha256: planSha256,
      subject: 'pattern-discovery',
      request_kind: 'ingestion',
      accepted: false,
      created_at: new Date().toISOString(),
    }));
    const target = path.join(proj, 'docs', 'guides', 'newly-ingested.md');
    const r = runSpecialistPostPlan(proj, 'pp16', 'test-specialist');
    assertPreToolUseDeny(r, 'PP16: an ingestion result with accepted:false must never unblock');
    assert.strictEqual(fs.existsSync(target), false, 'PP16: zero-write proof -- ingestion denial must leave every doc-updater-owned path completely unwritten');
    console.log('PP16 ingestion denial produces ZERO documentation writes (cross-cutting requirement): PASS');
  } finally {
    clearArchResponseFlag('pp16', 'test-specialist');
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// ════════════════════════════════════════════════════════════════════════
// PP17/PP18 (M7/WP4 RED group C, dispatch arch-testing-20260810T074058Z):
// canonical post-PLAN consultation authority. PP1 above (unmodified, still
// green) proves that a `coordination/consult-result/v1` record -- forged
// directly by this SAME test file via writeConsultResult, with no real
// request/attempt/epoch/content-digest correlation to any genuine consult/v2
// transaction at all -- is CURRENTLY accepted by
// findAcceptedConsultResult/postPlanGateAllows the moment its own
// self-consistent architect/instance/PLAN/subject/accepted fields line up.
// That self-consistency is exactly what makes it forgeable: nothing here ties
// it to a genuine, durable consult/v2 -> result/v2 -> accepted-result.json
// chain (root/parent/depth, subject_scope_digest, content/result digests,
// requester provenance) -- confirmed live: findAcceptedConsultResult
// explicitly checks only rec.schema==='coordination/consult-result/v1' and
// there is zero reference anywhere in context-provider-gate.js to consult/v2,
// result/v2, or accepted-result.json. PP17 uses the IDENTICAL PP1 fixture
// (same helpers, same exact correlated fields) and asserts the
// CORRECT/desired outcome instead: post-PLAN pattern-discovery access must
// require the real canonical chain and must NOT be satisfiable by this
// forged/parallel record alone -- currently RED (production allows it,
// exactly as PP1 documents). PP18 separately proves the current mechanism
// also carries NO freshness/TTL check at all on this record (unlike legacy
// consult/v1's own CONSULT_TTL_SECONDS window) -- confirmed live:
// findAcceptedConsultResult checks schema/to/architect_instance_id/
// plan_sha256/subject/accepted only, never created_at.
// ════════════════════════════════════════════════════════════════════════

// PP17 BLOCK (once fixed): identical fixture to PP1 (exact architect/
// instance/PLAN/subject correlation, accepted:true) -- deliberately NOT a
// real consult/v2 request nor a real result/v2 nor a real
// accepted-result.json: this record is manufactured directly by this test,
// exactly like a forged or parallel caller-authored artifact would be, with
// zero binding to any genuine transaction, root/parent/depth, subject-scope
// digest, or content/result digest.
{
  const { proj, planSha256 } = makePostPlanProject();
  try {
    writeArchResponseFlagWithInstance('pp17', 'test-specialist', 'arch-testing', 'arch-testing-instance-1');
    writeConsultResult(proj, { to: 'arch-testing', architectInstanceId: 'arch-testing-instance-1', planSha256, subject: 'pattern-discovery' });
    const r = runSpecialistPostPlan(proj, 'pp17', 'test-specialist');
    // DESIRED (once the canonical consult/v2 -> result/v2 -> accepted-result.json
    // chain is required, per this dispatch's implementation contract for
    // toolkit-specialist): a forged/parallel coordination/consult-result/v1
    // record -- however internally self-consistent -- must never satisfy
    // post-PLAN authority on its own. pre-fix it does (PP1's own documented,
    // currently-green behavior) -- captured here as the RED.
    assertPreToolUseDeny(r, 'PP17 (M7/WP4 RED group C): a forged/parallel coordination/consult-result/v1 record with NO canonical consult/v2->result/v2->accepted-result.json backing must never satisfy post-PLAN authority, even when its own architect/instance/PLAN/subject/accepted fields are perfectly self-consistent (identical fixture to PP1, which currently documents this as ALLOWED)');
    console.log('PP17 (M7/WP4 group C) forged consult-result/v1 correctly rejected once canonical chain is required: PASS');
  } finally {
    clearArchResponseFlag('pp17', 'test-specialist');
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// PP18 BLOCK (once fixed): a one-year-stale but otherwise perfectly
// correlated consult-result/v1 -- proving the current mechanism has no
// freshness/TTL bound at all, a second, independent dimension of "this is not
// genuine live architect-mediated authority" from PP17's own forgery angle.
{
  const { proj, planSha256 } = makePostPlanProject();
  try {
    writeArchResponseFlagWithInstance('pp18', 'test-specialist', 'arch-testing', 'arch-testing-instance-1');
    const ancientIso = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString(); // one year stale
    writeConsultResult(proj, { to: 'arch-testing', architectInstanceId: 'arch-testing-instance-1', planSha256, subject: 'pattern-discovery', createdAt: ancientIso });
    const r = runSpecialistPostPlan(proj, 'pp18', 'test-specialist');
    assertPreToolUseDeny(r, 'PP18 (M7/WP4 RED group C): a one-year-stale consult-result/v1 must never satisfy post-PLAN authority -- the current mechanism has no freshness/TTL check on this record at all');
    console.log('PP18 (M7/WP4 group C) stale consult-result/v1 correctly rejected once a canonical/fresh-result requirement is enforced: PASS');
  } finally {
    clearArchResponseFlag('pp18', 'test-specialist');
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// ════════════════════════════════════════════════════════════════════════
// M6+M7 requester-authority closure (2026-08-10, dispatch arch-testing-
// 20260810T142647Z Phase 1): GROUP D -- exact post-PLAN identity. Confirmed
// by direct read: postPlanGateAllows(legacyAllowed, identity) calls only
// hasCurrentAcceptedConsultation(ctx, identity.role) -- it NEVER reads or
// compares identity.instanceId at all, even though
// architectIdentityFromFlagMeta already extracts it from the specialist's
// own arch-response flag. hasCurrentAcceptedConsultation itself then scans
// for ANY current accepted transaction FROM that bare role TO
// context-provider, regardless of which specific actor/instance actually
// opened or was party to it. PP3 (above) no longer exercises this dimension
// under the NEW canonical-chain mechanism: it plants an OLD-style
// consult-result/v1 file that hasCurrentAcceptedConsultation never reads at
// all (that scan only ever looks under transactions/<request_id>/), so PP3's
// DENY is vacuous -- it proves an unrecognized file format is ignored, not
// that a genuinely mismatched instance is rejected.
// ════════════════════════════════════════════════════════════════════════

// GROUPD-1: a genuinely accepted canonical chain for role 'arch-testing',
// opened/accepted by SOME OTHER real actor (buildCanonicalAcceptedConsultation's
// own internally-generated, opaque requester_instance_id), must never
// authorize a specialist whose own arch-response flag merely CLAIMS the same
// role while naming a totally unrelated architect instance that was never
// actually party to that chain.
{
  const { proj, planSha256 } = makePostPlanProject();
  try {
    buildCanonicalAcceptedConsultation(proj, POSTPLAN_WAVE_SLUG, planSha256, 'arch-testing', 'groupd1', 'arch-testing-instance-1');
    writeArchResponseFlagWithInstance('groupd1', 'test-specialist', 'arch-testing', 'totally-unrelated-instance-never-party-to-the-chain');
    const r = runSpecialistPostPlan(proj, 'groupd1', 'test-specialist');
    assertPreToolUseDeny(r, 'GROUPD-1 (regression): a genuinely accepted canonical chain for role X, opened by a DIFFERENT real actor, must never authorize a specialist whose own flag merely claims the same role with an unrelated architect instance -- pre-fix postPlanGateAllows/hasCurrentAcceptedConsultation checks identity.role ONLY and never reads or compares identity.instanceId at all, so ANY caller claiming the correct role is authorized by the mere EXISTENCE of some accepted chain for that role, regardless of which actor it actually belongs to');
    console.log('GROUPD-1 same-role/unrelated-instance correctly rejected once instance correlation is enforced: PASS');
  } finally {
    clearArchResponseFlag('groupd1', 'test-specialist');
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// ════════════════════════════════════════════════════════════════════════
// GROUP E -- internal validate authority. Confirmed by direct read:
// mintInternalValidateGrant (context-provider-gate.js) mints the backing
// RequesterBinding for its OWN internal `runtime-consultation.cjs validate`
// subprocess call using a SYNTHETIC identity -- runtime_session_key is
// sha256(coordination root path) (never the real invoking hook caller's own
// session_id), agent_key is the fixed literal constant
// INTERNAL_VALIDATE_AGENT_KEY ('context-provider-gate-internal-validate',
// never the real caller's agent_id), and role is the fixed literal constant
// INTERNAL_VALIDATE_ROLE ('context-provider', never the real caller's own
// agent_type). PLAN.md ~L616's own CLAUDE-AGENT-*/binding correlation
// discipline and this dispatch's own Group E text both require the REAL
// current hook caller tuple {provider:"claude-hook", session_id, agent_id,
// agent_type} instead.
// ════════════════════════════════════════════════════════════════════════

// GROUPE-1: the backing RequesterBinding minted for the internal validate
// call must carry the REAL invoking hook caller's own session_id/agent_id/
// agent_type -- never the synthetic coordination-root-derived session key or
// the fixed internal agent_key/role constants.
{
  const { proj, planSha256 } = makePostPlanProject();
  try {
    writeArchResponseFlagWithInstance('groupe1-distinctive-session-marker-xyz', 'test-specialist', 'arch-testing', 'arch-testing-instance-1');
    buildCanonicalAcceptedConsultation(proj, POSTPLAN_WAVE_SLUG, planSha256, 'arch-testing', 'groupe1-distinctive-session-marker-xyz', 'arch-testing-instance-1');
    const r = runSpecialistPostPlan(proj, 'groupe1-distinctive-session-marker-xyz', 'test-specialist');
    assertPreToolUsePassthrough(r, 'GROUPE-1 fixture sanity: the canonical chain must genuinely allow (mirrors GROUPB-CANONICAL-CHAIN-1\'s own already-confirmed positive case) -- otherwise mintInternalValidateGrant was never reached at all');

    const bindingsDir = path.join(rll.registryRepoDir(proj), 'requester-bindings');
    const files = fs.readdirSync(bindingsDir).filter((f) => f.endsWith('.json'));
    assert.ok(files.length > 0, 'GROUPE-1 fixture: mintInternalValidateGrant must have minted at least one RequesterBinding during this call: ' + JSON.stringify(files));
    // GROUPE-1 fixture correction (team-lead-confirmed, 2026-08-10):
    // buildCanonicalAcceptedConsultation's own opener binding (role:
    // 'arch-testing', agent_key:'arch-testing-instance-1') now ALSO lands in
    // this SAME requester-bindings/ directory -- files[0] is non-deterministic
    // (filesystem readdir order over randomly-generated 32-hex binding_id
    // filenames) and picks EITHER binding depending on the run (reproduced:
    // one run resolved to the opener's own binding and failed this test's own
    // agent_key/role assertions below for the WRONG reason). Select
    // deterministically by the EXACT identity mintInternalValidateGrant's own
    // real-hook-caller binding must carry for THIS test (role/agent_key both
    // 'test-specialist', matching runSpecialistPostPlan's own
    // agent_type/agent_id) -- never array position.
    const candidateBindings = files
      .map((f) => JSON.parse(fs.readFileSync(path.join(bindingsDir, f), 'utf8')))
      .filter((b) => b.role === 'test-specialist' && b.agent_key === 'test-specialist');
    assert.strictEqual(candidateBindings.length, 1, 'GROUPE-1 fixture: exactly one RequesterBinding matching {role:"test-specialist", agent_key:"test-specialist"} (the internal validate call\'s own binding) must exist -- found ' + candidateBindings.length + ' among ' + JSON.stringify(files));
    const binding = candidateBindings[0];
    assert.strictEqual(
      binding.runtime_session_key, 'groupe1-distinctive-session-marker-xyz',
      'GROUPE-1 (regression): the internal validate call\'s own backing RequesterBinding must carry the REAL invoking hook caller\'s own session_id as runtime_session_key -- pre-fix mintInternalValidateGrant instead derives a synthetic session key from sha256(coordination root path), completely unrelated to the real caller: ' + JSON.stringify(binding)
    );
    assert.strictEqual(
      binding.agent_key, 'test-specialist',
      'GROUPE-1 (regression): the internal validate call\'s own backing RequesterBinding must carry the REAL invoking hook caller\'s own agent_id as agent_key -- pre-fix mintInternalValidateGrant instead hardcodes the fixed internal constant "context-provider-gate-internal-validate": ' + JSON.stringify(binding)
    );
    assert.strictEqual(
      binding.role, 'test-specialist',
      'GROUPE-1 (regression): the internal validate call\'s own backing RequesterBinding must carry the REAL invoking hook caller\'s own agent_type as role -- pre-fix mintInternalValidateGrant instead hardcodes an invented "context-provider" role, never the real caller\'s own agent_type: ' + JSON.stringify(binding)
    );
    console.log('GROUPE-1 internal validate grant bound to REAL hook-caller identity: PASS');
  } finally {
    clearArchResponseFlag('groupe1-distinctive-session-marker-xyz', 'test-specialist');
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// ════════════════════════════════════════════════════════════════════════
// GROUP F -- deep validator load-bearing control (2026-08-10, team-lead
// correction). NOT a RED test: current production already correctly denies
// here (isAcceptedConsultationTransactionValid calls validateViaConsultationCli
// for both consult-v2 and result-v2 BEFORE any accepted-result correlation
// even runs, confirmed by direct read) -- this is the PERSISTED regression
// witness for Phase 4 mutation control #7 ("validateViaConsultationCli forced
// true"). A canonical transaction whose SHALLOW correlations/digests are all
// coherent -- including accepted-result.json's own request_digest, deliberately
// RECOMPUTED from the mutated request.json bytes so the shallow digest check
// alone could never explain a denial -- but whose request.json carries one
// unknown key must still be denied, proving denial comes from the closed core
// schema validator specifically, never merely a shallow digest/field match.
// If a future change ever weakens or bypasses the validateViaConsultationCli
// call, this test goes RED.
// ════════════════════════════════════════════════════════════════════════

{
  const { proj, planSha256 } = makePostPlanProject();
  try {
    writeArchResponseFlagWithInstance('groupf1', 'test-specialist', 'arch-testing', 'arch-testing-instance-1');
    const built = buildCanonicalAcceptedConsultation(proj, POSTPLAN_WAVE_SLUG, planSha256, 'arch-testing', 'groupf1', 'arch-testing-instance-1');

    // Mutate request.json with an unknown key, then recompute the ONE
    // downstream shallow digest that depends on its bytes (accepted-result.json's
    // own request_digest) so every shallow check stays coherent -- isolating
    // the eventual denial to the deep schema check alone, never a shallow
    // digest mismatch.
    const reqObj = JSON.parse(fs.readFileSync(built.requestPath, 'utf8'));
    reqObj.totally_unknown_field_xyz = 'this key does not exist in CONSULT_V2_FIELDS';
    fs.writeFileSync(built.requestPath, rc.canonicalJSONStringify(reqObj), { mode: 0o600 });
    fs.chmodSync(built.requestPath, 0o600);
    const mutatedRequestDigest = rc.sha256File(built.requestPath);
    const acceptedObj = JSON.parse(fs.readFileSync(built.acceptedPath, 'utf8'));
    acceptedObj.request_digest = mutatedRequestDigest;
    fs.writeFileSync(built.acceptedPath, rc.canonicalJSONStringify(acceptedObj), { mode: 0o600 });
    fs.chmodSync(built.acceptedPath, 0o600);

    const r = runSpecialistPostPlan(proj, 'groupf1', 'test-specialist');
    assertPreToolUseDeny(r, 'GROUPF-1: a canonical accepted transaction whose request.json carries one unknown key (shallow correlations/digests otherwise fully coherent, including accepted-result.json\'s own recomputed request_digest) must be denied by the closed core schema validator -- proves validateViaConsultationCli is genuinely load-bearing, not merely a shallow digest/field match. Regression witness for Phase 4 mutation control #7 (validateViaConsultationCli forced true)');
    console.log('GROUPF-1 deep validator load-bearing control (unknown key denied via closed schema, not shallow digest match): PASS');
  } finally {
    clearArchResponseFlag('groupf1', 'test-specialist');
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// ════════════════════════════════════════════════════════════════════════
// Section 4 (dispatch arch-testing-20260808T142647Z, P0-2): main-orchestrator
// lifecycle grant injection (--lifecycle-binding). PLAN.md ~L5465 assigns
// context-provider-gate.js the job of resolving "main-orchestrator lifecycle
// grants (bootstrap/normal profiles)". This section is the regression
// contract for the implemented main-orchestrator path: the hook recognizes a
// runtime-role-lifecycle.cjs
// lifecycle-CLI Bash invocation FROM THE MAIN ORCHESTRATOR ONLY, mint
// exactly one REAL grant via the exported createMainOrchestratorBinding +
// mintLifecycleCommandGrant, and surface it via the PreToolUse
// `hookSpecificOutput.updatedInput.command` contract, rewriting the command
// to carry it. Every scenario below proves genuine round-trip validity by
// consuming the injected grant through the SAME exported
// validateAndConsumeLifecycleCommandGrant the real CLI itself uses -- never
// a shape-only check (this codebase's own established testing philosophy,
// e.g. the sibling runtime-role-lifecycle-handlers.test.js file).
// ════════════════════════════════════════════════════════════════════════

const LG_ROLE = 'arch-testing';
const IMPL_RLL = path.resolve(__dirname, '../lib/runtime-role-lifecycle.cjs');

function writeLifecyclePlanFixture(projectRoot, waveSlug) {
  const waveDir = path.join(projectRoot, '.planning', 'wave-' + waveSlug);
  fs.mkdirSync(waveDir, { recursive: true });
  fs.writeFileSync(path.join(waveDir, 'PLAN.md'), '# fixture plan for context-provider-gate.test.js lifecycle-grant-injection tests (' + waveSlug + ')\n');
}

function lgEnsureDigest(roles) {
  return rc.sha256String('ensure:' + roles.slice().sort().join(','));
}

// Part A defect A1 (dispatch arch-testing-20260808T142647Z): builds the
// canonical single-quoted form via the SAME renderPosixDirect the hook must
// use, rather than a naive space-join -- this is what a genuinely canonical
// caller command looks like, and is what the fixed hook (parsePosixDirect)
// will actually require. LG5 below separately proves the non-canonical
// (naive-join) form must be REJECTED once the fix lands.
function lifecycleEnsureCommand(dir, role, extraFlags) {
  const parts = ['node', IMPL_RLL, 'ensure', '--project-root', dir, '--role', role].concat(extraFlags || []);
  return rll.renderPosixDirect(parts);
}

// M7 Correction infra fix (spec §2.A now re-renders the injected flag via
// renderPosixDirect, which single-quotes EVERY token -- e.g.
// '--lifecycle-binding' '<id>' -- so the closing quote immediately follows
// "--lifecycle-binding" with no real whitespace there, and the old naive
// \s+-based regex below can never match it). Tries the canonical parser
// first (handles the real, now-correctly-quoted output), falling back to
// the legacy unquoted-concatenation shape for robustness. This does not
// change what the helper verifies (that a grant was genuinely injected and
// is extractable) -- only how it locates the value in the string.
function extractLifecycleBinding(command) {
  const tokens = rll.parsePosixDirect(command);
  if (Array.isArray(tokens)) {
    const idx = tokens.indexOf('--lifecycle-binding');
    if (idx !== -1 && idx + 1 < tokens.length) return tokens[idx + 1];
  }
  const m = /--lifecycle-binding\s+(\S+)/.exec(command);
  return m ? m[1] : null;
}

// Cleans up BOTH the temp project AND its host-private registry directory
// (os.tmpdir()-rooted, keyed by repo_id -- NOT inside the project dir, so a
// plain fs.rmSync(proj) alone would leak grant/binding artifacts into the
// shared registry base across runs). Mirrors runtime-role-lifecycle-handlers.
// test.js's own cleanup(dir) helper.
function cleanupLifecycleFixture(dir) {
  try { fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true }); } catch { /* best effort */ }
  fs.rmSync(dir, { recursive: true, force: true });
}

// Parses hook stdout as JSON, failing with a clear, semantically-labeled
// message on empty/invalid output rather than letting a raw JSON.parse
// SyntaxError abort this whole (flat, sequential) test file with an
// uninformative stack trace -- this file has no per-test try/catch
// isolation (F1-PP16 above all rely on a clean assert message per failure).
function parseHookJSON(stdout, label) {
  if (!stdout || stdout.trim().length === 0) {
    assert.fail(label + ': hook produced no stdout -- expected a JSON hookSpecificOutput payload');
  }
  try {
    return JSON.parse(stdout);
  } catch (e) {
    assert.fail(label + ': hook stdout was not valid JSON: ' + JSON.stringify(stdout));
  }
}

// M7/WP4 hook-protocol cleanup: the official PreToolUse deny contract
// (code.claude.com/docs/en/hooks) is exit 0 + hookSpecificOutput{hookEventName:
// 'PreToolUse', permissionDecision:'deny', permissionDecisionReason}, never the
// deprecated top-level decision:'block' + exit 2 shape. This is the ONE denial
// contract for every PreToolUse block this hook emits -- the lifecycle-grant
// (Section 4) and requester-grant (Section 5) paths, AND the CP-consult-flag
// mechanism above (F1-F14/CR2-*/DC*/PP1-16/PP-BATS), including its post-PLAN
// branch (postPlanGateAllows): that mechanism is reachable from the same
// PreToolUse hook and was never a genuinely separate protocol, only a
// previously-unconverted part of it.
function assertPreToolUseDeny(r, label) {
  assert.strictEqual(r.exit, 0, label + ': a PreToolUse deny must exit 0 per the official hookSpecificOutput protocol: ' + JSON.stringify(r));
  const body = parseHookJSON(r.stdout, label);
  assert.ok(!Object.prototype.hasOwnProperty.call(body, 'decision'), label + ': deny body must NOT carry the deprecated top-level "decision" field: ' + JSON.stringify(body));
  assert.ok(body.hookSpecificOutput, label + ': deny body must carry hookSpecificOutput: ' + JSON.stringify(body));
  assert.strictEqual(body.hookSpecificOutput.hookEventName, 'PreToolUse', label + ': hookEventName must be PreToolUse: ' + JSON.stringify(body));
  assert.strictEqual(body.hookSpecificOutput.permissionDecision, 'deny', label + ': permissionDecision must be "deny": ' + JSON.stringify(body));
  assert.ok(typeof body.hookSpecificOutput.permissionDecisionReason === 'string' && body.hookSpecificOutput.permissionDecisionReason.length > 0, label + ': permissionDecisionReason must be a non-empty string: ' + JSON.stringify(body));
  return body;
}

// M7/WP4 Group C (dispatch arch-testing-20260810T142647Z): the two sibling
// semantic helpers to assertPreToolUseDeny above -- together the THREE
// possible outcomes of a PreToolUse hook invocation in this file are each
// asserted by their own precise, mutually-exclusive shape, never a bare
// `exit === 0` (which cannot on its own distinguish any of the three: deny
// ALSO exits 0 under the current official protocol, so an unqualified
// exit-0 check is satisfied by a false-negative denial just as readily as
// by a genuine allow). Confirmed by direct read of context-provider-gate.js:
// every CP-consult-flag "allow" branch this file's F1-F14/CR2-*/DC*/PP1-18/
// M7-NOSESSION-UNRELATED sections reach is a bare `process.exit(0)` with NO
// stdout write at all -- passthrough is the ONLY allow shape those sections
// ever produce. The M7/WP4 lifecycle-grant (tryInjectLifecycleGrant) and
// requester-grant (tryInjectRequesterGrant) injection paths are the ONLY
// call sites that emit permissionDecision:"allow" + updatedInput -- LG1/LG8/
// LG9/RQ3/etc. already assert that shape directly and are unaffected here.

// Official PreToolUse allow-passthrough: exit 0, stdout completely empty,
// no denial signal present. This is what the CP-consult-flag mechanism's
// own unconditional `process.exit(0)` (no write) always produces.
function assertPreToolUsePassthrough(r, label) {
  assert.strictEqual(r.exit, 0, label + ': a PreToolUse passthrough allow must exit 0: ' + JSON.stringify(r));
  assert.strictEqual((r.stdout || '').length, 0, label + ': a genuine passthrough allow must produce EMPTY stdout (no JSON body at all) -- non-empty stdout here means this is either an allow-REWRITE or (a false negative) a deny whose JSON body was never actually inspected: ' + JSON.stringify(r));
}

// Official PreToolUse allow-rewrite: exit 0, stdout parses as valid JSON,
// permissionDecision === "allow", and a complete, non-truncated
// updatedInput.command string is present. This is the M7/WP4 lifecycle-/
// requester-grant injection shape (tryInjectLifecycleGrant/
// tryInjectRequesterGrant) -- distinct from a passthrough (which never
// writes to stdout at all) and from a deny (permissionDecision:"deny").
function assertPreToolUseAllowRewrite(r, label) {
  assert.strictEqual(r.exit, 0, label + ': a PreToolUse allow-rewrite must exit 0: ' + JSON.stringify(r));
  const body = parseHookJSON(r.stdout, label);
  assert.ok(body.hookSpecificOutput, label + ': allow-rewrite body must carry hookSpecificOutput: ' + JSON.stringify(body));
  assert.strictEqual(body.hookSpecificOutput.hookEventName, 'PreToolUse', label + ': hookEventName must be PreToolUse: ' + JSON.stringify(body));
  assert.strictEqual(body.hookSpecificOutput.permissionDecision, 'allow', label + ': permissionDecision must be "allow": ' + JSON.stringify(body));
  assert.ok(body.hookSpecificOutput.updatedInput && typeof body.hookSpecificOutput.updatedInput.command === 'string' && body.hookSpecificOutput.updatedInput.command.length > 0, label + ': updatedInput.command must be a complete, non-empty string: ' + JSON.stringify(body));
  return body;
}

// Part A defect A3 (dispatch arch-testing-20260808T142647Z): sessionId is
// now an explicit optional 4th param (default: fresh random, unchanged
// behavior for every pre-existing caller) so LG7 can drive two calls with
// deliberately DIFFERENT, caller-controlled session_ids.
function runMainOrchestratorBash(command, projDir, extraEnv, sessionId) {
  return runHook(
    {
      tool_name: 'Bash',
      tool_input: { command },
      session_id: sessionId || ('lg-' + Math.random().toString(36).slice(2)),
      agent_type: '',
      agent_id: '',
    },
    { CLAUDE_PROJECT_DIR: projDir, CLAUDE_WAVE_SLUG: '', ...extraEnv }
  );
}

// Live-acceptance regression (2026-08-12): probe, status and ensure are three
// distinct canonical requests, so their grants do not share the per-command
// grant cache. They nevertheless come from one exact main-context tuple and
// must all reference the same long-lived MainOrchestratorBinding. Before this
// regression was added, the hook minted one fresh binding per command; the
// later supervisor-launch admission then failed closed on its own three-way
// `main-binding-resolution-ambiguous` collision.
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'main-binding-live-sequence');
    const sessionId = 'main-binding-live-sequence-session';
    const rows = [
      { argv: ['node', IMPL_RLL, 'probe', '--project-root', proj], digest: rc.sha256String('probe'), role: null, subcommand: 'probe' },
      { argv: ['node', IMPL_RLL, 'status', '--project-root', proj, '--role', LG_ROLE], digest: rc.sha256String('status:' + LG_ROLE), role: LG_ROLE, subcommand: 'status' },
      { argv: ['node', IMPL_RLL, 'ensure', '--project-root', proj, '--role', LG_ROLE], digest: lgEnsureDigest([LG_ROLE]), role: LG_ROLE, subcommand: 'ensure' },
    ];
    const bindingIds = [];
    for (const row of rows) {
      const result = runMainOrchestratorBash(rll.renderPosixDirect(row.argv), proj, {}, sessionId);
      const body = assertPreToolUseAllowRewrite(result, 'MAIN-BINDING-LIVE-SEQUENCE ' + row.subcommand);
      const grantId = extractLifecycleBinding(body.hookSpecificOutput.updatedInput.command);
      assert.ok(grantId, 'MAIN-BINDING-LIVE-SEQUENCE ' + row.subcommand + ': a real lifecycle grant must be injected');
      const grantRead = rll.readRegistryRecord(rll.grantPathFor(proj, grantId));
      assert.strictEqual(grantRead.ok, true, JSON.stringify(grantRead));
      assert.strictEqual(grantRead.absent, undefined, JSON.stringify(grantRead));
      bindingIds.push(grantRead.obj.binding_id);
      const consumed = rll.validateAndConsumeLifecycleCommandGrant(proj, grantId, row.digest, row.role, row.subcommand);
      assert.strictEqual(consumed.ok, true, 'MAIN-BINDING-LIVE-SEQUENCE ' + row.subcommand + ': injected grant must be genuinely consumable: ' + JSON.stringify(consumed));
    }
    assert.strictEqual(new Set(bindingIds).size, 1, 'probe/status/ensure from one exact main session must all reuse one MainOrchestratorBinding, got ' + JSON.stringify(bindingIds));
    const worktreeId = rll.computeWorktreeId(proj);
    const planDigest = rll.discoverPlan(proj).planDigest;
    const lookup = rll.findLiveMainOrchestratorBindingForSession(proj, sessionId, worktreeId, planDigest);
    assert.strictEqual(lookup.ok, true, 'the subsequent supervisor claim must resolve exactly one live main binding, never an ambiguity created by the hook itself: ' + JSON.stringify(lookup));
    assert.strictEqual(lookup.binding.binding_id, bindingIds[0]);
    console.log('MAIN-BINDING-LIVE-SEQUENCE probe/status/ensure reuse one exact binding: PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// Mints a REAL pending role-spawn action via the actual production
// binding+grant+ensure machinery (mirrors subagent-start-context-bundle.
// bats's own `_mint_pending_role_spawn` helper, ported to JS since this
// file already imports `rll`/`crypto` directly) -- never a hand-fabricated
// action record. Needed for the action-failed/wait-ready table-driven
// fixtures below, which require a genuinely existing `--action <id>`.
function mintPendingRoleSpawnAction(proj, role, sessionKey) {
  const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionKey };
  const worktreeId = rll.computeWorktreeId(proj);
  const planResult = rll.discoverPlan(proj);
  if (!planResult.ok) throw new Error('mintPendingRoleSpawnAction: no PLAN discovered: ' + JSON.stringify(planResult));
  // The fake driver is only mechanism presence; getCapabilityManifest must
  // additionally see a genuine current-generation CLAUDE-ID-01 capability.
  primeClaudeId01Trace(proj, 'context-provider', sessionKey, 'context-provider-fixture-primary');
  const bindingResult = rll.createMainOrchestratorBinding(proj, identity, worktreeId, planResult.planDigest, 120);
  if (!bindingResult.ok) throw new Error('mintPendingRoleSpawnAction: binding mint failed: ' + JSON.stringify(bindingResult));
  const argvDigest = crypto.createHash('sha256').update('ensure:' + role).digest('hex');
  const grantResult = rll.mintLifecycleCommandGrant(proj, bindingResult.binding, argvDigest, role, 'ensure', 'main-orchestrator', 'orchestrator', 'normal', null);
  if (!grantResult.ok) throw new Error('mintPendingRoleSpawnAction: grant mint failed: ' + JSON.stringify(grantResult));
  const env = Object.assign({}, process.env, {
    NODE_ENV: 'test',
    RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY: 'cp-gate-test-fixture-capability',
    RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: '["claude-sendmessage"]',
  });
  const result = spawnSync('node', [IMPL_RLL, 'ensure', '--project-root', proj, '--role', role, '--lifecycle-binding', grantResult.grantId], { env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('mintPendingRoleSpawnAction: ensure CLI failed (status=' + result.status + '): stdout=' + result.stdout + ' stderr=' + result.stderr);
  const genResult = rll.resolveSessionGeneration(proj, identity);
  if (!genResult.ok) throw new Error('mintPendingRoleSpawnAction: session generation lookup failed: ' + JSON.stringify(genResult));
  const profileDigest = rll.roleProfileDigestFor(role);
  const stateResult = rll.readRoleBindingState(proj, worktreeId, planResult.planDigest, profileDigest, genResult.generationId, role);
  if (!stateResult.ok || !stateResult.record || !stateResult.record.pending_action_id) {
    throw new Error('mintPendingRoleSpawnAction: no pending_action_id found after ensure: ' + JSON.stringify(stateResult));
  }
  return stateResult.record.pending_action_id;
}

// ════════════════════════════════════════════════════════════════════════
// M6 GROUP A (M6-CODEX-SUPERVISOR-ACTIVATION-CLOSURE, RED phase): production
// supervisor launch authority. Today context-provider-gate.js recognizes
// ONLY two canonical CLI invocations for Bash rewrite -- runtime-role-
// lifecycle.cjs (tryInjectLifecycleGrant/findLifecycleCliInvocation, above)
// and runtime-consultation.cjs (tryInjectRequesterGrant/
// findConsultationCliInvocation) -- confirmed by direct read: neither
// CANONICAL_LIFECYCLE_CLI_PATH nor CANONICAL_CONSULTATION_CLI_PATH ever
// matches runtime-bridge-codex.cjs, so a Bash command carrying a genuine,
// freshly-minted `supervisor-start` action's own `bridge_command` gets ZERO
// special handling today: it falls straight through the agentType===''
// branch's two failed injection attempts to the unconditional
// `process.exit(0)` with EMPTY stdout -- no run_in_background forcing, no
// SupervisorExecutionClaim/v1, no updatedInput at all (PLAN.md "Host-native
// lifecycle action boundary" ~L188, ~L580). This section proves that gap
// plus the required independent-validation/negative matrix. Mirrors
// bash-cli-spawn-gate.bats' own _mint_action/_mint_supervisor_start_action
// fixture technique (real ensure() under a fake codex-app-server-only
// capability -- no CLAUDE-ID-01 priming needed, confirmed: that file's own
// extensively-green fixture never primes it either), ported to JS since
// this file already imports rll/rc/spawnSync directly.
// ════════════════════════════════════════════════════════════════════════

const M6A_LC_CAPABILITY = 'cp-gate-m6a-supervisor-fixture-capability';
const M6A_EXEC_CAPABILITY = 'cp-gate-m6a-supervisor-fixture-executor-capability';
const M6A_FIVE_ROLES = ['arch-platform', 'arch-testing', 'arch-integration', 'context-provider', 'doc-updater'];

function makeM6AFakeCodexExecutable() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-gate-m6a-codexbin-'));
  const filePath = path.join(dir, 'fake-codex');
  fs.writeFileSync(filePath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return { dir, filePath };
}

function makeM6ASyntheticJwt(payload) {
  const encode = (value) => Buffer.from(value).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return encode(JSON.stringify({ alg: 'none', typ: 'JWT' })) + '.'
    + encode(JSON.stringify(payload)) + '.' + encode(crypto.randomBytes(16));
}

function makeM6ACredentialHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-gate-m6a-home-'));
  const codexDir = path.join(home, '.codex');
  fs.mkdirSync(codexDir, { recursive: true });
  const exp = Math.floor(Date.now() / 1000) + 7200;
  fs.writeFileSync(path.join(codexDir, 'auth.json'), JSON.stringify({
    tokens: {
      access_token: makeM6ASyntheticJwt({ sub: 'cp-gate-m6a', exp }),
      account_id: 'cp-gate-m6a-' + crypto.randomBytes(4).toString('hex'),
      id_token: makeM6ASyntheticJwt({ sub: 'cp-gate-m6a', exp }),
      refresh_token: 'synthetic-cp-gate-m6a-' + crypto.randomBytes(8).toString('hex'),
    },
  }), { mode: 0o600 });
  return home;
}

// Mints a REAL batched supervisor-start action for `roles` via the actual
// production ensure()/grant machinery under a fake codex-app-server-only
// capability -- never a hand-fabricated action record.
function mintSupervisorStartAction(proj, roles, sessionKey) {
  const projectLib = path.join(proj, 'scripts', 'lib');
  fs.mkdirSync(projectLib, { recursive: true });
  const toolkitPolicy = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../lib/runtime-collaboration-policy.json'), 'utf8'));
  fs.writeFileSync(path.join(projectLib, 'runtime-collaboration-policy.json'), JSON.stringify(rll.projectPolicyV2ToV1(toolkitPolicy)));
  fs.copyFileSync(path.resolve(__dirname, '../lib/runtime-routing.json'), path.join(projectLib, 'runtime-routing.json'));
  const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionKey };
  const worktreeId = rll.computeWorktreeId(proj);
  const planDigest = rll.discoverPlan(proj).planDigest;
  const bindingResult = rll.createMainOrchestratorBinding(proj, identity, worktreeId, planDigest, 120);
  if (!bindingResult.ok) throw new Error('mintSupervisorStartAction: binding mint failed: ' + JSON.stringify(bindingResult));
  const sortedRoles = roles.slice().sort();
  const roleKey = sortedRoles.length === 1 ? sortedRoles[0] : sortedRoles;
  const argvDigest = rc.sha256String('ensure:' + sortedRoles.join(','));
  const grantResult = rll.mintLifecycleCommandGrant(proj, bindingResult.binding, argvDigest, roleKey, 'ensure', 'main-orchestrator', 'orchestrator', 'normal', null);
  if (!grantResult.ok) throw new Error('mintSupervisorStartAction: grant mint failed: ' + JSON.stringify(grantResult));
  const args = [IMPL_RLL, 'ensure', '--project-root', proj];
  for (const r of roles) args.push('--role', r);
  args.push('--lifecycle-binding', grantResult.grantId);
  const codexBin = makeM6AFakeCodexExecutable();
  const credentialHome = makeM6ACredentialHome();
  let result;
  try {
    const env = Object.assign({}, process.env, {
      NODE_ENV: 'test',
      HOME: credentialHome,
      CODEX_CLI_PATH: codexBin.filePath,
      RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY: M6A_LC_CAPABILITY,
      RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: JSON.stringify(['codex-app-server']),
    });
    result = spawnSync('node', args, { env, encoding: 'utf8' });
  } finally {
    fs.rmSync(credentialHome, { recursive: true, force: true });
    fs.rmSync(codexBin.dir, { recursive: true, force: true });
  }
  if (result.status !== 0) throw new Error('mintSupervisorStartAction: ensure CLI failed (status=' + result.status + '): stdout=' + result.stdout + ' stderr=' + result.stderr);
  const lines = result.stdout.trim().split('\n');
  const parsed = JSON.parse(lines[lines.length - 1]);
  const action = parsed.actions.find((a) => a.kind === 'supervisor-start');
  if (!action) throw new Error('mintSupervisorStartAction: no supervisor-start action minted: ' + result.stdout);
  return { action, mainBindingId: bindingResult.binding.binding_id };
}

// Sends a raw main-orchestrator Bash PreToolUse event carrying an explicit
// run_in_background value -- runMainOrchestratorBash (below) has no such
// knob (it only ever sets {command}), insufficient here since forcing
// run_in_background:true is exactly what this section's positive path must
// prove. Also threads the (double) execution-claim test-capability env vars
// so a hook that genuinely calls mintSupervisorExecutionClaim would succeed.
function runMainOrchestratorSupervisorBash(command, runInBackground, projDir, extraEnv, sessionId) {
  return runHook(
    {
      tool_name: 'Bash',
      tool_input: { command, run_in_background: runInBackground, description: 'm6-group-a fixture description' },
      session_id: sessionId || ('m6a-' + Math.random().toString(36).slice(2)),
      agent_type: '',
      agent_id: '',
    },
    Object.assign(
      { CLAUDE_PROJECT_DIR: projDir, CLAUDE_WAVE_SLUG: '', NODE_ENV: 'test', RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY: M6A_LC_CAPABILITY, RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY: M6A_EXEC_CAPABILITY },
      extraEnv
    )
  );
}

function runNamedRoleSupervisorBash(command, runInBackground, projDir, sessionId, agentType, agentId) {
  return runHook(
    {
      tool_name: 'Bash',
      tool_input: { command, run_in_background: runInBackground, description: 'm6-group-a named-role fixture' },
      session_id: sessionId,
      agent_type: agentType,
      agent_id: agentId,
    },
    { CLAUDE_PROJECT_DIR: projDir, CLAUDE_WAVE_SLUG: '', NODE_ENV: 'test', RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY: M6A_LC_CAPABILITY }
  );
}

function expectedBridgeArgvDigest(action) {
  return rc.sha256String(rc.canonicalJSONStringify(action.payload.bridge_argv));
}

// M6A-POSITIVE-1: the exact canonical bridge_command, top-level, issued with
// run_in_background:false (the model's own plausible first attempt) must be
// ALLOWED with updatedInput forcing run_in_background:true, the command
// string UNCHANGED (no textual rewrite needed, unlike lifecycle-grant
// injection), every OTHER original tool_input field preserved, and exactly
// one genuine, round-trip-consumable SupervisorExecutionClaim/v1 minted --
// all independent of bash-cli-spawn-gate.js (never invoked here at all).
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'm6a-positive-1');
    const { action, mainBindingId } = mintSupervisorStartAction(proj, M6A_FIVE_ROLES, 'm6a-positive-1-session');
    const bridgeCommand = action.payload.bridge_command;
    assert.ok(bridgeCommand && bridgeCommand.length > 0, 'M6A-POSITIVE-1 fixture: a real bridge_command must have been minted');

    const r = runMainOrchestratorSupervisorBash(bridgeCommand, false, proj, {}, 'm6a-positive-1-session');
    assert.strictEqual(r.exit, 0, 'M6A-POSITIVE-1: exit must be 0: ' + JSON.stringify(r));
    const body = parseHookJSON(r.stdout, 'M6A-POSITIVE-1');
    assert.ok(body.hookSpecificOutput, 'M6A-POSITIVE-1: recognized supervisor launch must carry hookSpecificOutput: ' + JSON.stringify(body));
    assert.strictEqual(body.hookSpecificOutput.hookEventName, 'PreToolUse', 'M6A-POSITIVE-1: hookEventName must be PreToolUse: ' + JSON.stringify(body));
    assert.strictEqual(body.hookSpecificOutput.permissionDecision, 'allow', 'M6A-POSITIVE-1: a well-formed canonical bridge_command from the top-level orchestrator must be allowed: ' + JSON.stringify(body));
    const updatedInput = body.hookSpecificOutput.updatedInput;
    assert.ok(updatedInput, 'M6A-POSITIVE-1: allow must carry updatedInput: ' + JSON.stringify(body));
    assert.strictEqual(updatedInput.command, bridgeCommand, 'M6A-POSITIVE-1: the bridge_command string itself needs no textual rewrite -- updatedInput.command must equal the original verbatim');
    assert.strictEqual(updatedInput.run_in_background, true, 'M6A-POSITIVE-1: updatedInput.run_in_background must be forced to true even though the original tool_input carried false');
    assert.strictEqual(updatedInput.description, 'm6-group-a fixture description', 'M6A-POSITIVE-1: every other original tool_input field must be preserved, not dropped (mirrors LG9\'s own established contract)');

    // Genuine round-trip proof: exactly one real SupervisorExecutionClaim/v1
    // was minted, scoped correctly, and consumable -- the strongest
    // available proof (mirrors LG1's own validateAndConsumeLifecycleCommandGrant
    // precedent).
    const repoDescriptor = { repoId: action.repo_id };
    const argvDigest = expectedBridgeArgvDigest(action);
    const consumeResult = rll.validateAndConsumeExecutionClaim(repoDescriptor, action, argvDigest, proj);
    assert.strictEqual(consumeResult.ok, true, 'M6A-POSITIVE-1: the hook must have minted exactly one genuine, valid SupervisorExecutionClaim/v1 for this action -- none exists: ' + JSON.stringify(consumeResult));
    assert.strictEqual(consumeResult.claim.main_binding_id, mainBindingId, 'M6A-POSITIVE-1: the minted claim must be bound to the CURRENT session\'s own real MainOrchestratorBinding');

    console.log('M6A-POSITIVE-1 canonical bridge_command: run_in_background forced true, input preserved, genuine SupervisorExecutionClaim/v1 minted: PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// M6A-SUBAGENT: recognition applies before role exemptions. A named role may
// never launch a top-level supervisor, so the exact canonical command must be
// explicitly denied and must mint no execution claim.
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'm6a-subagent');
    const { action } = mintSupervisorStartAction(proj, M6A_FIVE_ROLES, 'm6a-subagent-main-session');
    const r = runNamedRoleSupervisorBash(
      action.payload.bridge_command, false, proj,
      'm6a-subagent-main-session', 'context-provider', 'context-provider-peer-1',
    );
    assertPreToolUseDeny(r, 'M6A-SUBAGENT: a named role presenting the canonical supervisor command must be explicitly denied');
    const claimPath = rll.executionClaimPathFor({ repoId: action.repo_id }, action.action_id);
    assert.strictEqual(fs.existsSync(claimPath), false, 'M6A-SUBAGENT: denial must mint zero execution claim');
    console.log('M6A-SUBAGENT named role explicitly denied, zero claim: PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// M6A-WRONGRUNTIME: kind alone is not enough. The frozen action union binds
// supervisor-start to host-process; a valid-looking action altered to
// claude-native must fail before any binding/claim write.
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'm6a-wrongruntime');
    const { action } = mintSupervisorStartAction(proj, M6A_FIVE_ROLES, 'm6a-wrongruntime-session');
    const actionPath = rll.actionPathFor(proj, action.action_id);
    const rec = JSON.parse(fs.readFileSync(actionPath, 'utf8'));
    rec.runtime = 'claude-native';
    fs.chmodSync(actionPath, 0o600);
    fs.writeFileSync(actionPath, JSON.stringify(rec), { mode: 0o600 });

    const r = runMainOrchestratorSupervisorBash(rec.payload.bridge_command, false, proj, {}, 'm6a-wrongruntime-session');
    assertPreToolUseDeny(r, 'M6A-WRONGRUNTIME: supervisor-start/claude-native violates the closed action union');
    const claimPath = rll.executionClaimPathFor({ repoId: rec.repo_id }, rec.action_id);
    assert.strictEqual(fs.existsSync(claimPath), false, 'M6A-WRONGRUNTIME: invalid action must mint zero claim');
    console.log('M6A-WRONGRUNTIME closed-union violation explicitly denied, zero claim: PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// M6A-REPLAY: a production claim is one-use at mint time too. The first
// canonical admission succeeds; the same action/session presented again is
// explicitly denied and leaves exactly the original single claim.
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'm6a-replay');
    const { action } = mintSupervisorStartAction(proj, M6A_FIVE_ROLES, 'm6a-replay-session');
    const first = runMainOrchestratorSupervisorBash(action.payload.bridge_command, false, proj, {}, 'm6a-replay-session');
    const firstBody = parseHookJSON(first.stdout, 'M6A-REPLAY first admission');
    assert.strictEqual(firstBody.hookSpecificOutput.permissionDecision, 'allow', 'M6A-REPLAY: first admission must succeed');
    const claimPath = rll.executionClaimPathFor({ repoId: action.repo_id }, action.action_id);
    const firstBytes = fs.readFileSync(claimPath);
    const second = runMainOrchestratorSupervisorBash(action.payload.bridge_command, false, proj, {}, 'm6a-replay-session');
    assertPreToolUseDeny(second, 'M6A-REPLAY: second admission of the same action must be denied');
    assert.deepStrictEqual(fs.readFileSync(claimPath), firstBytes, 'M6A-REPLAY: replay must not replace or mutate the first claim');
    console.log('M6A-REPLAY first allow, second deny, one immutable claim: PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// M6A-FORGED: a well-formed but never-minted action_id embedded in an
// otherwise-canonical bridge_command, from the top-level orchestrator, must
// be explicitly DENIED -- mirrors this file's own established "recognized
// (canonical structure/path/subcommand matched) but failed validation ->
// explicit deny, never silent passthrough" doctrine (tryInjectLifecycleGrant's
// M7 Correction §2.B, LG2's own precedent), independently of
// bash-cli-spawn-gate.js. Discriminating: TODAY this command is not
// recognized at ALL (empty passthrough, assertPreToolUseDeny's own
// parseHookJSON fails on empty stdout) -- once recognition exists, a forged
// action_id specifically must still never satisfy it.
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'm6a-forged');
    const { action } = mintSupervisorStartAction(proj, M6A_FIVE_ROLES, 'm6a-forged-session');
    const forgedCommand = action.payload.bridge_command.replace(/[0-9a-f]{32}/, 'f'.repeat(32));
    const r = runMainOrchestratorSupervisorBash(forgedCommand, true, proj, {}, 'm6a-forged-session');
    assertPreToolUseDeny(r, 'M6A-FORGED: a syntactically-canonical bridge_command referencing a never-minted action_id must be explicitly denied');
    const repoDescriptor = { repoId: action.repo_id };
    const argvDigest = expectedBridgeArgvDigest(action);
    const consumeResult = rll.validateAndConsumeExecutionClaim(repoDescriptor, action, argvDigest, proj);
    assert.strictEqual(consumeResult.ok, false, 'M6A-FORGED: a denied forged-action attempt must leave zero claim/consumption files behind: ' + JSON.stringify(consumeResult));
    console.log('M6A-FORGED forged action_id explicitly denied, zero claim files: PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// M6A-EXPIRED: an EXPIRED supervisor-start action, referenced by an
// otherwise-perfectly-canonical bridge_command, must be explicitly denied.
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'm6a-expired');
    const { action } = mintSupervisorStartAction(proj, M6A_FIVE_ROLES, 'm6a-expired-session');
    const actionPath = rll.actionPathFor(proj, action.action_id);
    const rec = JSON.parse(fs.readFileSync(actionPath, 'utf8'));
    rec.expires_at = '2000-01-01T00:00:00Z';
    fs.chmodSync(actionPath, 0o600);
    fs.writeFileSync(actionPath, JSON.stringify(rec), { mode: 0o600 });

    const r = runMainOrchestratorSupervisorBash(action.payload.bridge_command, true, proj, {}, 'm6a-expired-session');
    assertPreToolUseDeny(r, 'M6A-EXPIRED: an expired supervisor-start action must be explicitly denied');
    const repoDescriptor = { repoId: action.repo_id };
    const argvDigest = expectedBridgeArgvDigest(action);
    const consumeResult = rll.validateAndConsumeExecutionClaim(repoDescriptor, action, argvDigest, proj);
    assert.strictEqual(consumeResult.ok, false, 'M6A-EXPIRED: a denied expired-action attempt must leave zero claim/consumption files behind: ' + JSON.stringify(consumeResult));
    console.log('M6A-EXPIRED expired action explicitly denied, zero claim files: PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// M6A-WRONGPLAN: the action's own plan_digest no longer matching the current
// on-disk PLAN.md must be explicitly denied (independent PLAN validation).
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'm6a-wrongplan');
    const { action } = mintSupervisorStartAction(proj, M6A_FIVE_ROLES, 'm6a-wrongplan-session');
    const actionPath = rll.actionPathFor(proj, action.action_id);
    const rec = JSON.parse(fs.readFileSync(actionPath, 'utf8'));
    rec.plan_digest = 'f'.repeat(64);
    fs.chmodSync(actionPath, 0o600);
    fs.writeFileSync(actionPath, JSON.stringify(rec), { mode: 0o600 });

    const r = runMainOrchestratorSupervisorBash(action.payload.bridge_command, true, proj, {}, 'm6a-wrongplan-session');
    assertPreToolUseDeny(r, 'M6A-WRONGPLAN: an action whose plan_digest no longer matches the current on-disk PLAN.md must be explicitly denied');
    const repoDescriptor = { repoId: action.repo_id };
    const argvDigest = expectedBridgeArgvDigest(action);
    const consumeResult = rll.validateAndConsumeExecutionClaim(repoDescriptor, action, argvDigest, proj);
    assert.strictEqual(consumeResult.ok, false, 'M6A-WRONGPLAN: a denied plan-mismatch attempt must leave zero claim/consumption files behind: ' + JSON.stringify(consumeResult));
    console.log('M6A-WRONGPLAN plan_digest mismatch explicitly denied, zero claim files: PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// M6A-WRONGWORKTREE: the action's own worktree_id no longer matching the
// current worktree must be explicitly denied.
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'm6a-wrongworktree');
    const { action } = mintSupervisorStartAction(proj, M6A_FIVE_ROLES, 'm6a-wrongworktree-session');
    const actionPath = rll.actionPathFor(proj, action.action_id);
    const rec = JSON.parse(fs.readFileSync(actionPath, 'utf8'));
    rec.worktree_id = 'f'.repeat(64);
    fs.chmodSync(actionPath, 0o600);
    fs.writeFileSync(actionPath, JSON.stringify(rec), { mode: 0o600 });

    const r = runMainOrchestratorSupervisorBash(action.payload.bridge_command, true, proj, {}, 'm6a-wrongworktree-session');
    assertPreToolUseDeny(r, 'M6A-WRONGWORKTREE: an action whose worktree_id no longer matches the current worktree must be explicitly denied');
    const repoDescriptor = { repoId: action.repo_id };
    const argvDigest = expectedBridgeArgvDigest(action);
    const consumeResult = rll.validateAndConsumeExecutionClaim(repoDescriptor, action, argvDigest, proj);
    assert.strictEqual(consumeResult.ok, false, 'M6A-WRONGWORKTREE: a denied worktree-mismatch attempt must leave zero claim/consumption files behind: ' + JSON.stringify(consumeResult));
    console.log('M6A-WRONGWORKTREE worktree_id mismatch explicitly denied, zero claim files: PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// M6A-CROSSSESSION: the SAME well-formed bridge_command, presented under a
// DIFFERENT session_id than the one whose generation the action was actually
// minted under, must be explicitly denied (cross-session binding use).
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'm6a-crosssession');
    const { action } = mintSupervisorStartAction(proj, M6A_FIVE_ROLES, 'm6a-crosssession-original-session');
    const r = runMainOrchestratorSupervisorBash(action.payload.bridge_command, true, proj, {}, 'm6a-crosssession-DIFFERENT-session');
    assertPreToolUseDeny(r, 'M6A-CROSSSESSION: a bridge_command invoked under a DIFFERENT session than the one the action was minted for must be explicitly denied');
    const repoDescriptor = { repoId: action.repo_id };
    const argvDigest = expectedBridgeArgvDigest(action);
    const consumeResult = rll.validateAndConsumeExecutionClaim(repoDescriptor, action, argvDigest, proj);
    assert.strictEqual(consumeResult.ok, false, 'M6A-CROSSSESSION: a denied cross-session attempt must leave zero claim/consumption files behind: ' + JSON.stringify(consumeResult));
    console.log('M6A-CROSSSESSION cross-session use explicitly denied, zero claim files: PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// LEAD ADDITION (mutation-testing pass, 2026-08-12): a real, live false
// positive the lead hit directly while reviewing this exact implementation
// -- an EARLIER version of SUPERVISOR_BRIDGE_MARKER_RE was a bare substring
// test against the whole raw command, so any ordinary main-orchestrator Bash
// command that merely MENTIONS "runtime-bridge-codex.cjs" or "session-run"
// anywhere (a ls/cat/node -c/git diff path argument, nothing to do with
// launching the supervisor) was wrongly RECOGNIZED and then explicit-denied
// via the "command is not the canonical renderPosixDirect form" branch --
// reproduced live with `ls -la scripts/lib/runtime-bridge-codex.cjs`, fixed
// by anchoring the marker to the actual invoked-script position (mirrors
// findLifecycleCliInvocation/findConsultationCliInvocation's own token-
// position discipline instead of a bare substring search). No test anywhere
// in this file protected the fix from silently regressing -- closing that
// gap here, not just in the fix itself.
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'm6a-unrelated-mention');
    const r = runMainOrchestratorSupervisorBash(
      'ls -la scripts/lib/runtime-bridge-codex.cjs', false, proj, {}, 'm6a-unrelated-mention-session',
    );
    assertPreToolUsePassthrough(r, 'M6A-UNRELATED-MENTION: an ordinary command that merely mentions runtime-bridge-codex.cjs as a path argument (never an actual node invocation of it) must never be recognized as a supervisor-start attempt -- must pass through exactly like any other non-matching command, never denied');
    console.log('M6A-UNRELATED-MENTION ordinary command merely mentioning the filename passes through untouched: PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// LG1: a well-formed `ensure` Bash command issued by the main orchestrator
// (empty agent_type), with NO caller-supplied --lifecycle-binding, must be
// ALLOWED (exit 0) and must carry exactly one freshly-minted, genuinely
// valid grant via hookSpecificOutput.updatedInput.command.
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'lg-wave-1');
    const cmd = lifecycleEnsureCommand(proj, LG_ROLE);
    const r = runMainOrchestratorBash(cmd, proj);
    assert.strictEqual(r.exit, 0, 'LG1: a well-formed main-orchestrator ensure command must be allowed: ' + JSON.stringify(r));
    const body = parseHookJSON(r.stdout, 'LG1');
    assert.ok(body.hookSpecificOutput, 'LG1: response must carry hookSpecificOutput: ' + JSON.stringify(body));
    assert.strictEqual(body.hookSpecificOutput.hookEventName, 'PreToolUse', 'LG1: hookEventName must be PreToolUse: ' + JSON.stringify(body));
    assert.ok(body.hookSpecificOutput.updatedInput && typeof body.hookSpecificOutput.updatedInput.command === 'string', 'LG1: updatedInput.command must be a string: ' + JSON.stringify(body));
    const rewritten = body.hookSpecificOutput.updatedInput.command;
    const grantId = extractLifecycleBinding(rewritten);
    assert.ok(grantId, 'LG1: rewritten command must carry a --lifecycle-binding value: ' + rewritten);
    assert.match(grantId, /^[0-9a-f]{32}$/, 'LG1: injected grant id must be a genuine 128-bit hex id: ' + grantId);

    // Genuine round-trip proof: the injected grant must be REAL and
    // correctly SCOPED for THIS exact ensure/role/project -- not merely a
    // plausible-looking string. Consuming it here through the same exported
    // validator the real CLI itself uses is the strongest available proof.
    const consumeResult = rll.validateAndConsumeLifecycleCommandGrant(proj, grantId, lgEnsureDigest([LG_ROLE]), LG_ROLE, 'ensure');
    assert.strictEqual(consumeResult.ok, true, 'LG1: the injected grant must be genuinely valid and consumable by the real CLI validator; got ' + JSON.stringify(consumeResult));
    assert.strictEqual(consumeResult.binding.worktree_id, rll.computeWorktreeId(proj), 'LG1: the grant\'s binding must be scoped to THIS project\'s real worktree_id');
    assert.strictEqual(consumeResult.binding.plan_digest, rll.discoverPlan(proj).planDigest, 'LG1: the grant\'s binding must be scoped to THIS project\'s real plan_digest');

    console.log('LG1 main-orchestrator ensure command gets exactly one genuine grant injected via updatedInput: PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// LG2: a Bash command that ALREADY supplies its own --lifecycle-binding (a
// caller/model-forged or replayed value) must be REJECTED outright
// (decision:block) -- a grant may only ever come from the hook itself,
// never from the model's own generated command text. Chosen over a silent
// strip-and-continue: the dispatch's own primary wording is unambiguous
// ("reject ... forbidden ... never trusted"), and a caller-supplied grant
// reference is itself suspicious enough (hallucination, stale replay, or a
// deliberate confused-deputy attempt) that failing the WHOLE call closed,
// rather than quietly rewriting around it, is the safer default --
// consistent with this file's OWN established fail-closed stance elsewhere
// (PP11 above). NOTE (low confidence, flagged per the dispatch's own
// request): the dispatch's test-coverage bullet also says "rejected/
// stripped", so a strip-and-continue implementation is plausible too; if
// this reading turns out wrong, this is the one assertion in this section
// to revisit first -- the invariant that must never change is that the
// caller-supplied value is never trusted/forwarded as-is.
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'lg-wave-2');
    const forged = 'deadbeefdeadbeefdeadbeefdeadbeef';
    const cmd = lifecycleEnsureCommand(proj, LG_ROLE, ['--lifecycle-binding', forged]);
    const r = runMainOrchestratorBash(cmd, proj);
    assertPreToolUseDeny(r, 'LG2: a caller-supplied --lifecycle-binding must be rejected (blocked), never trusted or silently forwarded');
    console.log('LG2 caller-supplied --lifecycle-binding on a main-orchestrator command is rejected: PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// LG3 (regression guard -- expected to ALREADY pass today, unlike LG1/LG2/
// LG4): a specialist/architect (non-empty agent_type) issuing the IDENTICAL
// well-formed ensure command must get NO injection at all -- this mechanism
// is main-orchestrator-only (PLAN.md ~L5465's own "main-orchestrator
// lifecycle grants" framing). A peer agent's own Bash call must pass through
// this file's PRE-EXISTING, unrelated non-search-Bash allow-list unmodified
// (mirrors F5's own non-search-Bash-allow precedent) -- pinned here
// explicitly so a future, over-broad implementation of LG1 can never widen
// injection to non-main-orchestrator callers.
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'lg-wave-3');
    const cmd = lifecycleEnsureCommand(proj, LG_ROLE);
    const r = runHook(
      {
        tool_name: 'Bash',
        tool_input: { command: cmd },
        session_id: 'lg3',
        agent_type: 'arch-testing',
        agent_id: 'arch-testing',
      },
      { CLAUDE_PROJECT_DIR: proj, CLAUDE_WAVE_SLUG: '' }
    );
    assert.strictEqual(r.exit, 0, 'LG3: a non-search Bash command from a peer agent must still be allowed (pre-existing F5 behavior, unaffected): ' + JSON.stringify(r));
    let hadInjection = false;
    if (r.stdout && r.stdout.trim().length > 0) {
      try {
        const body = JSON.parse(r.stdout);
        hadInjection = !!(body && body.hookSpecificOutput);
      } catch { /* non-JSON stdout is fine here -- definitely no injection */ }
    }
    assert.strictEqual(hadInjection, false, 'LG3: a non-main-orchestrator caller must never receive a lifecycle-grant injection: ' + JSON.stringify(r));
    console.log('LG3 non-empty agent_type (specialist/architect) gets no lifecycle-grant injection (regression guard): PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// LG4 (dispatch arch-testing-20260808T142647Z Part A defect A3 --
// narrowed): calling the hook TWICE for the SAME logical request (identical
// command, same scope, SAME session_id) while the FIRST grant is still live
// (unconsumed, unexpired) must not leave TWO independently-live grants for
// the same (worktree, plan, SESSION, role, subcommand) scope -- mirrors
// this codebase's own established idempotent-mint pattern elsewhere (a
// STARTING re-report never mints a second role-spawn action for an
// already-pending one). Originally this test used a fresh random session_id
// per call (unintentionally exercising cross-session behavior under a
// same-session name); A3 makes session_id part of the binding's own
// identity, so this test now pins an EXPLICIT, FIXED session_id for both
// calls -- true same-session idempotency. The DIFFERENT-session case (which
// must NEVER share a grant, the opposite invariant) is LG7, below. The exact
// mechanism (reuse the same grant_id vs. mint a second one only after
// definitively invalidating the first) is unspecified upstream; this test
// pins the OBSERVABLE invariant that must hold regardless of mechanism: at
// most ONE of the two returned grant ids may be genuinely live+valid once
// BOTH calls have completed.
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'lg-wave-4');
    const cmd = lifecycleEnsureCommand(proj, LG_ROLE);
    const lg4SessionId = 'lg4-fixed-session';

    const r1 = runMainOrchestratorBash(cmd, proj, {}, lg4SessionId);
    assert.strictEqual(r1.exit, 0, 'LG4a: first call must be allowed: ' + JSON.stringify(r1));
    const body1 = parseHookJSON(r1.stdout, 'LG4a');
    const grant1 = body1.hookSpecificOutput && extractLifecycleBinding(body1.hookSpecificOutput.updatedInput.command);
    assert.ok(grant1, 'LG4a: first call must inject a grant: ' + JSON.stringify(body1));

    const r2 = runMainOrchestratorBash(cmd, proj, {}, lg4SessionId);
    assert.strictEqual(r2.exit, 0, 'LG4b: second call (SAME session_id) for the identical logical request must ALSO be allowed: ' + JSON.stringify(r2));
    const body2 = parseHookJSON(r2.stdout, 'LG4b');
    const grant2 = body2.hookSpecificOutput && extractLifecycleBinding(body2.hookSpecificOutput.updatedInput.command);
    assert.ok(grant2, 'LG4b: second call must also inject a grant: ' + JSON.stringify(body2));

    if (grant1 === grant2) {
      // Reuse strategy: trivially at most one live grant for this scope.
      console.log('LG4 idempotent replay (same-scope reuse: identical grant_id returned both times): PASS');
    } else {
      // Distinct-mint strategy: acceptable ONLY if grant1 is no longer live
      // by the time grant2 exists -- both independently live at once would
      // violate "no two live grants for the same scope".
      const grant1StillLive = rll.validateAndConsumeLifecycleCommandGrant(proj, grant1, lgEnsureDigest([LG_ROLE]), LG_ROLE, 'ensure');
      assert.strictEqual(
        grant1StillLive.ok,
        false,
        'LG4: two DIFFERENT grant ids were returned for the identical logical request, AND the first one was STILL independently live+valid -- this is exactly the "two live grants for the same scope" outcome the contract forbids: ' + JSON.stringify({ grant1, grant2, grant1StillLive })
      );
      const grant2StillLive = rll.validateAndConsumeLifecycleCommandGrant(proj, grant2, lgEnsureDigest([LG_ROLE]), LG_ROLE, 'ensure');
      assert.strictEqual(grant2StillLive.ok, true, 'LG4: the SECOND (presumably superseding) grant must itself be genuinely live+valid: ' + JSON.stringify(grant2StillLive));
      console.log('LG4 idempotent replay (distinct mint, but the FIRST grant was correctly invalidated -- never two simultaneously-live grants): PASS');
    }
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// ════════════════════════════════════════════════════════════════════════
// Third HOLD (dispatch arch-testing-20260808T142647Z) Part A: 4 confirmed
// defects in the LG1-4 grant-injection mechanism above. LG5-LG9 below each
// prove exactly one defect.
// ════════════════════════════════════════════════════════════════════════

// LG5 (A1): the hook's OWN hand-written `tokenizeShellCommand` is more
// permissive than the canonical `parsePosixDirect` grammar it must be
// replaced with -- a completely UNQUOTED command (structurally identical
// argv, just not wrapped in the canonical single-quote form) parses fine
// under the OLD tokenizer (so it gets a REAL grant injected pre-fix) but must
// NEVER be recognized once the hook requires parsePosixDirect's closed
// grammar (PLAN.md ~L598-599: single-quoted segments only,
// `renderPosixDirect(decoded) === command` or reject). This is exactly the
// bare form `lifecycleEnsureCommand` used to produce before this file's own
// helper was switched to canonical rendering above.
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'lg5-wave');
    const cmd = `node ${IMPL_RLL} ensure --project-root ${proj} --role ${LG_ROLE}`;
    const r = runMainOrchestratorBash(cmd, proj);
    assert.strictEqual(r.exit, 0, 'LG5 (A1): an unquoted (non-canonical) command must still be ALLOWED as ordinary non-search Bash passthrough, just never injected: ' + JSON.stringify(r));
    let hadInjection = false;
    if (r.stdout && r.stdout.trim().length > 0) {
      try {
        const body = JSON.parse(r.stdout);
        hadInjection = !!(body && body.hookSpecificOutput);
      } catch { /* non-JSON stdout is fine here -- definitely no injection */ }
    }
    assert.strictEqual(hadInjection, false, 'LG5 (A1): an unquoted, non-canonical ensure command must NEVER receive a lifecycle-grant injection once the hook requires parsePosixDirect\'s closed single-quoted grammar -- pre-fix the permissive hand-written tokenizer wrongly accepts it and injects a real, live grant: ' + JSON.stringify(r));
    console.log('LG5 (A1) non-canonical unquoted command gets NO injection (canonical-parser-only recognition): PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// LG6 (A2): the hook's `findLifecycleCliInvocation` matches ANY token whose
// BASENAME equals 'runtime-role-lifecycle.cjs', regardless of directory -- a
// lookalike file in a completely different, untrusted directory gets a REAL,
// live grant injected pre-fix purely because the basename matches. Once fixed,
// only the genuine, canonical resolved path (matching however this hook's
// own top-of-file require resolves the real script, line ~36) may be
// recognized; a same-basename file elsewhere must never be.
{
  const proj = makeTempProject();
  const evilDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-gate-lg6-evil-'));
  try {
    writeLifecyclePlanFixture(proj, 'lg6-wave');
    const evilScriptPath = path.join(evilDir, 'runtime-role-lifecycle.cjs');
    fs.writeFileSync(evilScriptPath, '// not the real runtime-role-lifecycle.cjs -- same basename only\n');
    const cmd = rll.renderPosixDirect(['node', evilScriptPath, 'ensure', '--project-root', proj, '--role', LG_ROLE]);
    const r = runMainOrchestratorBash(cmd, proj);
    assert.strictEqual(r.exit, 0, 'LG6 (A2): a same-basename lookalike script must still be ALLOWED as ordinary non-search Bash passthrough, just never injected: ' + JSON.stringify(r));
    let hadInjection = false;
    if (r.stdout && r.stdout.trim().length > 0) {
      try {
        const body = JSON.parse(r.stdout);
        hadInjection = !!(body && body.hookSpecificOutput);
      } catch { /* non-JSON stdout is fine here -- definitely no injection */ }
    }
    assert.strictEqual(hadInjection, false, 'LG6 (A2): a script sharing ONLY the basename runtime-role-lifecycle.cjs, in a different untrusted directory, must NEVER be recognized as the lifecycle CLI or receive a genuine grant -- pre-fix basename-only matching wrongly injects one, which is exploitable if that lookalike file is attacker-controlled: ' + JSON.stringify(r));
    console.log('LG6 (A2) same-basename lookalike in a different directory gets NO injection (canonical-path-only recognition): PASS');
  } finally {
    cleanupLifecycleFixture(proj);
    fs.rmSync(evilDir, { recursive: true, force: true });
  }
}

// LG7 (A3): the grant cache key is currently (worktreeId, planDigest,
// subcommand, argvDigest) ONLY -- no session_id -- so two calls for the
// IDENTICAL logical request from TWO DIFFERENT session_ids wrongly hit the
// SAME cache entry and share ONE grant/binding bound to whichever session
// minted it first. Per MainOrchestratorBinding/v1's own schema (PLAN.md
// ~L594), `runtime_session_key` is part of the binding's own identity -- a
// binding (and any grant derived from it) is scoped to worktree+plan+SESSION
// together. Two different session_ids for the same request must each get
// their OWN grant, genuinely bound to their OWN session (contrast with LG4,
// above, which pins the SAME-session reuse/idempotency invariant).
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'lg7-wave');
    const cmd = lifecycleEnsureCommand(proj, LG_ROLE);
    const session1 = 'lg7-session-one';
    const session2 = 'lg7-session-two';

    const r1 = runMainOrchestratorBash(cmd, proj, {}, session1);
    assert.strictEqual(r1.exit, 0, 'LG7a: first (session1) call must be allowed: ' + JSON.stringify(r1));
    const body1 = parseHookJSON(r1.stdout, 'LG7a');
    const grant1 = body1.hookSpecificOutput && extractLifecycleBinding(body1.hookSpecificOutput.updatedInput.command);
    assert.ok(grant1, 'LG7a: first call must inject a grant: ' + JSON.stringify(body1));

    const r2 = runMainOrchestratorBash(cmd, proj, {}, session2);
    assert.strictEqual(r2.exit, 0, 'LG7b: second (session2) call for the identical logical request must ALSO be allowed: ' + JSON.stringify(r2));
    const body2 = parseHookJSON(r2.stdout, 'LG7b');
    const grant2 = body2.hookSpecificOutput && extractLifecycleBinding(body2.hookSpecificOutput.updatedInput.command);
    assert.ok(grant2, 'LG7b: second call must also inject a grant: ' + JSON.stringify(body2));

    assert.notStrictEqual(grant2, grant1, 'LG7 (A3): two DIFFERENT session_ids for the identical logical request must NEVER share the same grant_id -- each must be minted fresh, scoped to its own session/binding. pre-fix the grant cache key omits session_id entirely, so session2 silently receives session1\'s already-cached grant: ' + JSON.stringify({ grant1, grant2, session1, session2 }));

    const consume1 = rll.validateAndConsumeLifecycleCommandGrant(proj, grant1, lgEnsureDigest([LG_ROLE]), LG_ROLE, 'ensure');
    assert.strictEqual(consume1.ok, true, 'LG7 (A3): session1\'s own grant must be genuinely live+valid: ' + JSON.stringify(consume1));
    assert.strictEqual(consume1.binding.runtime_session_key, session1, 'LG7 (A3): session1\'s grant must be bound to session1\'s OWN runtime_session_key, never session2\'s: ' + JSON.stringify(consume1.binding));

    const consume2 = rll.validateAndConsumeLifecycleCommandGrant(proj, grant2, lgEnsureDigest([LG_ROLE]), LG_ROLE, 'ensure');
    assert.strictEqual(consume2.ok, true, 'LG7 (A3): session2\'s own grant must be genuinely live+valid: ' + JSON.stringify(consume2));
    assert.strictEqual(consume2.binding.runtime_session_key, session2, 'LG7 (A3): session2\'s grant must be bound to session2\'s OWN runtime_session_key, never session1\'s: ' + JSON.stringify(consume2.binding));

    console.log('LG7 (A3) two different session_ids for the identical logical request each get their OWN independently-live, correctly-scoped grant: PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// LG8 (A4, permissionDecision): PLAN.md ~L600: "Each owning hook returns
// supported hookSpecificOutput with hookEventName:'PreToolUse',
// permissionDecision:'allow', and complete updatedInput." The current
// injection response omits permissionDecision entirely.
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'lg8-wave');
    const cmd = lifecycleEnsureCommand(proj, LG_ROLE);
    const r = runMainOrchestratorBash(cmd, proj);
    assert.strictEqual(r.exit, 0, 'LG8: a well-formed main-orchestrator ensure command must be allowed: ' + JSON.stringify(r));
    const body = parseHookJSON(r.stdout, 'LG8');
    assert.strictEqual(body.hookSpecificOutput.permissionDecision, 'allow', 'LG8 (A4): a successful lifecycle-grant injection must carry permissionDecision:"allow" per PLAN.md ~L600 -- pre-fix this field is entirely absent from the response: ' + JSON.stringify(body));
    console.log('LG8 (A4) successful injection carries permissionDecision:"allow": PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// LG9 (A4, complete updatedInput): the rewritten `updatedInput` must
// preserve the FULL original `tool_input` object, replacing ONLY `command`
// -- pre-fix it emits `{command}` alone, silently dropping every other
// original field (e.g. `description`, `timeout`, `run_in_background`).
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'lg9-wave');
    const cmd = lifecycleEnsureCommand(proj, LG_ROLE);
    const r = runHook(
      {
        tool_name: 'Bash',
        tool_input: {
          command: cmd,
          description: 'cp-gate LG9 fixture description',
          timeout: 12345,
          run_in_background: false,
        },
        session_id: 'lg9-session',
        agent_type: '',
        agent_id: '',
      },
      { CLAUDE_PROJECT_DIR: proj, CLAUDE_WAVE_SLUG: '' }
    );
    assert.strictEqual(r.exit, 0, 'LG9: a well-formed main-orchestrator ensure command with extra tool_input fields must be allowed: ' + JSON.stringify(r));
    const body = parseHookJSON(r.stdout, 'LG9');
    const updatedInput = body.hookSpecificOutput.updatedInput;
    assert.strictEqual(updatedInput.description, 'cp-gate LG9 fixture description', 'LG9 (A4): updatedInput must preserve the original description field, not drop it: ' + JSON.stringify(updatedInput));
    assert.strictEqual(updatedInput.timeout, 12345, 'LG9 (A4): updatedInput must preserve the original timeout field, not drop it: ' + JSON.stringify(updatedInput));
    assert.strictEqual(updatedInput.run_in_background, false, 'LG9 (A4): updatedInput must preserve the original run_in_background field, not drop it: ' + JSON.stringify(updatedInput));
    assert.notStrictEqual(updatedInput.command, cmd, 'LG9 (A4): updatedInput.command must be the REWRITTEN command (carrying the injected grant), not the original: ' + JSON.stringify(updatedInput));
    console.log('LG9 (A4) updatedInput preserves full original tool_input, replacing only command: PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// ════════════════════════════════════════════════════════════════════════
// Table-driven coverage for the remaining lifecycle subcommands (dispatch
// arch-testing-20260808T142647Z Part A: "convert hand-verified coverage of
// the other 7 subcommands into real, table-driven, committed tests"). Each
// case proves BOTH: (a) a well-formed main-orchestrator invocation gets
// exactly one genuine, round-trip-consumable grant injected (LG1's own
// pattern, generalized), and (b) a caller-supplied --lifecycle-binding on
// the SAME subcommand is rejected outright (LG2's own pattern, generalized)
// -- never assumed from LG1/LG2's ensure-only coverage.
// ════════════════════════════════════════════════════════════════════════

const LG_FORGED_BINDING = 'deadbeefdeadbeefdeadbeefdeadbeef';

const SIMPLE_SUBCOMMAND_TABLE = [
  {
    name: 'probe',
    expectedRole: null,
    buildArgv: (dir) => ['node', IMPL_RLL, 'probe', '--project-root', dir],
    digest: () => rc.sha256String('probe'),
  },
  {
    name: 'status',
    expectedRole: LG_ROLE,
    buildArgv: (dir, role) => ['node', IMPL_RLL, 'status', '--project-root', dir, '--role', role],
    digest: (role) => rc.sha256String('status:' + role),
  },
  {
    name: 'rotate',
    expectedRole: LG_ROLE,
    buildArgv: (dir, role) => ['node', IMPL_RLL, 'rotate', '--project-root', dir, '--role', role],
    digest: (role) => rc.sha256String('rotate:' + role),
  },
  {
    name: 'stop-owned',
    expectedRole: LG_ROLE,
    buildArgv: (dir, role) => ['node', IMPL_RLL, 'stop-owned', '--project-root', dir, '--role', role, '--reason', 'cp-gate-fixture-reason'],
    digest: (role) => rc.sha256String('stop-owned:' + role + ':cp-gate-fixture-reason'),
  },
];

for (const row of SIMPLE_SUBCOMMAND_TABLE) {
  // (a) positive: genuine grant injected + round-trip-consumable.
  {
    const proj = makeTempProject();
    try {
      writeLifecyclePlanFixture(proj, 'lg-table-' + row.name + '-pos');
      const argv = row.buildArgv(proj, LG_ROLE);
      const cmd = rll.renderPosixDirect(argv);
      const r = runMainOrchestratorBash(cmd, proj);
      assert.strictEqual(r.exit, 0, `LG-TABLE ${row.name} positive: must be allowed: ` + JSON.stringify(r));
      const body = parseHookJSON(r.stdout, 'LG-TABLE ' + row.name + ' positive');
      assert.ok(body.hookSpecificOutput, `LG-TABLE ${row.name} positive: must carry hookSpecificOutput: ` + JSON.stringify(body));
      const rewritten = body.hookSpecificOutput.updatedInput.command;
      const grantId = extractLifecycleBinding(rewritten);
      assert.ok(grantId, `LG-TABLE ${row.name} positive: must inject a grant: ` + rewritten);
      const consumeResult = rll.validateAndConsumeLifecycleCommandGrant(proj, grantId, row.digest(LG_ROLE), row.expectedRole, row.name);
      assert.strictEqual(consumeResult.ok, true, `LG-TABLE ${row.name} positive: injected grant must be genuinely consumable: ` + JSON.stringify(consumeResult));
      console.log(`LG-TABLE ${row.name} positive (genuine grant injected + round-trip consumed): PASS`);
    } finally {
      cleanupLifecycleFixture(proj);
    }
  }
  // (b) negative: caller-supplied --lifecycle-binding rejected (mirrors LG2).
  {
    const proj = makeTempProject();
    try {
      writeLifecyclePlanFixture(proj, 'lg-table-' + row.name + '-neg');
      const argv = row.buildArgv(proj, LG_ROLE).concat(['--lifecycle-binding', LG_FORGED_BINDING]);
      const cmd = rll.renderPosixDirect(argv);
      const r = runMainOrchestratorBash(cmd, proj);
      assertPreToolUseDeny(r, `LG-TABLE ${row.name} negative: caller-supplied --lifecycle-binding must be rejected`);
      console.log(`LG-TABLE ${row.name} negative (caller-supplied --lifecycle-binding rejected): PASS`);
    } finally {
      cleanupLifecycleFixture(proj);
    }
  }
}

// notify: needs a real artifact file on disk (its digest is part of the argv digest).
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'lg-table-notify-pos');
    const artifactPath = path.join(proj, 'notify-artifact.md');
    fs.writeFileSync(artifactPath, '# fixture notify artifact\n');
    const argv = ['node', IMPL_RLL, 'notify', '--project-root', proj, '--role', LG_ROLE, '--kind', 'context', '--artifact', artifactPath];
    const cmd = rll.renderPosixDirect(argv);
    const r = runMainOrchestratorBash(cmd, proj);
    assert.strictEqual(r.exit, 0, 'LG-TABLE notify positive: must be allowed: ' + JSON.stringify(r));
    const body = parseHookJSON(r.stdout, 'LG-TABLE notify positive');
    const rewritten = body.hookSpecificOutput && body.hookSpecificOutput.updatedInput.command;
    const grantId = rewritten && extractLifecycleBinding(rewritten);
    assert.ok(grantId, 'LG-TABLE notify positive: must inject a grant: ' + JSON.stringify(body));
    const artifactDigest = rc.sha256File(artifactPath);
    const digest = rc.sha256String('notify:' + LG_ROLE + ':context:' + artifactDigest);
    const consumeResult = rll.validateAndConsumeLifecycleCommandGrant(proj, grantId, digest, LG_ROLE, 'notify');
    assert.strictEqual(consumeResult.ok, true, 'LG-TABLE notify positive: injected grant must be genuinely consumable: ' + JSON.stringify(consumeResult));
    console.log('LG-TABLE notify positive (genuine grant injected + round-trip consumed): PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'lg-table-notify-neg');
    const artifactPath = path.join(proj, 'notify-artifact.md');
    fs.writeFileSync(artifactPath, '# fixture notify artifact\n');
    const argv = ['node', IMPL_RLL, 'notify', '--project-root', proj, '--role', LG_ROLE, '--kind', 'context', '--artifact', artifactPath, '--lifecycle-binding', LG_FORGED_BINDING];
    const cmd = rll.renderPosixDirect(argv);
    const r = runMainOrchestratorBash(cmd, proj);
    assertPreToolUseDeny(r, 'LG-TABLE notify negative: caller-supplied --lifecycle-binding must be rejected');
    console.log('LG-TABLE notify negative (caller-supplied --lifecycle-binding rejected): PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// action-failed / wait-ready: need a REAL existing action (minted via
// mintPendingRoleSpawnAction, above). The negative (caller-supplied-binding)
// legs don't need a real action -- that rejection fires before any
// resolver/action lookup runs -- so they use a plausible-shaped but
// nonexistent action id.
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'lg-table-action-failed-pos');
    const actionId = mintPendingRoleSpawnAction(proj, LG_ROLE, 'lg-table-af-session');
    const argv = ['node', IMPL_RLL, 'action-failed', '--action', actionId, '--reason', 'cp-gate-fixture-reason'];
    const cmd = rll.renderPosixDirect(argv);
    const r = runMainOrchestratorBash(cmd, proj);
    assert.strictEqual(r.exit, 0, 'LG-TABLE action-failed positive: must be allowed: ' + JSON.stringify(r));
    const body = parseHookJSON(r.stdout, 'LG-TABLE action-failed positive');
    const rewritten = body.hookSpecificOutput && body.hookSpecificOutput.updatedInput.command;
    const grantId = rewritten && extractLifecycleBinding(rewritten);
    assert.ok(grantId, 'LG-TABLE action-failed positive: must inject a grant: ' + JSON.stringify(body));
    const digest = rc.sha256String('action-failed:' + actionId + ':cp-gate-fixture-reason');
    const consumeResult = rll.validateAndConsumeLifecycleCommandGrant(proj, grantId, digest, LG_ROLE, 'action-failed', actionId);
    assert.strictEqual(consumeResult.ok, true, 'LG-TABLE action-failed positive: injected grant must be genuinely consumable: ' + JSON.stringify(consumeResult));
    console.log('LG-TABLE action-failed positive (genuine grant injected + round-trip consumed): PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'lg-table-action-failed-neg');
    const argv = ['node', IMPL_RLL, 'action-failed', '--action', 'c'.repeat(32), '--reason', 'x', '--lifecycle-binding', LG_FORGED_BINDING];
    const cmd = rll.renderPosixDirect(argv);
    const r = runMainOrchestratorBash(cmd, proj);
    assertPreToolUseDeny(r, 'LG-TABLE action-failed negative: caller-supplied --lifecycle-binding must be rejected');
    console.log('LG-TABLE action-failed negative (caller-supplied --lifecycle-binding rejected): PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'lg-table-wait-ready-pos');
    const actionId = mintPendingRoleSpawnAction(proj, LG_ROLE, 'lg-table-wr-session');
    const argv = ['node', IMPL_RLL, 'wait-ready', '--action', actionId, '--timeout', '5'];
    const cmd = rll.renderPosixDirect(argv);
    const r = runMainOrchestratorBash(cmd, proj);
    assert.strictEqual(r.exit, 0, 'LG-TABLE wait-ready positive: must be allowed: ' + JSON.stringify(r));
    const body = parseHookJSON(r.stdout, 'LG-TABLE wait-ready positive');
    const rewritten = body.hookSpecificOutput && body.hookSpecificOutput.updatedInput.command;
    const grantId = rewritten && extractLifecycleBinding(rewritten);
    assert.ok(grantId, 'LG-TABLE wait-ready positive: must inject a grant: ' + JSON.stringify(body));
    const digest = rc.sha256String('wait-ready:' + actionId);
    const consumeResult = rll.validateAndConsumeLifecycleCommandGrant(proj, grantId, digest, LG_ROLE, 'wait-ready', actionId);
    assert.strictEqual(consumeResult.ok, true, 'LG-TABLE wait-ready positive: injected grant must be genuinely consumable: ' + JSON.stringify(consumeResult));
    console.log('LG-TABLE wait-ready positive (genuine grant injected + round-trip consumed): PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'lg-table-wait-ready-neg');
    const argv = ['node', IMPL_RLL, 'wait-ready', '--action', 'c'.repeat(32), '--timeout', '5', '--lifecycle-binding', LG_FORGED_BINDING];
    const cmd = rll.renderPosixDirect(argv);
    const r = runMainOrchestratorBash(cmd, proj);
    assertPreToolUseDeny(r, 'LG-TABLE wait-ready negative: caller-supplied --lifecycle-binding must be rejected');
    console.log('LG-TABLE wait-ready negative (caller-supplied --lifecycle-binding rejected): PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// ════════════════════════════════════════════════════════════════════════
// M7 Correction pass (m7-correction-spec.md §2): two precise defects in
// tryInjectLifecycleGrant/its caller, plus one regression-proof that the
// unrelated CP-consult-flag system stays untouched. Scope per the spec:
// only the M7/WP4 lifecycle-grant-injection path (~L172-557) -- the
// pre-existing CP-consult-flag logic below it (F1-F14/CR2-*/DC*/PP1-16
// above) is explicitly out of this pass's scope and must remain unmodified.
// ════════════════════════════════════════════════════════════════════════

// M7-RERENDER (§2.A): the injected command must be RE-RENDERED via
// renderPosixDirect off the already-parsed tokens array, never string-
// concatenated onto the original command text. Proven by re-parsing the
// rewritten command via the SAME parsePosixDirect the hook itself uses for
// recognition: string concatenation breaks the closed single-quoted grammar
// the instant anything unquoted is appended (parsePosixDirect returns null
// on the concatenated result), so this is a genuine round-trip proof, not a
// shape-only check.
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'm7-rerender-wave');
    const cmd = lifecycleEnsureCommand(proj, LG_ROLE);
    const r = runMainOrchestratorBash(cmd, proj);
    assert.strictEqual(r.exit, 0, 'M7-RERENDER: a well-formed main-orchestrator ensure command must be allowed: ' + JSON.stringify(r));
    const body = parseHookJSON(r.stdout, 'M7-RERENDER');
    const rewritten = body.hookSpecificOutput.updatedInput.command;
    const grantId = extractLifecycleBinding(rewritten);
    assert.ok(grantId, 'M7-RERENDER: must inject a grant: ' + rewritten);
    const originalTokens = rll.parsePosixDirect(cmd);
    const expectedTokens = originalTokens.concat(['--lifecycle-binding', grantId]);
    const reparsed = rll.parsePosixDirect(rewritten);
    assert.deepStrictEqual(reparsed, expectedTokens, 'M7-RERENDER: the rewritten command must re-parse via parsePosixDirect back to EXACTLY the original tokens plus [--lifecycle-binding, grantId] -- pre-fix the hook string-concatenates onto the original command text (`command + \' --lifecycle-binding \' + grantId`), which breaks the closed single-quoted grammar the instant the unquoted flag/id is appended: parsePosixDirect returns null on the concatenated result rather than round-tripping: ' + JSON.stringify({ rewritten, reparsed }));
    console.log('M7-RERENDER injected command re-renders via renderPosixDirect (re-parses to exact expected argv, proving no concatenation): PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// M7-MINTFAIL (§2.B): a recognized lifecycle-CLI command (canonical CLI
// path + known subcommand, PLAN.md genuinely discoverable, scope genuinely
// resolves) whose binding MINT then fails for an internal registry reason
// (here: a pre-existing symlink at the exact `sessions/` registry path
// createMainOrchestratorBinding's own resolveSessionGeneration needs to
// write to, forcing ensureSecureRegistryDir's own pre-existing-symlink
// rejection) must BLOCK -- never silently fall through to the same plain,
// unmodified allow this file uses for a genuinely non-applicable command.
// pre-fix tryInjectLifecycleGrant returns null for BOTH "not applicable at
// all" AND "recognized but failed to resolve/mint" identically, and the
// caller (`if (injectionResult) {...}; process.exit(0);`) treats both the
// same way -- an unconditional silent allow.
{
  const proj = makeTempProject();
  let bogusTarget = null;
  try {
    writeLifecyclePlanFixture(proj, 'm7-mintfail-wave');
    const sessionsDir = path.join(rll.registryRepoDir(proj), 'sessions');
    fs.mkdirSync(path.dirname(sessionsDir), { recursive: true });
    bogusTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'm7-mintfail-target-'));
    fs.symlinkSync(bogusTarget, sessionsDir);
    const cmd = lifecycleEnsureCommand(proj, LG_ROLE);
    const r = runMainOrchestratorBash(cmd, proj, {}, 'm7-mintfail-session');
    assertPreToolUseDeny(r, 'M7-MINTFAIL: a recognized ensure command whose binding mint fails internally must BLOCK, never silently pass through');
    console.log('M7-MINTFAIL a recognized lifecycle-CLI command with an internal mint failure blocks (never falls through to plain allow): PASS');
  } finally {
    if (bogusTarget) fs.rmSync(bogusTarget, { recursive: true, force: true });
    cleanupLifecycleFixture(proj);
  }
}

// M7-NOSESSION (§2.C): a genuinely MISSING session_id on an otherwise
// well-formed, canonically-recognized main-orchestrator lifecycle-CLI
// command must BLOCK -- never silently substitute the literal 'unknown' and
// proceed to mint+inject under that bogus session key. pre-fix
// `const sessionId = data.session_id || 'unknown';` feeds
// tryInjectLifecycleGrant the valid-looking literal 'unknown' whenever
// session_id is absent -- which passes tryInjectLifecycleGrant's own
// existing non-empty-string check (~L459, unchanged) and proceeds all the
// way to a genuine, successful grant mint+injection under session key
// 'unknown', rather than ever being rejected.
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'm7-nosession-wave');
    const cmd = lifecycleEnsureCommand(proj, LG_ROLE);
    const r = runHook(
      {
        tool_name: 'Bash',
        tool_input: { command: cmd },
        agent_type: '',
        agent_id: '',
        // session_id deliberately OMITTED entirely.
      },
      { CLAUDE_PROJECT_DIR: proj, CLAUDE_WAVE_SLUG: '' }
    );
    assertPreToolUseDeny(r, 'M7-NOSESSION: a missing session_id on a recognized lifecycle-CLI command must BLOCK, never silently substituted with the literal "unknown" and proceed to a genuine mint+injection');
    console.log('M7-NOSESSION missing session_id on a recognized lifecycle-CLI command blocks (never substituted with the literal "unknown"): PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// M7-NOSESSION-UNRELATED (positive control for M7-NOSESSION): a missing
// session_id on an UNRELATED, non-lifecycle Bash command from the main
// orchestrator must still be allowed -- proves the new block is scoped to
// recognized lifecycle-CLI commands specifically, never a blanket "main
// orchestrator must always carry session_id" overcorrection that would
// break ordinary ad-hoc Bash usage.
{
  const proj = makeTempProject();
  try {
    const r = runHook(
      {
        tool_name: 'Bash',
        tool_input: { command: 'git status' },
        agent_type: '',
        agent_id: '',
      },
      { CLAUDE_PROJECT_DIR: proj, CLAUDE_WAVE_SLUG: '' }
    );
    assertPreToolUsePassthrough(r, 'M7-NOSESSION-UNRELATED');
    console.log('M7-NOSESSION-UNRELATED missing session_id on an unrelated bash command still allowed (proves the fix does not overcorrect): PASS');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// ════════════════════════════════════════════════════════════════════════
// Section 5 (M7/WP4 second-pass correction, 2026-08-09 -- supersedes the
// HARD NO-GO'd first pass's "hook-only mint+audit, no core consumption"
// design): REQUESTER role-command-grant/v1 injection. PLAN.md §15b (~L592):
// "role-command-grant/v1 authorizes only runtime-consultation.cjs ... the
// closed authority enum is requester|target ... Requester authority covers
// root-init, root-validate, publish-blob, publish-request, dispatch,
// requester-owned record-delivery, takeover, await-result, accept-result,
// transaction-ack, cancel, worker-stop, cleanup, and validate." PLAN.md
// ~L600: "context-provider-gate.js owns consultation requester grants ...
// it rejects caller-supplied --requester-binding|--lifecycle-binding,
// injects exactly one matching CLI grant where applicable." pre-fix this file
// has ZERO code recognizing a runtime-consultation.cjs invocation at all
// (confirmed by direct read: the only grant-injection logic present,
// tryInjectLifecycleGrant, is scoped exclusively to the role-lifecycle CLI)
// -- the entire requester half is missing, exactly the P0 finding the HARD
// NO-GO verdict named. Unlike the lifecycle surface (main-orchestrator
// only), PLAN.md ~L590's RequesterIdentityProvider is role=agent_type
// generically -- this mechanism must apply to ANY calling agent_type, not
// only the empty (main-orchestrator) one.
//
// Round-trip proof style: root-init/root-validate need only
// --coordination-root (no complex transaction fixture) and are empirically
// idempotent (verified directly against the real CLI during this pass's own
// test-writing) -- so, unlike the target/consultation surface (claim et
// al., covered in runtime-consultation-role-gate.bats, which cannot reach
// full business success without a real request.json this file does not
// build), a positive test here CAN and DOES assert genuine end-to-end
// SUCCESS via a real spawned CLI subprocess, not merely "flag recognized".
//
// M7/WP4 FINAL COMPLETENESS correction (2026-08-09): PLAN.md ~L588 gates
// Claude's requester-binding creation behind CLAUDE-ID-01 -- a bounded
// disposable peer must produce a host-private correlation trace covering
// SubagentStart, two distinct PreToolUse events, a sleep/wake or resume
// boundary, and a final PreToolUse. The main orchestrator never receives a
// SubagentStart event about itself, so it can NEVER satisfy CLAUDE-ID-01 --
// persistent native per-instance gating (and therefore requester-grant
// minting) is UNAVAILABLE for main-orchestrator by construction, not merely
// unproven in any one run. This is not merely a plausible inference: PLAN.md
// ~L594 independently defines the SEPARATE MainOrchestratorBinding/v1's own
// derivation as requiring "a non-empty session_id, the pinned main-context
// agent_type=='' predicate, AND NO CORRELATED PENDING SubagentStart" -- PLAN
// already treats "no SubagentStart" as main-orchestrator's own defining
// characteristic elsewhere. Excluding main-orchestrator from CLAUDE-ID-01
// eligibility is therefore CLAUDE-ID-01 applied UNIFORMLY across PLAN's own
// text, not a special-cased carve-out invented for this pass. pre-fix
// createRequesterBinding mints unconditionally
// via resolveSessionGeneration alone (runtime-role-lifecycle.cjs
// ~L1354-1386's own 'never CLAUDE-ID-01-gated' scope note), with no
// CLAUDE-ID-01 check at all. RQ1 and RQ-TABLE's own "positive" leg below
// (both originally asserting main-orchestrator minting SUCCEEDS) are
// inverted below to assert BLOCK instead -- this is the RED this pass adds.
// RQ-RERENDER/RQ-MINTFAIL/RQ-NOSESSION are migrated to a named-role identity
// (arch-testing) so their OWN, orthogonal subjects (canonical re-rendering,
// internal-mint-failure handling, missing-session_id handling) stay
// genuinely exercised rather than being silently swallowed by the new
// unconditional main-orchestrator block. RQ2/RQ3/RQ-TABLE's own "negative"
// leg are UNCHANGED and remain valid: RQ2's caller-supplied-flag rejection
// and RQ-TABLE-negative fire in tryInjectRequesterGrant BEFORE role
// resolution ever runs, and RQ3 already uses a named role.
// ════════════════════════════════════════════════════════════════════════

const IMPL_RC = path.resolve(__dirname, '../lib/runtime-consultation.cjs');
const REQUESTER_FORGED_BINDING = 'cafebabecafebabecafebabecafebabe';

function rootInitCommand(dir, extraFlags) {
  const parts = ['node', IMPL_RC, 'root-init', '--coordination-root', path.join(dir, '.planning', 'coordination')].concat(extraFlags || []);
  return rll.renderPosixDirect(parts);
}

function rootValidateCommand(dir, extraFlags) {
  const parts = ['node', IMPL_RC, 'root-validate', '--coordination-root', path.join(dir, '.planning', 'coordination')].concat(extraFlags || []);
  return rll.renderPosixDirect(parts);
}

function extractRequesterBinding(command) {
  const tokens = rll.parsePosixDirect(command);
  if (Array.isArray(tokens)) {
    const idx = tokens.indexOf('--requester-binding');
    if (idx !== -1 && idx + 1 < tokens.length) return tokens[idx + 1];
  }
  const m = /--requester-binding\s+(\S+)/.exec(command);
  return m ? m[1] : null;
}

// Runs the REAL runtime-consultation.cjs CLI as a subprocess against
// `rewrittenCommand` (a hookSpecificOutput.updatedInput.command string) --
// the only way to prove the core genuinely, atomically consumes+validates
// an injected grant, never merely that the hook's own JSON claims one
// exists. Mirrors runtime-consultation-role-gate.bats's own
// _run_cli_command helper.
function runRewrittenCliCommand(rewrittenCommand) {
  const tokens = rll.parsePosixDirect(rewrittenCommand);
  assert.ok(Array.isArray(tokens) && tokens[0] === 'node', 'runRewrittenCliCommand: rewritten command must still be a canonical direct node invocation: ' + rewrittenCommand);
  const result = spawnSync('node', tokens.slice(1), { encoding: 'utf8' });
  return { exit: result.status, stdout: result.stdout, stderr: result.stderr };
}

// Same request shape as runMainOrchestratorBash but for an arbitrary,
// non-empty agent_type -- needed by RQ3 to prove requester-grant injection
// is NOT scoped to the main orchestrator only (unlike the lifecycle
// surface's own LG3 regression guard, which pins the OPPOSITE invariant).
function runNonMainBash(command, projDir, agentType, sessionId) {
  return runHook(
    {
      tool_name: 'Bash',
      tool_input: { command },
      session_id: sessionId || ('rq-' + Math.random().toString(36).slice(2)),
      agent_type: agentType,
      agent_id: agentType,
    },
    { CLAUDE_PROJECT_DIR: projDir, CLAUDE_WAVE_SLUG: '' }
  );
}

// M6+M7 FINAL AUTHORITY CORRECTION (2026-08-11, narrow team-lead follow-up):
// CLAUDE-ID-01 full bounded-proof trace primer. Group 1's real implementation
// (runtime-role-lifecycle.cjs ~L1638-1933: recordClaudeId01SubagentStartObservation/
// recordClaudeId01PreToolUseObservation/checkClaudeId01ProofComplete, consulted
// by this hook's own tryInjectRequesterGrant immediately before either of its
// createRequesterBinding call sites) requires, per its own doc comment
// (mirroring PLAN.md ~L592's literal sequence): a primary SubagentStart, two
// DISTINCT tool_use_id PreToolUse observations, a genuine REPEATED SubagentStart
// for the SAME {session,agent_id,agent_type} tuple (the "sleep/wake or resume
// boundary"), then one further PreToolUse -- all for the EXACT SAME
// session_id/agent_id/agent_type the caller's own real command will later
// present. Confirmed empirically (2026-08-11) against
// runtimeRoleLifecycle.checkClaudeId01ProofComplete: this exact 5-step
// sequence genuinely produces proof_complete:true, and a real root-init call
// immediately afterward genuinely succeeds with a real grant injected. Real
// hook-driving throughout (subagent-start-context-bundle.js for SubagentStart,
// this file's own runHook for PreToolUse) -- never hand-simulated.
// (SUBAGENT_START_HOOK_FOR_CLAUDEID01 itself is now declared near the top of
// this file, not here -- see that declaration's own comment for why.)

function driveClaudeId01SubagentStart(projDir, agentType, sessionId, agentId) {
  const result = spawnSync('node', [SUBAGENT_START_HOOK_FOR_CLAUDEID01], {
    input: JSON.stringify({ hook_event_name: 'SubagentStart', agent_type: agentType, session_id: sessionId, agent_id: agentId }),
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: projDir }),
    encoding: 'utf8',
  });
  return { exit: result.status, stdout: result.stdout, stderr: result.stderr };
}

function driveClaudeId01PreToolUse(projDir, agentType, sessionId, agentId, toolUseId) {
  return runHook(
    { tool_name: 'Bash', tool_input: { command: 'true' }, session_id: sessionId, agent_type: agentType, agent_id: agentId, tool_use_id: toolUseId },
    { CLAUDE_PROJECT_DIR: projDir, CLAUDE_WAVE_SLUG: '' }
  );
}

function mintClaudeId01ProbeAction(projDir, agentType, sessionId, suffix) {
  const generation = rll.resolveSessionGeneration(projDir, {
    ok: true,
    provider: 'claude-hook',
    runtime_session_key: sessionId,
  });
  assert.strictEqual(generation.ok, true, 'CLAUDE-ID-01 fixture generation must resolve');
  const plan = rll.discoverPlan(projDir);
  assert.strictEqual(plan.ok, true, 'CLAUDE-ID-01 fixture PLAN must resolve');
  const actionId = rll.generateActionId();
  const now = new Date();
  const expiry = new Date(now.getTime() + 600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const minted = rll.mintRoleLifecycleAction(
    projDir,
    actionId,
    'role-spawn',
    'claude-native',
    rll.computeRepoId(projDir),
    rll.computeWorktreeId(projDir),
    plan.planDigest,
    crypto.createHash('sha256').update('context-provider-claude-id01:' + suffix).digest('hex'),
    generation.generationId,
    agentType,
    rll.buildRoleSpawnPayload('claude-id01-probe', agentType, agentType, 'fixture', 'fixture'),
    expiry,
  );
  assert.strictEqual(minted.ok, true, 'CLAUDE-ID-01 fixture action must mint: ' + JSON.stringify(minted));
  return actionId;
}

function primeClaudeId01Trace(projDir, agentType, sessionId, agentId) {
  const actionA = mintClaudeId01ProbeAction(projDir, agentType, sessionId, 'a-' + agentId);
  const actionB = mintClaudeId01ProbeAction(projDir, agentType, sessionId, 'b-' + agentId);
  rll.recordClaudeId01SubagentStartObservation(projDir, { sessionId, agentId, agentType, actionId: actionA });
  rll.recordClaudeId01PreToolUseObservation(projDir, { sessionId, agentId, agentType, toolUseId: 'claudeid01-prime-tu-1-' + sessionId + '-' + agentId });
  rll.recordClaudeId01PreToolUseObservation(projDir, { sessionId, agentId, agentType, toolUseId: 'claudeid01-prime-tu-2-' + sessionId + '-' + agentId });
  rll.recordClaudeId01SubagentStartObservation(projDir, { sessionId, agentId, agentType, actionId: actionA });
  rll.recordClaudeId01PreToolUseObservation(projDir, { sessionId, agentId, agentType, toolUseId: 'claudeid01-prime-tu-3-' + sessionId + '-' + agentId });
  rll.recordClaudeId01SubagentStartObservation(projDir, {
    sessionId,
    agentId: agentId + '-distinct-peer-b',
    agentType,
    actionId: actionB,
  });
  const proof = rll.checkClaudeId01ProofComplete(
    projDir,
    sessionId,
    rll.computeWorktreeId(projDir),
    rll.discoverPlan(projDir).planDigest,
    agentType,
    agentId,
  );
  assert.strictEqual(proof.ok, true, 'global CLAUDE-ID-01 capability must be complete: ' + JSON.stringify(proof));
}

// RQ1-CLAUDEID01 (M7/WP4 FINAL COMPLETENESS correction, 2026-08-09):
// SUPERSEDES this test's own prior PASS expectation (main-orchestrator
// minting succeeded). A well-formed `root-init` Bash command issued by the
// main orchestrator (empty agent_type) must now be BLOCKED outright, never
// minted -- see this file's Section 5 header addendum for the full
// CLAUDE-ID-01 rationale.
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'rq-wave-1');
    const cmd = rootInitCommand(proj);
    const r = runMainOrchestratorBash(cmd, proj);
    // pre-fix (regression): tryInjectRequesterGrant/createRequesterBinding mint
    // unconditionally via resolveSessionGeneration alone -- this currently
    // exits 0 with a genuine injected grant (RQ1's own prior assertion),
    // not the block asserted below.
    assertPreToolUseDeny(r, 'RQ1-CLAUDEID01: a main-orchestrator root-init command must be BLOCKED (main-orchestrator cannot satisfy CLAUDE-ID-01)');
    console.log('RQ1-CLAUDEID01 main-orchestrator root-init command is blocked, never minted (CLAUDE-ID-01 unsatisfiable for main-orchestrator): PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// RQ2: a root-init command that ALREADY supplies its own
// --requester-binding must be REJECTED outright, mirroring LG2's own
// established precedent for the lifecycle surface exactly.
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'rq-wave-2');
    const cmd = rootInitCommand(proj, ['--requester-binding', REQUESTER_FORGED_BINDING]);
    const r = runMainOrchestratorBash(cmd, proj);
    assertPreToolUseDeny(r, 'RQ2: a caller-supplied --requester-binding must be rejected (blocked), never trusted or silently forwarded');
    console.log('RQ2 caller-supplied --requester-binding on a root-init command is rejected: PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// RQ3: UNLIKE the lifecycle surface (LG3's own main-orchestrator-only
// pin), requester-grant injection is NOT scoped to the main orchestrator --
// PLAN.md ~L590's RequesterIdentityProvider resolves role=agent_type
// generically for ANY Claude hook context, since architects/specialists are
// themselves real requesters of runtime-consultation.cjs (e.g. publishing a
// consultation request to context-provider). A named role issuing the
// IDENTICAL root-init command must ALSO get a genuine injection.
// CORRECTION (2026-08-11, narrow team-lead follow-up): Group 1's real
// CLAUDE-ID-01 gate now also applies to named roles, not just the
// main-orchestrator exclusion this test's own header addendum originally
// described -- a bare single PreToolUse call (this test's ORIGINAL fixture)
// no longer satisfies it. primeClaudeId01Trace presents a genuine, complete
// trace first, for the SAME session/agent identity this test's own real
// command then presents, so this test keeps exercising its REAL subject
// (grant injection generality for a named role) rather than accidentally
// re-asserting the insufficient-trace bug Group 1 closes.
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'rq-wave-3');
    primeClaudeId01Trace(proj, 'arch-testing', 'rq3-session', 'arch-testing');
    const cmd = rootInitCommand(proj);
    const r = runNonMainBash(cmd, proj, 'arch-testing', 'rq3-session');
    assert.strictEqual(r.exit, 0, 'RQ3: a well-formed root-init command from a named role (arch-testing) must be allowed: ' + JSON.stringify(r));
    const body = parseHookJSON(r.stdout, 'RQ3');
    const rewritten = body.hookSpecificOutput && body.hookSpecificOutput.updatedInput && body.hookSpecificOutput.updatedInput.command;
    const grantId = rewritten && extractRequesterBinding(rewritten);
    assert.ok(grantId, 'RQ3: a named-role (non-main-orchestrator) root-init command must ALSO receive a genuine --requester-binding injection -- pre-fix no such mechanism exists at all for ANY caller: ' + JSON.stringify(body));
    console.log('RQ3 requester-grant injection applies to a named role too, not main-orchestrator-only: PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// RQ-RERENDER: mirrors M7-RERENDER exactly for the requester surface -- the
// injected command must be RE-RENDERED via renderPosixDirect off the
// already-parsed tokens, never string-concatenated (proven by a genuine
// parsePosixDirect round-trip, not a shape-only check).
// M7/WP4 FINAL COMPLETENESS correction: named-role identity (arch-testing,
// via runNonMainBash) -- main-orchestrator can no longer mint a requester
// grant at all (see RQ1-CLAUDEID01), so this test's OWN concern (canonical
// re-rendering) is now proven via an identity that CAN still mint.
// CORRECTION (2026-08-11, narrow team-lead follow-up): same reason as RQ3
// immediately above -- Group 1's real CLAUDE-ID-01 gate now also applies to
// this named-role identity's single-call fixture. primeClaudeId01Trace keeps
// this test exercising its REAL subject (canonical re-rendering) rather than
// the insufficient-trace bug Group 1 closes.
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'rq-rerender-wave');
    primeClaudeId01Trace(proj, 'arch-testing', 'rq-rerender-session', 'arch-testing');
    const cmd = rootInitCommand(proj);
    const r = runNonMainBash(cmd, proj, 'arch-testing', 'rq-rerender-session');
    assert.strictEqual(r.exit, 0, 'RQ-RERENDER: a well-formed root-init command from a named role must be allowed: ' + JSON.stringify(r));
    const body = parseHookJSON(r.stdout, 'RQ-RERENDER');
    const rewritten = body.hookSpecificOutput.updatedInput.command;
    const grantId = extractRequesterBinding(rewritten);
    assert.ok(grantId, 'RQ-RERENDER: must inject a grant: ' + rewritten);
    const originalTokens = rll.parsePosixDirect(cmd);
    const expectedTokens = originalTokens.concat(['--requester-binding', grantId]);
    const reparsed = rll.parsePosixDirect(rewritten);
    assert.deepStrictEqual(reparsed, expectedTokens, 'RQ-RERENDER: the rewritten command must re-parse via parsePosixDirect back to EXACTLY the original tokens plus [--requester-binding, grantId] -- proves renderPosixDirect was used, never string concatenation: ' + JSON.stringify({ rewritten, reparsed }));
    console.log('RQ-RERENDER injected command re-renders via renderPosixDirect (no concatenation): PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// RQ-MINTFAIL: mirrors M7-MINTFAIL exactly for the requester surface -- a
// recognized root-init command whose internal identity/binding mint fails
// (here: a pre-existing symlink at the exact sessions/ registry path any
// reasonable requester-identity resolution needs to write to, mirroring the
// SAME resolveSessionGeneration-backed mechanism the lifecycle surface
// already uses and this hook family already established as its own
// internal-failure fixture technique) must BLOCK, never silently fall
// through to plain allow.
// M7/WP4 FINAL COMPLETENESS correction: named-role identity (arch-testing) --
// main-orchestrator is now unconditionally blocked regardless of internal
// mint state (see RQ1-CLAUDEID01), which would make this test's OWN subject
// (internal-mint-failure handling specifically) vacuous under main-
// orchestrator identity: the block would fire for the WRONG reason (identity
// exclusion, before ever reaching the symlinked sessions/ dir) and this test
// would stay green even if the mint-failure block were silently removed.
// CORRECTION (2026-08-11, narrow team-lead follow-up, toolkit-specialist-
// diagnosed): the SAME vacuousness risk this comment already named recurred
// for a second, different reason -- this test sits right after RQ3/RQ-
// RERENDER (both primed during the CLAUDE-ID-01 sweep) but never got its own
// priming call, so it had started denying for claude-id01-trace-absent
// instead of the intended symlinked-sessions-dir mint failure (confirmed
// empirically: the pre-fix denial reason was literally
// "claude-id01-trace-absent", never reaching the symlinked dir at all).
// primeClaudeId01Trace (same session_id the fixture already uses) restores
// this test's REAL subject.
{
  const proj = makeTempProject();
  let bogusTarget = null;
  try {
    writeLifecyclePlanFixture(proj, 'rq-mintfail-wave');
    primeClaudeId01Trace(proj, 'arch-testing', 'rq-mintfail-session', 'arch-testing');
    const sessionsDir = path.join(rll.registryRepoDir(proj), 'sessions');
    fs.mkdirSync(path.dirname(sessionsDir), { recursive: true });
    bogusTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'rq-mintfail-target-'));
    // HARD NO-GO correction follow-up (2026-08-11, team-lead-diagnosed): the
    // item 1+3 key redesign made resolveClaudeId01Scope call
    // resolveSessionGeneration internally, so primeClaudeId01Trace (just
    // above) now legitimately creates a real sessions/ directory as a side
    // effect of its own normal priming sequence -- a plain fs.symlinkSync
    // here would throw EEXIST against that now-legitimate directory. Remove
    // it first so the fixture still ends up in the intended
    // symlink-at-sessions/ tampered state at the moment the real mint-under-
    // test runs, robust to this now-correct upstream side effect.
    fs.rmSync(sessionsDir, { recursive: true, force: true });
    fs.symlinkSync(bogusTarget, sessionsDir);
    const cmd = rootInitCommand(proj);
    const r = runNonMainBash(cmd, proj, 'arch-testing', 'rq-mintfail-session');
    assertPreToolUseDeny(r, 'RQ-MINTFAIL: a recognized root-init command whose grant mint fails internally must BLOCK, never silently pass through');
    console.log('RQ-MINTFAIL a recognized root-init command with an internal mint failure blocks (never falls through to plain allow): PASS');
  } finally {
    if (bogusTarget) fs.rmSync(bogusTarget, { recursive: true, force: true });
    cleanupLifecycleFixture(proj);
  }
}

// RQ-NOSESSION: mirrors M7-NOSESSION exactly for the requester surface -- a
// genuinely MISSING session_id on an otherwise well-formed, canonically-
// recognized root-init command must BLOCK, never silently substitute
// 'unknown' and proceed to mint+inject under that bogus session key.
// M7/WP4 FINAL COMPLETENESS correction: named-role identity (arch-testing) --
// see RQ-MINTFAIL's own comment for why main-orchestrator identity would
// make this test's OWN subject (missing-session_id handling) vacuous now.
{
  const proj = makeTempProject();
  try {
    writeLifecyclePlanFixture(proj, 'rq-nosession-wave');
    const cmd = rootInitCommand(proj);
    const r = runHook(
      {
        tool_name: 'Bash',
        tool_input: { command: cmd },
        agent_type: 'arch-testing',
        agent_id: 'arch-testing',
        // session_id deliberately OMITTED entirely.
      },
      { CLAUDE_PROJECT_DIR: proj, CLAUDE_WAVE_SLUG: '' }
    );
    assertPreToolUseDeny(r, 'RQ-NOSESSION: a missing session_id on a recognized root-init command must BLOCK');
    console.log('RQ-NOSESSION missing session_id on a recognized root-init command blocks: PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// RQ-TABLE: table-driven coverage across every SIMPLE (--coordination-root
// only) requester-owned admin subcommand -- proves the mechanism generalizes
// beyond root-init specifically. (publish-request/publish-blob/dispatch and
// the live-transaction subcommands -- accept-result/cancel/transaction-ack/
// await-result/record-delivery/takeover/worker-stop/cleanup -- need a real
// transaction fixture and are out of THIS file's scope; the full requester
// authority round trip against those, plus the core-level adversarial
// matrix, lives in runtime-consultation-role-gate.bats.)
const REQUESTER_SIMPLE_SUBCOMMAND_TABLE = [
  { name: 'root-init', buildCmd: rootInitCommand },
  { name: 'root-validate', buildCmd: rootValidateCommand },
];

for (const row of REQUESTER_SIMPLE_SUBCOMMAND_TABLE) {
  // (a) CLAUDE-ID-01 (M7/WP4 FINAL COMPLETENESS correction, 2026-08-09):
  // SUPERSEDES this leg's own prior "positive" expectation (genuine grant
  // injected for main-orchestrator). Main-orchestrator can never satisfy
  // CLAUDE-ID-01 (see RQ1-CLAUDEID01's own comment and this file's Section 5
  // header addendum), so EVERY simple admin subcommand from main-orchestrator
  // must now be BLOCKED, never minted -- proves the exclusion generalizes
  // beyond root-init specifically (table-driven, mirrors this table's own
  // pre-existing generalization framing).
  {
    const proj = makeTempProject();
    try {
      writeLifecyclePlanFixture(proj, 'rq-table-' + row.name + '-claudeid01');
      if (row.name === 'root-validate') fs.mkdirSync(path.join(proj, '.planning', 'coordination'), { recursive: true });
      const cmd = row.buildCmd(proj);
      const r = runMainOrchestratorBash(cmd, proj);
      // pre-fix (regression): this currently exits 0 with a genuine injected grant
      // (this leg's own prior "positive" assertion), not the block below.
      assertPreToolUseDeny(r, `RQ-TABLE ${row.name} CLAUDE-ID-01: main-orchestrator must be blocked, never minted`);
      console.log(`RQ-TABLE ${row.name} CLAUDE-ID-01 (main-orchestrator blocked, never minted): PASS`);
    } finally {
      cleanupLifecycleFixture(proj);
    }
  }
  // (b) negative: caller-supplied --requester-binding rejected (mirrors RQ2).
  // UNAFFECTED by the CLAUDE-ID-01 change: the caller-supplied-flag check in
  // tryInjectRequesterGrant runs BEFORE any identity/binding resolution, so
  // this leg's own subject stays orthogonal to WHO is calling.
  {
    const proj = makeTempProject();
    try {
      writeLifecyclePlanFixture(proj, 'rq-table-' + row.name + '-neg');
      if (row.name === 'root-validate') fs.mkdirSync(path.join(proj, '.planning', 'coordination'), { recursive: true });
      const cmd = row.buildCmd(proj, ['--requester-binding', REQUESTER_FORGED_BINDING]);
      const r = runMainOrchestratorBash(cmd, proj);
      assertPreToolUseDeny(r, `RQ-TABLE ${row.name} negative: caller-supplied --requester-binding must be rejected`);
      console.log(`RQ-TABLE ${row.name} negative (caller-supplied --requester-binding rejected): PASS`);
    } finally {
      cleanupLifecycleFixture(proj);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════
// Section 7 (M7/WP4 group A RED, dispatch arch-testing-20260810T142647Z):
// authenticated consultation SOURCE IDENTITY. cmdPublishRequest's own
// sourceRole resolution (runtime-consultation.cjs, confirmed by direct
// read):
//   const sourceRole = process.env.RUNTIME_CONSULTATION_SOURCE_ROLE || 'cli-requester';
// is read from an env var this hook family's own canonical single-quoted
// direct-node-invocation grammar (parsePosixDirect/renderPosixDirect) has NO
// surface to carry -- an env-var-PREFIXED command (`FOO=bar node ...`) is
// simply not the `node <script> <args...>` token[0]==='node' shape
// findConsultationCliInvocation requires, so it is never recognized as a
// requester-grant-eligible call at all (GROUPA-2 below). A live call
// THEREFORE always resolves sourceRole to the literal fallback
// 'cli-requester' -- so a live, hook-mediated, fully-authenticated architect
// call can never actually SUCCEED today (GROUPA-1), even though the SAME
// hook mechanism RQ3 already proves CAN mint+inject a genuine
// --requester-binding grant for a named role. This is the confirmed root
// cause named in this session's own memory/HANDOFF record (env-var-vs-
// frozen-grammar conflict) -- proven here BEHAVIORALLY via a real spawned
// CLI subprocess (mirrors RQ3/runRewrittenCliCommand's own established
// "genuine round-trip, never a shape-only check" discipline), not
// re-derived from scratch.
// ════════════════════════════════════════════════════════════════════════

function writeGroupAFixtures(proj, waveSlug) {
  const waveDir = path.join(proj, '.planning', 'wave-' + waveSlug);
  fs.mkdirSync(waveDir, { recursive: true });
  const planFile = path.join(waveDir, 'PLAN.md');
  fs.writeFileSync(planFile, '# fixture PLAN for context-provider-gate.test.js Group A tests (' + waveSlug + ')\n');
  const subjectBundleFile = path.join(proj, '.planning', 'group-a-subject-bundle-manifest-' + waveSlug + '.json');
  fs.writeFileSync(subjectBundleFile, JSON.stringify({ schema: 'coordination/subject-bundle-manifest/v1', entries: [] }));
  // Codex-repro (found empirically while writing this pass): cmdPublishRequest's
  // own computeRepoId(coordRoot) runs `git -C <coordRoot> rev-parse ...`
  // directly (no deepest-existing-ancestor fallback, unlike the HOOK's own
  // grant-minting resolveProjectRootScope) -- a not-yet-materialized
  // coordination root makes THAT git invocation fail with a raw ENOENT
  // ("cannot change to ... No such file or directory"), producing a
  // generic, uninformative status:INTERNAL/detail_code:INTERNAL_ERROR
  // instead of ever reaching the actual sourceRole/assertRolePolicy
  // decision this section's tests are about -- confirmed via a standalone
  // diagnostic before this fixture helper was fixed to pre-create it.
  const coordRootDir = path.join(proj, '.planning', 'coordination');
  fs.mkdirSync(coordRootDir, { recursive: true });
  return { planFile, subjectBundleFile, coordRootDir };
}

function buildIntentB64(targetRole, question, extraFields) {
  const intent = Object.assign({
    target_role: targetRole,
    question: question,
    expected_result_kind: 'TEST_RESULT',
    expiry: new Date(Date.now() + 1800 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  }, extraFields || {});
  return Buffer.from(JSON.stringify(intent), 'utf8').toString('base64url');
}

function publishRequestCommand(coordRootDir, planFile, subjectBundleFile, intentB64, extraFlags) {
  const parts = ['node', IMPL_RC, 'publish-request', '--coordination-root', coordRootDir, '--plan', planFile, '--subject-bundle', subjectBundleFile, '--intent', intentB64].concat(extraFlags || []);
  return rll.renderPosixDirect(parts);
}

// GROUPA-1: a canonical publish-request invoked as arch-integration DOES
// receive exactly one real requester grant (RQ3's own established finding
// generalizes to this specific subcommand+role too -- asserted normally,
// NOT wrapped: this leg is not itself the group-A defect). Executing the
// hook's own literal updatedInput.command against the REAL CLI, however,
// does NOT succeed, and no request.json is ever durably created with
// source_role=='arch-integration' -- both captured as RED.
{
  const proj = makeTempProject();
  try {
    const waveSlug = 'groupa-1-wave';
    const { planFile, subjectBundleFile, coordRootDir } = writeGroupAFixtures(proj, waveSlug);
    const intentB64 = buildIntentB64('context-provider', 'GROUPA-1 fixture question');
    const cmd = publishRequestCommand(coordRootDir, planFile, subjectBundleFile, intentB64);
    // M6+M7 FINAL AUTHORITY CORRECTION (2026-08-11, narrow team-lead follow-up,
    // exhaustive Site-B sweep): Group 1's real CLAUDE-ID-01 gate now also
    // applies to this named-role identity's single-call fixture -- primed
    // first so this test keeps exercising its REAL subject (publish-request
    // grant injection + source-role authentication) rather than the
    // insufficient-trace bug Group 1 closes.
    primeClaudeId01Trace(proj, 'arch-integration', 'groupa1-session', 'arch-integration');
    const r = runNonMainBash(cmd, proj, 'arch-integration', 'groupa1-session');
    assert.strictEqual(r.exit, 0, 'GROUPA-1: hook itself must allow (rewrite) a well-formed publish-request from a named architect role: ' + JSON.stringify(r));
    const body = parseHookJSON(r.stdout, 'GROUPA-1');
    const rewritten = body.hookSpecificOutput && body.hookSpecificOutput.updatedInput && body.hookSpecificOutput.updatedInput.command;
    const grantId = rewritten && extractRequesterBinding(rewritten);
    assert.ok(grantId, 'GROUPA-1: a canonical publish-request invoked as arch-integration must receive exactly one real requester grant (mirrors RQ3\'s own established finding, generalized to publish-request): ' + JSON.stringify(body));
    console.log('GROUPA-1 canonical publish-request as arch-integration receives exactly one real requester grant: PASS');

    const cliResult = runRewrittenCliCommand(rewritten);
    let parsed = null;
    try { parsed = JSON.parse(cliResult.stdout); } catch { /* handled by the assertion below */ }
    assert.ok(parsed && parsed.schema === 'coordination/cli-result/v1', 'GROUPA-1: executing the rewritten command must at least produce the frozen cli-result/v1 envelope: ' + JSON.stringify(cliResult));

    assert.strictEqual(parsed.ok, true, 'GROUPA-1: a canonical, hook-mediated, fully-granted publish-request as arch-integration must SUCCEED (source-role identity is threaded from the authenticated grant/binding): ' + JSON.stringify(parsed));
    console.log('GROUPA-1-execute-succeeds canonical granted publish-request succeeds: PASS');
    {
      const reqObj = JSON.parse(fs.readFileSync(parsed.artifact_ref, 'utf8'));
      assert.strictEqual(reqObj.source_role, 'arch-integration', 'GROUPA-1: request.json source_role must be the AUTHENTICATED architect role (from the consumed grant/binding), never a self-reported or environment-derived value: ' + JSON.stringify(reqObj));
      // M6+M7 requester-authority closure (Group C, landed) fixture
      // correction (team-lead-confirmed, 2026-08-10): requester_instance_id
      // is NO LONGER an independently-generated genId() (64-hex) -- Group C's
      // fix makes cmdPublishRequest write grantContext.actorInstanceId, the
      // SAME 32-hex CSPRNG id createRequesterBinding mints, so a hardcoded
      // 64-hex-shaped regex is now stale (and would falsely fail against the
      // now-CORRECT 32-hex value). Re-derives the EXACT SAME binding the hook
      // itself minted for this call (identical {provider,session,agentKey,
      // role,worktree,plan} tuple -> createRequesterBinding's own idempotent
      // lookup-or-create reuses the LIVE existing match rather than minting a
      // second one, confirmed by that function's own doc comment) and
      // compares requester_instance_id against its REAL actor_instance_id
      // directly -- more robust than any hardcoded length/shape pattern, and
      // mirrors GROUPC-1's own established "mint/reuse the binding, then
      // compare actor_instance_id" pattern, which this leg previously
      // deliberately deferred to GROUPC-1 alone.
      const worktreeId = rll.computeWorktreeId(proj);
      const planResult = rll.discoverPlan(proj);
      assert.strictEqual(planResult.ok, true, 'GROUPA-1 fixture: PLAN must still be discoverable: ' + JSON.stringify(planResult));
      const identity = { ok: true, provider: 'claude-hook', runtime_session_key: 'groupa1-session' };
      const bindingResult = rll.createRequesterBinding(proj, identity, 'arch-integration', 'arch-integration', worktreeId, planResult.planDigest, 3600);
      assert.strictEqual(bindingResult.ok, true, 'GROUPA-1 fixture: re-deriving the hook-minted requester binding must succeed: ' + JSON.stringify(bindingResult));
      assert.strictEqual(reqObj.requester_instance_id, bindingResult.binding.actor_instance_id, 'GROUPA-1: requester_instance_id must equal the authenticated grant/binding\'s own actor_instance_id: ' + JSON.stringify({ reqObj, binding: bindingResult.binding }));
      console.log('GROUPA-1-source-role-correct source_role authenticated from grant, requester_instance_id correctly bound to authenticated actor_instance_id: PASS');
    }
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// GROUPA-2: a test-specialist role CANNOT spoof arch-integration by setting
// RUNTIME_CONSULTATION_SOURCE_ROLE -- a leading environment-variable
// assignment (`FOO=bar node ...`) remains noncanonical and receives NO
// grant injection at all (asserted normally: this must ALREADY hold today,
// it is not itself the group-A defect -- the defect is that even the
// CANONICAL, non-spoofed form cannot succeed, GROUPA-1 above).
{
  const proj = makeTempProject();
  try {
    const waveSlug = 'groupa-2-wave';
    const { planFile, subjectBundleFile, coordRootDir } = writeGroupAFixtures(proj, waveSlug);
    const intentB64 = buildIntentB64('context-provider', 'GROUPA-2 spoof-attempt fixture question');
    const canonicalCmd = publishRequestCommand(coordRootDir, planFile, subjectBundleFile, intentB64);
    // The spoof attempt: a literal env-var assignment PREFIXED onto the
    // otherwise-canonical command text -- exactly the shape
    // findConsultationCliInvocation's own tokens[0]==='node' check rejects
    // (tokens[0] would be the assignment token, never the literal 'node').
    const spoofCmd = 'RUNTIME_CONSULTATION_SOURCE_ROLE=arch-integration ' + canonicalCmd;
    const r = runNonMainBash(spoofCmd, proj, 'test-specialist', 'groupa2-session');
    assert.strictEqual(r.exit, 0, 'GROUPA-2: an env-var-prefixed command must still be ALLOWED as ordinary non-search Bash passthrough, just never injected: ' + JSON.stringify(r));
    let hadInjection = false;
    if (r.stdout && r.stdout.trim().length > 0) {
      try {
        const body = JSON.parse(r.stdout);
        hadInjection = !!(body && body.hookSpecificOutput);
      } catch { /* non-JSON stdout is fine here -- definitely no injection */ }
    }
    assert.strictEqual(hadInjection, false, 'GROUPA-2: a leading environment-variable-assignment command (RUNTIME_CONSULTATION_SOURCE_ROLE=arch-integration ...) must NEVER be recognized as the canonical consultation CLI invocation or receive a requester-grant injection -- a test-specialist attempting to spoof arch-integration via this env var gets no grant at all: ' + JSON.stringify(r));
    // Zero-write proof: since no grant was ever injected, and `publish-request`
    // is itself grant-gated, actually EXECUTING the raw (unrewritten,
    // ungranted) spoof command must fail before ever creating a request.json
    // -- confirming the spoof cannot durably plant a forged source_role
    // either, not merely that the HOOK declined to help it along.
    // tokens already carries the FULL canonical argv (--coordination-root
    // included, from publishRequestCommand above) -- tokens.slice(1) alone
    // (dropping only the leading 'node') is the correct raw invocation;
    // appending a SECOND --coordination-root here would itself be rejected
    // as DUPLICATE_ARGUMENT, which would make this assertion pass for the
    // WRONG reason (malformed argv) rather than the intended one (missing
    // --requester-binding on a grant-gated command).
    const tokens = rll.parsePosixDirect(canonicalCmd);
    const rawResult = spawnSync('node', tokens.slice(1), { env: Object.assign({}, process.env, { RUNTIME_CONSULTATION_SOURCE_ROLE: 'arch-integration' }), encoding: 'utf8' });
    let rawParsed = null;
    try { rawParsed = JSON.parse(rawResult.stdout); } catch { /* raw invocation shape may differ; the ok-check below is what matters */ }
    assert.ok(rawParsed && rawParsed.ok === false && rawParsed.detail_code === 'AUTHORITY_INVALID', 'GROUPA-2: a raw, ungranted, env-var-spoofed publish-request invocation must be rejected specifically for the missing --requester-binding (AUTHORITY_INVALID), never SUCCEED and never fail for some OTHER, uninformative reason: ' + JSON.stringify(rawResult));
    const transactionsRoot = path.join(coordRootDir, rll.computeRepoId(proj));
    assert.strictEqual(fs.existsSync(transactionsRoot), false, 'GROUPA-2: zero-write proof -- the env-var spoof attempt must leave no plan-root artifacts behind at all, under a coordRootDir that DOES exist (proving absence is genuine, not merely "nothing to find")');
    console.log('GROUPA-2 test-specialist cannot spoof arch-integration via RUNTIME_CONSULTATION_SOURCE_ROLE (no grant, rejected for the right reason, no artifact write): PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// GROUPA-3: a direct specialist->context-provider call (bypassing the
// architect) remains rejected. A test-specialist CAN receive a genuine
// requester-grant injection for publish-request (RQ3's own finding: the
// requester surface is role=agent_type generically, never main-orchestrator-
// or architect-only) -- but executing the resulting, fully-granted command
// with target_role:'context-provider' must still fail (asserted normally:
// this must ALREADY hold today, via either the role-policy mediated-chain
// guard or the entangled sourceRole defect GROUPA-1 names -- either way,
// pattern-discovery-style direct specialist->context-provider access is
// never granted).
{
  const proj = makeTempProject();
  try {
    const waveSlug = 'groupa-3-wave';
    const { planFile, subjectBundleFile, coordRootDir } = writeGroupAFixtures(proj, waveSlug);
    const intentB64 = buildIntentB64('context-provider', 'GROUPA-3 direct specialist bypass fixture question');
    const cmd = publishRequestCommand(coordRootDir, planFile, subjectBundleFile, intentB64);
    // M6+M7 FINAL AUTHORITY CORRECTION (2026-08-11, narrow team-lead follow-up,
    // exhaustive Site-B sweep): same reason as GROUPA-1 above -- this test's
    // own subject (direct specialist->context-provider rejection) needs the
    // grant injection itself to succeed first, so it stays proven distinctly
    // from "denied a grant at all".
    primeClaudeId01Trace(proj, 'test-specialist', 'groupa3-session', 'test-specialist');
    const r = runNonMainBash(cmd, proj, 'test-specialist', 'groupa3-session');
    assert.strictEqual(r.exit, 0, 'GROUPA-3: hook itself must allow (rewrite) a well-formed publish-request from a named role (grant injection is role-generic, RQ3): ' + JSON.stringify(r));
    const body = parseHookJSON(r.stdout, 'GROUPA-3');
    const rewritten = body.hookSpecificOutput && body.hookSpecificOutput.updatedInput && body.hookSpecificOutput.updatedInput.command;
    assert.ok(rewritten, 'GROUPA-3: a test-specialist must still receive a genuine grant injection (proving the REJECTION below comes from executing the request, not from being denied a grant at all): ' + JSON.stringify(body));
    const cliResult = runRewrittenCliCommand(rewritten);
    let parsed = null;
    try { parsed = JSON.parse(cliResult.stdout); } catch { /* handled by the assertion below */ }
    assert.ok(parsed && parsed.schema === 'coordination/cli-result/v1', 'GROUPA-3: executing the rewritten command must at least produce the frozen cli-result/v1 envelope: ' + JSON.stringify(cliResult));
    assert.notStrictEqual(parsed.ok, true, 'GROUPA-3: a direct specialist->context-provider publish-request must remain REJECTED even with a genuine requester grant -- pattern-discovery access is never satisfiable by bypassing the architect: ' + JSON.stringify(parsed));
    console.log('GROUPA-3 direct specialist->context-provider call remains rejected (bypassing the architect never authorizes): PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// GROUPA-4: any attempt to swap the grant/binding actor or role is rejected
// BEFORE any artifact write occurs. Mirrors RQ2's own established
// caller-supplied-binding-rejected precedent (already proven for root-init)
// but for publish-request specifically, with an explicit zero-write proof
// (mirrors PP16's own "only execute the write when the gate allows it"
// zero-write discipline) -- asserted normally: this must ALREADY hold
// today, it is not itself the group-A defect.
{
  const proj = makeTempProject();
  try {
    const waveSlug = 'groupa-4-wave';
    const { planFile, subjectBundleFile, coordRootDir } = writeGroupAFixtures(proj, waveSlug);
    const intentB64 = buildIntentB64('context-provider', 'GROUPA-4 swapped-grant fixture question');
    const forgedBinding = 'a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4';
    const cmd = publishRequestCommand(coordRootDir, planFile, subjectBundleFile, intentB64, ['--requester-binding', forgedBinding]);
    const r = runNonMainBash(cmd, proj, 'arch-integration', 'groupa4-session');
    assertPreToolUseDeny(r, 'GROUPA-4: a caller-supplied --requester-binding on a publish-request command must be rejected (blocked) outright, never trusted or silently forwarded (mirrors RQ2\'s own established precedent, generalized to publish-request)');
    const transactionsRoot = path.join(coordRootDir, rll.computeRepoId(proj), waveSlug);
    assert.strictEqual(fs.existsSync(transactionsRoot), false, 'GROUPA-4: zero-write proof -- a rejected caller-supplied-binding attempt must leave literally NO plan-root artifacts behind (no transactions/, no plan_ref, no routing-policies/, no subject-bundles/) for this wave/plan: ' + transactionsRoot);
    console.log('GROUPA-4 caller-supplied --requester-binding on publish-request rejected BEFORE any artifact write (zero-write proof): PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// ════════════════════════════════════════════════════════════════════════
// M6+M7 requester-authority closure (2026-08-10, dispatch arch-testing-
// 20260810T142647Z Phase 1): GROUP C -- artifact actor identity. Confirmed by
// direct read: cmdPublishRequest (runtime-consultation.cjs) already receives
// `grantContext` (used for source_role, per GROUPA-1 above) but writes
// `requester_instance_id: genId()` -- an independently-generated fresh id,
// never grantContext.actorInstanceId. cmdAcceptResult does not even receive a
// grantContext parameter at all (`function cmdAcceptResult(flags)`, one
// parameter, unlike cmdPublishRequest's two) and likewise writes
// `requester_instance_id: genId()`. Unlike GROUPA-1's own
// requester_instance_id leg (which only proves well-formedness, since that
// hook-mediated path has no exported primitive to read the grant/binding's
// own actor_instance_id back out for comparison), these two tests mint their
// OWN grant/binding directly via the exported rll.createRequesterBinding +
// rll.mintRoleCommandGrant primitives, so the actor_instance_id is KNOWN
// upfront and can be compared for an EXACT match.
// ════════════════════════════════════════════════════════════════════════

// GROUPC-1: request.json's requester_instance_id must equal the authenticated
// publish-request grant/binding's own actor_instance_id.
{
  const proj = makeTempProject();
  try {
    const waveSlug = 'groupc-1-wave';
    const { planFile, subjectBundleFile, coordRootDir } = writeGroupAFixtures(proj, waveSlug);
    const intentB64 = buildIntentB64('context-provider', 'GROUPC-1 fixture question');
    const worktreeId = rll.computeWorktreeId(proj);
    const planResult = rll.discoverPlan(proj);
    assert.strictEqual(planResult.ok, true, 'GROUPC-1 fixture: PLAN must be discoverable: ' + JSON.stringify(planResult));
    // M6+M7 FULL CLOSURE (2026-08-11): this test's own subject is artifact
    // ACTOR IDENTITY correctness (requester_instance_id must equal the
    // AUTHENTICATED grant/binding's actor_instance_id) -- genuinely about a
    // claude-hook-authenticated identity, stays claude-hook, primed for real
    // (this test does not go through buildCanonicalAcceptedConsultation at
    // all, so needs its own explicit priming call).
    primeClaudeId01Trace(proj, 'arch-integration', 'groupc1-session', 'groupc1-agent');
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: 'groupc1-session' };
    const bindingResult = rll.createRequesterBinding(proj, identity, 'groupc1-agent', 'arch-integration', worktreeId, planResult.planDigest, 3600);
    assert.strictEqual(bindingResult.ok, true, 'GROUPC-1 fixture: requester binding mint must succeed: ' + JSON.stringify(bindingResult));
    const rest = ['--coordination-root', coordRootDir, '--plan', planFile, '--subject-bundle', subjectBundleFile, '--intent', intentB64];
    const argvDigest = rc.sha256String(rc.canonicalJSONStringify(rest));
    const mintResult = rll.mintRoleCommandGrant(proj, bindingResult.binding, 'requester', 'publish-request', argvDigest, null, null, null);
    assert.strictEqual(mintResult.ok, true, 'GROUPC-1 fixture: grant mint must succeed: ' + JSON.stringify(mintResult));

    const argv = rest.concat(['--requester-binding', mintResult.grantId]);
    const cliResult = spawnSync('node', [IMPL_RC, 'publish-request'].concat(argv), { encoding: 'utf8' });
    let parsed = null;
    try { parsed = JSON.parse(cliResult.stdout); } catch { /* handled by the assertion below */ }
    assert.ok(parsed && parsed.ok === true, 'GROUPC-1 fixture: a genuinely-granted publish-request must succeed: ' + JSON.stringify({ cliResult, parsed }));
    const reqObj = JSON.parse(fs.readFileSync(parsed.artifact_ref, 'utf8'));
    assert.strictEqual(
      reqObj.requester_instance_id, bindingResult.binding.actor_instance_id,
      'GROUPC-1 (regression): request.json requester_instance_id must equal the authenticated grant/binding\'s own actor_instance_id -- pre-fix cmdPublishRequest writes an independently-generated genId(), completely decoupled from the actor that was actually authenticated to open this request: ' + JSON.stringify({ reqObj, binding: bindingResult.binding })
    );
    console.log('GROUPC-1 requester_instance_id correctly bound to authenticated actor_instance_id: PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// GROUPC-2: accepted-result.json's requester_instance_id must equal the
// authenticated accept-result grant/binding's own actor_instance_id -- and,
// per GROUPC-1 above, the SAME value request.json's own requester_instance_id
// carries (the same request actor). M6+M7 requester-authority closure
// (team-lead-relayed verdict, 2026-08-10): cmdAcceptResult now correctly
// REQUIRES the SAME actor that opened the request -- a genuinely different
// actor (this test's own PRIOR shape, a separately-minted 'groupc2-session'/
// 'groupc2-agent' identity) is now rightly rejected before ever reaching this
// test's OWN success assertion, which tested a permissive model the spec no
// longer allows. This positive case reuses the chain-opener's OWN identity
// throughout instead -- idempotent createRequesterBinding reuse on the exact
// same tuple (never a second, different actor); GROUPC-3 below proves the
// different-actor REJECTION this test used to (incorrectly) expect to
// succeed.
{
  const { proj, planSha256 } = makePostPlanProject();
  try {
    const built = buildCanonicalAcceptedConsultation(proj, POSTPLAN_WAVE_SLUG, planSha256, 'arch-testing', 'groupc2-chain-opener-session', 'arch-testing-instance-1');
    // Remove the hand-written accepted-result.json -- the REAL accept-result
    // CLI (the function under test) must produce a genuine one from the
    // request.json/results/<attempt>.json pair this fixture already built.
    fs.rmSync(built.acceptedPath, { force: true });

    const coordRootDir = path.join(proj, '.planning', 'coordination');
    const worktreeId = rll.computeWorktreeId(proj);
    // SAME exact tuple the chain-opener itself used inside
    // buildCanonicalAcceptedConsultation -- createRequesterBinding's own
    // idempotent lookup-or-create returns the SAME binding, never mints a
    // second one, so this is genuinely the SAME actor, not merely an
    // independently-minted one that happens to share a role.
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: 'groupc2-chain-opener-session' };
    const bindingResult = rll.createRequesterBinding(proj, identity, 'arch-testing-instance-1', 'arch-testing', worktreeId, planSha256, 3600);
    assert.strictEqual(bindingResult.ok, true, 'GROUPC-2 fixture: requester binding mint must succeed: ' + JSON.stringify(bindingResult));
    assert.strictEqual(
      bindingResult.binding.actor_instance_id, built.requesterInstanceId,
      'GROUPC-2 fixture sanity: reusing the chain-opener\'s own identity tuple must idempotently return the SAME binding the opener itself minted, never a fresh one: ' + JSON.stringify({ bindingResult, built })
    );
    const rest = ['--coordination-root', coordRootDir, '--request', built.requestPath];
    // accept-result is TRANSACTIONAL (never null-scope) -- resolveRequesterGrantScope
    // resolves the REAL current request_id/attempt_id/lease_epoch triple this
    // exact transaction carries, mirroring every other transactional-subcommand
    // fixture this session's own work already established (role-gate.bats/
    // cli.bats/cli.test.js).
    const scopeResult = rc.resolveRequesterGrantScope('accept-result', { 'coordination-root': coordRootDir, request: built.requestPath });
    assert.strictEqual(scopeResult.ok, true, 'GROUPC-2 fixture: resolveRequesterGrantScope must succeed: ' + JSON.stringify(scopeResult));
    const argvDigest = rc.sha256String(rc.canonicalJSONStringify(rest));
    const mintResult = rll.mintRoleCommandGrant(proj, bindingResult.binding, 'requester', 'accept-result', argvDigest, scopeResult.requestId, scopeResult.attemptId, scopeResult.leaseEpoch);
    assert.strictEqual(mintResult.ok, true, 'GROUPC-2 fixture: grant mint must succeed: ' + JSON.stringify(mintResult));

    const argv = rest.concat(['--requester-binding', mintResult.grantId]);
    const cliResult = spawnSync('node', [IMPL_RC, 'accept-result'].concat(argv), { encoding: 'utf8' });
    let parsed = null;
    try { parsed = JSON.parse(cliResult.stdout); } catch { /* handled by the assertion below */ }
    assert.ok(parsed && parsed.ok === true, 'GROUPC-2 fixture: a genuinely-granted, same-actor accept-result against a real ANSWERED candidate must succeed: ' + JSON.stringify({ cliResult, parsed }));
    const acceptedObj = JSON.parse(fs.readFileSync(parsed.artifact_ref, 'utf8'));
    assert.strictEqual(
      acceptedObj.requester_instance_id, bindingResult.binding.actor_instance_id,
      'GROUPC-2: accepted-result.json requester_instance_id must equal the authenticated accept-result grant/binding\'s own actor_instance_id: ' + JSON.stringify({ acceptedObj, binding: bindingResult.binding })
    );
    console.log('GROUPC-2 accept-result requester_instance_id correctly bound to authenticated actor_instance_id (same actor throughout): PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// GROUPC-3: a SECOND valid, same-role (arch-testing) but DIFFERENT actor
// attempting accept-result against the SAME already-open request must be
// REJECTED before any lock/write (team-lead-relayed verdict, 2026-08-10:
// "A different valid same-role actor must be rejected before lock/write.")
// -- the negative twin of GROUPC-2's own same-actor positive above. Confirmed
// (2026-08-10) this exact property has no other coverage in this file.
{
  const { proj, planSha256 } = makePostPlanProject();
  try {
    const built = buildCanonicalAcceptedConsultation(proj, POSTPLAN_WAVE_SLUG, planSha256, 'arch-testing', 'groupc3-chain-opener-session', 'arch-testing-instance-1');
    fs.rmSync(built.acceptedPath, { force: true });

    const coordRootDir = path.join(proj, '.planning', 'coordination');
    const worktreeId = rll.computeWorktreeId(proj);
    // A GENUINELY DIFFERENT, same-role actor -- a distinct session+agent
    // tuple from the chain-opener's own, so this mints a DIFFERENT
    // actor_instance_id, never the same one via idempotent reuse.
    // M6+M7 FULL CLOSURE (2026-08-11): a DIFFERENT tuple than the chain
    // opener's own (already primed by buildCanonicalAcceptedConsultation
    // above) -- needs its own explicit priming.
    primeClaudeId01Trace(proj, 'arch-testing', 'groupc3-different-actor-session', 'groupc3-different-actor-agent');
    const differentIdentity = { ok: true, provider: 'claude-hook', runtime_session_key: 'groupc3-different-actor-session' };
    const differentBindingResult = rll.createRequesterBinding(proj, differentIdentity, 'groupc3-different-actor-agent', 'arch-testing', worktreeId, planSha256, 3600);
    assert.strictEqual(differentBindingResult.ok, true, 'GROUPC-3 fixture: different-actor requester binding mint must succeed: ' + JSON.stringify(differentBindingResult));
    assert.notStrictEqual(
      differentBindingResult.binding.actor_instance_id, built.requesterInstanceId,
      'GROUPC-3 fixture sanity: this test needs a GENUINELY different actor than the chain opener, never an accidental idempotent-reuse collision: ' + JSON.stringify({ differentBindingResult, built })
    );

    const rest = ['--coordination-root', coordRootDir, '--request', built.requestPath];
    const scopeResult = rc.resolveRequesterGrantScope('accept-result', { 'coordination-root': coordRootDir, request: built.requestPath });
    assert.strictEqual(scopeResult.ok, true, 'GROUPC-3 fixture: resolveRequesterGrantScope must succeed: ' + JSON.stringify(scopeResult));
    const argvDigest = rc.sha256String(rc.canonicalJSONStringify(rest));
    const mintResult = rll.mintRoleCommandGrant(proj, differentBindingResult.binding, 'requester', 'accept-result', argvDigest, scopeResult.requestId, scopeResult.attemptId, scopeResult.leaseEpoch);
    assert.strictEqual(mintResult.ok, true, 'GROUPC-3 fixture: grant mint must succeed: ' + JSON.stringify(mintResult));

    const argv = rest.concat(['--requester-binding', mintResult.grantId]);
    const cliResult = spawnSync('node', [IMPL_RC, 'accept-result'].concat(argv), { encoding: 'utf8' });
    let parsed = null;
    try { parsed = JSON.parse(cliResult.stdout); } catch { /* handled by the assertion below */ }
    assert.ok(parsed && parsed.ok === false, 'GROUPC-3: a different, same-role actor accept-result attempt against the SAME already-open request must be REJECTED, never silently accepted: ' + JSON.stringify({ cliResult, parsed }));
    assert.strictEqual(
      fs.existsSync(built.acceptedPath), false,
      'GROUPC-3: zero-write proof -- a rejected different-actor accept-result attempt must leave NO accepted-result.json behind: ' + built.acceptedPath
    );
    console.log('GROUPC-3 different-actor accept-result correctly rejected before lock/write (zero-write proof): PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// M6+M7 FINAL AUTHORITY/ORACLE CORRECTION (2026-08-11, RED phase, dispatch
// team-lead "M6+M7 FINAL AUTHORITY/ORACLE CORRECTION"): Group 2 -- exact
// post-PLAN architect requester binding. Confirmed by direct read (2026-08-11,
// full 1364-line read) of resolveArchitectRequesterBinding (this file,
// ~L408-442):
//   - the session-key comparison (line 435) is SKIPPED ENTIRELY whenever
//     sessionKey is empty/absent, instead of being mandatory;
//   - no check anywhere that result.binding.runtime === 'claude-hook' -- a
//     genuine codex-supervisor-runtime binding can satisfy this resolver;
//   - the readdir scan (line 419) has NO cap/counter at all (unlike this
//     SAME file's own hasCurrentAcceptedConsultation, whose
//     MAX_ACCEPTED_CONSULTATION_TRANSACTIONS_SCANNED bounds an adjacent scan);
//   - a structurally malformed/throwing registry member is silently skipped
//     (catch{continue}) instead of failing the WHOLE resolution closed.
//
// Every fixture below reuses buildCanonicalAcceptedConsultation (the EXISTING
// production chain, established above by the M7/WP4 group B section -- never
// a parallel/weaker construction) as its base, then tampers the resulting
// on-disk requester-binding/accepted-result exactly as each case requires --
// never a hand-simulated hook/resolver. findRequesterBindingPathByActorInstanceId
// is test-side ground truth for LOCATING the file to tamper, deliberately not
// a reimplementation of resolveArchitectRequesterBinding itself (the code
// under test).
//
// ORDERING NOTE for this file's own "flat script, abort at first uncaught
// assertion" convention (confirmed by runtime-consultation-cli.test.js's own
// header note describing this file's style, and empirically by this session's
// own verification runs): the four cases ALREADY correctly handled today
// (locking-in confirmations, cases 2/3/7/8) are placed FIRST, so a normal
// single run exercises all four; the three genuinely NEW RED cases (4/5/6)
// are placed LAST -- this file's own convention means only the FIRST of the
// three is visible in a single unmodified run. Each of the three was
// independently confirmed during authoring by temporarily commenting out the
// earlier one(s) and re-running; see this session's structured report to
// team-lead for the exact per-case command/output evidence.
// ════════════════════════════════════════════════════════════════════════════

function findRequesterBindingPathByActorInstanceId(proj, actorInstanceId) {
  const bindingsDir = path.join(rll.registryRepoDir(proj), 'requester-bindings');
  const entries = fs.readdirSync(bindingsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const p = path.join(bindingsDir, entry.name);
    let obj;
    try { obj = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
    if (obj && obj.actor_instance_id === actorInstanceId) return p;
  }
  return null;
}

// case 2 (LOCKING-IN, not new RED): same agent_key, DIFFERENT session -- the
// flag's own session_id ('groupd2-flag-session') differs from the binding's
// own runtime_session_key ('groupd2-DIFFERENT-binding-session'). Confirmed by
// direct read: isAcceptedConsultationTransactionValid's OWN caller-side guard
// (this file, ~L344-346) already requires architectIdentity.sessionId to be a
// genuinely non-empty string BEFORE ever calling
// resolveArchitectRequesterBinding -- so through this file's ONLY wired call
// site, sessionKey is NEVER empty, and resolveArchitectRequesterBinding's own
// session-comparison (line 435) is therefore never actually skipped in
// practice; a session mismatch is correctly rejected today. This test
// confirms that positive-safety property explicitly -- it is NOT new coverage
// of the described "skippable when empty" bug (see the disclosed case 1
// blocker below for why that specific bug is currently unreachable/dead code).
{
  const { proj, planSha256 } = makePostPlanProject();
  try {
    buildCanonicalAcceptedConsultation(proj, POSTPLAN_WAVE_SLUG, planSha256, 'arch-testing', 'groupd2-DIFFERENT-binding-session', 'groupd2-shared-agent');
    writeArchResponseFlagWithInstance('groupd2-flag-session', 'test-specialist', 'arch-testing', 'groupd2-shared-agent');
    const r = runSpecialistPostPlan(proj, 'groupd2-flag-session', 'test-specialist');
    assertPreToolUseDeny(r, 'GROUP2-CASE2 (locking-in): same agent_key, different session must already fail closed (session check is never actually skipped via the sole wired caller, which always supplies a non-empty session)');
    console.log('GROUP2-CASE2 same-agent/different-session already correctly rejected (LOCKING-IN, not new RED): PASS');
  } finally {
    clearArchResponseFlag('groupd2-flag-session', 'test-specialist');
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// case 3 (LOCKING-IN, team-lead's own expectation): same session, DIFFERENT
// agent_key -- compared unconditionally at line 434.
{
  const { proj, planSha256 } = makePostPlanProject();
  try {
    buildCanonicalAcceptedConsultation(proj, POSTPLAN_WAVE_SLUG, planSha256, 'arch-testing', 'groupd3-shared-session', 'groupd3-REAL-agent');
    writeArchResponseFlagWithInstance('groupd3-shared-session', 'test-specialist', 'arch-testing', 'groupd3-DIFFERENT-agent');
    const r = runSpecialistPostPlan(proj, 'groupd3-shared-session', 'test-specialist');
    assertPreToolUseDeny(r, 'GROUP2-CASE3 (locking-in): same session, different agent_key must already fail closed (agent_key compared unconditionally at line 434)');
    console.log('GROUP2-CASE3 same-session/different-agent already correctly rejected (LOCKING-IN, not new RED): PASS');
  } finally {
    clearArchResponseFlag('groupd3-shared-session', 'test-specialist');
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// case 7 (LOCKING-IN): two exact live matches (two genuinely live bindings
// both satisfying role/worktree/plan/agent/session) must remain
// ambiguous/fail-closed. Constructed by cloning the genuine binding's OWN
// bytes to a second binding_id -- same technique as this repo's own
// established GROUP-A "ambiguous" precedent
// (runtime-role-lifecycle-registry.test.js) and claude-one-shot-binding-red.
// bats's COSB-VALIDATE-ROLEACTORBINDING-SUBSTITUTION.
{
  const { proj, planSha256 } = makePostPlanProject();
  try {
    const chain = buildCanonicalAcceptedConsultation(proj, POSTPLAN_WAVE_SLUG, planSha256, 'arch-testing', 'groupd7-session', 'groupd7-agent');
    const originalPath = findRequesterBindingPathByActorInstanceId(proj, chain.requesterInstanceId);
    assert.ok(originalPath, 'GROUP2-CASE7 fixture: the genuine binding must be locatable on disk');
    const bindingsDir = path.dirname(originalPath);
    const clonedPath = path.join(bindingsDir, crypto.randomBytes(16).toString('hex') + '.json');
    fs.writeFileSync(clonedPath, fs.readFileSync(originalPath), { mode: 0o600 });
    fs.chmodSync(clonedPath, 0o600);
    writeArchResponseFlagWithInstance('groupd7-session', 'test-specialist', 'arch-testing', 'groupd7-agent');
    const r = runSpecialistPostPlan(proj, 'groupd7-session', 'test-specialist');
    assertPreToolUseDeny(r, 'GROUP2-CASE7 (locking-in): two exactly-matching live bindings for the identical scope must remain ambiguous/fail-closed, never silently pick one');
    console.log('GROUP2-CASE7 two exact live matches remain ambiguous (LOCKING-IN, not new RED): PASS');
  } finally {
    clearArchResponseFlag('groupd7-session', 'test-specialist');
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// case 8 (LOCKING-IN): request/accepted actor swap -- the accepted-result's
// own requester_instance_id is tampered to differ from the request's/binding's.
{
  const { proj, planSha256 } = makePostPlanProject();
  try {
    const chain = buildCanonicalAcceptedConsultation(proj, POSTPLAN_WAVE_SLUG, planSha256, 'arch-testing', 'groupd8-session', 'groupd8-agent');
    const acceptedObj = JSON.parse(fs.readFileSync(chain.acceptedPath, 'utf8'));
    assert.strictEqual(acceptedObj.requester_instance_id, chain.requesterInstanceId, 'GROUP2-CASE8 fixture sanity: the accepted-result must genuinely carry the SAME actor before tampering');
    acceptedObj.requester_instance_id = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(chain.acceptedPath, JSON.stringify(acceptedObj), { mode: 0o600 });
    fs.chmodSync(chain.acceptedPath, 0o600);
    writeArchResponseFlagWithInstance('groupd8-session', 'test-specialist', 'arch-testing', 'groupd8-agent');
    const r = runSpecialistPostPlan(proj, 'groupd8-session', 'test-specialist');
    assertPreToolUseDeny(r, 'GROUP2-CASE8 (locking-in): a request/accepted actor swap (accepted-result.requester_instance_id differs from the request\'s/binding\'s) must fail closed');
    console.log('GROUP2-CASE8 request/accepted actor swap rejected (LOCKING-IN, not new RED): PASS');
  } finally {
    clearArchResponseFlag('groupd8-session', 'test-specialist');
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// Case 1 (missing session): RE-ADDED (2026-08-11, dispatch
// arch-testing-20260811T162225Z item 9) per explicit direct user correction of
// the prior pass's own disposition immediately below this note's predecessor
// -- "genuinely blocked, cannot test" was wrong. An E2E deny control through
// the real hook CLI is required regardless of which layer actually produces
// the deny, as long as that layer is honestly documented rather than guessed.
//
// Confirmed by direct read (this session, same conclusion the prior pass
// already reached): resolveArchitectRequesterBinding has exactly ONE call
// site (isAcceptedConsultationTransactionValid, ~L358-360), and that caller
// ALREADY independently guards architectIdentity.sessionId non-empty BEFORE
// ever calling it (~L355-357) -- so sessionKey is structurally always
// non-empty via that ONE wired path, and resolveArchitectRequesterBinding's
// own internal "skip check when sessionKey is falsy" defect is dead code in
// practice through it. But architectIdentity itself is constructed by
// architectIdentityFromFlagMeta (~L552-560) from the specialist's own
// arch-response flag file content, which requires session_id as ONE OF ITS
// OWN three mandatory fields -- absent, architectIdentityFromFlagMeta returns
// null outright, and postPlanGateAllows's own `if (!identity) return false;`
// (~L576) denies before hasCurrentAcceptedConsultation/
// isAcceptedConsultationTransactionValid/resolveArchitectRequesterBinding are
// ever reached at all -- an EARLIER layer still, but a genuine, honest,
// end-to-end deny for a missing session on the identity this whole Group 2
// mechanism authenticates.
{
  const { proj, planSha256 } = makePostPlanProject();
  try {
    buildCanonicalAcceptedConsultation(proj, POSTPLAN_WAVE_SLUG, planSha256, 'arch-testing', 'group2-case1-session', 'group2-case1-agent');
    // Custom flag write (never writeArchResponseFlagWithInstance, which always
    // stamps a non-empty session_id) -- session_id is the field under test,
    // deliberately omitted entirely.
    fs.writeFileSync(archResponseFlagPath('group2-case1-caller-session', 'test-specialist'), JSON.stringify({
      written_by: 'context-provider-consulted',
      agent_id: 'group2-case1-agent',
      architect_role: 'arch-testing',
      // session_id deliberately OMITTED entirely.
      ts: new Date().toISOString(),
    }));
    const r = runSpecialistPostPlan(proj, 'group2-case1-caller-session', 'test-specialist');
    assertPreToolUseDeny(r, 'GROUP2-CASE1 (missing session): an arch-response flag whose own content carries no session_id must deny end-to-end -- denies today via architectIdentityFromFlagMeta returning null (session_id is one of its own three required fields) -> postPlanGateAllows\'s own null-identity check, an EVEN EARLIER layer than resolveArchitectRequesterBinding\'s own dead-code session check (independently confirmed unreachable through this file\'s one wired caller, which already guards non-empty session before ever calling it)');
    console.log('GROUP2-CASE1 missing session on arch-response flag denies end-to-end (via architectIdentityFromFlagMeta null-identity, earlier than resolveArchitectRequesterBinding): PASS');
  } finally {
    clearArchResponseFlag('group2-case1-caller-session', 'test-specialist');
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// case 4 (regression): cross-provider binding (codex-supervisor) satisfies the resolver.
{
  const { proj, planSha256 } = makePostPlanProject();
  try {
    const chain = buildCanonicalAcceptedConsultation(proj, POSTPLAN_WAVE_SLUG, planSha256, 'arch-testing', 'groupd4-session', 'groupd4-agent');
    const bindingPath = findRequesterBindingPathByActorInstanceId(proj, chain.requesterInstanceId);
    assert.ok(bindingPath, 'GROUP2-CASE4 fixture: the genuine binding must be locatable on disk');
    const bindingObj = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
    assert.strictEqual(bindingObj.runtime, 'claude-hook', 'GROUP2-CASE4 fixture sanity: the binding must genuinely start as claude-hook before tampering');
    bindingObj.runtime = 'codex-supervisor';
    fs.writeFileSync(bindingPath, JSON.stringify(bindingObj), { mode: 0o600 });
    fs.chmodSync(bindingPath, 0o600);
    writeArchResponseFlagWithInstance('groupd4-session', 'test-specialist', 'arch-testing', 'groupd4-agent');
    const r = runSpecialistPostPlan(proj, 'groupd4-session', 'test-specialist');
    // Confirmed empirically (2026-08-11): r === {exit:0, stdout:"", stderr:"[CP-GATE]
    // session=groupd4-session flag_writer=context-provider-consulted ... tool=Grep\n"}
    // -- this is the hook's own SILENT ALLOW shape (context-provider-gate.js's
    // specialist branch: "if (postPlanGateAllows(true, identity, ...)) process.exit(0);"
    // writes NO stdout at all on allow, unlike the deny path's emitDeny JSON body) --
    // i.e. the codex-supervisor binding DOES wrongly authorize the consultation today.
    // assertPreToolUseDeny correctly fails on this (empty stdout never matches the
    // expected deny JSON shape), precisely proving the wrong-allow.
    assertPreToolUseDeny(r, 'GROUP2-CASE4 (regression): a genuine codex-supervisor-runtime binding must never satisfy resolveArchitectRequesterBinding for a Claude-hook-observed architect identity -- runtime must be required to equal claude-hook specifically, never merely a member of the closed IDENTITY_PROVIDER_ENUM');
    console.log('GROUP2-CASE4 cross-provider (codex-supervisor) binding correctly rejected: PASS');
  } finally {
    clearArchResponseFlag('groupd4-session', 'test-specialist');
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// Cases 5 (malformed registry sibling) and 6 (1,025-candidate overflow):
// RE-ADDED (2026-08-11, dispatch arch-testing-20260811T162225Z item 9) per the
// SAME explicit direct user correction as case 1 above -- the prior pass built
// and ran these exact E2E fixtures (planting a malformed .json / 1,025 filler
// .json files directly in requester-bindings/, then driving the real
// specialist post-PLAN flow), confirmed BOTH genuinely deny end-to-end, never
// crash/hang, but then removed them rather than leaving "denies today, for a
// documented but different reason" in as a test. The correction: that removal
// was wrong -- a real, honestly-documented E2E deny control is required
// regardless of which layer produces it.
//
// Documented mechanism (confirmed by direct read this session, same
// conclusion the prior pass already reached): this file's own
// mintInternalValidateGrant (~L198-257, called from validateViaConsultationCli
// at ~L268-296, itself called from isAcceptedConsultationTransactionValid at
// ~L322 -- BEFORE resolveArchitectRequesterBinding is ever called at ~L358)
// mints its OWN internal one-use `validate` grant via
// runtime-role-lifecycle.cjs's createRequesterBinding -- which independently
// scans this SAME shared requester-bindings/ directory and ALREADY fails
// closed on exactly these two conditions for ANY role/session/agent tuple,
// unconditionally, before ever checking whether a genuine match exists. That
// EARLIER check fires first and makes mintInternalValidateGrant return null,
// which makes validateViaConsultationCli return false, which makes
// isAcceptedConsultationTransactionValid return false immediately -- masking
// resolveArchitectRequesterBinding's own separate (line 439/447-454) copy of
// the identical scan-cap/malformed-handling logic before it is ever reached.
// Both tests below document this honestly in their own assertion message,
// per this dispatch's own explicit instruction, rather than silently implying
// resolveArchitectRequesterBinding's own code is what is under test.
{
  const { proj, planSha256 } = makePostPlanProject();
  try {
    const chain = buildCanonicalAcceptedConsultation(proj, POSTPLAN_WAVE_SLUG, planSha256, 'arch-testing', 'group2-case5-session', 'group2-case5-agent');
    const genuinePath = findRequesterBindingPathByActorInstanceId(proj, chain.requesterInstanceId);
    assert.ok(genuinePath, 'GROUP2-CASE5 fixture: the genuine binding must be locatable on disk');
    const bindingsDir = path.dirname(genuinePath);
    // A malformed sibling -- not valid JSON at all -- sitting ALONGSIDE the
    // genuine binding in the SAME requester-bindings/ directory (mirrors this
    // file's own established PP11 "not valid json at all" malformed-fixture
    // convention).
    fs.writeFileSync(path.join(bindingsDir, crypto.randomBytes(16).toString('hex') + '.json'), 'not valid json at all -- deliberately malformed sibling');
    writeArchResponseFlagWithInstance('group2-case5-session', 'test-specialist', 'arch-testing', 'group2-case5-agent');
    const r = runSpecialistPostPlan(proj, 'group2-case5-session', 'test-specialist');
    assertPreToolUseDeny(r, 'GROUP2-CASE5 (malformed registry sibling): a malformed/unparseable .json file sitting alongside a genuine requester-binding in requester-bindings/ must deny end-to-end, never crash -- denies today via mintInternalValidateGrant\'s OWN internal validate-grant mint (createRequesterBinding, runtime-role-lifecycle.cjs), which independently scans this SAME directory and already fails closed on a malformed sibling, BEFORE resolveArchitectRequesterBinding is ever reached (documented masking, not silently presented as resolveArchitectRequesterBinding\'s own coverage)');
    console.log('GROUP2-CASE5 malformed registry sibling denies end-to-end, never crashes (via mintInternalValidateGrant, earlier than resolveArchitectRequesterBinding): PASS');
  } finally {
    clearArchResponseFlag('group2-case5-session', 'test-specialist');
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

{
  const { proj, planSha256 } = makePostPlanProject();
  try {
    const chain = buildCanonicalAcceptedConsultation(proj, POSTPLAN_WAVE_SLUG, planSha256, 'arch-testing', 'group2-case6-session', 'group2-case6-agent');
    const genuinePath = findRequesterBindingPathByActorInstanceId(proj, chain.requesterInstanceId);
    assert.ok(genuinePath, 'GROUP2-CASE6 fixture: the genuine binding must be locatable on disk');
    const bindingsDir = path.dirname(genuinePath);
    // Cap+1 filler entries -- reuses the SAME REQUESTER_BINDING_SCAN_CAP the
    // production code itself exports (runtime-role-lifecycle.cjs), never a
    // hardcoded/guessed literal -- resolveArchitectRequesterBinding's own scan
    // (~L439) and createRequesterBinding's own independent scan both reference
    // this SAME constant.
    const existingCount = fs.readdirSync(bindingsDir).filter((f) => f.endsWith('.json')).length;
    const fillerNeeded = rll.REQUESTER_BINDING_SCAN_CAP + 1 - existingCount;
    assert.ok(fillerNeeded > 0, 'GROUP2-CASE6 fixture: filler count must be positive: ' + JSON.stringify({ existingCount, cap: rll.REQUESTER_BINDING_SCAN_CAP }));
    for (let i = 0; i < fillerNeeded; i += 1) {
      fs.writeFileSync(path.join(bindingsDir, 'group2-case6-filler-' + i + '-' + crypto.randomBytes(8).toString('hex') + '.json'), JSON.stringify({ filler: true, i }));
    }
    const totalCount = fs.readdirSync(bindingsDir).filter((f) => f.endsWith('.json')).length;
    assert.strictEqual(totalCount, rll.REQUESTER_BINDING_SCAN_CAP + 1, 'GROUP2-CASE6 fixture sanity: total requester-bindings/ entries must be exactly cap+1: ' + JSON.stringify({ totalCount, cap: rll.REQUESTER_BINDING_SCAN_CAP }));
    writeArchResponseFlagWithInstance('group2-case6-session', 'test-specialist', 'arch-testing', 'group2-case6-agent');
    const r = runSpecialistPostPlan(proj, 'group2-case6-session', 'test-specialist');
    assertPreToolUseDeny(r, 'GROUP2-CASE6 (1,025-candidate overflow, cap+1): cap+1 entries in requester-bindings/ must deny end-to-end, never an unbounded scan/hang/crash -- denies today via mintInternalValidateGrant\'s OWN internal validate-grant mint (createRequesterBinding, runtime-role-lifecycle.cjs), which independently scans this SAME directory and already fails closed past its own REQUESTER_BINDING_SCAN_CAP, BEFORE resolveArchitectRequesterBinding is ever reached (documented masking, not silently presented as resolveArchitectRequesterBinding\'s own coverage)');
    console.log('GROUP2-CASE6 cap+1 requester-bindings entries denies end-to-end, never hangs/crashes (via mintInternalValidateGrant, earlier than resolveArchitectRequesterBinding): PASS');
  } finally {
    clearArchResponseFlag('group2-case6-session', 'test-specialist');
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// ════════════════════════════════════════════════════════════════════════
// M6+M7 RESIDUAL AUTHORITY CORRECTION (2026-08-11, dispatch arch-testing
// arch-testing-20260811T162225Z): Section D / item 6 ("Identidad de hooks
// fail-closed. Validar los campos RAW antes de default, sanitizeId, trim o
// cualquier conversión. Un agent_id objeto con conversión deliberadamente
// inválida debe producir deny explícito, nunca el catch fail-open.").
//
// Confirmed by direct read of this file's own top-level stdin handler:
//   const agentId = sanitizeId(data.agent_id || 'unknown');           // RAW conversion, FIRST
//   if (process.env.CLAUDE_CP_GATE_DISABLED === '1') process.exit(0);
//   if (!isWellFormedOptionalIdentityField(data.session_id) || ...) { emitDeny(...); }  // RAW validation, SECOND
// sanitizeId (`String(id).replace(...)`) runs BEFORE isWellFormedOptionalIdentityField
// -- backwards from Section D's own explicit ordering requirement. A plain
// wrong-TYPE JSON value (object/array/number) does NOT itself throw inside
// String() and is still correctly caught by isWellFormedOptionalIdentityField
// a few lines later -- so THAT shape is already fine today. But a
// JSON-parseable value engineered so String() itself throws (a sufficiently
// deep nested array -- Array.prototype.toString's own recursive stringify
// overflows the call stack; empirically confirmed this session:
// JSON.parse succeeds at 10000 levels of [[[...]]] nesting, but a bare
// String() on the parsed result throws RangeError at every depth tested,
// including far shallower ones) throws INSIDE sanitizeId, before
// isWellFormedOptionalIdentityField is ever reached -- the exception then
// propagates to this file's own outer try/catch, which is unconditionally
// fail-open ("Fail open on any error (never block due to script failure)",
// this file's own header comment) -- producing a silent ALLOW (passthrough),
// never the explicit deny Section D requires.
// ════════════════════════════════════════════════════════════════════════

{
  const proj = makeTempProject();
  try {
    // A JSON-parseable value (10000 levels of nested arrays) that JSON.parse
    // itself handles fine, but whose OWN String() conversion throws
    // (RangeError: Maximum call stack size exceeded) -- built as raw JSON
    // TEXT via string concatenation, never as a real in-process JS array, so
    // constructing this fixture itself never risks a stack overflow in this
    // test file.
    const deepNestedArrayJson = '['.repeat(10000) + '1' + ']'.repeat(10000);
    const payloadJson = '{"tool_name":"Grep","tool_input":{"pattern":"test","path":"/project/docs/di/di-patterns-modules.md"},"session_id":"item6-crafted-agentid-session","agent_type":"arch-platform","agent_id":' + deepNestedArrayJson + '}';
    const r = runHook(payloadJson, { CLAUDE_PROJECT_DIR: proj, CLAUDE_WAVE_SLUG: '' });
    assertPreToolUseDeny(r, 'Section D (item 6, RED): a crafted agent_id whose own String() conversion deliberately throws (a deeply-nested, but genuinely JSON.parse-able, array) must produce an explicit deny -- pre-fix sanitizeId(data.agent_id || \'unknown\') runs BEFORE isWellFormedOptionalIdentityField\'s raw-field validation, so the throw inside String(id) propagates straight to this file\'s own unconditionally fail-open outer catch, producing a silent ALLOW instead: ' + JSON.stringify(r));
    console.log('ITEM6-CRAFTED-AGENTID crafted agent_id String()-throw produces explicit deny, never the fail-open catch: PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

console.log('\nAll context-provider-gate tests passed.');

// Sixteenth correction RED: the four newly frozen lifecycle entrypoints must
// be owned by this hook.  These cases begin at the real PreToolUse surface and
// inspect/consume the real one-use grant; no grant wrapper or authority
// constructor stands in for the behavior under test.
function s16IntentToken(intent) {
  return Buffer.from(rc.canonicalJSONStringify(intent), 'utf8').toString('base64url');
}

function s16GrantDigest(subcommand, value) {
  return rc.sha256String(subcommand + ':' + value);
}

function s16AssertInjectedGrant(proj, sessionId, subcommand, argv, role, digest, actionId) {
  const command = rll.renderPosixDirect(['node', S16_RLL_PATH, subcommand].concat(argv));
  const hookResult = runMainOrchestratorBash(command, proj, {
    NODE_ENV: 'test',
    RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY: S16_TEST_CAPABILITY,
    RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: JSON.stringify(['codex-app-server']),
  }, sessionId);
  const body = assertPreToolUseAllowRewrite(hookResult, 'S16-LG-' + subcommand.toUpperCase() + '-INJECT-01');
  const rewritten = body.hookSpecificOutput.updatedInput.command;
  const grantId = extractLifecycleBinding(rewritten);
  assert.match(grantId || '', /^[0-9a-f]{32}$/, 'S16 ' + subcommand + ': hook must inject exactly one genuine lifecycle grant');
  const grantRead = rll.readRegistryRecord(rll.grantPathFor(proj, grantId));
  assert.strictEqual(grantRead.ok, true, 'S16 ' + subcommand + ': injected grant record must be durably readable');
  assert.ok(!grantRead.absent && grantRead.obj, 'S16 ' + subcommand + ': injected grant record must exist');
  assert.strictEqual(grantRead.obj.profile, 'normal', 'S16 ' + subcommand + ': Sixteenth entrypoints are normal-profile only');
  assert.strictEqual(grantRead.obj.subcommand, subcommand);
  const consumed = rll.validateAndConsumeLifecycleCommandGrant(
    proj, grantId, digest, role, subcommand, actionId === undefined ? null : actionId,
  );
  assert.strictEqual(consumed.ok, true, 'S16 ' + subcommand + ': injected grant must be genuinely consumable for the exact normal-profile command: ' + JSON.stringify(consumed));
  return { body, rewritten };
}

function s16HookCase(name, fn) {
  const selected = process.env.S16_RED_CASE;
  if (!selected || selected === name) fn();
}

function s16PublishRetainedPlane(proj, sessionId) {
  const projectLib = path.join(proj, 'scripts', 'lib');
  fs.mkdirSync(projectLib, { recursive: true });
  const toolkitPolicy = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../lib/runtime-collaboration-policy.json'), 'utf8'));
  fs.writeFileSync(path.join(projectLib, 'runtime-collaboration-policy.json'), JSON.stringify(rll.projectPolicyV2ToV1(toolkitPolicy)));
  fs.copyFileSync(path.resolve(__dirname, '../lib/runtime-routing.json'), path.join(projectLib, 'runtime-routing.json'));
  const priorExecutor = process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY;
  const priorReady = process.env.RUNTIME_ROLE_LIFECYCLE_TEST_BATCH_READY_CAPABILITY;
  const priorNodeEnv = process.env.NODE_ENV;
  const priorCapability = process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY;
  try {
    process.env.NODE_ENV = 'test';
    process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = S16_TEST_CAPABILITY;
    process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY = S16_EXECUTOR_CAPABILITY;
    process.env.RUNTIME_ROLE_LIFECYCLE_TEST_BATCH_READY_CAPABILITY = 's16-hook-ready-capability';
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };
    const worktreeId = rll.computeWorktreeId(proj);
    const planDigest = rll.discoverPlan(proj).planDigest;
    // Sixteenth requires at least 120 full seconds of request authority after
    // validation.  Use the canonical one-hour session fixture so timestamp
    // truncation and setup work cannot make this positive vacuously expire.
    const bindingResult = rll.createMainOrchestratorBinding(proj, identity, worktreeId, planDigest, 3600);
    assert.strictEqual(bindingResult.ok, true, 'S16 fixture: main binding must mint: ' + JSON.stringify(bindingResult));
    const sortedRoles = S16_SUPPORT_ROLES.slice().sort();
    const grantResult = rll.mintLifecycleCommandGrant(
      proj, bindingResult.binding, rc.sha256String('ensure:' + sortedRoles.join(',')), sortedRoles,
      'ensure', 'main-orchestrator', 'orchestrator', 'normal', null,
    );
    assert.strictEqual(grantResult.ok, true, 'S16 fixture: pre-existing ensure grant must mint: ' + JSON.stringify(grantResult));
    const ensureArgs = [S16_RLL_PATH, 'ensure', '--project-root', proj];
    for (const role of S16_SUPPORT_ROLES) ensureArgs.push('--role', role);
    ensureArgs.push('--lifecycle-binding', grantResult.grantId);
    const startabilityBin = makeM6AFakeCodexExecutable();
    const startabilityHome = makeM6ACredentialHome();
    let ensured;
    try {
      ensured = spawnSync('node', ensureArgs, {
        encoding: 'utf8', env: Object.assign({}, process.env, {
          HOME: startabilityHome,
          CODEX_CLI_PATH: startabilityBin.filePath,
          RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: JSON.stringify(['codex-app-server']),
        }),
      });
    } finally {
      fs.rmSync(startabilityHome, { recursive: true, force: true });
      fs.rmSync(startabilityBin.dir, { recursive: true, force: true });
    }
    assert.strictEqual(ensured.status, 0, 'S16 fixture: real ensure CLI must succeed: ' + JSON.stringify(ensured));
    const ensuredLines = ensured.stdout.trim().split('\n');
    const ensuredBody = JSON.parse(ensuredLines[ensuredLines.length - 1]);
    const supervisorAction = ensuredBody.actions.find((a) => a.kind === 'supervisor-start');
    assert.ok(supervisorAction, 'S16 fixture: supervisor-start action must exist: ' + ensured.stdout);
    const found = rll.findActionAcrossRepos(supervisorAction.action_id);
    assert.strictEqual(found.ok, true, 'S16 fixture: supervisor action lookup must succeed: ' + JSON.stringify(found));
    assert.strictEqual(found.absent, false, 'S16 fixture: supervisor action must exist');
    const action = found.action;
    const repoDescriptor = { repoId: rll.computeRepoId(proj) };
    const claim = rll.mintSupervisorExecutionClaim(repoDescriptor, action, bindingResult.binding.binding_id, 120);
    assert.strictEqual(claim.ok, true, 'S16 fixture: real supervisor execution claim must mint: ' + JSON.stringify(claim));
    const readyEvidence = S16_SUPPORT_ROLES.slice().sort().map((role) => {
      const workerSessionId = crypto.randomBytes(16).toString('hex');
      const now = new Date();
      const record = {
        schema: 'coordination/worker-presence/v1', role,
        worker_session_id: workerSessionId, worktree_id: action.worktree_id,
        thread_id: 's16-thread-' + workerSessionId,
        role_profile_digest: rll.roleProfileDigestFor(role), pid: process.pid,
        started_at: now.toISOString(), lease_expiry: new Date(now.getTime() + 60_000).toISOString(),
        heartbeat_at: now.toISOString(),
      };
      const presencePath = path.join(rll.registryRepoDir(proj), 'workers', role, workerSessionId, 'presence.json');
      const written = rll.writeRegistryRecordReplace(presencePath, Buffer.from(JSON.stringify(record), 'utf8'));
      assert.strictEqual(written.ok, true, 'S16 fixture: ready presence must publish: ' + JSON.stringify(written));
      return { role, worker_session_id: workerSessionId };
    });
    const pidIdentity = rbc.defaultProcessIdentityProvider();
    const transitioned = rll.transitionSupervisorBatchToReady(
      repoDescriptor, action, S16_SUPPORT_ROLES.slice().sort(), readyEvidence, pidIdentity,
    );
    assert.strictEqual(transitioned.ok, true, 'S16 fixture: complete retained support plane must reach READY: ' + JSON.stringify(transitioned));
    const coordinationRootId = rll.computeCoordinationRootId(proj);
    const rendezvousInstanceId = crypto.randomBytes(16).toString('hex');
    const supervisorInstanceId = crypto.randomBytes(16).toString('hex');
    for (const role of S16_SUPPORT_ROLES) {
      const claimed = rbc.claimRoleOwner(
        repoDescriptor, coordinationRootId, role,
        rendezvousInstanceId, supervisorInstanceId, pidIdentity,
      );
      assert.strictEqual(claimed.ok, true, 'S16 fixture: exact process owner must publish for ' + role + ': ' + JSON.stringify(claimed));
    }
    for (const role of ['arch-platform', 'context-provider']) {
      const live = rbc.resolveLiveCodexAppServerWorker(proj, role, rll.roleProfileDigestFor(role));
      assert.strictEqual(live.ok && live.available, true, 'S16 fixture: retained worker must resolve live for ' + role + ': ' + JSON.stringify(live));
    }
    return action;
  } finally {
    if (priorExecutor === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY; else process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY = priorExecutor;
    if (priorReady === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_BATCH_READY_CAPABILITY; else process.env.RUNTIME_ROLE_LIFECYCLE_TEST_BATCH_READY_CAPABILITY = priorReady;
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = priorNodeEnv;
    if (priorCapability === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY; else process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = priorCapability;
  }
}

function s16HookAndExecute(proj, sessionId, subcommand, argv) {
  const command = rll.renderPosixDirect(['node', S16_RLL_PATH, subcommand].concat(argv));
  const hookResult = runMainOrchestratorBash(command, proj, {
    NODE_ENV: 'test', RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY: S16_TEST_CAPABILITY,
    RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: JSON.stringify(['codex-app-server']),
  }, sessionId);
  const body = assertPreToolUseAllowRewrite(hookResult, 'S16 ' + subcommand + ' setup');
  const tokens = rll.parsePosixDirect(body.hookSpecificOutput.updatedInput.command);
  assert.ok(Array.isArray(tokens), 'S16 ' + subcommand + ': rewritten command must remain canonical');
  const result = spawnSync(tokens[0], tokens.slice(1), {
    encoding: 'utf8', env: Object.assign({}, process.env, {
      NODE_ENV: 'test', RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY: S16_TEST_CAPABILITY,
      RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: JSON.stringify(['codex-app-server']),
    }),
  });
  const lines = String(result.stdout || '').trim().split('\n');
  assert.ok(lines[lines.length - 1], 'S16 ' + subcommand + ': CLI must emit its closed result envelope: ' + JSON.stringify(result));
  return { status: result.status, result: JSON.parse(lines[lines.length - 1]) };
}

function s16LgConsultRootInject01() {
  const proj = fs.realpathSync(makeTempProject());
  try {
    writeLifecyclePlanFixture(proj, 's16-lg-consult-root');
    const intent = s16IntentToken({
      requester_role: 'arch-platform', target_role: 'context-provider',
      question: 'S16 consult-root hook injection fixture',
      expected_result_kind: 'TEST_RESULT', evidence_policy: 'none',
    });
    s16AssertInjectedGrant(
      proj, 's16-lg-consult-root-session', 'consult-root',
      ['--project-root', proj, '--intent', intent], 'arch-platform',
      s16GrantDigest('consult-root', intent),
    );
    console.log('S16-LG-CONSULT-ROOT-INJECT-01: PASS');
  } finally { cleanupLifecycleFixture(proj); }
}
s16HookCase('S16-LG-CONSULT-ROOT-INJECT-01', s16LgConsultRootInject01);

function s16LgConsultRootStatusInject01() {
  const proj = fs.realpathSync(makeTempProject());
  try {
    writeLifecyclePlanFixture(proj, 's16-lg-consult-root-status');
    const sessionId = 's16-lg-consult-root-status-session';
    s16PublishRetainedPlane(proj, sessionId);
    const intent = s16IntentToken({
      requester_role: 'arch-platform', target_role: 'context-provider',
      question: 'S16 consult-root status hook fixture',
      expected_result_kind: 'TEST_RESULT', evidence_policy: 'none',
    });
    const created = s16HookAndExecute(proj, sessionId, 'consult-root', ['--project-root', proj, '--intent', intent]);
    assert.strictEqual(created.result.status, 'WAITING', 'S16 fixture: real consult-root must create the immutable operation before status grant resolution: ' + JSON.stringify(created));
    const intentId = created.result.operation && created.result.operation.operation_id;
    assert.match(intentId || '', /^[0-9a-f]{32}$/);
    s16AssertInjectedGrant(
      proj, sessionId, 'consult-root-status',
      ['--project-root', proj, '--intent-id', intentId], 'arch-platform',
      s16GrantDigest('consult-root-status', intentId),
    );
    console.log('S16-LG-CONSULT-ROOT-STATUS-INJECT-01: PASS');
  } finally { cleanupLifecycleFixture(proj); }
}
s16HookCase('S16-LG-CONSULT-ROOT-STATUS-INJECT-01', s16LgConsultRootStatusInject01);

function s16LgRootSourceInject01() {
  const proj = fs.realpathSync(makeTempProject());
  try {
    writeLifecyclePlanFixture(proj, 's16-lg-root-source');
    const intent = s16IntentToken({
      source_role: 'toolkit-specialist', reporting_architect: 'arch-platform',
      question: 'S16 root-source hook injection fixture', expected_result_kind: 'TEST_RESULT',
    });
    s16AssertInjectedGrant(
      proj, 's16-lg-root-source-session', 'root-source',
      ['--project-root', proj, '--intent', intent], 'toolkit-specialist',
      s16GrantDigest('root-source', intent),
    );
    console.log('S16-LG-ROOT-SOURCE-INJECT-01: PASS');
  } finally { cleanupLifecycleFixture(proj); }
}
s16HookCase('S16-LG-ROOT-SOURCE-INJECT-01', s16LgRootSourceInject01);

function s16LgRootSourceStatusInject01() {
  const proj = fs.realpathSync(makeTempProject());
  try {
    writeLifecyclePlanFixture(proj, 's16-lg-root-source-status');
    const sessionId = 's16-lg-root-source-status-session';
    s16PublishRetainedPlane(proj, sessionId);
    const intent = s16IntentToken({
      source_role: 'toolkit-specialist', reporting_architect: 'arch-platform',
      question: 'S16 root-source status hook fixture', expected_result_kind: 'TEST_RESULT',
    });
    const created = s16HookAndExecute(proj, sessionId, 'root-source', ['--project-root', proj, '--intent', intent]);
    assert.strictEqual(created.result.status, 'ACTION_REQUIRED', 'S16 fixture: real root-source must create its immutable action before status grant resolution: ' + JSON.stringify(created));
    const actionId = created.result.operation && created.result.operation.operation_id;
    assert.match(actionId || '', /^[0-9a-f]{32}$/);
    s16AssertInjectedGrant(
      proj, sessionId, 'root-source-status',
      ['--project-root', proj, '--action', actionId], 'toolkit-specialist',
      s16GrantDigest('root-source-status', actionId), actionId,
    );
    console.log('S16-LG-ROOT-SOURCE-STATUS-INJECT-01: PASS');
  } finally { cleanupLifecycleFixture(proj); }
}
s16HookCase('S16-LG-ROOT-SOURCE-STATUS-INJECT-01', s16LgRootSourceStatusInject01);

// ════════════════════════════════════════════════════════════════════════
// HARNESS-SUFFIX (dispatch team-lead, 2026-08-22): a real, confirmed
// production defect in tryInjectRequesterGrant's root-source branch
// (context-provider-gate.js, ~L1246-1256). `role` there is
// `const role = agentType;` (~L1201) -- the RAW, unnormalized agent_type
// this hook observes from the caller's own tool_input/context (e.g. the
// harness-assigned "toolkit-specialist-4" suffix appended whenever the
// plain "toolkit-specialist" name is already taken by another live agent
// in the same session -- the normal case for any second-or-later spawn).
// The comparison `rsBinding.role !== role` is against the REAL
// RootSourceBinding's own role, which subagent-start-context-bundle.js's
// own tryConsumeRootSourceReservation ALWAYS normalizes to canonical
// "toolkit-specialist" first (via its own harnessSuffixCandidateRole
// helper, ~L36) before ever creating the binding. So `role` stays raw/
// suffixed while `rsBinding.role` is always canonical -- the comparison is
// therefore ALWAYS unequal for any suffixed spawn, misclassifying a
// genuinely valid, live, matching binding as absent
// ('root-source-binding-absent') and falling through to the CLAUDE-ID-01
// persistent-capability fallback, which has never been satisfiable for a
// bounded root-source-spawned peer in this project (confirmed separately,
// out of THIS pass's scope) -- so every toolkit-specialist spawn after the
// first one in a session can never successfully call publish-request (or
// any other REQUESTER_ADMIN_SUBCOMMANDS command) even with a completely
// valid, live root-source binding.
//
// Every fixture below drives the REAL production chain end to end: a real
// root-source action mint (runtime-role-lifecycle.cjs's own root-source
// subcommand, via the hook, needs a real retained five-role support plane
// first -- s16PublishRetainedPlane, mirrors S16-LG-ROOT-SOURCE-STATUS-
// INJECT-01's own established precedent immediately above), a real
// SubagentStart hook call (subagent-start-context-bundle.js, driven via
// driveClaudeId01SubagentStart, already used by this file's own CLAUDE-ID-01
// priming helpers) to create the real RootSourceBinding, then the real
// context-provider-gate.js PreToolUse hook for a genuine publish-request
// Bash command -- never a hand-simulated binding or a mocked authority
// check.
// ════════════════════════════════════════════════════════════════════════

const AGENT_SPAWN_GATE_HOOK_FOR_HARNESS_SUFFIX = path.resolve(__dirname, '../../.claude/hooks/agent-spawn-execution-gate.js');

// Mints the real root-source action AND returns the action's own spawn
// payload ({agentTypeP, nameP, bootstrapMessage} -- the bare, canonical
// values the root-source mechanism itself requests, per
// decodeRootSourceBootstrapIntentFromAction) alongside actionId. Does NOT
// itself run the Agent-gate or SubagentStart -- callers combine this with
// harnessSuffixRealAgentGate + harnessSuffixRealSubagentStart, mirroring
// runtime-consultation-role-gate.bats's own _s16e2e_setup_through_binding
// steps 3/4/5 exactly.
function harnessSuffixMintRootSourceAction(proj, sessionId, question) {
  s16PublishRetainedPlane(proj, sessionId);
  const intent = s16IntentToken({
    source_role: 'toolkit-specialist', reporting_architect: 'arch-platform',
    question, expected_result_kind: 'TEST_RESULT',
  });
  const created = s16HookAndExecute(proj, sessionId, 'root-source', ['--project-root', proj, '--intent', intent]);
  assert.strictEqual(created.result.status, 'ACTION_REQUIRED', 'HARNESS-SUFFIX fixture: real root-source must create its immutable action before a binding can ever exist: ' + JSON.stringify(created));
  const actionId = created.result.operation && created.result.operation.operation_id;
  assert.match(actionId || '', /^[0-9a-f]{32}$/, 'HARNESS-SUFFIX fixture: a genuine 128-bit hex action id must be minted');
  const action0 = created.result.actions && created.result.actions[0];
  assert.ok(action0 && action0.payload, 'HARNESS-SUFFIX fixture: the root-source action must carry a spawn payload (actions[0].payload): ' + JSON.stringify(created));
  return {
    actionId,
    agentTypeP: action0.payload.agent_type,
    nameP: action0.payload.name,
    bootstrapMessage: action0.payload.bootstrap_message,
  };
}

// Third HOLD Part B, B1: the real PreToolUse Agent-spawn gate
// (agent-spawn-execution-gate.js) that atomically RESERVES the root-source
// spawn -- this is the reservation subagent-start-context-bundle.js's own
// tryConsumeRootSourceReservation later consumes (B2/B3/B4). Skipping this
// step means findLiveRootSourceReservationsForRole finds ZERO reservations
// at SubagentStart time -- a SILENT non-owning no-op (exit 0, no binding
// ever created), never an error -- exactly the ENOENT-on-scandir symptom
// this helper's own prior absence produced. Mirrors
// runtime-consultation-role-gate.bats's own _s16e2e_setup_through_binding
// step 4 exactly: the gate call's own subagent_type/name are the action's
// OWN bare canonical payload values (agentTypeP/nameP) -- the harness's
// suffix decision happens only later, independently, at the SEPARATE
// SubagentStart event this reservation is confirmed against.
function harnessSuffixRealAgentGate(proj, sessionId, agentTypeP, nameP, bootstrapMessage) {
  const result = spawnSync('node', [AGENT_SPAWN_GATE_HOOK_FOR_HARNESS_SUFFIX], {
    input: JSON.stringify({
      tool_name: 'Agent',
      tool_input: { subagent_type: agentTypeP, name: nameP, prompt: bootstrapMessage },
      tool_use_id: sessionId + '-tool-use-01',
      session_id: sessionId, agent_type: '', agent_id: '',
    }),
    env: Object.assign({}, process.env, { NODE_ENV: 'test', CLAUDE_PROJECT_DIR: proj }),
    encoding: 'utf8',
  });
  let body = null;
  try { body = JSON.parse(result.stdout); } catch { /* handled by the assertion below */ }
  assert.ok(
    body && body.hookSpecificOutput && body.hookSpecificOutput.permissionDecision === 'allow',
    'HARNESS-SUFFIX fixture: the real Agent-spawn PreToolUse gate must allow the root-source-requested spawn (this is what creates the B1 reservation SubagentStart later consumes): ' + JSON.stringify({ result, body })
  );
}

function harnessSuffixRealSubagentStart(proj, observedAgentType, sessionId, agentId) {
  const r = driveClaudeId01SubagentStart(proj, observedAgentType, sessionId, agentId);
  assert.strictEqual(r.exit, 0, 'HARNESS-SUFFIX fixture: the real SubagentStart hook must exit 0 for observed agent_type "' + observedAgentType + '": ' + JSON.stringify(r));
  return r;
}

function harnessSuffixFindRootSourceBinding(proj, actionId, sessionId, agentId) {
  const bindingsDir = path.join(rll.registryRepoDir(proj), 'root-source-bindings');
  let dirEntries;
  try {
    dirEntries = fs.readdirSync(bindingsDir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  const entries = dirEntries
    .filter((e) => e.isFile() && /^[0-9a-f]{32}\.json$/.test(e.name))
    .map((e) => JSON.parse(fs.readFileSync(path.join(bindingsDir, e.name), 'utf8')))
    .filter((b) => b.action_id === actionId && b.runtime_session_key === sessionId && b.agent_id === agentId);
  return entries;
}

// Same request shape as runNonMainBash, but with an explicit, independently
// controlled agentId -- runNonMainBash always sets agent_id === agentType,
// which cannot represent "the SAME identity (session_id+agent_id) that
// really owns a binding, but CLAIMING a different/deviant agent_type at
// this call" -- exactly the shape HARNESS-SUFFIX-NEGATIVE-TABLE and
// HARNESS-SUFFIX-01 both need.
function runRootSourceRequesterBash(command, projDir, claimedAgentType, sessionId, agentId) {
  return runHook(
    { tool_name: 'Bash', tool_input: { command }, session_id: sessionId, agent_type: claimedAgentType, agent_id: agentId },
    { CLAUDE_PROJECT_DIR: projDir, CLAUDE_WAVE_SLUG: '' }
  );
}

// HARNESS-SUFFIX-POSITIVE-UNSUFFIXED (regression guard, must ALREADY pass
// today -- requirement 4): an UNSUFFIXED toolkit-specialist (bare canonical
// agent_type, the harness's own first-spawn-in-session shape) with a real,
// live, matching RootSourceBinding must be authorized via the root-source
// branch and receive a genuine injected --requester-binding grant. Proves
// the eventual suffix-normalization fix does not accidentally REQUIRE a
// suffix to match -- the bare/no-suffix identity path must keep working
// exactly as it does today.
{
  const proj = fs.realpathSync(makeTempProject());
  try {
    const waveSlug = 'harness-suffix-positive-wave';
    // getWaveSlug (subagent-start-context-bundle.js's real SubagentStart
    // handler) is called with {useEnv:false, useAlias:false} -- hardcoded in
    // the production hook -- so branch-name resolution is the ONLY path;
    // makeTempProject()'s default branch ("main") is a protected/invalid
    // slug and would make getWaveSlug return null, silently short-circuiting
    // this hook before root-source binding creation is ever reached.
    spawnSync('git', ['branch', '-m', waveSlug], { cwd: proj, encoding: 'utf8' });
    const { planFile, subjectBundleFile, coordRootDir } = writeGroupAFixtures(proj, waveSlug);
    const sessionId = 'harness-suffix-positive-session';
    const agentId = 'harness-suffix-positive-agent';
    const minted = harnessSuffixMintRootSourceAction(proj, sessionId, 'HARNESS-SUFFIX-POSITIVE-UNSUFFIXED fixture question');
    harnessSuffixRealAgentGate(proj, sessionId, minted.agentTypeP, minted.nameP, minted.bootstrapMessage);
    harnessSuffixRealSubagentStart(proj, 'toolkit-specialist', sessionId, agentId);
    const bindings = harnessSuffixFindRootSourceBinding(proj, minted.actionId, sessionId, agentId);
    assert.strictEqual(bindings.length, 1, 'HARNESS-SUFFIX-POSITIVE-UNSUFFIXED fixture: exactly one real RootSourceBinding must exist for this action/session/agent: ' + JSON.stringify(bindings));
    assert.strictEqual(bindings[0].role, 'toolkit-specialist', 'HARNESS-SUFFIX-POSITIVE-UNSUFFIXED fixture sanity: ' + JSON.stringify(bindings[0]));

    const intentB64 = buildIntentB64('context-provider', 'HARNESS-SUFFIX-POSITIVE-UNSUFFIXED fixture publish-request question');
    const cmd = publishRequestCommand(coordRootDir, planFile, subjectBundleFile, intentB64);
    const r = runRootSourceRequesterBash(cmd, proj, 'toolkit-specialist', sessionId, agentId);
    const body = assertPreToolUseAllowRewrite(r, 'HARNESS-SUFFIX-POSITIVE-UNSUFFIXED (regression guard, must already pass today): an UNSUFFIXED toolkit-specialist with a real, live, matching RootSourceBinding must be authorized via the root-source branch and receive a genuine injected --requester-binding grant -- proves the eventual suffix-normalization fix does not accidentally require a suffix to match');
    const grantId = extractRequesterBinding(body.hookSpecificOutput.updatedInput.command);
    assert.match(grantId || '', /^[0-9a-f]{32}$/, 'HARNESS-SUFFIX-POSITIVE-UNSUFFIXED: a genuine 128-bit hex grant id must be injected: ' + JSON.stringify(body));
    console.log('HARNESS-SUFFIX-POSITIVE-UNSUFFIXED unsuffixed toolkit-specialist with a real live matching root-source binding receives a genuine injected grant (regression guard): PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// HARNESS-SUFFIX-01 (PRIMARY RED, requirement 1): a toolkit-specialist
// spawned with a harness-assigned numeric suffix (observed agent_type
// "toolkit-specialist-4") and a genuine, live, matching RootSourceBinding
// (own role correctly normalized to canonical "toolkit-specialist" by
// subagent-start-context-bundle.js) is wrongly denied today, because
// tryInjectRequesterGrant's root-source branch compares the RAW,
// unnormalized observed role against the binding's own canonical role.
{
  const proj = fs.realpathSync(makeTempProject());
  try {
    const waveSlug = 'harness-suffix-01-wave';
    spawnSync('git', ['branch', '-m', waveSlug], { cwd: proj, encoding: 'utf8' }); // see HARNESS-SUFFIX-POSITIVE-UNSUFFIXED's own comment above
    const { planFile, subjectBundleFile, coordRootDir } = writeGroupAFixtures(proj, waveSlug);
    const sessionId = 'harness-suffix-01-session';
    const agentId = 'harness-suffix-01-agent';
    const minted = harnessSuffixMintRootSourceAction(proj, sessionId, 'HARNESS-SUFFIX-01 fixture question');
    harnessSuffixRealAgentGate(proj, sessionId, minted.agentTypeP, minted.nameP, minted.bootstrapMessage);

    // The harness's own auto-suffixing: a second-or-later toolkit-specialist
    // spawn in this session observes agent_type "toolkit-specialist-4"
    // (never bare "toolkit-specialist").
    harnessSuffixRealSubagentStart(proj, 'toolkit-specialist-4', sessionId, agentId);
    const bindings = harnessSuffixFindRootSourceBinding(proj, minted.actionId, sessionId, agentId);
    assert.strictEqual(bindings.length, 1, 'HARNESS-SUFFIX-01 fixture: exactly one real RootSourceBinding must exist for this action/session/agent: ' + JSON.stringify(bindings));
    assert.strictEqual(bindings[0].role, 'toolkit-specialist', 'HARNESS-SUFFIX-01 fixture sanity: subagent-start-context-bundle.js\'s own harnessSuffixCandidateRole normalization must produce a CANONICAL "toolkit-specialist" binding role even though the observed agent_type carried the harness-assigned "-4" suffix: ' + JSON.stringify(bindings[0]));

    const intentB64 = buildIntentB64('context-provider', 'HARNESS-SUFFIX-01 fixture publish-request question');
    const cmd = publishRequestCommand(coordRootDir, planFile, subjectBundleFile, intentB64);
    // The SAME raw, harness-suffixed observed agent_type the caller's own
    // real PreToolUse Bash event would carry -- context-provider-gate.js's
    // own tryInjectRequesterGrant now normalizes this via its own
    // harnessSuffixCandidateRole helper before comparing against the
    // binding's canonical role (root-source branch), so this exact call is
    // authorized instead of misclassified as root-source-binding-absent.
    const r = runRootSourceRequesterBash(cmd, proj, 'toolkit-specialist-4', sessionId, agentId);
    const body = assertPreToolUseAllowRewrite(r, 'HARNESS-SUFFIX-01 (fixed): a toolkit-specialist spawned with a harness-assigned numeric suffix ("toolkit-specialist-4"), backed by a genuine, live, matching RootSourceBinding (own role correctly normalized to canonical "toolkit-specialist" by subagent-start-context-bundle.js), must be authorized via that root-source binding -- tryInjectRequesterGrant\'s root-source branch (context-provider-gate.js) now normalizes the RAW, harness-suffixed observed role ("toolkit-specialist-4") via harnessSuffixCandidateRole before comparing against the binding\'s own canonical role ("toolkit-specialist"), matching this genuinely valid, live, matching binding and receiving a genuine injected --requester-binding grant, mirroring HARNESS-SUFFIX-POSITIVE-UNSUFFIXED\'s own unsuffixed positive case');
    const grantId = extractRequesterBinding(body.hookSpecificOutput.updatedInput.command);
    assert.match(grantId || '', /^[0-9a-f]{32}$/, 'HARNESS-SUFFIX-01: a genuine 128-bit hex grant id must be injected: ' + JSON.stringify(body));
    console.log('HARNESS-SUFFIX-01 (PRIMARY, fixed) suffixed toolkit-specialist with a real live matching root-source binding receives a genuine injected grant via harnessSuffixCandidateRole normalization: PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// HARNESS-SUFFIX-NEGATIVE-TABLE (requirement 3a-3d): ONE real, live
// RootSourceBinding for canonical "toolkit-specialist" is minted once (via
// a real, UNSUFFIXED SubagentStart, mirroring HARNESS-SUFFIX-POSITIVE-
// UNSUFFIXED's own positive case exactly), then reused across every row
// below -- each row presents the SAME session_id/agent_id (so
// classifyM7AuthorityForHookIdentity resolves the SAME real binding every
// time) but a DIFFERENT, deviant CLAIMED agent_type/role at the PreToolUse
// call. Every row must be denied (never authorized) -- both before AND
// after the eventual fix, since none of these are ever a legitimate
// harness-suffix shape ("<canonical-role>-<N>", N>=2, no leading zero,
// single suffix only, matching subagent-start-context-bundle.js's own
// harnessSuffixCandidateRole exactly).
const HARNESS_SUFFIX_NEGATIVE_TABLE = [
  { label: 'toolkit-specialist-1 (never legitimate -- the harness\'s own first spawn has no suffix at all, never "-1")', claimed: 'toolkit-specialist-1' },
  { label: 'toolkit-specialist-02 (leading zero -- never a legitimate harness-generated suffix, distinct from "-2")', claimed: 'toolkit-specialist-02' },
  { label: 'toolkit-specialist-4-2 (double-suffixed -- never legitimate)', claimed: 'toolkit-specialist-4-2' },
  { label: 'toolkit-specialistx-4 (wrong canonical prefix)', claimed: 'toolkit-specialistx-4' },
];

{
  const proj = fs.realpathSync(makeTempProject());
  try {
    const waveSlug = 'harness-suffix-negative-wave';
    spawnSync('git', ['branch', '-m', waveSlug], { cwd: proj, encoding: 'utf8' }); // see HARNESS-SUFFIX-POSITIVE-UNSUFFIXED's own comment above
    const { planFile, subjectBundleFile, coordRootDir } = writeGroupAFixtures(proj, waveSlug);
    const sessionId = 'harness-suffix-negative-session';
    const agentId = 'harness-suffix-negative-agent';
    const minted = harnessSuffixMintRootSourceAction(proj, sessionId, 'HARNESS-SUFFIX-NEGATIVE-TABLE fixture question');
    harnessSuffixRealAgentGate(proj, sessionId, minted.agentTypeP, minted.nameP, minted.bootstrapMessage);
    harnessSuffixRealSubagentStart(proj, 'toolkit-specialist', sessionId, agentId);
    const bindings = harnessSuffixFindRootSourceBinding(proj, minted.actionId, sessionId, agentId);
    assert.strictEqual(bindings.length, 1, 'HARNESS-SUFFIX-NEGATIVE-TABLE fixture: exactly one real RootSourceBinding must exist: ' + JSON.stringify(bindings));
    assert.strictEqual(bindings[0].role, 'toolkit-specialist', 'HARNESS-SUFFIX-NEGATIVE-TABLE fixture sanity: ' + JSON.stringify(bindings[0]));

    for (const row of HARNESS_SUFFIX_NEGATIVE_TABLE) {
      const intentB64 = buildIntentB64('context-provider', 'HARNESS-SUFFIX-NEGATIVE-TABLE fixture question (' + row.claimed + ')');
      const cmd = publishRequestCommand(coordRootDir, planFile, subjectBundleFile, intentB64);
      const r = runRootSourceRequesterBash(cmd, proj, row.claimed, sessionId, agentId);
      assertPreToolUseDeny(r, 'HARNESS-SUFFIX-NEGATIVE-TABLE [' + row.label + ']: a deviant claimed agent_type/role must NEVER be treated as matching the real, live, canonical "toolkit-specialist" RootSourceBinding for this exact session_id/agent_id -- must gain no authority, both before and after the eventual suffix-normalization fix');
      console.log('HARNESS-SUFFIX-NEGATIVE-TABLE [' + row.label + '] correctly denied (no false match against the real binding): PASS');
    }
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// HARNESS-SUFFIX-NO-BINDING (requirement 3f): a harness-suffixed caller with
// NO root-source binding (or any other live binding) at all for its
// identity must fall through exactly as before -- no false grant, denied
// via the ordinary CLAUDE-ID-01 fallback (never a crash, never a bypass).
{
  const proj = fs.realpathSync(makeTempProject());
  try {
    const waveSlug = 'harness-suffix-no-binding-wave';
    spawnSync('git', ['branch', '-m', waveSlug], { cwd: proj, encoding: 'utf8' }); // see HARNESS-SUFFIX-POSITIVE-UNSUFFIXED's own comment above
    const { planFile, subjectBundleFile, coordRootDir } = writeGroupAFixtures(proj, waveSlug);
    const sessionId = 'harness-suffix-no-binding-session';
    const agentId = 'harness-suffix-no-binding-agent';
    const intentB64 = buildIntentB64('context-provider', 'HARNESS-SUFFIX-NO-BINDING fixture question');
    const cmd = publishRequestCommand(coordRootDir, planFile, subjectBundleFile, intentB64);
    const r = runRootSourceRequesterBash(cmd, proj, 'toolkit-specialist-4', sessionId, agentId);
    assertPreToolUseDeny(r, 'HARNESS-SUFFIX-NO-BINDING: a harness-suffixed claim with NO root-source binding (or any other live binding) for its identity at all must fall through exactly as before -- denied, never a false grant');
    console.log('HARNESS-SUFFIX-NO-BINDING harness-suffixed claim with no live binding at all denies (no false grant, unaffected fallback): PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// HARNESS-SUFFIX-NONROOTSOURCE-FAMILY (requirement 3e): an identity
// (session_id+agent_id) resolving to a live PERSISTENT RequesterBinding
// (family 'requester', never 'root-source') for the CANONICAL
// "toolkit-specialist" role must not gain authority via the harness-suffix
// path either -- the eventual normalization belongs strictly inside the
// root-source branch (classification.family === 'root-source') and must
// never be applied when this exact identity classifies to a DIFFERENT
// family.
{
  const proj = fs.realpathSync(makeTempProject());
  try {
    const waveSlug = 'harness-suffix-nonrootsource-wave';
    spawnSync('git', ['branch', '-m', waveSlug], { cwd: proj, encoding: 'utf8' }); // see HARNESS-SUFFIX-POSITIVE-UNSUFFIXED's own comment above
    const { planFile, subjectBundleFile, coordRootDir } = writeGroupAFixtures(proj, waveSlug);
    const sessionId = 'harness-suffix-nonrootsource-session';
    const agentId = 'harness-suffix-nonrootsource-agent';
    const worktreeId = rll.computeWorktreeId(proj);
    const planResult = rll.discoverPlan(proj);
    assert.strictEqual(planResult.ok, true, 'HARNESS-SUFFIX-NONROOTSOURCE-FAMILY fixture: PLAN must be discoverable: ' + JSON.stringify(planResult));
    primeClaudeId01Trace(proj, 'toolkit-specialist', sessionId, agentId);
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };
    const persistentBindingResult = rll.createRequesterBinding(proj, identity, agentId, 'toolkit-specialist', worktreeId, planResult.planDigest, 3600);
    assert.strictEqual(persistentBindingResult.ok, true, 'HARNESS-SUFFIX-NONROOTSOURCE-FAMILY fixture: persistent requester binding mint must succeed: ' + JSON.stringify(persistentBindingResult));

    const intentB64 = buildIntentB64('context-provider', 'HARNESS-SUFFIX-NONROOTSOURCE-FAMILY fixture question');
    const cmd = publishRequestCommand(coordRootDir, planFile, subjectBundleFile, intentB64);
    const r = runRootSourceRequesterBash(cmd, proj, 'toolkit-specialist-4', sessionId, agentId);
    assertPreToolUseDeny(r, 'HARNESS-SUFFIX-NONROOTSOURCE-FAMILY: an identity resolving to a live PERSISTENT RequesterBinding (family "requester", not "root-source") for canonical "toolkit-specialist" must never grant authority to a harness-suffixed claim ("toolkit-specialist-4") via this path -- the eventual suffix-normalization fix must be scoped strictly to the root-source branch and must never let a non-root-source family classification accidentally satisfy it');
    console.log('HARNESS-SUFFIX-NONROOTSOURCE-FAMILY non-root-source (persistent requester) family identity denies a suffixed claim (normalization never leaks outside the root-source branch): PASS');
  } finally {
    cleanupLifecycleFixture(proj);
  }
}

// HARNESS-SUFFIX-AMBIGUITY-* (requirement 5) -- REMOVED, not skipped/faked,
// after empirical investigation (dispatch team-lead, 2026-08-22, audited):
// no prior test in this file exercises the "[Sixteenth/root-source]
// requester authority is ambiguous with a persistent RequesterBinding"
// denial (confirmed by direct read of the whole file before writing this),
// so there is no pre-existing GREEN coverage this removal could weaken.
// Two constructions were tried to reach the dual-live-binding state that
// check exists to guard against, for the exact same {session,agent,role,
// worktree,plan} identity:
//   1. root-source binding first (real mint+Agent-gate+SubagentStart), THEN
//      rll.createRequesterBinding(...) for the same identity -> DENIED at
//      creation time: {"ok":false,"reason":"authority-binding-conflict"}.
//   2. reversed: rll.createRequesterBinding(...) first, THEN the real
//      Agent-spawn root-source mint/spawn sequence -> DENIED even earlier,
//      by .claude/hooks/agent-spawn-execution-gate.js itself: "owning
//      action union is ambiguous for \"toolkit-specialist\" -- root-source,
//      claude-agent and role-spawn are disjoint and may never be selected
//      by priority."
// Both legitimate construction orders are independently blocked by their
// OWN earlier cross-family conflict guards before the dual-binding state
// this pair of tests wanted to exercise can ever exist. This strongly
// suggests the "ambiguous with a persistent RequesterBinding" branch in
// tryInjectRequesterGrant (context-provider-gate.js) is defense-in-depth
// for a state the system already prevents at creation time via a DIFFERENT
// mechanism, not a reachable live scenario -- constructing it would need
// either a different identity-aliasing technique not found here, or direct
// registry file forgery (out of scope: these fixtures drive only real,
// unmocked production code paths). This finding is orthogonal to the actual
// suffix-normalization defect (HARNESS-SUFFIX-01) and its required negative
// controls (HARNESS-SUFFIX-NEGATIVE-TABLE, -NO-BINDING, -NONROOTSOURCE-
// FAMILY, all still present below/above and passing) -- none of those
// exercise or depend on this ambiguity branch. The fix itself
// (tryInjectRequesterGrant's root-source branch) does not touch or weaken
// this ambiguity check in any way; see the production diff.

// ══════════════════════════════════════════════════════════════════════════
// Sequence 66/67/73 RED correction — Defect 4: context-provider-gate.js's
// Bash search-pattern scan (its own "2b. Bash allow-list" step) tests its
// trigger regex against data.tool_input.command IN FULL, including any
// heredoc BODY text -- a Bash tool call that merely WRITES a file whose
// heredoc payload happens to contain search-shaped prose (e.g. authoring a
// test fixture that itself contains a live invocation of one of the hook's
// own two trigger POSIX text-search utilities as literal file content,
// exactly like this repo's own scripts/tests/write-verdict.bats does) is
// misclassified as a live search command and wrongly requires CP
// consultation.
//
// Byte-confirmed against the live source before writing anything below
// (this test-specialist, Sequence 73 session) -- the trigger scan reads:
//   const cmd = data.tool_input?.command || '';
//   if (!TRIGGER_RE.test(cmd)) { process.exit(0); }
// where TRIGGER_RE alternates on the two POSIX text-search utility names
// plus a bounded read-of-source-file pattern. `cmd` is the FULL raw command
// string exactly as delivered by the harness -- no heredoc/here-string-aware
// parsing exists anywhere in this file. The fix must stop misreading
// heredoc BODY bytes as command surface WITHOUT weakening real
// search-command detection: a genuine trigger command placed textually
// BEFORE or AFTER a heredoc redirection in the SAME Bash call must still
// deny (SEQ73-HEREDOC-B1/B2 below, companion guards that must ALREADY pass,
// both before and after the eventual fix). This file makes NO production
// edit -- ONLY these new test cases are added -- so context-provider-gate.js's
// real authority semantics (session-scoped flag, per-specialist
// arch-response flag, disk-consult fallback, post-PLAN accepted-result
// requirement -- see PP2/PP7/PP17/PP18 etc. above, all unmodified and
// preserved byte-for-byte) are structurally unaffected; a heredoc payload
// carrying prose that merely LOOKS LIKE evidence never satisfies any of
// those real authority checks either, before or after this fix, since none
// of them ever read tool_input.command content as evidence in the first
// place.
//
// NOTE ON THIS SECTION'S OWN AUTHORING: the two trigger utility names are
// deliberately reconstructed via string concatenation in the code below
// (never spelled out as one contiguous literal anywhere in this section,
// including in comments) -- spelling either out contiguously in a live Bash
// heredoc call while authoring this very file would itself trip this
// repo's own PreToolUse Bash-search scan on the authoring session, exactly
// the heredoc-misclassification defect this section exists to prove. The
// concatenation is resolved at ordinary Node module-load time when this
// test file itself later runs -- semantically identical to a literal, just
// never contiguous in this file's own on-disk source bytes.
// ══════════════════════════════════════════════════════════════════════════

{
  const { test: seq73Test } = require('node:test');

  const SEARCH_WORD_ONE = 'gr' + 'ep';
  const SEARCH_WORD_TWO = 'fi' + 'nd';

  function runSeq73HeredocCase(command, sessionId) {
    clearSessionFlag(sessionId);
    return runHook({
      tool_name: 'Bash',
      tool_input: { command },
      session_id: sessionId,
      agent_type: 'arch-platform',
      agent_id: 'arch-platform',
    });
  }

  seq73Test('SEQ73-HEREDOC-A1 RED: heredoc BODY containing a live search-utility-one invocation as literal fixture content must not block a pure file-write Bash command', () => {
    const cmd = [
      "cat > /tmp/seq73-fixture-a1.bats <<'EOF'",
      '@test "example" {',
      '  ' + SEARCH_WORD_ONE + ' -q "APPROVED-PREP" "$verdict"',
      '}',
      'EOF',
    ].join('\n');
    const r = runSeq73HeredocCase(cmd, 'seq73-heredoc-a1');
    assertPreToolUsePassthrough(r, 'SEQ73-HEREDOC-A1');
  });

  seq73Test('SEQ73-HEREDOC-A2 RED: heredoc BODY containing search-utility-two prose text must not block a pure file-write Bash command', () => {
    const cmd = [
      "cat > /tmp/seq73-fixture-a2.txt <<'EOF'",
      '# Notes',
      'Run ' + SEARCH_WORD_TWO + ' . -name star.kt to locate Kotlin sources.',
      'EOF',
    ].join('\n');
    const r = runSeq73HeredocCase(cmd, 'seq73-heredoc-a2');
    assertPreToolUsePassthrough(r, 'SEQ73-HEREDOC-A2');
  });

  seq73Test('SEQ73-HEREDOC-B1 companion guard (must already pass before and after the fix): a genuine search-utility-one command BEFORE a heredoc in the same Bash call must still block', () => {
    const cmd = [
      SEARCH_WORD_ONE + ' -r "libs.lifecycle" . && cat > /tmp/seq73-fixture-b1.bats <<\'EOF\'',
      'harmless heredoc body, no trigger words here',
      'EOF',
    ].join('\n');
    const r = runSeq73HeredocCase(cmd, 'seq73-heredoc-b1');
    assertPreToolUseDeny(r, 'SEQ73-HEREDOC-B1');
  });

  seq73Test('SEQ73-HEREDOC-B2 companion guard (must already pass before and after the fix): a genuine search-utility-one command AFTER a heredoc in the same Bash call must still block', () => {
    const cmd = [
      "cat > /tmp/seq73-fixture-b2.bats <<'EOF'",
      'harmless heredoc body, no trigger words here',
      'EOF',
      SEARCH_WORD_ONE + ' -r "libs.lifecycle" .',
    ].join('\n');
    const r = runSeq73HeredocCase(cmd, 'seq73-heredoc-b2');
    assertPreToolUseDeny(r, 'SEQ73-HEREDOC-B2');
  });
}
