'use strict';

// Extracted from runtime-consultation.cjs. This focused factory has no
// upward facade import; every authority, clock and durability seam is injected.
function createAwaitResultTransaction(deps) {
  const {
    ACCEPTED_RESULT_V1_FIELDS,
    CLAIM_NO_LEASE_WINDOW_S,
    CliError,
    DURABLE_ABSENT,
    DURABLE_PENDING,
    DURABLE_PRESENT,
    REQUEST_EXPIRY_MARGIN_S,
    acceptedResultPathFor,
    accreditCanonicalRequest,
    activationLivenessDeadline,
    activationPathFor,
    activeLeasePathFor,
    assertAcceptedResultCorrelates,
    assertClosedShape,
    assertRequestIdentityMatches,
    cancelPathFor,
    claimPathFor,
    classifyCanonicalCancelRecord,
    classifyDurableRead,
    currentClockMs,
    getFixedClockBaseMs,
    isFixedClockActive,
    isoPlusSeconds,
    isoToMs,
    minIso,
    path,
    requireFlags,
    resolveAbsolute,
    resolveAuthoritativeAttempt,
    resultPathFor,
    sleepSync,
    testRendezvous,
    validateActivationV1,
    validateActiveLeaseV1,
    validateClaimV1,
    validateResultV2,
  } = deps;


  // ─────────────────────────────────────────────────────────────────────────────
  // `await-result` (PLAN.md ~L768) -- bounded poll, never hangs/fabricates success
  // ─────────────────────────────────────────────────────────────────────────────

  // Section 8: the FROZEN allowlist of result-candidate validation outcomes that let
  // await-result keep polling instead of STOPping shrinks to ONE principled member --
  // AUTHORITY_INVALID, proof (via resolveAuthoritativeAttempt) that the candidate's own
  // attempt has genuinely been superseded, which can occur in a narrow race between
  // resolving the current attempt and validating its result. CORRELATION_INVALID is
  // REMOVED: a stale/wrong-digest/wrong-role/wrong-root/wrong-depth candidate is an
  // honest correlation failure that must STOP immediately, never be laundered into a
  // generic TIMEOUT by broad pollability. Any other failure (SECURITY_INVALID /
  // SCHEMA_INVALID / DURABILITY_UNPROVEN / identity / I/O) propagates and STOPs, as
  // before. Tested by DUR-J-Gap2-await-* + XACT-07..10.
  const AWAIT_POLLABLE_CANDIDATE_DETAILS = new Set(['AUTHORITY_INVALID']);
  function isAwaitPollableCandidateError(err) {
    return err instanceof CliError && err.status === 'INVALID' && AWAIT_POLLABLE_CANDIDATE_DETAILS.has(err.detailCode);
  }

  /**
   * M67-MATRIX3-LIVENESS-REPAIR-FINAL-20260821: the ONE canonical liveness
   * assessor for cmdAwaitResult's poll loop. A dead/unclaimed worker or an
   * expired request must be reported promptly (BLOCKED/WORKER_LEASE_EXPIRED,
   * BLOCKED/WORKER_LEASE_MISSING, BLOCKED/WORKER_NOT_CLAIMED,
   * TIMEOUT/REQUEST_EXPIRED) -- never silently polled all the way to the CLI's
   * own --timeout as a generic DEADLINE_EXCEEDED. Called once per iteration,
   * strictly AFTER the terminal checks (accepted-result/cancel/result -- a
   * valid terminal observed the same iteration always wins) and strictly
   * BEFORE the CLI deadline check.
   *
   * Pure observer: never writes, cancels, releases, takes over, or repairs
   * state. Returns `{status, detailCode, message}` when a liveness verdict is
   * reached this iteration, or `null` when none applies yet (the caller falls
   * through to its own deadline check, exactly as before this function
   * existed). Reuses the SAME canonical validators/helpers every other caller
   * in this file trusts (validateClaimV1, validateActivationV1,
   * validateActiveLeaseV1, CLAIM_NO_LEASE_WINDOW_S, activationLivenessDeadline)
   * -- never a duplicated parser.
   *
   * Fail-closed discipline: validateClaimV1/validateActivationV1/
   * validateActiveLeaseV1 each throw on anything that is not a clean,
   * durable, shape-valid, correctly-correlated record -- malformed JSON, a
   * symlink, wrong owner/mode, or (for claim, via its own internal check) a
   * wrong attempt/epoch. Only TWO outcomes of that throw are ever caught and
   * interpreted here: `.durableAbsent` (the record genuinely does not exist
   * yet) and `.durablePending` (the record is mid-publish, the SAME nlink==2
   * in-flight window the rest of this loop already treats as "keep waiting").
   * Every other error propagates completely unmodified -- it is NEVER
   * downgraded to a liveness verdict and never swallowed into "keep waiting".
   * validateActivationV1/validateActiveLeaseV1 do not themselves correlate
   * attempt_id/lease_epoch/request_id against the current authoritative
   * attempt (only validateClaimV1 does, internally) -- the explicit checks
   * below close that gap for activation/lease the same way, throwing the same
   * AUTHORITY_INVALID a wrong-attempt claim already throws.
   */
  function assessAwaitResultLiveness(reqObj, txnDir, coordRoot, auth) {
    const nowMs = currentClockMs();

    let claimObj = null;
    try {
      claimObj = validateClaimV1(claimPathFor(txnDir, auth.attemptId), coordRoot);
    } catch (err) {
      if (err && err.durableAbsent) {
        claimObj = null;
      } else if (err && err.durablePending) {
        return null;
      } else {
        throw err;
      }
    }

    if (claimObj === null) {
      let activationObj = null;
      try {
        activationObj = validateActivationV1(activationPathFor(txnDir, auth.attemptId));
      } catch (err) {
        if (err && err.durableAbsent) {
          activationObj = null;
        } else if (err && err.durablePending) {
          return null;
        } else {
          throw err;
        }
      }
      if (activationObj !== null) {
        if (
          activationObj.request_id !== reqObj.request_id
          || activationObj.attempt_id !== auth.attemptId
          || activationObj.lease_epoch !== auth.leaseEpoch
        ) {
          throw new CliError('INVALID', 'AUTHORITY_INVALID', 'activation request_id/attempt_id/lease_epoch is not the current authoritative triple');
        }
        if (nowMs >= isoToMs(activationObj.activation_liveness_expiry)) {
          return { status: 'BLOCKED', detailCode: 'WORKER_NOT_CLAIMED', message: 'await-result observed a valid activation past its own activation_liveness_expiry with no claim' };
        }
      }
    } else {
      let leaseObj = null;
      try {
        leaseObj = validateActiveLeaseV1(activeLeasePathFor(txnDir, auth.attemptId), coordRoot);
      } catch (err) {
        if (err && err.durableAbsent) {
          leaseObj = null;
        } else if (err && err.durablePending) {
          return null;
        } else {
          throw err;
        }
      }
      if (leaseObj === null) {
        const deadline = minIso(
          isoPlusSeconds(claimObj.created_at, CLAIM_NO_LEASE_WINDOW_S),
          minIso(activationLivenessDeadline(reqObj), isoPlusSeconds(reqObj.expiry, -REQUEST_EXPIRY_MARGIN_S)),
        );
        if (nowMs >= isoToMs(deadline)) {
          return { status: 'BLOCKED', detailCode: 'WORKER_LEASE_MISSING', message: 'await-result observed an authoritative claim with no active-lease past the claim-no-lease grace window' };
        }
      } else {
        if (leaseObj.attempt_id !== auth.attemptId || leaseObj.lease_epoch !== auth.leaseEpoch) {
          throw new CliError('INVALID', 'AUTHORITY_INVALID', 'active-lease attempt_id/lease_epoch is not the current authoritative pair');
        }
        if (nowMs >= isoToMs(leaseObj.lease_expiry)) {
          return { status: 'BLOCKED', detailCode: 'WORKER_LEASE_EXPIRED', message: 'await-result observed the authoritative active-lease past its own lease_expiry' };
        }
      }
    }

    if (nowMs >= isoToMs(reqObj.expiry)) {
      return { status: 'TIMEOUT', detailCode: 'REQUEST_EXPIRED', message: 'await-result observed the request past its own expiry with no terminal and no higher-precedence liveness failure' };
    }
    return null;
  }

  function cmdAwaitResult(flags) {
    requireFlags(flags, ['coordination-root', 'request', 'timeout']);
    const coordRoot = resolveAbsolute(flags['coordination-root']);
    const requestPath = resolveAbsolute(flags.request);
    const txnDir = path.dirname(requestPath);
    const timeoutSeconds = Number.parseInt(flags.timeout, 10);
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 3600) {
      throw new CliError('USAGE_ERROR', 'INVALID_ARGUMENT', '--timeout must be an integer in 1..3600');
    }
    // Codex NO-GO round 8: `--request` had NO confinement check at all in this
    // command. Codex NO-GO round 9: even after that fix, only MINIMUM depth +
    // shape+ID -- never the EXACT geometry or FULL validateConsultV2 pipeline.
    // accreditCanonicalRequest is the ONE canonical accreditor shared with
    // cmdCancel/cmdAcceptResult/accreditCancelRecord -- see its own doc
    // comment. Positioned after --timeout's own argv-grammar check, preserving
    // this command's existing "argv-grammar problems fail before any content
    // read" ordering.
    //
    // Codex NO-GO round 10: unlike cmdCancel/cmdAcceptResult (a single write
    // under one lock hold, where re-accrediting once INSIDE withLock closes the
    // TOCTOU), this command polls across MANY iterations and deliberately never
    // holds the lock continuously (other processes must be free to publish a
    // result/accept/cancel between polls). Accrediting reqObj only ONCE before
    // the loop and reusing it for every iteration has the same class of gap:
    // a stale accreditation could act on outdated information. accreditCanonicalRequest
    // now runs fresh at the top of EVERY iteration -- the same full accreditation,
    // paid once per poll cycle (already dominated by the
    // classifyDurableRead/validateResultV2 work each iteration already does)
    // rather than once for the whole wait.
    //
    // Codex NO-GO round 11 P0(3): round 10's fix ADOPTED whatever request.json
    // said on each fresh re-read -- but PLAN.md ~L813 declares request.json
    // IMMUTABLE (published once via temp fsync -> link -> unlink temp -> flush;
    // never rewritten), and a legitimate change of which attempt is
    // authoritative goes through takeover.json, never a mutation of this path.
    // Silently adopting a new `initial_attempt_id` on a later poll is
    // substituting authority without takeover.json -- exactly the kind of
    // unaccredited authority change this whole file exists to reject elsewhere.
    // The fix is not "reject every re-read" (a single, once-only accreditation
    // would resurrect round 10's own staleness gap) but "freeze the IDENTITY
    // observed on the very first read, and require every later read -- each
    // iteration, AND immediately before completing -- to still match it
    // exactly; any divergence STOPs (fail-closed), it is never adopted."
    //
    // Codex NO-GO round 12: comparing DIGEST alone missed a byte-identical
    // REPLACEMENT between iterations (delete + rewrite the exact same bytes) --
    // same content, same digest, but a genuinely different underlying file.
    // Codex NO-GO round 13: dev/ino alone still missed an IN-PLACE rewrite that
    // restores the original bytes before a later check runs. Rather than
    // hand-tracking an ever-growing subset of fields a second time, this now
    // freezes the FULL initial record and reuses assertRequestIdentityMatches
    // (the same comprehensive, single-sourced comparison cmdCancel/
    // cmdAcceptResult's own preflight-vs-in-lock check already uses) directly.
    let initialReqRec = null;
    function assertRequestIdentityUnchanged(freshRec) {
      assertRequestIdentityMatches(initialReqRec, freshRec, requestPath);
    }
    // W06 fixed-clock deadline seam: the deadline ANCHOR is computed from the
    // UNADVANCED base while the live loop check (below) reads the ADVANCED
    // value -- these are deliberately DIFFERENT quantities under fixed-clock
    // mode, so RUNTIME_CONSULTATION_FAKE_CLOCK_ADVANCE_MS can force an
    // immediate deadline-exceeded on iteration 1 with zero real sleep. Outside
    // fixed-clock mode both resolve to real, independently-advancing
    // Date.now() values -- unchanged production behavior.
    const deadlineBaseMs = isFixedClockActive() ? getFixedClockBaseMs() : Date.now();
    const deadlineMs = deadlineBaseMs + timeoutSeconds * 1000;
    // Section 8: tracks whether the RESULT candidate (not accepted-result/cancel, which
    // have their own pendingObservedThisPass-only tracking, unchanged) was EVER seen
    // PENDING across iterations. If it is later observed ABSENT, that is a genuine
    // vanish-from-the-in-flight-window, not a fresh pre-publish absence -- STOP.
    let resultEverPending = false;

    for (;;) {
      // Codex NO-GO round 10: fresh, full accreditation every iteration -- see
      // this function's own header comment above for why a single pre-loop
      // accreditation is unsafe across a long, multi-iteration poll. Codex
      // NO-GO round 11 P0(3): the freshly-read digest is now compared against
      // the FROZEN first-read digest, never adopted -- see the header comment.
      const reqRec = accreditCanonicalRequest(coordRoot, requestPath);
      if (initialReqRec === null) {
        initialReqRec = reqRec;
      } else {
        assertRequestIdentityUnchanged(reqRec);
      }
      const reqObj = reqRec.obj;
      // DUR-J: await completes/cancels only on a DURABLY-committed, shape-valid terminal.
      // Each terminal is classified EXPLICITLY -- PRESENT completes; PENDING (the one
      // recognized nlink==2 in-flight window) keeps waiting; ABSENT keeps waiting; ANY
      // INVALID (symlink / wrong owner-mode / oversize / malformed / wrong closed-shape /
      // identity drift / path rebound) THROWS (STOP), never silently skipped. The
      // accepted-result CORRELATION check (AUTH-06/07) stays in the AUTH area; DUR-J
      // requires the terminal be durable AND a valid closed shape here.
      let pendingObservedThisPass = false;
      const acc = classifyDurableRead(acceptedResultPathFor(txnDir), { shape: (o) => assertClosedShape(o, ACCEPTED_RESULT_V1_FIELDS) });
      if (acc.state === DURABLE_PRESENT) {
        // AUTH-06/07: shape+durability alone (above) is not authority -- a hand-written,
        // shape-valid, durable-but-uncorrelated accepted-result.json must not complete a
        // real transaction. Re-derive and re-check the full correlation chain before
        // trusting mere presence.
        assertAcceptedResultCorrelates(acc.obj, txnDir, reqObj, coordRoot);
        // Codex NO-GO round 11 P0(3): one more, freshest-possible re-check
        // immediately before completing -- shrinks the window between "this
        // iteration's own top-of-loop read" and the actual return to as close
        // to zero as a synchronous re-read allows.
        assertRequestIdentityUnchanged(accreditCanonicalRequest(coordRoot, requestPath));
        return { request_id: reqObj.request_id, artifact_ref: acceptedResultPathFor(txnDir) };
      }
      if (acc.state === DURABLE_PENDING) pendingObservedThisPass = true;
      // Codex NO-GO round 8: single choke point -- see classifyCanonicalCancelRecord's
      // own doc comment (the CANCEL-AUDIT-01 source-audit test enforces this mechanically).
      const can = classifyCanonicalCancelRecord(cancelPathFor(txnDir), coordRoot);
      if (can.state === DURABLE_PRESENT) {
        // CLI-RESULT-08 / CONFLICT-vs-CANCELLED: DESIGN-BLOCKED (see this file's
        // history for the rejected prior attempts and why). Not yet settled:
        // WHERE a genuine conflict is legitimately detected. `cmdPublishResult`
        // publishes to the single `results/<attempt_id>.json` path for the one
        // current `(attempt_id, lease_epoch)`; a second, differing write today
        // just loses the no-clobber race as a generic rejection, with no
        // recorded evidence of what the losing candidate claimed. The existing
        // `conflict/v1` schema has two separate attempt-identifying fields
        // (`attempt_id`, `other_attempt_id`) sized for two DIFFERENT ATTEMPTS --
        // it does not fit "one attempt, two competing byte-streams for the SAME
        // (attempt_id, lease_epoch)", which is what the PLAN's own text actually
        // names. (This schema does not itself require `attempt_id !==
        // other_attempt_id` as a rule -- whether the reconciled design keeps two
        // attempt fields, moves to two digest fields, or something else is an
        // open design question, not assumed here.) Until that is designed and,
        // if needed, the PLAN/schema is amended and authorized, this observer
        // deliberately does NOT attempt to distinguish CONFLICT from CANCELLED.
        // rc6 terminal (PLAN.md ~L781), mirroring cmdCancel's/cmdAcceptResult's own
        // CANCELLED/TRANSACTION_CANCELLED terminal-cancel status -- not INVALID/rc3.
        // Codex NO-GO round 11 P0(3): re-check immediately before this terminal too.
        assertRequestIdentityUnchanged(accreditCanonicalRequest(coordRoot, requestPath));
        throw new CliError('CANCELLED', 'TRANSACTION_CANCELLED', 'transaction was cancelled');
      }
      if (can.state === DURABLE_PENDING) pendingObservedThisPass = true;

      // Section 8: the result candidate is ALWAYS the CURRENT authoritative attempt's
      // OWN canonical path, re-resolved fresh THIS iteration (a takeover can commit
      // between iterations) -- never a directory-listing entries[0], which could pick a
      // superseded attempt's leftover result and never even reach the current one.
      const currentAuth = resolveAuthoritativeAttempt(reqObj, txnDir);
      const candidatePath = resultPathFor(txnDir, currentAuth.attemptId);
      const resClassify = classifyDurableRead(candidatePath);
      if (resClassify.state === DURABLE_PENDING) {
        pendingObservedThisPass = true;
        resultEverPending = true;
      } else if (resClassify.state === DURABLE_ABSENT) {
        if (resultEverPending) {
          throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'result candidate transitioned from the in-flight window to absent: ' + candidatePath);
        }
        // Genuinely, never-before-pending absence: the authoritative attempt simply has
        // not published a result yet -- fine, keep waiting.
      } else {
        // DURABLE_PRESENT -- run the full shape/correlation/authority pipeline. A result
        // sitting at the CURRENT attempt's OWN canonical path can still fail
        // AUTHORITY_INVALID in a narrow race (a takeover committed between the
        // currentAuth resolution above and this validation) -- the ONE principled
        // pollable reason to keep waiting; a superseded result is ignored only because
        // attempt authority proves it is old, never because an error class is broadly
        // pollable.
        let validated = null;
        try {
          validated = validateResultV2(candidatePath, coordRoot);
        } catch (err) {
          if (!isAwaitPollableCandidateError(err)) throw err;
        }
        if (validated) {
          // Codex NO-GO round 11 P0(3): re-check immediately before either
          // terminal below -- both reference reqObj's identity in their output.
          assertRequestIdentityUnchanged(accreditCanonicalRequest(coordRoot, requestPath));
          if (validated.obj.status === 'BLOCKED') {
            // CLI-RESULT-06: a protocol-valid BLOCKED candidate is a terminal state
            // (PLAN.md ~L768: "or terminal state"; ~L781 rc6), never silent success.
            throw new CliError('BLOCKED', 'RESULT_BLOCKED', 'await-result observed a protocol-valid BLOCKED candidate', { request_id: reqObj.request_id, artifact_ref: candidatePath });
          }
          return { request_id: reqObj.request_id, artifact_ref: candidatePath };
        }
      }

      // M67-MATRIX3-LIVENESS-REPAIR-FINAL-20260821: liveness is evaluated AFTER
      // every terminal check above (a valid accepted-result/cancel/result observed
      // this same iteration always wins -- never converted into a false liveness
      // failure) and BEFORE the CLI deadline check below (a dead/unclaimed worker
      // or an expired request must be reported promptly, never silently polled
      // all the way to a generic DEADLINE_EXCEEDED).
      const liveness = assessAwaitResultLiveness(reqObj, txnDir, coordRoot, currentAuth);
      if (liveness !== null) {
        assertRequestIdentityUnchanged(accreditCanonicalRequest(coordRoot, requestPath));
        throw new CliError(liveness.status, liveness.detailCode, liveness.message);
      }

      if (currentClockMs() >= deadlineMs) {
        // Codex NO-GO round 12: rechecked immediately before EITHER exit below
        // too -- the claim "no mutation occurred during this entire wait" must
        // hold for every possible exit from this loop, not only the ones that
        // happen to echo reqObj fields in their own JSON output.
        assertRequestIdentityUnchanged(accreditCanonicalRequest(coordRoot, requestPath));
        if (pendingObservedThisPass) {
          // DUR-J + Section 8: a terminal was still in the recognized nlink==2 in-flight
          // window at the deadline -- report the durability truth (DURABILITY_UNPROVEN),
          // NOT a generic timeout, so a persistently-unproven publish is never laundered
          // as "timed out".
          throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'await-result deadline reached with a terminal still in the nlink==2 in-flight window');
        }
        // CLI-RESULT-05: NONE is legal only with success (PLAN.md ~L781); a TIMEOUT
        // failure names the specific literal DEADLINE_EXCEEDED.
        throw new CliError('TIMEOUT', 'DEADLINE_EXCEEDED', 'await-result timed out with no valid current candidate');
      }
      // Codex NO-GO round 11: this command's poll interval previously had no
      // rendezvous seam at all (a plain timing sleep was the only way to test
      // it), which the reviewer correctly flagged as not proving a test
      // genuinely observed the OLD state before a mid-poll mutation. Firing
      // here -- after a full iteration has completed (including its own
      // top-of-loop accreditation) and found no terminal yet -- lets a test
      // deterministically prove "at least one full read of the ORIGINAL
      // request.json already happened" before it mutates the file out from
      // under this loop.
      testRendezvous(txnDir, 'await-result-post-iteration');
      sleepSync(100);
    }
  }

  return { cmdAwaitResult };
}

module.exports = { createAwaitResultTransaction };
