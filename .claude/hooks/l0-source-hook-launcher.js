#!/usr/bin/env node
'use strict';

// Portable downstream launcher for hooks whose implementation depends on the
// complete L0 checkout. The consumer stores only this standalone file; the L0
// source is resolved from l0-manifest.json on every invocation so settings do
// not embed a developer-specific Node path or toolkit checkout path.

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const LAUNCHER_NAME = path.basename(__filename);
const ALLOWED_HOOKS = new Set([
  'agent-spawn-execution-gate.js',
  'architect-verdict-presence-gate.js',
  'bash-cli-spawn-gate.js',
  'context-provider-gate.js',
  'context-provider-write-gate.js',
  'premature-execution-gate.js',
  'plan-md-write-gate.js',
  'push-authorization-gate.js',
  'runtime-consultation-target-gate.js',
  'runtime-host-boundary.js',
  'runtime-host-session-start.js',
  'subagent-start-context-bundle.js',
  'tool-use-logger.js',
  'wave-phase-gate.js',
]);

function fail(reason) {
  process.stderr.write(`[l0-source-hook-launcher] ${reason}\n`);
  process.exit(1);
}

function resolutionBases(projectRoot) {
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
    // A non-Git consumer can still resolve a manifest-relative source.
  }
  return [...new Set(bases)];
}

function resolveToolkit(projectRoot) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'l0-manifest.json'), 'utf8'));
  } catch {
    fail('l0-manifest.json is missing or malformed');
  }
  if (!manifest || manifest.version !== 2 || !Array.isArray(manifest.sources)) {
    fail('l0-manifest.json does not satisfy manifest v2');
  }
  const sources = manifest.sources.filter((source) =>
    source && source.layer === 'L0' && source.role === 'tooling');
  if (sources.length !== 1 || typeof sources[0].path !== 'string' || sources[0].path.length === 0 ||
      Object.prototype.hasOwnProperty.call(sources[0], 'remote')) {
    fail('manifest must declare exactly one local L0 tooling source');
  }

  const candidates = new Set();
  for (const base of resolutionBases(projectRoot)) {
    try {
      const declaredSource = path.resolve(base, sources[0].path);
      if (fs.lstatSync(declaredSource).isSymbolicLink()) continue;
      const candidate = fs.realpathSync(declaredSource);
      const registry = fs.lstatSync(path.join(candidate, 'skills', 'registry.json'));
      if (registry.isFile() && !registry.isSymbolicLink()) candidates.add(candidate);
    } catch {
      // Try the next repository-owned resolution base.
    }
  }
  if (candidates.size !== 1) {
    fail(candidates.size === 0 ? 'L0 tooling source is unresolved' : 'L0 tooling source is ambiguous');
  }
  return [...candidates][0];
}

const hook = process.argv[2];
if (process.argv.length !== 3 || !ALLOWED_HOOKS.has(hook) || hook === LAUNCHER_NAME) {
  fail('expected one supported L0 hook basename');
}

const projectRootAsGiven = process.env.CLAUDE_PROJECT_DIR || process.cwd();
let projectRoot;
try {
  projectRoot = fs.realpathSync(projectRootAsGiven);
  if (!fs.statSync(projectRoot).isDirectory()) fail('consumer project root is not a directory');
} catch {
  fail('consumer project root is unresolved');
}

const toolkitRoot = resolveToolkit(projectRootAsGiven);
const expectedTarget = path.join(toolkitRoot, '.claude', 'hooks', hook);
let target;
try {
  const targetInfo = fs.lstatSync(expectedTarget);
  if (!targetInfo.isFile() || targetInfo.isSymbolicLink()) fail('L0 hook target is not a regular file');
  target = fs.realpathSync(expectedTarget);
  if (target !== expectedTarget) fail('L0 hook target escapes the canonical toolkit');
} catch {
  fail('L0 hook target is missing or unsafe');
}

let input;
try {
  input = fs.readFileSync(0);
} catch {
  fail('hook input could not be read');
}

const result = spawnSync(process.execPath, [target], {
  cwd: projectRoot,
  env: process.env,
  input,
  stdio: ['pipe', 'inherit', 'inherit'],
});
if (result.error) fail(`L0 hook could not be launched: ${result.error.message}`);
if (result.status === null) fail('L0 hook terminated without an exit status');
process.exit(result.status);
