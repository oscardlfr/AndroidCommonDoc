#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# ci-prerequisite: mcp-server
#
# Part 3/3 of the former runtime-consultation-role-gate.bats (Sequence C20
# split -- see lib/role-gate-shared.bash's own header for why). Covers: the
# ROOT-CONSULT activation-window family and its NO-GO-C retirement-ref
# validator (4 of the original 9 retained-plane-start call sites), the
# CP-EVIDENCE-E2E Context7 pattern-gap family (needs mcp-server for its real
# internal MCP search), and the zero-retained-plane M7 lifecycle
# immutable-authority-cuts/admission-linearization RED suite plus its
# superseded-resolver/fence/owning-name-guard/C2-root-source structural
# coverage.
#
# Siblings: runtime-consultation-role-gate-core.bats,
# runtime-consultation-role-gate-plane.bats. Shared fixtures:
# lib/role-gate-shared.bash.
#
# Invocation: bats scripts/tests/runtime-consultation-role-gate-evidence.bats (from repo root)

load 'lib/role-gate-shared'


# ══════════════════════════════════════════════════════════════════════════
# NO-GO Correction A (PLAN.md §16a line 53): intent.expiry is the <=30s
# ACTIVATION window, independent of and never widened to match the up-to-
# 3600s request_expiry. It governs only whether the source's WAL may still
# RESERVE the intent; once reserved, continued work (publish/dispatch/
# observe/complete) is bound to request_expiry instead, never re-blocked by
# the activation window it already satisfied.
# ══════════════════════════════════════════════════════════════════════════

@test "S16-ROOT-CONSULT-INTENT-EXPIRY-CAP-01: validateRootConsultIntentRecord rejects any activation window wider than 30s or reaching past request_expiry" {
  run node -e '
    const rll = require(process.argv[1]);
    function iso(ms) { return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z"); }
    const hex32 = "a".repeat(32);
    const hex64 = "b".repeat(64);
    const createdMs = Date.parse("2026-01-01T00:00:00Z");
    function baseRecord(expiryMs, requestExpiryMs) {
      return {
        schema: "runtime/root-consult-intent/v1",
        intent_id: hex32, main_binding_id: hex32, main_actor_instance_id: hex32,
        session_generation_id: hex32, repo_id: hex64, worktree_id: hex64,
        plan_digest: hex64, coordination_root_id: hex64,
        requester_role: "arch-testing", requester_binding_id: hex32,
        requester_actor_instance_id: "worker-1",
        target_role: "context-provider", target_role_profile_version: "1.0.0",
        target_role_profile_digest: hex64,
        question: "q", expected_result_kind: "IMPLEMENTATION_REVIEW",
        evidence_policy: "none",
        routing_policy_version: "runtime-routing/v1", routing_policy_digest: hex64,
        subject_repo_id: hex64, subject_worktree_id: hex64, subject_head: "deadbeef",
        subject_bundle_ref: "subject-bundles/x/manifest.json", subject_scope_digest: hex64,
        request_id: hex32, initial_attempt_id: hex32,
        request_created_at: iso(createdMs), request_expiry: iso(requestExpiryMs),
        created_at: iso(createdMs), expiry: iso(expiryMs),
      };
    }
    // Exactly at the 30s cap, well inside request_expiry: legal boundary.
    const okAtCap = rll.validateRootConsultIntentRecord(baseRecord(createdMs + 30000, createdMs + 3600000));
    // A full second past the 30s cap: illegal even though still far inside
    // request_expiry. (Canonical ISO timestamps in this system are
    // second-granularity -- the iso() helper above strips milliseconds on
    // round-trip, so a sub-second delta like +30001ms is indistinguishable
    // from +30000ms once serialized; the over-cap case must differ by a
    // full second to actually exercise the check.)
    const overCap = rll.validateRootConsultIntentRecord(baseRecord(createdMs + 31000, createdMs + 3600000));
    // Well inside the 30s cap, but past request_expiry: illegal -- the two
    // bounds are independent and BOTH must hold.
    const overRequestExpiry = rll.validateRootConsultIntentRecord(baseRecord(createdMs + 5000, createdMs + 4000));
    const results = {
      okAtCap: okAtCap.ok,
      overCap: overCap.ok, overCapReason: overCap.reason,
      overRequestExpiry: overRequestExpiry.ok, overRequestExpiryReason: overRequestExpiry.reason,
    };
    process.stdout.write(JSON.stringify(results));
    if (!okAtCap.ok || overCap.ok || overRequestExpiry.ok) process.exit(1);
  ' "$RLL_IMPL"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"overCapReason":"root-consult-intent-time-invalid"'* ]]
  [[ "$output" == *'"overRequestExpiryReason":"root-consult-intent-time-invalid"'* ]]
}

@test "S16-ROOT-CONSULT-NO-RESERVATION-ZEROWRITE-01: an intent nobody reserves before its own 30s window closes is zero-write/BLOCKED" {
  if [ "$(node -p 'process.platform')" = "win32" ]; then
    skip "POSIX SIGSTOP/SIGCONT fixture; native Windows lifecycle coverage uses bounded deterministic clocks"
  fi
  local session_id="s16e2e-noreserve-session"
  S16E2E_BG_PID=""
  _s16e2e_start_retained_plane "$session_id"

  # Deterministic, not probabilistic: SIGSTOP freezes the ENTIRE Node
  # process backing $S16E2E_BG_PID -- runtime-bridge-codex.cjs's own
  # pollRetainedWorkers comment literally calls this process "this
  # supervisor process" ("Polling and admission are shared by all role
  # children in this supervisor process"). Its 250ms-tick poll loop
  # (RETAINED_WORKER_POLL_INTERVAL_MS) is the ONLY thing capable of
  # reserving a root-consult intent; while stopped it cannot run at all, so
  # there is no race left to lose -- this replaces the prior version's 3
  # skip-guards against a genuine race with a real guarantee.
  # _s16e2e_consult_root_publish writes the intent via a real, SEPARATE
  # hook+CLI invocation that never talks to this PID over IPC (confirmed by
  # reading its body: it only touches disk through the lifecycle library
  # directly), so publishing under a stopped supervisor is safe and requires
  # no special-casing.
  #
  # The whole STOP -> publish -> natural-expiry wait -> CONT -> assert
  # sequence runs inside its own subshell whose LOCAL `trap ... EXIT`
  # guarantees SIGCONT fires on every exit path, including a failed
  # assertion, before the failure propagates outward. NOT `trap ... RETURN`
  # -- UMASK-0600-01's own comment elsewhere in this repo documents that a
  # RETURN trap conflicts with bats' internal RETURN-trap use inside `run`.
  # A subshell's own EXIT trap is untouched by bats: reading bats-core's
  # bats-exec-test source directly confirms bats sets its EXIT trap only on
  # the outer per-test process, never on a nested subshell. If this subshell
  # exits non-zero, the outer test aborts before reaching
  # _s16e2e_stop_retained_plane below, but the file's own teardown() hook
  # (already `|| true`-hardened) is the established safety net for exactly
  # that case -- and by then SIGCONT has already run, so its SIGTERM lands
  # on a live, not a permanently-stopped, process.
  (
    trap 'kill -CONT "$S16E2E_BG_PID" 2>/dev/null || true' EXIT
    kill -STOP "$S16E2E_BG_PID"

    _s16e2e_consult_root_publish "$session_id" "NO-RESERVE" "none"
    intent_id="$S16E2E_CR_INTENT_ID"
    intent_path="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.rootConsultIntentPathFor(process.argv[2], process.argv[3]));' "$RLL_IMPL" "$PROJ" "$intent_id")"
    reservation_path="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.rootConsultReservationPathFor(process.argv[2], process.argv[3]));' "$RLL_IMPL" "$PROJ" "$intent_id")"
    published_path="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.rootConsultPublishedPathFor(process.argv[2], process.argv[3]));' "$RLL_IMPL" "$PROJ" "$intent_id")"
    completion_path="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.rootConsultCompletionPathFor(process.argv[2], process.argv[3]));' "$RLL_IMPL" "$PROJ" "$intent_id")"
    # request.json's path is coordRoot-relative (hostBridgeAdvanceRootConsult's
    # own requestRef = 'transactions/<request_id>/request.json'); this test's
    # supervisor is frozen so it can never be published, but the discriminating
    # assertion below still needs its absolute path to check.
    # request.json's real location per readRootConsultTerminalStatus/
    # canonicalRequestPathForRootIntent (runtime-consultation.cjs): NOT
    # coordRoot directly -- planRootPath(coordRoot, repoId, waveSlug,
    # planDigest)/transactions/<requestId>/request.json. planRootPath and
    # requestPathFor are both internal (unexported); the formula is inlined
    # here from their own definitions rather than duplicated as a guess.
    request_path="$(node -e '
      const rll = require(process.argv[1]);
      const path = require("path");
      const fs = require("fs");
      const proj = process.argv[2];
      const intent = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
      const coordRoot = rll.coordinationRootPathFor(proj);
      const plan = rll.discoverPlan(proj);
      const waveSlug = path.basename(path.dirname(plan.planPath)).replace(/^wave-/, "");
      const planRoot = path.join(coordRoot, intent.repo_id, waveSlug, intent.plan_digest);
      process.stdout.write(path.join(planRoot, "transactions", intent.request_id, "request.json"));
    ' "$RLL_IMPL" "$PROJ" "$intent_path")"
    created_at_ms="$(node -e '
      const fs = require("fs");
      process.stdout.write(String(Date.parse(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).created_at)));
    ' "$intent_path")"

    # Let the real (frozen) 30s activation window elapse on the wall clock,
    # with a 500ms margin -- a single computed sleep, never rewriting the
    # immutable intent record itself (the prior version's non-atomic
    # `rec.expiry = rec.created_at` self-write is exactly what this
    # deterministic replacement eliminates).
    now_ms="$(node -e 'process.stdout.write(String(Date.now()))')"
    wait_ms=$(( created_at_ms + 30500 - now_ms ))
    if [ "$wait_ms" -gt 0 ]; then
      sleep "$(node -e 'process.stdout.write((Number(process.argv[1]) / 1000).toFixed(3))' "$wait_ms")"
    fi

    kill -CONT "$S16E2E_BG_PID"
    # A real, generous number of 250ms poll ticks for the just-resumed loop
    # to observe this already-expired, still-unreserved intent -- not just
    # an instant read racing the very first tick after resume. This margin
    # is load-bearing, not cosmetic: empirically (direct instrumentation,
    # since reverted), if rootConsultIntentContext's own pre-reservation
    # expiry gate is bypassed, the resumed WAL loop actually reserves +
    # publishes + writes request.json for this exact intent within ~1.2s --
    # a short sleep here would let that race resolve in the mutation's
    # favor often enough to make the assertions below flaky rather than
    # discriminating. 3s is a >2x margin over that observed ceiling.
    sleep 3

    [ ! -f "$reservation_path" ]
    [ ! -f "$published_path" ]
    [ ! -f "$completion_path" ]
    [ ! -f "$request_path" ]

    # Reuses the established robust poller (transient "unable to resolve
    # scope" hook denials are a known, already-handled retry case for
    # consult-root-status -- see _s16e2e_poll_consult_root_status's own loop)
    # rather than a one-shot hook call.
    if ! _s16e2e_poll_consult_root_status "$session_id" "$intent_id" "BLOCKED" >/dev/null; then
      echo "DEBUG bridge log tail:" >&2
      tail -80 "$S16E2E_BG_OUT" >&2
      exit 1
    fi
    [ ! -f "$reservation_path" ]
    [ ! -f "$published_path" ]
    [ ! -f "$completion_path" ]
    [ ! -f "$request_path" ]
  )

  _s16e2e_stop_retained_plane
}

@test "S16-ROOT-CONSULT-RESERVED-PAST-30S-READY-01: an intent reserved before its own activation window closes still reaches READY after that window elapses, bound by request_expiry instead" {
  if [ "$(node -p 'process.platform')" = "win32" ]; then
    skip "POSIX SIGSTOP/SIGCONT fixture; native Windows lifecycle coverage uses bounded deterministic clocks"
  fi
  local session_id="s16e2e-past30s-session"
  S16E2E_BG_PID=""
  _s16e2e_start_retained_plane "$session_id"

  # M67-ROLE-GATE-FLAKE-01 deterministic redesign, round 4 (2026-08-21):
  # replaces the racing fixture ordering entirely with the SAME real
  # SIGSTOP/SIGCONT protocol S16-ROOT-CONSULT-NO-RESERVATION-ZEROWRITE-01
  # (this file, above) already established and proved -- SIGSTOP freezes
  # the ENTIRE retained supervisor process backing $S16E2E_BG_PID (its own
  # 250ms-tick poll loop is the ONLY thing capable of reserving/publishing
  # a root-consult intent), so while stopped there is no race left to lose
  # at all -- a real guarantee, never a timing margin. The whole
  # STOP -> publish+mutate -> assert-zero-write -> CONT -> assert
  # sequence runs inside its own subshell with a LOCAL `trap ... EXIT`
  # (never `trap ... RETURN`, which conflicts with bats' own internal use)
  # guaranteeing SIGCONT fires on every exit path, including a failed
  # assertion, before the failure ever propagates outward -- identical
  # discipline to the precedent test, same rationale, not re-explained
  # here in full.
  (
    trap 'kill -CONT "$S16E2E_BG_PID" 2>/dev/null || true' EXIT
    kill -STOP "$S16E2E_BG_PID"

    # M67-SIGSTOP-STATE-CONFIRMATION-01: SIGSTOP is a request, not a
    # synchronous guarantee -- prove the supervisor has ACTUALLY reached a
    # stopped (T/t) ps state before the first publish/mutate below, rather
    # than assuming delivery happened by the time this line runs. A bounded
    # poll (never a fixed sleep, never an elapsed-time margin) on the
    # process's own reported state; a specific diagnostic distinguishes
    # "process disappeared" from "never stopped" so a real failure here is
    # never confused with the discriminating assertions later in this test.
    local stopped_confirmed=""
    local _s16_stopwait_i
    for _s16_stopwait_i in $(seq 1 50); do
      local ps_state
      ps_state="$(ps -o state= -p "$S16E2E_BG_PID" 2>/dev/null | tr -d '[:space:]')"
      if [ -z "$ps_state" ]; then
        echo "S16-ROOT-CONSULT-RESERVED-PAST-30S-READY-01: supervisor PID $S16E2E_BG_PID disappeared while waiting for SIGSTOP to take effect" >&2
        exit 1
      fi
      case "$ps_state" in
        T*|t*) stopped_confirmed=1; break ;;
      esac
      sleep 0.05
    done
    if [ -z "$stopped_confirmed" ]; then
      echo "S16-ROOT-CONSULT-RESERVED-PAST-30S-READY-01: supervisor PID $S16E2E_BG_PID never reached a stopped (T/t) ps state after SIGSTOP" >&2
      exit 1
    fi

    local short_window_seconds=5
    _s16e2e_consult_root_publish "$session_id" "PAST-30S" "none"
    intent_id="$S16E2E_CR_INTENT_ID"
    intent_path="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.rootConsultIntentPathFor(process.argv[2], process.argv[3]));' "$RLL_IMPL" "$PROJ" "$intent_id")"
    reservation_path="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.rootConsultReservationPathFor(process.argv[2], process.argv[3]));' "$RLL_IMPL" "$PROJ" "$intent_id")"
    published_path="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.rootConsultPublishedPathFor(process.argv[2], process.argv[3]));' "$RLL_IMPL" "$PROJ" "$intent_id")"
    completion_path="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.rootConsultCompletionPathFor(process.argv[2], process.argv[3]));' "$RLL_IMPL" "$PROJ" "$intent_id")"

    # ONE mutation, while the supervisor is provably frozen and cannot
    # observe any intermediate state -- never a second, later rewrite.
    node -e '
      const fs = require("fs");
      const rc = require(process.argv[1]);
      const intentPath = process.argv[2];
      const windowSeconds = Number(process.argv[3]);
      const rec = JSON.parse(fs.readFileSync(intentPath, "utf8"));
      const createdMs = Date.parse(rec.created_at);
      rec.expiry = new Date(createdMs + windowSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
      fs.writeFileSync(intentPath, rc.canonicalJSONStringify(rec));
    ' "$CONSULTATION_CLI" "$intent_path" "$short_window_seconds"
    intent_digest_final="$(node -e '
      const fs = require("fs");
      const rc = require(process.argv[1]);
      process.stdout.write(rc.sha256String(rc.canonicalJSONStringify(JSON.parse(fs.readFileSync(process.argv[2], "utf8")))));
    ' "$CONSULTATION_CLI" "$intent_path")"
    intent_expiry_ms="$(node -e '
      const fs = require("fs");
      process.stdout.write(String(Date.parse(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).expiry)));
    ' "$intent_path")"

    # While still frozen: zero write of any kind -- the mutation above is
    # this test\'s OWN direct file write, never observed or reacted to by
    # the (provably stopped) supervisor.
    [ ! -f "$reservation_path" ]
    [ ! -f "$published_path" ]
    [ ! -f "$completion_path" ]

    kill -CONT "$S16E2E_BG_PID"

    if ! _s16e2e_poll_consult_root_request_published "$session_id" "$intent_id" >/dev/null; then
      echo "DEBUG bridge log tail:" >&2
      tail -80 "$S16E2E_BG_OUT" >&2
      exit 1
    fi

    # reservation.intent_digest must equal the ONE, final, immutable
    # intent digest computed above -- proves the resumed supervisor
    # reserved the already-short-windowed intent (never an earlier,
    # unmutated snapshot), and that this test never mutated it again.
    reservation_digest="$(node -e '
      const fs = require("fs");
      process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).intent_digest);
    ' "$reservation_path")"
    [ "$reservation_digest" = "$intent_digest_final" ]

    # Wait by RECORDED STATE (the intent\'s own fixed, already-mutated
    # expiry) until it is genuinely in the past -- never a fixed sleep
    # duration, never an elapsed-time margin assertion on this test\'s own
    # wall-clock progress.
    while true; do
      now_ms="$(node -e 'process.stdout.write(String(Date.now()))')"
      [ "$now_ms" -ge "$intent_expiry_ms" ] && break
      sleep 0.1
    done

    # The discriminating assertion: this real flow crosses the intent\'s
    # own (short, fixed) activation boundary -- now provably, not just
    # probably, in the past -- while already reserved, and still reaches
    # READY, proving continued work is bound to request_expiry (3600s),
    # never re-orphaned at the activation window it already cleared.
    if ! _s16e2e_poll_consult_root_status "$session_id" "$intent_id" "READY" >/dev/null; then
      echo "DEBUG bridge log tail:" >&2
      tail -80 "$S16E2E_BG_OUT" >&2
      exit 1
    fi
  )

  _s16e2e_stop_retained_plane
}

# ══════════════════════════════════════════════════════════════════════════
# NO-GO Correction C (PLAN.md §16b line 63 / operation schema line 226):
# a root-source retirement's terminal_ref must be exactly the canonical ref
# ackPathFor/cancelPathFor derive for the record's OWN request_id -- never
# "any non-empty string". Pure validator-level unit tests (no live plane):
# fast, deterministic, exercise validateRootSourceRetirementRecord directly.
# ══════════════════════════════════════════════════════════════════════════

@test "S16-ROOT-SOURCE-RETIREMENT-TERMINAL-REF-CANONICAL-01: a path-traversal, absolute, or foreign-request terminal_ref is rejected" {
  run node -e '
    const rll = require(process.argv[1]);
    const hex32 = "a".repeat(32);
    const hex64a = "c".repeat(64);
    const hex64b = "d".repeat(64);
    const nowIso = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
    function baseRecord(requestId, terminalRef, terminalDigest) {
      return {
        schema: "runtime/root-source-retirement/v1",
        binding_id: hex32, action_id: hex32, request_id: requestId,
        reason: "acked", terminal_ref: terminalRef, terminal_digest: terminalDigest,
        retired_at: nowIso,
      };
    }
    const canonicalRef = "transactions/" + hex64a + "/ack.json";
    const okCanonical = rll.validateRootSourceRetirementRecord(baseRecord(hex64a, canonicalRef, hex64b));
    const traversal = rll.validateRootSourceRetirementRecord(baseRecord(hex64a, "transactions/../../etc/passwd", hex64b));
    const absolute = rll.validateRootSourceRetirementRecord(baseRecord(hex64a, "/etc/passwd", hex64b));
    const foreignRequest = rll.validateRootSourceRetirementRecord(baseRecord(hex64a, "transactions/" + hex64b + "/ack.json", hex64b));
    const wrongBasename = rll.validateRootSourceRetirementRecord(baseRecord(hex64a, "transactions/" + hex64a + "/cancel.json", hex64b));
    const results = {
      okCanonical: okCanonical.ok,
      traversal: traversal.ok, traversalReason: traversal.reason,
      absolute: absolute.ok, absoluteReason: absolute.reason,
      foreignRequest: foreignRequest.ok, foreignRequestReason: foreignRequest.reason,
      wrongBasename: wrongBasename.ok, wrongBasenameReason: wrongBasename.reason,
    };
    process.stdout.write(JSON.stringify(results));
    if (!okCanonical.ok || traversal.ok || absolute.ok || foreignRequest.ok || wrongBasename.ok) process.exit(1);
  ' "$RLL_IMPL"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"traversalReason":"root-source-retirement-terminal-ref-not-canonical"'* ]]
  [[ "$output" == *'"absoluteReason":"root-source-retirement-terminal-ref-not-canonical"'* ]]
  [[ "$output" == *'"foreignRequestReason":"root-source-retirement-terminal-ref-not-canonical"'* ]]
  [[ "$output" == *'"wrongBasenameReason":"root-source-retirement-terminal-ref-not-canonical"'* ]]
}

# ══════════════════════════════════════════════════════════════════════════
# CP-EVIDENCE-E2E (PLAN.md §16c). A real root-consult intent with
# evidence_policy:context7-required, served by the SAME real retained
# context-provider worker ROOT-INGRESS-E2E already exercises (real internal
# MCP search first, real turn-read projection, real WAL/accept/ack). The
# fake app-server's ONLY substitution is the model's own turn response
# (context-provider-gap-once mode: emit ONE pattern-gap, then resume the
# SAME threadId with HOST_PATTERN_EVIDENCE and answer for real). The
# Context7 network call is substituted at resolveTestContext7RequestExecutor's
# boundary -- the SAME boundary S16-CP-CONTEXT7-SUPPLIED-ID-ZERO-SEARCH-01
# (runtime-consultation-bridge.bats) already established as this codebase's
# own "HTTPS socket boundary" convention for Context7 -- so executeContext7Sequence's
# real URL construction, header/content-type validation, and response
# parsing all run for real; only the raw network round trip is recorded and
# answered from a fixture queue.
# ══════════════════════════════════════════════════════════════════════════

# Absolute plan-root path production code itself resolves for a given
# consult-root intent (coordRoot/repoId/waveSlug/planDigest join, mirroring
# planRootPath's own construction) -- shared by every CP-EVIDENCE-E2E test
# that needs to read a transaction's result.json off disk directly.
_s16e2e_consult_root_plan_root() {
  local intent_id="$1"
  node -e '
    const fs = require("fs"); const path = require("path");
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const intentId = process.argv[3];
    const intentPath = path.join(rll.registryRepoDir(projectRoot), "root-consult-intents", intentId + ".json");
    const intent = JSON.parse(fs.readFileSync(intentPath, "utf8"));
    const coordRoot = rll.coordinationRootPathFor(projectRoot);
    const waveSlug = path.basename(path.dirname(rll.discoverPlan(projectRoot).planPath)).replace(/^wave-/, "");
    process.stdout.write(path.join(coordRoot, intent.repo_id, waveSlug, intent.plan_digest));
  ' "$RLL_IMPL" "$PROJ" "$intent_id"
}

_s16e2e_cp_evidence_setup() {
  local session_id="$1" gap_spec_json="$2" ttl="${3:-3600}"
  S16E2E_BG_PID=""
  S16E2E_FAKE_MODE="${S16E2E_FAKE_MODE:-context-provider-gap-once}"
  S16E2E_FAKE_GAP_SPEC="$gap_spec_json"
  _s16e2e_start_retained_plane "$session_id" "$S16E2E_SUPPORT_ROLES" "$ttl"
}

