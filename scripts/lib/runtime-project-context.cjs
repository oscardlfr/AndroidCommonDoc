'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const TOOLKIT_ROOT = fs.realpathSync(path.resolve(__dirname, '../..'));
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const CORE_HOOK_FILES = Object.freeze([
  'context-provider-gate.js', 'context-provider-write-gate.js',
  'runtime-consultation-target-gate.js', 'agent-spawn-execution-gate.js',
  'subagent-start-context-bundle.js', 'runtime-host-boundary.js',
  'runtime-host-session-start.js', 'bash-cli-spawn-gate.js',
  'premature-execution-gate.js', 'tool-use-logger.js',
]);
const ROLE_TEMPLATES = Object.freeze([
  'arch-platform', 'arch-testing', 'arch-integration', 'context-provider',
  'doc-updater', 'toolkit-specialist', 'test-specialist', 'verifier',
  'quality-gater', 'planner',
]);
const HOOK_MATRIX = Object.freeze([
  ['SessionStart', 'startup', 'runtime-host-session-start.js', 20],
  ['PreToolUse', 'Write|Edit|Bash', 'premature-execution-gate.js', 5],
  ['PreToolUse', 'Bash', 'bash-cli-spawn-gate.js', 5],
  ['PreToolUse', 'Bash', 'runtime-consultation-target-gate.js', 5],
  ['PreToolUse', 'Bash', 'context-provider-write-gate.js', 5],
  ['PreToolUse', 'Grep|Glob|Bash|Read', 'context-provider-gate.js', 30],
  ['PreToolUse', 'Task|Agent', 'agent-spawn-execution-gate.js', 30],
  ['PreToolUse', 'Bash|Task|Agent|SendMessage', 'runtime-host-boundary.js', 5],
  ['PostToolUse', '.*', 'tool-use-logger.js', 5],
  ['PostToolUse', 'Bash|Task|Agent|SendMessage', 'runtime-host-boundary.js', 5],
  ['PostToolUseFailure', 'Agent|SendMessage', 'tool-use-logger.js', 5],
  ['PostToolUseFailure', 'Bash|Task|Agent|SendMessage', 'runtime-host-boundary.js', 5],
  ['SubagentStart', '.*', 'subagent-start-context-bundle.js', 10],
  ['SubagentStop', '.*', 'subagent-start-context-bundle.js', 10],
]);

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected.slice().sort());
}

function fail(reason) {
  return { ok: false, reason };
}

function resolveRuntimeProjectContext(consumerRoot) {
  if (typeof consumerRoot !== 'string' || consumerRoot.length === 0) return fail('runtime-consumer-root-invalid');
  let canonicalConsumer;
  try {
    canonicalConsumer = fs.realpathSync(consumerRoot);
    if (!fs.statSync(canonicalConsumer).isDirectory()) return fail('runtime-consumer-root-invalid');
  } catch {
    return fail('runtime-consumer-root-invalid');
  }

  if (canonicalConsumer === TOOLKIT_ROOT) {
    return {
      ok: true,
      toolkitRoot: TOOLKIT_ROOT,
      consumerRoot: canonicalConsumer,
      consumerLayer: 'L0',
      toolkitCommit: null,
      toolkitContentDigest: null,
    };
  }

  const manifestPath = path.join(canonicalConsumer, 'l0-manifest.json');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch { return fail('runtime-consumer-manifest-invalid'); }
  if (!manifest || manifest.version !== 2 || !Array.isArray(manifest.sources) ||
      !exactKeys(manifest.runtime, [
        'schema', 'enabled', 'consumer_layer', 'toolkit_commit', 'toolkit_content_sha256',
      ]) || manifest.runtime.schema !== 'runtime-consumer/v1' || manifest.runtime.enabled !== true ||
      !['L1', 'L2'].includes(manifest.runtime.consumer_layer) || !HEX40.test(manifest.runtime.toolkit_commit) ||
      !HEX64.test(manifest.runtime.toolkit_content_sha256)) {
    return fail('runtime-consumer-manifest-invalid');
  }

  const l0Sources = manifest.sources.filter((source) => source && source.layer === 'L0' && source.role === 'tooling');
  if (l0Sources.length !== 1 || typeof l0Sources[0].path !== 'string' || l0Sources[0].path.length === 0 ||
      Object.prototype.hasOwnProperty.call(l0Sources[0], 'remote')) return fail('runtime-l0-source-invalid');
  let canonicalSource;
  try { canonicalSource = fs.realpathSync(path.resolve(canonicalConsumer, l0Sources[0].path)); }
  catch { return fail('runtime-l0-source-unresolved'); }
  if (canonicalSource !== TOOLKIT_ROOT) return fail('runtime-toolkit-source-mismatch');

  const hasRegistry = fs.existsSync(path.join(canonicalConsumer, 'skills', 'registry.json'));
  const observedLayer = hasRegistry ? 'L1' : 'L2';
  if (manifest.runtime.consumer_layer !== observedLayer) return fail('runtime-consumer-layer-mismatch');
  return {
    ok: true,
    toolkitRoot: TOOLKIT_ROOT,
    consumerRoot: canonicalConsumer,
    consumerLayer: observedLayer,
    toolkitCommit: manifest.runtime.toolkit_commit,
    toolkitContentDigest: manifest.runtime.toolkit_content_sha256,
  };
}

function collectDirectory(root, relativeDir, files) {
  for (const entry of fs.readdirSync(path.join(root, relativeDir), { withFileTypes: true })) {
    const relative = path.posix.join(relativeDir.replace(/\\/g, '/'), entry.name);
    if (entry.isSymbolicLink()) throw new Error('runtime-inventory-symlink');
    if (entry.isDirectory()) collectDirectory(root, relative, files);
    else if (entry.isFile()) files.push(relative);
  }
}

