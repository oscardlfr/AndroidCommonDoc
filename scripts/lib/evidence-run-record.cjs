'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCHEMA = 'evidence-run/v1';
const TOKEN = /^[A-Za-z0-9._-]+$/;
const HEX64 = /^[0-9a-f]{64}$/;
const HEAD = /^[0-9a-f]{40}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const RECORD_KEYS = Object.freeze([
  'artifact_identity', 'artifact_sha256', 'complete', 'counts', 'environment_fingerprint', 'finished_at',
  'head', 'plan_sha256', 'producer', 'run_id', 'schema', 'scope', 'started_at',
  'target', 'target_sha256', 'tool_versions', 'verdict', 'wave_slug',
].sort());
const COUNT_KEYS = Object.freeze(['failed', 'total']);
function hash(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function canonicalRoot(root) { return fs.realpathSync(path.resolve(root)); }
function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected);
}
function stableReadArtifact(target, { root = '' } = {}) {
  const absolute = path.resolve(target);
  const canonicalTarget = fs.realpathSync(absolute);
  if (root) {
    const canonicalRootPath = canonicalRoot(root);
    const prefix = canonicalRootPath.endsWith(path.sep) ? canonicalRootPath : canonicalRootPath + path.sep;
    if (canonicalTarget !== canonicalRootPath && !canonicalTarget.startsWith(prefix)) throw new Error('ARTIFACT_OUTSIDE_ROOT');
  }
  const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY | noFollow);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size < 0n || before.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('UNSAFE_ARTIFACT');
    }
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const read = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (read === 0) break;
      offset += read;
    }
    const after = fs.fstatSync(fd, { bigint: true });
    const identityKeys = ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs'];
    if (offset !== bytes.length || identityKeys.some((key) => before[key] !== after[key])) throw new Error('ARTIFACT_IDENTITY_DRIFT');
    const identity = hash(Buffer.from(JSON.stringify({
      path: canonicalTarget,
      dev: before.dev.toString(),
      ino: before.ino.toString(),
    })));
    return { bytes, sha256: hash(bytes), identity };
  } finally { fs.closeSync(fd); }
}
function stableReadFile(target, options = {}) { return stableReadArtifact(target, options).bytes; }
function head(root) {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 5000 });
  const value = (r.stdout || '').trim();
  if (r.status !== 0 || !HEAD.test(value)) throw new Error('HEAD_UNAVAILABLE');
  return value;
}
function planBinding(root, waveSlug) {
  if (!waveSlug) return { wave_slug: 'none', plan_sha256: 'none' };
  if (!TOKEN.test(waveSlug)) throw new Error('INVALID_WAVE_SLUG');
  const plan = path.join(root, '.planning', 'wave-' + waveSlug, 'PLAN.md');
  if (!fs.existsSync(plan)) throw new Error('PLAN_MISSING');
  return { wave_slug: waveSlug, plan_sha256: hash(stableReadFile(plan, { root })) };
}
function start({ root, producer, target, targetDigest = '', scope = 'targeted', waveSlug = '', toolVersions = null }) {
  const canonical = canonicalRoot(root);
  if (!TOKEN.test(producer || '') || !['full', 'targeted'].includes(scope)) throw new Error('INVALID_RUN_IDENTITY');
  const binding = planBinding(canonical, waveSlug);
  const record = {
    schema: SCHEMA, run_id: new Date().toISOString().replace(/[-:.]/g, '') + '-' + process.pid + '-' + crypto.randomBytes(5).toString('hex'),
    producer, head: head(canonical), ...binding, target, scope,
    target_sha256: targetDigest || hash(Buffer.from(String(target), 'utf8')),
    environment_fingerprint: hash(Buffer.from(JSON.stringify({ platform: process.platform, arch: process.arch, release: os.release() }))),
    tool_versions: toolVersions || { node: process.version }, started_at: new Date().toISOString(),
    finished_at: null, complete: false, verdict: 'running', counts: null, artifact_sha256: null, artifact_identity: null,
  };
  validate(record, { allowRunning: true });
  return record;
}
function finish(record, { verdict, counts, artifact }) {
  validate(record, { allowRunning: true });
  if (record.complete !== false || record.verdict !== 'running' || record.finished_at !== null
    || record.counts !== null || record.artifact_sha256 !== null || record.artifact_identity !== null) throw new Error('EVIDENCE_RUN_ALREADY_FINALIZED');
  if (!['pass', 'fail'].includes(verdict)) throw new Error('INVALID_VERDICT');
  if (!exactKeys(counts, COUNT_KEYS) || !Number.isInteger(counts.total) || !Number.isInteger(counts.failed) || counts.total < 0 || counts.failed < 0 || counts.failed > counts.total) throw new Error('INVALID_COUNTS');
  if ((verdict === 'pass') !== (counts.failed === 0)) throw new Error('INCOHERENT_VERDICT_COUNTS');
  const retained = stableReadArtifact(artifact);
  return { ...record, finished_at: new Date().toISOString(), complete: true, verdict, counts,
    artifact_sha256: retained.sha256, artifact_identity: retained.identity };
}
function validate(record, { allowRunning = false } = {}) {
  if (!exactKeys(record, RECORD_KEYS) || record.schema !== SCHEMA || !TOKEN.test(record.run_id || '') || !TOKEN.test(record.producer || '')
    || !HEAD.test(record.head || '') || !['full', 'targeted'].includes(record.scope)
    || typeof record.target !== 'string' || !record.target.trim()
    || !TOKEN.test(record.wave_slug || '')
    || !(record.plan_sha256 === 'none' || HEX64.test(record.plan_sha256 || ''))
    || (record.wave_slug === 'none') !== (record.plan_sha256 === 'none')
    || !HEX64.test(record.target_sha256 || '') || !HEX64.test(record.environment_fingerprint || '')
    || !ISO_UTC.test(record.started_at || '')
    || !record.tool_versions || Array.isArray(record.tool_versions) || typeof record.tool_versions !== 'object'
    || Object.keys(record.tool_versions).length === 0
    || Object.entries(record.tool_versions).some(([key, value]) => !TOKEN.test(key) || typeof value !== 'string' || !value.trim())) {
    throw new Error('INVALID_EVIDENCE_RUN');
  }
  if (record.complete === true) {
    if (!exactKeys(record.counts, COUNT_KEYS) || !Number.isInteger(record.counts.total) || !Number.isInteger(record.counts.failed)
      || record.counts.total < 0 || record.counts.failed < 0 || record.counts.failed > record.counts.total
      || (record.verdict === 'pass') !== (record.counts.failed === 0)) throw new Error('INVALID_EVIDENCE_COUNTS');
  }
  if (!allowRunning && (record.complete !== true || !['pass', 'fail'].includes(record.verdict) || !record.finished_at
    || !HEX64.test(record.artifact_sha256 || '') || !HEX64.test(record.artifact_identity || ''))) throw new Error('INCOMPLETE_EVIDENCE_RUN');
  if (record.finished_at && !ISO_UTC.test(record.finished_at)) throw new Error('INVALID_EVIDENCE_RUN');
  if (record.finished_at && new Date(record.finished_at).getTime() < new Date(record.started_at).getTime()) {
    throw new Error('INVALID_EVIDENCE_TIME_ORDER');
  }
  return record;
}
function agreementKey(record) {
  validate(record);
  return hash(Buffer.from(JSON.stringify({
    producer: record.producer, head: record.head, wave_slug: record.wave_slug,
    plan_sha256: record.plan_sha256, target_sha256: record.target_sha256, scope: record.scope,
    environment_fingerprint: record.environment_fingerprint, tool_versions: record.tool_versions,
    verdict: record.verdict, counts: record.counts,
  })));
}
function requireAgreement(records, minimum = 2) {
  if (!Number.isInteger(minimum) || minimum < 1) throw new Error('INVALID_AGREEMENT_MINIMUM');
  const groups = new Map();
  for (const record of records) {
    const key = agreementKey(record);
    const group = groups.get(key) || [];
    if (!group.some((item) => item.run_id === record.run_id)) group.push(record);
    groups.set(key, group);
  }
  const matches = [...groups.values()].filter((group) => group.length >= minimum
    && new Set(group.map((item) => item.artifact_identity)).size >= minimum);
  if (matches.length !== 1) throw new Error(matches.length ? 'AMBIGUOUS_EVIDENCE_SET' : 'INSUFFICIENT_AGREEMENT');
  return matches[0];
}
module.exports = { SCHEMA, start, finish, validate, agreementKey, requireAgreement, stableReadFile, stableReadArtifact };
