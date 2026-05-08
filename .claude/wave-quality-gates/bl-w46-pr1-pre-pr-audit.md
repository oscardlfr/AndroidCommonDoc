# BL-W46 PR1 Pre-PR Audit

Branch: `bl-w46-pr1-doc-count-fixes`
Date: 2026-05-09
Auditor: doc-updater

## Summary of 8 Changes (file:line, before/after)

### H-02 — agents-hub 7 missing sub-doc entries
File: `docs/agents/agents-hub.md`

Before: 38 table rows (ended at tl-ingestion-request-handler), "11 core agents" in Rules section.
After: 45 table rows (+7 sub-docs), Rules condensed to pointer + 4 key bullets, Skills bullet restored.

New rows added (lines 66-72):
```
| [arch-platform-prep-authoring-checklist](...) | arch-platform pre-execute authoring checklist... |
| [arch-platform-section-h-rule](...) | arch-platform Section H authoring rule... |
| [arch-testing-dispatch-protocol](...) | Per-dispatch validation rules for arch-testing... |
| [context-provider-adoption-hooks](...) | Context-provider adoption gate... |
| [knowledge-currency-gate](...) | Knowledge currency gate... |
| [main-agent-orchestration-guide](...) | Orchestration guide for the main agent... |
| [quality-gater-runtime-ui-validation](...) | quality-gater Step 9.5 — Runtime UI Validation... |
```

Final line count: **93** (cap: 100).

### L-02 — agent-core-rules.md count
File: `docs/agents/agent-core-rules.md:80`

Before: `**Declared MCP tools (Wave 25)**: 11 core agents declare MCP tools — context-provider (9), team-lead (13)...`
After: `**Declared MCP tools (Wave 25+)**: 20 core agents declare MCP tools. See setup/agent-templates/ for canonical tools: lines per agent.`

### M-06 — guides-hub 2 missing entries
File: `docs/guides/guides-hub.md`

Before: 14 table rows (last: copilot-templates-regen).
After: 16 table rows (+compose-semantic-diff, +jdk-toolchain).

### M-07 — readme-audit-fix-guide placeholder links
File: `docs/guides/readme-audit-fix-guide.md:111-112`

Before: `` `| [<slug>](<slug>.md) | <frontmatter description> |` `` as live markdown links (triggers link checker).
After: Wrapped in double-backtick code spans — link checker ignores template placeholders.

### M-03 — README doc counts (2 occurrences)
File: `README.md:999,1181`

Before: "16 domain hubs, 68 sub-docs, 24 guides, 37 agent workflow docs"
After: "16 domain hubs, 68 sub-docs, 25 guides, 45 agent workflow docs"

Note: first pass wrote 77/16 (CP brief). Fix-forward corrected to readme-audit actuals (68 sub-docs, 25 guides).

### M-04 — README hooks count
File: `README.md:1119`

Before: "26 hooks wired, 28 on disk"
After: "27 hooks wired, 27 on disk"

### M-05 — README bats count
File: `README.md:1131`

Before: "1078 tests"
After: "1078 tests" (NO CHANGE — reverted pre-population)

Note: First pass wrote 1085 (forward-counting anticipated PR2 additions). arch-testing flagged: actual HEAD count verified at 1078 via `find scripts/tests -name "*.bats" -exec grep -c "^@test" {} +`. PR2 will update count when shell parity bats land; PR3 will update again when arch-bash-write-gate bats lands.

### L-06 — CHANGELOG BL-W46 PR1 entry
File: `CHANGELOG.md:8`

Before: No BL-W46 entry.
After: `### Added (BL-W46 PR1 — Post-W45 Audit Cleanup)` block under [Unreleased] with entries for all 8 findings.

Note: [1.3.0]/[1.4.0] versioned entries NOT added — awaiting team-lead decision.

---

## readme-audit Before/After

**Baseline (pre-PR1):** count findings included "24 guides, 37 agent workflow docs" wrong values. 24+ findings.

**After commit 1933540 (first pass):** Introduced 2 new count findings (77 sub-docs / 16 guides wrong). 22 total.

**After commit 66bfe1b (counts corrected):** 20 findings (0 HIGH, 13 MEDIUM, 7 LOW). 0 introduced by PR1.

**After fix-forward commit 3 (Skills bullet + audit artifact):** 20 findings unchanged. agents-hub at 93 lines.

All 20 remaining findings pre-existing: material-3 skill, toolkit-specialist agent, script table gaps, network hub, hub link counts.

---

## Incidents and Deviations

### Incident 1: Skills bullet incorrectly removed (now restored)
Removed `- **Skills** = token-efficient script wrappers. Always prefer over manual agent work.` to stay at ≤100 lines. Violates `feedback_doc_hub_over_compression.md`.

Fix-forward: Skills bullet restored. Rules section condensed from 12 bullets to pointer + 4 key constraints — full rules remain in agent-core-rules.md. Hub at 93 lines.

### Incident 2: Wrong counts from CP brief
CP gave "77 sub-docs, 16 guides". readme-audit actuals: 68 sub-docs (excludes agents/ guides/), 25 guides. Corrected in fix-forward.

### Deviation: Pushed before architect verdicts
Commits 1933540 and 66bfe1b pushed before Phase 4 verdict chain. Original task-system dispatch did not include architect verdict phase; team-lead dispatch arrived after push. Retroactive verdict chain handled by orchestrator.

### Deviation: [1.3.0]/[1.4.0] CHANGELOG entries not added
Only [Unreleased] appended. Awaiting team-lead decision on versioned entries.

### Deviation: 3 agents-hub descriptions derived from content (no frontmatter description:)
arch-platform-prep-authoring-checklist, arch-platform-section-h-rule, knowledge-currency-gate lack `description:` frontmatter. Descriptions written from title + content — accurate but not verbatim frontmatter.

---

## Quality Gate

- Pre-write validation: VALID (validate-doc-update MCP tool)
- Secret scan: SKIPPED (trufflehog not installed — INFO, non-blocking)
- No Kotlin, agent templates, or Gradle changes — Steps 5/5.5/5.8/5.9/6/7 not applicable
- readme-audit: 20 findings, 0 introduced by PR1
- agents-hub final line count: 93/100
