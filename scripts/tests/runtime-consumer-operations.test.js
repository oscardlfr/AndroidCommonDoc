#!/usr/bin/env node
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');

test('consumer operations document required launch, recovery, and host-family compatibility contracts', () => {
  const text = fs.readFileSync(path.join(root, 'docs', 'guides', 'runtime-consumer-operations.md'), 'utf8');
  assert.match(text, /claude --add-dir "\$ANDROID_COMMON_DOC" --effort high/);
  assert.match(text, /--safe-mode/);
  assert.match(text, /--bare/);
  assert.match(text, /-p` \/ `--print/);
  assert.match(text, /--no-session-persistence/);
  assert.match(text, /--dangerously-skip-permissions/);
  assert.match(text, /recertify-claude-host-contract\.cjs/);
  assert.match(text, /Claude Code `2\.1\.x` protocol family/);
  assert.match(text, /does not require editing,\s+deleting, regenerating, or committing a certificate/);
  assert.match(text, /Developer ID on macOS or Authenticode on Windows/);
  assert.match(text, /Versions outside `2\.1\.x`.*fail closed/s);
  assert.match(text, /An L1 must own `skills\/registry\.json`/);
  assert.match(text, /effective` remains\s+null/);
});

test('consumer operations document distinguishes interactive input and permission modes', () => {
  const text = fs.readFileSync(path.join(root, 'docs', 'guides', 'runtime-consumer-operations.md'), 'utf8');
  assert.match(text, /send `Ctrl\+U`, wait, send the new prompt, then send `Enter`/);
  assert.match(text, /`-p` \/ `--print`.*one-turn invocation/s);
  assert.match(text, /`--permission-mode acceptEdits`.*initial permission mode/s);
  assert.match(text, /Bash.*still require explicit approval/s);
});

test('provenance and wave docs reject prose-only authority claims', () => {
  const provenance = fs.readFileSync(path.join(root, 'docs', 'agents', 'evidence-provenance-contract.md'), 'utf8');
  const session = fs.readFileSync(path.join(root, 'docs', 'agents', 'tl-session-start.md'), 'utf8');
  const wave = fs.readFileSync(path.join(root, 'docs', 'agents', 'wave-control-plane.md'), 'utf8');

  assert.match(provenance, /`\[Pasted text\]` proves neither authority nor prompt injection/);
  assert.match(provenance, /A relay from\s+another chat also does not materialize/);
  assert.match(provenance, /ask the owner one concrete confirmation/);
  assert.match(session, /validated transition receipt/);
  assert.match(session, /`phase`, `revision`, and `plan_sha256`/);
  assert.match(wave, /Planner completion.*is not transition authority/s);
  assert.match(wave, /without claiming that the plan\s+was rebound or that execution started/s);
});

test('canonical entrypoint docs use the consumer launcher without model-owned path discovery', () => {
  const init = fs.readFileSync(path.join(root, 'skills', 'init-session', 'SKILL.md'), 'utf8');
  assert.match(init, /node \.claude\/runtime\/l0-entrypoint-launcher\.cjs init-session/);
  assert.match(init, /Do not run `ls`, `find`, `which`, `pwd`, `node -e`/);
  assert.doesNotMatch(init, /<base64url canonical JSON>/);
  for (const name of ['resume-work', 'work', 'ingest-content', 'monitor-docs']) {
    const text = fs.readFileSync(path.join(root, 'skills', name, 'SKILL.md'), 'utf8');
    const line = text.split(/\r?\n/).find((candidate) => candidate.includes('l0-entrypoint-launcher.cjs'));
    assert.ok(line, `${name}: canonical entrypoint line missing`);
    assert.match(line, /^'<resolved-node>' '<consumer-root>\/\.claude\/runtime\/l0-entrypoint-launcher\.cjs'/);
    assert.doesNotMatch(line, /^"<resolved-node>"/);
  }
});
