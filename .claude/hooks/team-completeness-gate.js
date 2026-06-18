#!/usr/bin/env node
// team-completeness-gate.js — RETIRED (BL-W48 team-model migration).
//
// This gate enforced a "spawn all N mandatory peers into the session-<slug>
// named team" floor on every Bash/Edit/Write, blocking work until the roster was
// complete (keyed off the os.tmpdir flag written by team-topology-gate when a
// spawn carried team_name="session-*"). That model is OBSOLETE: TeamCreate/
// TeamList no longer exist, Agent.team_name is deprecated ("single implicit
// team"), and the per-edit roster floor bricked entire waves (bl-w47-tail).
//
// Completeness moved to a disk-ARTIFACT floor verified at the push boundary —
// the required arch-<role> VERIFY-FINAL verdicts per wave CLASS, declared in
// .claude/registry/wave-topology.yaml `class_artifacts` and enforced by
// emit-push-proof.sh (verdict-head binding). Roster membership is no longer a
// contract; multi-agent topology is an execution detail.
//
// Intentionally a no-op. Kept as a greppable tombstone so the retirement is
// EXPLICIT (not a silent disappearance). Its .claude/settings.json registration
// is now inert and is slated for removal in the hook-manifest bulk pass.
let _stdin = '';
process.stdin.on('data', d => { _stdin += d; });
process.stdin.on('end', () => process.exit(0));
setTimeout(() => process.exit(0), 5000);
