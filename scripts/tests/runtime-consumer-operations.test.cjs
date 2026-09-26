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

test('canonical entrypoint docs use the renderer-compatible single-quoted POSIX form', () => {
  for (const name of ['init-session', 'resume-work', 'work', 'ingest-content', 'monitor-docs']) {
    const text = fs.readFileSync(path.join(root, 'skills', name, 'SKILL.md'), 'utf8');
    const line = text.split(/\r?\n/).find((candidate) => candidate.includes('runtime-collaboration-entrypoints.cjs'));
    assert.ok(line, `${name}: canonical entrypoint line missing`);
    assert.match(line, /^'<resolved-node>' '<toolkit-root>\/scripts\/lib\/runtime-collaboration-entrypoints\.cjs'/);
    assert.doesNotMatch(line, /^"<resolved-node>"/);
  }
});
