#!/usr/bin/env bats
# capability-preservation.bats
# Anti-degradation guard: asserts adapter-specific capabilities are NOT deleted.
# Runs as a plain bats test alongside named-team-regression-guard.bats.
# Complements (does not replace) named-team-regression-guard.bats.
#
# Design rationale: docs/adr/ADR-001-runtime-adapter-contract.md §6.2.

# ── C1: All 9 adapter operations documented in ADR ──────────────────────────

@test "C1.1: ADR documents all 9 adapter ops — spawn" {
  grep -qE '^#### Op [0-9]+: `spawn' docs/adr/ADR-001-runtime-adapter-contract.md
}

@test "C1.2: ADR documents all 9 adapter ops — send" {
  # the op-definition line, not a 'SendMessage' mention
  grep -qE '^#### Op [0-9]+: `send' docs/adr/ADR-001-runtime-adapter-contract.md
}

@test "C1.3: ADR documents all 9 adapter ops — status" {
  grep -qE '^#### Op [0-9]+: `status' docs/adr/ADR-001-runtime-adapter-contract.md
}

@test "C1.4: ADR documents all 9 adapter ops — result" {
  grep -qE '^#### Op [0-9]+: `result' docs/adr/ADR-001-runtime-adapter-contract.md
}

@test "C1.5: ADR documents all 9 adapter ops — stop" {
  grep -qE '^#### Op [0-9]+: `stop' docs/adr/ADR-001-runtime-adapter-contract.md
}

@test "C1.6: ADR documents all 9 adapter ops — artifact" {
  grep -qE '^#### Op [0-9]+: `artifact' docs/adr/ADR-001-runtime-adapter-contract.md
}

@test "C1.7: ADR documents all 9 adapter ops — operator_visibility" {
  grep -qE '^#### Op [0-9]+: `operator_visibility' docs/adr/ADR-001-runtime-adapter-contract.md
}

@test "C1.8: ADR documents all 9 adapter ops — reuse" {
  grep -qE '^#### Op [0-9]+: `reuse' docs/adr/ADR-001-runtime-adapter-contract.md
}

@test "C1.9: ADR documents all 9 adapter ops — overflow" {
  grep -qE '^#### Op [0-9]+: `overflow' docs/adr/ADR-001-runtime-adapter-contract.md
}

# ── C2: SendMessage capability preserved in templates ────────────────────────

@test "C2.1: context-provider template documents SendMessage as a channel" {
  # Must contain SendMessage as a callable operation, not just a mention
  grep -qE 'SendMessage\s*\(' setup/agent-templates/context-provider.md
}

@test "C2.2: doc-updater template documents SendMessage as a channel" {
  grep -qE 'SendMessage\s*\(' setup/agent-templates/doc-updater.md
}

@test "C2.3: quality-gater template documents SendMessage for activation handshake" {
  grep -qE 'SendMessage\s*\(' setup/agent-templates/quality-gater.md
}

@test "C2.4: at least one real dev-specialist template documents SendMessage for result reporting" {
  # Positively scope to the ACTUAL core dev specialists — must not be satisfiable
  # via planner / arch-* / leads / context-provider / quality-gater / doc-updater.
  count=0
  for s in data-layer-specialist domain-model-specialist test-specialist toolkit-specialist ui-specialist; do
    grep -qE 'SendMessage\s*\(' "setup/agent-templates/$s.md" && count=$((count+1))
  done
  [ "$count" -ge 1 ]
}

# ── C3: background-peer / run_in_background capability preserved ──────────────

@test "C3.1: team-topology documents the background-peer model" {
  # The canonical topology/model doc must document background peers (the optional
  # accelerator layer). NOT arch-topology-protocols (that doc covers the OBS-A /
  # dispatch-tree gate, never the background-peer model — verified: 0 such refs).
  grep -qiE 'background.peer|run_in_background|agent_class.*peer' \
    docs/agents/team-topology.md
}

@test "C3.2: tl-dispatch-topology documents background-peer or run_in_background" {
  grep -qiE 'background.peer|run_in_background' docs/agents/tl-dispatch-topology.md
}

