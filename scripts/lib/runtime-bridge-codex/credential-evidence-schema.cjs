'use strict';

function createCredentialEvidenceSchema({
  hasExactKeys,
}) {
  // THIRD HARD NO-GO RESPONSE Block B: checkpoint names now carry
  // '@<role>:<ordinal>' correlation (e.g. 'login:pre@verifier:0') so
  // completeness can be computed PER ROSTER MEMBER, not just as a single
  // run-wide Set. `family:phase` stays before the '@' -- the part
  // computeCredentialEvidenceComplete's family/order logic below matches
  // against -- so this is additive to, not a replacement of, the existing
  // family:phase naming.
  function correlatedCheckpointName(familyPhase, role, ordinal) {
    return familyPhase + '@' + role + ':' + ordinal;
  }
  function parseCorrelatedCheckpointName(name) {
    const m = typeof name === 'string' && name.match(/^(.+)@([^:@]+):(\d+)$/);
    if (!m) return null;
    return { familyPhase: m[1], role: m[2], ordinal: parseInt(m[3], 10) };
  }

  // CORRECTION ROUND findings 3+5, item 6: a closed allowlist of every
  // family:phase this file's own code actually produces -- enumerated by
  // reading every correlatedCheckpointName()/literal call site: bind
  // (attestPreBind), close:post (close()), login/turn/cleanup's own required
  // phases, refresh-checkout (checkout()'s recordRefresh), and
  // refresh:<attemptNumber>:<phase> (runRefreshCheckpointOrder). Verified
  // against the real test suite's own recordLogin/recordTurn/recordCleanup
  // call sites (test file ~L5202-5204/5227-5229) -- only pre/during/post are
  // ever used, nothing wider. An entry naming anything else fails the whole
  // record closed, never silently ignored.
  const FIXED_RECOGNIZED_FAMILY_PHASES = Object.freeze(new Set([
    'bind', 'close:post',
    'login:pre', 'login:post',
    'turn:pre', 'turn:during', 'turn:post',
    'cleanup:pre', 'cleanup:post',
    'refresh-checkout:pre', 'refresh-checkout:post',
  ]));
  function isRecognizedFamilyPhase(familyPhase) {
    return FIXED_RECOGNIZED_FAMILY_PHASES.has(familyPhase) || /^refresh:\d+:(pre|during|post)$/.test(familyPhase);
  }

  // Run-wide (never @role:ordinal-correlated) teardown scan evidence, folded
  // into the SAME credential-absence-checkpoints/v1 record/file/writer as
  // every other checkpoint -- PLAN.md's own record 14 is explicitly the only
  // authorized schema; this is not a new schema, just two new recognized
  // top-level names within it.
  const TEARDOWN_CHECKPOINT_NAMES = Object.freeze(new Set(['teardown:pre', 'teardown:post']));

  const CHECKPOINT_ENTRY_KEYS_SORTED = Object.freeze(['at', 'captures_scanned', 'name', 'ok', 'roots_scanned']);
  /**
   * CORRECTION ROUND findings 3+5, item 3: the FULL closed shape of one
   * checkpoint entry, matching publishCredentialAbsenceCheckpoint's own
   * checkpointEntry object literal exactly -- previously only `.name` was
   * ever validated on read.
   */
  function isValidCheckpointEntry(c) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
    if (!hasExactKeys(c, CHECKPOINT_ENTRY_KEYS_SORTED)) return false;
    if (typeof c.name !== 'string') return false;
    if (!TEARDOWN_CHECKPOINT_NAMES.has(c.name) && parseCorrelatedCheckpointName(c.name) === null) return false;
    if (typeof c.ok !== 'boolean') return false;
    if (!Number.isInteger(c.roots_scanned) || c.roots_scanned < 0) return false;
    if (!Number.isInteger(c.captures_scanned) || c.captures_scanned < 0) return false;
    if (typeof c.at !== 'string' || !Number.isFinite(Date.parse(c.at))) return false;
    return true;
  }

  // CORRECTION ROUND findings 3+5, bonus: the durable record's OWN top-level
  // shape must be exactly this closed 6-field set -- no extra/missing keys.
  const CREDENTIAL_EVIDENCE_RECORD_KEYS_SORTED = Object.freeze(['checkpoints', 'complete', 'mode', 'root_ids', 'run_id', 'schema']);

  // Mandatory for EVERY roster member. FOURTH HARD NO-GO RESPONSE Block B:
  // 'cleanup' is now included -- PLAN.md ~L557 lists "pre/post cleanup" in the
  // SAME mandatory-coverage sentence as pre/post login and pre/during/post
  // turn; the prior round's exclusion (reasoning: close() already publishes
  // 'close:post', and recordCleanup was brand new with nothing calling it
  // automatically) was a deliberate but INCORRECT reading -- PLAN's own text
  // does not treat cleanup as optional-if-started the way refresh is.
  const CHECKPOINT_FAMILY_REQUIRED_PHASES = Object.freeze({
    login: Object.freeze(['pre', 'post']),
    turn: Object.freeze(['pre', 'during', 'post']),
    cleanup: Object.freeze(['pre', 'post']),
  });
  /**
   * HARD NO-GO RESPONSE Block B (PLAN.md ~L558: "complete... true only when
   * required sequence/cardinality and every ok pass") -- THIRD HARD NO-GO
   * RESPONSE rewrite: real order validation (not bare Set-membership), real
   * per-roster-member cardinality (EVERY expectedRoster member must
   * independently complete its own required sequence, not just one connection
   * satisfying a single run-wide name set), and refresh checkpoints
   * (refresh-checkout:<phase>, refresh:<attemptNumber>:<phase> -- still
   * genuinely OPTIONAL, unlike cleanup) are validated for dangling/incomplete
   * attempts. FOURTH HARD NO-GO RESPONSE: an empty checkpoints array is
   * vacuously complete only when expectedRoster is ALSO empty (genuinely
   * nothing was ever expected to happen) -- any non-empty roster with zero
   * checkpoints is incomplete, never vacuously fine.
   * @param {Array<{name:string,ok:boolean}>} checkpoints
   * @param {Array<{role:string,ordinal:number}>} expectedRoster
   */
  function computeCredentialEvidenceComplete(checkpoints, expectedRoster) {
    const roster = Array.isArray(expectedRoster) ? expectedRoster : [];
    if (!Array.isArray(checkpoints) || checkpoints.length === 0) return roster.length === 0;
    if (!checkpoints.every((c) => c && c.ok === true)) return false;

    // Run-wide teardown scan entries (folded into this SAME record -- see
    // TEARDOWN_CHECKPOINT_NAMES) are never @role:ordinal-correlated, so they
    // are split out here, before any of the per-member parsing below ever
    // sees them.
    const teardownEntries = checkpoints.filter((c) => TEARDOWN_CHECKPOINT_NAMES.has(c.name));
    const memberEntries = checkpoints.filter((c) => !TEARDOWN_CHECKPOINT_NAMES.has(c.name));
    // ADVERSARIAL RE-AUDIT (HARD NO-GO, 2026-07-21): a bare count comparison
    // (teardownPreCount > teardownPostCount) only ever catches "more pre than
    // post" -- it is blind to a 'teardown:post' with NO preceding
    // 'teardown:pre' at all (0 > 1 is false) and blind to array-order (a
    // 'teardown:post' appearing BEFORE its 'teardown:pre' has equal counts
    // either way). A running balance walked in genuine call-order catches
    // both: it goes negative the instant a 'post' arrives with no open 'pre'
    // to close (dangling-post, or reversed order), and ends non-zero when a
    // 'pre' never got its 'post' (dangling-pre, the original case).
    let teardownBalance = 0;
    let teardownDangling = false;
    for (const c of teardownEntries) {
      if (c.name === 'teardown:pre') teardownBalance += 1;
      else if (c.name === 'teardown:post') {
        teardownBalance -= 1;
        if (teardownBalance < 0) { teardownDangling = true; break; }
      }
    }
    if (teardownDangling || teardownBalance !== 0) return false; // dangling or out-of-order teardown attempt (mirrors the refresh-checkout:pre/post dangling check below).
    // CORRECTION PASS Block D item 2: the balance-walk above only checks
    // pre/post pairing, never a cardinality cap -- [pre,post,pre,post] (two
    // FULLY BALANCED pairs) passes it despite attemptTeardown's own success
    // routing straight to FINALIZED (never re-invoked again for a completed
    // run, per its own comment), so a legitimate run can only ever reach ONE
    // genuine teardown pair; a second complete pair is itself an anomaly.
    const teardownPostCount = teardownEntries.filter((c) => c.name === 'teardown:post').length;
    if (teardownPostCount > 1) return false;

    const parsed = memberEntries.map((c) => parseCorrelatedCheckpointName(c.name));
    // CORRECTION ROUND findings 3+5, item 5: an entry whose .name fails to
    // parse at all is itself a hard rejection signal -- the old
    // .filter(p => p !== null) here silently dropped it, making a malformed
    // intruder entry invisible to every check below, so an otherwise-complete
    // roster's record still evaluated to true with it mixed in.
    if (parsed.some((p) => p === null)) return false;
    // CORRECTION ROUND findings 3+5, item 6a: an unrecognized family:phase
    // string is never silently ignored -- fail the whole record closed.
    if (parsed.some((p) => !isRecognizedFamilyPhase(p.familyPhase))) return false;

    const byMember = new Map(); // 'role:ordinal' -> ordered array of familyPhase strings (call order).
    for (const p of parsed) {
      const key = p.role + ':' + p.ordinal;
      if (!byMember.has(key)) byMember.set(key, []);
      byMember.get(key).push(p.familyPhase);
    }

    // CORRECTION ROUND findings 3+5, item 6b (test-specialist's own find): a
    // checkpoint entry for a role:ordinal NOT in expectedRoster at all should
    // never be able to exist through the normal bindConnection path
    // (roster/ordinal closure is enforced at bind time) -- its presence is
    // itself an anomaly, never silently ignored just because the completeness
    // loop below only ever walks roster members.
    for (const key of byMember.keys()) {
      if (!roster.some((m) => (m.role + ':' + m.ordinal) === key)) return false;
    }

    // CORRECTION ROUND findings 3+5, item 4: the SAME family:phase appearing
    // more than once for the same member is itself suspicious (a checkpoint
    // should be recorded exactly once per its own logical occurrence) -- fail
    // closed rather than silently keeping only the first occurrence via
    // memberSatisfiesOrderAndFamilies's own indexOf below.
    function memberHasDuplicatePhase(familyPhaseList) {
      const seen = new Set();
      for (const fp of familyPhaseList) {
        if (seen.has(fp)) return true;
        seen.add(fp);
      }
      return false;
    }

    // CORRECTION ROUND findings 3+5, item 7 (team-lead's decision -- bind-first
    // only, no other cross-family ordering): structurally guaranteed by the
    // real production API, never merely a calling convention -- checkout()
    // (and therefore every other record* method) can only be obtained via
    // bindConnection()'s own successful return, an object-capability
    // guarantee, and attestPreBind's own 'bind' checkpoint is what THAT
    // success itself records. A genuinely-produced checkpoints array can
    // therefore never have anything precede 'bind' for the same member; a
    // present-but-not-first 'bind' is proof of tampering/corruption, never
    // legitimate. Deliberately narrower than "cleanup/close must be last" --
    // that would encode an assumption about C4/turn-loop's own not-yet-designed
    // calling discipline, which this file cannot verify; bind-first requires
    // no such assumption, since it holds for every possible real caller.
    function memberHasBindNotFirst(familyPhaseList) {
      const bindIndex = familyPhaseList.indexOf('bind');
      return bindIndex > 0; // present but not first is a violation; absent (-1) or genuinely first (0) are both fine.
    }

    function memberSatisfiesOrderAndFamilies(familyPhaseList) {
      for (const family of Object.keys(CHECKPOINT_FAMILY_REQUIRED_PHASES)) {
        let lastIndex = -1;
        for (const phase of CHECKPOINT_FAMILY_REQUIRED_PHASES[family]) {
          const idx = familyPhaseList.indexOf(family + ':' + phase);
          if (idx === -1) return false; // required phase never happened for this member.
          if (idx < lastIndex) return false; // out of order relative to this family's own previous required phase.
          lastIndex = idx;
        }
      }
      return true;
    }

    // The refresh checkpoint families remain OPTIONAL (never required for
    // completeness, unlike login/turn/cleanup above), but a STARTED-and-
    // never-COMPLETED instance (an abandoned/hung attempt) must still
    // invalidate completeness -- "every ok pass" alone is not enough.
    function memberHasDanglingOptionalFamily(familyPhaseList) {
      // ADVERSARIAL RE-AUDIT (HARD NO-GO, 2026-07-21): same balance-walk fix as
      // teardown's own dangling check above -- a bare count comparison is
      // blind to a 'refresh-checkout:post' with no preceding
      // 'refresh-checkout:pre' (0 > 0 is false) and blind to reversed order
      // (equal counts either way).
      let checkoutBalance = 0;
      let checkoutDangling = false;
      for (const fp of familyPhaseList) {
        if (fp === 'refresh-checkout:pre') checkoutBalance += 1;
        else if (fp === 'refresh-checkout:post') {
          checkoutBalance -= 1;
          if (checkoutBalance < 0) { checkoutDangling = true; break; }
        }
      }
      if (checkoutDangling || checkoutBalance !== 0) return true;
      const attempts = new Map(); // attemptNumber string -> {pre?:idx, during?:idx, post?:idx} (first-seen index per phase).
      familyPhaseList.forEach((fp, idx) => {
        const m = fp.match(/^refresh:(\d+):(pre|during|post)$/);
        if (!m) return;
        if (!attempts.has(m[1])) attempts.set(m[1], {});
        const entry = attempts.get(m[1]);
        if (!(m[2] in entry)) entry[m[2]] = idx;
      });
      for (const entry of attempts.values()) {
        if (!('pre' in entry) || !('during' in entry) || !('post' in entry)) return true; // incomplete attempt (subsumes the old .has()-based presence check).
        if (!(entry.pre < entry.during && entry.during < entry.post)) return true; // order violation: post-without-pre is caught above (pre absent), post-before-pre / post-before-during-before-pre / any other misordering caught here.
      }
      return false;
    }

    for (const member of roster) {
      const familyPhaseList = byMember.get(member.role + ':' + member.ordinal);
      if (!familyPhaseList) return false; // this roster member never bound at all.
      if (memberHasDuplicatePhase(familyPhaseList)) return false;
      if (memberHasBindNotFirst(familyPhaseList)) return false;
      if (!memberSatisfiesOrderAndFamilies(familyPhaseList)) return false;
    }
    for (const familyPhaseList of byMember.values()) {
      if (memberHasDanglingOptionalFamily(familyPhaseList)) return false;
    }
    return true;
  }

  return Object.freeze({ correlatedCheckpointName, parseCorrelatedCheckpointName, computeCredentialEvidenceComplete, isValidCheckpointEntry, CREDENTIAL_EVIDENCE_RECORD_KEYS_SORTED });
}

module.exports = Object.freeze({ createCredentialEvidenceSchema });
