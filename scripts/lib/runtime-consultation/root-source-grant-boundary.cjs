'use strict';

// Root-source ingress correlation, requester-grant-scope resolution, and the single validate+consume authority gate every grant-gated CLI command routes through.

function createRootSourceGrantBoundary({
  CliError,
  DURABLE_ABSENT,
  DURABLE_PENDING,
  ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND,
  ROLE_COMMAND_GRANT_FLAG_FOR_AUTHORITY,
  ROOT_SOURCE_BINDING_SCHEMA_LOCAL,
  ROOT_SOURCE_BINDING_SCHEMA_V2,
  ROOT_SOURCE_POST_INGRESS_COMMANDS,
  ROOT_SOURCE_PRE_INGRESS_COMMANDS,
  accreditCanonicalRequest,
  ackPathFor,
  cancelPathFor,
  canonicalJSONStringify,
  classifyDurableRead,
  computeRepoId,
  computeWorktreeId,
  consumeValidatedRoleCommandGrantOrThrow,
  decodeIntentOrThrow,
  getRuntimeRoleLifecycle,
  gitRevParse,
  path,
  readCanonicalCancelRecordOptional,
  realpathDeepestExisting,
  realpathOrSelf,
  resolveAbsolute,
  resolveAuthoritativeAttempt,
  sha256File,
  sha256String,
  testM7Rendezvous,
  validateRoleCommandGrantOrThrow,
}) {
// M6+M7 requester-authority closure (Group B): the closed null/non-null
// requester-grant-scope table (PLAN.md ~L592). Administrative/pre-request
// subcommands and a session-shutdown worker-stop carry no transaction scope
// at all; every other requester subcommand binds the exact request and its
// CURRENT authoritative attempt/epoch.
const REQUESTER_GRANT_NULL_SCOPE_SUBCOMMANDS = new Set([
  'root-init', 'root-validate', 'validate', 'publish-blob', 'publish-request',
]);
const REQUESTER_GRANT_TRANSACTIONAL_SUBCOMMANDS = new Set([
  'dispatch', 'takeover', 'await-result', 'accept-result', 'transaction-ack',
  'cancel', 'cleanup', 'record-delivery', 'worker-stop',
]);

// M7 GREEN section 4.10: the consultation-local shape table + duplicate
// correlation logic this used to be is superseded and removed -- delegates
// entirely to the ONE canonical rll.validateRootSourceIngressRecord instead
// (M7 section 6/12: every duplicated per-family shape-checker is superseded
// by the shared validator).
function readRootSourceIngressOrThrow(validated) {
  let rll;
  try { rll = getRuntimeRoleLifecycle(); }
  catch (err) { throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-source lifecycle unavailable'); }
  const ingressPath = rll.rootSourceIngressPathFor({ repoId: validated.repoId }, validated.bindingId);
  const read = rll.readRegistryRecord(ingressPath);
  if (!read || read.ok !== true) throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'root-source ingress read failed');
  if (read.absent) return null;
  const binding = validated.binding;
  const checked = rll.validateRootSourceIngressRecord(read.obj, {
    binding_id: binding.binding_id, action_id: binding.action_id,
    source_role: binding.role, requester_instance_id: binding.actor_instance_id,
    subject_scope_digest: binding.subject_scope_digest, request_expiry: binding.request_expiry,
    worktree_id: binding.worktree_id, plan_digest: binding.plan_digest,
  });
  if (!checked.ok) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-source ingress does not correlate to its binding');
  return checked.record;
}

function enforceRootSourceGrantBoundary(validated, command, flags, expectedScope) {
  if (validated.bindingSchema !== ROOT_SOURCE_BINDING_SCHEMA_LOCAL && validated.bindingSchema !== ROOT_SOURCE_BINDING_SCHEMA_V2) return;
  const ingress = readRootSourceIngressOrThrow(validated);
  if (ingress === null) {
    if (!ROOT_SOURCE_PRE_INGRESS_COMMANDS.has(command)) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-source command is not admitted before ingress');
    }
    if (validated.requestId !== null || validated.attemptId !== null || validated.leaseEpoch !== null) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'pre-ingress root-source grant must have null transaction scope');
    }
    if (command === 'publish-request') {
      const intent = decodeIntentOrThrow(flags.intent);
      let lifecycleIntent;
      try {
        const rll = getRuntimeRoleLifecycle();
        lifecycleIntent = rll.decodeRootSourceBootstrapIntentForBinding(
          { repoId: validated.repoId }, validated.binding,
        );
      } catch (err) {
        lifecycleIntent = { ok: false, reason: 'root-source-bootstrap-decoder-unavailable' };
      }
      if (!lifecycleIntent || lifecycleIntent.ok !== true || !lifecycleIntent.intent) {
        throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-source bootstrap intent is not host-accredited');
      }
      const expectedIntent = lifecycleIntent.intent;
      if (
        intent.target_role !== 'arch-platform' || intent.target_role !== expectedIntent.target_role
        || intent.parent_request_id !== undefined || intent.content_ref !== undefined
        || intent.question !== expectedIntent.question
        || intent.expected_result_kind !== expectedIntent.expected_result_kind
        || intent.expiry !== expectedIntent.expiry
        || intent.expiry !== validated.binding.request_expiry
      ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-source publish intent violates its exact root topology/target/expiry');
      const planPath = resolveAbsolute(flags.plan);
      // S16-ROOT-SOURCE-E2E finding: subject_bundle_ref is a coordination-
      // root-RELATIVE ref (s16CoordinationRelativeRef's own output, mirrored
      // by every other reader of a *_ref field in this file, e.g.
      // requestPathFor(planRoot, ...) below) -- resolveAbsolute() alone
      // resolves it against the CLI process's cwd, not the coordination
      // root, so it could never equal the caller's own absolute
      // --subject-bundle path for any cwd other than the coordination root
      // itself. Join it against the same --coordination-root every other
      // check in this function already trusts.
      const coordRootForScope = resolveAbsolute(flags['coordination-root']);
      if (
        resolveAbsolute(flags['subject-bundle']) !== path.join(coordRootForScope, validated.binding.subject_bundle_ref)
        || sha256File(planPath) !== validated.binding.plan_digest
      ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-source publish intent violates its PLAN/subject scope');
    }
    return;
  }
  if (!ROOT_SOURCE_POST_INGRESS_COMMANDS.has(command)) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-source command is not admitted after ingress');
  }
  if (
    expectedScope.requestId !== ingress.request_id
    || expectedScope.sourceRole !== ingress.source_role
    || expectedScope.requesterInstanceId !== ingress.requester_instance_id
    || validated.requestId !== ingress.request_id
  ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-source post-ingress grant does not match its sole transaction');

  // M7 defect (task #30, symmetric to validateAndConsumeRoleCommandGrantForCommand's
  // own one-shot terminal recheck a few dozen lines below in the same file):
  // a root-source-backed requester grant minted while its transaction was
  // still live becomes stale the instant a terminal (ack or cancel) lands
  // afterward -- re-checked here, immediately before this function returns
  // control for consumption. Mirrors readRootSourceTerminalArtifacts's own
  // ack/cancel pair (never "result", a different concept at the root-source
  // layer). ackPathFor has no audited call-site count (unlike
  // cancelPathFor/CANCEL-AUDIT-02) so a direct presence-only
  // classifyDurableRead is used, symmetric with the one-shot fix's own
  // unaudited resultState check; cancelPathFor still goes through the one
  // sanctioned choke point. flags.request/--coordination-root are already
  // proven resolvable -- resolveRequesterGrantScope (this function's own
  // caller, immediately above) required both to reach expectedScope.ok.
  const requesterTxnDir = path.dirname(resolveAbsolute(flags.request));
  const ackState = classifyDurableRead(ackPathFor(requesterTxnDir), { parse: true });
  if (ackState.state === DURABLE_PENDING) {
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', command + ': root-source ack terminal is pending, durability unproven');
  }
  const cancelPresent = readCanonicalCancelRecordOptional(cancelPathFor(requesterTxnDir), resolveAbsolute(flags['coordination-root'])) !== null;
  if (ackState.state !== DURABLE_ABSENT || cancelPresent) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', command + ': role-command-grant backing root-source transaction already has a terminal (ack or cancel)');
  }
}

