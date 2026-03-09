# Phase 4: Audit Tech Debt Cleanup - Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Close all integration wiring gaps from the v1.0 milestone audit (INT-01 through INT-04), fix the broken self-enforcement flow, consolidate duplicate write paths, correct version labels, update ROADMAP.md Plan 03-04 checkbox, and backfill `requirements_completed` frontmatter metadata across all 11 plan SUMMARY files.

Gap closure: INT-01, INT-02, INT-03, INT-04 from v1.0-MILESTONE-AUDIT.md + admin cleanup.

</domain>

<decisions>
## Implementation Decisions

### Duplicate write path consolidation (INT-03)
- `setup-toolkit.sh` owns the `.github/copilot-instructions.md` write — it copies `copilot-instructions-generated.md` (the adapter output, canonical per Phase 1)
- Remove copilot-instructions.md handling entirely from `install-copilot-prompts.sh` — that script keeps handling individual `.prompt.md` files only
- Single write path eliminates the "second write silently wins" problem

### Hook self-registration (INT-01)
- Add hook entries to AndroidCommonDoc's own `.claude/settings.json` so contributors get real-time Detekt enforcement
- Hook scripts already exist at `.claude/hooks/` (detekt-post-write.sh, detekt-pre-commit.sh)
- Exact hook configuration (PostToolUse + PreToolUse, or PostToolUse only) at Claude's discretion — determine what makes sense for a toolkit repo vs app repo

### Template-sync-validator fix (INT-02)
- Change Step 4 in `.claude/agents/template-sync-validator.md` to reference `copilot-instructions-generated.md` instead of `copilot-instructions.md`
- Aligns validator with Phase 1's adapter pattern — generated output is the canonical artifact

### Version label fix (INT-04)
- Change `gradle-patterns.md` Library Versions from "Compose Multiplatform 1.10.0" to "Compose Gradle Plugin 1.10.0"
- Must also verify `check-doc-freshness.sh` no longer flags it as [STALE] after fix

### ROADMAP admin
- Check Plan 03-04 checkbox in ROADMAP.md (already executed and verified)
- Update Phase 3 status to Complete if not already reflected

### SUMMARY metadata backfill
- Populate `requirements_completed` field across all 11 SUMMARY.md files
- Format: YAML list of requirement IDs only — `[PTRN-01, PTRN-02]` — compact and machine-parseable
- Mapping derived from VERIFICATION.md evidence and REQUIREMENTS.md traceability table
- Descriptions live in REQUIREMENTS.md — no duplication in frontmatter

### Claude's Discretion
- Hook configuration scope for AndroidCommonDoc (PostToolUse + PreToolUse, or PostToolUse only)
- Requirement-to-plan mapping for SUMMARY backfill (derive from VERIFICATION.md)
- Order of fixes within the plan (dependency-aware sequencing)

</decisions>

<specifics>
## Specific Ideas

- All 9 tech debt items from v1.0-MILESTONE-AUDIT.md must be addressed — the 4 INT findings plus 5 admin items
- Success criteria are 6 binary pass/fail conditions already defined in ROADMAP.md — implementation must satisfy all 6
- Phase 1 adapter pattern is the guiding principle for INT-02 and INT-03 — generated files are canonical, static templates are inputs

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `setup/install-hooks.sh`: Complete python3 JSON merge logic for settings.json — same pattern can self-register hooks in AndroidCommonDoc's own settings
- `.claude/hooks/detekt-post-write.sh` + `detekt-pre-commit.sh`: Hook scripts already exist at correct paths
- `v1.0-MILESTONE-AUDIT.md`: Complete evidence table with exact file paths and line references for every finding

### Established Patterns
- python3 for JSON manipulation (Phase 1 adapter, Phase 3 hooks) — use for settings.json merge
- Marker comment idempotency (Phase 3) — check before insert for build file modifications
- SUMMARY frontmatter uses YAML format with phase, plan, subsystem, tags, requires, provides, affects fields

### Integration Points
- `.claude/settings.json`: Currently has only `permissions.deny` block — hooks section will be added
- `.claude/agents/template-sync-validator.md`: Step 4 text replacement target
- `setup/install-copilot-prompts.sh`: Remove copilot-instructions.md section (~lines 132-232)
- `docs/gradle-patterns.md`: Library Versions header field — text replacement
- All 11 `*-SUMMARY.md` files in `.planning/phases/*/` — frontmatter update

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-audit-tech-debt-cleanup*
*Context gathered: 2026-03-13*
