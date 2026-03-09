# Phase 18: GSD v1 to GSD-2 Migration - Research

**Researched:** 2026-03-16
**Domain:** Developer tooling migration (GSD v1 prompt-injection framework to GSD-2 standalone CLI)
**Confidence:** MEDIUM

## Summary

GSD-2 is a standalone CLI (`gsd-pi` on npm, v2.22.0 latest) built on the Pi SDK that replaces GSD v1's prompt-injection model (34 markdown workflows in `~/.ccs/instances/cuenta1/get-shit-done/`) with a real coding agent that manages context windows, git worktrees, cost tracking, and crash recovery natively. The migration command `/gsd migrate` parses existing `.planning/` directories and converts them to `.gsd/` format, mapping phases to slices, plans to tasks, and preserving completion state. It supports decimal phase numbering (critical for AndroidCommonDoc's 14.1, 14.2, 14.2.1 phases) and shows a preview before writing.

The ecosystem has 4 projects requiring migration with varying complexity: L0 AndroidCommonDoc (18 phases, 101 plans, v1.2 nearly complete), L1 shared-kmp-libs (1 phase directory with minimal content), L2 DawSync (25+ phase directories, parallel tracks A-F, track-E at 50% with plans 06-12 pending), and DawSyncWeb (11 phases, separate repo). The main risk is DawSync's parallel track model, which has no direct equivalent in GSD-2's sequential milestone/slice/task hierarchy. DawSync tracks must be mapped as separate milestones or sequential slices within a single milestone.

**Primary recommendation:** Install gsd-pi globally, migrate L0 first as pilot, then L1, then DawSync (most complex), then DawSyncWeb. For DawSync, map each track to a separate milestone (M001=Track-E active, M002=Track-B planned, etc.) since tracks represent independent shippable scopes.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Migration order: L0 first (pilot), L1 second, DawSync third, DawSyncWeb last
- Install globally: `npm install -g gsd-pi`
- Use `/gsd migrate` command per-project to convert .planning/ to .gsd/
- Migration maps: phases to slices, plans to tasks, milestones to milestones
- Completion state ([x]) preserved automatically
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

### Deferred Ideas (OUT OF SCOPE)
- WakeTheCave migration (read-only mining project, lower priority)
- OmniSound migration (deferred per ecosystem scope)
- Team mode configuration (solo workflow sufficient for now)
- Voice transcription setup (macOS/Linux only)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| GSD2-INSTALL | Install gsd-pi globally, verify CLI works | npm package confirmed as `gsd-pi`, v2.22.0 latest, install via `npm install -g gsd-pi`, first run via `gsd` then `gsd config` |
| GSD2-MIGRATE-L0 | Migrate AndroidCommonDoc .planning/ to .gsd/ | 18 phases with decimal numbering (14.1, 14.2, 14.2.1, 14.3) -- migration supports decimal phases; 101 plans; nearly complete milestone |
| GSD2-MIGRATE-L1 | Migrate shared-kmp-libs .planning/ to .gsd/ | Minimal: 1 phase directory (12.6-kotlinx-io-migration), 1 summary file; simplest migration |
| GSD2-MIGRATE-L2 | Migrate DawSync + DawSyncWeb .planning/ to .gsd/ | DawSync: 25+ phase dirs, parallel tracks A-F, track-E at 50%; DawSyncWeb: 11 phases. Track mapping is primary challenge |
| GSD2-CONFIG | Configure per-project preferences.md | preferences.md schema documented; models, budget_ceiling, auto_supervisor timeouts, token_profile, git.isolation, skill_discovery settings |
| GSD2-VALIDATE | Validate migration integrity (phases to slices, completion state) | Migration shows preview before writing; `/gsd doctor` for health checks; `/gsd status` for progress dashboard |
| GSD2-CLEANUP | Remove GSD v1 infrastructure | GSD v1 at ~/.ccs/instances/cuenta1/get-shit-done/ (34 workflows, 13 references, 25 templates, gsd-tools.cjs); no Claude commands directory found at ~/.claude/commands/gsd/ |
| GSD2-VERIFY | Verify GSD-2 workflow by continuing DawSync track-E | Track-E Phase 12: plans 01-05 complete (summaries exist), plans 06-12 pending; must work under GSD-2 `/gsd` or `/gsd auto` |
</phase_requirements>