/**
 * M6+M7 requester-authority closure (Group B): the SINGLE shared resolver
 * for a requester subcommand's exact required request_id/attempt_id/
 * lease_epoch scope, plus (when a request already exists) its own
 * source_role/requester_instance_id -- used BOTH by the hook (to mint a
 * grant bound to the correct scope) and by this file's own main() (to
 * re-derive and cross-check the SAME scope before consuming a presented
 * grant, never trusting the grant's own claimed fields alone). Reuses the
 * existing accredited-request-read primitive and resolveAuthoritativeAttempt
 * -- never a second, weaker ad hoc parse. `record-delivery`'s own additional
 * "argv attempt/epoch must equal both the grant and current transaction"
 * requirement is satisfied by composition: this resolver already binds the
 * grant to the current authoritative attempt/epoch, and cmdRecordDelivery's
 * own existing, independent business logic already requires its
 * --attempt/--epoch argv to equal that SAME current authoritative pair.
 * @param {string} subcommand
 * @param {object} flags - parseFlags()-shaped (or an equivalent plain
 *   object carrying the SAME bare-flag-name keys a hook constructs from its
 *   own parsed argv).
 * @returns {{ok:true,requestId:string|null,attemptId:string|null,leaseEpoch:number|null,sourceRole:string|null,requesterInstanceId:string|null}|{ok:false,reason:string}}
 */
