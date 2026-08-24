#!/usr/bin/env node
'use strict';

// context-provider-write-gate.test.js — PreToolUse/Bash hook tests for
// .claude/hooks/context-provider-write-gate.js.
//
// REWRITTEN per .planning/wave-portable-runtime-messaging-adapters/
// m7-correction-spec.md §3 (M7 Correction pass). Two empirical findings
// this rewrite is built on (recorded here so the fixture shapes below are
// traceable, not guessed):
//
//   1. The REAL write-bundle.sh call-site shape (scripts/sh/write-bundle.sh's
//      own usage comment, and every real caller: .claude/agents/
//      context-provider.md, setup/agent-templates/context-provider.md) is a
//      HEREDOC:
//        bash scripts/sh/write-bundle.sh --role <role> --plan-id "<plan_id>" <<'BODY'
//        ...body...
//        BODY
//      This is NOT parsePosixDirect's closed single-quoted-argv grammar
//      (that grammar was built for HOOK-CONSTRUCTED commands, e.g. the
//      lifecycle-CLI family -- never for this human/model-typed heredoc
//      convenience script). Empirically verified directly against the real
//      runtime-role-lifecycle.cjs export: parsePosixDirect(command) returns
//      null on (a) the full heredoc string, AND (b) the argv PREFIX ALONE in
//      its real, natural shell form (unquoted `bash`, unquoted script path,
//      unquoted --role value, double-quoted --plan-id value) -- neither the
//      full command nor a naturally-typed prefix ever satisfies the
//      single-quoted-per-token grammar. So this suite pins the OBSERVABLE
//      CONTRACT (input command text -> allow/block decision, with a complete
//      unmodified updatedInput on allow) rather than asserting on WHICH
//      internal tokenizer the implementation uses for the argv prefix --
//      that is an implementation-strategy detail, not part of this hook's
//      external behavior.
//   2. The PRIOR version of this file represented "a write-bundle.sh
//      invocation" as `printf '%s\n' '## body' | bash "<path>" --role ... `
//      -- a PIPE, not a heredoc. Per this hook's own required behavior
//      ("reject ... any chaining operator (&&, ;, |, `, $() anywhere in the
//      command"), a `|` pipe IS itself a chaining operator and must now be
//      REJECTED, not treated as the sanctioned positive-control shape. Every
//      "allowed" fixture below therefore uses the REAL heredoc form.
//
// stdin JSON in, official hookSpecificOutput PreToolUse decision out (deny:
// permissionDecision:'deny'+permissionDecisionReason, exit 0; allow:
// permissionDecision:'allow', exit 0), fail-open (exit 0) on any internal/
// parse error. This hook only ever RECEIVES tool_input.command as a string to analyze --
// it never executes it (tests that need an end-to-end/zero-write proof
// simulate the real PreToolUse enforcement loop themselves, only actually
// running the underlying command when the gate's own decision was allow).
//
// Invocation: node scripts/tests/context-provider-write-gate.test.js

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const HOOK = path.resolve(__dirname, '../../.claude/hooks/context-provider-write-gate.js');
const WRITE_BUNDLE_SH = path.resolve(__dirname, '../sh/write-bundle.sh');

