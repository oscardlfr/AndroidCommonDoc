'use strict';

// Root-source-initiated publish-request lookup and CLI-result serialization.

function createRootSourcePublish({
  CliError,
  computeRepoId,
  fs,
  getRuntimeRoleLifecycle,
  isHexId,
  path,
  planRootPath,
  readCanonicalRequestRecord,
  requestPathFor,
  resolveAbsolute,
  sha256File,
}) {
/**
 * PLAN.md §16b WAL serialization for the root-source one-shot requester.
 * Bounded scan of an ALREADY-owned transactions/ directory for a root
 * (parent_request_id:null) request this exact binding's actor already
 * published -- actor_instance_id is minted once per root-source binding and
 * stamped onto any request it publishes via cmdPublishRequest's own
 * requesterInstanceId field, so it is a reliable, already-existing
 * idempotency key. No new schema/record type is introduced. Mirrors
 * hostBridgePublishChildRequest's own bounded transactions/ scan (cap,
 * isHexId filter, fail-closed on an unaccredited entry) above.
 */
function findRootSourceActorRequest(planRoot, actorInstanceId) {
  const transactionsDir = path.join(planRoot, 'transactions');
  let entries;
  try { entries = fs.readdirSync(transactionsDir, { withFileTypes: true }); }
  catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'unable to inspect root-source publish inventory');
  }
  if (entries.length > 4096) throw new CliError('INVALID', 'SECURITY_INVALID', 'root-source publish inventory cap exceeded');
  let found = null;
  for (const entry of entries) {
    if (!entry.isDirectory() || !isHexId(entry.name)) continue;
    const candidatePath = requestPathFor(planRoot, entry.name);
    let candidate;
    try { candidate = readCanonicalRequestRecord(candidatePath, entry.name, {}); }
    catch (err) { throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'root-source publish inventory contains an unaccredited request'); }
    const obj = candidate.obj;
    if (obj.source_role === 'toolkit-specialist' && obj.parent_request_id === null && obj.requester_instance_id === actorInstanceId) {
      if (found) throw new CliError('INVALID', 'CORRELATION_INVALID', 'root-source publish inventory has more than one root request for the same actor');
      found = { requestId: obj.request_id, path: candidatePath, digest: candidate.digest };
    }
  }
  return found;
}

/**
 * PLAN.md §16b: serializes cmdPublishRequest+publishRootIngress under
 * rootSourceLockDirFor(bindingId) so two concurrent grants for the SAME
 * binding can never produce two roots, and a crash between request.json
 * durably publishing and root-ingress durably publishing recovers the
 * EXISTING request on the next attempt instead of minting another one.
 * Revalidates the binding fresh INSIDE the lock -- never trusts the
 * pre-lock grantContext snapshot for the liveness/retirement decision.
 */
function serializeRootSourcePublishRequest(grantContext, flags, handler) {
  const rll = getRuntimeRoleLifecycle();
  const repoDescriptor = { repoId: grantContext.repoId };
  const bindingId = grantContext.bindingId;
  const lockDir = rll.rootSourceLockDirFor(repoDescriptor, bindingId);
  const locked = rll.withRegistryLock(lockDir, () => {
    const revalidated = rll.validateRootSourceBindingFor(
      repoDescriptor, bindingId, 'toolkit-specialist',
      grantContext.binding.worktree_id, grantContext.binding.plan_digest,
    );
    if (!revalidated.ok) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-source binding is no longer valid: ' + revalidated.reason);
    }

    const coordRoot = resolveAbsolute(flags['coordination-root']);
    const planPath = resolveAbsolute(flags.plan);
    const planDigest = sha256File(planPath);
    const waveSlug = path.basename(path.dirname(planPath)).replace(/^wave-/, '');
    const repoId = computeRepoId(coordRoot);
    const planRoot = planRootPath(coordRoot, repoId, waveSlug, planDigest);
    const existing = findRootSourceActorRequest(planRoot, revalidated.binding.actor_instance_id);

    const extra = existing
      ? { request_id: existing.requestId, artifact_ref: existing.path }
      : (handler(flags, grantContext) || {});
    const reqPath = resolveAbsolute(extra.artifact_ref);
    const reqRec = readCanonicalRequestRecord(reqPath, extra.request_id, {});

    const existingIngress = rll.readRegistryRecord(rll.rootSourceIngressPathFor(repoDescriptor, bindingId));
    if (!existingIngress.ok) throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'root-source ingress registry unreadable');
    if (!existingIngress.absent) {
      if (existingIngress.obj.request_id !== reqRec.obj.request_id || existingIngress.obj.request_digest !== reqRec.digest) {
        throw new CliError('INVALID', 'CORRELATION_INVALID', 'root-source ingress does not correlate with the recovered request');
      }
      return extra;
    }

    const ingress = rll.publishRootIngress(repoDescriptor, revalidated.binding, {
      requestId: reqRec.obj.request_id, requestDigest: reqRec.digest,
    });
    if (!ingress || ingress.ok !== true) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'request published but root-source ingress could not be proven durable');
    }
    return extra;
  });
  if (!locked || locked.ok !== true) {
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'root-source publish-request WAL lock/advance failed');
  }
  return locked.value;
}

  return Object.freeze({
    findRootSourceActorRequest,
    serializeRootSourcePublishRequest,
  });
}

module.exports = { createRootSourcePublish };
