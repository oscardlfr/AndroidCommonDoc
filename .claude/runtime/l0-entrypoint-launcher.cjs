#!/usr/bin/env node
'use strict';

// Consumer-local, inventory-bound adapter for the five collaboration
// entrypoints.  It contains no L0 implementation: it resolves the one pinned
// toolkit source, asks that toolkit's runtime-project-context owner to verify
// the complete installation, and then delegates an unchanged, closed argv to
// the canonical entrypoint module.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ENTRYPOINTS = new Set([
  'init-session',
  'resume-work',
  'work',
  'ingest-content',
  'monitor-docs',
]);
const LAUNCHER_RELATIVE = '.claude/runtime/l0-entrypoint-launcher.cjs';
const CONTEXT_RELATIVE = 'scripts/lib/runtime-project-context.cjs';
const TARGET_RELATIVE = 'scripts/lib/runtime-collaboration-entrypoints.cjs';

function fail(reason) {
  process.stderr.write(`[l0-entrypoint-launcher] ${reason}\n`);
  process.exit(1);
}

function regularCanonicalFile(root, relative, reason) {
  const expected = path.resolve(root, relative);
  try {
    const info = fs.lstatSync(expected);
    if (!info.isFile() || info.isSymbolicLink() || fs.realpathSync(expected) !== expected) fail(reason);
  } catch {
    fail(reason);
  }
  return expected;
}

function canonicalDirectory(value, reason) {
  if (typeof value !== 'string' || value.length === 0 || !path.isAbsolute(value)) fail(reason);
  const expected = path.resolve(value);
  try {
    const info = fs.lstatSync(expected);
    if (!info.isDirectory() || info.isSymbolicLink() || fs.realpathSync(expected) !== expected) fail(reason);
  } catch {
    fail(reason);
  }
  return expected;
}

function isL0Root(root) {
  try {
    const registry = fs.lstatSync(path.join(root, 'skills', 'registry.json'));
    const mcpServer = fs.lstatSync(path.join(root, 'mcp-server'));
    return registry.isFile() && !registry.isSymbolicLink()
      && mcpServer.isDirectory() && !mcpServer.isSymbolicLink();
  } catch {
    return false;
  }
}

function sourceResolutionBases(projectRoot) {
  const bases = [projectRoot];
  try {
    const commonDir = execFileSync(
      'git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (path.basename(commonDir) === '.git') {
      const mainRoot = path.dirname(commonDir);
      bases.push(mainRoot);
      if (process.platform === 'darwin' && mainRoot.startsWith('/private/')) {
        bases.push(mainRoot.slice('/private'.length));
      }
    }
  } catch {
    // A non-Git consumer has only its literal project-root base.
  }
  return [...new Set(bases)];
}

function safeCanonicalDirectory(value) {
  try {
    const expected = path.resolve(value);
    const info = fs.lstatSync(expected);
    return info.isDirectory() && !info.isSymbolicLink() && fs.realpathSync(expected) === expected
      ? expected
      : null;
  } catch {
    return null;
  }
}

function resolveManifestToolkit(projectRoot) {
  const manifestPath = regularCanonicalFile(projectRoot, 'l0-manifest.json', 'consumer manifest is missing or unsafe');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch { fail('consumer manifest is malformed'); }
  const sources = manifest && manifest.version === 2 && Array.isArray(manifest.sources)
    ? manifest.sources.filter((source) => source && source.layer === 'L0' && source.role === 'tooling')
    : [];
  if (sources.length !== 1 || typeof sources[0].path !== 'string' || sources[0].path.length === 0
      || Object.prototype.hasOwnProperty.call(sources[0], 'remote')) {
    fail('consumer manifest must declare exactly one local L0 tooling source');
  }
  const candidates = new Set();
  for (const base of sourceResolutionBases(projectRoot)) {
    const candidate = safeCanonicalDirectory(path.resolve(base, sources[0].path));
    if (candidate && isL0Root(candidate)) candidates.add(candidate);
  }
  if (candidates.size !== 1) {
    fail(candidates.size === 0 ? 'L0 tooling source is unresolved or unsafe' : 'L0 tooling source is ambiguous');
  }
  return [...candidates][0];
}

function parseArgv(argv) {
  if (argv.length !== 7 || argv[0] !== 'execute'
      || argv[1] !== '--entrypoint' || !ENTRYPOINTS.has(argv[2])
      || argv[3] !== '--project-root' || argv[5] !== '--intent'
      || typeof argv[6] !== 'string' || argv[6].length === 0) {
    fail('expected the closed execute/entrypoint/project-root/intent argv');
  }
  return { entrypoint: argv[2], projectRoot: canonicalDirectory(argv[4], 'consumer project root is unresolved or unsafe') };
}

const argv = process.argv.slice(2);
const parsed = parseArgv(argv);
const launcherRoot = canonicalDirectory(path.resolve(__dirname, '../..'), 'launcher root is unresolved or unsafe');
const expectedLauncher = regularCanonicalFile(launcherRoot, LAUNCHER_RELATIVE, 'launcher is missing or unsafe');
if (fs.realpathSync(__filename) !== expectedLauncher) fail('launcher is outside its canonical root');
if (parsed.projectRoot !== launcherRoot) fail('project root must own the invoked launcher');

const toolkitRoot = isL0Root(parsed.projectRoot)
  ? parsed.projectRoot
  : resolveManifestToolkit(parsed.projectRoot);
const contextPath = regularCanonicalFile(toolkitRoot, CONTEXT_RELATIVE, 'runtime project-context target is missing or unsafe');
const targetPath = regularCanonicalFile(toolkitRoot, TARGET_RELATIVE, 'collaboration entrypoint target is missing or unsafe');

let runtimeContext;
try { runtimeContext = require(contextPath); }
catch { fail('runtime project-context target could not be loaded'); }
if (!runtimeContext || typeof runtimeContext.verifyRuntimeConsumerInstallation !== 'function') {
  fail('runtime project-context verifier is unavailable');
}
const qualification = runtimeContext.verifyRuntimeConsumerInstallation(parsed.projectRoot, { verifyContent: true });
if (!qualification || qualification.ok !== true || qualification.toolkitRoot !== toolkitRoot
    || qualification.consumerRoot !== parsed.projectRoot) {
  fail(`runtime installation is not qualified${qualification && qualification.reason ? `: ${qualification.reason}` : ''}`);
}

const child = spawnSync(process.execPath, [targetPath, ...argv], {
  cwd: parsed.projectRoot,
  env: process.env,
  stdio: 'inherit',
});
if (child.error) fail(`collaboration entrypoint could not be launched: ${child.error.message}`);
if (child.status === null) fail('collaboration entrypoint terminated without an exit status');
process.exit(child.status);