## Standard Stack

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| gsd-pi | v2.22.0 | GSD-2 CLI agent | Official GSD-2 npm package; standalone CLI on Pi SDK |
| Node.js | 18+ | Runtime for gsd-pi | Required by npm global install |

### Supporting
| Tool | Purpose | When to Use |
|------|---------|-------------|
| `/gsd migrate` | Convert .planning/ to .gsd/ | One-time per project during migration |
| `/gsd doctor` | Health checks and auto-fix | After each migration to validate |
| `/gsd prefs` | Configure preferences.md | After migration to set models/budget/timeouts |
| `/gsd status` | Progress dashboard | To verify completion state preserved |
| `/gsd config` | Re-run setup wizard | First-time setup (LLM provider, tool keys) |

**Installation:**
```bash
npm install -g gsd-pi
gsd config  # First-time setup wizard
```

## Architecture Patterns

### GSD-2 Directory Structure (post-migration)
```
.gsd/
  STATE.md              # Quick-glance dashboard
  DECISIONS.md          # Append-only decision register
  preferences.md        # Project-level config (models, budget, timeouts)
  M001-ROADMAP.md       # Milestone plan with slice checkboxes
  M001-CONTEXT.md       # User decisions
  M001-RESEARCH.md      # Research artifacts
  S01-PLAN.md           # Slice task decomposition
  T01-PLAN.md           # Individual task plan
  T01-SUMMARY.md        # Task execution summary
  S01-UAT.md            # Human test script
  lock                  # Crash recovery tracking
```

### GSD-2 Hierarchy Model
```
Milestone = shippable version (4-10 slices)
  Slice = one demoable vertical capability (1-7 tasks)
    Task = one context-window-sized unit of work
```

**Iron Rule:** A task must fit in one context window. If it cannot, it is two tasks.

### Pattern: DawSync Track Mapping (Claude's Discretion)
**Recommendation:** Map each DawSync track to a separate GSD-2 milestone.

| DawSync Track | Status | GSD-2 Mapping |
|---------------|--------|---------------|
| Track A: Data Resilience (8.3a) | COMPLETE | Archive only (no active milestone needed) |
| Track B: macOS Parity (8.2) | Planned | M002-macos-full-parity |
| Track C: Analytics (9.1) | COMPLETE, blocked on Track E merge | Archive; Phase 9.2 becomes slice in post-merge milestone |
| Track D: VST3 Hardening (8.4) | COMPLETE | Archive only |
| Track E: Detection Engine (12) | IN PROGRESS 50% | M001-detection-engine (priority -- active work) |
| Track F: DawSyncWeb | Planned (separate repo) | Separate project migration |

**Rationale:** GSD-2 milestones run in worktree isolation with squash merge. Tracks are independent scopes that map naturally to milestones. Active track-E becomes the first milestone (M001) to enable immediate `/gsd auto` continuation.

### Pattern: preferences.md Per Project
```yaml
---
version: 1
models:
  research: claude-sonnet-4-6
  planning:
    model: claude-opus-4-6
    fallbacks:
      - claude-sonnet-4-6
  execution: claude-sonnet-4-6
  completion: claude-sonnet-4-6
auto_supervisor:
  soft_timeout_minutes: 20
  idle_timeout_minutes: 10
  hard_timeout_minutes: 30
budget_ceiling: 50.00
token_profile: balanced
git:
  isolation: worktree
skill_discovery: suggest
unique_milestone_ids: true
---
```

### Pattern: .planning/ Archive Strategy (Claude's Discretion)
**Recommendation:** Rename `.planning/` to `.planning-v1-archive/` and add to `.gitignore` rather than deleting. This preserves history for reference without polluting the active directory structure. After 30 days of successful GSD-2 operation, delete entirely.

### Anti-Patterns to Avoid
- **Migrating all projects simultaneously:** Each migration should be verified before starting the next. Serial execution prevents cascading failures.
- **Deleting .planning/ before validating .gsd/:** Always verify migration integrity first. Keep .planning/ as rollback.
- **Mapping DawSync tracks to slices within one milestone:** Tracks are independent scopes with different branch strategies. Forcing them into one milestone creates artificial dependencies.
- **Skipping `gsd config` after install:** The setup wizard configures LLM provider and tool keys -- required for any GSD-2 operation.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Phase-to-slice conversion | Custom migration script | `/gsd migrate` | Handles decimal phases, completion state, summaries, research artifacts |
| Preferences configuration | Manual YAML editing | `/gsd prefs` | Schema validation, prevents silent configuration errors |
| Health checking | Manual file inspection | `/gsd doctor` | Auto-detects and auto-fixes common issues |
| Git worktree management | Manual git commands | `/worktree` or `/wt` | Lifecycle management (create, switch, merge, remove) |

