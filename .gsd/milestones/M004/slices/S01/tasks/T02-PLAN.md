# T02: 13-audit-validate 02

**Slice:** S01 — **Milestone:** M004

## Description

Audit all DawSync markdown files (~291 excluding worktrees and .planning/) -- classify each as ACTIVE (still relevant), SUPERSEDED (content exists elsewhere), or UNIQUE (irreplaceable context). Produce a consolidation manifest with per-file layer classification, AI-readiness scores, and action recommendations.

Purpose: DawSync is the main project with the largest documentation corpus. The audit provides evidence for Phase 14's consolidation work (STRUCT-03) and identifies patterns that should be promoted to L0/L1 or flagged as L2>L1 overrides.

Output: `audit-manifest-dawsync.json` -- machine-readable per-file manifest covering docs/, .claude/agents, .claude/commands, .agents/skills, .androidcommondoc/, agent-memory, and root markdown files.

## Must-Haves

- [ ] "Every DawSync markdown file (~291 excluding worktrees and .planning/) is classified as ACTIVE, SUPERSEDED, or UNIQUE"
- [ ] "Per-file output includes current location, recommended layer (L0/L1/L2), AI-readiness score, action needed"
- [ ] "Domain-specific knowledge (DAW capture, VST3, session management) classified as L2"
- [ ] "Generic patterns flagged for L0/L1 promotion"
- [ ] "DawSync patterns that should override shared-kmp-libs flagged explicitly as L2>L1 overrides"
- [ ] "Agents and commands get full layer classification with L0 promotion flags"
- [ ] "Worktree copies excluded from audit to avoid double-counting"

## Files

- `.planning/phases/13-audit-validate/audit-manifest-dawsync.json`
