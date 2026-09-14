'use strict';

// Executes one full retained-worker consultation request: root/resumed turn dispatch, the mandatory internal-search + optional Context7 pattern-gap round trip, and the worker-presence/projection close-out.

function createRetainedWorkerRequest({
  CONTEXT_PROVIDER_EVIDENCE_INSTRUCTIONS,
  HOST_PATTERN_EVIDENCE_UNAVAILABLE_TURN_INPUT,
  SUPERVISOR_BASE_INSTRUCTIONS,
  backendDeadlineForRequest,
  classifyContext7Failure,
  closeTurnReadProjection,
  executeContext7Sequence,
  hostPatternEvidenceTurnInput,
  rc,
  replaceOwnedWorkerPresence,
  resumedTurnInputFor,
  rootTurnInputFor,
  runContextProviderInternalSearch,
  startAndAwaitWorkerTurn,
  waitForAcceptedChild,
}) {
async function executeRetainedWorkerRequest(worker, item) {
  const scheduled = rc.hostBridgeScheduleTurn(
    worker.capability, worker.coordinationRoot, item.requestPath, item.claimPath,
  );
  const deadlineMs = backendDeadlineForRequest(scheduled.request);
  if (!Number.isFinite(deadlineMs) || Date.now() >= deadlineMs) {
    throw new Error('backend-deadline-non-positive');
  }

  const thread = await worker.connection.threadStart({
    role: worker.role,
    developerInstructions: worker.profileBytes,
    baseInstructions: worker.role === 'context-provider'
      ? CONTEXT_PROVIDER_EVIDENCE_INSTRUCTIONS + '\n' + SUPERVISOR_BASE_INSTRUCTIONS
      : SUPERVISOR_BASE_INSTRUCTIONS,
    cwd: worker.cwd,
  }, { backendDeadlineMs: deadlineMs });
  if (!thread || thread.ok !== true) throw new Error((thread && thread.reason) || 'thread-start-failed');
  worker.threadId = thread.threadId;
  const activePresence = replaceOwnedWorkerPresence(worker.repoDescriptor, worker, worker.threadId);
  if (!activePresence.ok) throw new Error(activePresence.reason);

  const dependencies = [];
  const acceptedChildren = [];
  let consultCount = 0;
  let patternGapSeen = false;
  let patternEvidenceDependency = null;
  let internalSearch = null;
  // M6/M7 terminal functional closure, point D: the two host-derived facts
  // that gate every turnKindLock decision below -- never re-read from
  // anywhere else, never inferred from model output.
  const evidencePolicy = item.evidencePolicy === undefined ? 'none' : item.evidencePolicy;
  const approvedContext7LibraryId = item.approvedContext7LibraryId === undefined ? null : item.approvedContext7LibraryId;
  // Architect roles are exactly the non-context-provider roles this loop
  // ever reaches evidencePolicy:'context7-required' for (resolveRootEvidenceAuthority
  // only ever derives 'context7-required' for a context-provider root/child
  // itself or for arch-platform as a root-source root -- see that function's
  // own doc comment).
  const isReportingArchitect = worker.role !== 'context-provider';
  if (worker.role === 'context-provider') {
    // P1-A (section5 "one shared stop timeline"): "retain/join the actual
    // raw-MCP/SDK-close/request/waiter/observer/capture promises" -- this
    // whole await is already fully joined transitively (it is part of
    // worker.activePromise, which the coordinator's own stop timeline
    // awaits directly), but registerRawMcpPromise ADDITIONALLY hands the
    // coordinator the exact SAME live promise object -- never a counter --
    // so its own receipt can genuinely react to this SPECIFIC operation's
    // real settlement, independent of (and never merely inferred from) the
    // wrapping activePromise.
    const rawMcpSearchPromise = runContextProviderInternalSearch({
      projectRoot: worker.projectRoot,
      isolatedHome: worker.isolatedHome,
      question: item.question,
      requestExpiry: scheduled.request.expiry,
    }, worker.mcpChildOwnership);
    if (typeof worker.registerRawMcpPromise === 'function') worker.registerRawMcpPromise(rawMcpSearchPromise);
    internalSearch = await rawMcpSearchPromise;
  }
  const firstTurnInput = internalSearch === null
    ? rootTurnInputFor(worker, item)
    : [
      rootTurnInputFor(worker, item),
      'INTERNAL_SEARCH_SUMMARY/v1',
      'digest: ' + internalSearch.digest,
      internalSearch.summary,
    ].join('\n');
  let turn = await startAndAwaitWorkerTurn(
    worker, item, firstTurnInput,
    item.depth < item.maxDepth ? rc.hostBridgeAllowedChildRoles(worker.role) : [],
    deadlineMs, acceptedChildren,
    {
      executingRole: worker.role,
      patternGapAllowed: worker.role === 'context-provider',
      // Point D(a)/(d): the FIRST turn under context7-required OR
      // context7-preferred is forced schema-side to the one legitimate kind
      // for this role -- the reporting architect can only consult (never
      // terminate before its mandatory context-provider child), and
      // context-provider can only gap (never terminate before attempting
      // evidence) -- never a prompt instruction. context7-preferred differs
      // from context7-required only in what is ALLOWED to happen after that
      // one mandatory gap attempt (see the pattern-gap handling below), not
      // in whether the attempt itself is mandatory.
      turnKindLock: (evidencePolicy === 'context7-required' || evidencePolicy === 'context7-preferred')
        ? (isReportingArchitect ? 'consult-only' : 'gap-only')
        : null,
      // Point D(c): forces the architect's consult.question to be byte-
      // identical to the question it itself received, preserving any
      // embedded APPROVED_CONTEXT7_LIBRARY_ID/PREFERRED_CONTEXT7_LIBRARY_ID line end to end.
      requiredConsultQuestion: (evidencePolicy === 'context7-required' || evidencePolicy === 'context7-preferred') && isReportingArchitect ? item.question : null,
      // Point D(e)/E: forces context-provider's gap.library_id to the
      // already-known approved/preferred id (never null/search) once one is known.
      requiredGapLibraryId: (evidencePolicy === 'context7-required' || evidencePolicy === 'context7-preferred') && !isReportingArchitect ? approvedContext7LibraryId : null,
    },
  );
  if (!turn.ok) throw new Error(turn.reason || 'turn-completion-failed');

  for (;;) {
    const envelope = turn.envelope;
    if (envelope.kind === 'terminal-result') {
      if (
        worker.role === 'context-provider'
        && (item.evidencePolicy === 'context7-required' || item.evidencePolicy === 'context7-preferred')
        && !patternGapSeen
      ) {
        throw new Error('context7-required-terminal-before-gap');
      }
      // Point D(a)/(g) defense in depth: the schema-level turnKindLock above
      // already excludes this outcome; this mirrors context-provider's own
      // existing post-hoc guard for the reporting architect side.
      if (
        isReportingArchitect
        && (evidencePolicy === 'context7-required' || evidencePolicy === 'context7-preferred')
        && dependencies.length === 0
      ) {
        throw new Error('context7-required-terminal-before-consult');
      }
      rc.hostBridgePublishTerminalResult(
        worker.capability, worker.coordinationRoot, item.requestPath,
        item.claimPath, envelope.result, dependencies,
        envelope.result.status === 'BLOCKED' ? null : patternEvidenceDependency,
      );
      const archived = await worker.connection.threadArchive(worker.threadId, { backendDeadlineMs: deadlineMs });
      if (!archived || archived.ok !== true) throw new Error((archived && archived.reason) || 'thread-archive-failed');
      const projectionClosed = closeTurnReadProjection(worker);
      if (!projectionClosed.ok) throw new Error(projectionClosed.reason);
      const idlePresence = replaceOwnedWorkerPresence(worker.repoDescriptor, worker, null);
      if (!idlePresence.ok) throw new Error(idlePresence.reason);
      return;
    }

    if (envelope.kind === 'pattern-gap') {
      if (worker.role !== 'context-provider' || patternGapSeen || !internalSearch) {
        throw new Error('pattern-gap-scope-invalid');
      }
      patternGapSeen = true;
      let context7;
      const rawMcpContext7Promise = executeContext7Sequence({
        gap: envelope.gap,
        requestExpiry: scheduled.request.expiry,
      });
      if (typeof worker.registerRawMcpPromise === 'function') worker.registerRawMcpPromise(rawMcpContext7Promise);
      try {
        context7 = await rawMcpContext7Promise;
      } catch (err) {
        // WAVE1-FUNCTIONAL-CLOSEOUT-REALISTIC-20260822: under context7-preferred
        // only, an AVAILABILITY-class failure of this one already-attempted
        // gap (patternGapSeen is already true above -- never a second attempt)
        // degrades to an uncited ANSWERED result instead of failing the whole
        // turn. pattern_evidence_dependency stays null (never published here),
        // which is exactly what validatePatternEvidenceForResult and
        // hostBridgePublishTerminalResult's own context7-required-only
        // null-rejection checks already treat as legal for this policy --
        // mechanically DEGRADED_UNCITED, never ingestible. Every other
        // failure -- and every failure at all under context7-required --
        // still fails this turn closed, exactly as before.
        if (evidencePolicy !== 'context7-preferred' || classifyContext7Failure(err) !== 'availability') throw err;
        turn = await startAndAwaitWorkerTurn(
          worker, item, HOST_PATTERN_EVIDENCE_UNAVAILABLE_TURN_INPUT,
          [], deadlineMs, acceptedChildren,
          { executingRole: worker.role, patternGapAllowed: false, turnKindLock: 'terminal-only' },
        );
        if (!turn.ok) throw new Error(turn.reason || 'pattern-evidence-unavailable-turn-failed');
        continue;
      }
      const published = rc.hostBridgePublishPatternEvidence(
        worker.capability, worker.coordinationRoot, item.requestPath, item.claimPath,
        {
          turnId: turn.turnId,
          internalSearchDigest: internalSearch.digest,
          gap: envelope.gap,
          libraryId: context7.library_id,
          queryDigest: rc.sha256Buffer(Buffer.from(envelope.gap.query, 'utf8')),
          resolutionBytes: context7.resolution_bytes,
          contentBytes: context7.content_bytes,
        },
      );
      patternEvidenceDependency = published.dependency;
      turn = await startAndAwaitWorkerTurn(
        worker, item,
        hostPatternEvidenceTurnInput({
          contentBytes: context7.content_bytes,
          contentRef: published.contentRef,
          contentDigest: published.contentDigest,
        }),
        [], deadlineMs, acceptedChildren,
        // Point D(f): context-provider's turn after HOST_PATTERN_EVIDENCE is
        // already forced to terminal-only by the empty allowedChildRoles
        // (excludes consult-intent) plus patternGapAllowed:false (excludes a
        // second pattern-gap) -- an EXPLICIT turnKindLock here would be
        // redundant and would additionally change the exact rejection reason
        // an existing regression (S16-CP-EVIDENCE-SECOND-GAP-01) pins for a
        // second-gap attempt (`pattern-gap-forbidden-for-execution-context`).
        { executingRole: worker.role, patternGapAllowed: false },
      );
      if (!turn.ok) throw new Error(turn.reason || 'pattern-evidence-turn-failed');
      continue;
    }

    consultCount += 1;
    if (consultCount > 2) throw new Error('nested-consultation-budget-exhausted');
    const child = rc.hostBridgePublishChildRequest(
      worker.capability, worker.coordinationRoot, item.requestPath, envelope.consult,
    );
    const acceptedChild = await waitForAcceptedChild(worker, item, child.requestPath, deadlineMs);
    if (!acceptedChild.ok) throw new Error(acceptedChild.reason || 'child-consultation-failed');
    dependencies.push(acceptedChild.dependency);
    acceptedChildren.push(acceptedChild);
    // Point D(g): once the reporting architect's mandatory context-provider
    // child is accepted under context7-required or context7-preferred, the
    // resumed turn is forced to terminal-only -- a second consult is never
    // legitimate for this flow, regardless of the generic consultCount/depth
    // budget below.
    const architectMustTerminalOnly = isReportingArchitect
      && (evidencePolicy === 'context7-required' || evidencePolicy === 'context7-preferred');
    const allowed = architectMustTerminalOnly ? [] : (
      (consultCount < 2 && item.depth < item.maxDepth) ? rc.hostBridgeAllowedChildRoles(worker.role) : []
    );
    turn = await startAndAwaitWorkerTurn(
      worker, item, resumedTurnInputFor(worker, item, acceptedChild), allowed, deadlineMs, acceptedChildren,
      {
        executingRole: worker.role,
        patternGapAllowed: false,
        turnKindLock: architectMustTerminalOnly ? 'terminal-only' : null,
      },
    );
    if (!turn.ok) throw new Error(turn.reason || 'resumed-turn-completion-failed');
  }
}

  return Object.freeze({
    executeRetainedWorkerRequest,
  });
}

module.exports = Object.freeze({ createRetainedWorkerRequest });