**Key insight:** GSD-2 is a real CLI agent, not a prompt template. It manages its own state machine -- do not attempt to manually edit .gsd/ files or manage the migration outside of the provided commands.

## Common Pitfalls

### Pitfall 1: Decimal Phase Numbering Edge Cases
**What goes wrong:** AndroidCommonDoc has deeply nested decimal phases (14.2.1) and many decimal insertions (14.1, 14.2, 14.3). The migration tool states it supports decimal numbering but depth beyond two levels (X.Y.Z) is less commonly tested.
**Why it happens:** v1 used arbitrary decimal depth for inserted phases.
**How to avoid:** Run `/gsd migrate` with preview mode first. Manually verify that 14.2.1 phases appear correctly in the migrated output before confirming.
**Warning signs:** Missing phases in the preview, merged or flattened phase content.

### Pitfall 2: DawSync Parallel Track Loss
**What goes wrong:** DawSync's 6 parallel tracks (A-F) have no direct equivalent in GSD-2's sequential model. Migration might flatten tracks into a single linear sequence.
**Why it happens:** GSD-2 assumes sequential milestone execution. Parallel work is handled by separate terminals on the same project, not by structural modeling.
**How to avoid:** Pre-plan the track-to-milestone mapping before running migration. May need to run `/gsd migrate` and then manually restructure the output.
**Warning signs:** All DawSync phases in a single milestone with lost track context.

### Pitfall 3: Existing .gsd/ Conflicts
**What goes wrong:** If a project already has a `.gsd/` directory (from a previous failed migration attempt), the migration tool may refuse to run or overwrite state.
**Why it happens:** Safety check to prevent data loss.
**How to avoid:** Ensure no `.gsd/` directory exists before running migration. If it does from a failed attempt, remove it first.

### Pitfall 4: Windows Path Handling
**What goes wrong:** GSD-2's worktree isolation uses git worktrees, which on Windows may have path length issues or symlink problems.
**Why it happens:** Windows 260-character path limit, NTFS junction/symlink restrictions.
**How to avoid:** Keep project paths short. GSD-2 worktrees will be created adjacent to the project root. Test worktree creation on the first migrated project (L0) before proceeding.
**Warning signs:** Git worktree errors, "filename too long" errors.

### Pitfall 5: GSD v1 Workflow References in CLAUDE.md
**What goes wrong:** All 4 CLAUDE.md files may reference GSD v1 patterns (/gsd:* commands, .planning/ paths, config.json settings).
**Why it happens:** CLAUDE.md files were written during v1 era.
**How to avoid:** Audit and update CLAUDE.md files after migration. Replace .planning/ references with .gsd/, update command references from /gsd:* to /gsd *.
**Warning signs:** Claude Code trying to use old GSD v1 workflows instead of GSD-2.

### Pitfall 6: DawSync Track-E In-Progress State
**What goes wrong:** Track-E (Phase 12) has plans 06-12 pending. Migration must preserve the partial completion state so that `/gsd auto` picks up at plan 06 (not 01).
**Why it happens:** Migration needs to correctly map completed plans (with summaries) vs pending plans (without summaries).
**How to avoid:** After migration, use `/gsd status` to verify the current position shows the correct next task. Run one `/gsd` step (not auto) first to verify dispatch.
**Warning signs:** GSD-2 attempting to re-execute already-completed tasks.

## Code Examples

### GSD-2 Installation and First Setup
```bash
# Install globally
npm install -g gsd-pi

# Run setup wizard (LLM provider, tool keys)
gsd config

# Verify installation
gsd --version
```

### Migration Per Project
```bash
# Navigate to project
cd /path/to/project

# Run migration with preview
gsd
/gsd migrate

# Review preview output before confirming
# Then validate
/gsd doctor
/gsd status
```

### Migration of External Project (from different working directory)
```bash
# From any directory
gsd
/gsd migrate ~/projects/my-old-project
```

### preferences.md Configuration
```bash
# Interactive configuration
gsd
/gsd prefs
```

### Continuing DawSync Track-E
```bash
# After migration, from DawSync project
gsd
/gsd status  # Verify current position (should show detection engine tasks)
/gsd         # Step mode -- execute one task, verify output
/gsd auto    # Once confident, autonomous execution
```

