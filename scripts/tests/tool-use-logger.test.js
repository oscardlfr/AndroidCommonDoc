#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const HOOK = path.resolve(__dirname, '../../.claude/hooks/tool-use-logger.js');
const LOG = path.join(os.tmpdir(), '.androidcommondoc', 'tool-use-log.jsonl');

// Ensure log dir exists in tmpdir
fs.mkdirSync(path.join(os.tmpdir(), '.androidcommondoc'), { recursive: true });

function runHook(payload, env = {}) {
  try { fs.unlinkSync(LOG); } catch {}
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const result = spawnSync('node', [HOOK], {
    input,
    env: { ...process.env, CLAUDE_PROJECT_DIR: os.tmpdir(), ...env },
    encoding: 'utf8',
  });
  let line = null;
  if (fs.existsSync(LOG)) {
    const raw = fs.readFileSync(LOG, 'utf8').trim();
    if (raw) {
      try { line = JSON.parse(raw); } catch {}
    }
  }
  return { line, stderr: result.stderr, status: result.status };
}

// T1: Bash tool
const t1 = runHook({ tool_name: 'Bash', tool_input: { command: 'echo hello' }, session_id: 'sess1' });
assert.strictEqual(t1.status, 0, 'T1: hook must exit 0');
assert.ok(t1.line, 'T1: log line must exist');
assert.strictEqual(t1.line.tool_name, 'Bash', 'T1: tool_name');
assert.strictEqual(t1.line.input_summary, 'echo hello', 'T1: input_summary from command');
assert.strictEqual(t1.line.mcp_server, null, 'T1: mcp_server null for non-mcp');
assert.ok(t1.line.input_summary.length <= 80, 'T1: input_summary <= 80 chars');
assert.strictEqual(t1.line.session_id, 'sess1', 'T1: session_id');
console.log('T1 Bash: PASS');

// T2: Grep tool
const t2 = runHook({ tool_name: 'Grep', tool_input: { pattern: 'libs.lifecycle' }, session_id: 'sess1' });
assert.strictEqual(t2.status, 0, 'T2: hook must exit 0');
assert.ok(t2.line, 'T2: log line must exist');
assert.strictEqual(t2.line.input_summary, 'libs.lifecycle', 'T2: input_summary from pattern');
assert.ok(t2.line.input_summary.length <= 80, 'T2: input_summary <= 80 chars');
console.log('T2 Grep: PASS');

// T3: mcp__ tool — context7
const t3 = runHook({ tool_name: 'mcp__context7__get-library-docs', tool_input: { libraryId: 'react' }, session_id: 'sess1' });
assert.strictEqual(t3.status, 0, 'T3: hook must exit 0');
assert.ok(t3.line, 'T3: log line must exist');
assert.strictEqual(t3.line.mcp_server, 'context7', 'T3: mcp_server');
assert.strictEqual(t3.line.mcp_tool, 'get-library-docs', 'T3: mcp_tool');
assert.ok(t3.line.input_summary.length <= 80, 'T3: input_summary <= 80 chars');
console.log('T3 mcp__context7: PASS');

// T4: SendMessage
const t4 = runHook({ tool_name: 'SendMessage', tool_input: { to: 'context-provider', summary: 'query patterns' }, session_id: 'sess1' });
assert.strictEqual(t4.status, 0, 'T4: hook must exit 0');
assert.ok(t4.line, 'T4: log line must exist');
assert.ok(t4.line.input_summary.startsWith('context-provider:'), 'T4: input_summary starts with to:');
assert.ok(t4.line.input_summary.length <= 80, 'T4: input_summary <= 80 chars');
console.log('T4 SendMessage: PASS');

// T5: cp_bypass_blocked — marker file present, correct agentId suffix
const marker = path.join(os.tmpdir(), 'claude-cp-blocked-sess2-test-agent.flag');
fs.writeFileSync(marker, '1');
const t5 = runHook({ tool_name: 'Grep', tool_input: { pattern: 'test' }, session_id: 'sess2', agent_id: 'test-agent' });
assert.strictEqual(t5.status, 0, 'T5: hook must exit 0');
assert.ok(t5.line, 'T5: log line must exist');
assert.strictEqual(t5.line.cp_bypass_blocked, true, 'T5: cp_bypass_blocked true when marker present');
assert.ok(!fs.existsSync(marker), 'T5: marker deleted after read');
console.log('T5 cp_bypass_blocked: PASS');

// T6: invalid JSON — fail open
const t6 = runHook('not-json');
assert.strictEqual(t6.status, 0, 'T6: hook must exit 0 on invalid JSON');
console.log('T6 invalid JSON fail-open: PASS');

// T7: Read tool input_summary from file_path
const longPath = 'a'.repeat(100);
const t7 = runHook({ tool_name: 'Read', tool_input: { file_path: longPath }, session_id: 'sess1' });
assert.ok(t7.line, 'T7: log line must exist');
assert.ok(t7.line.input_summary.length <= 80, 'T7: input_summary truncated to 80 chars');
assert.strictEqual(t7.line.input_summary, longPath.slice(0, 80), 'T7: input_summary is truncated file_path');
console.log('T7 Read truncation: PASS');

// T8: Skill tool populates skill_name
const t8 = runHook({ tool_name: 'Skill', tool_input: { name: 'validate-patterns' }, session_id: 'sess1' });
assert.ok(t8.line, 'T8: log line must exist');
assert.strictEqual(t8.line.skill_name, 'validate-patterns', 'T8: skill_name populated');
assert.strictEqual(t8.line.input_summary, 'validate-patterns', 'T8: input_summary from skill name');
console.log('T8 Skill: PASS');

// T9: agent_id field emitted when provided in payload
const t9 = runHook({ tool_name: 'Bash', tool_input: { command: 'echo t9' }, session_id: 'sess9', agent_id: 'some-id@session-xyz' });
assert.ok(t9.line, 'T9: log line must exist');
assert.strictEqual(t9.line.agent_id, 'some-id@session-xyz', 'T9: agent_id field correct');
console.log('T9 agent_id field: PASS');

// T10: agent_type field emitted when provided in payload
const t10 = runHook({ tool_name: 'Bash', tool_input: { command: 'echo t10' }, session_id: 'sess10', agent_type: 'arch-platform' });
assert.ok(t10.line, 'T10: log line must exist');
assert.strictEqual(t10.line.agent_type, 'arch-platform', 'T10: agent_type field correct');
console.log('T10 agent_type field: PASS');

// T11: non-blockable tool (SendMessage) with marker present — must NOT consume marker
const t11Marker = path.join(os.tmpdir(), 'claude-cp-blocked-sess5-test-agent.flag');
fs.writeFileSync(t11Marker, '1');
const t11 = runHook({ tool_name: 'SendMessage', tool_input: { to: 'arch-platform', summary: 'query' }, session_id: 'sess5', agent_id: 'test-agent' });
assert.strictEqual(t11.status, 0, 'T11: hook must exit 0');
assert.ok(t11.line, 'T11: log line must exist');
assert.strictEqual(t11.line.cp_bypass_blocked, false, 'T11: cp_bypass_blocked false for non-blockable tool');
assert.ok(fs.existsSync(t11Marker), 'T11: marker STILL PRESENT after non-blockable tool');
try { fs.unlinkSync(t11Marker); } catch {}
console.log('T11 non-blockable tool does not consume marker: PASS');

