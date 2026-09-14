'use strict';

// role-command-grant/v1 CONSUME side: full independent validation, then one-time no-clobber consumption.

function createRoleCommandGrant({
  CliError,
  GRANT_CANONICAL_ROLES,
  HEX_CSPRNG_32_RE,
  ROLE_COMMAND_GRANT_KEYS,
  ROLE_COMMAND_GRANT_SCHEMA,
  ROLE_COMMAND_GRANT_TTL_SECONDS,
  canonicalJSONStringify,
  currentClockMs,
  getRuntimeRoleLifecycle,
  hasExactKeys,
  isCanonicalIsoUtcLocal,
  isHex64,
  isHexId,
  localEnsureSecureRegistryDir,
  nowIso,
  path,
  publishNoClobber,
  readLocalRegistryRecord,
  roleCommandGrantConsumedMarkerPathFor,
  roleCommandGrantPathFor,
}) {
/**
 * Fully validates a role-command-grant/v1 without mutating its consumption
 * state (PLAN.md
 * §15b, ~L592; ~L604's revalidation list: schema/binding/authority/
 * subcommand/argv digest, then the backing binding's own scope). Every
 * check is independent and fails closed. Consumption is a no-clobber marker
 * create (EEXIST == replay), mirroring
 * validateAndConsumeLifecycleCommandGrant's own established discipline in
 * the sibling module.
 */
function validateRoleCommandGrantOrThrow(repoId, projectRoot, grantId, argvDigest, expectedAuthority, expectedSubcommand) {
  if (!HEX_CSPRNG_32_RE.test(grantId)) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'malformed role-command-grant id');
  }
  const grantPath = roleCommandGrantPathFor(repoId, grantId);
  const grantRead = readLocalRegistryRecord(grantPath);
  if (!grantRead.ok) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant not yet durable: ' + grantRead.reason);
  }
  if (grantRead.absent) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant absent');
  }
  const grant = grantRead.obj;
  if (!grant || !hasExactKeys(grant, ROLE_COMMAND_GRANT_KEYS)) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant shape invalid');
  }
  if (grant.grant_id !== grantId) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant id/path mismatch');
  if (grant.schema !== ROLE_COMMAND_GRANT_SCHEMA) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant schema invalid');
  if (grant.authority !== expectedAuthority) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant authority mismatch');
  if (grant.subcommand !== expectedSubcommand) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant subcommand mismatch');
  if (grant.canonical_argv_digest !== argvDigest) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant argv digest mismatch (tampered argv)');
  if (!isHexId(grant.binding_id) || !isHexId(grant.actor_instance_id)) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant id-shape invalid');
  }
  if (!isHex64(grant.worktree_id) || !isHex64(grant.plan_digest)) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant scope-id-shape invalid');
  }
  if (grant.role !== null && !GRANT_CANONICAL_ROLES.includes(grant.role)) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant role-shape invalid');
  }
  if (grant.request_id !== null && (typeof grant.request_id !== 'string' || grant.request_id.length === 0)) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant request_id-shape invalid');
  }
  if (grant.attempt_id !== null && (typeof grant.attempt_id !== 'string' || grant.attempt_id.length === 0)) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant attempt_id-shape invalid');
  }
  if (grant.lease_epoch !== null && !(Number.isInteger(grant.lease_epoch) && grant.lease_epoch >= 0)) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant lease_epoch-shape invalid');
  }
  if (!isCanonicalIsoUtcLocal(grant.created_at) || !isCanonicalIsoUtcLocal(grant.expiry)) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant timestamp-shape invalid');
  }
  const createdAtMs = Date.parse(grant.created_at);
  const expiryMs = Date.parse(grant.expiry);
  if (createdAtMs > expiryMs) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant timestamp invalid');
  if (expiryMs - createdAtMs > ROLE_COMMAND_GRANT_TTL_SECONDS * 1000) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant TTL exceeds the 30s ceiling');
  }
  const nowMs = currentClockMs();
  if (createdAtMs > nowMs) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant created in the future');
  if (nowMs >= expiryMs) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant expired');

  // M7 completeness Part C follow-up: a 'target'-authority grant may be
  // backed by EITHER RoleActorBinding/v1 (the pre-existing, unchanged
  // persistent path) OR ClaudeOneShotBinding/v1 (point 4) -- the two types'
  // binding_id CSPRNG namespaces are structurally disjoint (independently
  // minted, stored under different registry subdirectories), so trying
  // RoleActorBinding first and ClaudeOneShotBinding only if that fails is a
  // safe, unambiguous "which of two disjoint namespaces does this specific
  // id live in" lookup -- never the kind of driver-selection ambiguity the
  // "never fallback/probe-both" guidance addresses (that guidance governs
  // the MINT-side choice of which type to back a NEW grant with, made
  // deterministically by runtime-consultation-target-gate.js itself).
  // M7 completeness: the whole Local family of binding validators this
  // branch used to call (validateRequesterBindingForLocal/
  // validateRootSourceBindingForLocal/validateRoleActorBindingForLocal/
  // validateClaudeOneShotBindingForLocal) reimplemented v1-only shape/schema
  // checks -- a v2-backed binding failed EVERY one of them, so grant
  // CONSUMPTION (as opposed to minting, already v1/v2-aware) silently could
  // not succeed for any v2 binding. The stale circular-import justification
  // for that duplication no longer holds: this file's getRuntimeRoleLifecycle
  // dependency (the facade's own lazy accessor, injected the same way every
  // other cross-module lifecycle reference in this tree already is) resolves
  // well after both modules have finished loading. Consuming the real,
  // already v1/v2+fence-aware runtime-role-lifecycle.cjs validators directly
  // closes that gap.
  // M7 defect 9 (section 6): clean namespace discrimination -- exactly one
  // of the two disjoint registry subdirectories may hold a record at this
  // binding_id (each family's own binding_id is independently minted, never
  // reused across families); malformed or both-present is denied by the
  // SAME cardinality check, never a dual-family-probe fallback that tries
  // both validators and disambiguates after the fact.
  const rll = getRuntimeRoleLifecycle();
  let bindingResult;
  if (expectedAuthority === 'requester') {
    const stablePresence = rll.readRegistryRecord(rll.requesterBindingPathFor({ repoId }, grant.binding_id));
    if (!stablePresence.ok) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'stable requester binding namespace read failed: ' + stablePresence.reason);
    }
    const rootSourcePresence = rll.readRegistryRecord(rll.rootSourceBindingPathFor({ repoId }, grant.binding_id));
    if (!rootSourcePresence.ok) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-source requester binding namespace read failed: ' + rootSourcePresence.reason);
    }
    const stableHasRecord = !stablePresence.absent;
    const rootSourceHasRecord = !rootSourcePresence.absent;
    if (stableHasRecord === rootSourceHasRecord) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'requester grant backing binding namespace cardinality must equal exactly one');
    }
    bindingResult = stableHasRecord
      ? rll.validateRequesterBindingFor(projectRoot, grant.binding_id, grant.role, grant.worktree_id, grant.plan_digest)
      : rll.validateRootSourceBindingFor(projectRoot, grant.binding_id, grant.role, grant.worktree_id, grant.plan_digest);
  } else {
    const roleActorPresence = rll.readRegistryRecord(rll.roleActorBindingPathFor({ repoId }, grant.binding_id));
    if (!roleActorPresence.ok) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'target role-actor binding namespace read failed: ' + roleActorPresence.reason);
    }
    const oneShotPresence = rll.readRegistryRecord(rll.claudeOneShotBindingPathFor({ repoId }, grant.binding_id));
    if (!oneShotPresence.ok) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'target one-shot binding namespace read failed: ' + oneShotPresence.reason);
    }
    const roleActorHasRecord = !roleActorPresence.absent;
    const oneShotHasRecord = !oneShotPresence.absent;
    if (roleActorHasRecord === oneShotHasRecord) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'target grant backing binding namespace cardinality must equal exactly one');
    }
    // The one-shot side's own full validator (never a bare namespace check
    // alone) additionally proves the Claude-domain fence/generation cuts --
    // the discrimination above only decides WHICH validator to consult.
    bindingResult = roleActorHasRecord
      ? rll.validateRoleActorBindingFor(projectRoot, grant.binding_id, grant.role, grant.worktree_id, grant.plan_digest)
      : rll.validateClaudeOneShotBindingFor(projectRoot, grant.binding_id, {
        requestId: grant.request_id, attemptId: grant.attempt_id, leaseEpoch: grant.lease_epoch,
        role: grant.role, worktreeId: grant.worktree_id, planDigest: grant.plan_digest,
      });
  }
  if (!bindingResult.ok) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant backing binding invalid: ' + bindingResult.reason);
  }
  if (bindingResult.binding.actor_instance_id !== grant.actor_instance_id) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant actor_instance_id does not match its own backing binding');
  }

  return {
    repoId,
    bindingSchema: bindingResult.binding.schema,
    bindingId: grant.binding_id,
    requestId: grant.request_id,
    attemptId: grant.attempt_id,
    leaseEpoch: grant.lease_epoch,
    role: grant.role,
    actorInstanceId: grant.actor_instance_id,
    binding: bindingResult.binding,
    // M7 GREEN section 4.4: the durable GRANT's own expiry, internal/
    // non-wire -- consume-grant admission must bind its deadline to this
    // (the grant's own <=30s TTL), never the backing binding's own
    // (potentially much longer-lived) expiry.
    grantExpiry: grant.expiry,
  };
}