# M6+M7 SIXTEENTH CODEX ACCEPTANCE Correction D: asserts every recorded
# Context7 call against the REAL sockets only -- $S16E2E_FAKE_CONTEXT7_REQUEST_LOG
# (fake-context7-server.cjs's own req.method/req.url/req.headers/
# req.socket.servername, from the actual local TLS connection
# resolveTestContext7SocketAgent redirected to) and
# $S16E2E_FAKE_CONTEXT7_CONN_LOG (that same function's own createConnection-
# boundary recording of the real host/port/servername node's https.Agent
# internals passed it, BEFORE the loopback substitution). Never the deleted
# client-side pre-flight spec log. `expectedPath` is Node's raw req.url --
# path+query exactly as sent, order preserved, never re-parsed/re-ordered.
_s16e2e_assert_context7_calls() {
  local expected_count="$1" expected_path="$2"
  local call_count; call_count="$(wc -l < "$S16E2E_FAKE_CONTEXT7_REQUEST_LOG" | tr -d ' ')"
  [ "$call_count" -eq "$expected_count" ]
  local conn_count; conn_count="$(wc -l < "$S16E2E_FAKE_CONTEXT7_CONN_LOG" | tr -d ' ')"
  [ "$conn_count" -eq "$expected_count" ]
  node -e '
    const fs = require("fs");
    const reqLines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n");
    const connLines = fs.readFileSync(process.argv[2], "utf8").trim().split("\n");
    const expectedPath = process.argv[3];
    // Closed allow-set, not just a forbidden-set: Node itself adds Host/
    // Connection/Content-Length, production adds Accept/User-Agent -- ANY
    // other key (a proxy header, a secret, or anything else) fails closed,
    // satisfying "absence of Authorization, Cookie, proxy headers AND
    // extras" as one property rather than an enumerable blocklist.
    const ALLOWED_HEADERS = new Set(["accept", "user-agent", "host", "connection", "content-length"]);
    for (const line of reqLines) {
      const req = JSON.parse(line);
      if (req.method !== "GET") { process.stderr.write("expected method GET, got: " + line); process.exit(1); }
      if (req.url !== expectedPath) { process.stderr.write("expected url " + expectedPath + ", got: " + line); process.exit(1); }
      if (req.servername !== "context7.com") { process.stderr.write("expected socket servername context7.com (real TLS SNI as received), got: " + line); process.exit(1); }
      const h = req.headers || {};
      if (h.host !== "context7.com") { process.stderr.write("expected Host header context7.com, got: " + line); process.exit(1); }
      if (h.accept !== "text/plain" && h.accept !== "application/json") { process.stderr.write("unexpected Accept header: " + line); process.exit(1); }
      if (h["user-agent"] !== "AndroidCommonDoc-runtime/1") { process.stderr.write("unexpected User-Agent: " + line); process.exit(1); }
      for (const key of Object.keys(h)) {
        if (!ALLOWED_HEADERS.has(key)) { process.stderr.write("unexpected extra header " + key + " present: " + line); process.exit(1); }
      }
    }
    for (const line of connLines) {
      const conn = JSON.parse(line);
      if (conn.host !== "context7.com" || conn.port !== 443 || conn.servername !== "context7.com") {
        process.stderr.write("unexpected real connection options (pre-loopback-redirect): " + line); process.exit(1);
      }
    }
  ' "$S16E2E_FAKE_CONTEXT7_REQUEST_LOG" "$S16E2E_FAKE_CONTEXT7_CONN_LOG" "$expected_path"
}

@test "CP-EVIDENCE-E2E: real root intent (context7-required) -> real internal MCP search -> fake app-server emits ONE pattern-gap -> production Context7 builder/validator (supplied library_id) -> resumed SAME threadId -> result/v2 pattern_evidence_dependency -> real accept+ack" {
  local session_id="s16e2e-cpe-session"
  local gap_spec; gap_spec='{"provider":"context7","library_name":"Node.js","library_id":"/nodejs/node","query":"S16 CP-EVIDENCE-E2E: structuredClone deep-copy semantics for Map"}'
  local fixture_body; fixture_body="$(node -e 'process.stdout.write(Buffer.from("Context7 fixture content for CP-EVIDENCE-E2E supplied-id.", "utf8").toString("base64"))')"
  S16E2E_FAKE_CONTEXT7_RESPONSES="$(node -e 'process.stdout.write(JSON.stringify([{statusCode:200,headers:{"content-type":"text/plain; charset=utf-8"},bodyBase64:process.argv[1]}]))' "$fixture_body")"
  _s16e2e_cp_evidence_setup "$session_id" "$gap_spec"

  _s16e2e_consult_root_publish "$session_id" "CP-EVIDENCE-E2E-SUPPLIED-ID" "context7-required"
  local intent_id="$S16E2E_CR_INTENT_ID"

  if ! _s16e2e_poll_consult_root_status "$session_id" "$intent_id" "READY" >/dev/null; then
    echo "DEBUG bridge log tail:" >&2
    tail -80 "$S16E2E_BG_OUT" >&2
    echo "DEBUG timing log:" >&2
    [ -f "$S16E2E_TIMING_LOG" ] && cat "$S16E2E_TIMING_LOG" >&2
    false
  fi

  # Exactly one recorded Context7 call -- zero search, one context GET.
  _s16e2e_assert_context7_calls 1 "/api/v2/context?libraryId=%2Fnodejs%2Fnode&query=S16%20CP-EVIDENCE-E2E%3A%20structuredClone%20deep-copy%20semantics%20for%20Map"

  local status_cmd; status_cmd="$(_render_posix_direct node "$RLL_IMPL" consult-root-status --project-root "$PROJ" --intent-id "$intent_id")"
  _make_input "$status_cmd" "" "$session_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local final_grant; final_grant="$(_extract_injected lifecycle-binding)"
  run env NODE_ENV=test node "$RLL_IMPL" consult-root-status --project-root "$PROJ" --intent-id "$intent_id" --lifecycle-binding "$final_grant"
  [ "$status" -eq 0 ]
  node -e '
    const e = JSON.parse(process.argv[1]);
    if (e.status !== "READY" || !e.operation || e.operation.state !== "READY" || e.operation.result_ref === null) {
      process.stderr.write("consult-root-status: " + JSON.stringify(e)); process.exit(1);
    }
  ' "$output"
  local result_ref; result_ref="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).operation.result_ref)' "$output")"

  local plan_root; plan_root="$(_s16e2e_consult_root_plan_root "$intent_id")"
  node -e '
    const fs = require("fs"); const path = require("path");
    const resultPath = path.join(process.argv[1], process.argv[2]);
    const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
    if (result.status !== "ANSWERED") { process.stderr.write("expected ANSWERED, got " + JSON.stringify(result)); process.exit(1); }
    const dep = result.pattern_evidence_dependency;
    const expectedKeys = ["evidence_digest", "evidence_ref", "gap_digest", "internal_search_digest", "library_id", "provider", "query_digest", "resolution_digest"];
    if (!dep || typeof dep !== "object") { process.stderr.write("expected a non-null pattern_evidence_dependency, got " + JSON.stringify(result)); process.exit(1); }
    const gotKeys = Object.keys(dep).sort();
    if (JSON.stringify(gotKeys) !== JSON.stringify(expectedKeys.sort())) {
      process.stderr.write("pattern_evidence_dependency key set drift: " + JSON.stringify(gotKeys)); process.exit(1);
    }
    if (dep.provider !== "context7" || dep.library_id !== "/nodejs/node" || dep.resolution_digest !== null) {
      process.stderr.write("pattern_evidence_dependency field mismatch: " + JSON.stringify(dep)); process.exit(1);
    }
  ' "$plan_root" "$result_ref"

  local completion_path; completion_path="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.rootConsultCompletionPathFor(process.argv[2], process.argv[3]));' "$RLL_IMPL" "$PROJ" "$intent_id")"
  [ -f "$completion_path" ]
  node -e '
    const fs = require("fs");
    const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (c.accepted_result_ref === null || c.accepted_result_digest === null || c.ack_ref === null || c.ack_digest === null) process.exit(1);
  ' "$completion_path"

  _s16e2e_stop_retained_plane
}

@test "S16-CP-EVIDENCE-NULL-LIBRARY-ID-01: null library_id performs one deterministic search resolving a single match, then one context GET" {
  local session_id="s16e2e-cpe-null-session"
  local gap_spec; gap_spec='{"provider":"context7","library_name":"Node.js","library_id":null,"query":"S16 CP-EVIDENCE-E2E: null library_id resolution"}'
  local search_body; search_body="$(node -e 'process.stdout.write(Buffer.from(JSON.stringify({results:[{id:"/nodejs/node",title:"Node.js"}]}),"utf8").toString("base64"))')"
  local context_body; context_body="$(node -e 'process.stdout.write(Buffer.from("Context7 fixture content for CP-EVIDENCE-E2E null-id.", "utf8").toString("base64"))')"
  S16E2E_FAKE_CONTEXT7_RESPONSES="$(node -e '
    process.stdout.write(JSON.stringify([
      { statusCode: 200, headers: { "content-type": "application/json" }, bodyBase64: process.argv[1] },
      { statusCode: 200, headers: { "content-type": "text/plain; charset=utf-8" }, bodyBase64: process.argv[2] },
    ]));
  ' "$search_body" "$context_body")"
  _s16e2e_cp_evidence_setup "$session_id" "$gap_spec"

  _s16e2e_consult_root_publish "$session_id" "CP-EVIDENCE-NULL-LIBRARY-ID-01" "context7-required"
  local intent_id="$S16E2E_CR_INTENT_ID"

  if ! _s16e2e_poll_consult_root_status "$session_id" "$intent_id" "READY" >/dev/null; then
    echo "DEBUG bridge log tail:" >&2
    tail -80 "$S16E2E_BG_OUT" >&2
    echo "DEBUG timing log:" >&2
    [ -f "$S16E2E_TIMING_LOG" ] && cat "$S16E2E_TIMING_LOG" >&2
    false
  fi

  # M6+M7 SIXTEENTH CODEX ACCEPTANCE Correction D: from the fake server's own
  # real-socket recording ($S16E2E_FAKE_CONTEXT7_REQUEST_LOG), never a
  # client-side pre-flight log -- see _s16e2e_assert_context7_calls's own
  # header comment. This test's two calls have DIFFERENT expected paths/
  # Accept headers (search then context), so it checks them individually
  # rather than through that shared single-shape helper.
  local call_count; call_count="$(wc -l < "$S16E2E_FAKE_CONTEXT7_REQUEST_LOG" | tr -d ' ')"
  [ "$call_count" -eq 2 ]
  node -e '
    const fs = require("fs");
    const lines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const search = lines[0]; const ctx = lines[1];
    for (const req of lines) {
      if (req.method !== "GET" || req.servername !== "context7.com" || (req.headers || {}).host !== "context7.com") {
        process.stderr.write("unexpected recorded Context7 request: " + JSON.stringify(req)); process.exit(1);
      }
    }
    if (!search.url.startsWith("/api/v2/libs/search?") || !search.url.includes("libraryName=Node.js")) {
      process.stderr.write("expected the search call first: " + JSON.stringify(search)); process.exit(1);
    }
    if (search.headers.accept !== "application/json") { process.stderr.write("expected Accept: application/json for search"); process.exit(1); }
    if (!ctx.url.startsWith("/api/v2/context?libraryId=%2Fnodejs%2Fnode")) {
      process.stderr.write("expected the resolved library id on the context call: " + JSON.stringify(ctx)); process.exit(1);
    }
  ' "$S16E2E_FAKE_CONTEXT7_REQUEST_LOG"

  local plan_root; plan_root="$(_s16e2e_consult_root_plan_root "$intent_id")"
  local status_cmd; status_cmd="$(_render_posix_direct node "$RLL_IMPL" consult-root-status --project-root "$PROJ" --intent-id "$intent_id")"
  _make_input "$status_cmd" "" "$session_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local final_grant; final_grant="$(_extract_injected lifecycle-binding)"
  run env NODE_ENV=test node "$RLL_IMPL" consult-root-status --project-root "$PROJ" --intent-id "$intent_id" --lifecycle-binding "$final_grant"
  [ "$status" -eq 0 ]
  local result_ref; result_ref="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).operation.result_ref)' "$output")"
  node -e '
    const fs = require("fs"); const path = require("path");
    const result = JSON.parse(fs.readFileSync(path.join(process.argv[1], process.argv[2]), "utf8"));
    const dep = result.pattern_evidence_dependency;
    if (!dep || dep.library_id !== "/nodejs/node" || dep.resolution_digest === null) {
      process.stderr.write("expected a resolved library_id with a non-null resolution_digest: " + JSON.stringify(dep)); process.exit(1);
    }
  ' "$plan_root" "$result_ref"

  _s16e2e_stop_retained_plane
}

@test "S16-CP-EVIDENCE-NO-GAP-01: evidence_policy:none never triggers Context7 -- zero recorded calls, zero pattern_evidence_dependency" {
  local session_id="s16e2e-cpe-nogap-session"
  S16E2E_BG_PID=""
  S16E2E_FAKE_MODE="cooperative"
  S16E2E_FAKE_GAP_SPEC=""
  S16E2E_FAKE_CONTEXT7_RESPONSES=""
  _s16e2e_start_retained_plane "$session_id"

  _s16e2e_consult_root_publish "$session_id" "CP-EVIDENCE-NO-GAP-01" "none"
  local intent_id="$S16E2E_CR_INTENT_ID"

  if ! _s16e2e_poll_consult_root_status "$session_id" "$intent_id" "READY" >/dev/null; then
    echo "DEBUG bridge log tail:" >&2
    tail -80 "$S16E2E_BG_OUT" >&2
    false
  fi

  # No S16E2E_FAKE_CONTEXT7_RESPONSES means _s16e2e_start_bridge_bg never
  # started a fake server at all for this test (evidence_policy:none should
  # never need one) -- S16E2E_FAKE_CONTEXT7_REQUEST_LOG stays the empty
  # string in that case; tolerate that alongside an existing-but-empty file.
  [ -z "$S16E2E_FAKE_CONTEXT7_REQUEST_LOG" ] || [ ! -s "$S16E2E_FAKE_CONTEXT7_REQUEST_LOG" ]

  local plan_root; plan_root="$(_s16e2e_consult_root_plan_root "$intent_id")"
  local status_cmd; status_cmd="$(_render_posix_direct node "$RLL_IMPL" consult-root-status --project-root "$PROJ" --intent-id "$intent_id")"
  _make_input "$status_cmd" "" "$session_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local final_grant; final_grant="$(_extract_injected lifecycle-binding)"
  run env NODE_ENV=test node "$RLL_IMPL" consult-root-status --project-root "$PROJ" --intent-id "$intent_id" --lifecycle-binding "$final_grant"
  [ "$status" -eq 0 ]
  local result_ref; result_ref="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).operation.result_ref)' "$output")"
  node -e '
    const fs = require("fs"); const path = require("path");
    const result = JSON.parse(fs.readFileSync(path.join(process.argv[1], process.argv[2]), "utf8"));
    if (result.pattern_evidence_dependency !== null) { process.stderr.write("expected null: " + JSON.stringify(result.pattern_evidence_dependency)); process.exit(1); }
  ' "$plan_root" "$result_ref"

  _s16e2e_stop_retained_plane
}

# ── CP-EVIDENCE-E2E mandatory negatives ─────────────────────────────────────
# S16-PATTERN-GAP-CP-ONLY-01 (runtime-consultation-bridge.bats) already proves
# validateRuntimeTurnEnvelope itself rejects a second gap and a non-CP-role
# gap at the unit level -- including that a non-CP role's OWN Codex output
# schema never even contains a pattern-gap branch to begin with (built via
# patternGapAllowed:false for every role but context-provider). The E2E
# topology itself structurally can never construct "a non-context-provider
# target with evidence" (hostBridgeAllowedChildRoles/s16ResolveRetainedPair
# force consult-root's target to context-provider -- see ROOT-INGRESS-E2E's
# own header comment), so that specific negative has no meaningful E2E
# surface beyond what the unit test already proves. The negatives below
# instead prove the REAL retained-worker wiring fails closed end-to-end
# for the network-boundary and resolution-ambiguity failure modes, which
# the unit-level validator tests never touch (they stop at the schema).

# Publishes a context7-required consult-root intent against a context-
# provider-gap-once plane and asserts the retained bridge fails CLOSED
# (never a fabricated ANSWERED/READY) -- checked via the bridge's own final
# bridge-result summary signal, which is guaranteed to flush because it is
# written at process exit (session-run's own last, synchronous act).
# M6+M7 SIXTEENTH CODEX ACCEPTANCE Correction F: called DIRECTLY by every
# S16-CP-EVIDENCE-* negative below -- never `run _s16e2e_cp_evidence_expect_
# shutdown_signal ...` (the harness hang this correction closes: an
# inherited-stdout fake-context7-server child, fixed above in
# _s16e2e_start_bridge_bg, could keep bats' own `run` capture blocked on EOF
# long after this function's own real work was done). Its own pass/fail is
# now carried entirely by ITS exit code via plain errexit propagation, never
# a separately-checked $status.
#
# The whole body runs inside a subshell with a LOCAL `trap ... EXIT` (never
# `trap ... RETURN` -- see UMASK-0600-01's own comment elsewhere in this
# repo: a RETURN trap conflicts with bats' internal RETURN-trap use inside
# `run`; a subshell's own EXIT trap is untouched by bats, confirmed against
# bats-core's bats-exec-test source during NO-GO Correction A above) so
# _s16e2e_stop_retained_plane runs on EVERY exit path -- the bounded-wait
# timeout, the substring mismatch, the final completion-absence check, or a
# clean pass -- never leaving the bridge or fake Context7 server as an
# orphan the caller's own final _s16e2e_stop_retained_plane (never reached
# on an early failure) or teardown()'s safety net would otherwise have to
# catch blind.

# M6+M7 SIXTEENTH Phase 2A: byte-bound evidence for exactly ONE real Context7
# call (every one of the 8 CP-EVIDENCE negatives makes exactly one -- search
# XOR context, depending on whether gap_spec's library_id is null or
# supplied -- before failing). Requires BOTH:
#   - the connection log (resolveTestContext7SocketAgent's own pre-tls.connect
#     recording of the real host/port/servername Node's https.Agent internals
#     were given, before the loopback redirect);
#   - the request log, written by the fake HTTPS server ONLY AFTER it
#     genuinely received the request over the real local TLS socket (proves
#     the failure happened downstream of a real request/response round trip
#     or a genuine no-response hang, never merely "a connection was opened").
# Computes the exact expected path from gap_spec_json using the SAME
# rfc3986Encode + path formula as performDirectContext7Sequence
# (runtime-bridge-codex.cjs) -- never a looser startsWith/includes check.
_s16e2e_cp_evidence_assert_negative_call() {
  local gap_spec_json="$1"
  local call_count; call_count="$(wc -l < "$S16E2E_FAKE_CONTEXT7_REQUEST_LOG" 2>/dev/null | tr -d ' ')"
  if [ "${call_count:-0}" -ne 1 ]; then
    echo "DEBUG: expected exactly 1 recorded Context7 request, got ${call_count:-0}:" >&2
    [ -f "$S16E2E_FAKE_CONTEXT7_REQUEST_LOG" ] && cat "$S16E2E_FAKE_CONTEXT7_REQUEST_LOG" >&2
    return 1
  fi
  local conn_count; conn_count="$(wc -l < "$S16E2E_FAKE_CONTEXT7_CONN_LOG" 2>/dev/null | tr -d ' ')"
  if [ "${conn_count:-0}" -ne 1 ]; then
    echo "DEBUG: expected exactly 1 recorded Context7 connection, got ${conn_count:-0}:" >&2
    [ -f "$S16E2E_FAKE_CONTEXT7_CONN_LOG" ] && cat "$S16E2E_FAKE_CONTEXT7_CONN_LOG" >&2
    return 1
  fi
  node -e '
    const fs = require("fs");
    function rfc3986Encode(value) {
      return encodeURIComponent(value).replace(/[!\x27()*]/g, (char) => (
        "%" + char.charCodeAt(0).toString(16).toUpperCase()
      ));
    }
    const gap = JSON.parse(process.argv[1]);
    const reqLog = process.argv[2];
    const connLog = process.argv[3];
    const expectedPath = gap.library_id === null
      ? "/api/v2/libs/search?libraryName=" + rfc3986Encode(gap.library_name) + "&query=" + rfc3986Encode(gap.query)
      : "/api/v2/context?libraryId=" + rfc3986Encode(gap.library_id) + "&query=" + rfc3986Encode(gap.query);
    const expectedAccept = gap.library_id === null ? "application/json" : "text/plain";
    const ALLOWED_HEADERS = new Set(["accept", "user-agent", "host", "connection", "content-length"]);
    const FORBIDDEN_HEADERS = ["authorization", "cookie", "proxy-authorization", "proxy-connection", "x-forwarded-for", "via"];
    const req = JSON.parse(fs.readFileSync(reqLog, "utf8").trim());
    if (req.method !== "GET") { process.stderr.write("expected method GET, got: " + JSON.stringify(req)); process.exit(1); }
    if (req.url !== expectedPath) { process.stderr.write("expected url " + expectedPath + ", got: " + JSON.stringify(req)); process.exit(1); }
    if (req.servername !== "context7.com") { process.stderr.write("expected socket servername context7.com, got: " + JSON.stringify(req)); process.exit(1); }
    const h = req.headers || {};
    if (h.host !== "context7.com") { process.stderr.write("expected Host header context7.com, got: " + JSON.stringify(req)); process.exit(1); }
    if (h.accept !== expectedAccept) { process.stderr.write("expected Accept " + expectedAccept + ", got: " + JSON.stringify(req)); process.exit(1); }
    if (h["user-agent"] !== "AndroidCommonDoc-runtime/1") { process.stderr.write("unexpected User-Agent: " + JSON.stringify(req)); process.exit(1); }
    for (const key of Object.keys(h)) {
      if (!ALLOWED_HEADERS.has(key)) { process.stderr.write("unexpected extra header " + key + " present (closed allowlist): " + JSON.stringify(req)); process.exit(1); }
    }
    for (const forbidden of FORBIDDEN_HEADERS) {
      if (forbidden in h) { process.stderr.write("forbidden header " + forbidden + " present: " + JSON.stringify(req)); process.exit(1); }
    }
    if ("location" in h) { process.stderr.write("unexpected redirect-shaped Location header on a REQUEST record: " + JSON.stringify(req)); process.exit(1); }
    const conn = JSON.parse(fs.readFileSync(connLog, "utf8").trim());
    if (conn.host !== "context7.com" || conn.port !== 443 || conn.servername !== "context7.com") {
      process.stderr.write("unexpected real connection options (pre-loopback-redirect): " + JSON.stringify(conn)); process.exit(1);
    }
  ' "$gap_spec_json" "$S16E2E_FAKE_CONTEXT7_REQUEST_LOG" "$S16E2E_FAKE_CONTEXT7_CONN_LOG"
}

