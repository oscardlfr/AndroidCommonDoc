#!/usr/bin/env node
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');

test('consumer operations document required launch, recovery, and recertification contracts', () => {
  const text = fs.readFileSync(path.join(root, 'docs', 'guides', 'runtime-consumer-operations.md'), 'utf8');
  assert.match(text, /claude --add-dir "\$ANDROID_COMMON_DOC"/);
  assert.match(text, /--safe-mode/);
  assert.match(text, /--bare/);
  assert.match(text, /-p` \/ `--print/);
  assert.match(text, /--no-session-persistence/);
  assert.match(text, /--dangerously-skip-permissions/);
  assert.match(text, /recertify-claude-host-contract\.cjs/);
  assert.match(text, /effective` remains\s+null/);
});

test('consumer operations document distinguishes interactive input and permission modes', () => {
  const text = fs.readFileSync(path.join(root, 'docs', 'guides', 'runtime-consumer-operations.md'), 'utf8');
  assert.match(text, /send `Ctrl\+U`.*then send the new prompt.*finally send `Enter`/s);
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

test('canonical entrypoint docs use the consumer launcher and renderer-compatible single-quoted POSIX form', () => {
  for (const name of ['init-session', 'resume-work', 'work', 'ingest-content', 'monitor-docs']) {
    const text = fs.readFileSync(path.join(root, 'skills', name, 'SKILL.md'), 'utf8');
    const line = text.split(/\r?\n/).find((candidate) => candidate.includes('l0-entrypoint-launcher.cjs'));
    assert.ok(line, `${name}: canonical entrypoint line missing`);
    assert.match(line, /^'<resolved-node>' '<consumer-root>\/\.claude\/runtime\/l0-entrypoint-launcher\.cjs'/);
    assert.doesNotMatch(line, /^"<resolved-node>"/);
  }
});