## State of the Art

| Old Approach (GSD v1) | Current Approach (GSD-2) | Impact |
|------------------------|--------------------------|--------|
| Prompt-injection via markdown workflows | Standalone CLI agent on Pi SDK | Direct control over context windows, git, cost |
| .planning/ directory with config.json | .gsd/ directory with preferences.md | Richer config (models, budget, timeouts) |
| Manual context management | Auto context pre-loading per task | Fresh 200k-token context per task |
| No crash recovery | Lock file + recovery briefing | Auto-resume after failures |
| No cost tracking | Per-unit token/cost capture | Budget ceiling enforcement |
| Manual git branching | Worktree isolation + squash merge | Clean git bisect, single-commit milestones |
| /gsd:execute-plan (prompt template) | /gsd auto (real agent loop) | Walk-away autonomous execution |
| 34 workflow .md files | Built-in commands | No file management needed |

## Open Questions

1. **DawSync track-to-milestone mapping verification**
   - What we know: GSD-2 supports multiple milestones via `/gsd queue`
   - What is unclear: Whether `/gsd migrate` can auto-detect DawSync's track structure or if manual restructuring is needed post-migration
   - Recommendation: Migrate DawSync and immediately inspect the .gsd/ output. If tracks are flattened, manually create milestone files for each track.

2. **GSD v1 gsd-tools.cjs dependency**
   - What we know: The current GSD v1 init system uses `gsd-tools.cjs` from `~/.ccs/instances/cuenta1/get-shit-done/bin/`
   - What is unclear: Whether GSD-2 install removes or conflicts with the v1 installation
   - Recommendation: Install GSD-2 first (it uses a different directory), verify it works, then clean up v1 files.

3. **Windows worktree isolation behavior**
   - What we know: GSD-2 defaults to worktree isolation for milestones
   - What is unclear: Windows-specific edge cases (path lengths, NTFS junctions, permission issues)
   - Recommendation: Test worktree creation on L0 first (simplest project). If issues arise, set `git.isolation: none` as fallback.

4. **agent-instructions.md relationship to CLAUDE.md**
   - What we know: GSD-2 injects `agent-instructions.md` into every session as persistent behavioral guidance
   - What is unclear: How it interacts with existing CLAUDE.md conventions (does it supplement or replace?)
   - Recommendation: Keep CLAUDE.md for Claude Code conventions, use agent-instructions.md only for GSD-2-specific behavioral guidance (if any beyond defaults).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Manual validation (CLI-based migration, no automated test suite) |
| Config file | N/A -- this is a tooling migration, not a code change |
| Quick run command | `/gsd doctor` |
| Full suite command | `/gsd status` + manual .gsd/ file inspection |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GSD2-INSTALL | gsd-pi CLI available globally | smoke | `gsd --version` | N/A |
| GSD2-MIGRATE-L0 | L0 .planning/ converted to .gsd/ | manual | `/gsd doctor` in AndroidCommonDoc | Wave 0 |
| GSD2-MIGRATE-L1 | L1 .planning/ converted to .gsd/ | manual | `/gsd doctor` in shared-kmp-libs | Wave 0 |
| GSD2-MIGRATE-L2 | L2 .planning/ + DawSyncWeb converted | manual | `/gsd doctor` in DawSync + DawSyncWeb | Wave 0 |
| GSD2-CONFIG | preferences.md correct per project | manual | `/gsd prefs` inspection | Wave 0 |
| GSD2-VALIDATE | Completion state preserved, phases mapped | manual | `/gsd status` shows correct progress | Wave 0 |
| GSD2-CLEANUP | GSD v1 files removed | manual | `ls ~/.ccs/instances/cuenta1/get-shit-done/` returns empty/missing | Wave 0 |
| GSD2-VERIFY | DawSync track-E continues under GSD-2 | e2e | `/gsd` step mode executes plan 06 | Wave 0 |

### Sampling Rate
- **Per task:** `/gsd doctor` after each migration
- **Per wave:** `/gsd status` across all migrated projects
- **Phase gate:** All 4 projects migrated, DawSync track-E plan 06 dispatched successfully

### Wave 0 Gaps
- No automated tests -- this is a tooling migration validated by CLI commands
- Validation is primarily manual: inspect .gsd/ contents, verify `/gsd status` output, attempt task execution