// T12: Read tool with marker for WRONG agentId — must NOT consume marker
const t12Marker = path.join(os.tmpdir(), 'claude-cp-blocked-sess6-other-agent.flag');
fs.writeFileSync(t12Marker, '1');
const t12 = runHook({ tool_name: 'Read', tool_input: { file_path: '/some/path' }, session_id: 'sess6', agent_id: 'read-agent' });
assert.strictEqual(t12.status, 0, 'T12: hook must exit 0');
assert.ok(t12.line, 'T12: log line must exist');
assert.strictEqual(t12.line.cp_bypass_blocked, false, 'T12: cp_bypass_blocked false for wrong agentId marker');
assert.ok(fs.existsSync(t12Marker), 'T12: wrong-agentId marker STILL PRESENT after hook');
try { fs.unlinkSync(t12Marker); } catch {}
console.log('T12 wrong agentId marker not consumed: PASS');

// T13: Read tool with correct agentId marker — must consume and return true
const t13Marker = path.join(os.tmpdir(), 'claude-cp-blocked-sess3-read-agent.flag');
fs.writeFileSync(t13Marker, '1');
const t13 = runHook({ tool_name: 'Read', tool_input: { file_path: '/some/path' }, session_id: 'sess3', agent_id: 'read-agent' });
assert.strictEqual(t13.status, 0, 'T13: hook must exit 0');
assert.ok(t13.line, 'T13: log line must exist');
assert.strictEqual(t13.line.cp_bypass_blocked, true, 'T13: cp_bypass_blocked true for Read with correct agentId');
assert.ok(!fs.existsSync(t13Marker), 'T13: marker deleted after read');
console.log('T13 Read correct agentId consumed: PASS');

// T14: absent agent_id — fallback to 'unknown' (arch-platform BINDING: data.agent_id || 'unknown')
// Marker: claude-cp-blocked-sess4-unknown.flag (reconciles arch-platform 'unknown' over arch-testing '' assumption)
const t14Marker = path.join(os.tmpdir(), 'claude-cp-blocked-sess4-unknown.flag');
fs.writeFileSync(t14Marker, '1');
const t14 = runHook({ tool_name: 'Bash', tool_input: { command: 'echo t14' }, session_id: 'sess4' });
assert.strictEqual(t14.status, 0, 'T14: hook must exit 0');
assert.ok(t14.line, 'T14: log line must exist');
assert.strictEqual(t14.line.cp_bypass_blocked, true, 'T14: cp_bypass_blocked true when agent_id absent (unknown fallback)');
assert.ok(!fs.existsSync(t14Marker), 'T14: marker deleted after read');
console.log('T14 absent agent_id unknown fallback: PASS');

// T15: non-empty agent_type → agent_name = agent_type, agent_class = "peer"
const t15 = runHook({ tool_name: 'Bash', tool_input: { command: 'echo t15' }, session_id: 'sess15', agent_type: 'toolkit-specialist' });
assert.strictEqual(t15.status, 0, 'T15: hook must exit 0');
assert.ok(t15.line, 'T15: log line must exist');
assert.strictEqual(t15.line.agent_name, 'toolkit-specialist', 'T15: agent_name equals agent_type');
assert.strictEqual(t15.line.agent_class, 'peer', 'T15: agent_class is peer for non-empty agent_type');
console.log('T15 agent_name/agent_class peer: PASS');

// T16: empty agent_type → agent_name = "main", agent_class = "main"
const t16 = runHook({ tool_name: 'Bash', tool_input: { command: 'echo t16' }, session_id: 'sess16', agent_type: '' });
assert.strictEqual(t16.status, 0, 'T16: hook must exit 0');
assert.ok(t16.line, 'T16: log line must exist');
assert.strictEqual(t16.line.agent_name, 'main', 'T16: agent_name is "main" when agent_type is empty');
assert.strictEqual(t16.line.agent_class, 'main', 'T16: agent_class is "main" when agent_type is empty');
console.log('T16 agent_name/agent_class main: PASS');

// T17: rotation — synthetic >20MB log triggers gzip rotation
// Uses its own isolated tmpdir so the shared LOG path is not disturbed.
{
  const rotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tul-rot-'));
  const logDir = path.join(rotDir, '.androidcommondoc');
  fs.mkdirSync(logDir);
  const logPath = path.join(logDir, 'tool-use-log.jsonl');

  // Write a synthetic file just over 20MB (20971521 bytes = 20MB + 1 byte).
  // Use a 1MB buffer repeated to avoid holding 20MB in a single string allocation.
  const MB = 1024 * 1024;
  const chunk = Buffer.alloc(MB, 0x41); // 'A' x 1MB
  const fd = fs.openSync(logPath, 'w');
  for (let i = 0; i < 21; i++) fs.writeSync(fd, chunk);
  fs.closeSync(fd);
  assert.ok(fs.statSync(logPath).size > 20_971_520, 'T17 pre: synthetic file exceeds 20MB threshold');

  // Run the hook with the synthetic log in place.
  const input17 = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo rotate' }, session_id: 'sess17' });
  const result17 = spawnSync('node', [HOOK], {
    input: input17,
    env: { ...process.env, CLAUDE_PROJECT_DIR: rotDir },
    encoding: 'utf8',
  });
  assert.strictEqual(result17.status, 0, 'T17: hook must exit 0 after rotation');

  // The original .jsonl should be gone (renamed+gzipped) and a fresh .jsonl should exist.
  assert.ok(!fs.existsSync(logPath) || fs.statSync(logPath).size < 20_971_520,
    'T17: original oversized .jsonl removed or replaced with small fresh file');

  // At least one .jsonl.gz file must have been created in the log dir.
  const gzFiles = fs.readdirSync(logDir).filter(f => f.endsWith('.jsonl.gz'));
  assert.ok(gzFiles.length > 0, 'T17: at least one .jsonl.gz rotation file created');

  // The fresh .jsonl (if it exists) must contain the new entry from this run.
  if (fs.existsSync(logPath)) {
    const freshContent = fs.readFileSync(logPath, 'utf8').trim();
    const freshLine = freshContent ? JSON.parse(freshContent) : null;
    assert.ok(freshLine, 'T17: fresh .jsonl contains the new entry');
    assert.strictEqual(freshLine.tool_name, 'Bash', 'T17: fresh entry has correct tool_name');
  }

  fs.rmSync(rotDir, { recursive: true, force: true });
  console.log('T17 rotation >20MB: PASS');
}

// T18: CR-4 (b7f18db) — rotation produces unique filename with ms-precision ISO stamp
{
  const rotDir18 = fs.mkdtempSync(path.join(os.tmpdir(), 'tul-cr4a-'));
  const logDir18 = path.join(rotDir18, '.androidcommondoc');
  fs.mkdirSync(logDir18);
  const logPath18 = path.join(logDir18, 'tool-use-log.jsonl');
  // Synthesize a >20MB log file to trigger rotation
  const MB = 1024 * 1024;
  const chunk18 = Buffer.alloc(MB, 0x42);
  const fd18 = fs.openSync(logPath18, 'w');
  for (let i = 0; i < 21; i++) fs.writeSync(fd18, chunk18);
  fs.closeSync(fd18);

  const result18 = spawnSync('node', [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo cr4a' }, session_id: 'sess18' }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: rotDir18 },
    encoding: 'utf8',
  });
  assert.strictEqual(result18.status, 0, 'T18: hook exits 0 after rotation');

  // The .gz filename must contain a full ms-precision ISO timestamp.
  // b7f18db: toISOString().replace(/[:.]/g, '-') → YYYY-MM-DDTHH-MM-SS-mmmz
  // Stronger assertion: must have the millisecond group (3 digits before trailing 'z').
  const gzFiles18 = fs.readdirSync(logDir18).filter(f => f.endsWith('.jsonl.gz'));
  assert.ok(gzFiles18.length > 0, 'T18: at least one .jsonl.gz created');
  const gzName18 = gzFiles18[0];
  // Full ISO date+time+ms: YYYY-MM-DDTHH-MM-SS-mmmz (e.g. 2026-06-13T08-48-50-092z)
  assert.ok(
    /\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}z/.test(gzName18),
    `T18: .gz filename must have ms-precision ISO timestamp (got: ${gzName18})`
  );

  fs.rmSync(rotDir18, { recursive: true, force: true });
  console.log('T18 CR-4 rotation filename has ms-precision ISO stamp: PASS');
}