# M6+M7 SIXTEENTH CODEX ACCEPTANCE Correction F (Phase 2A hardened): called
# DIRECTLY by every S16-CP-EVIDENCE-* negative below -- never `run
# _s16e2e_cp_evidence_expect_shutdown_signal ...` (the harness hang this
# correction closes: an inherited-stdout fake-context7-server child could
# keep bats' own `run` capture blocked on EOF long after this function's own
# real work was done). Its own pass/fail is carried entirely by its exit code
# via plain errexit propagation, never a separately-checked $status.
_s16e2e_cp_evidence_expect_shutdown_signal() {
  local session_id="$1" gap_spec_json="$2" responses_json="$3" expected_reason="$4" ttl="${5:-3600}"
  (
    trap '_s16e2e_stop_retained_plane || true' EXIT
    S16E2E_FAKE_CONTEXT7_RESPONSES="$responses_json"
    _s16e2e_cp_evidence_setup "$session_id" "$gap_spec_json" "$ttl"
    _s16e2e_consult_root_publish "$session_id" "cp-evidence-negative" "context7-required"
    intent_id="$S16E2E_CR_INTENT_ID"
    completion_path="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.rootConsultCompletionPathFor(process.argv[2], process.argv[3]));' "$RLL_IMPL" "$PROJ" "$intent_id")"

    # M6+M7 SIXTEENTH Phase 2A: active monotonic poll, never a fixed
    # sleep-then-check-once. A completion appearing at ANY point during the
    # wait is an immediate FAIL (a durability failure must never race a
    # fabricated success into existence) -- checked on every tick, not only
    # after the bridge process has already exited.
    tries=0
    while true; do
      if [ -f "$completion_path" ]; then
        echo "DEBUG: a completion record appeared while awaiting fail-closed shutdown -- this must never happen:" >&2
        cat "$completion_path" >&2
        exit 1
      fi
      if ! kill -0 "$S16E2E_BG_PID" 2>/dev/null; then
        break
      fi
      tries=$((tries + 1))
      if [ "$tries" -ge 3600 ]; then
        echo "DEBUG: bridge never exited on its own within deadline" >&2
        tail -80 "$S16E2E_BG_OUT" >&2
        exit 1
      fi
      sleep 0.1
    done
    # PID confirmed dead: wait/reap, then recheck completion is still absent
    # (closes the gap between the last poll tick and the process actually
    # exiting) before trusting anything the process wrote on its way out.
    wait "$S16E2E_BG_PID" 2>/dev/null || true
    S16E2E_BG_PID=""
    if [ -f "$completion_path" ]; then
      echo "DEBUG: a completion record appeared between the final poll and process reap -- this must never happen:" >&2
      cat "$completion_path" >&2
      exit 1
    fi

    # M6+M7 SIXTEENTH Phase 2A: parse the LAST coordination/bridge-result/v1
    # line (session-run's own final, synchronous, guaranteed-to-flush act --
    # its process.exit only happens after this write), never a substring
    # grep over the raw log. Requires EXACT equality against the fully
    # constructed signal -- no OTHER reason, including a same-shaped MCP-
    # layer failure or (outside TIMEOUT-01) a genuine context7-timeout, may
    # satisfy this.
    local expected_signal="APP_SERVER_WORKER_LOOP_FAILED:$expected_reason"
    node -e '
      const fs = require("fs");
      const lines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").filter(Boolean);
      let last = null;
      for (const line of lines) {
        let obj;
        try { obj = JSON.parse(line); } catch (err) { continue; }
        if (obj && obj.schema === "coordination/bridge-result/v1") last = obj;
      }
      const expected = process.argv[2];
      if (!last) { process.stderr.write("no coordination/bridge-result/v1 line found in bridge output"); process.exit(1); }
      if (last.signal !== expected) {
        process.stderr.write("expected signal exactly " + JSON.stringify(expected) + ", got " + JSON.stringify(last.signal) + " (full record: " + JSON.stringify(last) + ")");
        process.exit(1);
      }
    ' "$S16E2E_BG_OUT" "$expected_signal"

    # A durability failure like this must never publish a completion -- the
    # consult-root intent stays WAITING/BLOCKED-at-the-transaction-level
    # forever, never a fabricated READY. (Final re-confirmation, after the
    # monotonic poll above already proved it never transiently appeared.)
    [ ! -f "$completion_path" ]

    # M6+M7 SIXTEENTH Phase 2A: the exact-signal match above proves the
    # bridge's OWN log carries the right reason, but not that Context7 was
    # genuinely REACHED and genuinely answered/hung as this scenario's own
    # fixture dictates -- an internal-search/MCP failure occurring BEFORE the
    # model ever gets a turn could, in principle, produce a similarly-worded
    # message for the wrong reason. Byte-bound exact-phase evidence closes
    # that gap.
    _s16e2e_cp_evidence_assert_negative_call "$gap_spec_json"
  )
}

@test "S16-CP-EVIDENCE-SECOND-GAP-01: a model that tries to emit a second pattern-gap on the resumed turn is rejected, never a fabricated answer" {
  local gap_spec; gap_spec='{"provider":"context7","library_name":"Node.js","library_id":"/nodejs/node","query":"S16 CP-EVIDENCE-SECOND-GAP-01"}'
  local fixture_body; fixture_body="$(node -e 'process.stdout.write(Buffer.from("fixture", "utf8").toString("base64"))')"
  local responses; responses="$(node -e 'process.stdout.write(JSON.stringify([{statusCode:200,headers:{"content-type":"text/plain; charset=utf-8"},bodyBase64:process.argv[1]}]))' "$fixture_body")"
  S16E2E_BG_PID=""
  S16E2E_FAKE_MODE="context-provider-gap-always"
  # A model that keeps re-offering pattern-gap after validation rejects it
  # isn't treated as instantly fatal (waitForValidatedTurnCompletion polls
  # for a still-possible valid answer) -- it only gives up at the request's
  # own expiry-derived deadline. A short-lived binding (300s, safely above
  # s16ResolveMainContext's 120s creation-lifetime floor) makes that bound
  # reachable in this test instead of the real ~1h default.
  # M6+M7 SIXTEENTH Phase 2A: the FULL exact chained reason -- production
  # wraps this specific rejection through two outer layers (an invalid
  # canonical envelope wrapping the inner pattern-gap-forbidden cause)
  # before it ever reaches workerFailureSignal, unlike every other negative
  # below whose reason is a single unwrapped Error#message.
  _s16e2e_cp_evidence_expect_shutdown_signal "s16e2e-cpe-2ndgap-session" "$gap_spec" "$responses" "turn-completed-envelope-invalid:canonical-envelope-invalid:pattern-gap-forbidden-for-execution-context" 300
}

@test "S16-CP-EVIDENCE-MALFORMED-SEARCH-01: a non-JSON search response body fails closed, never a fabricated answer" {
  local gap_spec; gap_spec='{"provider":"context7","library_name":"Node.js","library_id":null,"query":"S16 CP-EVIDENCE-MALFORMED-SEARCH-01"}'
  local bad_body; bad_body="$(node -e 'process.stdout.write(Buffer.from("{not valid json", "utf8").toString("base64"))')"
  local responses; responses="$(node -e 'process.stdout.write(JSON.stringify([{statusCode:200,headers:{"content-type":"application/json"},bodyBase64:process.argv[1]}]))' "$bad_body")"
  S16E2E_BG_PID=""
  S16E2E_FAKE_MODE="context-provider-gap-once"
  _s16e2e_cp_evidence_expect_shutdown_signal "s16e2e-cpe-malformed-session" "$gap_spec" "$responses" "context7-search-json-invalid"
}

@test "S16-CP-EVIDENCE-OVERSIZED-CONTEXT-01: a context response body over CONTEXT7_CONTEXT_RESPONSE_CAP fails closed, never a fabricated answer" {
  local gap_spec; gap_spec='{"provider":"context7","library_name":"Node.js","library_id":"/nodejs/node","query":"S16 CP-EVIDENCE-OVERSIZED-CONTEXT-01"}'
  # The 1MB+ base64 body must never cross an argv boundary (ARG_MAX) --
  # generated and JSON-wrapped in one single node invocation.
  local responses; responses="$(node -e '
    const body = Buffer.alloc(1024 * 1024 + 16, 97).toString("base64");
    process.stdout.write(JSON.stringify([
      { statusCode: 200, headers: { "content-type": "text/plain; charset=utf-8" }, bodyBase64: body },
    ]));
  ')"
  S16E2E_BG_PID=""
  S16E2E_FAKE_MODE="context-provider-gap-once"
  _s16e2e_cp_evidence_expect_shutdown_signal "s16e2e-cpe-oversized-session" "$gap_spec" "$responses" "context7-response-too-large"
}

@test "S16-CP-EVIDENCE-ZERO-MATCH-01: a search with zero results is an ambiguous resolution, fails closed" {
  local gap_spec; gap_spec='{"provider":"context7","library_name":"Node.js","library_id":null,"query":"S16 CP-EVIDENCE-ZERO-MATCH-01"}'
  local search_body; search_body="$(node -e 'process.stdout.write(Buffer.from(JSON.stringify({results:[]}),"utf8").toString("base64"))')"
  local responses; responses="$(node -e 'process.stdout.write(JSON.stringify([{statusCode:200,headers:{"content-type":"application/json"},bodyBase64:process.argv[1]}]))' "$search_body")"
  S16E2E_BG_PID=""
  S16E2E_FAKE_MODE="context-provider-gap-once"
  _s16e2e_cp_evidence_expect_shutdown_signal "s16e2e-cpe-zeromatch-session" "$gap_spec" "$responses" "context7-library-selection-ambiguous"
}

@test "S16-CP-EVIDENCE-N-MATCH-01: a search with more than one equally-titled match is an ambiguous resolution, fails closed" {
  local gap_spec; gap_spec='{"provider":"context7","library_name":"Node.js","library_id":null,"query":"S16 CP-EVIDENCE-N-MATCH-01"}'
  local search_body; search_body="$(node -e 'process.stdout.write(Buffer.from(JSON.stringify({results:[{id:"/nodejs/node",title:"Node.js"},{id:"/nodejs/node-other",title:"Node.js"}]}),"utf8").toString("base64"))')"
  local responses; responses="$(node -e 'process.stdout.write(JSON.stringify([{statusCode:200,headers:{"content-type":"application/json"},bodyBase64:process.argv[1]}]))' "$search_body")"
  S16E2E_BG_PID=""
  S16E2E_FAKE_MODE="context-provider-gap-once"
  _s16e2e_cp_evidence_expect_shutdown_signal "s16e2e-cpe-nmatch-session" "$gap_spec" "$responses" "context7-library-selection-ambiguous"
}

@test "S16-CP-EVIDENCE-LIBRARY-MISMATCH-01: a search result whose title does not match the requested library_name is filtered to zero matches, fails closed" {
  local gap_spec; gap_spec='{"provider":"context7","library_name":"Node.js","library_id":null,"query":"S16 CP-EVIDENCE-LIBRARY-MISMATCH-01"}'
  local search_body; search_body="$(node -e 'process.stdout.write(Buffer.from(JSON.stringify({results:[{id:"/some/other-lib",title:"Some Other Library"}]}),"utf8").toString("base64"))')"
  local responses; responses="$(node -e 'process.stdout.write(JSON.stringify([{statusCode:200,headers:{"content-type":"application/json"},bodyBase64:process.argv[1]}]))' "$search_body")"
  S16E2E_BG_PID=""
  S16E2E_FAKE_MODE="context-provider-gap-once"
  _s16e2e_cp_evidence_expect_shutdown_signal "s16e2e-cpe-mismatch-session" "$gap_spec" "$responses" "context7-library-selection-ambiguous"
}

@test "S16-CP-EVIDENCE-TIMEOUT-01: a Context7 call that never responds genuinely times out via the real bounded timeout, fails closed" {
  local gap_spec; gap_spec='{"provider":"context7","library_name":"Node.js","library_id":"/nodejs/node","query":"S16 CP-EVIDENCE-TIMEOUT-01"}'
  local responses; responses='[{"hang":true}]'
  S16E2E_BG_PID=""
  S16E2E_FAKE_MODE="context-provider-gap-once"
  _s16e2e_cp_evidence_expect_shutdown_signal "s16e2e-cpe-timeout-session" "$gap_spec" "$responses" "context7-timeout"
}

@test "S16-CP-EVIDENCE-429-RETRY-AFTER-01: a 429 with Retry-After is a non-200 response, fails closed, never silently retried into a fabricated answer" {
  local gap_spec; gap_spec='{"provider":"context7","library_name":"Node.js","library_id":"/nodejs/node","query":"S16 CP-EVIDENCE-429-RETRY-AFTER-01"}'
  local body; body="$(node -e 'process.stdout.write(Buffer.from("rate limited", "utf8").toString("base64"))')"
  local responses; responses="$(node -e 'process.stdout.write(JSON.stringify([{statusCode:429,headers:{"content-type":"text/plain","retry-after":"30"},bodyBase64:process.argv[1]}]))' "$body")"
  S16E2E_BG_PID=""
  S16E2E_FAKE_MODE="context-provider-gap-once"
  _s16e2e_cp_evidence_expect_shutdown_signal "s16e2e-cpe-429-session" "$gap_spec" "$responses" "context7-response-invalid"
}

@test "S16-CP-EVIDENCE-MCP-CLEANUP-01: the internal-search MCP child is genuinely gone (no orphan) after a real context-provider turn completes" {
  local session_id="s16e2e-cpe-cleanup-session"
  # M6+M7 SIXTEENTH CODEX ACCEPTANCE Correction F: scoped to THIS test's own
  # $PROJ (a fresh mktemp -d, unique per test) rather than a global `pgrep
  # -f "mcp-server/build/runtime-search-stdio.js"` -- a bare substring
  # matches ANY
  # process on the machine with that path fragment anywhere in its argv,
  # including a totally unrelated concurrently-running test's own MCP child
  # or an orphan left by a PRIOR test run, either of which would make this
  # count comparison spuriously pass OR fail for a reason having nothing to
  # do with THIS test's own cleanup.
  S16E2E_FAKE_MODE="cooperative"
  S16E2E_FAKE_GAP_SPEC=""
  S16E2E_FAKE_CONTEXT7_RESPONSES=""
  _s16e2e_cp_evidence_setup "$session_id" ""
  _s16e2e_consult_root_publish "$session_id" "CP-EVIDENCE-MCP-CLEANUP-01" "none"
  local intent_id="$S16E2E_CR_INTENT_ID"
  if ! _s16e2e_poll_consult_root_status "$session_id" "$intent_id" "READY" >/dev/null; then
    tail -80 "$S16E2E_BG_OUT" >&2
    false
  fi
  # runContextProviderInternalSearch's own finally block requires
  # stopOwnedAppServerChildBounded to CONFIRM the child is gone (throwing
  # DURABILITY_UNPROVEN otherwise) before ever returning. Stop the retained
  # plane and verify its durable coordinator receipt too: no raw MCP promise,
  # request or unconfirmed owned child may remain. This is the authoritative
  # cross-platform proof; OS process-name scans are neither ownership-scoped
  # nor reliable in hybrid Windows/WSL environments.
  local repo_id action_id
  repo_id="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).repo_id)' "$S16E2E_ACTION_JSON")"
  action_id="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).action_id)' "$S16E2E_ACTION_JSON")"
  _s16e2e_stop_retained_plane
  local receipt_path
  receipt_path="$(node -e 'const path=require("path"),rll=require(process.argv[1]); process.stdout.write(path.join(rll.registryRepoDir({repoId:process.argv[2]}),"shutdown-receipts",process.argv[3]+".json"));' "$RLL_IMPL" "$repo_id" "$action_id")"
  [ -f "$receipt_path" ]
  run node -e '
    const receipt = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const q = receipt.quiescence;
    const c = receipt.children;
    if (!q || q.pending_raw_mcp !== 0 || q.pending_requests !== 0) throw new Error("MCP/request work not quiescent: " + JSON.stringify(q));
    if (!c || c.unconfirmed !== 0 || c.observed !== c.exit_confirmed || c.observed !== c.streams_closed) throw new Error("owned children not confirmed closed: " + JSON.stringify(c));
  ' "$receipt_path"
  [ "$status" -eq 0 ]
}

# NO-GO Correction E (§16d line 79: "the MCP executable/argv/cwd/shell/
# environment confinement is widened or inherits a secret/proxy/credential"):
# the S16-CP-EVIDENCE-* tests above exercise the real internal-search child
# end-to-end, but none of them can DIRECTLY observe the exact env object
# handed to StdioClientTransport -- a widened env that still lets search-docs
# resolve would pass every one of them silently. This fast, direct check on
# closedMcpEnvironment's own return value (exported specifically for this,
# same rationale as childEnvFromTopology) closes that gap without spawning a
# real child.
@test "S16-CP-SPAWN-CONFINEMENT-ENV-01: closedMcpEnvironment returns EXACTLY the PLAN.md §16c closed POSIX key set, no inherited/secret/proxy value" {
  if [ "$(node -p 'process.platform')" = "win32" ]; then
    skip "POSIX-only environment contract; native Windows confinement is covered by the Windows suites"
  fi
  run env NODE_ENV=test RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY="$TG_CAPABILITY" node -e '
    const rbc = require(process.argv[1]);
    const projectRoot = "/example/project-root";
    const isolatedHome = "/example/isolated-home";
    const env = rbc.closedMcpEnvironment(projectRoot, isolatedHome);
    const expectedKeys = ["ANDROID_COMMON_DOC","HOME","LOGNAME","PATH","SHELL","TERM","USER","HTTP_PROXY","HTTPS_PROXY","ALL_PROXY","NO_PROXY"];
    const actualKeys = Object.keys(env).sort();
    const keysMatch = JSON.stringify(actualKeys) === JSON.stringify(expectedKeys.slice().sort());
    const result = {
      keysMatch, actualKeys,
      androidCommonDoc: env.ANDROID_COMMON_DOC, home: env.HOME, logname: env.LOGNAME,
      path: env.PATH, shell: env.SHELL, term: env.TERM, user: env.USER,
      httpProxy: env.HTTP_PROXY, httpsProxy: env.HTTPS_PROXY, allProxy: env.ALL_PROXY, noProxy: env.NO_PROXY,
    };
    process.stdout.write(JSON.stringify(result));
    const ok = (
      keysMatch && env.ANDROID_COMMON_DOC === projectRoot && env.HOME === isolatedHome
      && env.LOGNAME === "runtime" && env.PATH === "" && env.SHELL === "" && env.TERM === "dumb"
      && env.USER === "runtime" && env.HTTP_PROXY === "" && env.HTTPS_PROXY === ""
      && env.ALL_PROXY === "" && env.NO_PROXY === "*"
    );
    if (!ok) process.exit(1);
  ' "$LIB_DIR/runtime-bridge-codex.cjs"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"keysMatch":true'* ]]
  [[ "$output" == *'"path":""'* ]]
  [[ "$output" == *'"httpProxy":""'* ]]
  [[ "$output" == *'"noProxy":"*"'* ]]
}

@test "S16-CP-SPAWN-CONFINEMENT-WINDOWS-ENV-01: closedMcpEnvironment derives architecture natively and confines the Windows profile even when Git Bash omits PROCESSOR_ARCHITECTURE" {
  if [ "$(node -p 'process.platform')" != "win32" ]; then
    skip "native Windows-only environment contract"
  fi
  run env -u PROCESSOR_ARCHITECTURE NODE_ENV=test RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY="$TG_CAPABILITY" node -e '
    const path = require("path");
    const rbc = require(process.argv[1]);
    const projectRoot = path.resolve(process.argv[2]);
    const isolatedHome = path.resolve(process.argv[3]);
    const env = rbc.closedMcpEnvironment(projectRoot, isolatedHome);
    const expectedKeys = [
      "ALL_PROXY", "ANDROID_COMMON_DOC", "APPDATA", "HOMEDRIVE", "HOMEPATH",
      "HTTP_PROXY", "HTTPS_PROXY", "LOCALAPPDATA", "NO_PROXY", "PATH",
      "PROCESSOR_ARCHITECTURE", "PROGRAMFILES", "SYSTEMDRIVE", "SYSTEMROOT",
      "TEMP", "USERNAME", "USERPROFILE",
    ].sort();
    const expectedArch = ({ ia32: "x86", x64: "AMD64", arm64: "ARM64" })[process.arch];
    const actualKeys = Object.keys(env).sort();
    const userRoot = path.join(isolatedHome, "mcp-user");
    const ok = (
      JSON.stringify(actualKeys) === JSON.stringify(expectedKeys)
      && env.PROCESSOR_ARCHITECTURE === expectedArch
      && env.USERPROFILE === userRoot
      && env.APPDATA === path.join(userRoot, "AppData", "Roaming")
      && env.LOCALAPPDATA === path.join(userRoot, "AppData", "Local")
      && env.TEMP === path.join(isolatedHome, "mcp-temp")
      && env.ANDROID_COMMON_DOC === projectRoot
      && env.PATH === "" && env.USERNAME === "runtime"
      && env.HTTP_PROXY === "" && env.HTTPS_PROXY === ""
      && env.ALL_PROXY === "" && env.NO_PROXY === "*"
      && !("HOME" in env) && !("USERPROFILE" in process.env && env.USERPROFILE === process.env.USERPROFILE)
    );
    process.stdout.write(JSON.stringify({ ok, actualKeys, expectedArch, actualArch: env.PROCESSOR_ARCHITECTURE }));
    if (!ok) process.exit(1);
  ' "$LIB_DIR/runtime-bridge-codex.cjs" "$PROJ" "$PROJ/isolated-mcp-home"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"ok":true'* ]]
}

# ══════════════════════════════════════════════════════════════════════════
# M7 LIFECYCLE -- IMMUTABLE AUTHORITY CUTS AND ADMISSION LINEARIZATION (v4).
# Fase 1 (test-specialist, dispatch arch-testing-20260816T160058Z): RED 2
# (M7-BINDING-V2-ROOT-GENERATION-02) from .planning/wave-portable-runtime-
# messaging-adapters/M7-ATOMIC-REVOCATION-RECONCILIATION.md section 10.3.
# Group A's own remaining item -- deferred until confirming a real fixture
# chain existed for createRootSourceBinding rather than hand-rolling an
# action+reservation. Reuses _s16_create_and_retire_real_root_source's own
# proven chain (real lifecycle CLI root-source -> real Agent PreToolUse gate
# reservation -> real SubagentStart binding creation) verbatim through
# binding creation, deliberately never calling SubagentStop -- this file's
# own established "small logic-identical duplication is safer than an
# awkward shared parameter shape" convention (mirrors runtime-role-
# lifecycle.cjs's own findLiveClaudeOneShotBindingsByIdentity precedent) --
# the retiring sibling above is reused by other tests and must not change
# shape.
# ══════════════════════════════════════════════════════════════════════════