function resolveRequesterGrantScope(subcommand, flags) {
  if (REQUESTER_GRANT_NULL_SCOPE_SUBCOMMANDS.has(subcommand)) {
    return { ok: true, requestId: null, attemptId: null, leaseEpoch: null, sourceRole: null, requesterInstanceId: null };
  }
  if (subcommand === 'worker-stop' && flags && flags.kind === 'session-shutdown') {
    return { ok: true, requestId: null, attemptId: null, leaseEpoch: null, sourceRole: null, requesterInstanceId: null };
  }
  if (!REQUESTER_GRANT_TRANSACTIONAL_SUBCOMMANDS.has(subcommand)) {
    return { ok: false, reason: 'unrecognized-requester-subcommand' };
  }
  if (!flags || typeof flags.request !== 'string' || flags.request.length === 0) {
    return { ok: false, reason: 'missing-request-flag' };
  }
  if (typeof flags['coordination-root'] !== 'string' || flags['coordination-root'].length === 0) {
    return { ok: false, reason: 'missing-coordination-root-flag' };
  }
  let coordRoot;
  let requestPath;
  try {
    coordRoot = resolveAbsolute(flags['coordination-root']);
    requestPath = resolveAbsolute(flags.request);
  } catch (err) {
    return { ok: false, reason: 'invalid-scope-path' };
  }
  let preflight;
  try {
    preflight = accreditCanonicalRequest(coordRoot, requestPath);
  } catch (err) {
    // Preserve the specific accreditation failure (e.g. SECURITY_INVALID for
    // a path-segment mismatch, CORRELATION_INVALID for an unresolvable
    // request) so the caller below can surface it instead of a generic
    // AUTHORITY_INVALID -- only for the well-known CliError shape; any other
    // throw keeps the existing generic-only reason (fail safe, never assume
    // an unverified shape).
    if (err instanceof CliError) {
      return { ok: false, reason: 'request-not-accredited', status: err.status, detailCode: err.detailCode, message: err.message };
    }
    return { ok: false, reason: 'request-not-accredited' };
  }
  const reqObj = preflight.obj;
  const txnDir = path.dirname(requestPath);
  let auth;
  try {
    auth = resolveAuthoritativeAttempt(reqObj, txnDir);
  } catch (err) {
    return { ok: false, reason: 'attempt-not-resolvable' };
  }
  return {
    ok: true,
    requestId: reqObj.request_id,
    attemptId: auth.attemptId,
    leaseEpoch: auth.leaseEpoch,
    sourceRole: reqObj.source_role,
    requesterInstanceId: reqObj.requester_instance_id,
  };
}

/**
 * Generic entry point called from main() BEFORE the command handler runs
 * (PLAN.md ~L604: "before any read or mutation"). No-op for any command
 * outside ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND's deliberately narrow
 * scope. `rawArgv` is the exact pre-parseFlags flag-token array (argv.slice(1)
 * in main()) -- the grant flag+value pair is located and stripped from it
 * here, and the remainder, in original relative order, is re-hashed and
 * compared against the grant's own canonical_argv_digest (PLAN.md ~L604:
 * "strips only its own injected flag, recomputes the exact pre-injection
 * argv digest").
 */
