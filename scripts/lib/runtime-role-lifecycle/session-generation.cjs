'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function createSessionGenerationModule({
  canonicalJSONStringify,
  hasExactKeys,
  isHexCsprng32,
  isTestCapability,
  readRegistryRecord,
  registryRepoDir,
  sha256String,
  withRegistryLock,
  writeRegistryRecordReplace,
}) {
  const IDENTITY_PROVIDER_ENUM = Object.freeze(['claude-hook', 'codex-supervisor']);
  const MAX_RUNTIME_SESSION_KEY_BYTES = 512;
  const SESSION_GENERATION_TTL_SECONDS = 3600;
  const SESSION_GENERATION_KEYS = Object.freeze([
    'created_at', 'expires_at', 'generation_id', 'provider', 'runtime_session_key', 'schema',
  ]);
  const CANONICAL_ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
  const SESSION_GENERATION_SCAN_CAP = 1024;
  const EXPIRY_UNDERSHOOT_SAFETY_MARGIN_MS = 200;

  function getRuntimeIdentity() {
    if (!isTestCapability()) return { ok: false };
    const raw = process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_IDENTITY;
    if (typeof raw !== 'string' || raw.length === 0) return { ok: false };
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return { ok: false };
    }
    if (
      parsed && parsed.ok === true
      && IDENTITY_PROVIDER_ENUM.includes(parsed.provider)
      && typeof parsed.runtime_session_key === 'string'
      && parsed.runtime_session_key.length > 0
      && Buffer.byteLength(parsed.runtime_session_key, 'utf8') <= MAX_RUNTIME_SESSION_KEY_BYTES
    ) {
      return { ok: true, provider: parsed.provider, runtime_session_key: parsed.runtime_session_key };
    }
    return { ok: false };
  }

  function sessionLookupKey(identity) {
    return sha256String('wp3-session-generation-v1:' + identity.provider + ':' + identity.runtime_session_key);
  }

  function sessionGenerationPathFor(projectRoot, identity) {
    return path.join(registryRepoDir(projectRoot), 'sessions', sessionLookupKey(identity) + '.json');
  }

  function isCanonicalIsoUtc(value) {
    if (typeof value !== 'string' || !CANONICAL_ISO_UTC_RE.test(value)) return false;
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return false;
    const roundTripped = new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
    return roundTripped === value;
  }

  function currentClockMsForRegistry() {
    if (isTestCapability()) {
      const fixed = process.env.RUNTIME_ROLE_LIFECYCLE_FIXED_NOW_MS;
      if (typeof fixed === 'string' && /^(0|[1-9][0-9]{0,15})$/.test(fixed)) {
        const parsed = Number(fixed);
        if (Number.isSafeInteger(parsed)) return parsed;
      }
    }
    return Date.now();
  }

  function nowIsoForRegistry() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  function isoToMsForRegistry(iso) {
    return Date.parse(iso);
  }

  function isoPlusSecondsForRegistry(iso, seconds) {
    return new Date(Date.parse(iso) + seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  function safeExpiryIsoForRegistry(targetMs) {
    const flooredMs = Math.floor(targetMs / 1000) * 1000;
    const flooredIso = new Date(flooredMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
    if (flooredMs - currentClockMsForRegistry() < EXPIRY_UNDERSHOOT_SAFETY_MARGIN_MS) {
      return isoPlusSecondsForRegistry(flooredIso, 1);
    }
    return flooredIso;
  }

  function futureIsoForRegistry(ttlSeconds) {
    return safeExpiryIsoForRegistry(currentClockMsForRegistry() + ttlSeconds * 1000);
  }

  function peekSessionGeneration(projectRoot, identity) {
    const recordPath = sessionGenerationPathFor(projectRoot, identity);
    const existing = readRegistryRecord(recordPath);
    if (!existing.ok) return { ok: false, reason: existing.reason };
    if (existing.absent) return { ok: false, reason: 'session-generation-absent' };
    const rec = existing.obj;
    if (
      !rec || !hasExactKeys(rec, SESSION_GENERATION_KEYS)
      || rec.schema !== 'runtime/session-generation/v1'
      || rec.provider !== identity.provider || rec.runtime_session_key !== identity.runtime_session_key
      || !isHexCsprng32(rec.generation_id)
      || !isCanonicalIsoUtc(rec.expires_at) || !isCanonicalIsoUtc(rec.created_at)
    ) {
      return { ok: false, reason: 'session-generation-shape-invalid' };
    }
    const createdAtMs = Date.parse(rec.created_at);
    const expiresAtMs = Date.parse(rec.expires_at);
    if (createdAtMs > expiresAtMs || createdAtMs > currentClockMsForRegistry()) {
      return { ok: false, reason: 'session-generation-shape-invalid' };
    }
    if (currentClockMsForRegistry() >= expiresAtMs) {
      return { ok: false, reason: 'session-generation-expired' };
    }
    return { ok: true, generationId: rec.generation_id, expiresAt: rec.expires_at };
  }

  function readLiveSessionGenerationById(projectRootOrRepoDescriptor, generationId) {
    if (!isHexCsprng32(generationId)) {
      return { ok: false, reason: 'session-generation-id-invalid' };
    }
    const sessionsDir = path.join(registryRepoDir(projectRootOrRepoDescriptor), 'sessions');
    let entries;
    try {
      entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
    } catch (err) {
      return { ok: false, reason: 'session-generation-registry-unavailable' };
    }
    if (entries.length > SESSION_GENERATION_SCAN_CAP) {
      return { ok: false, reason: 'session-generation-registry-overflow' };
    }
    const matches = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith('.') || !entry.name.endsWith('.json')) continue;
      const candidatePath = path.join(sessionsDir, entry.name);
      const read = readRegistryRecord(candidatePath);
      if (!read.ok || read.absent || !read.obj) {
        return { ok: false, reason: 'session-generation-registry-malformed' };
      }
      const rec = read.obj;
      if (
        !hasExactKeys(rec, SESSION_GENERATION_KEYS)
        || rec.schema !== 'runtime/session-generation/v1'
        || !IDENTITY_PROVIDER_ENUM.includes(rec.provider)
        || typeof rec.runtime_session_key !== 'string' || rec.runtime_session_key.length === 0
        || !isHexCsprng32(rec.generation_id)
        || !isCanonicalIsoUtc(rec.created_at) || !isCanonicalIsoUtc(rec.expires_at)
        || sessionGenerationPathFor(projectRootOrRepoDescriptor, {
          provider: rec.provider, runtime_session_key: rec.runtime_session_key,
        }) !== candidatePath
      ) return { ok: false, reason: 'session-generation-registry-malformed' };
      const createdAtMs = isoToMsForRegistry(rec.created_at);
      const expiresAtMs = isoToMsForRegistry(rec.expires_at);
      if (createdAtMs > expiresAtMs || createdAtMs > currentClockMsForRegistry()) {
        return { ok: false, reason: 'session-generation-registry-malformed' };
      }
      if (rec.generation_id === generationId) matches.push(rec);
    }
    if (matches.length === 0) return { ok: false, reason: 'session-generation-absent' };
    if (matches.length !== 1) return { ok: false, reason: 'session-generation-ambiguous' };
    if (currentClockMsForRegistry() >= isoToMsForRegistry(matches[0].expires_at)) {
      return { ok: false, reason: 'session-generation-expired' };
    }
    return { ok: true, record: matches[0], expiresAt: matches[0].expires_at };
  }

  function resolveSessionGeneration(projectRoot, identity) {
    const recordPath = sessionGenerationPathFor(projectRoot, identity);
    const lockDir = recordPath + '.lock';
    const result = withRegistryLock(lockDir, () => {
      const existing = readRegistryRecord(recordPath);
      const nowMs = currentClockMsForRegistry();
      if (existing.ok && !existing.absent) {
        const rec = existing.obj;
        if (
          rec && hasExactKeys(rec, SESSION_GENERATION_KEYS)
          && rec.schema === 'runtime/session-generation/v1'
          && rec.provider === identity.provider
          && rec.runtime_session_key === identity.runtime_session_key
          && typeof rec.generation_id === 'string'
          && typeof rec.expires_at === 'string'
          && nowMs < isoToMsForRegistry(rec.expires_at)
        ) {
          return { ok: true, generationId: rec.generation_id, expiresAt: rec.expires_at };
        }
      } else if (!existing.ok) {
        return { ok: false, reason: existing.reason };
      }
      const generationId = crypto.randomBytes(16).toString('hex');
      const nowStr = nowIsoForRegistry();
      const record = {
        schema: 'runtime/session-generation/v1',
        provider: identity.provider,
        runtime_session_key: identity.runtime_session_key,
        generation_id: generationId,
        created_at: nowStr,
        expires_at: isoPlusSecondsForRegistry(nowStr, SESSION_GENERATION_TTL_SECONDS),
      };
      const writeResult = writeRegistryRecordReplace(
        recordPath,
        Buffer.from(canonicalJSONStringify(record), 'utf8'),
      );
      if (!writeResult.ok) return { ok: false, reason: writeResult.reason };
      return { ok: true, generationId, expiresAt: record.expires_at };
    });
    if (!result.ok) return { ok: false, reason: result.reason };
    return result.value;
  }

  return Object.freeze({
    IDENTITY_PROVIDER_ENUM,
    MAX_RUNTIME_SESSION_KEY_BYTES,
    SESSION_GENERATION_KEYS,
    currentClockMsForRegistry,
    futureIsoForRegistry,
    getRuntimeIdentity,
    isCanonicalIsoUtc,
    isoPlusSecondsForRegistry,
    isoToMsForRegistry,
    nowIsoForRegistry,
    peekSessionGeneration,
    readLiveSessionGenerationById,
    resolveSessionGeneration,
    safeExpiryIsoForRegistry,
    sessionGenerationPathFor,
    sessionLookupKey,
  });
}

module.exports = { createSessionGenerationModule };