_m7_create_real_active_root_source_binding() {
  local session_id="$1" agent_id="$2"
  git -C "$PROJ" checkout -b "feature/m7-red02-active-fixture" -q 2>/dev/null
  NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$TG_CAPABILITY" \
    RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY="s16-role-gate-retained-plane" node -e '
    const fs = require("fs");
    const path = require("path");
    const { spawnSync } = require("child_process");
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const lifecycleCli = process.argv[1];
    const agentGate = process.argv[4];
    const subagentHook = process.argv[5];
    const sessionId = process.argv[6];
    const agentId = process.argv[7];
    const retainedFixture = require(process.argv[8]);
    const intent = {
      source_role: "toolkit-specialist",
      reporting_architect: "arch-platform",
      question: "Inspect the bounded M7 RED-02 active-binding fixture and return the implementation review.",
      expected_result_kind: "IMPLEMENTATION_REVIEW",
    };
    const encoded = Buffer.from(rc.canonicalJSONStringify(intent), "utf8").toString("base64url");
    const plan = rll.discoverPlan(projectRoot);
    if (!plan.ok) { process.stderr.write("M7 RED-02 PLAN missing"); process.exit(1); }
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: sessionId };
    const generation = rll.resolveSessionGeneration(projectRoot, identity);
    const main = rll.createMainOrchestratorBinding(projectRoot, identity, rll.computeWorktreeId(projectRoot), plan.planDigest, 3600);
    if (!generation.ok || !main.ok) { process.stderr.write("M7 RED-02 main authority setup failed"); process.exit(1); }
    retainedFixture.establishRetainedCodexSupportPlane(projectRoot, main.binding);
    const lifecycleGrant = rll.mintLifecycleCommandGrant(
      projectRoot, main.binding, rc.sha256String("root-source:" + encoded),
      "toolkit-specialist", "root-source", "main-orchestrator", "orchestrator", "normal", null,
    );
    if (!lifecycleGrant.ok) {
      process.stderr.write("M7 RED-02 missing root-source lifecycle admission: " + JSON.stringify(lifecycleGrant));
      process.exit(1);
    }
    const cli = spawnSync(process.execPath, [
      lifecycleCli, "root-source", "--project-root", projectRoot, "--intent", encoded,
      "--lifecycle-binding", lifecycleGrant.grantId,
    ], { encoding: "utf8", env: process.env });
    let envelope;
    try { envelope = JSON.parse(cli.stdout); } catch { envelope = null; }
    if (cli.status !== 0 || !envelope || envelope.status !== "ACTION_REQUIRED"
      || !envelope.operation || envelope.operation.kind !== "root-source"
      || !Array.isArray(envelope.actions) || envelope.actions.length !== 1) {
      process.stderr.write("M7 RED-02 real root-source CLI failed: " + JSON.stringify({ status: cli.status, stdout: cli.stdout, stderr: cli.stderr }));
      process.exit(1);
    }
    const action = envelope.actions[0];
    const p = action.payload;
    const commonEnv = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: projectRoot, CLAUDE_WAVE_SLUG: "" });
    const gate = spawnSync(process.execPath, [agentGate], {
      input: JSON.stringify({
        tool_name: "Agent",
        tool_input: { subagent_type: p.agent_type, name: p.name, prompt: p.bootstrap_message },
        tool_use_id: "m7-red02-tool-use-01", session_id: sessionId, agent_type: "", agent_id: "",
      }), encoding: "utf8", env: commonEnv,
    });
    let gateBody;
    try { gateBody = JSON.parse(gate.stdout); } catch { gateBody = null; }
    if (gate.status !== 0 || !gateBody || !gateBody.hookSpecificOutput || gateBody.hookSpecificOutput.permissionDecision !== "allow") {
      process.stderr.write("M7 RED-02 Agent gate reservation failed: " + JSON.stringify({ status: gate.status, stdout: gate.stdout, stderr: gate.stderr }));
      process.exit(1);
    }
    const start = spawnSync(process.execPath, [subagentHook], {
      input: JSON.stringify({ hook_event_name: "SubagentStart", agent_type: "toolkit-specialist", session_id: sessionId, agent_id: agentId }),
      encoding: "utf8", env: commonEnv,
    });
    if (start.status !== 0) { process.stderr.write("M7 RED-02 SubagentStart failed: " + JSON.stringify(start)); process.exit(1); }
    const bindingsDir = path.join(rll.registryRepoDir(projectRoot), "root-source-bindings");
    let entries = [];
    try { entries = fs.readdirSync(bindingsDir, { withFileTypes: true }); } catch (err) {
      process.stderr.write("M7 RED-02 genuine binding directory absent: " + err.code + "; SubagentStart=" + JSON.stringify({ status: start.status, stdout: start.stdout, stderr: start.stderr })); process.exit(1);
    }
    const bindings = entries.filter((e) => e.isFile() && /^[a-f0-9]{32}\.json$/.test(e.name))
      .map((e) => JSON.parse(fs.readFileSync(path.join(bindingsDir, e.name), "utf8")))
      .filter((b) => b.action_id === action.action_id && b.runtime_session_key === sessionId && b.agent_id === agentId);
    if (bindings.length !== 1) { process.stderr.write("M7 RED-02 expected one genuine binding, got " + bindings.length); process.exit(1); }
    const binding = bindings[0];
    process.stdout.write(binding.binding_id);
  ' "$RLL_IMPL" "$CONSULTATION_CLI" "$PROJ" "$AGENT_SPAWN_GATE_HOOK" "$SUBAGENT_START_HOOK" "$session_id" "$agent_id" "$S16_RETAINED_FIXTURE"
}

@test "M7-BINDING-V2-ROOT-GENERATION-02 RED: createRootSourceBinding must persist schema runtime/root-source-binding/v2 with a session_generation_id field -- today it persists v1 with no such field" {
  local session_id="m7-red02-session" agent_id="m7-red02-agent"
  run _m7_create_real_active_root_source_binding "$session_id" "$agent_id"
  [ "$status" -eq 0 ]
  local binding_id="$output"
  [ -n "$binding_id" ]

  run node -e '
    const fs = require("fs");
    const path = require("path");
    const rll = require(process.argv[1]);
    const rec = JSON.parse(fs.readFileSync(path.join(rll.registryRepoDir(process.argv[2]), "root-source-bindings", process.argv[3] + ".json"), "utf8"));
    process.stdout.write(JSON.stringify(rec));
  ' "$RLL_IMPL" "$PROJ" "$binding_id"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"schema":"runtime/root-source-binding/v2"'* ]]
  [[ "$output" == *'"session_generation_id":"'* ]]
}

# M7 FINAL CORRECTION (test-specialist, batch 1 of 3): R3
# (M7-ROOT-CREATE-RACE-CROSS-FAMILY-AMBIGUOUS). Same defect family as R2
# (M7-REQUESTER-CREATE-RACE-CROSS-FAMILY-AMBIGUOUS in
# runtime-role-lifecycle-registry.test.js) applied to createRootSourceBinding:
# its own post-write predicate re-check (confirmed by direct read, ~L2296-
# 2298) is fence-only (readClaudeAuthorityFence+.absent), never
# classifyClaudeAuthorityForIdentity -- a same-identity FOREIGN-FAMILY
# (one-shot) binding landing during the admission-to-write window is
# invisible to it. Calls createRootSourceBinding DIRECTLY (never through the
# SubagentStart hook, which always exits 0 fail-open regardless of the
# underlying result -- confirmed by direct read of
# subagent-start-context-bundle.js ~L697-700: a tryConsumeRootSourceReservation
# failure is reported to stderr only, exit code stays 0), reusing
# _m7_create_real_active_root_source_binding's own proven setup (root-source
# CLI -> Agent gate reservation) through the point of a genuine `action`,
# then consuming the reservation directly via
# rll.validateAndConsumeRootSourceReservation (the SAME call
# tryConsumeRootSourceReservation itself makes) to obtain the real
# {reservation, action} pair createRootSourceBinding needs -- mirrors R2's
# own direct-call structure exactly, adapted only for root-source's
# multi-step reservation chain. The cut-first sibling below is a CONTROL
# (already correctly denied today), included only to isolate the
# race-specific defect, exactly like R2's own cut-first sibling.

@test "M7-ROOT-CREATE-RACE-CROSS-FAMILY-AMBIGUOUS RED (cut-first): a fully durable ONE-SHOT binding for the SAME identity landed BEFORE createRootSourceBinding is even attempted must deny the mint outright via the pre-admission classify+expected-ABSENT check -- this ordering is already correctly denied today; included as an isolating control for the admission-first race sibling below" {
  local session_id="m7-red-rootxfam-cutfirst-session" agent_id="m7-red-rootxfam-cutfirst-agent"
  run env NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$TG_CAPABILITY" \
    RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY="s16-role-gate-retained-plane" node -e '
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const { spawnSync } = require("child_process");
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const lifecycleCli = process.argv[1];
    const agentGate = process.argv[4];
    const sessionId = process.argv[5];
    const agentId = process.argv[6];
    const retainedFixture = require(process.argv[7]);

    const intent = {
      source_role: "toolkit-specialist", reporting_architect: "arch-platform",
      question: "Inspect the bounded M7 RED root-source cut-first cross-family fixture and return the implementation review.",
      expected_result_kind: "IMPLEMENTATION_REVIEW",
    };
    const encoded = Buffer.from(rc.canonicalJSONStringify(intent), "utf8").toString("base64url");
    const plan = rll.discoverPlan(projectRoot);
    if (!plan.ok) { process.stderr.write("M7 ROOT-CUTFIRST PLAN missing"); process.exit(1); }
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: sessionId };
    const generation = rll.resolveSessionGeneration(projectRoot, identity);
    const main = rll.createMainOrchestratorBinding(projectRoot, identity, rll.computeWorktreeId(projectRoot), plan.planDigest, 3600);
    if (!generation.ok || !main.ok) { process.stderr.write("M7 ROOT-CUTFIRST main authority setup failed"); process.exit(1); }
    retainedFixture.establishRetainedCodexSupportPlane(projectRoot, main.binding);
    const lifecycleGrant = rll.mintLifecycleCommandGrant(
      projectRoot, main.binding, rc.sha256String("root-source:" + encoded),
      "toolkit-specialist", "root-source", "main-orchestrator", "orchestrator", "normal", null,
    );
    if (!lifecycleGrant.ok) { process.stderr.write("M7 ROOT-CUTFIRST missing root-source lifecycle admission: " + JSON.stringify(lifecycleGrant)); process.exit(1); }
    const cli = spawnSync(process.execPath, [
      lifecycleCli, "root-source", "--project-root", projectRoot, "--intent", encoded,
      "--lifecycle-binding", lifecycleGrant.grantId,
    ], { encoding: "utf8", env: process.env });
    let envelope;
    try { envelope = JSON.parse(cli.stdout); } catch { envelope = null; }
    if (cli.status !== 0 || !envelope || envelope.status !== "ACTION_REQUIRED"
      || !envelope.operation || envelope.operation.kind !== "root-source"
      || !Array.isArray(envelope.actions) || envelope.actions.length !== 1) {
      process.stderr.write("M7 ROOT-CUTFIRST real root-source CLI failed: " + JSON.stringify({ status: cli.status, stdout: cli.stdout, stderr: cli.stderr }));
      process.exit(1);
    }
    const action = envelope.actions[0];
    const p = action.payload;
    const commonEnv = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: projectRoot, CLAUDE_WAVE_SLUG: "" });
    const gate = spawnSync(process.execPath, [agentGate], {
      input: JSON.stringify({
        tool_name: "Agent",
        tool_input: { subagent_type: p.agent_type, name: p.name, prompt: p.bootstrap_message },
        tool_use_id: "m7-root-cutfirst-tool-use-01", session_id: sessionId, agent_type: "", agent_id: "",
      }), encoding: "utf8", env: commonEnv,
    });
    let gateBody;
    try { gateBody = JSON.parse(gate.stdout); } catch { gateBody = null; }
    if (gate.status !== 0 || !gateBody || !gateBody.hookSpecificOutput || gateBody.hookSpecificOutput.permissionDecision !== "allow") {
      process.stderr.write("M7 ROOT-CUTFIRST Agent gate reservation failed: " + JSON.stringify({ status: gate.status, stdout: gate.stdout, stderr: gate.stderr }));
      process.exit(1);
    }

    const oneShotGen = rll.resolveSessionGeneration(projectRoot, { provider: "claude-hook", runtime_session_key: sessionId });
    if (!oneShotGen.ok) { process.stderr.write("M7 ROOT-CUTFIRST one-shot generation resolve failed: " + JSON.stringify(oneShotGen)); process.exit(1); }
    const oneShot = rll.createClaudeOneShotBinding(
      projectRoot, sessionId, oneShotGen.generationId, agentId, "toolkit-specialist",
      rll.generateActionId(), crypto.randomBytes(32).toString("hex"), crypto.randomBytes(32).toString("hex"),
      0, "toolkit-specialist", rll.computeWorktreeId(projectRoot), plan.planDigest, 600,
    );
    if (!oneShot.ok) { process.stderr.write("M7 ROOT-CUTFIRST competing one-shot bind failed: " + JSON.stringify(oneShot)); process.exit(1); }

    const lookup = rll.findLiveRootSourceReservationsForRole(projectRoot, "toolkit-specialist");
    if (!lookup.ok || lookup.reservations.length !== 1) { process.stderr.write("M7 ROOT-CUTFIRST reservation lookup failed: " + JSON.stringify(lookup)); process.exit(1); }
    const consumed = rll.validateAndConsumeRootSourceReservation(projectRoot, action.action_id, { runtimeSessionKey: sessionId, agentType: "toolkit-specialist" });
    if (!consumed.ok) { process.stderr.write("M7 ROOT-CUTFIRST reservation consume failed: " + JSON.stringify(consumed)); process.exit(1); }

    const denied = rll.createRootSourceBinding(projectRoot, consumed.reservation, consumed.action, { agentId, agentType: "toolkit-specialist" });
    const rootBindingsDir = path.join(rll.registryRepoDir(projectRoot), "root-source-bindings");
    let rootFiles = [];
    try { rootFiles = fs.readdirSync(rootBindingsDir); } catch (e) { /* absent is the expected zero-write outcome */ }
    process.stdout.write(JSON.stringify({ ok: denied.ok, reason: denied.reason || null, rootFileCount: rootFiles.length }));
  ' "$RLL_IMPL" "$CONSULTATION_CLI" "$PROJ" "$AGENT_SPAWN_GATE_HOOK" "$session_id" "$agent_id" "$S16_RETAINED_FIXTURE"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"ok":false'* ]]
  [[ "$output" == *'"reason":"authority-binding-conflict"'* ]]
  [[ "$output" == *'"rootFileCount":0'* ]]
}

@test "M7-ROOT-CREATE-RACE-CROSS-FAMILY-AMBIGUOUS RED (admission-first race): a same-identity ONE-SHOT binding landing DURING the window between createRootSourceBinding's own admission and its durable write must still deny the root-source mint via a post-write predicate re-check using the FULL cross-family classifier -- today createRootSourceBinding's post-write recheck is fence-only, never classifyClaudeAuthorityForIdentity, so a cross-family ambiguity landing in that window is invisible to it and the root-source mint wrongly reports success" {
  local session_id="m7-red-rootxfam-race-session" agent_id="m7-red-rootxfam-race-agent"
  run env NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$TG_CAPABILITY" \
    RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY="s16-role-gate-retained-plane" node -e '
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const crypto = require("crypto");
    const { spawn, spawnSync } = require("child_process");
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const lifecycleCli = process.argv[1];
    const agentGate = process.argv[4];
    const sessionId = process.argv[5];
    const agentId = process.argv[6];
    const retainedFixture = require(process.argv[7]);
    // Created via THIS process own os.tmpdir(), never a bash-side mktemp --
    // bats overrides TMPDIR to a per-test isolated subtree, and a dir minted
    // outside that exact subtree fails resolveSafeM7RendezvousDirs own
    // realpath-prefix check silently (testM7Rendezvous then no-ops with
    // zero I/O, per its own documented fail-closed-skip contract), mirroring
    // m7MakeRendezvousDir in runtime-role-lifecycle-registry.test.js exactly.
    const rendezvousDir = fs.mkdtempSync(path.join(os.tmpdir(), "m7-root-race-"));

    (async () => {
      const intent = {
        source_role: "toolkit-specialist", reporting_architect: "arch-platform",
        question: "Inspect the bounded M7 RED root-source admission-first cross-family race fixture and return the implementation review.",
        expected_result_kind: "IMPLEMENTATION_REVIEW",
      };
      const encoded = Buffer.from(rc.canonicalJSONStringify(intent), "utf8").toString("base64url");
      const plan = rll.discoverPlan(projectRoot);
      if (!plan.ok) { process.stderr.write("M7 ROOT-RACE PLAN missing"); process.exit(1); }
      const identity = { ok: true, provider: "claude-hook", runtime_session_key: sessionId };
      const generation = rll.resolveSessionGeneration(projectRoot, identity);
      const main = rll.createMainOrchestratorBinding(projectRoot, identity, rll.computeWorktreeId(projectRoot), plan.planDigest, 3600);
      if (!generation.ok || !main.ok) { process.stderr.write("M7 ROOT-RACE main authority setup failed"); process.exit(1); }
      retainedFixture.establishRetainedCodexSupportPlane(projectRoot, main.binding);
      const lifecycleGrant = rll.mintLifecycleCommandGrant(
        projectRoot, main.binding, rc.sha256String("root-source:" + encoded),
        "toolkit-specialist", "root-source", "main-orchestrator", "orchestrator", "normal", null,
      );
      if (!lifecycleGrant.ok) { process.stderr.write("M7 ROOT-RACE missing root-source lifecycle admission: " + JSON.stringify(lifecycleGrant)); process.exit(1); }
      const cli = spawnSync(process.execPath, [
        lifecycleCli, "root-source", "--project-root", projectRoot, "--intent", encoded,
        "--lifecycle-binding", lifecycleGrant.grantId,
      ], { encoding: "utf8", env: process.env });
      let envelope;
      try { envelope = JSON.parse(cli.stdout); } catch { envelope = null; }
      if (cli.status !== 0 || !envelope || envelope.status !== "ACTION_REQUIRED"
        || !envelope.operation || envelope.operation.kind !== "root-source"
        || !Array.isArray(envelope.actions) || envelope.actions.length !== 1) {
        process.stderr.write("M7 ROOT-RACE real root-source CLI failed: " + JSON.stringify({ status: cli.status, stdout: cli.stdout, stderr: cli.stderr }));
        process.exit(1);
      }
      const action = envelope.actions[0];
      const p = action.payload;
      const commonEnv = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: projectRoot, CLAUDE_WAVE_SLUG: "" });
      const gate = spawnSync(process.execPath, [agentGate], {
        input: JSON.stringify({
          tool_name: "Agent",
          tool_input: { subagent_type: p.agent_type, name: p.name, prompt: p.bootstrap_message },
          tool_use_id: "m7-root-race-tool-use-01", session_id: sessionId, agent_type: "", agent_id: "",
        }), encoding: "utf8", env: commonEnv,
      });
      let gateBody;
      try { gateBody = JSON.parse(gate.stdout); } catch { gateBody = null; }
      if (gate.status !== 0 || !gateBody || !gateBody.hookSpecificOutput || gateBody.hookSpecificOutput.permissionDecision !== "allow") {
        process.stderr.write("M7 ROOT-RACE Agent gate reservation failed: " + JSON.stringify({ status: gate.status, stdout: gate.stdout, stderr: gate.stderr }));
        process.exit(1);
      }

      const lookup = rll.findLiveRootSourceReservationsForRole(projectRoot, "toolkit-specialist");
      if (!lookup.ok || lookup.reservations.length !== 1) { process.stderr.write("M7 ROOT-RACE reservation lookup failed: " + JSON.stringify(lookup)); process.exit(1); }
      const consumed = rll.validateAndConsumeRootSourceReservation(projectRoot, action.action_id, { runtimeSessionKey: sessionId, agentType: "toolkit-specialist" });
      if (!consumed.ok) { process.stderr.write("M7 ROOT-RACE reservation consume failed: " + JSON.stringify(consumed)); process.exit(1); }

      const stage = "create-after-admission-before-write";
      const readyPath = path.join(rendezvousDir, stage + ".ready");
      const goPath = path.join(rendezvousDir, stage + ".go");
      const childSource = [
        "const rll=require(process.argv[1]);",
        "const reservation=JSON.parse(process.argv[3]);",
        "const action=JSON.parse(process.argv[4]);",
        "const out=rll.createRootSourceBinding(process.argv[2],reservation,action,{agentId:process.argv[5],agentType:process.argv[6]});",
        "process.stdout.write(JSON.stringify(out));",
      ].join("");
      const childEnv = Object.assign({}, process.env, {
        RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY: process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY,
        NODE_ENV: "test",
        RUNTIME_M7_TEST_STAGE: stage,
        RUNTIME_M7_TEST_RENDEZVOUS_DIR: rendezvousDir,
      });
      // Never forward the parent-process-only fake-executor capability into
      // the raced child -- it exists solely for the establishRetainedCodexSupportPlane
      // call above, and its presence here is the one uncontrolled difference
      // from the already-proven requester-binding race harness
      // (m7DriveRendezvousRace in runtime-role-lifecycle-registry.test.js),
      // whose child never has it set at all.
      delete childEnv.RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY;
      const child = spawn(process.execPath, [
        "-e", childSource, lifecycleCli, projectRoot,
        JSON.stringify(consumed.reservation), JSON.stringify(consumed.action), agentId, "toolkit-specialist",
      ], {
        stdio: ["ignore", "pipe", "pipe"],
        env: childEnv,
      });
      let childStdout = ""; let childStderr = ""; let childExited = false; let childExitCode = null;
      child.stdout.on("data", (d) => { childStdout += d.toString("utf8"); });
      child.stderr.on("data", (d) => { childStderr += d.toString("utf8"); });
      child.on("close", (code) => { childExited = true; childExitCode = code; });

      const readyStart = Date.now();
      while (!fs.existsSync(readyPath)) {
        if (childExited) {
          process.stderr.write("M7 ROOT-RACE child exited BEFORE reaching ready (never paused): exitCode=" + childExitCode + " stdout=" + childStdout + " stderr=" + childStderr);
          process.exit(1);
        }
        if (Date.now() - readyStart > 5000) {
          child.kill("SIGKILL");
          process.stderr.write("M7 ROOT-RACE timed out waiting for ready: stdout=" + childStdout + " stderr=" + childStderr);
          process.exit(1);
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      const oneShotGen = rll.resolveSessionGeneration(projectRoot, { provider: "claude-hook", runtime_session_key: sessionId });
      if (!oneShotGen.ok) {
        child.kill("SIGKILL");
        process.stderr.write("M7 ROOT-RACE one-shot generation resolve failed: " + JSON.stringify(oneShotGen));
        process.exit(1);
      }
      const oneShot = rll.createClaudeOneShotBinding(
        projectRoot, sessionId, oneShotGen.generationId, agentId, "toolkit-specialist",
        rll.generateActionId(), crypto.randomBytes(32).toString("hex"), crypto.randomBytes(32).toString("hex"),
        0, "toolkit-specialist", rll.computeWorktreeId(projectRoot), plan.planDigest, 600,
      );
      if (!oneShot.ok) {
        child.kill("SIGKILL");
        process.stderr.write("M7 ROOT-RACE competing one-shot bind failed: " + JSON.stringify(oneShot));
        process.exit(1);
      }

      fs.writeFileSync(goPath, Buffer.from("go\n", "utf8"), { mode: 0o600, flag: "wx" });
      const exitCode = await new Promise((resolve) => child.on("close", resolve));

      const rootBindingsDir = path.join(rll.registryRepoDir(projectRoot), "root-source-bindings");
      const oneShotBindingsDir = path.join(rll.registryRepoDir(projectRoot), "claude-one-shot-bindings");
      let rootFiles = []; let oneShotFiles = [];
      try { rootFiles = fs.readdirSync(rootBindingsDir); } catch (e) { /* empty is a genuine failure below */ }
      try { oneShotFiles = fs.readdirSync(oneShotBindingsDir); } catch (e) { /* empty is a genuine failure below */ }

      if (exitCode !== 0) { process.stderr.write("M7 ROOT-RACE child exited nonzero: " + exitCode + " stderr=" + childStderr); process.exit(1); }
      let childOut;
      try { childOut = JSON.parse(childStdout); } catch (e) { process.stderr.write("M7 ROOT-RACE child stdout unparseable: " + childStdout + " stderr=" + childStderr); process.exit(1); }

      fs.rmSync(rendezvousDir, { recursive: true, force: true });
      process.stdout.write(JSON.stringify({
        childOk: childOut.ok, childReason: childOut.reason || null,
        rootFileCount: rootFiles.length, oneShotFileCount: oneShotFiles.length,
      }));
    })().catch((e) => { process.stderr.write("M7 ROOT-RACE threw: " + ((e && e.stack) || e)); process.exit(1); });
  ' "$RLL_IMPL" "$CONSULTATION_CLI" "$PROJ" "$AGENT_SPAWN_GATE_HOOK" "$session_id" "$agent_id" "$S16_RETAINED_FIXTURE"
  [ "$status" -eq 0 ]
  # Fixture/race sanity FIRST, from filesystem counts embedded above --
  # proves BOTH families' writes genuinely landed before the semantic check.
  [[ "$output" == *'"rootFileCount":1'* ]]
  [[ "$output" == *'"oneShotFileCount":1'* ]]
  [[ "$output" == *'"childOk":false'* ]]
  [[ "$output" == *'"childReason":"authority-current-binding-ambiguous"'* ]]
}

