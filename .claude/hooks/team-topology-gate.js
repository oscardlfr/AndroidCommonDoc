#!/usr/bin/env node
// team-topology-gate.js — RETIRED (BL-W48 team-model migration).
//
// Two-hook roster enforcer: PostToolUse(Agent) recorded peers whose spawn carried
// team_name="session-*" into an os.tmpdir flag; PreToolUse blocked arch-* spawns
// until the named-team roster floor was met. Both halves are OBSOLETE — named
// teams are gone, team_name is deprecated, and a subagent spawned WITHOUT
// team_name never armed the flag anyway (verified empirically — see
// .planning/wave-bl-w48-team-model-rootfix/runtime-recheck.md).
//
// Completeness is now a disk-ARTIFACT floor by wave CLASS (wave-topology.yaml
// `class_artifacts` + emit-push-proof.sh verdict-head binding). Roster membership
// is no longer a contract.
//
// Intentionally a no-op. Kept as a greppable tombstone so the retirement is
// EXPLICIT (not a silent disappearance). Its two .claude/settings.json
// registrations (PostToolUse + PreToolUse) are now inert and slated for removal
// in the hook-manifest bulk pass.
let _stdin = '';
process.stdin.on('data', d => { _stdin += d; });
process.stdin.on('end', () => process.exit(0));
setTimeout(() => process.exit(0), 5000);
