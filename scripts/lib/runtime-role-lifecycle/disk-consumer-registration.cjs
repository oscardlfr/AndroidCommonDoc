'use strict';

function createDiskConsumerRegistration(deps) {
  const {
    path, process, crypto, Buffer, ACTION_TTL_CEILING_SECONDS, CANONICAL_ROLES, canonicalJSONStringify, currentClockMsForRegistry, hasExactKeys, isCanonicalIsoUtc, isHexCsprng32, isHexDigest64,
    isIntInRangeNum, isTestCapability, isoPlusSecondsForRegistry, isoToMsForRegistry, nowIsoForRegistry, readRegistryRecord, registryRepoDir, sha256String, writeRegistryRecordReplace,
  } = deps;

const DISK_CONSUMER_REGISTRATION_SCHEMA = 'runtime/disk-consumer-registration/v1';
const DISK_CONSUMER_REGISTRATION_KEYS = Object.freeze([
  'consumer_pid', 'created_at', 'expiry', 'plan_digest', 'registration_id',
  'role', 'schema', 'session_generation_id', 'worktree_id',
].sort());

function diskConsumerRegistrationKeyDigest(worktreeId, planDigest, generationId, role) {
  return sha256String(['wp4-disk-consumer-registration-v1', worktreeId, planDigest, generationId, role].join(':'));
}

function diskConsumerRegistrationPathFor(projectRoot, worktreeId, planDigest, generationId, role) {
  return path.join(
    registryRepoDir(projectRoot), 'disk-consumer-registrations',
    diskConsumerRegistrationKeyDigest(worktreeId, planDigest, generationId, role) + '.json',
  );
}

/**
 * Mints (or refreshes) one DiskConsumerRegistration/v1 record proving a real
 * disk-polling consumer exists for this exact tuple. Every input is
 * independently validated before anything is written, mirroring
 * `createRoleActorBinding`'s own "no hook-observed identity to lean on"
 * discipline -- this mint path is the only gate standing between a caller
 * bug and a durably-published, semantically-false registration.
 * @param {string} projectRoot
 * @param {string} role
 * @param {string} worktreeId
 * @param {string} planDigest
 * @param {string} sessionGenerationId
 * @param {number} consumerPid
 * @param {number} ttlSeconds
 * @returns {{ok:true,registrationId:string}|{ok:false,reason:string}}
 */
function registerDiskConsumer(projectRoot, role, worktreeId, planDigest, sessionGenerationId, consumerPid, ttlSeconds) {
  if (!CANONICAL_ROLES.includes(role)) return { ok: false, reason: 'invalid-role' };
  if (!isHexDigest64(worktreeId)) return { ok: false, reason: 'invalid-worktree-id' };
  if (!isHexDigest64(planDigest)) return { ok: false, reason: 'invalid-plan-digest' };
  if (!isHexCsprng32(sessionGenerationId)) return { ok: false, reason: 'invalid-session-generation-id' };
  if (!Number.isInteger(consumerPid) || consumerPid <= 0) return { ok: false, reason: 'invalid-consumer-pid' };
  if (!isIntInRangeNum(ttlSeconds, 1, ACTION_TTL_CEILING_SECONDS)) return { ok: false, reason: 'invalid-ttl' };

  const registrationId = crypto.randomBytes(16).toString('hex');
  const nowStr = nowIsoForRegistry();
  const record = {
    schema: DISK_CONSUMER_REGISTRATION_SCHEMA,
    registration_id: registrationId,
    role,
    worktree_id: worktreeId,
    plan_digest: planDigest,
    session_generation_id: sessionGenerationId,
    consumer_pid: consumerPid,
    created_at: nowStr,
    expiry: isoPlusSecondsForRegistry(nowStr, ttlSeconds),
  };
  const recordPath = diskConsumerRegistrationPathFor(projectRoot, worktreeId, planDigest, sessionGenerationId, role);
  const writeResult = writeRegistryRecordReplace(recordPath, Buffer.from(canonicalJSONStringify(record), 'utf8'));
  if (!writeResult.ok) return { ok: false, reason: writeResult.reason };
  return { ok: true, registrationId };
}

/**
 * True if a real OS process with this pid currently exists (a genuine
 * `process.kill(pid, 0)` liveness probe -- never inferred from mere
 * file/PID text presence). EPERM still means the process exists (owned by
 * a different user); only ESRCH (no such process) or an otherwise-invalid
 * pid means dead/absent.
 * @param {number} pid
 * @returns {boolean}
 */
function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return !!(err && err.code === 'EPERM');
  }
}

/**
 * Closed validator for DiskConsumerRegistration/v1: exact key-set closure,
 * exact schema literal, every id field independently well-formed, path<->
 * tuple correlation (mirrors lifecycle-command-grant's own grant-id-path-
 * mismatch defense: a self-consistent foreign record copied onto this
 * path is never trusted merely because it sits here), canonical-ISO-UTC
 * timestamps with created_at<=expiry, not expired, and a genuinely live
 * consumer_pid.
 * @returns {boolean}
 */