# M7 RED 16 (M7-ROOT-TERMINAL-CUT-16). Team-lead-suggested lighter path: reuse
# _m7_create_real_active_root_source_binding for the binding (the ONLY step
# that genuinely needs the real hook/reservation chain), then publishRootIngress
# directly (a plain callable, never hook/CLI-gated -- confirmed by direct
# read), a real `cancel` CLI run through the SAME S16_RETAINED_FIXTURE wrapper
# already proven as a CLI-wrapper elsewhere (its own require.main===module
# self-execution path), and a direct mintRoleCommandGrant call to isolate
# EXACTLY the gap under test (never the full CLI, which could fail downstream
# for an unrelated reason and mask which layer the gap is actually in -- same
# isolation discipline as M7-LEGACY-V1-NONAUTH-04). No ack.json needed:
# M7 section 5's root-source family-proof condition is "neither ack.json NOR
# cancel.json exists" -- cancel alone proves the terminal-cut concept.
@test "M7-ROOT-TERMINAL-CUT-16 RED: mintRoleCommandGrant must deny a further grant against a root-source binding whose transaction is ALREADY, durably cancelled -- today it only checks ingress existence and before/after-ingress subcommand admission, never ack/cancel presence, and mints successfully" {
  local session_id="m7-red16-session" agent_id="m7-red16-agent"
  local binding_id
  binding_id="$(_m7_create_real_active_root_source_binding "$session_id" "$agent_id")"
  [ -n "$binding_id" ]

  run env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" node -e '
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const { spawnSync } = require("child_process");
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const wrapper = process.argv[4];
    const bindingId = process.argv[5];

    const bindingRead = rll.readRegistryRecord(rll.rootSourceBindingPathFor(projectRoot, bindingId));
    if (!bindingRead.ok || bindingRead.absent) { process.stderr.write("RED-16 binding missing: " + JSON.stringify(bindingRead)); process.exit(1); }
    const binding = bindingRead.obj;

    const plan = rll.discoverPlan(projectRoot);
    if (!plan.ok) { process.stderr.write("RED-16 PLAN missing"); process.exit(1); }
    const planPath = plan.planPath;
    const subjectBundlePath = path.join(projectRoot, ".planning", "coordination-subject-bundle-manifest.json");
    fs.mkdirSync(path.dirname(subjectBundlePath), { recursive: true });
    fs.writeFileSync(subjectBundlePath, JSON.stringify({ schema: "coordination/subject-bundle-manifest/v1", entries: [] }));
    const coordRoot = path.join(projectRoot, ".planning", "coordination");

    // A carrier request -- deliberately unrelated identity/role to the
    // root-source binding itself (publishRootIngress below only needs
    // shape-valid requestId/requestDigest, never that they correlate to a
    // caller-matching identity) -- exists purely so the real `cancel` CLI
    // command below has a genuine request.json to operate on.
    const intent = {
      target_role: "arch-platform",
      question: "M7 RED-16 carrier request for root-source ingress correlation",
      expected_result_kind: "IMPLEMENTATION_REVIEW",
      expiry: new Date(Date.now() + 1800000).toISOString(),
    };
    const intentB64 = Buffer.from(JSON.stringify(intent), "utf8").toString("base64url");
    const published = spawnSync(process.execPath, [
      wrapper, "publish-request", "--coordination-root", coordRoot, "--plan", planPath,
      "--subject-bundle", subjectBundlePath, "--intent", intentB64,
    ], { encoding: "utf8", env: process.env });
    let publishedEnvelope;
    try { publishedEnvelope = JSON.parse(published.stdout); } catch { publishedEnvelope = null; }
    if (published.status !== 0 || !publishedEnvelope || publishedEnvelope.status !== "SUCCESS") {
      process.stderr.write("RED-16 carrier publish-request failed: " + JSON.stringify({ status: published.status, stdout: published.stdout, stderr: published.stderr }));
      process.exit(1);
    }
    const requestId = publishedEnvelope.request_id;
    const requestPath = publishedEnvelope.artifact_ref;
    const requestDigest = crypto.createHash("sha256").update(fs.readFileSync(requestPath)).digest("hex");

    const ingress = rll.publishRootIngress(projectRoot, binding, { requestId, requestDigest });
    if (!ingress.ok) { process.stderr.write("RED-16 publishRootIngress failed: " + JSON.stringify(ingress)); process.exit(1); }

    const cancelled = spawnSync(process.execPath, [
      wrapper, "cancel", "--coordination-root", coordRoot, "--request", requestPath, "--reason", "explicit",
    ], { encoding: "utf8", env: process.env });
    let cancelledEnvelope;
    try { cancelledEnvelope = JSON.parse(cancelled.stdout); } catch { cancelledEnvelope = null; }
    if (cancelled.status !== 0 || !cancelledEnvelope || cancelledEnvelope.status !== "SUCCESS") {
      process.stderr.write("RED-16 carrier cancel failed: " + JSON.stringify({ status: cancelled.status, stdout: cancelled.stdout, stderr: cancelled.stderr }));
      process.exit(1);
    }

    // THE RED: mintRoleCommandGrant (requester authority, root-source binding)
    // must deny minting against an ALREADY-cancelled transaction -- today it
    // only checks ingress existence + before/after-ingress subcommand
    // membership + requestId correlation, never ack.json/cancel.json presence.
    const argvDigest = rc.sha256String(rc.canonicalJSONStringify(["--coordination-root", coordRoot, "--request", requestPath]));
    const grant = rll.mintRoleCommandGrant(projectRoot, binding, "requester", "cleanup", argvDigest, requestId, null, null);
    process.stdout.write(JSON.stringify({ ok: grant.ok, reason: grant.reason || null }));
  ' "$RLL_IMPL" "$CONSULTATION_CLI" "$PROJ" "$S16_RETAINED_FIXTURE" "$binding_id"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"ok":false'* ]]
}

# M7 checklist item 10 (2026-08-17 correction pass), root-source half: RED-16
# above proves mintRoleCommandGrant denies once cancel.json genuinely exists.
# This proves the DIFFERENT axis on the SAME lines (runtime-role-lifecycle.cjs,
# the root-source branch inside mintRoleCommandGrant): `let terminalExists =
# false; try { terminalExists = fs.existsSync(api.ackPathFor(txnDir)) ||
# fs.existsSync(api.cancelPathFor(txnDir)); } catch (err) { terminalExists =
# false; }` swallows ANY genuine read error into the SAME outcome as genuine
# absence. Node fs.existsSync itself never throws (it internally swallows
# every stat error and returns false), so the bug is structural, not merely a
# bad catch block -- the try/catch cannot even be reached by an existsSync
# error; the defect is using existsSync at all for a check that must
# distinguish ENOENT from every other failure mode. Forces a genuine ENOTDIR
# (never ENOENT) by replacing txnDir itself with a plain file, mirroring
# claude-one-shot-binding-red.bats own COSB-SUBAGENTSTOP-ONESHOT-LOOKUP-ERROR-BLOCKS
# technique exactly (rename the real directory aside, plant a plain file at
# its path).
@test "M7-ROOT-TERMINAL-READ-ERROR-10 RED: mintRoleCommandGrant must fail closed when a genuine filesystem read error (ENOTDIR, never ENOENT) prevents verifying whether ack.json/cancel.json exist for a root-source binding own transaction directory -- today the error is silently swallowed into terminalExists=false (treated as absent) and the mint wrongly succeeds exactly as if no terminal existed at all" {
  local session_id="m7-red10-root-session" agent_id="m7-red10-root-agent"
  local binding_id
  binding_id="$(_m7_create_real_active_root_source_binding "$session_id" "$agent_id")"
  [ -n "$binding_id" ]

  run env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" node -e '
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const { spawnSync } = require("child_process");
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const wrapper = process.argv[4];
    const bindingId = process.argv[5];

    const bindingRead = rll.readRegistryRecord(rll.rootSourceBindingPathFor(projectRoot, bindingId));
    if (!bindingRead.ok || bindingRead.absent) { process.stderr.write("RED-10-ROOT binding missing: " + JSON.stringify(bindingRead)); process.exit(1); }
    const binding = bindingRead.obj;

    const plan = rll.discoverPlan(projectRoot);
    if (!plan.ok) { process.stderr.write("RED-10-ROOT PLAN missing"); process.exit(1); }
    const planPath = plan.planPath;
    const subjectBundlePath = path.join(projectRoot, ".planning", "coordination-subject-bundle-manifest.json");
    fs.mkdirSync(path.dirname(subjectBundlePath), { recursive: true });
    fs.writeFileSync(subjectBundlePath, JSON.stringify({ schema: "coordination/subject-bundle-manifest/v1", entries: [] }));
    const coordRoot = path.join(projectRoot, ".planning", "coordination");

    const intent = {
      target_role: "arch-platform",
      question: "M7 RED-10-ROOT carrier request for root-source ingress correlation",
      expected_result_kind: "IMPLEMENTATION_REVIEW",
      expiry: new Date(Date.now() + 1800000).toISOString(),
    };
    const intentB64 = Buffer.from(JSON.stringify(intent), "utf8").toString("base64url");
    const published = spawnSync(process.execPath, [
      wrapper, "publish-request", "--coordination-root", coordRoot, "--plan", planPath,
      "--subject-bundle", subjectBundlePath, "--intent", intentB64,
    ], { encoding: "utf8", env: process.env });
    let publishedEnvelope;
    try { publishedEnvelope = JSON.parse(published.stdout); } catch { publishedEnvelope = null; }
    if (published.status !== 0 || !publishedEnvelope || publishedEnvelope.status !== "SUCCESS") {
      process.stderr.write("RED-10-ROOT carrier publish-request failed: " + JSON.stringify({ status: published.status, stdout: published.stdout, stderr: published.stderr }));
      process.exit(1);
    }
    const requestId = publishedEnvelope.request_id;
    const requestPath = publishedEnvelope.artifact_ref;
    const requestDigest = crypto.createHash("sha256").update(fs.readFileSync(requestPath)).digest("hex");

    const ingress = rll.publishRootIngress(projectRoot, binding, { requestId, requestDigest });
    if (!ingress.ok) { process.stderr.write("RED-10-ROOT publishRootIngress failed: " + JSON.stringify(ingress)); process.exit(1); }

    // Positive control FIRST: real, accessible txnDir, genuinely no ack/cancel
    // yet -- mint must succeed cleanly, proving the fixture itself is valid
    // and the denial below is attributable to the injected read-error fault,
    // never a generally-broken setup.
    const argvDigest = rc.sha256String(rc.canonicalJSONStringify(["--coordination-root", coordRoot, "--request", requestPath]));
    const before = rll.mintRoleCommandGrant(projectRoot, binding, "requester", "cleanup", argvDigest, requestId, null, null);
    if (!before.ok) { process.stderr.write("RED-10-ROOT fixture sanity: an ordinary mint against a genuinely absent terminal must succeed: " + JSON.stringify(before)); process.exit(1); }

    // Fault injection: txnDir (which genuinely holds request.json on disk,
    // confirmed by the publish-request call above) is replaced with a plain
    // file -- forces ENOTDIR when mintRoleCommandGrant later
    // fs.existsSync-probes <txnDir>/ack.json and <txnDir>/cancel.json.
    const repoId = rll.computeRepoId(projectRoot);
    const waveSlug = path.basename(path.dirname(planPath)).replace(/^wave-/, "");
    const txnDir = path.join(coordRoot, repoId, waveSlug, binding.plan_digest, "transactions", requestId);
    if (!fs.statSync(txnDir).isDirectory()) { process.stderr.write("RED-10-ROOT fixture sanity: txnDir must genuinely be a real directory before the fault"); process.exit(1); }
    const realTxnDir = txnDir + "-real";
    fs.renameSync(txnDir, realTxnDir);
    fs.writeFileSync(txnDir, "not a directory");

    let after;
    try {
      after = rll.mintRoleCommandGrant(projectRoot, binding, "requester", "cleanup", argvDigest, requestId, null, null);
    } finally {
      fs.unlinkSync(txnDir);
      fs.renameSync(realTxnDir, txnDir);
    }
    process.stdout.write(JSON.stringify({ beforeOk: before.ok, afterOk: after.ok, afterReason: after.reason || null }));
  ' "$RLL_IMPL" "$CONSULTATION_CLI" "$PROJ" "$S16_RETAINED_FIXTURE" "$binding_id"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"beforeOk":true'* ]]
  [[ "$output" == *'"afterOk":false'* ]]
}

# M7 RED 20 (M7-ROOT-STATUS-V2). Resolved with team-lead across two passes --
# first hypothesis (a blocked-vs-accepted ack disposition mismatch) was ruled
# out by a full read of readRootSourceTerminalArtifacts (consultation.cjs
# ~7846): it DOES check ack disposition and throws CORRELATION_INVALID on a
# mismatch, which handleRootSourceStatus's own try/catch correctly folds into
# BLOCKED/DURABILITY_UNPROVEN -- that path is already correct today, so a
# fixture built on it would be vacuous. The REAL gap, found by a full read of
# handleRootSourceStatus's entire body (RLL ~7941-8014): its whole ready/
# READY-computation block only runs `if (!retirement.absent)` -- if NO
# retirement marker exists at all, execution falls through unconditionally to
# WAITING at the very end, regardless of whether a fully genuine, accepted,
# durable transaction (ack.json+accepted-result.json, both correlated)
# already exists. A retirement marker is written ONLY as a side-effect of
# transaction-ack/cancel being authorized via a ROOT-SOURCE-SCHEMA-SCOPED
# grant specifically (consultation.cjs ~8263-8287, gated on grantContext.
# bindingSchema === ROOT_SOURCE_BINDING_SCHEMA_LOCAL) -- the plain retained-
# support-plane grant this file's own S16_RETAINED_FIXTURE wrapper injects
# for every other command in this file is never root-source-scoped, so this
# fixture's own genuine, successful transaction chain (run entirely through
# that SAME plain wrapper, exactly like every non-root-source test already
# in this file) never triggers retirement -- proving the fixture is a
# faithful, non-contrived reproduction of the real gap, never a forced edge
# case. The positive control writes the SAME retirement marker shape the real
# dispatcher would have written (consultation.cjs's own exact call site),
# directly, to isolate EXACTLY this one gap -- same discipline as RED 4/16/17.
@test "M7-ROOT-STATUS-V2-20 RED: root-source-status must derive READY from the genuinely durable ack+accepted-result artifacts directly, not depend on a retirement marker that only exists as a side-effect of a root-source-scoped grant -- today a fully complete, accepted transaction authorized through a plain (non-root-source-scoped) grant leaves status stuck at WAITING forever" {
  local session_id="m7-red20-session" agent_id="m7-red20-agent"
  local binding_id
  binding_id="$(_m7_create_real_active_root_source_binding "$session_id" "$agent_id")"
  [ -n "$binding_id" ]

  run env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$TG_CAPABILITY" node -e '
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const { spawnSync } = require("child_process");
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const wrapper = process.argv[4];
    const bindingId = process.argv[5];
    const sessionId = process.argv[6];

    const bindingRead = rll.readRegistryRecord(rll.rootSourceBindingPathFor(projectRoot, bindingId));
    if (!bindingRead.ok || bindingRead.absent) { process.stderr.write("RED-20 binding missing: " + JSON.stringify(bindingRead)); process.exit(1); }
    const binding = bindingRead.obj;
    const actionId = binding.action_id;

    const plan = rll.discoverPlan(projectRoot);
    if (!plan.ok) { process.stderr.write("RED-20 PLAN missing"); process.exit(1); }
    // getOrCreateMainOrchestratorBindingForSession (unlike raw createMainOrchestratorBinding)
    // is this file/RLL own proven-idempotent re-derivation for the SAME live
    // session/worktree/PLAN -- safely re-resolves the SAME main binding the
    // shared fixture helper already minted, in this SEPARATE process, without
    // risking a second, conflicting MainOrchestratorBinding. Takes a raw
    // sessionId string directly (confirmed by direct read of its own test),
    // never an identity object.
    const mainBinding = rll.getOrCreateMainOrchestratorBindingForSession(projectRoot, sessionId, rll.computeWorktreeId(projectRoot), plan.planDigest, 3600);
    if (!mainBinding.ok) { process.stderr.write("RED-20 main binding re-derivation failed: " + JSON.stringify(mainBinding)); process.exit(1); }

    const planPath = plan.planPath;
    const subjectBundlePath = path.join(projectRoot, ".planning", "coordination-subject-bundle-manifest.json");
    fs.mkdirSync(path.dirname(subjectBundlePath), { recursive: true });
    fs.writeFileSync(subjectBundlePath, JSON.stringify({ schema: "coordination/subject-bundle-manifest/v1", entries: [] }));
    const coordRoot = path.join(projectRoot, ".planning", "coordination");

    // PIVOTED (team-lead, second correction): the claude-agent driver on the
    // dispatch command is UNCONDITIONALLY unavailable today by explicit,
    // documented design (dispatchCanonical ~10608-10627, an honest not-yet-
    // provable gap) -- NOT environment/settings.json-dependent as first
    // suspected. The CLI chain (root-init/publish-request/dispatch/claim/
    // publish-result/accept-result/transaction-ack) always falls through to
    // the frozen noop driver or fails for reasons entirely orthogonal to
    // what RED 20 targets. Per team-lead direction: construct the whole
    // transaction DIRECTLY instead (an established writeRawRequest-style
    // technique already used in runtime-consultation-cli.test.js, and RED
    // 18 own direct-cancel.json write, both in this same wave) -- request/
    // result/accepted-result/ack, each built to the EXACT closed schema
    // (CONSULT_V2_FIELDS/RESULT_V2_FIELDS/ACCEPTED_RESULT_V1_FIELDS/
    // ACK_V1_FIELDS, all confirmed by direct read of consultation.cjs
    // ~3260-4087) with every correlation field genuinely, mutually correct
    // -- never through the CLI at all, so the dispatch gap is fully
    // sidestepped. No claim.json is needed: validateResultV2 never opens or
    // cross-checks one against disk, only shape-checking claimant_instance_id/
    // claim_digest on the result record itself (confirmed by direct read).
    function writeDirectRecord(p, obj) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(obj), { mode: 0o600 });
      fs.chmodSync(p, 0o600);
    }

    const repoId = rll.computeRepoId(projectRoot);
    const waveSlug = path.basename(path.dirname(planPath)).replace(/^wave-/, "");
    const planDigest = plan.planDigest;
    const planRoot = path.join(coordRoot, repoId, waveSlug, planDigest);
    const requestId = crypto.randomBytes(32).toString("hex");
    const txnDir = path.join(planRoot, "transactions", requestId);
    const nowIso = new Date().toISOString();
    const expiryIso = new Date(Date.now() + 1800000).toISOString();
    const attemptId = crypto.randomBytes(32).toString("hex");
    // M6/M7 terminal functional closure correction round 1: target_role,
    // question, expected_result_kind, and requester_instance_id must each
    // equal the REAL root-source binding/action this fixture deliberately
    // reuses the publish authority of (per _m7_create_real_active_root_source_binding
    // own intent above: reporting_architect "arch-platform", the exact
    // question/expected_result_kind literals, actor_instance_id) -- point B/C
    // provenance correlation (resolveRootEvidenceAuthority, runtime-
    // consultation.cjs) now cross-validates every root-source-derived root
    // against its action own bootstrap-embedded intent field-by-field, so a
    // manually-built transaction attached to a real binding must genuinely
    // agree on all of them -- confirmed empirically (any mismatch produced
    // CORRELATION_INVALID, BLOCKED never READY).
    const targetRoleProfileDigest = rll.roleProfileDigestFor("arch-platform");
    const routingPolicyDigest = crypto.randomBytes(32).toString("hex");
    const subjectScopeDigest = crypto.randomBytes(32).toString("hex");
    const requesterInstanceId = binding.actor_instance_id;
    const subjectWorktreeId = rll.computeWorktreeId(projectRoot);
    const subjectHead = crypto.randomBytes(20).toString("hex");

    const requestObj = {
      schema: "coordination/consult/v2",
      request_id: requestId,
      root_request_id: requestId,
      parent_request_id: null,
      depth: 0,
      max_depth: 2,
      source_role: "toolkit-specialist",
      target_role: "arch-platform",
      target_role_profile_version: "1.0.0",
      target_role_profile_digest: targetRoleProfileDigest,
      requester_worktree_id: subjectWorktreeId,
      requester_instance_id: requesterInstanceId,
      repo_id: repoId,
      wave_slug: waveSlug,
      protocol_profile: "runtime-consultation/v1",
      coordination_root_id: rll.computeCoordinationRootId(projectRoot),
      plan_digest: planDigest,
      subject_repo_id: repoId,
      subject_worktree_id: subjectWorktreeId,
      subject_head: subjectHead,
      subject_scope_digest: subjectScopeDigest,
      question: "Inspect the bounded M7 RED-02 active-binding fixture and return the implementation review.",
      expected_result_kind: "IMPLEMENTATION_REVIEW",
      expiry: expiryIso,
      recovery_budget: 1,
      routing_policy_version: "runtime-routing/v1",
      routing_policy_digest: routingPolicyDigest,
      initial_attempt_id: attemptId,
      initial_lease_epoch: 0,
      created_at: nowIso,
    };
    const requestPath = path.join(txnDir, "request.json");
    writeDirectRecord(requestPath, requestObj);
    const requestDigest = crypto.createHash("sha256").update(fs.readFileSync(requestPath)).digest("hex");

    const ingress = rll.publishRootIngress(projectRoot, binding, { requestId, requestDigest });
    if (!ingress.ok) { process.stderr.write("RED-20 publishRootIngress failed: " + JSON.stringify(ingress)); process.exit(1); }

    const resultObj = {
      schema: "coordination/result/v2",
      in_reply_to: requestId,
      request_digest: requestDigest,
      plan_digest: planDigest,
      repo_id: repoId,
      wave_slug: waveSlug,
      protocol_profile: "runtime-consultation/v1",
      max_depth: 2,
      routing_policy_version: "runtime-routing/v1",
      routing_policy_digest: routingPolicyDigest,
      root_request_id: requestId,
      parent_request_id: null,
      depth: 0,
      attempt_id: attemptId,
      lease_epoch: 0,
      driver: "test-fixture-driver",
      claimant_instance_id: crypto.randomBytes(32).toString("hex"),
      claim_digest: crypto.randomBytes(32).toString("hex"),
      target_role_profile_version: "1.0.0",
      target_role_profile_digest: targetRoleProfileDigest,
      from_role: "arch-platform",
      to_role: "toolkit-specialist",
      result_kind: "IMPLEMENTATION_REVIEW",
      status: "ANSWERED",
      reason: null,
      content: "M7 RED-20 genuine direct-fixture result content",
      subject_repo_id: repoId,
      subject_worktree_id: subjectWorktreeId,
      subject_head: subjectHead,
      subject_scope_digest: subjectScopeDigest,
      consultation_dependencies: [],
      pattern_evidence_dependency: null,
      producer_worktree_id: subjectWorktreeId,
      producer_head: subjectHead,
      created_at: nowIso,
    };
    const resultPath = path.join(txnDir, "results", attemptId + ".json");
    writeDirectRecord(resultPath, resultObj);
    const resultDigest = crypto.createHash("sha256").update(fs.readFileSync(resultPath)).digest("hex");

    const acceptedObj = {
      schema: "coordination/accepted-result/v1",
      request_digest: requestDigest,
      candidate_result_path: "results/" + attemptId + ".json",
      result_digest: resultDigest,
      accepted_attempt_id: attemptId,
      accepted_lease_epoch: 0,
      routing_policy_digest: routingPolicyDigest,
      requester_instance_id: requesterInstanceId,
      accepted_at: nowIso,
      schema_version: 1,
    };
    const acceptedResultPath = path.join(txnDir, "accepted-result.json");
    writeDirectRecord(acceptedResultPath, acceptedObj);

    const ackObj = {
      schema: "coordination/ack/v1",
      disposition: "accepted",
      in_reply_to_attempt_id: attemptId,
      acked_at: nowIso,
    };
    const ackPath = path.join(txnDir, "ack.json");
    writeDirectRecord(ackPath, ackObj);

    function mintStatusGrantAndCheck() {
      const policyDigest = rc.sha256String("root-source-status:" + actionId);
      const statusGrant = rll.mintLifecycleCommandGrant(
        projectRoot, mainBinding.binding, policyDigest,
        "toolkit-specialist", "root-source-status", "main-orchestrator", "orchestrator", "normal", actionId,
      );
      if (!statusGrant.ok) { process.stderr.write("RED-20 status grant mint failed: " + JSON.stringify(statusGrant)); process.exit(1); }
      const res = spawnSync(process.execPath, [
        process.argv[1], "root-source-status", "--project-root", projectRoot, "--action", actionId, "--lifecycle-binding", statusGrant.grantId,
      ], { encoding: "utf8", env: process.env });
      let envelope;
      try { envelope = JSON.parse(res.stdout); } catch { envelope = null; }
      if (res.status !== 0 || !envelope) { process.stderr.write("RED-20 root-source-status failed: " + JSON.stringify({ status: res.status, stdout: res.stdout, stderr: res.stderr })); process.exit(1); }
      return envelope;
    }

    // Fixture sanity FIRST (part of the RED itself, not a separate check):
    // confirm the underlying transaction really did land as genuinely,
    // durably ACCEPTED before ever asking root-source-status about it.
    if (!fs.existsSync(acceptedResultPath)) { process.stderr.write("RED-20 fixture sanity: accepted-result.json must genuinely exist"); process.exit(1); }
    if (!fs.existsSync(ackPath)) { process.stderr.write("RED-20 fixture sanity: ack.json must genuinely exist"); process.exit(1); }

    // Post-GREEN simplification (team-lead delegated this call, confirmed
    // empirically before applying it): root-source-status now derives READY
    // directly from the durable ack+accepted-result artifacts regardless of
    // retirement-marker presence -- this test ITSELF now passes with zero
    // retirement marker involved, proving the original "positive control"
    // (retirement present -> READY) has become redundant with statusResult
    // below (no marker, real artifacts present -> also READY, for the exact
    // SAME reason). Preserving a call to rll.retireRootSourceBinding purely
    // to keep a now-redundant second assertion would also directly block
    // toolkit-specialist own removal of that function (contract section 11:
    // non-authoritative once nothing production-side depends on it). Kept
    // as a single, direct assertion -- this is effectively now a regression
    // guard (mirrors the guards 24/26/27/28/29 own "(RED)"-labelled-but-now-
    // passing precedent elsewhere in this wave: the label documents original
    // intent, never a live status requiring rename once GREEN lands).
    const statusResult = mintStatusGrantAndCheck();
    process.stdout.write(JSON.stringify({ statusResultStatus: statusResult.status }));
  ' "$RLL_IMPL" "$CONSULTATION_CLI" "$PROJ" "$S16_RETAINED_FIXTURE" "$binding_id" "$session_id"
  [ "$status" -eq 0 ]
  # The M7 contract requires root-source-status to derive READY from the
  # genuinely durable ack+accepted-result artifacts DIRECTLY, with zero
  # retirement-marker involved anywhere in this fixture -- confirmed passing
  # empirically (GREEN has landed for this exact gap).
  [[ "$output" == *'"statusResultStatus":"READY"'* ]]
}

