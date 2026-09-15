'use strict';

function createAuthorityTransactions(deps) {
  const { fs, path, CLAUDE_ONE_SHOT_BINDING_SCHEMA_V2, REQUESTER_BINDING_SCHEMA_V2, ROOT_SOURCE_BINDING_SCHEMA_V2, computeRepoId, coordinationRootPathFor, discoverPlan, readRegistryRecord, rootSourceIngressPathFor, s16ConsultationApi, validateRootSourceIngressRecord } = deps;

function claudeAuthorityFamilyForBindingSchema(schema) {
  if (schema === REQUESTER_BINDING_SCHEMA_V2) return 'requester';
  if (schema === ROOT_SOURCE_BINDING_SCHEMA_V2) return 'root-source';
  if (schema === CLAUDE_ONE_SHOT_BINDING_SCHEMA_V2) return 'one-shot';
  return null;
}

/**
 * M7 section 5 point 5 / defect 6: fd-bound (never fs.existsSync) presence
 * check for one coordination-root transaction artifact -- a genuine read
 * error is never silently treated as absent, it fails closed.
 * @returns {{ok:true,present:boolean}|{ok:false,reason:string}}
 */
function readCoordinationArtifactPresence(artifactPath) {
  const read = readRegistryRecord(artifactPath);
  if (!read.ok) return { ok: false, reason: read.reason };
  return { ok: true, present: !read.absent };
}

/**
 * M7 GREEN section 4.3: the coordination-root transaction directory for
 * `requestId` under `planDigest`'s own scope -- extracted so both the
 * projectRoot-resolving wrappers below AND admission's own operationContext-
 * driven step-5 terminal read (which has no projectRoot to resolve from,
 * only a caller-supplied txnDir) share exactly one resolution formula.
 * @returns {{ok:true,txnDir:string}|{ok:false,reason:string}}
 */
function resolveM7TransactionDir(projectRoot, planDigest, requestId) {
  const planResult = discoverPlan(projectRoot);
  if (!planResult.ok) return { ok: false, reason: 'transaction-scope-unresolvable' };
  const waveSlug = path.basename(path.dirname(planResult.planPath)).replace(/^wave-/, '');
  const coordRoot = coordinationRootPathFor(projectRoot);
  const repoId = computeRepoId(projectRoot);
  return { ok: true, txnDir: path.join(coordRoot, repoId, waveSlug, planDigest, 'transactions', requestId) };
}

/**
 * M7 section 5 point 5 (root-source family proof, after ingress): neither
 * canonical ack.json nor cancel.json exists yet at `txnDir`. Shared by
 * mintRoleCommandGrant's own pre-write Phase-A check, its post-write
 * recheck (defect 4), and admission's own step-5 terminal read (M7 GREEN
 * section 4.3) -- exactly one implementation, never two that could silently
 * diverge.
 * @returns {{ok:true}|{ok:false,reason:string}}
 */
function checkRootSourceTransactionTerminalAbsentAtTxnDir(txnDir) {
  // A transaction with durable ingress must still be backed by its canonical
  // directory. On POSIX, probing `<plain-file>/ack.json` reports ENOTDIR;
  // native Windows reports ENOENT for the same topology. Validate the parent
  // object explicitly so neither platform can mistake replacement by a file
  // or symlink for an honestly absent terminal.
  let txnStat;
  try {
    txnStat = fs.lstatSync(txnDir);
  } catch (err) {
    return { ok: false, reason: 'root-source-transaction-directory-read-failed' };
  }
  if (!txnStat.isDirectory() || txnStat.isSymbolicLink()) {
    return { ok: false, reason: 'root-source-transaction-directory-invalid' };
  }
  const api = s16ConsultationApi();
  const ackRead = readCoordinationArtifactPresence(api.ackPathFor(txnDir));
  if (!ackRead.ok) return { ok: false, reason: 'root-source-transaction-terminal-read-failed:' + ackRead.reason };
  const cancelRead = readCoordinationArtifactPresence(api.cancelPathFor(txnDir));
  if (!cancelRead.ok) return { ok: false, reason: 'root-source-transaction-terminal-read-failed:' + cancelRead.reason };
  if (ackRead.present || cancelRead.present) return { ok: false, reason: 'root-source-transaction-terminal' };
  return { ok: true };
}

function checkRootSourceTransactionTerminalAbsent(projectRoot, binding, requestId) {
  const dirResult = resolveM7TransactionDir(projectRoot, binding.plan_digest, requestId);
  if (!dirResult.ok) return { ok: false, reason: 'root-source-scope-unresolvable' };
  return checkRootSourceTransactionTerminalAbsentAtTxnDir(dirResult.txnDir);
}

/**
 * M7 section 5 point 5 (one-shot family proof, section 8.5): neither the
 * authoritative result (results/<attempt>.json, never accepted-result.json)
 * nor canonical cancel.json exists yet at `txnDir` for `attemptId`. Shared by
 * mintRoleCommandGrant's pre-write Phase-A check, its post-write recheck
 * (defect 4), and admission's own step-5 terminal read (M7 GREEN section
 * 4.3).
 * @returns {{ok:true}|{ok:false,reason:string}}
 */
function checkOneShotTransactionTerminalAbsentAtTxnDir(txnDir, attemptId) {
  const api = s16ConsultationApi();
  const resultRead = readCoordinationArtifactPresence(api.resultPathFor(txnDir, attemptId));
  if (!resultRead.ok) return { ok: false, reason: 'claude-one-shot-transaction-terminal-read-failed:' + resultRead.reason };
  const cancelRead = readCoordinationArtifactPresence(api.cancelPathFor(txnDir));
  if (!cancelRead.ok) return { ok: false, reason: 'claude-one-shot-transaction-terminal-read-failed:' + cancelRead.reason };
  if (resultRead.present || cancelRead.present) return { ok: false, reason: 'claude-one-shot-transaction-terminal' };
  return { ok: true };
}

function checkOneShotTransactionTerminalAbsent(projectRoot, binding) {
  const dirResult = resolveM7TransactionDir(projectRoot, binding.plan_digest, binding.request_id);
  if (!dirResult.ok) return { ok: false, reason: 'claude-one-shot-scope-unresolvable' };
  return checkOneShotTransactionTerminalAbsentAtTxnDir(dirResult.txnDir, binding.attempt_id);
}

/**
 * M7 GREEN section 4.3 step 5 / M7 CORRECTION C2 (Codex final ruling): the
 * applicable authoritative transaction terminal for a mint-grant/
 * consume-grant operation against the classifier's OWN returned `binding`
 * (never a caller-selected one). `repoDescriptor` is canonical PROJECT scope
 * (a real projectRoot -- every admitClaudeAuthorityOperation caller now
 * supplies one, never a bare {repoId}) -- this function derives every
 * terminal-check path INTERNALLY from that scope plus the binding's own
 * fields, never from a caller-supplied path or precomputed terminal summary
 * (C2: the confirmed transaction-substitution exploit was a caller-selected
 * txnDir decoupled from the classifier's own resolved binding). One-shot
 * uses the binding's own request_id/attempt_id directly; root-source
 * independently reopens and re-reads its own ingress record (keyed off
 * binding.binding_id) to get a FRESH request_id, never trusting anything the
 * caller supplied. `family==='requester'` and a pre-ingress
 * `family==='root-source'` have no transaction terminal at all (section 4.3:
 * "requester/root pre-ingress has no transaction terminal").
 * @returns {{ok:true}|{ok:false,reason:string}}
 */
function checkAuthorityOperationTransactionTerminal(repoDescriptor, family, binding) {
  if (family === 'one-shot') {
    return checkOneShotTransactionTerminalAbsent(repoDescriptor, binding);
  }
  if (family === 'root-source') {
    const ingressRead = readRegistryRecord(rootSourceIngressPathFor(repoDescriptor, binding.binding_id));
    if (!ingressRead.ok) return { ok: false, reason: ingressRead.reason };
    if (ingressRead.absent) return { ok: true }; // pre-ingress: no transaction terminal exists yet.
    // M7 GREEN correction round 2, R2: a shallow "is request_id a string"
    // check is not the full section-6/10.2 ingress predicate -- it silently
    // accepted a shape-invalid or mis-correlated ingress record as long as
    // its request_id field happened to be string-typed. Full closed-shape
    // validation, correlated against the classifier's OWN binding (never a
    // caller-supplied summary), exactly mirrors mintRoleCommandGrant's own
    // established root-source ingress correlation (this file, Phase A of
    // the requester-authority root-source branch).
    const ingressValid = validateRootSourceIngressRecord(ingressRead.obj, {
      binding_id: binding.binding_id, action_id: binding.action_id,
      requester_instance_id: binding.actor_instance_id, source_role: 'toolkit-specialist',
      target_role: 'arch-platform', worktree_id: binding.worktree_id,
      plan_digest: binding.plan_digest, subject_scope_digest: binding.subject_scope_digest,
      request_expiry: binding.request_expiry,
    });
    if (!ingressValid.ok) return { ok: false, reason: 'root-source-transaction-terminal-read-failed:' + ingressValid.reason };
    return checkRootSourceTransactionTerminalAbsent(repoDescriptor, binding, ingressValid.record.request_id);
  }
  return { ok: true }; // 'requester' family: no transaction terminal concept.
}


  return Object.freeze({
    claudeAuthorityFamilyForBindingSchema, readCoordinationArtifactPresence, resolveM7TransactionDir, checkRootSourceTransactionTerminalAbsentAtTxnDir, checkRootSourceTransactionTerminalAbsent,
    checkOneShotTransactionTerminalAbsentAtTxnDir, checkOneShotTransactionTerminalAbsent, checkAuthorityOperationTransactionTerminal,
  });
}

module.exports = { createAuthorityTransactions };