/**
 * Commits one-time role-command-grant consumption after every independent
 * grant, binding and transaction-scope check has passed. This is the first
 * mutation in the authority path; invalid transaction scope therefore leaves
 * no `.consumed` marker behind.
 */
function consumeValidatedRoleCommandGrantOrThrow(repoId, grantId) {
  // Atomic one-time consumption: no-clobber marker create. EEXIST == replay.
  const consumedPath = roleCommandGrantConsumedMarkerPathFor(repoId, grantId);
  const dirResult = localEnsureSecureRegistryDir(path.dirname(consumedPath));
  if (!dirResult.ok) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'unable to prepare role-command-grant consumption directory');
  }
  try {
    // suppressReplacePostRenameFaultInjection + suppressInternalFaultInjection
    // (M7 completeness, sibling fix): this write runs after independent
    // transaction accreditation but before any handler/business-logic lock,
    // so it must never be the one to "eat" a
    // RUNTIME_CONSULTATION_FAULT_REPLACE_POSTRENAME/TEMP_HARDEN/
    // NOCLOBBER_PRELINK/LOSER_UNLINK/DIR_FSYNC/DIR_CLOSE/TEMP_UNLINK/
    // NOCLOBBER_PREVALIDATE env var a test set to target a LATER, unrelated
    // publishReplace/publishNoClobber call inside the actual command handler
    // (e.g. cmdLeaseHeartbeat's own active-lease refresh, or
    // cmdPublishRequest's own plan_ref/routing-policy/subject-bundle/
    // request.json writes) -- see publishNoClobber's own doc comment for both
    // options. Test-instrumentation-scope only; zero effect in production
    // (every underlying isXFaultActive predicate is itself
    // isTestCapability()-gated regardless of either flag) -- every real
    // durability/replay/security check this write performs is completely
    // unaffected.
    publishNoClobber(consumedPath, Buffer.from(canonicalJSONStringify({ consumed_at: nowIso() }), 'utf8'), {
      suppressReplacePostRenameFaultInjection: true,
      suppressInternalFaultInjection: true,
    });
  } catch (err) {
    // publishNoClobber (called here with no allowIdenticalIdempotent/raceDetailCode
    // option) throws CliError(INVALID, AUTHORITY_INVALID, 'no-clobber race lost for
    // ...') ONLY for a genuine EEXIST collision whose own loser-cleanup succeeded --
    // i.e. exactly a replay of an already-consumed grant. Every OTHER failure mode it
    // can throw for this call shape -- DURABILITY_UNPROVEN (barrier/temp-harden/
    // post-publish-revalidation faults, including the shared assertDurableTargetMatches
    // fault-injection seams used by LOCK-10/UMASK-0600-03), SECURITY_INVALID (symlink/
    // tamper), or a raw non-CliError fs error -- is NOT a replay and must propagate
    // with its own real classification, never be relabeled as one (confirmed by
    // reading publishNoClobber's complete body: AUTHORITY_INVALID is unreachable from
    // any other branch when allowIdenticalIdempotent is unset, as it always is here).
    if (err instanceof CliError && err.detailCode === 'AUTHORITY_INVALID') {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant already consumed (replay)');
    }
    throw err;
  }
}

  return Object.freeze({
    consumeValidatedRoleCommandGrantOrThrow,
    validateRoleCommandGrantOrThrow,
  });
}

module.exports = { createRoleCommandGrant };