# M7 checklist item 10 (2026-08-17 correction pass), root-source-status half:
# handleRootSourceStatus (runtime-role-lifecycle.cjs) has TWO separate
# fs.existsSync try/catch probes on ack.json and cancel.json inside its
# `if (!ingress.absent)` branch: `try { ackExists = fs.existsSync(...); }
# catch (err) { ackExists = false; }` and the identical shape for
# cancelExists. A genuine read error on either probe is silently swallowed
# into false (treated as genuine absence), so the handler falls all the way
# through to the ordinary WAITING projection at the very end of the function
# -- exactly the "no terminal yet" outcome, even though the true state is
# unverifiable. Node's fs.existsSync itself never throws (it swallows every
# stat error internally and returns false), so this is a structural defect,
# not a bad catch block. Forces a genuine ENOTDIR by replacing the ingress
# request own txnDir with a plain file, same technique as the mint-grant RED
# above.
@test "M7-ROOT-STATUS-READ-ERROR-10 RED: root-source-status must fail closed (BLOCKED/DURABILITY_UNPROVEN) when a genuine filesystem read error (ENOTDIR, never ENOENT) prevents verifying whether ack.json/cancel.json exist for the ingress own transaction directory -- today the error on EITHER probe is silently swallowed into ackExists=false/cancelExists=false and status wrongly falls through to WAITING exactly as if no terminal existed at all" {
  local session_id="m7-red10-status-session" agent_id="m7-red10-status-agent"
  local binding_id
  binding_id="$(_m7_create_real_active_root_source_binding "$session_id" "$agent_id")"
  [ -n "$binding_id" ]

  run env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$TG_CAPABILITY" node -e '
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const { spawnSync } = require("child_process");
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const wrapper = process.argv[4];
    const bindingId = process.argv[5];
    const sessionId = process.argv[6];

    const bindingRead = rll.readRegistryRecord(rll.rootSourceBindingPathFor(projectRoot, bindingId));
    if (!bindingRead.ok || bindingRead.absent) { process.stderr.write("RED-10-STATUS binding missing: " + JSON.stringify(bindingRead)); process.exit(1); }
    const binding = bindingRead.obj;
    const actionId = binding.action_id;

    const plan = rll.discoverPlan(projectRoot);
    if (!plan.ok) { process.stderr.write("RED-10-STATUS PLAN missing"); process.exit(1); }
    const mainBinding = rll.getOrCreateMainOrchestratorBindingForSession(projectRoot, sessionId, rll.computeWorktreeId(projectRoot), plan.planDigest, 3600);
    if (!mainBinding.ok) { process.stderr.write("RED-10-STATUS main binding re-derivation failed: " + JSON.stringify(mainBinding)); process.exit(1); }

    const planPath = plan.planPath;
    const subjectBundlePath = path.join(projectRoot, ".planning", "coordination-subject-bundle-manifest.json");
    fs.mkdirSync(path.dirname(subjectBundlePath), { recursive: true });
    fs.writeFileSync(subjectBundlePath, JSON.stringify({ schema: "coordination/subject-bundle-manifest/v1", entries: [] }));
    const coordRoot = path.join(projectRoot, ".planning", "coordination");

    const intent = {
      target_role: "arch-platform",
      question: "M7 RED-10-STATUS carrier request for root-source ingress correlation",
      expected_result_kind: "IMPLEMENTATION_REVIEW",
      expiry: new Date(Date.now() + 1800000).toISOString(),
    };
    const intentB64 = Buffer.from(JSON.stringify(intent), "utf8").toString("base64url");
    const published = spawnSync(process.execPath, [
      wrapper, "publish-request", "--coordination-root", coordRoot, "--plan", planPath,
      "--subject-bundle", subjectBundlePath, "--intent", intentB64,
    ], { encoding: "utf8", env: process.env });
    let publishedEnvelope;
    try { publishedEnvelope = JSON.parse(published.stdout); } catch { publishedEnvelope = null; }
    if (published.status !== 0 || !publishedEnvelope || publishedEnvelope.status !== "SUCCESS") {
      process.stderr.write("RED-10-STATUS carrier publish-request failed: " + JSON.stringify({ status: published.status, stdout: published.stdout, stderr: published.stderr }));
      process.exit(1);
    }
    const requestId = publishedEnvelope.request_id;
    const requestPath = publishedEnvelope.artifact_ref;
    const requestDigest = crypto.createHash("sha256").update(fs.readFileSync(requestPath)).digest("hex");

    const ingress = rll.publishRootIngress(projectRoot, binding, { requestId, requestDigest });
    if (!ingress.ok) { process.stderr.write("RED-10-STATUS publishRootIngress failed: " + JSON.stringify(ingress)); process.exit(1); }

    function statusOnce() {
      const policyDigest = rc.sha256String("root-source-status:" + actionId);
      const statusGrant = rll.mintLifecycleCommandGrant(
        projectRoot, mainBinding.binding, policyDigest,
        "toolkit-specialist", "root-source-status", "main-orchestrator", "orchestrator", "normal", actionId,
      );
      if (!statusGrant.ok) { process.stderr.write("RED-10-STATUS status grant mint failed: " + JSON.stringify(statusGrant)); process.exit(1); }
      const res = spawnSync(process.execPath, [
        process.argv[1], "root-source-status", "--project-root", projectRoot, "--action", actionId, "--lifecycle-binding", statusGrant.grantId,
      ], { encoding: "utf8", env: process.env });
      let envelope;
      try { envelope = JSON.parse(res.stdout); } catch { envelope = null; }
      if (res.status !== 0 || !envelope) { process.stderr.write("RED-10-STATUS root-source-status failed: " + JSON.stringify({ status: res.status, stdout: res.stdout, stderr: res.stderr })); process.exit(1); }
      return envelope;
    }

    // Positive control FIRST: real, accessible txnDir, genuinely no ack/cancel
    // yet -- status must report the ordinary WAITING projection, proving the
    // fixture itself is valid and the fail-closed denial below is
    // attributable to the injected read-error fault, never a
    // generally-broken setup.
    const before = statusOnce();
    if (before.status !== "WAITING") { process.stderr.write("RED-10-STATUS fixture sanity: expected WAITING before the fault, got: " + JSON.stringify(before)); process.exit(1); }

    // Fault injection: txnDir (which genuinely holds request.json on disk) is
    // replaced with a plain file -- forces ENOTDIR when handleRootSourceStatus
    // later fs.existsSync-probes <txnDir>/ack.json and <txnDir>/cancel.json
    // (two SEPARATE try/catch blocks, both must be shown to fail closed).
    const repoId = rll.computeRepoId(projectRoot);
    const waveSlug = path.basename(path.dirname(planPath)).replace(/^wave-/, "");
    const txnDir = path.join(coordRoot, repoId, waveSlug, binding.plan_digest, "transactions", requestId);
    if (!fs.statSync(txnDir).isDirectory()) { process.stderr.write("RED-10-STATUS fixture sanity: txnDir must genuinely be a real directory before the fault"); process.exit(1); }
    const realTxnDir = txnDir + "-real";
    fs.renameSync(txnDir, realTxnDir);
    fs.writeFileSync(txnDir, "not a directory");

    let after;
    try {
      after = statusOnce();
    } finally {
      fs.unlinkSync(txnDir);
      fs.renameSync(realTxnDir, txnDir);
    }
    process.stdout.write(JSON.stringify({ beforeStatus: before.status, afterStatus: after.status, afterDetailCode: after.detail_code || null }));
  ' "$RLL_IMPL" "$CONSULTATION_CLI" "$PROJ" "$S16_RETAINED_FIXTURE" "$binding_id" "$session_id"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"beforeStatus":"WAITING"'* ]]
  [[ "$output" == *'"afterStatus":"BLOCKED"'* ]]
  [[ "$output" == *'"afterDetailCode":"DURABILITY_UNPROVEN"'* ]]
}

# M7 checklist item 12 (2026-08-17 correction pass): M7 contract section 9
# closing paragraph -- "a read-only root-source-status invocation... does not
# require action.session_generation_id to equal the current generation...
# so an old-generation binding can reach the generation-cut row above and
# project BLOCKED; no create, grant, or mutating command receives this
# exception." Confirmed by direct read of handleRootSourceStatus
# (runtime-role-lifecycle.cjs): its own context-resolution gate unconditionally
# requires `action.session_generation_id === context.generation.generationId`,
# rejecting IDENTITY_MISMATCH BEFORE ever reaching the later
# WAITING/BLOCKED/READY projection logic -- this is the one existing handler
# equality gate section 9 says must be removed only for this read-only
# command. Rotates the SAME orchestrator session own generation between
# action-mint time and the status call, same technique as
# claude-one-shot-binding-red.bats own COSB-E2E-GENERATION-ROTATION-REJECTED-ZERO-BINDING
# (expire the live generation record directly, then resolveSessionGeneration
# mints a genuinely fresh, live G2 in its place).
#
# SCOPE WARNING for whoever implements GREEN, confirmed jointly with
# team-lead (2026-08-17): deleting the L8455-8456 action-level equality gate
# ALONE does not make this test pass. findRootSourceBindingsByAction
# (~L2409-2425) resolves candidate bindings via validateRootSourceBindingRecord
# (~L2282-2298), which is PURELY STRUCTURAL -- schema/key-set/hex-format/
# timestamp-ordering only. It never compares the binding own expiry against
# the current clock and never compares the binding own session_generation_id
# against the current live generation, so it returns ANY structurally-valid
# binding for the action_id regardless of staleness. With only the two-line
# gate removed, execution would fall through past the binding lookup (~L8465,
# the G1 binding is still found) straight into the ordinary
# ingress/WAITING projection -- never reaching a BLOCKED/NONE result at all.
# The correct fix therefore also needs a NEW binding-level generation/expiry
# cut somewhere after the binding lookup, which is what actually makes the
# contract section 9 table row ("structurally valid v2 binding but expiry/
# generation cut -> BLOCKED/NONE, zero writes") hold. This test still asserts
# exactly that CORRECT target outcome -- it is the toolkit-specialist own
# implementation problem to add the missing binding-level check, not a sign
# this test is wrong.
#
# Also note: the lifecycle-binding grant for BOTH status calls below is
# minted through the REAL context-provider-gate.js hook (_make_input +
# _run_cp_hook + _extract_injected lifecycle-binding, empty agent_type since
# root-source-status is main-orchestrator-gated) rather than a direct
# mintLifecycleCommandGrant call -- mirrors S16-ROOT-SOURCE-STATUS-WAITING-
# REQUEST-REF-01 and S16-ROOT-SOURCE-TAMPER-01's own established two-call
# pattern exactly (team-lead direction, 2026-08-17), each call minting its
# own fresh one-time-use grant. The positive control genuinely, independently
# succeeds (WAITING) before rotation is ever attempted.
@test "M7-ROOT-STATUS-OLD-GENERATION-V2-12 RED: a read-only root-source-status invocation for an action minted under an old, now-superseded session generation must NOT be rejected IDENTITY_MISMATCH -- it must instead reach the generation-cut projection and report BLOCKED/NONE, with the root-source binding own authority record left completely unwritten. Today the handler own unconditional action.session_generation_id-vs-current-generation equality check rejects it at the very top, before ever reaching that row" {
  local session_id="m7-red12-oldgen-session" agent_id="m7-red12-oldgen-agent"
  local binding_id
  binding_id="$(_m7_create_real_active_root_source_binding "$session_id" "$agent_id")"
  [ -n "$binding_id" ]

  local action_id
  action_id="$(node -e '
    const rll = require(process.argv[1]);
    const b = rll.readRegistryRecord(rll.rootSourceBindingPathFor(process.argv[2], process.argv[3]));
    if (!b.ok || b.absent) { process.stderr.write("binding missing"); process.exit(1); }
    process.stdout.write(b.obj.action_id);
  ' "$RLL_IMPL" "$PROJ" "$binding_id")"
  [ -n "$action_id" ]

  local g1_generation_id
  g1_generation_id="$(node -e '
    const rll = require(process.argv[1]);
    const a = rll.findActionDirect(process.argv[2], process.argv[3]);
    if (!a.ok || a.absent) { process.stderr.write("action missing"); process.exit(1); }
    if (typeof a.action.session_generation_id !== "string" || a.action.session_generation_id.length === 0) { process.stderr.write("fixture sanity: action must carry a genuine session_generation_id"); process.exit(1); }
    process.stdout.write(a.action.session_generation_id);
  ' "$RLL_IMPL" "$PROJ" "$action_id")"
  [ -n "$g1_generation_id" ]

  local binding_path
  binding_path="$(node -e 'const rll=require(process.argv[1]);process.stdout.write(rll.rootSourceBindingPathFor(process.argv[2],process.argv[3]));' "$RLL_IMPL" "$PROJ" "$binding_id")"
  local binding_hash_before
  binding_hash_before="$(node -e 'const c=require("crypto");const fs=require("fs");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$binding_path")"

  # Positive control FIRST: status against the SAME still-live generation
  # (G1, unrotated), grant minted through the real hook -- must succeed
  # cleanly (WAITING -- no ingress yet), proving the fixture/binding/action
  # itself is genuinely valid before rotation, and that any denial after
  # rotation is attributable to the generation cut specifically.
  local status_cmd; status_cmd="$(_render_posix_direct node "$RLL_IMPL" root-source-status --project-root "$PROJ" --action "$action_id")"
  _make_input "$status_cmd" "" "$session_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local status_grant_1; status_grant_1="$(_extract_injected lifecycle-binding)"
  [ -n "$status_grant_1" ]
  run env NODE_ENV=test node "$RLL_IMPL" root-source-status --project-root "$PROJ" --action "$action_id" --lifecycle-binding "$status_grant_1"
  [ "$status" -eq 0 ]
  node -e 'const e = JSON.parse(process.argv[1]); if (e.status !== "WAITING" || e.detail_code !== "NONE") { process.stderr.write("RED-12 fixture sanity: expected WAITING/NONE before rotation, got: " + process.argv[1]); process.exit(1); }' "$output"

  # Rotate G1 -> a genuinely live G2 for the IDENTICAL orchestrator session --
  # same technique as claude-one-shot-binding-red.bats own
  # COSB-E2E-GENERATION-ROTATION-REJECTED-ZERO-BINDING (expire the live
  # generation record directly, then resolveSessionGeneration mints a
  # genuinely fresh, live G2 in its place).
  run node -e '
    const rll = require(process.argv[1]);
    const fs = require("fs");
    const projectRoot = process.argv[2];
    const identity = { provider: "claude-hook", runtime_session_key: process.argv[3] };
    const genPath = rll.sessionGenerationPathFor(projectRoot, identity);
    const genRec = JSON.parse(fs.readFileSync(genPath, "utf8"));
    if (genRec.generation_id !== process.argv[4]) { process.stderr.write("fixture sanity: the live generation record must equal G1 (the action generation) before rotation"); process.exit(1); }
    genRec.expires_at = "2000-01-01T00:00:00Z";
    fs.writeFileSync(genPath, JSON.stringify(genRec));
    const rotated = rll.resolveSessionGeneration(projectRoot, identity);
    if (!rotated.ok) { process.stderr.write("G2 mint failed: " + JSON.stringify(rotated)); process.exit(1); }
    if (rotated.generationId === process.argv[4]) { process.stderr.write("fixture sanity: G2 must genuinely differ from G1"); process.exit(1); }
    process.stdout.write(rotated.generationId);
  ' "$RLL_IMPL" "$PROJ" "$session_id" "$g1_generation_id"
  [ "$status" -eq 0 ]
  local g2_generation_id="$output"
  [ -n "$g2_generation_id" ]
  [ "$g2_generation_id" != "$g1_generation_id" ]

  # The action itself genuinely still carries G1 (never silently updated by
  # the rotation) -- isolates "the action is stale" from "the action was
  # somehow mutated along with the generation".
  run node -e '
    const rll = require(process.argv[1]);
    const a = rll.findActionDirect(process.argv[2], process.argv[3]);
    if (!a.ok || a.absent || a.action.session_generation_id !== process.argv[4]) { process.stderr.write("action session_generation_id must remain G1, untouched by rotation: " + JSON.stringify(a)); process.exit(1); }
  ' "$RLL_IMPL" "$PROJ" "$action_id" "$g1_generation_id"
  [ "$status" -eq 0 ]

  # After rotation: the SAME read-only status call, a fresh one-time-use
  # grant minted through the real hook again, must NOT be rejected
  # IDENTITY_MISMATCH -- it must reach the generation-cut projection and
  # report BLOCKED/NONE, with the root-source binding own authority record
  # left completely unwritten.
  local status_cmd2; status_cmd2="$(_render_posix_direct node "$RLL_IMPL" root-source-status --project-root "$PROJ" --action "$action_id")"
  _make_input "$status_cmd2" "" "$session_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local status_grant_2; status_grant_2="$(_extract_injected lifecycle-binding)"
  [ -n "$status_grant_2" ]
  run env NODE_ENV=test node "$RLL_IMPL" root-source-status --project-root "$PROJ" --action "$action_id" --lifecycle-binding "$status_grant_2"
  node -e '
    const e = JSON.parse(process.argv[1]);
    if (e.detail_code === "IDENTITY_MISMATCH") { process.stderr.write("M7 section 9: an old-generation binding must reach the generation-cut projection, never be rejected IDENTITY_MISMATCH at the top-level action-generation gate: " + JSON.stringify(e)); process.exit(1); }
    if (e.status !== "BLOCKED" || e.detail_code !== "NONE") { process.stderr.write("expected BLOCKED/NONE, got: " + JSON.stringify(e)); process.exit(1); }
  ' "$output"

  local binding_hash_after
  binding_hash_after="$(node -e 'const c=require("crypto");const fs=require("fs");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$binding_path")"
  [ "$binding_hash_before" = "$binding_hash_after" ]
}

