'use strict';

// worker-presence/v1 publication: path formula, closed shape/lease constants, and the durable READY-signal writer.

function createWorkerPresence({
  canonicalJSONStringify,
  ensureSecureRegistryDir,
  path,
  registryRepoDir,
  rll,
}) {
// ── Group A / C4 slice (2026-08-10): worker-presence/v1 publication +
// minimal RoleScheduler/v1 admission (sub-items c/e, user-authorized -- see
// group-a-c4-slice-authorization-2026-08-10.md) ──

const WORKER_PRESENCE_SCHEMA = 'coordination/worker-presence/v1';
const WORKER_PRESENCE_KEYS = Object.freeze([
  'heartbeat_at', 'lease_expiry', 'pid', 'role', 'role_profile_digest',
  'schema', 'started_at', 'thread_id', 'worker_session_id', 'worktree_id',
].sort());
const WORKER_PRESENCE_LEASE_MS = 120 * 1000; // PLAN.md ~L989: "older than 120 seconds makes the persistent driver unavailable".

function workerPresencePathFor(repoDescriptor, role, workerSessionId) {
  return path.join(registryRepoDir(repoDescriptor), 'workers', role, workerSessionId, 'presence.json');
}

const READY_WORKER_SCAN_CAP = 256;
/**
 * Sub-item (c): publishes worker-presence/v1 (PLAN.md ~L974-989) once
 * descriptor+owner+rendezvous+retained-handle+isolation+a valid bootstrap
 * turn have ALL genuinely succeeded for this role -- this worker's own
 * durable READY signal. Previously a separate, not-yet-wired concern; this
 * is a real, durable publication, never a hand-planted/simulated one.
 * Writer: worker, mutable temp+rename REPLACE (never the no-clobber
 * primitive -- this record's own heartbeat/lease is legitimately
 * re-written in place by the SAME worker, per PLAN.md's own writer note).
 * @returns {{ok:true}|{ok:false,reason:string}}
 */
function publishWorkerPresenceReady(repoDescriptor, role, workerSessionId, worktreeId, threadId, roleProfileDigest) {
  const presencePath = workerPresencePathFor(repoDescriptor, role, workerSessionId);
  const dirResult = ensureSecureRegistryDir(path.dirname(presencePath));
  if (!dirResult.ok) return { ok: false, reason: dirResult.reason };
  const nowIso = new Date().toISOString();
  const record = {
    schema: WORKER_PRESENCE_SCHEMA,
    role,
    worker_session_id: workerSessionId,
    worktree_id: worktreeId,
    thread_id: threadId,
    role_profile_digest: roleProfileDigest,
    pid: process.pid,
    started_at: nowIso,
    lease_expiry: new Date(Date.now() + WORKER_PRESENCE_LEASE_MS).toISOString(),
    heartbeat_at: nowIso,
  };
  const writeResult = rll.writeRegistryRecordReplace(
    presencePath, Buffer.from(canonicalJSONStringify(record), 'utf8'),
  );
  if (!writeResult.ok) return writeResult;
  return { ok: true, presencePath, record };
}

  return Object.freeze({
    READY_WORKER_SCAN_CAP,
    WORKER_PRESENCE_KEYS,
    WORKER_PRESENCE_LEASE_MS,
    WORKER_PRESENCE_SCHEMA,
    publishWorkerPresenceReady,
    workerPresencePathFor,
  });
}

module.exports = Object.freeze({ createWorkerPresence });
