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
const SOURCE_REFERENCED_HOOK_FILES = new Set([
  'agent-spawn-execution-gate.js', 'context-provider-consulted.js', 'context-provider-gate.js',
  'bash-cli-spawn-gate.js',
  'premature-execution-gate.js', 'plan-md-write-gate.js',
  'runtime-consultation-target-gate.js',
  'runtime-host-boundary.js', 'runtime-host-session-start.js',
  'subagent-start-context-bundle.js',
]);
const CONSUMER_FILES = [
  '.claude/runtime/l0-entrypoint-launcher.cjs',
  '.claude/runtime/l0-toolkit-launcher.cjs',
  '.claude/hooks/l0-source-hook-launcher.js',
  '.claude/hooks/context-provider-write-gate.js',
  '.claude/hooks/detekt-post-write.sh',
  '.claude/hooks/detekt-pre-commit.sh',
  '.claude/hooks/tool-use-logger.js',
  '.claude/registry/wave-topology.yaml',
  'scripts/sh/write-bundle.sh',
  'scripts/sh/lib/wave-slug.sh',
];

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
  for (const relative of CONSUMER_FILES) {
    const destination = path.join(f.root, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(TOOLKIT_ROOT, relative), destination);
    if (relative.endsWith('.sh')) fs.chmodSync(destination, 0o755);
  }
  const hooks = {};
  for (const [event, matcher, file, timeout] of HOOK_MATRIX) {
    if (!hooks[event]) hooks[event] = [];
    let block = hooks[event].find((candidate) => candidate.matcher === matcher);
    if (!block) { block = { matcher, hooks: [] }; hooks[event].push(block); }
    block.hooks.push({
      type: 'command',
      command: SOURCE_REFERENCED_HOOK_FILES.has(file)
        ? `node "$CLAUDE_PROJECT_DIR"/.claude/hooks/l0-source-hook-launcher.js ${file}`
        : file.endsWith('.sh')
          ? `"$CLAUDE_PROJECT_DIR"/.claude/hooks/${file}`
          : `node "$CLAUDE_PROJECT_DIR"/.claude/hooks/${file}`,
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

test('P3-RUNTIME-CONTEXT explicit manifest layer qualifies L1 without a skills registry', () => {
  const f = fixture('L1');
  try {
    fs.rmSync(path.join(f.root, 'skills'), { recursive: true, force: true });
    f.manifest.consumer_layer = 'L1';
    fs.writeFileSync(path.join(f.root, 'l0-manifest.json'), JSON.stringify(f.manifest));
    const result = resolveRuntimeProjectContext(f.root);
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    assert.strictEqual(result.consumerLayer, 'L1');
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('P3-RUNTIME-INVENTORY includes every modular runtime dependency tree', () => {
  const inventory = computeRuntimeToolkitInventory(TOOLKIT_ROOT);
  assert.strictEqual(inventory.ok, true, JSON.stringify(inventory));
  const paths = new Set(inventory.entries.map((entry) => entry.relative_path));
  assert.ok(paths.has('scripts/lib/runtime-consultation.cjs'));
  assert.ok(paths.has('scripts/lib/runtime-consultation/primitives.cjs'));
  assert.ok(paths.has('scripts/lib/runtime-consultation/cli-argv.cjs'));
  assert.ok(paths.has('scripts/lib/runtime-consultation/git-identity.cjs'));
  assert.ok(paths.has('scripts/lib/runtime-consultation/coordination-paths.cjs'));
  assert.ok(paths.has('scripts/lib/runtime-role-lifecycle/claude-id01-startup.cjs'));
  assert.ok(paths.has('scripts/lib/runtime-bridge-codex/process-identity.cjs'));
  assert.ok(paths.has('scripts/lib/verdict-artifact-confinement.cjs'));
});

// --- F-24: platform-scoped host certificates must reach the consumer ---
//
// Certificates are stored one per platform, so the inventory that a consumer
// verifies its installation against has to DISCOVER the set actually present
// rather than carry one hardcoded name. If it did not, a darwin certificate
// would be invisible to `verifyRuntimeConsumerInstallation({verifyContent:true})`:
// it could be swapped or removed under an installed consumer without ever
// moving `runtime.toolkit_content_sha256`.
//
// The root here is SYNTHESIZED from the real inventory's own path list -- the
// inventory only requires each listed path to be a regular file, never any
// particular content -- so this stays hermetic and never touches the shared
// worktree.
function synthesizeToolkitRoot() {
  const source = computeRuntimeToolkitInventory(TOOLKIT_ROOT);
  assert.strictEqual(source.ok, true, JSON.stringify(source));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synthetic-toolkit-'));
  for (const entry of source.entries) {
    const absolute = path.join(root, entry.relative_path);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, '');
  }
  return root;
}

test('P3-RUNTIME-INVENTORY-HOSTCERT covers every platform-scoped host certificate present, and nothing that merely looks like one', () => {
  const root = synthesizeToolkitRoot();
  try {
    const before = computeRuntimeToolkitInventory(root);
    assert.strictEqual(before.ok, true, JSON.stringify(before));
    const beforePaths = new Set(before.entries.map((entry) => entry.relative_path));
    assert.ok(beforePaths.has('setup/claude-host-contract.json'),
      'the legacy single-slot certificate stays a required entry');

    // A certificate published for another platform must become part of the
    // content digest the consumer verifies against.
    fs.writeFileSync(path.join(root, 'setup', 'claude-host-contract.darwin.json'), '{}');
    fs.writeFileSync(path.join(root, 'setup', 'claude-host-contract.win32.json'), '{}');
    const after = computeRuntimeToolkitInventory(root);
    assert.strictEqual(after.ok, true, JSON.stringify(after));
    const afterPaths = new Set(after.entries.map((entry) => entry.relative_path));
    assert.ok(afterPaths.has('setup/claude-host-contract.darwin.json'),
      'a darwin certificate must be inventoried, or a consumer could never detect it changing');
    assert.ok(afterPaths.has('setup/claude-host-contract.win32.json'));
    assert.notStrictEqual(after.digest, before.digest,
      'adding a certificate must move the content digest a consumer pins');

    // Neighbours that are not platform certificates must stay out, so the
    // digest cannot be perturbed by unrelated files dropped into setup/.
    // NOTE: the uppercase decoy deliberately has no lowercase counterpart among
    // the certificates above. macOS APFS is case-insensitive by default, so
    // 'claude-host-contract.DARWIN.json' would be the SAME FILE as the darwin
    // certificate and would silently overwrite its bytes instead of testing the
    // regex.
    const decoys = ['claude-host-contract.json.bak', 'claude-host-contract..json',
      'claude-host-contract.MIXEDCASE.json', 'claude-host-contract.darwin.json.tmp', 'not-a-certificate.json'];
    for (const decoy of decoys) fs.writeFileSync(path.join(root, 'setup', decoy), '');
    const withDecoys = computeRuntimeToolkitInventory(root);
    assert.strictEqual(withDecoys.ok, true, JSON.stringify(withDecoys));
    assert.deepStrictEqual(
      withDecoys.entries.map((entry) => entry.relative_path),
      after.entries.map((entry) => entry.relative_path),
      'only claude-host-contract.<platform>.json siblings may join the inventory: ' + JSON.stringify(decoys));
    assert.strictEqual(withDecoys.digest, after.digest);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
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
    assert.strictEqual(verifyRuntimeConsumerInstallation(f.root).reason, 'runtime-hook-registration-missing');

    installFixture(f);
    const withArbitraryMention = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    withArbitraryMention.hooks.PreToolUse[0].hooks.push({
      type: 'command', command: 'node -e "console.log(\'bash-cli-spawn-gate.js\')"', timeout: 9,
    });
    fs.writeFileSync(settingsPath, JSON.stringify(withArbitraryMention));
    assert.strictEqual(verifyRuntimeConsumerInstallation(f.root).ok, true);

    installFixture(f);
    fs.appendFileSync(path.join(f.root, '.claude', 'agents', 'arch-platform.md'), '\nchanged\n');
    assert.strictEqual(verifyRuntimeConsumerInstallation(f.root).reason, 'runtime-role-template-mismatch');

    installFixture(f);
    fs.appendFileSync(path.join(f.root, '.claude', 'hooks', 'l0-source-hook-launcher.js'), '\nchanged\n');
    assert.strictEqual(verifyRuntimeConsumerInstallation(f.root).reason, 'runtime-consumer-file-mismatch');

    installFixture(f);
    fs.unlinkSync(path.join(f.root, '.claude', 'hooks', 'tool-use-logger.js'));
    assert.strictEqual(verifyRuntimeConsumerInstallation(f.root).reason, 'runtime-consumer-file-missing');

    if (process.platform !== 'win32') {
      installFixture(f);
      fs.chmodSync(path.join(f.root, '.claude', 'hooks', 'detekt-pre-commit.sh'), 0o644);
      assert.strictEqual(
        verifyRuntimeConsumerInstallation(f.root).reason,
        'runtime-consumer-file-mode-mismatch',
      );
    }

    installFixture(f);
    f.manifest.runtime.toolkit_content_sha256 = '0'.repeat(64);
    fs.writeFileSync(path.join(f.root, 'l0-manifest.json'), JSON.stringify(f.manifest));
    assert.strictEqual(
      verifyRuntimeConsumerInstallation(f.root, { verifyContent: true }).reason,
      'runtime-toolkit-content-drift',
    );
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

// Registry path helpers resolve the repository identity once per record. A
// hook event over an accumulated registry spawned hundreds of `git rev-parse`
// processes and exceeded the host SubagentStart/SubagentStop timeout.
function countGitSpawns(script) {
  const preload = [
    "const cp = require('child_process');",
    "const orig = cp.execFileSync;",
    "let n = 0;",
    "cp.execFileSync = function (cmd) { if (cmd === 'git') n += 1; return orig.apply(this, arguments); };",
    "process.on('exit', () => process.stderr.write('GIT_SPAWNS=' + n + '\\n'));",
  ].join('\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-cache-preload-'));
  try {
    fs.writeFileSync(path.join(dir, 'preload.cjs'), preload);
    const r = require('node:child_process').spawnSync(process.execPath, ['-r', path.join(dir, 'preload.cjs'), '-e', script], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    return { count: Number(/GIT_SPAWNS=(\d+)/.exec(r.stderr)[1]), stdout: r.stdout.trim() };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('runtime identity resolves git once per process for repeated registry paths', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-cache-'));
  try {
    execFileSync('git', ['init', '-q', repo]);
    const rll = JSON.stringify(path.resolve(__dirname, '../lib/runtime-role-lifecycle.cjs'));
    const { count, stdout } = countGitSpawns(
      `const r = require(${rll}); const ids = new Set();` +
      `for (let i = 0; i < 50; i += 1) { ids.add(r.registryRepoDir(${JSON.stringify(repo)})); ids.add(r.computeWorktreeId(${JSON.stringify(repo)})); }` +
      'process.stdout.write(String(ids.size));',
    );
    assert.strictEqual(stdout, '2', 'repeated resolution must stay stable');
    assert.ok(count <= 2, 'expected one git spawn per identity kind, saw ' + count);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('runtime identity never answers a repository recreated at the same path from a stale entry', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-cache-recreate-'));
  try {
    const repo = path.join(root, 'repo');
    const other = path.join(root, 'other');
    execFileSync('git', ['init', '-q', repo]);
    execFileSync('git', ['init', '-q', other]);
    execFileSync('git', ['-C', other, 'commit', '-q', '--allow-empty', '-m', 'init'], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
    const rll = require('../lib/runtime-role-lifecycle.cjs');
    const before = rll.computeRepoId(repo);
    fs.rmSync(repo, { recursive: true, force: true });
    execFileSync('git', ['-C', other, 'worktree', 'add', '-q', '--detach', repo]);
    const after = rll.computeRepoId(repo);
    assert.notStrictEqual(after, before, 'a recreated repository must not reuse the cached identity');
    assert.strictEqual(after, rll.computeRepoId(other), 'a linked worktree shares its main repository identity');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