# M7 checklist item 12 (2026-08-17 correction pass), CANCELLED coverage gap:
# team-lead grepped this file plus registry.test.js/consultation-cli.test.js
# for any root-source-status test touching the CANCELLED state and found
# zero matches -- S16-ROOT-SOURCE-STATUS-WAITING-REQUEST-REF-01 (this file,
# ~L3381-3411) already genuinely covers OPEN/WAITING (real E2E through the CP
# gate, ingress durable, no ack/cancel yet) and S16-ROOT-SOURCE-TAMPER-01
# (this file, ~L3413 onward) already genuinely covers ACKED/READY (full real
# E2E chain through transaction-ack, positive-controlled before its own
# tamper half) -- neither is duplicated here. This closes the third state:
# M7 section 9 table row "ingress + valid cancel -> BLOCKED/NONE with
# request/result-if-present/cancel refs/digests", and the mapping section 9
# names explicitly ("CANCELLED -> BLOCKED"). Confirmed by direct read of
# handleRootSourceStatus (runtime-role-lifecycle.cjs ~L8495-8514): once
# ingress is durable and cancelExists is true (ackExists false), `reason`
# becomes 'cancelled', `ready` becomes false, and -- provided
# readRootSourceTerminalArtifacts resolves a well-formed terminal whose
# requestDigest correlates -- the handler emits exactly BLOCKED/NONE (the
# ready-only accepted-result null-check is skipped for the non-ready path).
# Mirrors RED-16 own cancel step (real carrier publish-request +
# publishRootIngress + a real `cancel` CLI call through the retained-plane
# wrapper) combined with this file own root-source-status-calling convention
# (mainBinding re-derivation + a fresh lifecycle-command-grant per call).
@test "M7-ROOT-SOURCE-STATUS-CANCELLED-12: root-source-status must report BLOCKED/NONE once ingress is durable and the transaction has been genuinely, durably cancelled -- fills the CANCELLED gap in this file own OPEN/ACKED coverage (S16-ROOT-SOURCE-STATUS-WAITING-REQUEST-REF-01/S16-ROOT-SOURCE-TAMPER-01), never duplicating either" {
  local session_id="m7-cancelled-status-session" agent_id="m7-cancelled-status-agent"
  local binding_id
  binding_id="$(_m7_create_real_active_root_source_binding "$session_id" "$agent_id")"
  [ -n "$binding_id" ]

  run env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$TG_CAPABILITY" node -e '
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const { spawnSync } = require("child_process");
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const wrapper = process.argv[4];
    const bindingId = process.argv[5];
    const sessionId = process.argv[6];

    const bindingRead = rll.readRegistryRecord(rll.rootSourceBindingPathFor(projectRoot, bindingId));
    if (!bindingRead.ok || bindingRead.absent) { process.stderr.write("CANCELLED-12 binding missing: " + JSON.stringify(bindingRead)); process.exit(1); }
    const binding = bindingRead.obj;
    const actionId = binding.action_id;

    const plan = rll.discoverPlan(projectRoot);
    if (!plan.ok) { process.stderr.write("CANCELLED-12 PLAN missing"); process.exit(1); }
    const planPath = plan.planPath;
    const subjectBundlePath = path.join(projectRoot, ".planning", "coordination-subject-bundle-manifest.json");
    fs.mkdirSync(path.dirname(subjectBundlePath), { recursive: true });
    fs.writeFileSync(subjectBundlePath, JSON.stringify({ schema: "coordination/subject-bundle-manifest/v1", entries: [] }));
    const coordRoot = path.join(projectRoot, ".planning", "coordination");
    const mainBinding = rll.getOrCreateMainOrchestratorBindingForSession(projectRoot, sessionId, rll.computeWorktreeId(projectRoot), plan.planDigest, 3600);
    if (!mainBinding.ok) { process.stderr.write("CANCELLED-12 main binding re-derivation failed: " + JSON.stringify(mainBinding)); process.exit(1); }

    const intent = {
      target_role: "arch-platform",
      question: "M7 CANCELLED-12 carrier request for root-source ingress correlation",
      expected_result_kind: "IMPLEMENTATION_REVIEW",
      expiry: new Date(Date.now() + 1800000).toISOString(),
    };
    const intentB64 = Buffer.from(JSON.stringify(intent), "utf8").toString("base64url");
    const published = spawnSync(process.execPath, [
      wrapper, "publish-request", "--coordination-root", coordRoot, "--plan", planPath,
      "--subject-bundle", subjectBundlePath, "--intent", intentB64,
    ], { encoding: "utf8", env: process.env });
    let publishedEnvelope;
    try { publishedEnvelope = JSON.parse(published.stdout); } catch { publishedEnvelope = null; }
    if (published.status !== 0 || !publishedEnvelope || publishedEnvelope.status !== "SUCCESS") {
      process.stderr.write("CANCELLED-12 carrier publish-request failed: " + JSON.stringify({ status: published.status, stdout: published.stdout, stderr: published.stderr }));
      process.exit(1);
    }
    const requestId = publishedEnvelope.request_id;
    const requestPath = publishedEnvelope.artifact_ref;
    const requestDigest = crypto.createHash("sha256").update(fs.readFileSync(requestPath)).digest("hex");

    const ingress = rll.publishRootIngress(projectRoot, binding, { requestId, requestDigest });
    if (!ingress.ok) { process.stderr.write("CANCELLED-12 publishRootIngress failed: " + JSON.stringify(ingress)); process.exit(1); }

    function statusOnce() {
      const policyDigest = rc.sha256String("root-source-status:" + actionId);
      const statusGrant = rll.mintLifecycleCommandGrant(
        projectRoot, mainBinding.binding, policyDigest,
        "toolkit-specialist", "root-source-status", "main-orchestrator", "orchestrator", "normal", actionId,
      );
      if (!statusGrant.ok) { process.stderr.write("CANCELLED-12 status grant mint failed: " + JSON.stringify(statusGrant)); process.exit(1); }
      const res = spawnSync(process.execPath, [
        process.argv[1], "root-source-status", "--project-root", projectRoot, "--action", actionId, "--lifecycle-binding", statusGrant.grantId,
      ], { encoding: "utf8", env: process.env });
      let envelope;
      try { envelope = JSON.parse(res.stdout); } catch { envelope = null; }
      if (res.status !== 0 || !envelope) { process.stderr.write("CANCELLED-12 root-source-status failed: " + JSON.stringify({ status: res.status, stdout: res.stdout, stderr: res.stderr })); process.exit(1); }
      return envelope;
    }

    // Positive control FIRST: ingress durable, no terminal yet -- WAITING,
    // proving the fixture itself is valid before cancellation.
    const before = statusOnce();
    if (before.status !== "WAITING") { process.stderr.write("CANCELLED-12 fixture sanity: expected WAITING before cancel, got: " + JSON.stringify(before)); process.exit(1); }

    const cancelled = spawnSync(process.execPath, [
      wrapper, "cancel", "--coordination-root", coordRoot, "--request", requestPath, "--reason", "explicit",
    ], { encoding: "utf8", env: process.env });
    let cancelledEnvelope;
    try { cancelledEnvelope = JSON.parse(cancelled.stdout); } catch { cancelledEnvelope = null; }
    if (cancelled.status !== 0 || !cancelledEnvelope || cancelledEnvelope.status !== "SUCCESS") {
      process.stderr.write("CANCELLED-12 real cancel failed: " + JSON.stringify({ status: cancelled.status, stdout: cancelled.stdout, stderr: cancelled.stderr }));
      process.exit(1);
    }

    const after = statusOnce();
    process.stdout.write(JSON.stringify({
      beforeStatus: before.status, afterStatus: after.status, afterDetailCode: after.detail_code || null,
      afterRequestId: (after.operation && after.operation.request_id) || null,
      afterOperation: after.operation || null,
    }));
  ' "$RLL_IMPL" "$CONSULTATION_CLI" "$PROJ" "$S16_RETAINED_FIXTURE" "$binding_id" "$session_id"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"beforeStatus":"WAITING"'* ]]
  [[ "$output" == *'"afterStatus":"BLOCKED"'* ]]
  [[ "$output" == *'"afterDetailCode":"NONE"'* ]]

  # M7 FINAL CORRECTION (test-specialist, batch 2 of 3, R9 -- extends this
  # pre-existing BLOCKED/NONE-only coverage, which would already pass
  # unconditionally today and does not by itself prove the real gap):
  # readRootSourceTerminalArtifacts (runtime-consultation.cjs) reuses
  # ack_ref/ack_digest for the cancel.json ref/digest inside its own
  # CANCELLED branch (confirmed by direct read: 'ackRef =
  # path.posix.join(...,"cancel.json"); ackDigest = cancelRec.digest;', no
  # separate cancel_ref/cancel_digest concept exists at that layer at all),
  # and OPERATION_KEYS/makeOperation (runtime-role-lifecycle.cjs) have no
  # cancel_ref/cancel_digest members either -- so a CANCELLED status wrongly
  # reports the cancel's own data under ack_ref/ack_digest and can never
  # expose cancel_ref/cancel_digest under any name.
  run node -e '
    const data = JSON.parse(process.argv[1]);
    const op = data.afterOperation || {};
    const errors = [];
    if (op.ack_ref !== null) errors.push("ack_ref must be null for CANCELLED, got: " + JSON.stringify(op.ack_ref));
    if (op.ack_digest !== null) errors.push("ack_digest must be null for CANCELLED, got: " + JSON.stringify(op.ack_digest));
    if (op.accepted_result_ref !== null || op.accepted_result_digest !== null) errors.push("accepted_result fields must both be null: " + JSON.stringify({ ref: op.accepted_result_ref, digest: op.accepted_result_digest }));
    if (op.result_ref !== null || op.result_digest !== null) errors.push("result fields must both be null (no result was ever published in this fixture): " + JSON.stringify({ ref: op.result_ref, digest: op.result_digest }));
    if (typeof op.request_ref !== "string" || typeof op.request_digest !== "string") errors.push("request_ref/request_digest must be populated: " + JSON.stringify({ ref: op.request_ref, digest: op.request_digest }));
    if (typeof op.cancel_ref !== "string" || !op.cancel_ref.endsWith("/cancel.json")) errors.push("cancel_ref must be the exact coordination-relative cancel.json ref, got: " + JSON.stringify(op.cancel_ref));
    if (typeof op.cancel_digest !== "string" || op.cancel_digest.length !== 64) errors.push("cancel_digest must be a 64-hex fd-bound digest, got: " + JSON.stringify(op.cancel_digest));
    const expectedKeys = ["accepted_result_digest","accepted_result_ref","ack_digest","ack_ref","cancel_digest","cancel_ref","kind","operation_id","request_digest","request_id","request_ref","result_digest","result_ref","state"];
    const actualKeys = Object.keys(op).sort();
    if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) errors.push("operation key set mismatch -- expected exactly " + JSON.stringify(expectedKeys) + ", got " + JSON.stringify(actualKeys));
    if (errors.length > 0) {
      process.stderr.write("M7 R9 CANCELLED ABI violations:\n" + errors.join("\n") + "\nfull operation: " + JSON.stringify(op));
      process.exit(1);
    }
  ' "$output"
  [ "$status" -eq 0 ]
}

# ══════════════════════════════════════════════════════════════════════════
# M7 CORRECTION defect 9 (M7-SUPERSEDED-RESOLVER-*): section 6 requires every
# hook-local/consultation-local per-family binding scanner be replaced by the
# ONE canonical classifyClaudeAuthorityForIdentity -- "Hook-local and
# consultation-local binding/retirement scanners are removed." Confirmed by
# direct read (2026-08-17): resolveArchitectRequesterBinding
# (context-provider-gate.js, called from tryInjectRequesterGrant's
# root-source branch) still exists and still scans requester-bindings/
# directly; resolveRootSourceBindingForHook (runtime-role-lifecycle.cjs,
# called from context-provider-gate.js) still exists and is still called;
# findLiveClaudeOneShotBindings (runtime-consultation-target-gate.js, used by
# handleConsultationTargetOwning's claude-agent branch) still exists and is
# still called; requesterBindingNamespaceAbsent/rootSourceBindingNamespaceAbsent
# (runtime-consultation.cjs, used inside validateRoleCommandGrantOrThrow's
# requester-authority branch) still exist and still implement a bespoke
# dual-family-probe instead of clean namespace discrimination. The four
# structural tests below mirror this codebase's own established
# "must-be-genuinely-absent" technique (runtime-consultation-cli.test.js's own
# M7-DUPLICATE-LOCAL-REMOVAL-22, and guards 27/29 in
# runtime-role-lifecycle-registry.test.js) -- a single whole-source substring
# check proves BOTH the definition AND every call site are gone in one pass.
#
# DISCLOSED FINDING (not silently omitted): a companion behavioral test was
# attempted here -- a session/agent identity holding BOTH a live root-source
# binding AND a live one-shot binding, driven through a real root-init call,
# expecting context-provider-gate.js's own resolveRootSourceBindingForHook
# success path (which checks ambiguity against ONLY a persistent
# RequesterBinding via resolveArchitectRequesterBinding, never the one-shot
# family) to let it through. Empirically, it does NOT: the call is correctly
# denied today, with reason "...authority-current-binding-ambiguous" -- but
# NOT via resolveArchitectRequesterBinding at all. It is caught downstream,
# inside rll.mintRoleCommandGrant's own admitClaudeAuthorityOperation('mint-
# grant',...) call, which already runs the full classifyClaudeAuthorityForIdentity
# scan (confirmed by direct trace: the returned denial reason is literally the
# classifier's own authority-current-binding-ambiguous, propagated through
# "[Sixteenth/root-source] unable to mint the exact phase-scoped requester
# grant: authority-current-binding-ambiguous"). That downstream admission call
# is a genuine, already-correct safety net for THIS specific path (root-source
# admin subcommands, and by the identical mechanism, target-gate's
# claude-agent branch) -- so a test asserting today's code fails here would
# itself be dishonest (it does not fail). This is reported to team-lead/
# arch-testing rather than kept as a test that passes for the wrong reason:
# the observable, currently-exploitable consequence of the four superseded
# resolvers above is narrower than "hooks let cross-family ambiguity through"
# -- it is the architectural duplication/redundancy section 6 names
# ("Hook-local and consultation-local binding/retirement scanners are
# removed"), proven by the four structural tests, not a live security gap on
# this specific admin-subcommand path.
# ══════════════════════════════════════════════════════════════════════════

@test "M7-SUPERSEDED-RESOLVER-ABSENT-ARCHITECT-BINDING: resolveArchitectRequesterBinding must be genuinely ABSENT from context-provider-gate.js -- M7 section 6 requires every per-family resolver be replaced by the ONE canonical classifyClaudeAuthorityForIdentity; today this hook-local scanner still exists and is still called" {
  run node -e '
    const fs = require("fs");
    const src = fs.readFileSync(process.argv[1], "utf8");
    process.exit(src.includes("resolveArchitectRequesterBinding") ? 1 : 0);
  ' "$CP_GATE_HOOK"
  [ "$status" -eq 0 ]
}

@test "M7-SUPERSEDED-RESOLVER-ABSENT-ROOT-SOURCE-HOOK: resolveRootSourceBindingForHook must be genuinely ABSENT from runtime-role-lifecycle.cjs -- M7 section 6 requires the classifier replace every per-family resolver; today this hook-local scanner still exists and is still called from context-provider-gate.js" {
  run node -e '
    const fs = require("fs");
    const src = fs.readFileSync(process.argv[1], "utf8");
    process.exit(src.includes("resolveRootSourceBindingForHook") ? 1 : 0);
  ' "$RLL_IMPL"
  [ "$status" -eq 0 ]
}

@test "M7-SUPERSEDED-RESOLVER-ABSENT-ONESHOT-TARGET-GATE: findLiveClaudeOneShotBindings must be genuinely ABSENT from runtime-consultation-target-gate.js for the claude-agent activation path -- M7 section 6 requires the classifier replace it (the RoleActor resolver stays for non-Claude drivers)" {
  run node -e '
    const fs = require("fs");
    const src = fs.readFileSync(process.argv[1], "utf8");
    process.exit(src.includes("findLiveClaudeOneShotBindings") ? 1 : 0);
  ' "$HOOK"
  [ "$status" -eq 0 ]
}

@test "M7-SUPERSEDED-RESOLVER-ABSENT-NAMESPACE-DUAL-PROBE: requesterBindingNamespaceAbsent/rootSourceBindingNamespaceAbsent must be genuinely ABSENT from runtime-consultation.cjs -- M7 section 6 requires clean namespace discrimination (exactly one namespace present; malformed or both present: deny) instead of this dual-family-probe fallback" {
  run node -e '
    const fs = require("fs");
    const src = fs.readFileSync(process.argv[1], "utf8");
    process.exit((src.includes("requesterBindingNamespaceAbsent") || src.includes("rootSourceBindingNamespaceAbsent")) ? 1 : 0);
  ' "$CONSULTATION_CLI"
  [ "$status" -eq 0 ]
}

# ══════════════════════════════════════════════════════════════════════════
# M7 FINAL CORRECTION (test-specialist, batch 2 of 3, R9/R10):
# handleRootSourceStatus (runtime-role-lifecycle.cjs:8530-8624, located with
# team-lead). Reuses _m7_create_real_active_root_source_binding above for the
# binding (the only step that genuinely needs the real hook/reservation
# chain) plus RED-16's own carrier-request + publishRootIngress pattern,
# never hand-rolled action/reservation records.
# ══════════════════════════════════════════════════════════════════════════

# Publishes a real carrier request (through the S16_RETAINED_FIXTURE wrapper,
# mirrors RED-16's own pattern exactly) and correlates it to `binding_id`'s
# root-source binding via publishRootIngress (a plain callable, never hook/
# CLI-gated). Prints "<request_id> <request_path>".
_m7_publish_carrier_and_ingress_for_root_source() {
  local binding_id="$1"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const { spawnSync } = require("child_process");
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const wrapper = process.argv[4];
    const bindingId = process.argv[5];

    const bindingRead = rll.readRegistryRecord(rll.rootSourceBindingPathFor(projectRoot, bindingId));
    if (!bindingRead.ok || bindingRead.absent) { process.stderr.write("R9/R10 fixture: binding missing: " + JSON.stringify(bindingRead)); process.exit(1); }
    const binding = bindingRead.obj;

    const plan = rll.discoverPlan(projectRoot);
    if (!plan.ok) { process.stderr.write("R9/R10 fixture: PLAN missing"); process.exit(1); }
    const planPath = plan.planPath;
    const subjectBundlePath = path.join(projectRoot, ".planning", "coordination-subject-bundle-manifest.json");
    fs.mkdirSync(path.dirname(subjectBundlePath), { recursive: true });
    fs.writeFileSync(subjectBundlePath, JSON.stringify({ schema: "coordination/subject-bundle-manifest/v1", entries: [] }));
    const coordRoot = path.join(projectRoot, ".planning", "coordination");

    const intent = {
      target_role: "arch-platform",
      question: "M7 R9/R10 carrier request for root-source ingress correlation",
      expected_result_kind: "IMPLEMENTATION_REVIEW",
      expiry: new Date(Date.now() + 1800000).toISOString(),
    };
    const intentB64 = Buffer.from(JSON.stringify(intent), "utf8").toString("base64url");
    const published = spawnSync(process.execPath, [
      wrapper, "publish-request", "--coordination-root", coordRoot, "--plan", planPath,
      "--subject-bundle", subjectBundlePath, "--intent", intentB64,
    ], { encoding: "utf8", env: process.env });
    let publishedEnvelope;
    try { publishedEnvelope = JSON.parse(published.stdout); } catch { publishedEnvelope = null; }
    if (published.status !== 0 || !publishedEnvelope || publishedEnvelope.status !== "SUCCESS") {
      process.stderr.write("R9/R10 fixture: carrier publish-request failed: " + JSON.stringify({ status: published.status, stdout: published.stdout, stderr: published.stderr }));
      process.exit(1);
    }
    const requestId = publishedEnvelope.request_id;
    const requestPath = publishedEnvelope.artifact_ref;
    const requestDigest = crypto.createHash("sha256").update(fs.readFileSync(requestPath)).digest("hex");

    const ingress = rll.publishRootIngress(projectRoot, binding, { requestId, requestDigest });
    if (!ingress.ok) { process.stderr.write("R9/R10 fixture: publishRootIngress failed: " + JSON.stringify(ingress)); process.exit(1); }

    process.stdout.write(requestId + " " + requestPath);
  ' "$RLL_IMPL" "$CONSULTATION_CLI" "$PROJ" "$S16_RETAINED_FIXTURE" "$binding_id"
}

# Mints a fresh lifecycle-command-grant for root-source-status (main-
# orchestrator/orchestrator/normal profile, actionId required -- confirmed
# against the GRANT_AUTHORITY_FOR_BINDING_KIND/GRANT_ACTION_ID_REQUIRED_
# SUBCOMMANDS tables) and calls the REAL root-source-status CLI. Prints one
# JSON line: {"status":<exit code>,"stdout":<raw stdout>,"stderr":<raw
# stderr>}.
_m7_call_root_source_status() {
  local action_id="$1" session_id="$2"
  node -e '
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const { spawnSync } = require("child_process");
    const lifecycleCli = process.argv[1];
    const projectRoot = process.argv[3];
    const actionId = process.argv[4];
    const sessionId = process.argv[5];

    const plan = rll.discoverPlan(projectRoot);
    if (!plan.ok) { process.stderr.write("R9/R10 fixture: PLAN missing"); process.exit(1); }
    // Pre-existing bug fix (found independently by toolkit-specialist during
    // the original GREEN phase, and again here): the raw createMainOrchestratorBinding
    // mints a BRAND NEW binding on every call, never reusing the live one for
    // the SAME session -- structurally incompatible with a status helper this
    // file calls repeatedly against the identical live session and expects
    // stable/minimal registry deltas across calls. getOrCreateMainOrchestratorBindingForSession
    // (this codebase own proven-idempotent re-derivation, RED-20 precedent,
    // runtime-role-lifecycle-registry.test.js) takes the raw sessionId string
    // directly, never an identity object.
    const main = rll.getOrCreateMainOrchestratorBindingForSession(projectRoot, sessionId, rll.computeWorktreeId(projectRoot), plan.planDigest, 3600);
    if (!main.ok) { process.stderr.write("R9/R10 fixture: main-orchestrator binding failed: " + JSON.stringify(main)); process.exit(1); }
    const argvDigest = rc.sha256String("root-source-status:" + actionId);
    const grant = rll.mintLifecycleCommandGrant(
      projectRoot, main.binding, argvDigest, "toolkit-specialist", "root-source-status",
      "main-orchestrator", "orchestrator", "normal", actionId,
    );
    if (!grant.ok) { process.stderr.write("R9/R10 fixture: root-source-status lifecycle grant failed: " + JSON.stringify(grant)); process.exit(1); }

    const result = spawnSync(process.execPath, [
      lifecycleCli, "root-source-status", "--project-root", projectRoot, "--action", actionId,
      "--lifecycle-binding", grant.grantId,
    ], { encoding: "utf8", env: process.env });
    process.stdout.write(JSON.stringify({ status: result.status, stdout: result.stdout, stderr: result.stderr }));
  ' "$RLL_IMPL" "$CONSULTATION_CLI" "$PROJ" "$action_id" "$session_id"
}

@test "M7-ROOT-STATUS-FENCE-OPEN-BLOCKED (RED): root-source-status for a live v2 binding with no transaction terminal must project BLOCKED/NONE once the actor's own identity fence is durably published -- today handleRootSourceStatus has zero fence-awareness (confirmed by direct read of the full 8530-8624 body: no readClaudeAuthorityFence call anywhere), so status keeps projecting the SAME pre-fence WAITING/NONE both before and after, and the fence-publish call itself is the ONLY registry write across both status calls" {
  local session_id="m7-red10-session" agent_id="m7-red10-agent"
  local binding_id
  binding_id="$(_m7_create_real_active_root_source_binding "$session_id" "$agent_id")"
  [ -n "$binding_id" ]

  local carrier
  carrier="$(_m7_publish_carrier_and_ingress_for_root_source "$binding_id")"
  local request_id request_path
  read -r request_id request_path <<< "$carrier"
  [ -n "$request_id" ]

  local binding_action_id
  binding_action_id="$(node -e '
    const rll = require(process.argv[1]);
    const rec = JSON.parse(require("fs").readFileSync(rll.rootSourceBindingPathFor(process.argv[2], process.argv[3]), "utf8"));
    process.stdout.write(rec.action_id);
  ' "$RLL_IMPL" "$PROJ" "$binding_id")"
  [ -n "$binding_action_id" ]

  # Fixture sanity (this test's own header comment requires verifying, never
  # assuming, the pre-fence projection): with a live binding, live ingress,
  # and no transaction terminal, this OPEN case must currently project
  # WAITING/NONE.
  local beforeResult
  beforeResult="$(_m7_call_root_source_status "$binding_action_id" "$session_id")"
  local beforeStatusCode
  beforeStatusCode="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).status));' "$beforeResult")"
  [ "$beforeStatusCode" = "0" ]
  local beforeEnvelope
  beforeEnvelope="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).stdout);' "$beforeResult")"
  local beforeOverallStatus
  beforeOverallStatus="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).status);' "$beforeEnvelope")"
  [ "$beforeOverallStatus" = "WAITING" ]

  local registry_before
  registry_before="$(node -e '
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const rll = require(process.argv[1]);
    function walk(d) {
      const out = {};
      let entries = [];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return out; }
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) Object.assign(out, walk(full));
        else out[full] = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
      }
      return out;
    }
    process.stdout.write(JSON.stringify(walk(rll.registryRepoDir(process.argv[2]))));
  ' "$RLL_IMPL" "$PROJ")"

  # Publish a REAL, durable identity fence for the exact (session,agent)
  # identity the root-source binding was minted for.
  run node -e '
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const repoDescriptor = { repoId: rll.computeRepoId(projectRoot) };
    const id = rll.computeClaudeAuthorityIdentityId(repoDescriptor, "claude-hook", process.argv[3], process.argv[4]);
    const result = rll.publishClaudeAuthorityFence(repoDescriptor, id);
    if (!result.ok) { process.stderr.write("fence plant failed: " + JSON.stringify(result)); process.exit(1); }
  ' "$RLL_IMPL" "$PROJ" "$session_id" "$agent_id"
  [ "$status" -eq 0 ]

  local afterResult
  afterResult="$(_m7_call_root_source_status "$binding_action_id" "$session_id")"
  local afterStatusCode
  afterStatusCode="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).status));' "$afterResult")"
  [ "$afterStatusCode" = "0" ]
  local afterEnvelope
  afterEnvelope="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).stdout);' "$afterResult")"

  run node -e '
    const data = JSON.parse(process.argv[1]);
    const op = data.operation || {};
    const errors = [];
    if (data.status !== "BLOCKED" || data.detail_code !== "NONE") errors.push("envelope status/detail_code mismatch (expected BLOCKED/NONE once the actor fence is published): " + JSON.stringify({ status: data.status, detail_code: data.detail_code }));
    if (op.result_ref !== null || op.result_digest !== null || op.accepted_result_ref !== null || op.accepted_result_digest !== null || op.ack_ref !== null || op.ack_digest !== null) {
      errors.push("must expose only the already-proven request ref/digest, never result/accepted/ack/cancel fields: " + JSON.stringify(op));
    }
    if (errors.length > 0) {
      process.stderr.write("M7 R10 fence-projection violations:\n" + errors.join("\n") + "\nfull envelope: " + process.argv[1]);
      process.exit(1);
    }
  ' "$afterEnvelope"
  [ "$status" -eq 0 ]

  local registry_after
  registry_after="$(node -e '
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const rll = require(process.argv[1]);
    function walk(d) {
      const out = {};
      let entries = [];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return out; }
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) Object.assign(out, walk(full));
        else out[full] = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
      }
      return out;
    }
    process.stdout.write(JSON.stringify(walk(rll.registryRepoDir(process.argv[2]))));
  ' "$RLL_IMPL" "$PROJ")"

  # "zero writes by status": the ONLY registry delta ATTRIBUTABLE TO STATUS
  # ITSELF across both calls must be the fence file (published explicitly
  # above, never by status) -- no existing file may change, and no new file
  # outside grants/ may appear. grants/ is deliberately excluded: each
  # _m7_call_root_source_status invocation mints its own one-time
  # lifecycle-command-grant (grant.json + its .consumed marker) to authorize
  # the CLI call at all -- that is the surrounding authorization mechanism's
  # own, correct, by-design behavior for EVERY command invocation (one-time
  # grants are never reused), completely orthogonal to whether the
  # root-source-status HANDLER's own internal logic performs any writes. A
  # second call producing a second grant is expected and irrelevant noise
  # here, never a signal about the handler itself.
  run node -e '
    const before = JSON.parse(process.argv[1]);
    const after = JSON.parse(process.argv[2]);
    const isGrantPath = (k) => k.replace(/\\/g, "/").includes("/grants/");
    const beforeKeys = new Set(Object.keys(before));
    const newKeys = Object.keys(after).filter((k) => !beforeKeys.has(k) && !isGrantPath(k));
    const changedKeys = Object.keys(after).filter((k) => beforeKeys.has(k) && before[k] !== after[k] && !isGrantPath(k));
    if (changedKeys.length > 0) { process.stderr.write("existing registry files changed by a read-only status call: " + JSON.stringify(changedKeys)); process.exit(1); }
    if (newKeys.length !== 1) { process.stderr.write("expected exactly one new non-grant file (the fence itself, published explicitly by this test, never by status): " + JSON.stringify(newKeys)); process.exit(1); }
  ' "$registry_before" "$registry_after"
  [ "$status" -eq 0 ]
}

