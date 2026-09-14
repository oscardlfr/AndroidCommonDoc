'use strict';

function createClaudeAuthorityClassifier(deps) {
  const {
    fs, path, Buffer, CANONICAL_ROLES, CLAUDE_AUTHORITY_IDENTITY_SCHEMA, CLAUDE_ONE_SHOT_BINDING_KEYS, CLAUDE_ONE_SHOT_BINDING_KEYS_V2, CLAUDE_ONE_SHOT_BINDING_SCHEMA,
    CLAUDE_ONE_SHOT_BINDING_SCHEMA_V2, IDENTITY_PROVIDER_ENUM, REQUESTER_BINDING_KEYS, REQUESTER_BINDING_KEYS_V2, REQUESTER_BINDING_SCHEMA, REQUESTER_BINDING_SCHEMA_V2, ROOT_SOURCE_BINDING_KEYS,
    ROOT_SOURCE_BINDING_KEYS_V2, ROOT_SOURCE_BINDING_SCHEMA, ROOT_SOURCE_BINDING_SCHEMA_V2, canonicalJSONStringify, claudeOneShotBindingPathFor, currentClockMsForRegistry, hasExactKeys,
    isCanonicalIsoUtc, isHexActionId, isHexCsprng32, isHexDigest64, isoToMsForRegistry, readClaudeAuthorityFence, readRegistryRecord, registryRepoDir, requesterBindingPathFor,
    rootSourceBindingPathFor, sha256String, validateClaudeOneShotBindingFor, validateRequesterBindingFor, validateRootSourceBindingFor,
  } = deps;

const CLAUDE_AUTHORITY_IDENTITY_KEYS = Object.freeze(['agent_id', 'provider', 'repo_id', 'runtime_session_key', 'schema'].sort());
const CLAUDE_AUTHORITY_SCAN_CAP = 1024;
const CLAUDE_AUTHORITY_PRIMARY_NAME_RE = /^[0-9a-f]{32}\.json$/;
const CLAUDE_AUTHORITY_ROOT_SOURCE_SIDECAR_RE = /^[0-9a-f]{32}\.(ingress|retired)\.json$/;
const CLAUDE_AUTHORITY_ONE_SHOT_SIDECAR_RE = /^[0-9a-f]{32}\.retired$/;

function isWellFormedClaudeAuthorityIdentity(identity) {
  return !!identity && typeof identity === 'object' && hasExactKeys(identity, CLAUDE_AUTHORITY_IDENTITY_KEYS)
    && identity.schema === CLAUDE_AUTHORITY_IDENTITY_SCHEMA
    // M7 GREEN section 4.5 (R12-1): the Claude authority-cut domain is
    // claude-hook-only (M7 section 3.1) -- the SHARED IDENTITY_PROVIDER_ENUM
    // also admits codex-supervisor (a valid RequesterBinding provider, but
    // never a Claude-authority-fence identity); an exact literal match keeps
    // that provider entirely out of this domain instead of merely failing
    // to classify anything for it.
    && identity.provider === 'claude-hook'
    && isHexDigest64(identity.repo_id)
    && typeof identity.runtime_session_key === 'string' && identity.runtime_session_key.length > 0 && Buffer.byteLength(identity.runtime_session_key, 'utf8') <= 512
    && typeof identity.agent_id === 'string' && identity.agent_id.length > 0 && Buffer.byteLength(identity.agent_id, 'utf8') <= 512;
}

/**
 * Scans one binding family's registry directory for candidates matching
 * `observedIdentity` exactly by session+agent (M7 section 6: "a current
 * unexpired v2 record... is a candidate even when its PLAN/worktree/role
 * differs, so scope rotation cannot hide it"). `perEntry(bindingId)` returns
 * `{state:'candidate',binding}|{state:'legacy'|'stale'|'absent'}|{state:'error',reason}`.
 * `sidecarRe` (when supplied) matches KNOWN non-primary filenames that are
 * silently skipped -- never a candidate, never "unknown"; anything else
 * un-recognized (wrong name shape, non-regular entry) fails closed.
 * @returns {{ok:true,candidates:Array<{family:string,binding:object}>,legacyCount:number,staleCount:number}|{ok:false,reason:string}}
 */
function scanClaudeAuthorityFamily(repoDescriptor, dirName, family, perEntry, sidecarRe) {
  const dir = path.join(registryRepoDir(repoDescriptor), dirName);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, candidates: [], legacyCount: 0, staleCount: 0 };
    return { ok: false, reason: 'authority-scan-failed' };
  }
  if (entries.length > CLAUDE_AUTHORITY_SCAN_CAP) return { ok: false, reason: 'authority-scan-cap-exceeded' };
  const candidates = [];
  let legacyCount = 0;
  let staleCount = 0;
  for (const entry of entries) {
    // M7 GREEN section 4.5 (R12-2): entry.isFile() is checked FIRST, for
    // EVERY entry -- a symlink (or any non-regular entry) whose NAME merely
    // matches a known sidecar pattern must still be rejected as unsafe,
    // never silently skipped before ever reaching this safety check.
    if (!entry.isFile()) return { ok: false, reason: 'authority-entry-unsafe' };
    if (sidecarRe && sidecarRe.test(entry.name)) continue; // known sidecar (already proven a regular file), never a candidate.
    if (!CLAUDE_AUTHORITY_PRIMARY_NAME_RE.test(entry.name)) {
      return { ok: false, reason: 'authority-entry-unsafe' };
    }
    const bindingId = entry.name.slice(0, -'.json'.length);
    const result = perEntry(bindingId);
    if (result.state === 'candidate') { candidates.push({ family, binding: result.binding }); continue; }
    if (result.state === 'legacy') { legacyCount += 1; continue; }
    if (result.state === 'stale') { staleCount += 1; continue; }
    if (result.state === 'absent') continue; // benign race: gone between readdir and read.
    return { ok: false, reason: result.reason || 'authority-record-malformed' };
  }
  return { ok: true, candidates, legacyCount, staleCount };
}