## Ecosystem Inventory (Migration Scope)

### L0: AndroidCommonDoc
| Item | Count | Notes |
|------|-------|-------|
| Phase directories | 18 | Includes 14.1, 14.2, 14.2.1, 14.3 (decimal) |
| Plan files | 101 | 99 completed, 2 remaining (Phase 17) |
| .planning/ files | PROJECT.md, REQUIREMENTS.md, ROADMAP.md, STATE.md, MILESTONES.md, RETROSPECTIVE.md, config.json | Plus research/, milestones/ dirs |
| Milestone status | v1.2 at 97% | Nearly complete |

### L1: shared-kmp-libs
| Item | Count | Notes |
|------|-------|-------|
| Phase directories | 1 | 12.6-kotlinx-io-migration |
| Plan files | 1 summary | Minimal content |
| .planning/ files | phases/ only | No PROJECT.md, ROADMAP.md, etc. |
| Milestone status | Unknown | Sparse .planning/ |

### L2: DawSync
| Item | Count | Notes |
|------|-------|-------|
| Phase directories | 25+ | Includes 8.1, 8.1.1, 8.1.2, 8.1.3, 8.1.4, 8.2, 8.3a, 8.3b, 8.4, 9.1, 9.2, W-dawsyncweb |
| Plan files | Many | Track-E Phase 12: 5 complete, 7 pending |
| .planning/ files | Full suite | PROJECT.md, REQUIREMENTS.md, ROADMAP.md, STATE.md, config.json, plus research/, todos/, debug/, codebase/ |
| Track status | A/C/D complete, B planned, E 50%, F planned |
| config.json | granularity: fine, branching: phase, template: feature/precloud-{slug} |

### L2: DawSyncWeb
| Item | Count | Notes |
|------|-------|-------|
| Phase directories | 11 | Includes 8.1, 8.5, 8.5.1 (decimal) |
| .planning/ files | Full suite | PROJECT.md, REQUIREMENTS.md, ROADMAP.md, STATE.md, config.json, plus research/, quick/ |
| config.json | granularity: fine, branching: phase, nyquist_validation: true |

### GSD v1 Infrastructure (to remove)
| Location | Contents |
|----------|----------|
| ~/.ccs/instances/cuenta1/get-shit-done/workflows/ | 34 .md workflow files |
| ~/.ccs/instances/cuenta1/get-shit-done/templates/ | 25+ template files |
| ~/.ccs/instances/cuenta1/get-shit-done/references/ | 13 reference docs |
| ~/.ccs/instances/cuenta1/get-shit-done/bin/ | gsd-tools.cjs + lib/ (11 modules) |
| ~/.ccs/instances/cuenta1/get-shit-done/VERSION | 1.22.4 |

## Sources

### Primary (HIGH confidence)
- [GSD-2 GitHub README](https://github.com/gsd-build/gsd-2) -- installation, commands, preferences.md, migration, directory structure
- [GSD-2 Releases](https://github.com/gsd-build/gsd-2/releases) -- v2.22.0 latest (2026-03-16)
- Local filesystem inspection -- .planning/ directory contents across all 4 projects

### Secondary (MEDIUM confidence)
- [GSD-2 Medium article](https://medium.com/@richardhightower/one-codebase-three-runtimes-how-gsd-targets-claude-code-opencode-and-gemini-cli-29c98cfe96c6) -- multi-runtime architecture context
- [get-shit-done-cc npm](https://www.npmjs.com/package/get-shit-done-cc) -- GSD v1 package (1.22.4)
- CONTEXT.md decisions -- user-specified migration parameters and constraints

### Tertiary (LOW confidence)
- DawSync track mapping strategy -- recommended but unverified against actual `/gsd migrate` output
- Windows worktree behavior -- not explicitly covered in GSD-2 docs
- Decimal phase depth support (X.Y.Z) -- stated as supported but not tested

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- npm package name, installation, and commands verified via GitHub README
- Architecture: MEDIUM -- directory structure and hierarchy model well-documented; track mapping is recommendation
- Pitfalls: MEDIUM -- based on ecosystem analysis and documented edge cases; Windows-specific items are LOW
- Migration mechanics: MEDIUM -- preview/confirm flow documented, but actual behavior with complex decimal phases untested

**Research date:** 2026-03-16
**Valid until:** 2026-04-16 (30 days -- GSD-2 releasing fast but migration mechanics stable)