# M7 correction round 1 (2026-08-18, GAP-5, task #58): mutation #18 (task
# #55, the last of 18) confirmed removing ONLY the fenced+absent-ingress
# BLOCKED branch in handleRootSourceStatus left all 4 named ROOT-STATUS
# tests green -- the sibling FENCE-OPEN-BLOCKED test above exercises the
# OPEN-with-ingress case specifically (isFenced true, ingress present), a
# DIFFERENT branch than this one (isFenced true, ingress absent). Confirmed
# directly (runtime-role-lifecycle.cjs handleRootSourceStatus, ~8880-8888):
# fenced+absent-ingress returns makeResult(...,'BLOCKED','NONE',...,
# makeOperation('root-source', actionId, 'BLOCKED', {})) -- an EMPTY values
# object, so EVERY operation field (including request_id/request_ref/
# request_digest, unlike the sibling's own OPEN-with-ingress case where
# those remain populated) defaults to null.
@test "M7-ROOT-STATUS-FENCE-ABSENT-INGRESS-BLOCKED (GAP-5): root-source-status for a live v2 binding with NO ingress at all must project BLOCKED/NONE (never WAITING/NONE) once the actor's own identity fence is durably published, with EVERY operation ref/digest field null (including request_ref/request_digest, since no ingress exists to populate them)" {
  local session_id="m7-gap5-session" agent_id="m7-gap5-agent"
  local binding_id
  binding_id="$(_m7_create_real_active_root_source_binding "$session_id" "$agent_id")"
  [ -n "$binding_id" ]

  local binding_action_id
  binding_action_id="$(node -e '
    const rll = require(process.argv[1]);
    const rec = JSON.parse(require("fs").readFileSync(rll.rootSourceBindingPathFor(process.argv[2], process.argv[3]), "utf8"));
    process.stdout.write(rec.action_id);
  ' "$RLL_IMPL" "$PROJ" "$binding_id")"
  [ -n "$binding_action_id" ]

  # Fixture sanity: with a live binding, NO ingress, and no fence yet, the
  # pre-fence baseline must be the existing WAITING/NONE projection.
  local beforeResult
  beforeResult="$(_m7_call_root_source_status "$binding_action_id" "$session_id")"
  local beforeStatusCode
  beforeStatusCode="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).status));' "$beforeResult")"
  [ "$beforeStatusCode" = "0" ]
  local beforeEnvelope
  beforeEnvelope="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).stdout);' "$beforeResult")"
  local beforeOverallStatus
  beforeOverallStatus="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).status);' "$beforeEnvelope")"
  [ "$beforeOverallStatus" = "WAITING" ]

  # Publish a REAL, durable identity fence for the exact (session,agent)
  # identity the root-source binding was minted for -- ingress is
  # deliberately never published in this test (unlike FENCE-OPEN-BLOCKED).
  run node -e '
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const repoDescriptor = { repoId: rll.computeRepoId(projectRoot) };
    const id = rll.computeClaudeAuthorityIdentityId(repoDescriptor, "claude-hook", process.argv[3], process.argv[4]);
    const result = rll.publishClaudeAuthorityFence(repoDescriptor, id);
    if (!result.ok) { process.stderr.write("fence plant failed: " + JSON.stringify(result)); process.exit(1); }
  ' "$RLL_IMPL" "$PROJ" "$session_id" "$agent_id"
  [ "$status" -eq 0 ]

  local afterResult
  afterResult="$(_m7_call_root_source_status "$binding_action_id" "$session_id")"
  local afterStatusCode
  afterStatusCode="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).status));' "$afterResult")"
  [ "$afterStatusCode" = "0" ]
  local afterEnvelope
  afterEnvelope="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).stdout);' "$afterResult")"

  run node -e '
    const data = JSON.parse(process.argv[1]);
    const op = data.operation || {};
    const errors = [];
    if (data.status !== "BLOCKED" || data.detail_code !== "NONE") errors.push("envelope status/detail_code mismatch (expected BLOCKED/NONE once the actor fence is published, still zero ingress): " + JSON.stringify({ status: data.status, detail_code: data.detail_code }));
    const mustBeNull = ["request_id", "request_ref", "request_digest", "result_ref", "result_digest", "accepted_result_ref", "accepted_result_digest", "ack_ref", "ack_digest", "cancel_ref", "cancel_digest"];
    for (const field of mustBeNull) {
      if (op[field] !== null) errors.push("operation." + field + " must be null (no ingress exists at all), got: " + JSON.stringify(op[field]));
    }
    if (errors.length > 0) {
      process.stderr.write("M7 GAP-5 fence+absent-ingress projection violations:\n" + errors.join("\n") + "\nfull envelope: " + process.argv[1]);
      process.exit(1);
    }
  ' "$afterEnvelope"
  [ "$status" -eq 0 ]
}

# M7 checklist item G25 (M7-OWNING-NAME-GUARD-25), Codex own required literal
# test name. Existing-behavior guard (not a fresh RED): proves
# agent-spawn-execution-gate.js own already-implemented name===subagent_type
# ownership check (root-source branch, ~L313: "Agent input does not exactly
# match the reserved root-source action payload"). Three SEPARATE @test
# blocks, each calling the real root-source action fixture exactly once --
# mirrors this file own established one-call-per-test convention for
# _m7_create_real_active_root_source_binding (never called twice in the same
# process anywhere else in this file either).
_m7_mint_real_root_source_action_only() {
  local session_id="$1" tag="$2"
  git -C "$PROJ" checkout -b "feature/m7-red02-active-fixture" -q 2>/dev/null
  NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$TG_CAPABILITY" \
    RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY="s16-role-gate-retained-plane" node -e '
    const { spawnSync } = require("child_process");
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const lifecycleCli = process.argv[1];
    const sessionId = process.argv[4];
    const tag = process.argv[5];
    const retainedFixture = require(process.argv[6]);
    const intent = {
      source_role: "toolkit-specialist",
      reporting_architect: "arch-platform",
      question: "Inspect the bounded M7 G25 " + tag + " fixture and return the implementation review.",
      expected_result_kind: "IMPLEMENTATION_REVIEW",
    };
    const encoded = Buffer.from(rc.canonicalJSONStringify(intent), "utf8").toString("base64url");
    const plan = rll.discoverPlan(projectRoot);
    if (!plan.ok) { process.stderr.write("M7 G25 PLAN missing"); process.exit(1); }
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: sessionId };
    const generation = rll.resolveSessionGeneration(projectRoot, identity);
    const main = rll.createMainOrchestratorBinding(projectRoot, identity, rll.computeWorktreeId(projectRoot), plan.planDigest, 3600);
    if (!generation.ok || !main.ok) { process.stderr.write("M7 G25 main authority setup failed"); process.exit(1); }
    retainedFixture.establishRetainedCodexSupportPlane(projectRoot, main.binding);
    const lifecycleGrant = rll.mintLifecycleCommandGrant(
      projectRoot, main.binding, rc.sha256String("root-source:" + encoded),
      "toolkit-specialist", "root-source", "main-orchestrator", "orchestrator", "normal", null,
    );
    if (!lifecycleGrant.ok) {
      process.stderr.write("M7 G25 missing root-source lifecycle admission: " + JSON.stringify(lifecycleGrant));
      process.exit(1);
    }
    const cli = spawnSync(process.execPath, [
      lifecycleCli, "root-source", "--project-root", projectRoot, "--intent", encoded,
      "--lifecycle-binding", lifecycleGrant.grantId,
    ], { encoding: "utf8", env: process.env });
    let envelope;
    try { envelope = JSON.parse(cli.stdout); } catch { envelope = null; }
    if (cli.status !== 0 || !envelope || envelope.status !== "ACTION_REQUIRED"
      || !envelope.operation || envelope.operation.kind !== "root-source"
      || !Array.isArray(envelope.actions) || envelope.actions.length !== 1) {
      process.stderr.write("M7 G25 real root-source CLI failed: " + JSON.stringify({ status: cli.status, stdout: cli.stdout, stderr: cli.stderr }));
      process.exit(1);
    }
    process.stdout.write(JSON.stringify(envelope.actions[0]));
  ' "$RLL_IMPL" "$CONSULTATION_CLI" "$PROJ" "$session_id" "$tag" "$S16_RETAINED_FIXTURE"
}

_m7_g25_call_gate() {
  local session_id="$1" subagent_type="$2" name="$3" prompt="$4"
  node -e '
    const { spawnSync } = require("child_process");
    const projectRoot = process.argv[1];
    const agentGate = process.argv[2];
    const sessionId = process.argv[3];
    const subagentType = process.argv[4];
    const name = process.argv[5];
    const prompt = process.argv[6];
    const commonEnv = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: projectRoot, CLAUDE_WAVE_SLUG: "" });
    const gate = spawnSync(process.execPath, [agentGate], {
      input: JSON.stringify({
        tool_name: "Agent",
        tool_input: { subagent_type: subagentType, name, prompt },
        tool_use_id: "m7-g25-tool-use-" + sessionId, session_id: sessionId, agent_type: "", agent_id: "",
      }), encoding: "utf8", env: commonEnv,
    });
    let body;
    try { body = JSON.parse(gate.stdout); } catch { body = null; }
    const decision = body && body.hookSpecificOutput && body.hookSpecificOutput.permissionDecision;
    const updatedInput = body && body.hookSpecificOutput && body.hookSpecificOutput.updatedInput;
    process.stdout.write(JSON.stringify({
      status: gate.status,
      decision: decision || null,
      stdoutEmpty: gate.stdout === "",
      updatedName: updatedInput && updatedInput.name || null,
    }));
  ' "$PROJ" "$AGENT_SPAWN_GATE_HOOK" "$session_id" "$subagent_type" "$name" "$prompt"
}

@test "M7-OWNING-NAME-GUARD-25 (matching pair, admitted): a canonical owning subagent_type/name pair must be admitted by agent-spawn-execution-gate.js" {
  local session_id="m7-red-g25-match-session"
  local action_json
  action_json="$(_m7_mint_real_root_source_action_only "$session_id" "match")"
  [ -n "$action_json" ]
  local agent_type name prompt
  agent_type="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).payload.agent_type)' "$action_json")"
  name="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).payload.name)' "$action_json")"
  prompt="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).payload.bootstrap_message)' "$action_json")"
  run _m7_g25_call_gate "$session_id" "$agent_type" "$name" "$prompt"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"status":0'* ]]
  [[ "$output" == *'"decision":"allow"'* ]]
}

@test "M7-OWNING-NAME-GUARD-25 (diverging custom name, canonicalized): a custom name cannot hide a unique owning spawn and the reserved action's canonical name is executed" {
  local session_id="m7-red-g25-diverge-session"
  local action_json
  action_json="$(_m7_mint_real_root_source_action_only "$session_id" "diverge")"
  [ -n "$action_json" ]
  local agent_type canonical_name prompt
  agent_type="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).payload.agent_type)' "$action_json")"
  canonical_name="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).payload.name)' "$action_json")"
  prompt="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).payload.bootstrap_message)' "$action_json")"

  local before_count after_count
  before_count="$(node -e 'const rll=require(process.argv[1]);const fs=require("fs");const path=require("path");const dir=path.join(rll.registryRepoDir(process.argv[2]),"root-source-bindings");try{process.stdout.write(String(fs.readdirSync(dir).length));}catch{process.stdout.write("0");}' "$RLL_IMPL" "$PROJ")"

  run _m7_g25_call_gate "$session_id" "$agent_type" "my-custom-non-canonical-name" "$prompt"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"status":0'* ]]
  [[ "$output" == *'"decision":"allow"'* ]]
  local updated_name
  updated_name="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).updatedName || "")' "$output")"
  [ "$updated_name" = "$canonical_name" ]

  after_count="$(node -e 'const rll=require(process.argv[1]);const fs=require("fs");const path=require("path");const dir=path.join(rll.registryRepoDir(process.argv[2]),"root-source-bindings");try{process.stdout.write(String(fs.readdirSync(dir).length));}catch{process.stdout.write("0");}' "$RLL_IMPL" "$PROJ")"
  # PreToolUse reserves the owning action but must not create authority. The
  # RootSourceBinding appears only after the correlated real SubagentStart.
  [ "$before_count" = "$after_count" ]
}

@test "M7-OWNING-NAME-GUARD-25 (non-owning custom Agent, pass-through): an ordinary non-canonical, non-owning Agent spawn must be a silent zero-stdout pass-through" {
  run _m7_g25_call_gate "m7-red-g25-passthrough-session" "my-totally-custom-non-owning-agent" "my-totally-custom-non-owning-agent" "irrelevant prompt"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"status":0'* ]]
  [[ "$output" == *'"stdoutEmpty":true'* ]]
}

# ══════════════════════════════════════════════════════════════════════════
# M7 FINAL CORRECTION, correction round 1 (2026-08-18, C2 root-source half):
# same transaction-substitution bypass as claude-one-shot-binding-red.bats'
# own C2 section, applied to root-source. checkAuthorityOperationTransactionTerminal's
# root-source branch (runtime-role-lifecycle.cjs ~4814-4822) also reads
# operationContext.txnDir from the caller for the terminal check once ingress
# exists (post-ingress) -- same caller-supplied-context gap as one-shot.
# Structurally SIMPLER to reproduce than one-shot: checkRootSourceTransactionTerminalAbsentAtTxnDir
# resolves ack.json/cancel.json purely from txnDir (~4752-4760, no separate
# attempt_id parameter the way one-shot's resultPathFor needs) -- so no
# hybrid-path construction is required here; a terminal planted at each
# transaction's own natural directory is exactly what the vulnerable lookup
# examines when operationContext.txnDir points there. mintRoleCommandGrant's
# own root-source branch has the identical requestId!==ingress.request_id
# mint-time cross-check (~4939) as one-shot's requestId!==binding.request_id
# (~4958) -- same reasoning applies for why a naive CLI-level --request swap
# on one grant would be blocked by the argv-digest coincidence, not exercised
# here since these tests target rll.admitClaudeAuthorityOperation directly
# (Layer 1 only -- the CLI round-trip layer needs cmdCancel's exact argv
# shape, not yet located; time-boxed, flagged rather than silently added).
# Reuses _m7_create_real_active_root_source_binding (established above in
# this file) for the real binding and _m7_publish_carrier_and_ingress_for_root_source's
# own wrapper-invocation pattern for both the real (ingress-correlated) and
# decoy (uncorrelated) carrier requests.
# ══════════════════════════════════════════════════════════════════════════

# Publishes a real, standalone carrier request via the SAME wrapper
# _m7_publish_carrier_and_ingress_for_root_source itself uses, deliberately
# WITHOUT correlating it to any binding via publishRootIngress -- a genuine,
# unrelated decoy transaction. Prints "<request_id> <request_path>".
_c2_root_build_decoy_transaction() {
  node -e '
    const fs = require("fs");
    const path = require("path");
    const { spawnSync } = require("child_process");
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const wrapper = process.argv[3];

    const plan = rll.discoverPlan(projectRoot);
    if (!plan.ok) { process.stderr.write("C2-ROOT decoy: PLAN missing"); process.exit(1); }
    const planPath = plan.planPath;
    const subjectBundlePath = path.join(projectRoot, ".planning", "coordination-subject-bundle-manifest.json");
    fs.mkdirSync(path.dirname(subjectBundlePath), { recursive: true });
    fs.writeFileSync(subjectBundlePath, JSON.stringify({ schema: "coordination/subject-bundle-manifest/v1", entries: [] }));
    const coordRoot = path.join(projectRoot, ".planning", "coordination");

    const intent = {
      target_role: "arch-platform",
      question: "C2 root-source decoy carrier request, deliberately never ingress-correlated",
      expected_result_kind: "IMPLEMENTATION_REVIEW",
      expiry: new Date(Date.now() + 1800000).toISOString(),
    };
    const intentB64 = Buffer.from(JSON.stringify(intent), "utf8").toString("base64url");
    const published = spawnSync(process.execPath, [
      wrapper, "publish-request", "--coordination-root", coordRoot, "--plan", planPath,
      "--subject-bundle", subjectBundlePath, "--intent", intentB64,
    ], { encoding: "utf8", env: process.env });
    let publishedEnvelope;
    try { publishedEnvelope = JSON.parse(published.stdout); } catch { publishedEnvelope = null; }
    if (published.status !== 0 || !publishedEnvelope || publishedEnvelope.status !== "SUCCESS") {
      process.stderr.write("C2-ROOT decoy: carrier publish-request failed: " + JSON.stringify({ status: published.status, stdout: published.stdout, stderr: published.stderr }));
      process.exit(1);
    }
    process.stdout.write(publishedEnvelope.request_id + " " + publishedEnvelope.artifact_ref);
  ' "$RLL_IMPL" "$PROJ" "$S16_RETAINED_FIXTURE"
}

# Plants a minimal, well-formed cancel.json directly at `request_path`'s own
# transaction directory -- checkRootSourceTransactionTerminalAbsentAtTxnDir
# only checks PRESENCE (readCoordinationArtifactPresence, never a deep
# validateResultV2-style shape/correlation pass), confirmed by direct read of
# runtime-role-lifecycle.cjs's own checkRootSourceTransactionTerminalAbsentAtTxnDir
# (~4752-4760) and readCoordinationArtifactPresence (~4720-4724). A shape-only
# but genuinely schema-labeled record, never raw garbage bytes.
_c2_root_plant_cancel() {
  local request_path="$1"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const requestPath = process.argv[1];
    const reqObj = JSON.parse(fs.readFileSync(requestPath, "utf8"));
    const cancelPath = path.join(path.dirname(requestPath), "cancel.json");
    const cancelObj = {
      schema: "coordination/cancel/v1",
      request_id: reqObj.request_id,
      reason: "C2 root-source fixture cancellation",
      cancelled_at: new Date().toISOString(),
    };
    fs.writeFileSync(cancelPath, JSON.stringify(cancelObj), { mode: 0o600 });
    fs.chmodSync(cancelPath, 0o600);
  ' "$request_path"
}

@test "C2-ROOTSOURCE-WRONG-TRANSACTION-REAL-TERMINAL-DECOY-OPEN (RED): real root-source transaction A (post-ingress, the grant's own backing) has a durable cancel.json; decoy transaction B (operationContext txnDir) is open. admitClaudeAuthorityOperation must FAIL authority-scan-failed with zero capability -- today the terminal check examines B (open), wrongly finds nothing wrong, and admission wrongly succeeds" {
  local session_id="c2-root-terminal-session" agent_id="c2-root-terminal-agent"
  local binding_id
  binding_id="$(_m7_create_real_active_root_source_binding "$session_id" "$agent_id")"
  [ -n "$binding_id" ]

  local carrier
  carrier="$(_m7_publish_carrier_and_ingress_for_root_source "$binding_id")"
  local real_request_id real_request_path
  read -r real_request_id real_request_path <<< "$carrier"
  [ -n "$real_request_path" ]

  local decoy
  decoy="$(_c2_root_build_decoy_transaction)"
  local decoy_request_id decoy_request_path
  read -r decoy_request_id decoy_request_path <<< "$decoy"
  [ -n "$decoy_request_path" ]
  [ "$decoy_request_path" != "$real_request_path" ]

  run _c2_root_plant_cancel "$real_request_path"
  [ "$status" -eq 0 ]

  run node -e '
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const bindingId = process.argv[3];
    const sessionId = process.argv[4];
    const agentId = process.argv[5];
    const bindingRead = rll.readRegistryRecord(rll.rootSourceBindingPathFor(projectRoot, bindingId));
    if (!bindingRead.ok || bindingRead.absent) { process.stderr.write("fixture: binding read failed: " + JSON.stringify(bindingRead)); process.exit(1); }
    const binding = bindingRead.obj;
    const identity = {
      schema: rll.CLAUDE_AUTHORITY_IDENTITY_SCHEMA, provider: "claude-hook",
      repo_id: rll.computeRepoId(projectRoot), runtime_session_key: sessionId, agent_id: agentId,
    };
    const admission = rll.admitClaudeAuthorityOperation(
      projectRoot, identity, "consume-grant", binding.expiry,
      { family: "root-source", bindingId },
    );
    if (admission.ok) {
      process.stderr.write("M7 C2-ROOT: admission must FAIL when the real backing transaction A has a durable cancel.json -- today it wrongly succeeds: " + JSON.stringify(admission));
      process.exit(1);
    }
    if (admission.reason !== "root-source-transaction-terminal") {
      process.stderr.write("M7 C2-ROOT: expected reason root-source-transaction-terminal, got: " + JSON.stringify(admission));
      process.exit(1);
    }
  ' "$RLL_IMPL" "$PROJ" "$binding_id" "$session_id" "$agent_id"
  [ "$status" -eq 0 ]
}

@test "C2-ROOTSOURCE-WRONG-TRANSACTION-REAL-OPEN-DECOY-TERMINAL (positive direction, RED): real root-source transaction A (post-ingress, the grant's own backing) is genuinely open; decoy transaction B (operationContext txnDir) has a durable cancel.json. admitClaudeAuthorityOperation must SUCCEED -- since A itself has no terminal, B's terminal is correctly irrelevant. Today the terminal check wrongly examines B, finds ITS cancel.json, and admission wrongly denies -- proves a fix examines the RIGHT transaction, not just 'some' transaction" {
  local session_id="c2-root-open-session" agent_id="c2-root-open-agent"
  local binding_id
  binding_id="$(_m7_create_real_active_root_source_binding "$session_id" "$agent_id")"
  [ -n "$binding_id" ]

  local carrier
  carrier="$(_m7_publish_carrier_and_ingress_for_root_source "$binding_id")"
  local real_request_id real_request_path
  read -r real_request_id real_request_path <<< "$carrier"
  [ -n "$real_request_path" ]

  local decoy
  decoy="$(_c2_root_build_decoy_transaction)"
  local decoy_request_id decoy_request_path
  read -r decoy_request_id decoy_request_path <<< "$decoy"
  [ -n "$decoy_request_path" ]
  [ "$decoy_request_path" != "$real_request_path" ]

  run _c2_root_plant_cancel "$decoy_request_path"
  [ "$status" -eq 0 ]

  run node -e '
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const bindingId = process.argv[3];
    const sessionId = process.argv[4];
    const agentId = process.argv[5];
    const bindingRead = rll.readRegistryRecord(rll.rootSourceBindingPathFor(projectRoot, bindingId));
    if (!bindingRead.ok || bindingRead.absent) { process.stderr.write("fixture: binding read failed: " + JSON.stringify(bindingRead)); process.exit(1); }
    const binding = bindingRead.obj;
    const identity = {
      schema: rll.CLAUDE_AUTHORITY_IDENTITY_SCHEMA, provider: "claude-hook",
      repo_id: rll.computeRepoId(projectRoot), runtime_session_key: sessionId, agent_id: agentId,
    };
    const admission = rll.admitClaudeAuthorityOperation(
      projectRoot, identity, "consume-grant", binding.expiry,
      { family: "root-source", bindingId },
    );
    if (!admission.ok) {
      process.stderr.write("M7 C2-ROOT positive direction: admission must SUCCEED when the real backing transaction A is genuinely open, regardless of an unrelated decoy transaction own cancel.json -- today it wrongly denies: " + JSON.stringify(admission));
      process.exit(1);
    }
  ' "$RLL_IMPL" "$PROJ" "$binding_id" "$session_id" "$agent_id"
  [ "$status" -eq 0 ]
}