function computeRuntimeToolkitInventory(toolkitRoot) {
  let root;
  try { root = fs.realpathSync(toolkitRoot); } catch { return fail('runtime-toolkit-unresolved'); }
  const files = [
    'scripts/lib/runtime-role-lifecycle.cjs', 'scripts/lib/runtime-host-claude.cjs',
    'scripts/lib/runtime-consultation.cjs', 'scripts/lib/runtime-collaboration-entrypoints.cjs',
    'scripts/lib/runtime-collaboration-policy.json', 'scripts/lib/runtime-routing.json',
    'scripts/lib/runtime-bridge-codex.cjs', 'scripts/lib/runtime-project-context.cjs',
    '.claude/settings.json', '.claude/model-profiles.json', 'setup/claude-host-contract.json',
    'mcp-server/package-lock.json',
    ...CORE_HOOK_FILES.map((file) => `.claude/hooks/${file}`),
    ...ROLE_TEMPLATES.map((role) => `.claude/agents/${role}.md`),
    ...['init-session', 'resume-work', 'work', 'ingest-content', 'monitor-docs'].map((skill) => `skills/${skill}/SKILL.md`),
    ...['init-session', 'resume-work', 'work', 'ingest-content', 'monitor-docs'].map((command) => `.claude/commands/${command}.md`),
  ];
  try {
    collectDirectory(root, 'scripts/lib/runtime-consultation', files);
    collectDirectory(root, 'scripts/lib/runtime-role-lifecycle', files);
    collectDirectory(root, 'scripts/lib/runtime-bridge-codex', files);
    collectDirectory(root, 'mcp-server/build', files);
  } catch { return fail('runtime-toolkit-inventory-invalid'); }
  const entries = [];
  try {
    for (const relative of [...new Set(files)].sort()) {
      const absolute = path.join(root, relative);
      const stat = fs.lstatSync(absolute);
      if (!stat.isFile() || stat.isSymbolicLink()) return fail('runtime-toolkit-inventory-invalid');
      entries.push({
        relative_path: relative.replace(/\\/g, '/'),
        kind: 'file',
        sha256: crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'),
      });
    }
  } catch { return fail('runtime-toolkit-inventory-invalid'); }
  return {
    ok: true,
    entries,
    digest: crypto.createHash('sha256').update(JSON.stringify(entries), 'utf8').digest('hex'),
  };
}

function expectedHookCommand(toolkitRoot, file) {
  let nodePath;
  try { nodePath = fs.realpathSync(process.execPath); } catch { return null; }
  const quote = (value) => JSON.stringify(value.replace(/\\/g, '/'));
  return `${quote(nodePath)} ${quote(path.join(toolkitRoot, '.claude', 'hooks', file))}`;
}

function verifyRuntimeConsumerInstallation(consumerRoot, options) {
  const context = resolveRuntimeProjectContext(consumerRoot);
  if (!context.ok || context.consumerLayer === 'L0') return context;
  let settings;
  try { settings = JSON.parse(fs.readFileSync(path.join(context.consumerRoot, '.claude', 'settings.json'), 'utf8')); }
  catch { return fail('runtime-settings-invalid'); }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings) ||
      !settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
    return fail('runtime-settings-invalid');
  }
  const desired = new Map(HOOK_MATRIX.map(([event, matcher, file, timeout]) => [
    JSON.stringify([event, matcher, expectedHookCommand(context.toolkitRoot, file), timeout]), 0,
  ]));
  for (const [event, blocks] of Object.entries(settings.hooks)) {
    if (!Array.isArray(blocks)) return fail('runtime-settings-invalid');
    for (const block of blocks) {
      if (!block || typeof block !== 'object' || typeof block.matcher !== 'string' || !Array.isArray(block.hooks)) {
        return fail('runtime-settings-invalid');
      }
      for (const hook of block.hooks) {
        if (!hook || typeof hook !== 'object' || hook.type !== 'command' || typeof hook.command !== 'string') continue;
        const key = JSON.stringify([event, block.matcher, hook.command, hook.timeout]);
        if (desired.has(key)) desired.set(key, desired.get(key) + 1);
        else if (CORE_HOOK_FILES.some((file) => hook.command.includes(file))) return fail('runtime-hook-registration-conflict');
      }
    }
  }
  if ([...desired.values()].some((count) => count !== 1)) return fail('runtime-hook-registration-missing');
  for (const role of ROLE_TEMPLATES) {
    try {
      const source = fs.readFileSync(path.join(context.toolkitRoot, '.claude', 'agents', `${role}.md`));
      const consumer = fs.readFileSync(path.join(context.consumerRoot, '.claude', 'agents', `${role}.md`));
      if (!source.equals(consumer)) return fail('runtime-role-template-mismatch');
    } catch { return fail('runtime-role-template-missing'); }
  }
  if (options && options.verifyContent === true) {
    let commit;
    try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: context.toolkitRoot, encoding: 'utf8' }).trim(); }
    catch { return fail('runtime-toolkit-commit-unavailable'); }
    if (commit !== context.toolkitCommit) return fail('runtime-toolkit-commit-drift');
    const inventory = computeRuntimeToolkitInventory(context.toolkitRoot);
    if (!inventory.ok) return inventory;
    if (inventory.digest !== context.toolkitContentDigest) return fail('runtime-toolkit-content-drift');
    return { ...context, inventory: inventory.entries };
  }
  return context;
}

module.exports = {
  resolveRuntimeProjectContext,
  computeRuntimeToolkitInventory,
  verifyRuntimeConsumerInstallation,
  CORE_HOOK_FILES,
  ROLE_TEMPLATES,
  HOOK_MATRIX,
};