@test "C3.3: at least 20 files preserve background-peer or run_in_background reference" {
  # Brief surface: 25 files. Allow for some pruning of legacy-only refs, floor at 20.
  count=$(grep -rliE 'background.peer|run_in_background' \
    setup/agent-templates/ docs/agents/ skills/ | wc -l)
  [ "$count" -ge 20 ]
}

# ── C4: operator visibility capability preserved ──────────────────────────────

@test "C4.1: operator_visibility capability documented via an intentional anchor in a tl-* dispatch doc" {
  # The old test greped docs/agents/ BROADLY and matched a single INCIDENTAL phrase
  # ("peer roster", a cross-ref in tl-phase-execution.md) — floor of 1, fragile (any
  # reword drops it to 0) and inconsistent with the test name ("tl-* doc"). Now:
  # restricted to docs/agents/tl-*.md AND anchored to a DELIBERATE capability marker
  # ('operator visibility' / 'operator_visibility'), NOT an incidental phrase. The
  # explicit operator-visibility bullet in tl-dispatch-topology.md is LOAD-BEARING —
  # removing it IS the capability degradation this guard exists to catch.
  count=$(grep -rliE 'operator.visib|operator_visibility' docs/agents/tl-*.md | wc -l)
  [ "$count" -ge 1 ]
}

@test "C4.2: ADR documents operator_visibility operation semantics" {
  grep -qiE 'operator.visib' docs/adr/ADR-001-runtime-adapter-contract.md
}

# ── C5: artifact-fallback semantics preserved ────────────────────────────────

@test "C5.1: ADR documents artifact-based fallback for send" {
  # ADR must describe what to do when send is absent (disk inbox pattern)
  grep -qiE 'inbox|disk.*(fallback|floor)' docs/adr/ADR-001-runtime-adapter-contract.md
}

@test "C5.2: artifact fallback requires a validated check (marker + HEAD-binding + freshness), not bare presence" {
  adr=docs/adr/ADR-001-runtime-adapter-contract.md
  # The full validated-artifact contract (ArtifactValidation struct + all 4 fields) must be present.
  grep -q 'ArtifactValidation' "$adr"
  grep -q 'validMarker'        "$adr"
  grep -qiE 'headBound|HEAD.bind' "$adr"
  grep -qiE '\bfresh'          "$adr"
  # The status field IS the validated struct (`: ArtifactValidation`), which PROVES the
  # bare-boolean presence flag is gone. (Positive assertion only: a negative grep for the
  # old `artifactPresent: boolean` / "poll for presence" would self-match this guard's own
  # pseudocode, since the promoted ADR documents this very test.)
  grep -qE ':[[:space:]]*ArtifactValidation' "$adr"
}

# ── C6: architects-govern-specialists topology preserved ─────────────────────

@test "C6.1: tl-dispatch-topology documents architect→specialist governance" {
  grep -qiE 'architect.*specialist|specialist.*architect' \
    docs/agents/tl-dispatch-topology.md
}

@test "C6.2: premature-execution-gate subject-types still include specialist roles" {
  grep -q 'test-specialist' .claude/hooks/premature-execution-gate.js
}

@test "C6.3: architect-self-edit-gate still enforces architect write restriction" {
  # Gate must still block arch-* from Write/Edit non-verdict files
  grep -q "arch-" .claude/hooks/architect-self-edit-gate.js
}

# ── C7: context-provider oracle role preserved ───────────────────────────────

@test "C7.1: context-provider template documents the oracle/pattern role" {
  grep -qiE 'oracle|pattern.index|knowledge.layer' \
    setup/agent-templates/context-provider.md
}

@test "C7.2: context-provider-gate still exempts context-provider from CP consultation" {
  grep -q 'context-provider' .claude/hooks/context-provider-gate.js
}

@test "C7.3: at least one tl-* doc documents context-provider as the query oracle" {
  count=$(grep -rliE 'context.provider.*(oracle|query|consult)|(oracle|query|consult).*context.provider' \
    docs/agents/ | wc -l)
  [ "$count" -ge 1 ]
}
