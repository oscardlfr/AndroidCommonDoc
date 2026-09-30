'use strict';

// Builds a qualified runtime-consumer checkout (L1/L2) whose toolkit root is this L0 checkout, so hook and
// launcher tests run with physically distinct toolkit and consumer roots. Mirrors the installation shape that
// verifyRuntimeConsumerInstallation qualifies; the consumer never carries toolkit scripts of its own.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = fs.realpathSync(path.resolve(__dirname, '../../..'));
const runtimeContext = require(path.join(ROOT, 'scripts/lib/runtime-project-context.cjs'));
const SOURCE_REFERENCED = new Set([
  'agent-spawn-execution-gate.js', 'bash-cli-spawn-gate.js', 'context-provider-consulted.js', 'context-provider-gate.js',
  'premature-execution-gate.js', 'runtime-consultation-target-gate.js', 'plan-md-write-gate.js',
  'runtime-host-boundary.js', 'runtime-host-session-start.js', 'subagent-start-context-bundle.js',
]);
const COPIED_FILES = [
  '.claude/runtime/l0-entrypoint-launcher.cjs', '.claude/runtime/l0-toolkit-launcher.cjs',
  '.claude/registry/wave-topology.yaml', '.claude/hooks/l0-source-hook-launcher.js',
  '.claude/hooks/context-provider-write-gate.js', '.claude/hooks/tool-use-logger.js',
  '.claude/hooks/detekt-post-write.sh', '.claude/hooks/detekt-pre-commit.sh',
  'scripts/sh/write-bundle.sh', 'scripts/sh/lib/wave-slug.sh',
];

function copyFromToolkit(consumerRoot, relative) {
  const destination = path.join(consumerRoot, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(ROOT, relative), destination);
  if (relative.endsWith('.sh')) fs.chmodSync(destination, 0o755);
}

function installConsumerFixture(layer) {
  const consumerRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'acd consumer fixture ')));
  execFileSync('git', ['init', '-q'], { cwd: consumerRoot });
  execFileSync('git', ['config', 'user.email', 'consumer-fixture@test.local'], { cwd: consumerRoot });
  execFileSync('git', ['config', 'user.name', 'Consumer Fixture'], { cwd: consumerRoot });
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: consumerRoot });
  if (layer === 'L1') {
    fs.mkdirSync(path.join(consumerRoot, 'skills'), { recursive: true });
    fs.writeFileSync(path.join(consumerRoot, 'skills/registry.json'), '{}\n');
  }
  for (const relative of COPIED_FILES) copyFromToolkit(consumerRoot, relative);
  for (const role of runtimeContext.ROLE_TEMPLATES) copyFromToolkit(consumerRoot, `.claude/agents/${role}.md`);
  const hooks = {};
  for (const [event, matcher, file, timeout] of runtimeContext.HOOK_MATRIX) {
    hooks[event] = hooks[event] || [];
    let block = hooks[event].find((candidate) => candidate.matcher === matcher);
    if (!block) { block = { matcher, hooks: [] }; hooks[event].push(block); }
    block.hooks.push({
      type: 'command',
      command: SOURCE_REFERENCED.has(file)
        ? `node "$CLAUDE_PROJECT_DIR"/.claude/hooks/l0-source-hook-launcher.js ${file}`
        : file.endsWith('.sh') ? `"$CLAUDE_PROJECT_DIR"/.claude/hooks/${file}` : `node "$CLAUDE_PROJECT_DIR"/.claude/hooks/${file}`,
      timeout,
    });
  }
  fs.mkdirSync(path.join(consumerRoot, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(consumerRoot, '.claude/settings.json'), JSON.stringify({ hooks }, null, 2));
  const inventory = runtimeContext.computeRuntimeToolkitInventory(ROOT);
  if (!inventory.ok) throw new Error('toolkit inventory is not computable: ' + JSON.stringify(inventory));
  fs.writeFileSync(path.join(consumerRoot, 'l0-manifest.json'), JSON.stringify({
    version: 2,
    sources: [{ layer: 'L0', path: path.relative(consumerRoot, ROOT), role: 'tooling' }],
    topology: 'flat',
    last_synced: '2026-09-27T00:00:00.000Z',
    selection: { mode: 'include-all', exclude_skills: [], exclude_agents: [], exclude_commands: [], exclude_categories: [], exclude_hooks: [] },
    checksums: {},
    l2_specific: { commands: [], agents: [], skills: [] },
    migrations_applied: [],
    runtime: {
      schema: 'runtime-consumer/v1', enabled: true, consumer_layer: layer,
      toolkit_commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
      toolkit_content_sha256: inventory.digest,
    },
  }));
  return { consumerRoot, toolkitRoot: ROOT, launcher: path.join(consumerRoot, '.claude/runtime/l0-toolkit-launcher.cjs') };
}

module.exports = { installConsumerFixture };