function validateDiskConsumerRegistrationFor(projectRoot, worktreeId, planDigest, sessionGenerationId, role) {
  if (
    typeof projectRoot !== 'string' || projectRoot.length === 0
    || typeof worktreeId !== 'string' || typeof planDigest !== 'string'
    || typeof sessionGenerationId !== 'string' || typeof role !== 'string'
  ) {
    return false;
  }
  const recordPath = diskConsumerRegistrationPathFor(projectRoot, worktreeId, planDigest, sessionGenerationId, role);
  const read = readRegistryRecord(recordPath);
  if (!read.ok || read.absent) return false;
  const rec = read.obj;
  if (!rec || !hasExactKeys(rec, DISK_CONSUMER_REGISTRATION_KEYS)) return false;
  if (rec.schema !== DISK_CONSUMER_REGISTRATION_SCHEMA) return false;
  if (!isHexCsprng32(rec.registration_id)) return false;
  if (!CANONICAL_ROLES.includes(rec.role) || rec.role !== role) return false;
  if (!isHexDigest64(rec.worktree_id) || rec.worktree_id !== worktreeId) return false;
  if (!isHexDigest64(rec.plan_digest) || rec.plan_digest !== planDigest) return false;
  if (!isHexCsprng32(rec.session_generation_id) || rec.session_generation_id !== sessionGenerationId) return false;
  if (!Number.isInteger(rec.consumer_pid) || rec.consumer_pid <= 0) return false;
  if (!isCanonicalIsoUtc(rec.created_at) || !isCanonicalIsoUtc(rec.expiry)) return false;
  const createdAtMs = isoToMsForRegistry(rec.created_at);
  const expiryMs = isoToMsForRegistry(rec.expiry);
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiryMs) || createdAtMs > expiryMs) return false;
  const nowMs = currentClockMsForRegistry();
  if (createdAtMs > nowMs || nowMs >= expiryMs) return false;
  return isProcessAlive(rec.consumer_pid);
}

/**
 * Point 3.3 (R4): `noop` may only declare a role-binding READY when a
 * genuinely registered, validated disk consumer is polling for THIS exact
 * role -- never unconditionally the instant routing/capability reaches it.
 * M6 Block C + M7/WP4 dependency closure: production is no longer
 * unconditionally honest-empty -- this extended signature consults a real
 * `registerDiskConsumer`-minted DiskConsumerRegistration/v1 record for the
 * exact (worktree, plan, session-generation, role) tuple. The pre-existing
 * RUNTIME_ROLE_LIFECYCLE_TEST_DISK_CONSUMERS env-var seam is preserved
 * EXACTLY as before -- additive, never a replacement -- whenever that var
 * is present under `isTestCapability()`: the extended params are ignored
 * entirely and role-name membership alone governs, byte-identical to the
 * pre-M6-Block-C behavior.
 * @param {string} projectRoot
 * @param {string} role
 * @param {string} worktreeId
 * @param {string} planDigest
 * @param {string} sessionGenerationId
 * @returns {boolean}
 */
function hasRegisteredValidatedDiskConsumer(projectRoot, role, worktreeId, planDigest, sessionGenerationId) {
  if (isTestCapability()) {
    const raw = process.env.RUNTIME_ROLE_LIFECYCLE_TEST_DISK_CONSUMERS;
    if (typeof raw === 'string' && raw.length > 0) {
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        return false;
      }
      if (!Array.isArray(parsed) || !parsed.every((r) => typeof r === 'string' && CANONICAL_ROLES.includes(r))) {
        return false;
      }
      return parsed.includes(role);
    }
  }
  return validateDiskConsumerRegistrationFor(projectRoot, worktreeId, planDigest, sessionGenerationId, role);
}

// ─────────────────────────────────────────────────────────────────────────────
// WP3: Action registry -- immutable/no-clobber, one-use records with the exact
// common field set PLAN.md ~L154 freezes:
//   {schema,action_id,kind,runtime,repo_id,worktree_id,plan_digest,policy_digest,
//    session_generation_id,role,expires_at,payload}
// Closed `kind`/`runtime`/`payload` union per PLAN.md ~L156-163. The core NEVER
// executes these -- it only generates+persists the descriptor. M6:
// `resolveHostOperationForAction` below is the closed LOOKUP TABLE an
// interpreter consults (PLAN.md ~L176-185's frozen kind/runtime->operation
// mapping) -- it is still never itself an executor; the actual
// TeamCreate/Agent/SendMessage/supervisor-control call stays outside this
// file, performed by the active top-level orchestrator (PLAN.md ~L185) or,
// for host-process operations, the retained bridge control boundary in
// runtime-bridge-codex.cjs.
// ─────────────────────────────────────────────────────────────────────────────

  return Object.freeze({ DISK_CONSUMER_REGISTRATION_SCHEMA, DISK_CONSUMER_REGISTRATION_KEYS, diskConsumerRegistrationKeyDigest, diskConsumerRegistrationPathFor, registerDiskConsumer, isProcessAlive, validateDiskConsumerRegistrationFor, hasRegisteredValidatedDiskConsumer });
}

module.exports = { createDiskConsumerRegistration };
