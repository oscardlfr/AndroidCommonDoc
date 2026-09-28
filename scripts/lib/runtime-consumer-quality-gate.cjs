#!/usr/bin/env node
'use strict';

// Portable L1/L2 quality-gate receipt. It deliberately does not run or copy the
// L0 Bats harness. The consumer's own /pre-pr pipeline is the validation
// authority; this adapter binds its PASS receipt to the current HEAD and active
// wave so the shared control plane can verify QG -> COMPLETE.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const MAX_AGE_MS = 30 * 60 * 1000;

function die(reason) {
  process.stderr.write(`[runtime-consumer-qg] ${reason}\n`);
  process.exit(2);
}

function canonicalDirectory(value) {
  if (!value || !path.isAbsolute(value)) die('project-root-invalid');
  try {
    const expected = path.resolve(value);
    const info = fs.lstatSync(expected);
    const canonical = fs.realpathSync(expected);
    const darwinAlias = process.platform === 'darwin'
      && expected.startsWith('/var/') && canonical === `/private${expected}`;
    if (!info.isDirectory() || info.isSymbolicLink() || (canonical !== expected && !darwinAlias)) {
      die('project-root-unsafe');
    }
    return canonical;
  } catch { die('project-root-unresolved'); }
}

function confined(root, relative) {
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) die('path-invalid');
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) die('path-escape');
  let cursor = root;
  for (const segment of relative.split(/[\\/]/).slice(0, -1)) {
    if (!segment || segment === '.') continue;
    cursor = path.join(cursor, segment);
    try {
      const info = fs.lstatSync(cursor);
      if (!info.isDirectory() || info.isSymbolicLink() || fs.realpathSync(cursor) !== cursor) {
        die('path-ancestor-unsafe');
      }
    } catch (error) {
      if (error && error.code === 'ENOENT') break;
      throw error;
    }
  }
  return target;
}

function readRegularJson(root, relative, reason) {
  const target = confined(root, relative);
  try {
    const info = fs.lstatSync(target);
    if (!info.isFile() || info.isSymbolicLink() || fs.realpathSync(target) !== target) die(reason);
    return { bytes: fs.readFileSync(target), value: JSON.parse(fs.readFileSync(target, 'utf8')) };
  } catch { die(reason); }
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function git(root, args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { die('git-state-unavailable'); }
}

function currentHead(root) {
  const head = git(root, ['rev-parse', 'HEAD']);
  if (!/^[0-9a-f]{40}$/.test(head)) die('head-invalid');
  return head;
}

function validateSlug(slug) {
  if (!slug || !/^[A-Za-z0-9._-]+$/.test(slug) || slug === '.' || slug === '..') die('wave-slug-invalid');
  return slug;
}

function validateTimestamp(value, reason) {
  const parsed = Date.parse(value);
  const now = Date.now();
  if (!Number.isFinite(parsed) || parsed > now + 120000 || now - parsed > MAX_AGE_MS) die(reason);
}

function validateInputs(root, slug, expectedPhase) {
  const head = currentHead(root);
  const prePr = readRegularJson(root, '.androidcommondoc/pre-pr.stamp', 'pre-pr-stamp-invalid');
  if (prePr.value.verdict !== 'PASS' || prePr.value.head !== head) die('pre-pr-stamp-not-current');
  validateTimestamp(prePr.value.timestamp, 'pre-pr-stamp-stale');

  const state = readRegularJson(root, `.androidcommondoc/wave-control/${slug}.json`, 'wave-state-invalid');
  if (!expectedPhase.includes(state.value.phase) || state.value.head !== head
      || typeof state.value.plan_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(state.value.plan_sha256)) {
    die('wave-state-not-current');
  }
  return { head, prePr, state };
}

function atomicWriteJson(root, relative, value) {
  let target = confined(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // Revalidate after directory creation so an existing symlink ancestor can
  // never turn a consumer-relative artifact into an external write.
  target = confined(root, relative);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, target);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch { /* nothing to clean */ }
    throw error;
  }
}

function mint(root, slug) {
  const dirty = git(root, ['status', '--porcelain', '--untracked-files=no']);
  if (dirty) die('tracked-worktree-not-clean');
  const { head, prePr, state } = validateInputs(root, slug, ['QG']);
  const generatedAt = new Date().toISOString();
  const proof = {
    schema_version: 1,
    kind: 'runtime-consumer-qg/v1',
    verdict: 'PASS',
    head,
    wave_slug: slug,
    plan_sha256: state.value.plan_sha256,
    pre_pr_sha256: sha256(prePr.bytes),
    generated_at: generatedAt,
  };
  const stamp = { verdict: 'PASS', timestamp: generatedAt, head, wave_slug: slug };
  const qgResult = {
    schema_version: 1, status: 'pass', head, wave_slug: slug,
    started_at: generatedAt, updated_at: generatedAt,
    steps: [{ step: 'project-pre-pr', ran: true, result: 'PASS', reason: 'consumer project gate' }],
  };
  try {
    atomicWriteJson(root, '.androidcommondoc/quality-gate.stamp', stamp);
    atomicWriteJson(root, `.planning/wave-${slug}/qg-result.json`, qgResult);
    // Proof is the commit marker and is always published last.
    atomicWriteJson(root, '.androidcommondoc/push-proof.json', proof);
  } catch { die('artifact-publication-failed'); }
  process.stdout.write(`RUNTIME_CONSUMER_QG_MINTED ${head}\n`);
}

function verify(root, slug, requestedHead) {
  const { head, prePr, state } = validateInputs(root, slug, ['QG', 'COMPLETE']);
  if (requestedHead && requestedHead !== head) die('requested-head-mismatch');
  const stamp = readRegularJson(root, '.androidcommondoc/quality-gate.stamp', 'quality-gate-stamp-invalid').value;
  const proof = readRegularJson(root, '.androidcommondoc/push-proof.json', 'push-proof-invalid').value;
  if (stamp.verdict !== 'PASS' || stamp.head !== head || stamp.wave_slug !== slug) die('quality-gate-stamp-not-current');
  validateTimestamp(stamp.timestamp, 'quality-gate-stamp-stale');
  if (proof.kind !== 'runtime-consumer-qg/v1' || proof.verdict !== 'PASS' || proof.head !== head
      || proof.wave_slug !== slug || proof.plan_sha256 !== state.value.plan_sha256
      || proof.pre_pr_sha256 !== sha256(prePr.bytes)) die('push-proof-not-current');
  validateTimestamp(proof.generated_at, 'push-proof-stale');
  process.stdout.write(`RUNTIME_CONSUMER_QG_VERIFIED ${head}\n`);
}

const argv = process.argv.slice(2);
if (argv.length < 3) die('usage: <project-root> <mint|verify> --slug <slug> [--head <sha>]');
const root = canonicalDirectory(path.resolve(argv[0]));
const mode = argv[1];
let slug;
let requestedHead;
for (let index = 2; index < argv.length; index += 1) {
  if (argv[index] === '--slug' && argv[index + 1]) { slug = validateSlug(argv[++index]); continue; }
  if (argv[index] === '--head' && argv[index + 1]) { requestedHead = argv[++index]; continue; }
  die(`unknown-argument:${argv[index]}`);
}
if (!slug) die('wave-slug-required');
if (requestedHead && !/^[0-9a-f]{40}$/.test(requestedHead)) die('requested-head-invalid');
if (mode === 'mint') mint(root, slug);
else if (mode === 'verify') verify(root, slug, requestedHead);
else die('mode-invalid');
