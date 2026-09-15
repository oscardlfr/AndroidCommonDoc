'use strict';

function createRoleOwnerRegistry({
  fs,
  path,
  CANONICAL_ROLES,
  canonicalJSONStringify,
  classifyDurableRead,
  classifyProcessIdentityLiveness,
  ensureSecureRegistryDir,
  fsyncProjectionPath,
  hasExactKeys,
  isHexActionId,
  isHexDigest64,
  isTestCapability,
  publishBridgeRegistryRecord,
  readRegistryRecord,
  registryRepoDir,
  sha256String,
  withRegistryLock,
}) {

  const ROLE_OWNER_SCHEMA = 'coordination/supervisor-rendezvous-role-owner/v1';

  function computeCoordinationRootId(coordinationRootReal) {
    return sha256String(coordinationRootReal);
  }

  function roleOwnerPathFor(repoDescriptor, coordinationRootId, role) {
    return path.join(registryRepoDir(repoDescriptor), 'rendezvous', 'role-owners', coordinationRootId, role + '.json');
  }

  function roleOwnerLockDirFor(ownerPath) {
    return ownerPath + '.lock';
  }

  function claimRoleOwner(repoDescriptor, coordinationRootId, role, rendezvousInstanceId, supervisorInstanceId, pidIdentity) {
    if (!CANONICAL_ROLES.includes(role)) return { ok: false, reason: 'role-not-canonical' };
    const ownerPath = roleOwnerPathFor(repoDescriptor, coordinationRootId, role);
    const dirResult = ensureSecureRegistryDir(path.dirname(ownerPath));
    if (!dirResult.ok) return { ok: false, reason: dirResult.reason };
    const record = {
      schema: ROLE_OWNER_SCHEMA,
      coordination_root_id: coordinationRootId,
      role,
      rendezvous_instance_id: rendezvousInstanceId,
      supervisor_instance_id: supervisorInstanceId,
      pid_identity: pidIdentity,
    };
    const locked = withRegistryLock(roleOwnerLockDirFor(ownerPath), () => {
      try {
        publishBridgeRegistryRecord(ownerPath, Buffer.from(canonicalJSONStringify(record), 'utf8'), { raceDetailCode: 'AUTHORITY_INVALID' });
        return { ok: true };
      } catch (err) {
        if (err && err.detailCode === 'AUTHORITY_INVALID') {
          return { ok: false, reason: 'role-already-owned', ambiguous: false };
        }
        return { ok: false, reason: 'role-owner-claim-ambiguous:' + ((err && (err.detailCode || err.code)) || 'unknown'), ambiguous: true };
      }
    });
    if (!locked.ok) return { ok: false, reason: 'lock-timeout', ambiguous: true };
    if (!locked.value.ok) return locked.value;
    return { ok: true, ownerPath, record, rendezvousInstanceId, supervisorInstanceId };
  }

  const ROLE_OWNER_KEYS = Object.freeze([
    'coordination_root_id', 'pid_identity', 'rendezvous_instance_id', 'role', 'schema', 'supervisor_instance_id',
  ].sort());

  const PID_IDENTITY_KEYS = Object.freeze(['birth_observed_at', 'executable', 'pid'].sort());

  function roleOwnerTombstonePathFor(ownerPath, supervisorInstanceId) {
    return path.join(path.dirname(ownerPath), '.tombstone', path.basename(ownerPath) + '.' + supervisorInstanceId);
  }

  function writeCleanupTestDelayMarker(phase) {
    if (!isTestCapability()) return;
    const markerPath = process.env.RUNTIME_BRIDGE_CODEX_TEST_CLEANUP_DELAY_MARKER;
    if (typeof markerPath !== 'string' || !path.isAbsolute(markerPath) || markerPath.length > 4096) return;
    try {
      fs.writeFileSync(markerPath, phase + '\n', { mode: 0o600, flag: 'wx' });
    } catch (err) { /* the waiting test fails if its synchronization marker cannot be published */ }
  }

  function releaseOwnedRoleOwner(ownerPath, expectedSupervisorInstanceId, expectedRendezvousInstanceId, expectedRole, expectedCoordinationRootId, expectedPidIdentity) {
    const locked = withRegistryLock(roleOwnerLockDirFor(ownerPath), () => {
      let preReadStat;
      try {
        preReadStat = fs.lstatSync(ownerPath, { bigint: true });
      } catch (err) {
        if (err && err.code === 'ENOENT') return { ok: true, skipped: true };
        return { ok: false, reason: 'pre-read-stat-failed' };
      }
      const read = readRegistryRecord(ownerPath);
      if (!read.ok) return { ok: false, reason: 'reopen-failed:' + read.reason };
      if (read.absent) return { ok: true, skipped: true };
      const current = read.obj;
      // R4 round 2, point 6 (tightened R4 round 3, block 2d): close the shape
      // of the identity fields themselves -- hasExactKeys alone only proves
      // the KEY SET is right, never that supervisor_instance_id/
      // rendezvous_instance_id are genuinely 32-hex crypto-random ids,
      // coordination_root_id is genuinely a 64-hex sha256 digest (a DIFFERENT
      // contract -- never the same loose "32+" check), or that role is a
      // CLOSED canonical enum member (a bare non-empty-string check would
      // accept anything). The instance-id EQUALITY check below still
      // provides the real security property against a KNOWN-good expected
      // value, but a record that is not even well-shaped is not evidence of
      // anything and must never reach that comparison pretending to be one.
      const shapeOk = (
        current && hasExactKeys(current, ROLE_OWNER_KEYS)
        && current.schema === ROLE_OWNER_SCHEMA
        && CANONICAL_ROLES.includes(current.role)
        && isHexDigest64(current.coordination_root_id)
        && isHexActionId(current.supervisor_instance_id)
        && isHexActionId(current.rendezvous_instance_id)
        && current.pid_identity && hasExactKeys(current.pid_identity, PID_IDENTITY_KEYS)
        && Number.isInteger(current.pid_identity.pid) && current.pid_identity.pid > 0
        && typeof current.pid_identity.executable === 'string' && current.pid_identity.executable.length > 0
        && typeof current.pid_identity.birth_observed_at === 'string' && current.pid_identity.birth_observed_at.length > 0
      );
      if (!shapeOk) {
        // A structurally malformed record is not evidence of anything --
        // never reasoned about as "probably a replacement", never a silent
        // skip. STOP.
        return { ok: false, reason: 'owner-record-shape-invalid' };
      }
      const instanceIdsMismatch = (
        current.supervisor_instance_id !== expectedSupervisorInstanceId
        || current.rendezvous_instance_id !== expectedRendezvousInstanceId
      );
      if (instanceIdsMismatch) {
        // A genuinely DIFFERENT, later-published owner now lives at this
        // path (SUP-RDV-10) -- 128-bit crypto-random ids make this
        // structurally near-impossible to collide with by accident; safe to
        // leave untouched and non-fatal.
        return { ok: true, skipped: true, replaced: true };
      }
      if (
        (expectedRole !== undefined && current.role !== expectedRole)
        || (expectedCoordinationRootId !== undefined && current.coordination_root_id !== expectedCoordinationRootId)
        || (
          expectedPidIdentity !== undefined
          && (
            current.pid_identity.pid !== expectedPidIdentity.pid
            || current.pid_identity.executable !== expectedPidIdentity.executable
            || current.pid_identity.birth_observed_at !== expectedPidIdentity.birth_observed_at
          )
        )
      ) {
        // Instance ids MATCH (claims to be MY exact record) but something
        // else does not -- never a legitimate replacement (one of those
        // would carry fresh instance ids too). Ambiguous: STOP, never a
        // silent skip.
        return { ok: false, reason: 'owner-record-correlation-ambiguous' };
      }

      // Test-only synchronous pause, so a bats test can deterministically
      // rebind the path (real fs.unlink+fs.writeFileSync from a SEPARATE,
      // lock-bypassing script) inside the otherwise sub-microsecond window
      // this check exists to guard. Grants no authority (timing only) --
      // single isTestCapability() gate is sufficient, mirroring this file's
      // other test-only delays. Atomics.wait (not asyncSleep) because this
      // function is synchronous.
      if (isTestCapability()) {
        const raw = process.env.RUNTIME_BRIDGE_CODEX_TEST_PRE_UNLINK_DELAY_MS;
        const delayMs = raw ? parseInt(raw, 10) : NaN;
        if (Number.isFinite(delayMs) && delayMs > 0) {
          writeCleanupTestDelayMarker('pre-unlink-delay');
          try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs); } catch (err) { /* best effort */ }
        }
      }

      // R4 round 2, point 6: the tombstone directory itself is created/
      // verified through the SAME hardened primitive every other
      // host-private registry directory uses (pre-check not-a-symlink,
      // mkdir+chmod 0700, post-check not-a-symlink/owner/mode) -- never a
      // bare mkdirSync that would silently follow/adopt a pre-planted symlink.
      const tombstoneDir = path.join(path.dirname(ownerPath), '.tombstone');
      const tombstoneDirResult = ensureSecureRegistryDir(tombstoneDir);
      if (!tombstoneDirResult.ok) return { ok: false, reason: 'tombstone-dir-failed:' + tombstoneDirResult.reason };

      // R4 round 2, point 6: the tombstone write is now GENUINELY no-clobber
      // (publishNoClobber's own hardlink-from-owned-temp primitive -- the
      // SAME one claimRoleOwner itself uses to win the live owner slot) --
      // never a bare renameSync, which unconditionally OVERWRITES whatever
      // already sits at the destination on POSIX. A pre-existing tombstone at
      // this exact (supervisor_instance_id-namespaced) path is therefore
      // never silently replaced. If a prior attempt durably published the
      // exact canonical bytes and crashed before unlinking ownerPath, a secure
      // fd-bound read credits that identical tombstone and resumes the unlink;
      // any other existing bytes fail closed. This step touches ONLY the tombstone
      // destination -- it writes OUR OWN already-credited bytes to a NEW
      // location and never reads or reasons about ownerPath's CURRENT state,
      // so no rebind of ownerPath before this point can affect its
      // correctness at all.
      const tombstonePath = roleOwnerTombstonePathFor(ownerPath, current.supervisor_instance_id);
      const creditedTombstoneBytes = Buffer.from(canonicalJSONStringify(current), 'utf8');
      try {
        publishBridgeRegistryRecord(tombstonePath, creditedTombstoneBytes, {});
      } catch (err) {
        if (err && err.detailCode === 'AUTHORITY_INVALID') {
          // Crash-cut idempotency: publishNoClobber proves we did not replace
          // anything. Reopen the pre-existing path with the same no-follow,
          // owner/mode/nlink/identity checks used for every durable authority
          // record, and resume only when the RAW bytes are exactly the
          // canonical bytes already credited from ownerPath above. JSON object
          // equivalence is insufficient: whitespace/duplicate-key/noncanonical
          // encodings are never accepted as a completed prior publication.
          try {
            const existing = classifyDurableRead(tombstonePath, { parse: false });
            if (
              existing.state !== 'PRESENT'
              || !Buffer.isBuffer(existing.bytes)
              || !existing.bytes.equals(creditedTombstoneBytes)
            ) return { ok: false, reason: 'tombstone-already-exists' };
          } catch (readErr) {
            return { ok: false, reason: 'tombstone-reopen-failed:' + ((readErr && (readErr.detailCode || readErr.code)) || 'unknown') };
          }
        } else {
          return { ok: false, reason: 'tombstone-write-failed:' + ((err && (err.detailCode || err.code)) || 'unknown') };
        }
      }

      // R4 round 2, point 6 (wording corrected R4 round 3, round 4 -- finding
      // 3): test-only synchronous pause, positioned strictly AFTER the
      // tombstone write is already durable and BEFORE the pre-unlink identity
      // recheck below, so a bats test can deterministically rebind ownerPath
      // BEFORE that final check runs and observe the check itself catch it.
      // This is honestly a rebind-before-the-final-check proof, NOT a proof
      // of the genuinely irreducible lstat->unlink gap: the delay fires
      // before `fs.lstatSync` is even called, so the rebind it exercises is
      // one the very next lstat call trivially observes -- a real, but much
      // larger and easily-closed window, never the few-CPU-instruction gap
      // between the lstat RETURNING and the unlink EXECUTING. No POSIX
      // primitive can pre-check that narrower gap (there is no "unlink only
      // if inode still matches" syscall); see the comment at the pre-unlink
      // check itself for what actually protects it.
      if (isTestCapability()) {
        const rawPostStat = process.env.RUNTIME_BRIDGE_CODEX_TEST_POST_STAT_PRE_RENAME_DELAY_MS;
        const postStatDelayMs = rawPostStat ? parseInt(rawPostStat, 10) : NaN;
        if (Number.isFinite(postStatDelayMs) && postStatDelayMs > 0) {
          writeCleanupTestDelayMarker('post-tombstone-pre-unlink-delay');
          try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, postStatDelayMs); } catch (err) { /* best effort */ }
        }
      }

      // Point D.2, hardened R4 round 2 (point 6): re-verify the path's
      // identity is UNCHANGED since the read above, immediately before the
      // ONLY remaining destructive step -- never remove whatever now lives
      // at this path without proving it is still the SAME file this whole
      // check just credited. Unlike the OLD rename-based design, a failure
      // here needs NO restore step: nothing has been moved or overwritten at
      // ownerPath at any point, so a detected rebind simply means "do not
      // unlink" -- the rebound/foreign file is left completely untouched,
      // and OUR OWN data is already safely durable at the tombstone
      // regardless of this outcome (point 4's "recoverable", never "silently
      // reported as a completed release").
      //
      // Honesty note (R4 round 3, round 4 correction, finding 3): this check
      // closes every window BEFORE it runs (including the one the bats
      // test-only delay above exercises), but it cannot close the genuinely
      // irreducible gap between THIS lstat returning and the unlinkSync call
      // immediately below executing -- no POSIX primitive offers an atomic
      // "unlink iff identity still matches" operation. That narrower gap is
      // NOT covered by any check here; it is covered ENTIRELY by the
      // cooperative lock this whole function already runs under
      // (withRegistryLock, at the call site). The security contract this
      // whole path relies on is scoped exactly that way: authoritative
      // writers to this host-private registry directory all acquire and
      // respect the SAME lock before mutating a role-owner file, so no
      // OTHER lock-respecting writer can rebind ownerPath inside this gap;
      // a non-lock-respecting adversarial process could, in principle, but
      // that is outside this contract's threat model (the same as every
      // other mutation this module performs under the same lock).
      let preUnlinkStat;
      try {
        preUnlinkStat = fs.lstatSync(ownerPath, { bigint: true });
      } catch (err) {
        if (err && err.code === 'ENOENT') return { ok: true, skipped: true };
        return { ok: false, reason: 'pre-unlink-stat-failed' };
      }
      if (preUnlinkStat.dev !== preReadStat.dev || preUnlinkStat.ino !== preReadStat.ino) {
        return { ok: false, reason: 'pre-unlink-identity-mismatch' };
      }
      try {
        fs.unlinkSync(ownerPath);
      } catch (err) {
        if (err && err.code === 'ENOENT') return { ok: true, skipped: true };
        return { ok: false, reason: 'unlink-failed' };
      }
      // Directory-fsync barrier: durably persist the removal from the owner
      // directory. The tombstone side is already durable -- publishNoClobber
      // fsyncs its own barriers internally before ever returning success.
      const ownerDir = path.dirname(ownerPath);
      try {
        fsyncProjectionPath(ownerDir);
      } catch (err) {
        return { ok: false, reason: 'directory-barrier-failed' };
      }
      return { ok: true, skipped: false };
    });
    if (!locked.ok) return { ok: false, reason: 'lock-timeout' };
    return locked.value;
  }

  function findExistingRoleOwner(repoDescriptor, coordinationRootId) {
    const dir = path.join(registryRepoDir(repoDescriptor), 'rendezvous', 'role-owners', coordinationRootId);
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (err && err.code === 'ENOENT') return { ok: true, found: false };
      return { ok: false, reason: 'existing-owner-scan-failed' };
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      return { ok: true, found: true, role: entry.name.slice(0, -'.json'.length) };
    }
    return { ok: true, found: false };
  }

  function releaseAllClaimed(claimed) {
    let allOk = true;
    for (const claim of claimed) {
      const release = releaseOwnedRoleOwner(claim.ownerPath, claim.supervisorInstanceId, claim.rendezvousInstanceId, claim.record.role, claim.record.coordination_root_id, claim.record.pid_identity);
      if (!release.ok) allOk = false;
    }
    return allOk;
  }

  function releaseConfirmedDeadSupervisorOwners(repoDescriptor, coordinationRootId, roles, pidIdentity) {
    const liveness = classifyProcessIdentityLiveness(pidIdentity);
    if (!liveness.ok || liveness.status !== 'ABSENT') {
      return { ok: false, reason: 'dead-supervisor-not-proven-absent' };
    }
    if (
      typeof coordinationRootId !== 'string' || !isHexDigest64(coordinationRootId)
      || !Array.isArray(roles) || roles.length === 0
      || new Set(roles).size !== roles.length
      || !roles.every((role) => CANONICAL_ROLES.includes(role))
    ) return { ok: false, reason: 'dead-supervisor-owner-scope-invalid' };

    const credited = [];
    for (const role of roles) {
      const ownerPath = roleOwnerPathFor(repoDescriptor, coordinationRootId, role);
      const read = readRegistryRecord(ownerPath);
      if (!read.ok) return { ok: false, reason: read.reason };
      if (read.absent) continue;
      const owner = read.obj;
      if (
        !owner || !hasExactKeys(owner, ROLE_OWNER_KEYS)
        || owner.schema !== ROLE_OWNER_SCHEMA
        || owner.role !== role
        || owner.coordination_root_id !== coordinationRootId
        || !owner.pid_identity || !hasExactKeys(owner.pid_identity, PID_IDENTITY_KEYS)
        || owner.pid_identity.pid !== pidIdentity.pid
        || owner.pid_identity.executable !== pidIdentity.executable
        || owner.pid_identity.birth_observed_at !== pidIdentity.birth_observed_at
        || !isHexActionId(owner.supervisor_instance_id)
        || !isHexActionId(owner.rendezvous_instance_id)
      ) return { ok: false, reason: 'dead-supervisor-owner-correlation-invalid:' + role };
      credited.push({ role, ownerPath, owner });
    }
    for (const item of credited) {
      const release = releaseOwnedRoleOwner(
        item.ownerPath,
        item.owner.supervisor_instance_id,
        item.owner.rendezvous_instance_id,
        item.role,
        coordinationRootId,
        pidIdentity,
      );
      if (!release.ok || release.replaced) {
        return { ok: false, reason: 'dead-supervisor-owner-release-failed:' + item.role };
      }
    }
    return { ok: true, released: credited.length };
  }

  return Object.freeze({
    ROLE_OWNER_KEYS,
    ROLE_OWNER_SCHEMA,
    computeCoordinationRootId,
    roleOwnerPathFor,
    claimRoleOwner,
    releaseOwnedRoleOwner,
    findExistingRoleOwner,
    releaseAllClaimed,
    releaseConfirmedDeadSupervisorOwners,
  });
}

module.exports = Object.freeze({ createRoleOwnerRegistry });
