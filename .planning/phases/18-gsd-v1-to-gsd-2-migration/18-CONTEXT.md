# Phase 18: GSD v1 → GSD-2 Migration - Context

**Gathered:** 2026-03-16
**Status:** Ready for planning
**Source:** Conversation-derived (GSD-2 README analysis + ecosystem state audit)

<domain>
## Phase Boundary

Migrate the entire KMP ecosystem from GSD v1 (prompt-injection framework in ~/.claude/commands/gsd/) to GSD-2 (standalone CLI `gsd-pi` on Pi SDK). Covers L0 (AndroidCommonDoc), L1 (shared-kmp-libs), L2 (DawSync + DawSyncWeb subproject). DawSync is priority #1 — has active track-E (Detection Engine, 50% complete) that must continue under GSD-2.

</domain>

<decisions>
## Implementation Decisions

### Migration Order
- L0 (AndroidCommonDoc) first as pilot — simplest, most controlled
- L1 (shared-kmp-libs) second — small .planning/ with one active phase (12.6)
- L2 (DawSync) third — most complex, parallel tracks (A-F), track-E at 50%
- DawSyncWeb last — subproject of DawSync

### GSD-2 Installation
- Install globally: `npm install -g gsd-pi`
- Use `/gsd migrate` command per-project to convert .planning/ → .gsd/
- Migration maps: phases→slices, plans→tasks, milestones→milestones
- Completion state ([x]) preserved automatically

### DawSync Complexity
- 6 parallel tracks (A-F) in Wave 1 execution model
- Track-E: Detection Engine & Auto-Organization (Phase 12), plans 01-05 complete, 06-12 pending
- Track C blocked on Track E merge
- Must map tracks correctly to GSD-2's milestone/slice/task model

### Configuration
- Per-project preferences.md (models, budget_ceiling, timeouts)
- git.isolation: worktree (default) for milestone branches
- token_profile: balanced as starting point
- Models: claude-opus-4-6 for planning, claude-sonnet-4-6 for execution

### Claude's Discretion
- Exact preferences.md tuning per project (budget ceilings, timeout values)
- How to map DawSync parallel tracks to GSD-2's sequential slice model
- Whether to archive .planning/ directories or keep as reference
- GSD v1 command cleanup strategy (remove vs rename)
- CLAUDE.md updates to reference GSD-2 commands instead of v1

</decisions>

<specifics>
## Specific References

- GSD-2 npm package: `gsd-pi` (NOT `gsd-2`)
- Latest version: 2.21.0 (2026-03-16)
- GitHub: https://github.com/gsd-build/gsd-2
- GSD v1 location: ~/.ccs/instances/cuenta1/get-shit-done/
- GSD v1 commands: ~/.claude/commands/gsd/ (30 .md files)
- DawSync .planning/: C:\Users\34645\AndroidStudioProjects\WakeTheCave\WakeTheCave\.planning\
- shared-kmp-libs .planning/: C:\Users\34645\AndroidStudioProjects\shared-kmp-libs\.planning\
- AndroidCommonDoc .planning/: C:\Users\34645\AndroidStudioProjects\AndroidCommonDoc\.planning\

### GSD-2 Directory Structure
```
.gsd/
├── STATE.md, ROADMAP.md, RESEARCH.md, CONTEXT.md, DECISIONS.md
├── preferences.md
├── M001-ROADMAP.md, M001-CONTEXT.md, M001-RESEARCH.md
├── S01-PLAN.md, T01-PLAN.md, T01-SUMMARY.md
├── S01-UAT.md
└── lock
```

### Key GSD-2 Commands
- `/gsd` — step mode (one unit at a time)
- `/gsd auto` — autonomous mode
- `/gsd migrate` — convert v1 .planning/ → v2 .gsd/
- `/gsd doctor` — health checks
- `/gsd prefs` — configure models/budget/timeouts
- `/gsd status` — progress dashboard

</specifics>

<deferred>
## Deferred Ideas

- WakeTheCave migration (read-only mining project, lower priority)
- OmniSound migration (deferred per ecosystem scope)
- Team mode configuration (solo workflow sufficient for now)
- Voice transcription setup (macOS/Linux only)

</deferred>

---

*Phase: 18-gsd-v1-to-gsd-2-migration*
*Context gathered: 2026-03-16 via conversation analysis*
