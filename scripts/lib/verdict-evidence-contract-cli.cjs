'use strict';
const fs = require('fs');
const crypto = require('crypto');
const nodePath = require('path');
const contract = require('./verdict-evidence-contract.cjs');
const store = require('./verdict-artifact-store.cjs');
function sha256Hex(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function inferWaveDir(targetPath) {
  const absolute = nodePath.resolve(targetPath);
  const parsed = nodePath.parse(absolute);
  const parts = absolute.slice(parsed.root.length).split(nodePath.sep);
  const planning = parts.lastIndexOf('.planning');
  if (planning < 0 || !/^wave-[A-Za-z0-9._-]+$/.test(parts[planning + 1] || '')) {
    throw Object.assign(new Error('target is not inside a wave directory'), { detailCode: 'confinement-failed' });
  }
  return nodePath.join(parsed.root, ...parts.slice(0, planning + 2));
}
function validateVerdict({ path: verdictPath, expectRole, expectPhase, expectWaveSlug, expectPlanSha256, expectHead }) {
  const waveDir = inferWaveDir(verdictPath);
  let exists = false, wellFormed = false, roleBound = false, requestBound = false,
    headBound = false, planBound = false, evidenceValid = false, decision;
  try {
    const expectedName = `arch-${expectRole.replace(/^arch-/, '')}-verdict-${expectPhase}.json`;
    if (nodePath.dirname(nodePath.resolve(verdictPath)) !== waveDir || nodePath.basename(verdictPath) !== expectedName) {
      return contract.composeResult({ exists, wellFormed, roleBound, requestBound, headBound, planBound, evidenceValid, decision });
    }
    const { bytes } = store.readConfinedFile(waveDir, verdictPath);
    exists = true;
    const decoded = contract.decodeRecord(bytes);
    if (!decoded.ok) return contract.composeResult({ exists, wellFormed, roleBound, requestBound, headBound, planBound, evidenceValid, decision });
    const verdict = decoded.value;
    decision = verdict.decision;
    if (!contract.validateVerdictShape(verdict).ok) return contract.composeResult({ exists, wellFormed, roleBound, requestBound, headBound, planBound, evidenceValid, decision });
    const { bytes: reqBytes } = store.readConfinedFile(waveDir, verdict.request_ref.path);
    const reqDecoded = contract.decodeRecord(reqBytes);
    if (!reqDecoded.ok) return contract.composeResult({ exists, wellFormed, roleBound, requestBound, headBound, planBound, evidenceValid, decision });
    const request = reqDecoded.value;
    if (!contract.validateRequestShape(request).ok) return contract.composeResult({ exists, wellFormed, roleBound, requestBound, headBound, planBound, evidenceValid, decision });
    const subjectRead = store.readConfinedFile(waveDir, request.subject.path);
    const subjectValid = sha256Hex(subjectRead.bytes) === request.subject.sha256
      && (request.subject.kind !== 'plan' || request.subject.sha256 === expectPlanSha256);
    wellFormed = true;
    const requestDigestOk = verdict.request_ref.sha256 === sha256Hex(reqBytes);
    const requestLocationOk = verdict.request_ref.path === `verdict-requests/${verdict.in_reply_to}.json`;
    const subjectLocationOk = request.subject.path === (request.phase === 'prep'
      ? 'PLAN.md' : `source-manifests/${request.request_id}.json`);
    const headIsAncestor = verdict.phase === 'prep' && store.isAncestorCommit(verdict.head, expectHead, waveDir);
    const binding = contract.crossCheckBinding({
      request, verdict,
      expect: { role: expectRole, phase: expectPhase, waveSlug: expectWaveSlug, planSha256: expectPlanSha256, head: expectHead, headIsAncestor },
    });
    roleBound = binding.roleBound; headBound = binding.headBound; planBound = binding.planBound;
    requestBound = binding.requestBound && requestDigestOk && requestLocationOk && subjectLocationOk && subjectValid;
    evidenceValid = true;
    for (const entry of verdict.evidence) {
      try {
        const evRead = store.readConfinedFile(waveDir, entry.path);
        if (sha256Hex(evRead.bytes) !== entry.sha256) { evidenceValid = false; break; }
        if (entry.kind === 'json-record') {
          const evDecoded = contract.decodeRecord(evRead.bytes);
          if (!evDecoded.ok || evDecoded.value.schema !== entry.expected_schema) { evidenceValid = false; break; }
        }
      } catch (err) { evidenceValid = false; break; }
    }
  } catch (err) { /* exists/wellFormed already reflect how far this got; never crash */ }
  return contract.composeResult({ exists, wellFormed, roleBound, requestBound, headBound, planBound, evidenceValid, decision });
}
function readField({ path: verdictPath, field }) {
  const bytes = store.readConfinedFile(inferWaveDir(verdictPath), verdictPath).bytes;
  const decoded = contract.decodeRecord(bytes);
  if (!decoded.ok) throw Object.assign(new Error(decoded.reason), { rejected: true, detailCode: decoded.reason });
  const shapeResult = contract.validateVerdictShape(decoded.value);
  if (!shapeResult.ok) throw Object.assign(new Error(shapeResult.reason), { rejected: true, detailCode: shapeResult.reason });
  if (!(field in decoded.value)) throw Object.assign(new Error('unknown-field'), { rejected: true, detailCode: 'unknown-field' });
  return decoded.value[field];
}
function parseFlags(argv, booleanFlags) {
  const bset = new Set(booleanFlags || []);
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const name = argv[i].slice(2);
    if (bset.has(name)) { flags[name] = true; } else { flags[name] = argv[i + 1]; i += 1; }
  }
  return flags;
}
function rejectRecord(reason) {
  throw Object.assign(new Error(reason), { detailCode: 'invalid-record:' + reason });
}
function decodePublicationInput(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.includes(0x00)) return { ok: false, reason: 'invalid-encoding' };
  let normalized = bytes;
  if (normalized.length >= 2 && normalized[normalized.length - 2] === 0x0d && normalized[normalized.length - 1] === 0x0a) {
    if (normalized.subarray(0, normalized.length - 2).includes(0x0d)) return { ok: false, reason: 'invalid-encoding' };
    normalized = Buffer.concat([normalized.subarray(0, normalized.length - 2), Buffer.from('\n')]);
  } else if (normalized.includes(0x0d)) {
    return { ok: false, reason: 'invalid-encoding' };
  }
  if (normalized.length === 0 || normalized[normalized.length - 1] !== 0x0a) {
    normalized = Buffer.concat([normalized, Buffer.from('\n')]);
  }
  return contract.decodeRecord(normalized);
}
function verifySubjectBinding(waveDir, request) {
  const expectedPath = request.phase === 'prep'
    ? 'PLAN.md'
    : `source-manifests/${request.request_id}.json`;
  if (request.subject.path !== expectedPath) rejectRecord('subject-location-mismatch');
  let subjectBytes;
  try { subjectBytes = store.readConfinedFile(waveDir, request.subject.path).bytes; } catch (err) { rejectRecord('subject-unreadable'); }
  if (sha256Hex(subjectBytes) !== request.subject.sha256) rejectRecord('subject-digest-mismatch');
  if (request.phase === 'prep' && request.subject.sha256 !== request.plan_sha256) rejectRecord('plan-subject-mismatch');
}
function verifyVerdictPublicationBinding(waveDir, verdict) {
  const expectedRequestPath = `verdict-requests/${verdict.in_reply_to}.json`;
  if (verdict.request_ref.path !== expectedRequestPath) rejectRecord('request-location-mismatch');
  let requestBytes;
  try { requestBytes = store.readConfinedFile(waveDir, expectedRequestPath).bytes; } catch (err) { rejectRecord('request-unreadable'); }
  if (sha256Hex(requestBytes) !== verdict.request_ref.sha256) rejectRecord('request-digest-mismatch');
  const requestDecoded = contract.decodeRecord(requestBytes);
  if (!requestDecoded.ok || !contract.validateRequestShape(requestDecoded.value).ok) rejectRecord('request-invalid');
  const request = requestDecoded.value;
  if (request.request_id !== verdict.in_reply_to || request.role !== verdict.role
    || request.phase !== verdict.phase || request.wave_slug !== verdict.wave_slug
    || request.plan_sha256 !== verdict.plan_sha256 || request.head !== verdict.head
    || Date.parse(verdict.created_at) < Date.parse(request.created_at)) {
    rejectRecord('request-binding-mismatch');
  }
  verifySubjectBinding(waveDir, request);
  for (const entry of verdict.evidence) {
    let evidenceBytes;
    try { evidenceBytes = store.readConfinedFile(waveDir, entry.path).bytes; } catch (err) { rejectRecord('evidence-unreadable'); }
    if (sha256Hex(evidenceBytes) !== entry.sha256) rejectRecord('evidence-digest-mismatch');
    if (entry.kind === 'json-record') {
      const evidenceDecoded = contract.decodeRecord(evidenceBytes);
      if (!evidenceDecoded.ok || evidenceDecoded.value.schema !== entry.expected_schema) rejectRecord('evidence-schema-mismatch');
    }
  }
}
function publishRecord({ kind, path: targetPath, bytes, supersede, expectedCurrentSha256 }) {
  const decoded = decodePublicationInput(bytes);
  if (!decoded.ok) throw Object.assign(new Error(decoded.reason), { detailCode: 'invalid-record:' + decoded.reason });
  if (kind === 'request' || kind === 'verdict') {
    const shapeResult = kind === 'request' ? contract.validateRequestShape(decoded.value) : contract.validateVerdictShape(decoded.value);
    if (!shapeResult.ok) throw Object.assign(new Error(shapeResult.reason), { detailCode: 'invalid-record:' + shapeResult.reason });
  }
  const waveDir = inferWaveDir(targetPath);
  if (kind === 'request') {
    const expected = nodePath.join(waveDir, 'verdict-requests', decoded.value.request_id + '.json');
    if (nodePath.resolve(targetPath) !== expected || decoded.value.wave_slug !== nodePath.basename(waveDir).slice('wave-'.length)) {
      throw Object.assign(new Error('request target is not canonical'), { detailCode: 'invalid-record:noncanonical-target' });
    }
    verifySubjectBinding(waveDir, decoded.value);
  }
  if (kind === 'verdict') {
    const expected = nodePath.join(waveDir, `${decoded.value.role}-verdict-${decoded.value.phase}.json`);
    if (nodePath.resolve(targetPath) !== expected || decoded.value.wave_slug !== nodePath.basename(waveDir).slice('wave-'.length)) {
      throw Object.assign(new Error('verdict target is not canonical'), { detailCode: 'invalid-record:noncanonical-target' });
    }
    verifyVerdictPublicationBinding(waveDir, decoded.value);
  }
  if (kind === 'request' && supersede) {
    throw Object.assign(new Error('requests are immutable'), { detailCode: 'invalid-record:immutable-request' });
  }
  if (kind === 'verdict') {
    if (!supersede && decoded.value.supersedes !== null) {
      throw Object.assign(new Error('first publication cannot supersede'), { detailCode: 'invalid-record:unexpected-supersedes' });
    }
    if (supersede) {
      if (!decoded.value.supersedes || decoded.value.supersedes.sha256 !== expectedCurrentSha256) {
        throw Object.assign(new Error('supersedes digest mismatch'), { detailCode: 'invalid-record:supersedes-mismatch' });
      }
      const currentBytes = store.readConfinedFile(inferWaveDir(targetPath), targetPath).bytes;
      const current = contract.decodeRecord(currentBytes);
      if (!current.ok || !contract.validateVerdictShape(current.value).ok) {
        throw Object.assign(new Error('current verdict is invalid'), { detailCode: 'invalid-record:current-verdict-invalid' });
      }
      if (current.value.role !== decoded.value.role || current.value.phase !== decoded.value.phase
        || current.value.wave_slug !== decoded.value.wave_slug || current.value.plan_sha256 !== decoded.value.plan_sha256) {
        throw Object.assign(new Error('superseded verdict binding mismatch'), { detailCode: 'invalid-record:superseded-binding-mismatch' });
      }
      if (contract.verdictsShareReplayedRequest(current.value, decoded.value)) {
        throw Object.assign(new Error('request replay'), { detailCode: 'invalid-record:replayed-request' });
      }
    }
  }
  // Always publish canonical bytes rather than the producer's transport encoding.
  const canonicalBytes = contract.serializeRecord(decoded.value);
  if (supersede) {
    store.publishSupersede(waveDir, targetPath, canonicalBytes, expectedCurrentSha256);
  } else {
    store.publishNoClobber(waveDir, targetPath, canonicalBytes);
  }
}
function writeJson(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function requireFlags(flags, names) {
  for (const name of names) {
    if (typeof flags[name] !== 'string' || flags[name].length === 0) {
      writeJson({ status: 'USAGE_ERROR', detail_code: 'MISSING_ARGUMENT', flag: name });
      process.exit(2);
    }
  }
}
function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const flags = parseFlags(argv.slice(1), ['supersede']);
  if (command === 'publish-record') {
    requireFlags(flags, ['path']);
    if (flags.supersede === true) requireFlags(flags, ['expected-current-sha256']);
    try {
      const bytes = fs.readFileSync(0);
      publishRecord({
        kind: flags.kind, path: flags.path, bytes,
        supersede: flags.supersede === true, expectedCurrentSha256: flags['expected-current-sha256'],
      });
      writeJson({ status: 'OK' });
      process.exit(0);
    } catch (err) {
      writeJson({ status: 'REJECTED', detail_code: (err && (err.detailCode || err.reasonCode)) || 'INTERNAL_ERROR' });
      process.exit(2);
    }
  } else if (command === 'validate') {
    requireFlags(flags, ['path', 'expect-role', 'expect-phase', 'expect-wave-slug', 'expect-plan-sha256', 'expect-head']);
    const result = validateVerdict({
      path: flags.path, expectRole: flags['expect-role'], expectPhase: flags['expect-phase'],
      expectWaveSlug: flags['expect-wave-slug'], expectPlanSha256: flags['expect-plan-sha256'], expectHead: flags['expect-head'],
    });
    writeJson(result);
    process.exit(0);
  } else if (command === 'read-field') {
    requireFlags(flags, ['path', 'field']);
    try {
      const value = readField({ path: flags.path, field: flags.field });
      writeJson({ status: 'OK', field: flags.field, value });
      process.exit(0);
    } catch (err) {
      writeJson({ status: 'REJECTED', detail_code: (err && err.detailCode) || 'INTERNAL_ERROR' });
      process.exit(2);
    }
  } else {
    writeJson({ status: 'USAGE_ERROR', detail_code: 'UNKNOWN_COMMAND' });
    process.exit(2);
  }
}
if (require.main === module) main();
module.exports = { validateVerdict, readField, publishRecord };