/**
 * M7 section 6: the one canonical cross-family classifier. Checks the fence
 * first; otherwise boundedly scans every Claude-actor binding family for a
 * candidate matching `observedIdentity` exactly (session+agent).
 * @param {string|{repoId:string}} repoDescriptor
 * @param {object} observedIdentity - the exact closed section-3.1 shape.
 * @returns {{ok:true,state:'ABSENT',identity:object,legacy_count:number,stale_count:number}
 *          |{ok:true,state:'ONE',identity:object,family:string,binding:object,legacy_count:number,stale_count:number}
 *          |{ok:true,state:'FENCED',identity:object,fence:object}
 *          |{ok:false,reason:string}}
 */
function classifyClaudeAuthorityForIdentity(repoDescriptor, observedIdentity) {
  if (!isWellFormedClaudeAuthorityIdentity(observedIdentity)) return { ok: false, reason: 'authority-fence-invalid' };
  const authorityIdentityId = sha256String(canonicalJSONStringify(observedIdentity));
  const fenceRead = readClaudeAuthorityFence(repoDescriptor, authorityIdentityId);
  if (!fenceRead.ok) return fenceRead;
  if (!fenceRead.absent) return { ok: true, state: 'FENCED', identity: observedIdentity, fence: fenceRead.fence };

  const sessionId = observedIdentity.runtime_session_key;
  const agentId = observedIdentity.agent_id;

  const requesterScan = scanClaudeAuthorityFamily(repoDescriptor, 'requester-bindings', 'requester', (bindingId) => {
    const read = readRegistryRecord(requesterBindingPathFor(repoDescriptor, bindingId));
    if (!read.ok) return { state: 'error', reason: 'authority-record-unreadable' };
    if (read.absent) return { state: 'absent' };
    const obj = read.obj;
    if (obj && hasExactKeys(obj, REQUESTER_BINDING_KEYS) && obj.schema === REQUESTER_BINDING_SCHEMA) {
      // M7 CORRECTION C6 (Codex final ruling): only a FULLY well-formed v1
      // record may become LEGACY_STALE -- values/timestamps/path-content
      // binding ID are all checked; anything else is
      // authority-record-malformed, never silently absorbed as routine
      // legacy.
      if (
        obj.binding_id === bindingId && isHexActionId(obj.actor_instance_id)
        && typeof obj.agent_key === 'string' && obj.agent_key.length > 0
        && IDENTITY_PROVIDER_ENUM.includes(obj.runtime)
        && typeof obj.runtime_session_key === 'string' && obj.runtime_session_key.length > 0
        && CANONICAL_ROLES.includes(obj.role)
        && isHexDigest64(obj.worktree_id) && isHexDigest64(obj.plan_digest)
        && isCanonicalIsoUtc(obj.created_at) && isCanonicalIsoUtc(obj.expiry)
        && isoToMsForRegistry(obj.created_at) <= isoToMsForRegistry(obj.expiry)
        // M7 CORRECTION round 2, R4: a created_at genuinely in the future
        // (relative to the registry clock) is never routine legacy, even
        // when every other field and created_at<=expiry hold -- it is
        // authority-record-malformed, exactly like any other structurally
        // suspect legacy record. See the identical discipline immediately
        // below (root-source) and further below (one-shot).
        && isoToMsForRegistry(obj.created_at) <= currentClockMsForRegistry()
      ) return { state: 'legacy' };
      return { state: 'error', reason: 'authority-record-malformed' };
    }
    const raw = (obj && hasExactKeys(obj, REQUESTER_BINDING_KEYS_V2) && obj.schema === REQUESTER_BINDING_SCHEMA_V2) ? obj : null;
    if (!raw || raw.binding_id !== bindingId) return { state: 'error', reason: 'authority-record-malformed' };
    // M7 GREEN section 4.5 (R12-3): the full validator runs regardless of
    // identity match -- a foreign-identity record whose OWN fields are
    // malformed must still fail the whole classification, never be silently
    // absorbed as a routine stale diagnostic just because it belongs to
    // someone else. Malformed wins over stale.
    const live = validateRequesterBindingFor(repoDescriptor, bindingId, raw.role, raw.worktree_id, raw.plan_digest);
    if (
      !live.ok
      && live.reason !== 'requester-binding-expired' && live.reason !== 'requester-binding-generation-mismatch'
      && live.reason !== 'requester-binding-claude-id01-unproven' && live.reason !== 'authority-fenced'
    ) return { state: 'error', reason: 'authority-record-malformed' };
    if (raw.runtime !== observedIdentity.provider || raw.runtime_session_key !== sessionId || raw.agent_key !== agentId) return { state: 'stale' };
    if (live.ok) return { state: 'candidate', binding: live.binding };
    return { state: 'stale' };
  }, null);
  if (!requesterScan.ok) return requesterScan;

  const rootSourceScan = scanClaudeAuthorityFamily(repoDescriptor, 'root-source-bindings', 'root-source', (bindingId) => {
    const read = readRegistryRecord(rootSourceBindingPathFor(repoDescriptor, bindingId));
    if (!read.ok) return { state: 'error', reason: 'authority-record-unreadable' };
    if (read.absent) return { state: 'absent' };
    const obj = read.obj;
    if (obj && hasExactKeys(obj, ROOT_SOURCE_BINDING_KEYS) && obj.schema === ROOT_SOURCE_BINDING_SCHEMA) {
      // M7 CORRECTION C6 (Codex final ruling): see the requester scan's own
      // identical discipline immediately above -- only a FULLY well-formed
      // v1 record may become LEGACY_STALE.
      if (
        obj.binding_id === bindingId && isHexActionId(obj.action_id) && isHexCsprng32(obj.actor_instance_id)
        && obj.runtime === 'claude-hook'
        && typeof obj.runtime_session_key === 'string' && obj.runtime_session_key.length > 0
        && typeof obj.agent_id === 'string' && obj.agent_id.length > 0
        && obj.agent_type === 'toolkit-specialist' && obj.role === 'toolkit-specialist' && obj.reporting_architect === 'arch-platform'
        && typeof obj.subject_bundle_ref === 'string' && obj.subject_bundle_ref.length > 0 && isHexDigest64(obj.subject_scope_digest)
        && isHexDigest64(obj.worktree_id) && isHexDigest64(obj.plan_digest)
        && isCanonicalIsoUtc(obj.created_at) && isCanonicalIsoUtc(obj.expiry) && isCanonicalIsoUtc(obj.request_expiry)
        && isoToMsForRegistry(obj.created_at) <= isoToMsForRegistry(obj.expiry)
        && isoToMsForRegistry(obj.expiry) <= isoToMsForRegistry(obj.request_expiry)
        // M7 CORRECTION round 2, R4: see the requester scan's own identical
        // discipline immediately above -- a future created_at is malformed,
        // never routine legacy.
        && isoToMsForRegistry(obj.created_at) <= currentClockMsForRegistry()
      ) return { state: 'legacy' };
      return { state: 'error', reason: 'authority-record-malformed' };
    }
    const raw = (obj && hasExactKeys(obj, ROOT_SOURCE_BINDING_KEYS_V2) && obj.schema === ROOT_SOURCE_BINDING_SCHEMA_V2) ? obj : null;
    if (!raw || raw.binding_id !== bindingId) return { state: 'error', reason: 'authority-record-malformed' };
    // M7 GREEN section 4.5 (R12-3): the full validator runs regardless of
    // identity match -- see the requester scan's own identical discipline
    // immediately above. Malformed wins over stale.
    const live = validateRootSourceBindingFor(repoDescriptor, bindingId, raw.role, raw.worktree_id, raw.plan_digest);
    if (
      !live.ok
      && live.reason !== 'root-source-binding-expired' && live.reason !== 'root-source-binding-generation-mismatch'
      && live.reason !== 'authority-fenced' && live.reason !== 'root-source-binding-retired'
    ) return { state: 'error', reason: 'authority-record-malformed' };
    if (raw.runtime_session_key !== sessionId || raw.agent_id !== agentId) return { state: 'stale' };
    if (live.ok) return { state: 'candidate', binding: live.binding };
    return { state: 'stale' };
  }, CLAUDE_AUTHORITY_ROOT_SOURCE_SIDECAR_RE);
  if (!rootSourceScan.ok) return rootSourceScan;

  const oneShotScan = scanClaudeAuthorityFamily(repoDescriptor, 'claude-one-shot-bindings', 'one-shot', (bindingId) => {
    const read = readRegistryRecord(claudeOneShotBindingPathFor(repoDescriptor, bindingId));
    if (!read.ok) return { state: 'error', reason: 'authority-record-unreadable' };
    if (read.absent) return { state: 'absent' };
    const obj = read.obj;
    if (obj && hasExactKeys(obj, CLAUDE_ONE_SHOT_BINDING_KEYS) && obj.schema === CLAUDE_ONE_SHOT_BINDING_SCHEMA) {
      // M7 CORRECTION C6 (Codex final ruling): see the requester scan's own
      // identical discipline above -- only a FULLY well-formed v1 record may
      // become LEGACY_STALE.
      if (
        obj.binding_id === bindingId && isHexActionId(obj.actor_instance_id)
        && typeof obj.runtime_session_key === 'string' && obj.runtime_session_key.length > 0
        && typeof obj.agent_id === 'string' && obj.agent_id.length > 0
        && CANONICAL_ROLES.includes(obj.agent_type) && isHexActionId(obj.native_spawn_action_id)
        && isHexDigest64(obj.request_id) && isHexDigest64(obj.attempt_id)
        && Number.isInteger(obj.lease_epoch) && obj.lease_epoch >= 0
        && CANONICAL_ROLES.includes(obj.role) && obj.agent_type === obj.role
        && isHexDigest64(obj.worktree_id) && isHexDigest64(obj.plan_digest)
        && isCanonicalIsoUtc(obj.created_at) && isCanonicalIsoUtc(obj.expiry)
        && isoToMsForRegistry(obj.created_at) <= isoToMsForRegistry(obj.expiry)
        // M7 CORRECTION round 2, R4: see the requester scan's own identical
        // discipline above -- a future created_at is malformed, never
        // routine legacy.
        && isoToMsForRegistry(obj.created_at) <= currentClockMsForRegistry()
      ) return { state: 'legacy' };
      return { state: 'error', reason: 'authority-record-malformed' };
    }
    const raw = (obj && hasExactKeys(obj, CLAUDE_ONE_SHOT_BINDING_KEYS_V2) && obj.schema === CLAUDE_ONE_SHOT_BINDING_SCHEMA_V2) ? obj : null;
    if (!raw || raw.binding_id !== bindingId) return { state: 'error', reason: 'authority-record-malformed' };
    // M7 CORRECTION C6 (Codex final ruling): fully validate every one-shot
    // v2 before foreign-identity stale classification -- calls the SAME
    // canonical validator createClaudeOneShotBinding's own post-write
    // predicate uses, but with the RECORD'S OWN fields as its own expected
    // tuple (a self-consistency check: the scope-match half is then
    // tautologically satisfied by construction, while every OTHER check --
    // shape/timestamp/generation/fence, including R4's agent_type===role --
    // genuinely applies, regardless of identity match). Only expiry,
    // generation mismatch, and a valid fence are stale/non-live; every
    // other (structural/path/correlation) failure is
    // authority-record-malformed. M7 defect 7: never consults the legacy
    // .retired sidecar marker -- it is diagnostics-only and must never hide
    // a live v2 record.
    const live = validateClaudeOneShotBindingFor(repoDescriptor, bindingId, {
      requestId: raw.request_id, attemptId: raw.attempt_id, leaseEpoch: raw.lease_epoch,
      role: raw.role, worktreeId: raw.worktree_id, planDigest: raw.plan_digest,
    });
    if (
      !live.ok
      && live.reason !== 'claude-one-shot-binding-expired' && live.reason !== 'claude-one-shot-binding-generation-mismatch'
      && live.reason !== 'authority-fenced'
    ) return { state: 'error', reason: 'authority-record-malformed' };
    if (raw.runtime_session_key !== sessionId || raw.agent_id !== agentId) return { state: 'stale' };
    if (live.ok) return { state: 'candidate', binding: live.binding };
    return { state: 'stale' };
  }, CLAUDE_AUTHORITY_ONE_SHOT_SIDECAR_RE);
  if (!oneShotScan.ok) return oneShotScan;

  const allCandidates = requesterScan.candidates.concat(rootSourceScan.candidates, oneShotScan.candidates);
  const legacyCount = requesterScan.legacyCount + rootSourceScan.legacyCount + oneShotScan.legacyCount;
  const staleCount = requesterScan.staleCount + rootSourceScan.staleCount + oneShotScan.staleCount;

  if (allCandidates.length > 1) return { ok: false, reason: 'authority-current-binding-ambiguous' };
  if (allCandidates.length === 1) {
    return {
      ok: true, state: 'ONE', identity: observedIdentity,
      family: allCandidates[0].family, binding: allCandidates[0].binding,
      legacy_count: legacyCount, stale_count: staleCount,
    };
  }
  return { ok: true, state: 'ABSENT', identity: observedIdentity, legacy_count: legacyCount, stale_count: staleCount };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// M7 section 7: admission linearization. A module-private, one-use
// ClaudeAuthorityAdmissionCapability -- an opaque, frozen object carrying its
// own identity id/operation kind/backing id/deadline as OWN properties, and
// SEPARATELY tracked in a WeakSet -- mirrors this file's own established
// unforgeable-token pattern (see lockRegistry/isValidLockTokenFor's own doc
// comments for the identical discipline applied to transition locks): a
// caller-constructed plain object with matching field VALUES is still
// rejected, because WeakSet membership is by REFERENCE identity, never by
// value equality. Never serialized or exported as data. Its first
// authoritative read (inside classifyClaudeAuthorityForIdentity, called by
// admitClaudeAuthorityOperation below) is the linearization point (section
// 1): every cut read absent/live later in the SAME pass was also absent/live
// at that earlier instant.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


  return Object.freeze({ CLAUDE_AUTHORITY_IDENTITY_KEYS, CLAUDE_AUTHORITY_SCAN_CAP, CLAUDE_AUTHORITY_PRIMARY_NAME_RE, CLAUDE_AUTHORITY_ROOT_SOURCE_SIDECAR_RE, CLAUDE_AUTHORITY_ONE_SHOT_SIDECAR_RE, isWellFormedClaudeAuthorityIdentity, scanClaudeAuthorityFamily, classifyClaudeAuthorityForIdentity });
}

module.exports = { createClaudeAuthorityClassifier };