function runHook(payload, env = {}) {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const result = spawnSync('node', [HOOK], {
    input,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { exit: result.status, stdout: result.stdout, stderr: result.stderr };
}

function parseHookJSON(stdout, label) {
  if (!stdout || stdout.trim().length === 0) {
    assert.fail(label + ': hook produced no stdout -- expected a JSON hookSpecificOutput payload: ' + JSON.stringify(stdout));
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
// deprecated top-level decision:'block' + exit 2 shape.
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

function makeTempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-write-gate-proj-'));
  const opts = { cwd: dir, encoding: 'utf8' };
  spawnSync('git', ['init', '-q'], opts);
  spawnSync('git', ['config', 'user.email', 'bats@test.local'], opts);
  spawnSync('git', ['config', 'user.name', 'Bats Test'], opts);
  spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], opts);
  return dir;
}

function bundlePath(projDir, slug, role) {
  return path.join(projDir, '.planning', `wave-${slug}`, 'context-bundles', `${role}.md`);
}

// Builds the REAL write-bundle.sh call-site shape (a heredoc, matching
// scripts/sh/write-bundle.sh's own usage comment exactly): --role unquoted,
// --plan-id double-quoted, --slug (optional) unquoted, followed by
// `<<'BODY'\n...\nBODY`.
function writeBundleHeredocCommand(role, planId, slug, body) {
  const slugFlag = slug ? ` --slug ${slug}` : '';
  const bodyText = body !== undefined ? body : '## body\n- fixture line';
  return `bash "${WRITE_BUNDLE_SH}" --role ${role} --plan-id "${planId}"${slugFlag} <<'BODY'\n${bodyText}\nBODY`;
}

function runFor(cmd, sessionId, projDir, extraToolInput) {
  return runHook({
    tool_name: 'Bash',
    tool_input: Object.assign({ command: cmd }, extraToolInput || {}),
    session_id: sessionId,
    agent_type: 'test-specialist',
    agent_id: 'test-specialist',
  }, { CLAUDE_PROJECT_DIR: projDir });
}

// WG-ALLOW: a real, well-formed heredoc invocation (the ACTUAL call-site
// shape) is allowed end-to-end -- both (a) the hook's own decision carries
// permissionDecision:'allow' + a COMPLETE, byte-identical updatedInput (this
// gate never rewrites the command, per spec §3's own "owning allow" clause
// -- TODAY the hook emits nothing at all on allow, a bare exit 0 with zero
// stdout, which IS the RED for this half), and (b) actually running the
// underlying real command (only because the gate said allow) genuinely
// produces the bundle file on disk via the real write-bundle.sh script.
{
  const proj = makeTempProject();
  try {
    const cmd = writeBundleHeredocCommand('test-specialist', 'wave-wg-test/PLAN.md#T1', 'wg-test');
    const r = runFor(cmd, 'wg-allow', proj, { description: 'wg-allow fixture description' });
    assert.strictEqual(r.exit, 0, 'WG-ALLOW: a well-formed, real-shape write-bundle.sh invocation must be allowed: ' + JSON.stringify(r));
    const body = parseHookJSON(r.stdout, 'WG-ALLOW');
    assert.ok(body.hookSpecificOutput, 'WG-ALLOW: an owning-allow decision must carry hookSpecificOutput (PLAN.md ~L600) -- TODAY this hook emits nothing at all on allow: ' + JSON.stringify(body));
    assert.strictEqual(body.hookSpecificOutput.permissionDecision, 'allow', 'WG-ALLOW: permissionDecision must be "allow": ' + JSON.stringify(body));
    assert.strictEqual(body.hookSpecificOutput.updatedInput.command, cmd, 'WG-ALLOW: this gate never rewrites the command -- updatedInput.command must be byte-identical to the original: ' + JSON.stringify(body));
    assert.strictEqual(body.hookSpecificOutput.updatedInput.description, 'wg-allow fixture description', 'WG-ALLOW: updatedInput must preserve every other original tool_input field, not just command: ' + JSON.stringify(body));

    const target = bundlePath(proj, 'wg-test', 'test-specialist');
    const real = spawnSync('bash', ['-c', cmd], { cwd: proj, encoding: 'utf8' });
    assert.strictEqual(real.status, 0, 'WG-ALLOW: the real write-bundle.sh invocation this gate allowed must itself succeed: ' + JSON.stringify(real));
    assert.strictEqual(fs.existsSync(target), true, 'WG-ALLOW: end-to-end proof -- the allowed real invocation must genuinely produce the bundle file: ' + target);
    console.log('WG-ALLOW well-formed real-shape heredoc invocation allowed end-to-end (decision + real write): PASS');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// WG-MISSING-ROLE BLOCK: a real heredoc invocation missing --role entirely.
{
  const proj = makeTempProject();
  try {
    const cmd = `bash "${WRITE_BUNDLE_SH}" --plan-id "wave-wg-test/PLAN.md#T1" <<'BODY'\n## body\nBODY`;
    const r = runFor(cmd, 'wg-missing-role', proj);
    assertPreToolUseDeny(r, 'WG-MISSING-ROLE: a real heredoc invocation missing --role must block');
    console.log('WG-MISSING-ROLE missing --role on a real heredoc invocation blocks: PASS');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// WG-MISSING-PLANID BLOCK: a real heredoc invocation missing --plan-id entirely.
{
  const proj = makeTempProject();
  try {
    const cmd = `bash "${WRITE_BUNDLE_SH}" --role test-specialist <<'BODY'\n## body\nBODY`;
    const r = runFor(cmd, 'wg-missing-planid', proj);
    assertPreToolUseDeny(r, 'WG-MISSING-PLANID: a real heredoc invocation missing --plan-id must block');
    console.log('WG-MISSING-PLANID missing --plan-id on a real heredoc invocation blocks: PASS');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// WG-DUPLICATE-FLAG BLOCK: --role supplied twice. The OLD hook's own
// extractFlagValue is a single regex .match() -- it silently returns only
// the FIRST occurrence and never notices a duplicate at all.
{
  const proj = makeTempProject();
  try {
    const cmd = `bash "${WRITE_BUNDLE_SH}" --role test-specialist --role toolkit-specialist --plan-id "wave-wg-test/PLAN.md#T1" <<'BODY'\n## body\nBODY`;
    const r = runFor(cmd, 'wg-duplicate', proj);
    assertPreToolUseDeny(r, 'WG-DUPLICATE-FLAG: a duplicate --role must block');
    console.log('WG-DUPLICATE-FLAG duplicate --role blocks: PASS');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// WG-EXTRA-POSITIONAL BLOCK: a stray extra token in the argv prefix.
{
  const proj = makeTempProject();
  try {
    const cmd = `bash "${WRITE_BUNDLE_SH}" extra-stray-token --role test-specialist --plan-id "wave-wg-test/PLAN.md#T1" <<'BODY'\n## body\nBODY`;
    const r = runFor(cmd, 'wg-extra-positional', proj);
    assertPreToolUseDeny(r, 'WG-EXTRA-POSITIONAL: an extra positional token must block');
    console.log('WG-EXTRA-POSITIONAL stray positional token blocks: PASS');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// WG-CHAINING-AFTER BLOCK: chaining appended AFTER an otherwise well-formed
// heredoc invocation. TODAY nothing checks for a trailing chaining operator
// at all -- the OLD hook's own validateWriteBundleInvocation only inspects
// the --role/--plan-id/--slug VALUES it can regex-extract, never the
// surrounding command shape.
{
  const proj = makeTempProject();
  try {
    const cmd = `bash "${WRITE_BUNDLE_SH}" --role test-specialist --plan-id "wave-wg-test/PLAN.md#T1" <<'BODY'\n## body\nBODY\n && echo pwned`;
    const r = runFor(cmd, 'wg-chaining-after', proj);
    assertPreToolUseDeny(r, 'WG-CHAINING-AFTER: chaining appended after a valid invocation must block');
    console.log('WG-CHAINING-AFTER trailing chaining operator after a valid invocation blocks: PASS');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// WG-LOOKALIKE-PATH: a same-basename write-bundle.sh at a DIFFERENT
// directory must never be recognized as the sanctioned writer -- proven via
// a role value that is GRAMMATICALLY MALFORMED (uppercase, violates
// ROLE_RE): if this lookalike were (wrongly) validated as if it were the
// real script, the malformed role would trigger a block; since a lookalike
// must never be inspected by this validation path AT ALL, it must instead
// flow through as an ordinary, unrelated Bash command (allowed). TODAY the
// hook's own `cmd.includes('write-bundle.sh')` substring match catches this
// lookalike purely by basename (ignoring directory) and DOES validate (and
// reject) its malformed role -- proving today's substring recognition
// wrongly treats a foreign script as if it were genuinely the sanctioned one.
{
  const proj = makeTempProject();
  const evilDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-write-gate-evil-'));
  try {
    const evilScript = path.join(evilDir, 'write-bundle.sh');
    fs.writeFileSync(evilScript, '#!/usr/bin/env bash\necho "not the real write-bundle.sh"\n');
    fs.chmodSync(evilScript, 0o755);
    const cmd = `bash "${evilScript}" --role UPPERCASE_INVALID --plan-id "wave-wg-test/PLAN.md#T1" <<'BODY'\n## body\nBODY`;
    const r = runFor(cmd, 'wg-lookalike', proj);
    assert.strictEqual(r.exit, 0, 'WG-LOOKALIKE-PATH: a same-basename script at a DIFFERENT directory must never be recognized as write-bundle.sh -- TODAY substring matching wrongly recognizes and validates it (and rejects its malformed --role), proving it was treated as genuine: ' + JSON.stringify(r));
    console.log('WG-LOOKALIKE-PATH same-basename script in a different directory is never recognized as the sanctioned writer (never inspected at all): PASS');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
    fs.rmSync(evilDir, { recursive: true, force: true });
  }
}

// WG-SUBSTRING-ONLY: a command that merely MENTIONS "write-bundle.sh" as
// text (e.g. inside an echo argument) -- not an actual `bash <path> ...`
// invocation at all -- must never trigger the write-bundle validation path,
// even when that mention happens to also contain --role/--plan-id-shaped
// text. Proven via a deliberately malformed --role-shaped substring: if this
// were (wrongly) validated, the malformed value would block; a genuine
// non-invocation mention must be classified not-applicable and pass through
// untouched. TODAY the hook's substring-plus-regex-extraction approach finds
// "write-bundle.sh" anywhere, and extractFlagValue finds "--role"/value
// ANYWHERE in the string regardless of quoting/command-structure context --
// so this exact echo statement is wrongly validated and blocked today.
{
  const proj = makeTempProject();
  try {
    const cmd = 'echo "docs say: use write-bundle.sh --role BAD_ROLE_SHAPE --plan-id ok"';
    const r = runFor(cmd, 'wg-substring-only', proj);
    assert.strictEqual(r.exit, 0, 'WG-SUBSTRING-ONLY: a command that only MENTIONS write-bundle.sh as text (not tokens[0]=bash/sh, tokens[1]=<resolved path>) must never trigger validation at all -- TODAY substring-plus-regex-anywhere extraction wrongly inspects and blocks it: ' + JSON.stringify(r));
    console.log('WG-SUBSTRING-ONLY a non-invocation textual mention of write-bundle.sh never triggers the validation path: PASS');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// WG-BYPASS (regression anchor, unchanged mechanism): a Bash command that
// writes DIRECTLY into .planning/wave-*/context-bundles/*.md WITHOUT going
// through write-bundle.sh at all must still be blocked -- BYPASS_WRITE_RE is
// an INDEPENDENT check, unaffected by the canonical-recognition rewrite
// above. Simulates the real PreToolUse enforcement loop: only actually
// executes the underlying bypass command if the gate's own decision was
// allow (a bug), proving a genuine block leaves the target file unwritten.
{
  const proj = makeTempProject();
  try {
    const target = bundlePath(proj, 'wg-test', 'evil');
    const cmd = `mkdir -p "$(dirname '${target}')" && printf 'not a real bundle' > '${target}'`;
    const r = runFor(cmd, 'wg-bypass', proj);
    assertPreToolUseDeny(r, 'WG-BYPASS: a direct bypass write into context-bundles/ must still block');
    assert.strictEqual(fs.existsSync(target), false, 'WG-BYPASS: zero-write proof -- the bypassed target file must never exist when the gate blocks');
    console.log('WG-BYPASS direct bypass write still blocked + zero-write proof (unchanged, independent mechanism): PASS');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// WG-REJECT-LIST-DEVELOP BLOCK: --slug on the protected reject-list, real heredoc shape.
{
  const proj = makeTempProject();
  try {
    const cmd = writeBundleHeredocCommand('test-specialist', 'wave-develop/PLAN.md#T1', 'develop');
    const r = runFor(cmd, 'wg-reject-develop', proj);
    assertPreToolUseDeny(r, 'WG-REJECT-LIST-DEVELOP: --slug develop must block');
    console.log('WG-REJECT-LIST-DEVELOP --slug develop (reject-list) blocks on the real heredoc shape: PASS');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// WG-POSITIVE-CONTROL-SLUG: the SAME grammar accepts a genuinely
// well-formed, non-reject-list --slug -- proves WG-REJECT-LIST-DEVELOP
// rejects reject-list MEMBERSHIP specifically, not merely "any --slug".
{
  const proj = makeTempProject();
  try {
    const cmd = writeBundleHeredocCommand('test-specialist', 'wave-wg-test/PLAN.md#T2', 'wg-test-2');
    const r = runFor(cmd, 'wg-positive-slug', proj);
    assert.strictEqual(r.exit, 0, 'WG-POSITIVE-CONTROL-SLUG: a non-reject-list --slug must be allowed: ' + JSON.stringify(r));
    console.log('WG-POSITIVE-CONTROL-SLUG non-reject-list --slug allowed (positive control): PASS');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// WG-UNRELATED PASS: an unrelated Bash command is allowed.
{
  const proj = makeTempProject();
  try {
    const r = runFor('git status', 'wg-unrelated', proj);
    assert.strictEqual(r.exit, 0, 'WG-UNRELATED: an unrelated bash command must be allowed: ' + JSON.stringify(r));
    console.log('WG-UNRELATED unrelated bash command allowed: PASS');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// WG-INVALID-JSON: malformed/invalid stdin JSON fails open.
{
  const r = runHook('not valid json at all');
  assert.strictEqual(r.exit, 0, 'WG-INVALID-JSON: invalid stdin JSON must fail open: ' + JSON.stringify(r));
  console.log('WG-INVALID-JSON invalid stdin JSON fail-open: PASS');
}

console.log('\nAll context-provider-write-gate tests passed.');