function validateAndConsumeRoleCommandGrantForCommand(command, flags, rawArgv) {
  const authority = ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND[command];
  if (!authority) return undefined; // not grant-gated in this pass's scope.
  const grantFlagBare = ROLE_COMMAND_GRANT_FLAG_FOR_AUTHORITY[authority];
  const grantFlagToken = '--' + grantFlagBare;

  const idx = rawArgv.indexOf(grantFlagToken);
  if (idx === -1 || idx + 1 >= rawArgv.length) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'missing required --' + grantFlagBare + ' for ' + command);
  }
  if (rawArgv.indexOf(grantFlagToken, idx + 1) !== -1) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'duplicate --' + grantFlagBare);
  }
  const grantId = rawArgv[idx + 1];
  const preInjectionArgv = rawArgv.slice(0, idx).concat(rawArgv.slice(idx + 2));
  const argvDigest = sha256String(canonicalJSONStringify(preInjectionArgv));

  const coordRootRaw = flags['coordination-root'];
  if (typeof coordRootRaw !== 'string' || coordRootRaw.length === 0) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', command + ' requires --coordination-root to resolve grant scope');
  }
  const coordRoot = resolveAbsolute(coordRootRaw);

  let repoId;
  let projectRoot;
  let coordRootExistingAncestor;
  let coordRootTail;
  try {
    const resolved = realpathDeepestExisting(coordRoot);
    coordRootExistingAncestor = resolved.real;
    coordRootTail = resolved.tail;
    repoId = computeRepoId(coordRootExistingAncestor);
    projectRoot = gitRevParse(coordRootExistingAncestor, ['rev-parse', '--show-toplevel']);
  } catch (err) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'unable to resolve role-command-grant registry scope for ' + command);
  }

  // Validate the durable grant and its backing binding without mutating the
  // one-shot consumption state. Requester transaction scope is independently
  // re-derived below before the consumption marker is allowed to exist.
  const validated = validateRoleCommandGrantOrThrow(repoId, projectRoot, grantId, argvDigest, authority, command);

  // M6+M7 requester-authority closure (Group B): the grant's own scope
  // fields are re-derived HERE, independently, from the CURRENT transaction
  // state -- never merely trusted as whatever was embedded at mint time.
  // Only 'requester' authority carries this exact scope contract; 'target'
  // authority is a disjoint schema this file does not mint.
  if (authority === 'requester') {
    const expectedScope = resolveRequesterGrantScope(command, flags);
    if (!expectedScope.ok) {
      // Re-surface the specific underlying accreditation failure when one is
      // available (see resolveRequesterGrantScope's own catch block) rather
      // than collapsing every failure reason to a generic AUTHORITY_INVALID.
      // The other resolveRequesterGrantScope failure reasons (missing-request
      // -flag, missing-coordination-root-flag, invalid-scope-path,
      // attempt-not-resolvable, unrecognized-requester-subcommand) never set
      // detailCode -- those are genuinely grant-scope-level problems, not the
      // underlying request's own validity, so they keep the generic behavior.
      if (expectedScope.detailCode) {
        throw new CliError(expectedScope.status, expectedScope.detailCode, expectedScope.message || ('unable to re-derive requester grant scope for ' + command));
      }
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'unable to re-derive requester grant scope for ' + command + ': ' + expectedScope.reason);
    }
    if (
      validated.requestId !== expectedScope.requestId
      || validated.attemptId !== expectedScope.attemptId
      || validated.leaseEpoch !== expectedScope.leaseEpoch
    ) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant request/attempt/epoch does not match the current authoritative transaction');
    }
    if (expectedScope.sourceRole !== null && expectedScope.sourceRole !== validated.role) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant role does not match the request\'s own source_role');
    }
    if (expectedScope.requesterInstanceId !== null && expectedScope.requesterInstanceId !== validated.actorInstanceId) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant actor does not match the request\'s own requester_instance_id');
    }
    enforceRootSourceGrantBoundary(validated, command, flags, expectedScope);
  }

  // M7 defect 5 (section 7): "validateAndConsumeRoleCommandGrantForCommand
  // obtains and consumes a consume-grant capability immediately before its
  // existing one-use grant marker, then returns it only to that in-process
  // handler invocation." Only a Claude v2-backed grant (requester/
  // root-source/one-shot, and for requester only when its own backing runs
  // on the claude-hook provider -- defect 11) goes through the classifier
  // pass; RoleActor/Codex-supervisor-backed grants keep their existing,
  // unchanged consumption path. The schema literals below are this file's
  // own frozen M7 v2 schema strings (section 4.1/4.2/4.3) -- runtime-role-
  // lifecycle.cjs does not export these as constants, only `bindingSchema`
  // (a plain string already returned by validateRoleCommandGrantOrThrow).
  const rllForConsumeGrant = getRuntimeRoleLifecycle();
  const claudeAuthorityFamily = (
    validated.bindingSchema === 'runtime/root-source-binding/v2' ? 'root-source'
      : validated.bindingSchema === 'runtime/claude-one-shot-binding/v2' ? 'one-shot'
        : validated.bindingSchema === 'coordination/requester-binding/v2' ? 'requester'
          : null
  );
  const isClaudeAuthorityV2Backing = (
    claudeAuthorityFamily === 'root-source' || claudeAuthorityFamily === 'one-shot'
    || (claudeAuthorityFamily === 'requester' && validated.binding.runtime === 'claude-hook')
  );

  let consumeCapability = null;
  if (isClaudeAuthorityV2Backing) {
    // M7 CORRECTION C2 (Codex final ruling, frozen contract SHA
    // 3341aff5c7ce1e7953bc82084542750241274807ee2ed36e0365095c7249e6a6):
    // resolve canonical PROJECT scope and prove --coordination-root really
    // is the canonical coordination root for it -- admission must receive
    // project scope only, never a bare {repoId} descriptor or any
    // caller-selected path/terminal summary.
    let canonicalCoordRoot;
    try {
      canonicalCoordRoot = rllForConsumeGrant.coordinationRootPathFor(projectRoot);
    } catch (err) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', command + ': unable to resolve canonical coordination root for its own project');
    }
    // coordRoot itself may not exist yet (root-init's own job is to create
    // it), so a naive realpathOrSelf(coordRoot) silently skips desymlinking
    // whenever ANY path segment is still missing -- on a platform where a
    // temp-dir prefix is itself a symlink (e.g. macOS /var -> /private/var),
    // that wrongly rejected a genuinely-canonical --coordination-root as
    // non-canonical, because canonicalCoordRoot's own deepest-existing-
    // ancestor resolution (coordinationRootPathFor) DOES desymlink that
    // exact prefix. Reconstruct coordRoot's own fully-resolved-as-far-as-
    // possible form the SAME way (mirrors assertGenuinelyConfinedUnderRoot's
    // own fullReal pattern, this file) before comparing.
    const coordRootFullyResolved = coordRootTail.length
      ? path.join(coordRootExistingAncestor, ...coordRootTail)
      : coordRootExistingAncestor;
    if (realpathOrSelf(canonicalCoordRoot) !== coordRootFullyResolved) {
      throw new CliError('INVALID', 'SECURITY_INVALID', command + ': --coordination-root is not the canonical coordination root for its own project');
    }

    // M7 CORRECTION C2: fd-accredit --request (when present -- worker-
    // stop-ack and the null-scope requester admin subcommands never carry
    // it) and correlate its OWN embedded scope against the validated grant
    // + backing binding BEFORE admission. Closes the confirmed argv-digest
    // decoupling exploit: mintRoleCommandGrant's argvDigest parameter is
    // caller-supplied and fully decoupled from its own requestId/attemptId/
    // leaseEpoch parameters, so a grant can be minted with requestId=A
    // (real) but an argv whose --request names an unrelated decoy
    // transaction B; a real CLI call using --request B then passes
    // validateRoleCommandGrantOrThrow cleanly (digest matches B), yet
    // nothing else ever proved THIS invocation's own --request is the SAME
    // transaction the grant's stored requestId names.
    if (typeof flags.request === 'string' && flags.request.length > 0) {
      let accreditedRequest;
      let requestPathForAccreditation;
      try {
        requestPathForAccreditation = resolveAbsolute(flags.request);
        accreditedRequest = accreditCanonicalRequest(coordRoot, requestPathForAccreditation);
      } catch (err) {
        throw new CliError('INVALID', 'AUTHORITY_INVALID', command + ': unable to accredit --request');
      }
      const accreditedReqObj = accreditedRequest.obj;
      const accreditedTxnDir = path.dirname(requestPathForAccreditation);
      let accreditedAuth;
      try {
        accreditedAuth = resolveAuthoritativeAttempt(accreditedReqObj, accreditedTxnDir);
      } catch (err) {
        throw new CliError('INVALID', 'AUTHORITY_INVALID', command + ": --request's authoritative attempt is not resolvable");
      }
      const expectedRoleField = authority === 'requester' ? accreditedReqObj.source_role : accreditedReqObj.target_role;
      // M7 GREEN correction round 2, R2: the classifier itself deliberately
      // does not filter candidates by worktree (a current unexpired v2
      // record is a candidate "even when its PLAN/worktree/role differs"),
      // so THIS Phase A correlation is the only layer that can reject a
      // cross-worktree replay -- confirmed by direct read that this block
      // previously checked repo_id/plan_digest/request_id/attempt_id/
      // lease_epoch/role but never worktree_id at all. Triple-correlates the
      // binding's own worktree_id, the accredited request's own worktree
      // field (subject_worktree_id for target authority,
      // requester_worktree_id for requester authority), and the CURRENT
      // project's own live worktree -- never merely two of the three.
      const expectedWorktreeField = authority === 'requester' ? accreditedReqObj.requester_worktree_id : accreditedReqObj.subject_worktree_id;
      if (
        accreditedReqObj.repo_id !== repoId || accreditedReqObj.plan_digest !== validated.binding.plan_digest
        || accreditedReqObj.request_id !== validated.requestId
        || accreditedAuth.attemptId !== validated.attemptId || accreditedAuth.leaseEpoch !== validated.leaseEpoch
        || expectedRoleField !== validated.role
        || expectedWorktreeField !== validated.binding.worktree_id
        || expectedWorktreeField !== computeWorktreeId(projectRoot)
      ) {
        throw new CliError('INVALID', 'AUTHORITY_INVALID', command + ': accredited --request does not correlate to the validated role-command-grant');
      }
    }

    const agentIdForIdentity = validated.binding.agent_key !== undefined ? validated.binding.agent_key : validated.binding.agent_id;
    const consumeAuthorityIdentity = {
      schema: rllForConsumeGrant.CLAUDE_AUTHORITY_IDENTITY_SCHEMA, provider: 'claude-hook',
      repo_id: repoId, runtime_session_key: validated.binding.runtime_session_key, agent_id: agentIdForIdentity,
    };
    // M7 CORRECTION C1 (Codex final ruling): the ONE authority
    // linearization point is successful final admission -- this rendezvous
    // now sits immediately before admission, after ALL Phase A validation
    // (grant, requester-scope, and the --request accreditation/correlation
    // above) has fully run.
    testM7Rendezvous('command-before-admission', coordRoot);
    // M7 GREEN section 4.4 (R15-GRANT-EXPIRY-IS-CONSUME-DEADLINE): the
    // consume-grant deadline is the durable GRANT's own expiry, never the
    // backing binding's -- a long-lived binding must never let a
    // short-lived (<=30s TTL) grant be consumed past its own expiry.
    const admission = rllForConsumeGrant.admitClaudeAuthorityOperation(
      projectRoot, consumeAuthorityIdentity, 'consume-grant', validated.grantExpiry,
      { family: claudeAuthorityFamily, bindingId: validated.bindingId },
    );
    if (!admission.ok) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant consume-grant admission failed: ' + admission.reason);
    }
    consumeCapability = admission.capability;
  }

  // M7 section 10.3 (M7-COMMAND-ADMISSION-RACE-15 positive control) / M7
  // CORRECTION C1: this rendezvous stays in its ORIGINAL position -- AFTER
  // admission (the ONE authority linearization point; its own fence/
  // classifier/terminal decision is now frozen) and BEFORE consumption. A
  // cut landing during this exact pause must NEVER retroactively deny an
  // already-admitted command -- no recheck of any kind runs here anymore.
  testM7Rendezvous('command-after-admission-before-consume', coordRoot);

  if (isClaudeAuthorityV2Backing) {
    const guardedResult = rllForConsumeGrant.writeGuardedByClaudeAuthorityAdmission(consumeCapability, 'consume-grant', () => {
      consumeValidatedRoleCommandGrantOrThrow(repoId, grantId);
      return { ok: true };
    });
    if (!guardedResult.ok) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'role-command-grant consumption denied: ' + guardedResult.reason);
    }
  } else {
    consumeValidatedRoleCommandGrantOrThrow(repoId, grantId);
  }
  return validated;
}

  return Object.freeze({
    REQUESTER_GRANT_NULL_SCOPE_SUBCOMMANDS,
    REQUESTER_GRANT_TRANSACTIONAL_SUBCOMMANDS,
    enforceRootSourceGrantBoundary,
    readRootSourceIngressOrThrow,
    resolveRequesterGrantScope,
    validateAndConsumeRoleCommandGrantForCommand,
  });
}

module.exports = { createRootSourceGrantBoundary };
