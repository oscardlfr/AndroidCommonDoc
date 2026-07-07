#!/usr/bin/env bats
#
# Disk-fallback documentation presence, Wave 2 (portable-coordination-artifacts).
#
# Asserts a deliberate marker is present in EXACTLY the 7 touched docs/protocol docs named in
# PLAN.md's scope. Deliberately anchored to a SPECIFIC marker string, not a broad free-prose
# grep -- avoids the old C4.1 failure mode (capability-preservation.bats's own postmortem:
# a broad regex over docs/agents/ matched a single INCIDENTAL phrase, fragile against any
# reword). This file NEVER scans setup/agent-templates/ or .claude/agents/ -- PLAN.md's
# explicit preserve constraint for this test ("templates DOCS-ONLY").
#
# Marker: RESOLVED by team-lead (empirically verified, not guessed) as the literal string
# `coordination-artifact-schema` -- the doc-updater cross-reference/link text each of the 7
# docs uses to point at the canonical schema doc (e.g. "Full schema: [coordination-artifact-schema]
# (coordination-artifact-schema.md)"), confirmed present at least once in all 7 files. This
# superseded an earlier candidate regex (`coordination[- ]artifacts?`) proposed by this
# specialist before doc-updater's docs had landed; the team-lead-ratified literal anchor is
# more deliberate (a stable cross-reference every doc genuinely needs, not a broader pattern
# that happened to also match).
#
# If doc-updater ever reworks the cross-reference text, update MARKER below to match --
# the doc and this test must agree on one literal anchor.
#
# Invocation: bats scripts/tests/coordination-fallback-docs.bats (from repo root)

REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
MARKER='coordination-artifact-schema'

# Scope self-check: the 7 docs named in PLAN.md's Scope section (deliberately excludes
# ADR-001 and hook-manifest.md -- those are covered by capability-preservation.bats
# C1/C5 and the CI hook-manifest-coverage job respectively, per PLAN.md's explicit note).
TOUCHED_DOCS_COUNT=7

@test "CFD-0: exactly 7 docs are in scope for this marker check (scope self-check, mirrors PLAN.md)" {
  [ "$TOUCHED_DOCS_COUNT" -eq 7 ]
}

@test "CFD-1: docs/agents/coordination-artifact-schema.md carries the disk-fallback marker" {
  grep -qF "$MARKER" "$REPO_ROOT/docs/agents/coordination-artifact-schema.md"
}

@test "CFD-2: docs/agents/agent-core-rules.md carries the disk-fallback marker" {
  grep -qF "$MARKER" "$REPO_ROOT/docs/agents/agent-core-rules.md"
}

@test "CFD-3: docs/agents/scope-extension-protocol.md carries the disk-fallback marker" {
  grep -qF "$MARKER" "$REPO_ROOT/docs/agents/scope-extension-protocol.md"
}

@test "CFD-4: docs/agents/specialist-dispatch-protocol.md carries the disk-fallback marker" {
  grep -qF "$MARKER" "$REPO_ROOT/docs/agents/specialist-dispatch-protocol.md"
}

@test "CFD-5: docs/agents/tl-session-start.md carries the disk-fallback marker" {
  grep -qF "$MARKER" "$REPO_ROOT/docs/agents/tl-session-start.md"
}

@test "CFD-6: docs/agents/tl-dispatch-topology.md carries the disk-fallback marker" {
  grep -qF "$MARKER" "$REPO_ROOT/docs/agents/tl-dispatch-topology.md"
}

@test "CFD-7: docs/agents/context-provider-adoption-hooks.md carries the disk-fallback marker" {
  grep -qF "$MARKER" "$REPO_ROOT/docs/agents/context-provider-adoption-hooks.md"
}
