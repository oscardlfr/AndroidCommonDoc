#!/usr/bin/env node
'use strict';

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  resolveRuntimeProjectContext, computeRuntimeToolkitInventory,
  verifyRuntimeConsumerInstallation, ROLE_TEMPLATES, HOOK_MATRIX,
} = require('../lib/runtime-project-context.cjs');

const TOOLKIT_ROOT = fs.realpathSync(path.resolve(__dirname, '../..'));
const PIN = { schema: 'runtime-consumer/v1', enabled: true, consumer_layer: 'L2',
  toolkit_commit: 'a'.repeat(40), toolkit_content_sha256: 'b'.repeat(64) };

function fixture(layer = 'L2') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime consumer '));
  if (layer === 'L1') {
    fs.mkdirSync(path.join(root, 'skills'), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', 'registry.json'), '{}\n');
  }
  const manifest = {
    version: 2,
    sources: [{ layer: 'L0', path: path.relative(root, TOOLKIT_ROOT), role: 'tooling' }],
    topology: 'flat', last_synced: '2026-09-05T00:00:00.000Z',
    selection: { mode: 'include-all', exclude_skills: [], exclude_agents: [], exclude_commands: [], exclude_categories: [], exclude_hooks: [] },
    checksums: {}, l2_specific: { commands: [], agents: [], skills: [] }, migrations_applied: [],
    runtime: { ...PIN, consumer_layer: layer },
  };
  fs.writeFileSync(path.join(root, 'l0-manifest.json'), JSON.stringify(manifest));
  return { root, manifest };
}

function installFixture(f) {
  const inventory = computeRuntimeToolkitInventory(TOOLKIT_ROOT);
  assert.strictEqual(inventory.ok, true, JSON.stringify(inventory));
  f.manifest.runtime.toolkit_commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: TOOLKIT_ROOT, encoding: 'utf8',
  }).trim();
  f.manifest.runtime.toolkit_content_sha256 = inventory.digest;
  fs.writeFileSync(path.join(f.root, 'l0-manifest.json'), JSON.stringify(f.manifest));
  const agents = path.join(f.root, '.claude', 'agents');
  fs.mkdirSync(agents, { recursive: true });
  for (const role of ROLE_TEMPLATES) {
    fs.copyFileSync(path.join(TOOLKIT_ROOT, '.claude', 'agents', `${role}.md`), path.join(agents, `${role}.md`));
  }
  const quote = (value) => JSON.stringify(value.replace(/\\/g, '/'));
  const nodePath = fs.realpathSync(process.execPath);
  const hooks = {};
  for (const [event, matcher, file, timeout] of HOOK_MATRIX) {
    if (!hooks[event]) hooks[event] = [];
    let block = hooks[event].find((candidate) => candidate.matcher === matcher);
    if (!block) { block = { matcher, hooks: [] }; hooks[event].push(block); }
    block.hooks.push({
      type: 'command',
      command: `${quote(nodePath)} ${quote(path.join(TOOLKIT_ROOT, '.claude', 'hooks', file))}`,
      timeout,
    });
  }
  fs.mkdirSync(path.join(f.root, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(f.root, '.claude', 'settings.json'), JSON.stringify({ hooks }, null, 2));
}

test('P3-RUNTIME-CONTEXT L0 self-use and explicit L1/L2 source references resolve without environment fallback', () => {
  assert.deepStrictEqual(resolveRuntimeProjectContext(TOOLKIT_ROOT), {
    ok: true, toolkitRoot: TOOLKIT_ROOT, consumerRoot: TOOLKIT_ROOT, consumerLayer: 'L0',
    toolkitCommit: null, toolkitContentDigest: null,
  });
  for (const layer of ['L1', 'L2']) {
    const f = fixture(layer);
    try {
      const result = resolveRuntimeProjectContext(f.root);
      assert.strictEqual(result.ok, true, JSON.stringify(result));
      assert.strictEqual(result.consumerLayer, layer);
      assert.strictEqual(result.toolkitRoot, TOOLKIT_ROOT);
      assert.strictEqual(result.consumerRoot, fs.realpathSync(f.root));
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
  }
});

test('P3-RUNTIME-CONTEXT malformed, disabled, ambiguous, remote, wrong-layer and foreign toolkit pins fail closed', () => {
  const mutations = [
    (m) => { delete m.runtime; },
    (m) => { m.runtime.enabled = false; },
    (m) => { m.runtime.extra = true; },
    (m) => { m.runtime.consumer_layer = 'L1'; },
    (m) => { m.sources.push({ ...m.sources[0] }); },
    (m) => { m.sources[0].remote = 'https://example.invalid/toolkit.git'; },
    (m) => { m.sources[0].path = '.'; },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    try {
      mutate(f.manifest);
      fs.writeFileSync(path.join(f.root, 'l0-manifest.json'), JSON.stringify(f.manifest));
      assert.strictEqual(resolveRuntimeProjectContext(f.root).ok, false);
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
  }
});

test('P3-RUNTIME-INSTALL exact source hooks, role bytes, commit and content pin qualify; drift fails closed', () => {
  const f = fixture();
  try {
    installFixture(f);
    const qualified = verifyRuntimeConsumerInstallation(f.root, { verifyContent: true });
    assert.strictEqual(qualified.ok, true, JSON.stringify(qualified));

    const settingsPath = path.join(f.root, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    settings.hooks.SessionStart[0].hooks[0].command += ' --changed';
    fs.writeFileSync(settingsPath, JSON.stringify(settings));
    assert.strictEqual(verifyRuntimeConsumerInstallation(f.root).reason, 'runtime-hook-registration-conflict');

    installFixture(f);
    fs.appendFileSync(path.join(f.root, '.claude', 'agents', 'arch-platform.md'), '\nchanged\n');
    assert.strictEqual(verifyRuntimeConsumerInstallation(f.root).reason, 'runtime-role-template-mismatch');

    installFixture(f);
    f.manifest.runtime.toolkit_content_sha256 = '0'.repeat(64);
    fs.writeFileSync(path.join(f.root, 'l0-manifest.json'), JSON.stringify(f.manifest));
    assert.strictEqual(
      verifyRuntimeConsumerInstallation(f.root, { verifyContent: true }).reason,
      'runtime-toolkit-content-drift',
    );
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});