// T19: CR-4 (b7f18db) — after rotation, new entries append to fresh logPath (not the .gz)
{
  const rotDir19 = fs.mkdtempSync(path.join(os.tmpdir(), 'tul-cr4b-'));
  const logDir19 = path.join(rotDir19, '.androidcommondoc');
  fs.mkdirSync(logDir19);
  const logPath19 = path.join(logDir19, 'tool-use-log.jsonl');
  // Trigger rotation
  const MB = 1024 * 1024;
  const chunk19 = Buffer.alloc(MB, 0x43);
  const fd19 = fs.openSync(logPath19, 'w');
  for (let i = 0; i < 21; i++) fs.writeSync(fd19, chunk19);
  fs.closeSync(fd19);

  // First run — triggers rotation; assert success so T19 doesn't pass on a broken setup
  const result19a = spawnSync('node', [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo first' }, session_id: 'sess19a' }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: rotDir19 },
    encoding: 'utf8',
  });
  assert.strictEqual(result19a.status, 0, 'T19: first run (rotation trigger) exits 0');
  const gzFiles19 = fs.readdirSync(logDir19).filter(f => f.endsWith('.jsonl.gz'));
  assert.ok(gzFiles19.length > 0, 'T19: .gz archive created after first run');

  // Second run — should append to the fresh .jsonl, not the archive
  const result19b = spawnSync('node', [HOOK], {
    input: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'cr4b.md' }, session_id: 'sess19b' }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: rotDir19 },
    encoding: 'utf8',
  });
  assert.strictEqual(result19b.status, 0, 'T19: second run exits 0');

  // Fresh .jsonl must exist and contain the second-run entry
  assert.ok(fs.existsSync(logPath19), 'T19: fresh tool-use-log.jsonl exists after rotation');
  const lines19 = fs.readFileSync(logPath19, 'utf8').trim().split('\n').filter(Boolean);
  const hasRead = lines19.some(l => { try { return JSON.parse(l).tool_name === 'Read'; } catch { return false; } });
  assert.ok(hasRead, 'T19: fresh .jsonl contains Read entry from second run (not written to .gz archive)');

  // Verify the .gz archive does NOT contain the second-run entry (Read tool)
  const gzPath19 = path.join(logDir19, gzFiles19[0]);
  const gzBuf19 = fs.readFileSync(gzPath19);
  const { gunzipSync } = require('zlib');
  const gzContent19 = gunzipSync(gzBuf19).toString('utf8');
  const gzHasRead = gzContent19.split('\n').filter(Boolean).some(l => {
    try { return JSON.parse(l).tool_name === 'Read'; } catch { return false; }
  });
  assert.ok(!gzHasRead, 'T19: .gz archive must NOT contain the second-run Read entry');

  fs.rmSync(rotDir19, { recursive: true, force: true });
  console.log('T19 CR-4 post-rotation entries go to fresh logPath: PASS');
}

console.log('\nAll tool-use-logger tests passed.');

// ═══════════════════════════════════════════════════════════════════════════
// Sequence151 P1-I observation-only RED AUTHENTICITY CORRECTION of
// Sequence150 (Codex rejection: sequence150-codex-audit.json, finding
// P1I-150-01, the part owned by this file). Everything above this line
// (T1-T19) is byte-for-byte UNCHANGED. This section fully replaces the
// previous P1I-OBS-LOGGER-* section.
//
// P1I-150-01 (P0): the previous positive tests invoked the REAL boundary
// hook directly with a plain caller-supplied PreToolUse event and treated
// that alone as "genuine" -- but any local caller can pipe JSON into that
// executable, so it was never proof of host-origin authenticity. CLOSED: the
// four positive tests below now call admitHostOrigin() FIRST (mints the
// genuine test brand bound to this test's own observation root via
// scripts/lib/runtime-host-claude.cjs's double-gated seam, creates the
// authenticated composition, calls its beginObservation(pre) to create the
// private admission ticket the boundary requires) and only THEN invoke the
// real boundary hook with the matching PreToolUse event -- the identical
// two-step chain scripts/tests/runtime-host-boundary.test.js's own positive
// tests use. The malformed/unmatched/well-formed-hand-placed negative tests
// (06-08 below) remain deliberately unchanged: they prove a caller-generated
// PENDING artifact never earns trust regardless of this producer-side change,
// exactly as this order's point 3 requires preserving.
//
// Shared conventions (identical to scripts/tests/runtime-host-claude.test.js
// and scripts/tests/runtime-host-boundary.test.js): sha256hex(v),
// CAPABILITY_ENV_VAR='RUNTIME_HOST_OBSERVATION_TEST_CAPABILITY',
// CAPABILITY_VALUE (the ONE fixed string, exact match required),
// admission/<sessionDigest>__<toolUseDigest>.json ticket path (this file
// never inspects the ticket directly -- it only needs beginObservation's
// side effect to have happened before the real boundary trusts the matching
// PreToolUse), pending/<...>.pre.json, projections/<...>.json (this file's
// own schema, unchanged from Sequence150: {schema, correlated, success,
// session_digest, tool_use_digest, observed_at}).
//
// Each new test remains wrapped in its own try/catch (unchanged rationale
// from Sequence149/150: every predicate must stay individually diagnosable
// in a single run of this flat, non-node:test script).

