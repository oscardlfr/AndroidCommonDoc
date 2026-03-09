# Phase 5: Tech Debt Foundation - Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Clean v1.0 debt so quality gates, setup scripts, and install pipeline are correct and trustworthy. No false noise, no silent failures, no drift between orchestrator and individual agents. Covers DEBT-01 through DEBT-04.

</domain>

<decisions>
## Implementation Decisions

### Env var enforcement (DEBT-01)
- Fail hard (exit 1) when ANDROID_COMMON_DOC is missing — no partial work, no warn-and-continue
- Guard only in consumer-facing setup/install scripts: setup-toolkit.sh, install-copilot-prompts.sh, install-claude-skills.sh, install-hooks.sh
- Internal validation scripts (scripts/sh/*.sh, scripts/ps1/*.ps1) resolve paths from SCRIPT_DIR already — no guard needed
- Error message: show the error + exact `export` command to fix it — no README links
- Also validate the path exists (directory check) — catch typos and stale paths with a distinct error message

### Copilot standalone delivery (DEBT-02)
- install-copilot-prompts.sh delivers everything: .prompt.md files, .instructions.md files, AND copilot-instructions-generated.md
- If copilot-instructions-generated.md doesn't exist: warn and skip (suggest running the adapter first), don't fail the whole script
- setup-toolkit.sh Step 4 delegation and script naming: Claude's discretion on the cleanest enterprise approach

### Orchestrator delegation (DEBT-03)
- Orchestrator references individual agent .md files as source of truth — reads them at runtime, no inlined logic
- If an individual agent is updated, orchestrator picks it up automatically — eliminates drift
- Keep unified report format — delegation is internal, users see the same consolidated output
- Individual agents remain invocable on their own for debugging specific gates
- Token Cost Summary section stays inline in orchestrator (informational, only useful in unified report)

### Orphan cleanup (DEBT-04)
- Delete the 5 validate-phase01-*.sh scripts from scripts/sh/
- Leave archived v1.0 planning docs untouched — don't rewrite history
- Verify zero active references (non-archived) before deleting
- Audit both platforms: check scripts/ps1/ for orphaned validate-phase01-*.ps1 too

### Claude's Discretion
- setup-toolkit.sh Step 4: whether to delegate fully to install-copilot-prompts.sh or keep inline with reduced duplication
- install-copilot-prompts.sh naming: keep current name or rename to install-copilot.sh based on reference impact
- Env var guard implementation pattern (inline guard function vs shared snippet)
- Orchestrator's exact mechanism for sourcing individual agent logic

</decisions>

<specifics>
## Specific Ideas

- User wants "the cleanest, most professional, solid, clean enterprise approach" — favor clarity, DRY principles, and single-source-of-truth patterns
- Partial success over total failure: scripts should do what they can and clearly report what was skipped (copilot-instructions-generated.md pattern)

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `setup-toolkit.sh`: Unified setup script with step-based architecture (Steps 1-6), already has pattern for calling sub-installers
- 4 individual quality gate agents: `script-parity-validator.md`, `skill-script-alignment.md`, `template-sync-validator.md`, `doc-code-drift-detector.md`
- `copilot-instructions-generated.md`: Already exists in setup/copilot-templates/ — just needs delivery path added

### Established Patterns
- All install scripts share: `set -euo pipefail`, colored logging (log_info/ok/warn/err), --dry-run/--force/--projects flags, summary report at end
- PS1/SH parity: every user-facing .sh script should have a .ps1 counterpart (the 5 orphaned scripts notably lack .ps1 pairs)
- setup-toolkit.sh delegates to sub-scripts via `bash "$SCRIPT_DIR/install-*.sh"` pattern with argument forwarding

### Integration Points
- `setup-toolkit.sh` Step 4 calls `install-copilot-prompts.sh` — this is where delegation needs updating
- `quality-gate-orchestrator.md` needs to reference individual agents in `.claude/agents/`
- ANDROID_COMMON_DOC referenced in 91 files but guards only needed in 4 consumer-facing install scripts

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-tech-debt-foundation*
*Context gathered: 2026-03-13*
