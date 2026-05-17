---
scope: [workflow, ai-agents, architects, dispatch]
sources: [androidcommondoc]
targets: [all]
slug: arch-platform-prep-authoring-checklist
category: agents
---

# Pre-Execute Authoring Checklist (arch-platform)

Run this checklist before emitting `APPROVED-PREP` on any verdict. Automation: `scripts/sh/verdict-pre-execute-check.sh <verdict-path>`.

## Check 1 — Cross-File Pin Scan (FIND-12)

When bumping `template_version` in Section G, enumerate ALL references to the old version across related files.

**Step 1a — Version string grep:**

Run: `rtk grep -rn "<old_version>" mcp-server/tests/ setup/agent-templates/ MIGRATIONS.json`

**Step 1b — Section headers, anchor links, and pointer paths (FIND-12 extension):**

Version-only grep misses non-version references that break when content is extracted or restructured. Also grep for:

```bash
# Section headers that reference the agent or section being changed
rtk grep -rn "## <SectionName>\|### <SectionName>" mcp-server/tests/ scripts/ docs/

# Anchor links / slug references (e.g., #manifest-rehash-discipline)
rtk grep -rn "#<anchor-slug>" mcp-server/tests/ scripts/ docs/

# Pointer paths removed by extraction (e.g., "setup/agent-templates/doc-updater.md#SectionName")
rtk grep -rn "<template-filename>#" mcp-server/tests/ scripts/ docs/
```

Every hit (version OR non-version) must be listed in Section H of the verdict. Unlisted hits = FAIL.

Reference: `memory/feedback_cross_file_scan_non_version_strings.md`

Automation function: `check_cross_file_pins` in `scripts/sh/verdict-pre-execute-check.sh`.

## Check 2 — Commitlint Scope Validation (FIND-16, FIND-19 recurring)

The `(scope)` in the planned commit subject MUST exist in the canonical scope list from `.commitlintrc.json` → `scopes` array (single source of truth post-F4). Do NOT use `.github/workflows/l0-ci.yml:22` as the reference — it is now downstream of `.commitlintrc.json`.

Read `.commitlintrc.json` and extract the `scopes` array directly. Do NOT rely on the hardcoded list below (stale risk — `.commitlintrc.json` always wins).

Current scopes (as of BL-W47 — verify against `.commitlintrc.json`): `core,data,ui,feature,ci,deps,release,docs,detekt,mcp,skills,scripts,agents,archive,di,guides,tests,tools`

Extract the scope from your planned commit subject and assert membership. Invalid scope = FAIL.

Automation function: `check_commit_scope`.

**Canonical types/scopes reference**: `docs/agents/commit-spec-validation.md` (cheat-sheet for both type and scope whitelists).

## Check 3 — Section H Gitignore Check (FIND-17 follow-on)

For each path listed in the Section H atomic-file list, run:

```
git check-ignore <path>
```

Any path that IS gitignored = hard FAIL. Gitignored files cannot be committed and break the atomic list.

Automation function: `check_section_h_gitignored`.

## Check 4 — New-Doc Frontmatter Completeness (FIND-09)

When Section H creates a new `.md` documentation file, the verdict MUST specify all 5 required frontmatter fields:

- `scope`
- `sources`
- `targets`
- `category`
- `slug`

Missing any field = FAIL. Partial frontmatter blocks doc structure validation tools.

Automation function: `check_new_doc_frontmatter`.

## Check 5 — Amendment Enumeration (FIND-11)

Before declaring `APPROVED-PREP`, list all pending amendments with an explicit count.

The verdict MUST contain a literal line matching: `Pending amendments: <N>`

Where `<N>` is a non-negative integer. Missing this line = FAIL (EXECUTE agents cannot echo a count that was not declared).

Automation function: `check_amendment_count`.

## Check 6 — Doc-Updater Cap Escalation (FIND-08)

When Section H edits an agent template file (any file under `setup/agent-templates/` or `.claude/agents/`), Section H MUST include:

- `pre_edit_lines:` — actual line count before edit
- `post_edit_estimate:` — projected line count after edit

If `post_edit_estimate >= cap - 10` (i.e., ≥391 for a 400-line cap), MUST also include:

- `requires_extraction: true`

Missing these fields when editing a capped template = FAIL.

Automation function: `check_cap_escalation`.

---

## Running All Checks

```bash
scripts/sh/verdict-pre-execute-check.sh .planning/wave-bl-wN/arch-platform-verdict.md
# exit 0 = all checks pass
# exit 1 = one or more checks failed (failures printed to stdout)
```

Referenced from: `setup/agent-templates/arch-platform.md` Section "Pre-Execute Authoring Checklist"

## Available Skills

- `architecture` — Automated pattern validation and dependency analysis
- `software-architecture` — ADR generation and architecture review
- `api-patterns` — REST/GraphQL API design decisions

## Done Criteria

You are NOT done until:
1. MCP tools ran and you have structured output
2. Run `/test <module>` to verify compilation + tests pass. Run `/validate-patterns` for Detekt compliance — do NOT send APPROVE with compile or lint failures
3. Before approving refactors: grep call sites, expect/actual pairs, and test references for every renamed/changed symbol
4. Every violation was either fixed or escalated with justification
5. Cross-architect verification passed after your fixes
6. Re-verification with MCP tools shows clean results
**No "already fixed" claims without MCP tool output as evidence.**