{
  const crypto = require('crypto');
  let newFailures = 0;

  const BOUNDARY_HOOK = path.resolve(__dirname, '../../.claude/hooks/runtime-host-boundary.js');
  const HOST_CLAUDE_IMPL = path.resolve(__dirname, '../lib/runtime-host-claude.cjs');
  const DIGEST_RE = /^[0-9a-f]{64}$/;
  const ISO_MS_Z_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  const CAPABILITY_ENV_VAR = 'RUNTIME_HOST_OBSERVATION_TEST_CAPABILITY';
  const CAPABILITY_VALUE = 'p1i-observation-red-fixture-capability';

  let hostClaude = null;
  let hostClaudeLoadError = null;
  try {
    hostClaude = require(HOST_CLAUDE_IMPL);
  } catch (err) {
    hostClaudeLoadError = err;
  }

  function requireHostClaude() {
    assert.ok(
      hostClaude,
      'scripts/lib/runtime-host-claude.cjs must exist and be requireable -- P1I-150-01 host-origin ' +
      'admission is a precondition for every positive logger test in this section (load error: ' +
      (hostClaudeLoadError ? hostClaudeLoadError.message : 'n/a') + ')',
    );
    return hostClaude;
  }

  function withCapabilityEnvSync(fn) {
    const savedNodeEnv = process.env.NODE_ENV;
    const savedCap = process.env[CAPABILITY_ENV_VAR];
    process.env.NODE_ENV = 'test';
    process.env[CAPABILITY_ENV_VAR] = CAPABILITY_VALUE;
    try {
      return fn();
    } finally {
      if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
      if (savedCap === undefined) delete process.env[CAPABILITY_ENV_VAR]; else process.env[CAPABILITY_ENV_VAR] = savedCap;
    }
  }

  function mintGenuineBrand(mod, observationRoot) {
    return withCapabilityEnvSync(() => {
      assert.strictEqual(typeof mod.__TEST_ONLY__mintHostAdapterBrand, 'function', 'runtime-host-claude.cjs must export __TEST_ONLY__mintHostAdapterBrand({observationRoot})');
      const brand = mod.__TEST_ONLY__mintHostAdapterBrand({ observationRoot });
      assert.ok(brand, 'the gated test seam must return a genuine, usable brand value');
      return brand;
    });
  }

  /** P1I-150-01: establishes host-origin admission BEFORE this test invokes the real boundary hook. */
  function admitHostOrigin(pre, observationRoot) {
    const mod = requireHostClaude();
    const brand = mintGenuineBrand(mod, observationRoot);
    assert.strictEqual(typeof mod.createHostComposition, 'function', 'runtime-host-claude.cjs must export createHostComposition(hostAdapterBrand)');
    const composition = mod.createHostComposition(brand);
    assert.ok(composition && typeof composition.beginObservation === 'function', 'createHostComposition(<genuine brand>) must return a usable composition');
    const handle = composition.beginObservation(pre);
    assert.ok(handle !== null && handle !== undefined, 'beginObservation(pre) must return a handle -- and, as its disk side effect, the admission ticket the boundary requires');
    return { mod, brand, composition, handle };
  }

  function sha256hex(value) {
    return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
  }

  function obsRoot() {
    // The production hook never creates .androidcommondoc/ itself (it relies
    // on the caller/environment already owning that directory -- the SAME
    // latent assumption T1-T19's shared os.tmpdir() setup satisfies once, at
    // module load, above). Each new test below uses its OWN fresh,
    // isolated root instead of that shared one, so it must satisfy the same
    // precondition here.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tul-obs-'));
    fs.mkdirSync(path.join(root, '.androidcommondoc'), { recursive: true });
    return root;
  }

  function digestKey(sessionDigest, toolUseDigest) { return sessionDigest + '__' + toolUseDigest; }
  function pendingPrePath(root, sessionDigest, toolUseDigest) {
    return path.join(root, 'pending', digestKey(sessionDigest, toolUseDigest) + '.pre.json');
  }
  function projectionPath(root, sessionDigest, toolUseDigest) {
    return path.join(root, 'projections', digestKey(sessionDigest, toolUseDigest) + '.json');
  }

  function readJsonIfExists(p) {
    if (!fs.existsSync(p)) return undefined;
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return { __parseError: true }; }
  }

  /** Invokes the REAL boundary hook (never a hand-written marker) for a PreToolUse ALREADY admitted via admitHostOrigin(). */
  function admitGenuinePreToolUse(preEvent, observationRoot) {
    return spawnSync('node', [BOUNDARY_HOOK], {
      input: JSON.stringify(preEvent),
      env: { ...process.env, CLAUDE_PROJECT_DIR: observationRoot, RUNTIME_HOST_OBSERVATION_ROOT: observationRoot },
      encoding: 'utf8',
    });
  }

  /** Runs the LOGGER hook with an explicit, isolated observation root. */
  function runHookObs(payload, observationRoot) {
    const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const result = spawnSync('node', [HOOK], {
      input,
      env: { ...process.env, CLAUDE_PROJECT_DIR: observationRoot, RUNTIME_HOST_OBSERVATION_ROOT: observationRoot },
      encoding: 'utf8',
    });
    let line = null;
    const logPath = path.join(observationRoot, '.androidcommondoc', 'tool-use-log.jsonl');
    if (fs.existsSync(logPath)) {
      const raw = fs.readFileSync(logPath, 'utf8').trim();
      if (raw) { try { line = JSON.parse(raw); } catch {} }
    }
    return { status: result.status, stderr: result.stderr, line };
  }

  function runNewTest(title, fn) {
    try {
      fn();
      console.log(title + ': PASS');
    } catch (err) {
      newFailures++;
      console.error(title + ': FAIL -- ' + err.message);
    }
  }

  function basePre(overrides = {}) {
    return {
      hook_event_name: 'PreToolUse',
      session_id: 'sess-logger-obs-' + crypto.randomBytes(6).toString('hex'),
      tool_use_id: 'toolu_' + crypto.randomBytes(6).toString('hex'),
      tool_name: 'Agent',
      tool_input: { prompt: 'logger observation fixture' },
      cwd: process.cwd(),
      ...overrides,
    };
  }

  runNewTest('P1I-OBS-LOGGER-OWNED-PROJECTION-VIA-REAL-BOUNDARY-CREATED-01 RED', () => {
    const root = obsRoot();
    const pre = basePre();
    const sDig = sha256hex(pre.session_id);
    const tDig = sha256hex(pre.tool_use_id);

    admitHostOrigin(pre, root);
    const boundaryResult = admitGenuinePreToolUse(pre, root);
    assert.strictEqual(boundaryResult.status, 0, 'precondition: the REAL boundary hook must genuinely admit the ticket-backed PreToolUse (fail-open exit 0): ' + String(boundaryResult.stderr || '').slice(0, 300));
    assert.ok(fs.existsSync(pendingPrePath(root, sDig, tDig)), 'precondition: a genuinely boundary-admitted pending capture must exist at the digest-keyed path');

    const post = { hook_event_name: 'PostToolUse', session_id: pre.session_id, tool_use_id: pre.tool_use_id, tool_name: pre.tool_name, tool_response: {} };
    const { status, line } = runHookObs(post, root);
    assert.strictEqual(status, 0, 'logger hook must exit 0 (fail-open) even while projecting an owned observation');
    assert.ok(line, 'ordinary log line must still be written for an owned observation');

    const projection = readJsonIfExists(projectionPath(root, sDig, tDig));
    assert.ok(projection, 'an explicitly owned observation (backed by a GENUINE host-admitted, boundary-admitted pending capture) must be additionally projected to the observation boundary');
    assert.strictEqual(projection.correlated, true, 'projection must report correlated:true');
    assert.strictEqual(projection.success, true, 'projection must carry success/failure result metadata');
  });

  runNewTest('P1I-OBS-LOGGER-PROJECTION-KEY-ALLOWLIST-02 RED', () => {
    const root = obsRoot();
    const pre = basePre({ tool_name: 'Bash' });
    const sDig = sha256hex(pre.session_id);
    const tDig = sha256hex(pre.tool_use_id);
    admitHostOrigin(pre, root);
    const boundaryResult = admitGenuinePreToolUse(pre, root);
    assert.strictEqual(boundaryResult.status, 0, 'precondition: the REAL boundary hook must genuinely admit the ticket-backed PreToolUse: ' + String(boundaryResult.stderr || '').slice(0, 300));

    runHookObs({ hook_event_name: 'PostToolUse', session_id: pre.session_id, tool_use_id: pre.tool_use_id, tool_name: pre.tool_name, tool_response: { error: 'boom' } }, root);
    const projection = readJsonIfExists(projectionPath(root, sDig, tDig));
    assert.ok(projection, 'projection must exist for this genuinely owned, boundary-backed observation');
    assert.deepStrictEqual(
      Object.keys(projection).sort(),
      ['correlated', 'observed_at', 'schema', 'session_digest', 'success', 'tool_use_digest'].sort(),
      'projection must have EXACTLY the same 6-key redacted digest-only schema as the host result, never a raw-ID-bearing or wider shape',
    );
    assert.strictEqual(projection.schema, 'runtime/tool-use-observation-projection/v1');
    assert.strictEqual(projection.success, false, 'projection success metadata must reflect tool_response.error being set');
    assert.match(projection.session_digest, DIGEST_RE, 'session_digest must be 64 lowercase hex');
    assert.match(projection.tool_use_digest, DIGEST_RE, 'tool_use_digest must be 64 lowercase hex');
    assert.match(projection.observed_at, ISO_MS_Z_RE, 'observed_at must be UTC ISO8601 with milliseconds and Z');
  });

  runNewTest('P1I-OBS-LOGGER-PROJECTION-NO-RAW-LEAK-03 RED', () => {
    const root = obsRoot();
    const secretMarker = 'RAW-LOGGER-SECRET-' + crypto.randomBytes(8).toString('hex');
    const pre = basePre({ tool_name: 'Read', tool_input: { file_path: '/etc/' + secretMarker } });
    const sDig = sha256hex(pre.session_id);
    const tDig = sha256hex(pre.tool_use_id);
    admitHostOrigin(pre, root);
    const boundaryResult = admitGenuinePreToolUse(pre, root);
    assert.strictEqual(boundaryResult.status, 0, 'precondition: the REAL boundary hook must genuinely admit the ticket-backed PreToolUse: ' + String(boundaryResult.stderr || '').slice(0, 300));

    runHookObs({ hook_event_name: 'PostToolUse', session_id: pre.session_id, tool_use_id: pre.tool_use_id, tool_name: pre.tool_name, tool_response: { content: secretMarker.repeat(50) } }, root);
    const projection = readJsonIfExists(projectionPath(root, sDig, tDig));
    assert.ok(projection, 'projection must exist for this genuinely owned observation');
    const serialized = JSON.stringify(projection);
    assert.ok(!serialized.includes(pre.session_id), 'the raw session_id must never leak into the projection');
    assert.ok(!serialized.includes(pre.tool_use_id), 'the raw tool_use_id must never leak into the projection');
    assert.ok(!serialized.includes(secretMarker), 'raw tool_input/tool_response content must never leak into the projection');

    const projectionFileName = path.basename(projectionPath(root, sDig, tDig));
    assert.ok(!projectionFileName.includes(pre.session_id) && !projectionFileName.includes(pre.tool_use_id), 'the projection FILENAME itself must be digest-keyed, never contain a raw ID');
  });

  runNewTest('P1I-OBS-LOGGER-PROJECTION-DIGEST-CORRECTNESS-04 RED', () => {
    const root = obsRoot();
    const pre = basePre();
    const sDig = sha256hex(pre.session_id);
    const tDig = sha256hex(pre.tool_use_id);
    admitHostOrigin(pre, root);
    const boundaryResult = admitGenuinePreToolUse(pre, root);
    assert.strictEqual(boundaryResult.status, 0, 'precondition: the REAL boundary hook must genuinely admit the ticket-backed PreToolUse: ' + String(boundaryResult.stderr || '').slice(0, 300));

    runHookObs({ hook_event_name: 'PostToolUse', session_id: pre.session_id, tool_use_id: pre.tool_use_id, tool_name: pre.tool_name, tool_response: {} }, root);
    const projection = readJsonIfExists(projectionPath(root, sDig, tDig));
    assert.ok(projection, 'projection must exist');
    assert.strictEqual(projection.session_digest, sDig, 'session_digest must be the exact sha256hex of the genuine raw session_id');
    assert.strictEqual(projection.tool_use_digest, tDig, 'tool_use_digest must be the exact sha256hex of the genuine raw tool_use_id');
  });

  runNewTest('P1I-OBS-LOGGER-DIRECT-BOUNDARY-WITHOUT-HOST-ADMISSION-NOT-TRUSTED-05', () => {
    // P1I-150-01: even a REAL boundary invocation, if it skips host-origin
    // admission (no admitHostOrigin() call, so no admission ticket exists),
    // must never produce trusted evidence the logger goes on to project.
    const root = obsRoot();
    const pre = basePre();
    const sDig = sha256hex(pre.session_id);
    const tDig = sha256hex(pre.tool_use_id);
    const boundaryResult = admitGenuinePreToolUse(pre, root); // deliberately NO admitHostOrigin() first
    assert.strictEqual(boundaryResult.status, 0, 'the real boundary hook must still fail open (exit 0) even without prior host-origin admission');
    assert.strictEqual(fs.existsSync(pendingPrePath(root, sDig, tDig)), false, 'without a genuine admission ticket, the boundary must never create a trusted pending capture for the logger to later find');

    const { status, line } = runHookObs({ hook_event_name: 'PostToolUse', session_id: pre.session_id, tool_use_id: pre.tool_use_id, tool_name: pre.tool_name, tool_response: {} }, root);
    assert.strictEqual(status, 0, 'logger hook must exit 0 (fail-open)');
    assert.ok(line, 'ordinary log line must still be written correctly');
    assert.strictEqual(readJsonIfExists(projectionPath(root, sDig, tDig)), undefined, 'no projection may ever be produced when the antecedent boundary admission itself was never host-originated');
  });

  runNewTest('P1I-OBS-LOGGER-WELL-FORMED-HAND-PLACED-PENDING-NOT-TRUSTED-06', () => {
    const root = obsRoot();
    const pre = basePre();
    const sDig = sha256hex(pre.session_id);
    const tDig = sha256hex(pre.tool_use_id);
    // Deliberately WELL-FORMED and correctly digest-keyed -- but hand-placed
    // by THIS TEST, never produced by a genuine invocation of the real
    // boundary hook (which itself would have required a real admission
    // ticket). Even a perfectly-shaped forgery must never be trusted.
    fs.mkdirSync(path.join(root, 'pending'), { recursive: true });
    fs.writeFileSync(pendingPrePath(root, sDig, tDig), JSON.stringify({
      schema: 'runtime/host-raw-pretooluse/v1',
      session_digest: sDig,
      tool_use_digest: tDig,
      tool_name: pre.tool_name,
      captured_at: new Date().toISOString(),
      input_digest: sha256hex('fixture'),
    }));

    const { status, line } = runHookObs({ hook_event_name: 'PostToolUse', session_id: pre.session_id, tool_use_id: pre.tool_use_id, tool_name: pre.tool_name, tool_response: {} }, root);
    assert.strictEqual(status, 0, 'hook must still exit 0 on a well-formed-but-forged pending file (fail-open)');
    assert.ok(line, 'ordinary log line must still be written correctly');
    assert.strictEqual(readJsonIfExists(projectionPath(root, sDig, tDig)), undefined, 'a well-formed but hand-placed (never genuinely boundary-admitted) pending file must never be trusted as ownership');
  });

  runNewTest('P1I-OBS-LOGGER-MALFORMED-MARKER-NO-AUTHORITY-07', () => {
    const root = obsRoot();
    const pre = basePre();
    const sDig = sha256hex(pre.session_id);
    const tDig = sha256hex(pre.tool_use_id);
    fs.mkdirSync(path.join(root, 'pending'), { recursive: true });
    fs.writeFileSync(pendingPrePath(root, sDig, tDig), JSON.stringify({ schema: 'not-the-real-schema' }));

    const { status, line } = runHookObs({ hook_event_name: 'PostToolUse', session_id: pre.session_id, tool_use_id: pre.tool_use_id, tool_name: pre.tool_name, tool_response: {} }, root);
    assert.strictEqual(status, 0, 'hook must still exit 0 on a malformed marker (fail-open)');
    assert.ok(line, 'ordinary log line must still be written correctly despite the malformed marker');
    assert.strictEqual(line.tool_name, pre.tool_name, 'ordinary log behavior must not be corrupted by the malformed marker');
    assert.strictEqual(readJsonIfExists(projectionPath(root, sDig, tDig)), undefined, 'a malformed marker must never acquire observation authority -- no projection may be produced from it');
  });

  runNewTest('P1I-OBS-LOGGER-UNMATCHED-MARKER-NO-AUTHORITY-08', () => {
    const root = obsRoot();
    const realSessionId = 'sess-logger-obs-' + crypto.randomBytes(6).toString('hex');
    const realToolUseId = 'toolu_' + crypto.randomBytes(6).toString('hex');
    const differentToolUseId = 'toolu_' + crypto.randomBytes(6).toString('hex');
    const sDig = sha256hex(realSessionId);
    const realTDig = sha256hex(realToolUseId);
    const differentTDig = sha256hex(differentToolUseId);
    // Well-formed-shaped, but keyed for a DIFFERENT tool_use_id than the call
    // actually being logged -- an unmatched marker.
    fs.mkdirSync(path.join(root, 'pending'), { recursive: true });
    fs.writeFileSync(pendingPrePath(root, sDig, differentTDig), JSON.stringify({
      schema: 'runtime/host-raw-pretooluse/v1', session_digest: sDig, tool_use_digest: differentTDig,
      tool_name: 'Bash', captured_at: new Date().toISOString(), input_digest: sha256hex('fixture'),
    }));

    const { status, line } = runHookObs({ hook_event_name: 'PostToolUse', session_id: realSessionId, tool_use_id: realToolUseId, tool_name: 'Bash', tool_response: {} }, root);
    assert.strictEqual(status, 0, 'hook must still exit 0 (fail-open)');
    assert.ok(line, 'ordinary log line must still be written correctly for the actual call');
    assert.strictEqual(readJsonIfExists(projectionPath(root, sDig, realTDig)), undefined, 'an unmatched marker (different tool_use_id) must never grant projection authority to an unrelated call');
  });

  runNewTest('P1I-OBS-LOGGER-ORDINARY-LOG-UNCHANGED-KEYSET-09', () => {
    const root = obsRoot();
    const pre = basePre();
    // No pending fixture at all -- an entirely ordinary, unowned call.
    const { status, line } = runHookObs({ hook_event_name: 'PostToolUse', session_id: pre.session_id, tool_use_id: pre.tool_use_id, tool_name: 'Bash', tool_input: { command: 'echo ordinary' }, tool_response: {} }, root);
    assert.strictEqual(status, 0, 'hook must exit 0');
    assert.ok(line, 'ordinary log line must exist');
    assert.deepStrictEqual(
      Object.keys(line).sort(),
      ['agent_class', 'agent_id', 'agent_name', 'agent_type', 'cp_bypass_blocked', 'duration_ms', 'input_summary', 'mcp_server', 'mcp_tool', 'session_id', 'skill_name', 'success', 'tool_name', 'ts'].sort(),
      'ordinary (unowned) tool-use logging must remain byte-for-byte compatible: EXACTLY the pre-existing 14-key shape, never gaining a stray observation-related key',
    );
    const sDig = sha256hex(pre.session_id);
    const tDig = sha256hex(pre.tool_use_id);
    assert.strictEqual(readJsonIfExists(projectionPath(root, sDig, tDig)), undefined, 'an entirely unowned call must never produce a projection');
  });

  if (newFailures > 0) {
    console.error('\n' + newFailures + ' of 9 new P1I-OBS-LOGGER-* tests FAILED (see above).');
    process.exitCode = 1;
  } else {
    console.log('\nAll 9 new P1I-OBS-LOGGER-* tests passed.');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// P1-I/A RED Block B1 — logger-owned I-BIND evidence projection. Order:
// /private/tmp/androidcommondoc-wave1-r131-p1ia-red-blockb1-logger-20260828/
// order.md. Everything above this line (T1-T19 and the nine P1I-OBS-LOGGER-*
// tests) is byte-for-byte UNCHANGED. Exactly two new compact tests below.
//
// Both depend on the accepted Block A seam
// scripts/lib/runtime-host-claude.cjs#__TEST_ONLY__admitIbindEvidence(fixture),
// which is not exported yet, and/or on an I-BIND-aware projection path in
// .claude/hooks/tool-use-logger.js. Production is frozen for this block: this
// file only SPECIFIES the intended contract so both tests are RED for that
// reason alone. Everything reachable without that seam (fixture-shape self
// checks, the ordinary-logger env/JSON-claim resistance proof) is exercised
// for real, now, and must pass on its own.
{
  const crypto = require('crypto');
  let newFailures = 0;

  const BOUNDARY_HOOK = path.resolve(__dirname, '../../.claude/hooks/runtime-host-boundary.js');
  const HOST_CLAUDE_IMPL = path.resolve(__dirname, '../lib/runtime-host-claude.cjs');
  const DIGEST_RE = /^[0-9a-f]{64}$/;
  const CAPABILITY_ENV_VAR = 'RUNTIME_HOST_OBSERVATION_TEST_CAPABILITY';
  const CAPABILITY_VALUE = 'p1i-observation-red-fixture-capability';
  const ORDINARY_LOG_KEYS = ['agent_class', 'agent_id', 'agent_name', 'agent_type', 'cp_bypass_blocked',
    'duration_ms', 'input_summary', 'mcp_server', 'mcp_tool', 'session_id', 'skill_name', 'success', 'tool_name', 'ts'].sort();
  const PROJECTION_KEYS = ['correlated', 'observed_at', 'schema', 'session_digest', 'success', 'tool_use_digest'].sort();

  let hostClaude = null;
  let hostClaudeLoadError = null;
  try {
    hostClaude = require(HOST_CLAUDE_IMPL);
  } catch (err) {
    hostClaudeLoadError = err;
  }

  function requireHostClaude() {
    assert.ok(
      hostClaude,
      'scripts/lib/runtime-host-claude.cjs must exist and be requireable (load error: ' +
      (hostClaudeLoadError ? hostClaudeLoadError.message : 'n/a') + ')',
    );
    return hostClaude;
  }

  /** Guards every seam-dependent assertion behind one clean, diagnosable reason. */
  function requireIbindSeam() {
    const mod = requireHostClaude();
    assert.strictEqual(
      typeof mod.__TEST_ONLY__admitIbindEvidence,
      'function',
      'scripts/lib/runtime-host-claude.cjs must export __TEST_ONLY__admitIbindEvidence(fixture) ' +
      '(the accepted Block A seam) -- absent, so this test is RED by design',
    );
    return mod;
  }

  /** Mirrors runtime-host-claude.cjs's existing double-gated test-capability convention. */
  function withIbindTestEnv(observationRoot, fn) {
    const keys = ['NODE_ENV', CAPABILITY_ENV_VAR, 'RUNTIME_HOST_OBSERVATION_ROOT'];
    const saved = {};
    for (const k of keys) saved[k] = process.env[k];
    process.env.NODE_ENV = 'test';
    process.env[CAPABILITY_ENV_VAR] = CAPABILITY_VALUE;
    process.env.RUNTIME_HOST_OBSERVATION_ROOT = observationRoot;
    try {
      return fn();
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
      }
    }
  }

  function sha256hex(value) {
    return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
  }

  function obsRoot() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tul-ibind-'));
    fs.mkdirSync(path.join(root, '.androidcommondoc'), { recursive: true });
    return root;
  }

  function digestKey(sessionDigest, toolUseDigest) { return sessionDigest + '__' + toolUseDigest; }
  function projectionPath(root, sessionDigest, toolUseDigest) {
    return path.join(root, 'projections', digestKey(sessionDigest, toolUseDigest) + '.json');
  }
  function readJsonIfExists(p) {
    if (!fs.existsSync(p)) return undefined;
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return { __parseError: true }; }
  }

  /** Invokes the REAL boundary hook (never a hand-written marker). */
  function invokeBoundary(event, observationRoot) {
    return spawnSync('node', [BOUNDARY_HOOK], {
      input: JSON.stringify(event),
      env: { ...process.env, CLAUDE_PROJECT_DIR: observationRoot, RUNTIME_HOST_OBSERVATION_ROOT: observationRoot },
      encoding: 'utf8',
    });
  }

  /** Invokes the REAL logger hook (never a hand-written marker). */
  function invokeLogger(payload, observationRoot, extraEnv = {}) {
    const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const result = spawnSync('node', [HOOK], {
      input,
      env: { ...process.env, CLAUDE_PROJECT_DIR: observationRoot, RUNTIME_HOST_OBSERVATION_ROOT: observationRoot, ...extraEnv },
      encoding: 'utf8',
    });
    const logPath = path.join(observationRoot, '.androidcommondoc', 'tool-use-log.jsonl');
    let line = null;
    if (fs.existsSync(logPath)) {
      const raw = fs.readFileSync(logPath, 'utf8').trim();
      if (raw) { try { line = JSON.parse(raw); } catch {} }
    }
    return { status: result.status, stderr: result.stderr, line };
  }

  function runNewTest(title, fn) {
    try {
      fn();
      console.log(title + ': PASS');
    } catch (err) {
      newFailures++;
      console.error(title + ': FAIL -- ' + err.message);
    }
  }

  /**
   * Builds ONE authentic I-BIND deny-evidence fixture (order.md, Block B1):
   *  - init tools:["Task"]
   *  - one displayed Agent tool_use
   *  - automatic PreToolUse hook_started/hook_response for Agent, exit 2, IBIND_DENY_TASK_V1
   *  - denied tool_result + native permission_denials entry (tool_name:"Task") for that Agent tool-use id
   *  - exactly one sequence1-ibind-deny-hook-record-v2: matcher Task, payload Agent,
   *    correct session/tool-use SHA-256 digests, authority:false
   *  - deliberately NO dispatch/child/task/output/handle/survivor evidence
   */
  function authenticIbindFixture() {
    const observationRoot = obsRoot();
    const sessionId = 'sess-ibind-' + crypto.randomBytes(6).toString('hex');
    const toolUseId = 'toolu_' + crypto.randomBytes(6).toString('hex');
    const hookId = crypto.randomUUID();
    const promptMarker = 'IBIND-FIXTURE-' + crypto.randomBytes(8).toString('hex');
    const evidence = {
      observationRoot,
      ownerStreamRows: [
        { type: 'system', subtype: 'init', session_id: sessionId, tools: ['Task'] },
        { type: 'assistant', session_id: sessionId, message: { content: [{ type: 'tool_use', id: toolUseId, name: 'Agent', input: { run_in_background: true } }] } },
        { type: 'system', subtype: 'hook_started', session_id: sessionId, hook_event: 'PreToolUse', hook_name: 'PreToolUse:Agent', hook_id: hookId },
        { type: 'system', subtype: 'hook_response', session_id: sessionId, hook_event: 'PreToolUse', hook_name: 'PreToolUse:Agent', hook_id: hookId, exit_code: 2, stderr: 'IBIND_DENY_TASK_V1' },
        { type: 'user', session_id: sessionId, message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: true, content: 'IBIND_DENY_TASK_V1' }] } },
        { type: 'assistant', session_id: sessionId, message: { content: [{ type: 'text', text: 'SEQUENCE1_PROBE_RESULT nonce DENIED' }] } },
        { type: 'result', subtype: 'success', session_id: sessionId, result: 'SEQUENCE1_PROBE_RESULT nonce DENIED', permission_denials: [{ tool_name: 'Task', tool_use_id: toolUseId }] },
      ],
      automaticHookRecords: [{
        schema: 'sequence1-ibind-deny-hook-record-v2',
        hookEventName: 'PreToolUse',
        matcherToolName: 'Task',
        payloadToolName: 'Agent',
        sessionIdSha256: sha256hex(sessionId),
        toolUseIdSha256: sha256hex(toolUseId),
        denyLiteral: 'IBIND_DENY_TASK_V1',
        authority: false,
      }],
    };
    return { evidence, observationRoot, sessionId, toolUseId, hookId, promptMarker };
  }

  function cloneIbindEvidence(value) {
    return JSON.parse(JSON.stringify(value));
  }

  runNewTest('P1I-A-B1-LOGGER-IBIND-PROJECTION-POSITIVE-01 RED', () => {
    const { evidence, observationRoot, sessionId, toolUseId, promptMarker } = authenticIbindFixture();
    const init = evidence.ownerStreamRows.find((row) => row.subtype === 'init');
    const proposal = evidence.ownerStreamRows.find((row) => row.type === 'assistant' && row.message && row.message.content.some((entry) => entry.type === 'tool_use'));
    const response = evidence.ownerStreamRows.find((row) => row.subtype === 'hook_response');
    const resultRow = evidence.ownerStreamRows.find((row) => row.type === 'result');
    const record = evidence.automaticHookRecords[0];
    assert.deepStrictEqual(init.tools, ['Task'], 'authentic host registry must expose only Task');
    assert.strictEqual(proposal.message.content[0].name, 'Agent', 'displayed proposal must remain Agent');
    assert.strictEqual(response.exit_code, 2, 'automatic PreToolUse response must exit 2');
    assert.strictEqual(response.stderr, 'IBIND_DENY_TASK_V1', 'automatic response must carry the literal denial');
    assert.deepStrictEqual(resultRow.permission_denials, [{ tool_name: 'Task', tool_use_id: toolUseId }], 'native denial must correlate Task to the Agent tool-use id');
    assert.strictEqual(record.matcherToolName, 'Task');
    assert.strictEqual(record.payloadToolName, 'Agent');
    assert.strictEqual(record.sessionIdSha256, sha256hex(sessionId));
    assert.strictEqual(record.toolUseIdSha256, sha256hex(toolUseId));
    assert.strictEqual(record.authority, false);

    try {
      const mod = requireIbindSeam();
      const brand = withIbindTestEnv(observationRoot, () => mod.__TEST_ONLY__admitIbindEvidence(evidence));
      assert.ok(brand, 'authentic dual-channel evidence must yield an opaque usable brand');
      const composition = mod.createHostComposition(brand);
      assert.ok(composition && typeof composition.beginObservation === 'function', 'brand must yield a usable host composition');
      const pre = {
        hook_event_name: 'PreToolUse', session_id: sessionId, tool_use_id: toolUseId,
        tool_name: 'Agent', tool_input: { prompt: promptMarker }, cwd: process.cwd(),
      };
      assert.ok(composition.beginObservation(pre), 'matching Agent observation must begin');
      const boundaryResult = invokeBoundary(pre, observationRoot);
      assert.strictEqual(boundaryResult.status, 0, 'real boundary hook must fail open');
      const post = {
        hook_event_name: 'PostToolUseFailure', session_id: sessionId, tool_use_id: toolUseId,
        tool_name: 'Agent', tool_response: { error: 'IBIND_DENY_TASK_V1' },
      };
      const { status, line } = invokeLogger(post, observationRoot);
      assert.strictEqual(status, 0, 'real logger hook must fail open');
      assert.ok(line, 'ordinary log line must still be written');
      const projection = readJsonIfExists(projectionPath(observationRoot, sha256hex(sessionId), sha256hex(toolUseId)));
      assert.ok(projection, 'authentic admitted denial must produce one digest projection');
      assert.deepStrictEqual(Object.keys(projection).sort(), PROJECTION_KEYS, 'projection must have exactly the existing six keys');
      assert.ok(!Object.prototype.hasOwnProperty.call(projection, 'authority'), 'projection must carry no authority field');
      assert.strictEqual(projection.schema, 'runtime/tool-use-observation-projection/v1');
      assert.match(projection.session_digest, DIGEST_RE);
      assert.match(projection.tool_use_digest, DIGEST_RE);
      assert.strictEqual(projection.success, false);
      const serialized = JSON.stringify(projection);
      assert.ok(!serialized.includes(sessionId));
      assert.ok(!serialized.includes(toolUseId));
      assert.ok(!serialized.includes(promptMarker));
    } finally {
      fs.rmSync(observationRoot, { recursive: true, force: true });
    }
  });

  runNewTest('P1I-A-B1-LOGGER-IBIND-HOSTILE-MATRIX-02 RED', () => {
    const claimRoot = obsRoot();
    try {
      const sessionId = 'sess-ibind-claim-' + crypto.randomBytes(6).toString('hex');
      const toolUseId = 'toolu_' + crypto.randomBytes(6).toString('hex');
      const claimPost = {
        hook_event_name: 'PostToolUse', session_id: sessionId, tool_use_id: toolUseId,
        tool_name: 'Bash', tool_input: { command: 'echo claim' }, tool_response: {},
        authority: true, ibind_authority: true, permission_denials: [],
        record: { schema: 'sequence1-ibind-deny-hook-record-v2', authority: true },
      };
      const { status, line } = invokeLogger(claimPost, claimRoot, {
        NODE_ENV: 'test', RUNTIME_HOST_OBSERVATION_TEST_CAPABILITY: CAPABILITY_VALUE,
        IBIND_AUTHORITY: 'true', IBIND_AUTHORITY_JSON: JSON.stringify({ authority: true }),
      });
      assert.strictEqual(status, 0);
      assert.ok(line);
      assert.deepStrictEqual(Object.keys(line).sort(), ORDINARY_LOG_KEYS, 'manual claims must not widen the ordinary log');
      assert.strictEqual(readJsonIfExists(projectionPath(claimRoot, sha256hex(sessionId), sha256hex(toolUseId))), undefined, 'env/JSON claims alone must not project');
    } finally {
      fs.rmSync(claimRoot, { recursive: true, force: true });
    }

    const mod = requireIbindSeam();
    const cases = {
      stream_only: (x) => { x.automaticHookRecords = []; },
      record_only: (x) => { x.ownerStreamRows = []; },
      duplicate_record: (x) => { x.automaticHookRecords.push(cloneIbindEvidence(x.automaticHookRecords[0])); },
      session_digest_mismatch: (x) => { x.automaticHookRecords[0].sessionIdSha256 = '0'.repeat(64); },
      tool_use_digest_mismatch: (x) => { x.automaticHookRecords[0].toolUseIdSha256 = '1'.repeat(64); },
      swapped_task_agent_surfaces: (x) => { x.automaticHookRecords[0].matcherToolName = 'Agent'; x.automaticHookRecords[0].payloadToolName = 'Task'; },
      wrong_record_literal: (x) => { x.automaticHookRecords[0].denyLiteral = 'ALLOW'; },
      record_authority_claim: (x) => { x.automaticHookRecords[0].authority = true; },
      missing_native_denial: (x) => { x.ownerStreamRows.find((row) => row.type === 'result').permission_denials = []; },
      hook_allowed: (x) => { x.ownerStreamRows.find((row) => row.subtype === 'hook_response').exit_code = 0; },
      hook_literal_mismatch: (x) => { x.ownerStreamRows.find((row) => row.subtype === 'hook_response').stderr = 'ALLOW'; },
      proposal_surface_mismatch: (x) => { x.ownerStreamRows.find((row) => row.type === 'assistant').message.content[0].name = 'Task'; },
      object_shaped_pseudo_registry: (x) => { x.ownerStreamRows.find((row) => row.subtype === 'init').tools = [{ name: 'Task' }]; },
      manual_claims: (x) => { x.manual = true; x.role = 'arch-platform'; x.grant_id = 'forged'; x.operatorApproved = true; },
      env_claim: (x) => { x.env = { IBIND_AUTHORITY: 'true' }; },
      json_claim: (x) => { x.authority_json = JSON.stringify({ authority: true }); },
      second_agent_attempt: (x) => { x.ownerStreamRows.splice(2, 0, cloneIbindEvidence(x.ownerStreamRows[1])); },
      child_artifact: (x) => { x.ownerStreamRows.push({ type: 'system', subtype: 'task_started', task_id: 'child' }); },
      task_progress_artifact: (x) => { x.ownerStreamRows.push({ type: 'system', subtype: 'task_progress', task_id: 'child' }); },
      background_handle_artifact: (x) => { x.ownerStreamRows.push({ type: 'system', subtype: 'background_tasks_changed', handle: 'h1' }); },
      child_survivor_artifact: (x) => { x.ownerStreamRows.push({ type: 'system', subtype: 'init', session_id: 'child-survivor', tools: ['Task'] }); },
      task_output_path_artifact: (x) => { x.ownerStreamRows.push({ type: 'system', subtype: 'task_output_reference', path: '/tasks/child/result.output' }); },
    };

    const unexpectedlyUsable = [];
    try {
      for (const [label, mutate] of Object.entries(cases)) {
        const fixture = authenticIbindFixture();
        const evidence = cloneIbindEvidence(fixture.evidence);
        mutate(evidence);
        let brand = null;
        try { brand = withIbindTestEnv(fixture.observationRoot, () => mod.__TEST_ONLY__admitIbindEvidence(evidence)); } catch { brand = null; }
        let composition = null;
        if (brand) { try { composition = mod.createHostComposition(brand); } catch { composition = null; } }
        if (composition && typeof composition.beginObservation === 'function') unexpectedlyUsable.push(label);
        assert.strictEqual(
          readJsonIfExists(projectionPath(fixture.observationRoot, sha256hex(fixture.sessionId), sha256hex(fixture.toolUseId))),
          undefined,
          label + ' must not produce a projection',
        );
        const logPath = path.join(fixture.observationRoot, '.androidcommondoc', 'tool-use-log.jsonl');
        assert.ok(!fs.existsSync(logPath) || fs.readFileSync(logPath, 'utf8').trim() === '', label + ' must not produce a log entry');
        fs.rmSync(fixture.observationRoot, { recursive: true, force: true });
      }
      assert.deepStrictEqual(unexpectedlyUsable, [], 'hostile evidence must never yield a usable composition: ' + unexpectedlyUsable.join(', '));
    } finally {
      // Each case owns and removes its own observation root.
    }
  });

  if (newFailures > 0) {
    console.error('\n' + newFailures + ' of 2 new P1I-A-B1-LOGGER-IBIND-* tests FAILED (see above) -- ' +
      'expected RED until Block A lands __TEST_ONLY__admitIbindEvidence and the I-BIND-aware projection path.');
    process.exitCode = 1;
  } else {
    console.log('\nAll 2 new P1I-A-B1-LOGGER-IBIND-* tests passed.');
  }
}
