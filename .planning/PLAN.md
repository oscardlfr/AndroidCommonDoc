# Execution Plan: L0 Template Bugs + L1/L2 Propagation

> Generated: 2026-04-05
> Status: READY FOR EXECUTION
> Scope: Fix 10 L0 agent-template bugs, sync `.claude/agents/` copies, surgically propagate to L1 (shared-kmp-libs) and L2 (DawSync) preserving project-specific content.
> Supersedes: prior PLAN.md (dated 2026-04-04 — backlog has been worked)

---

## Context Summary

**Audited files (verified 2026-04-05):**

| File | Version | Tools | Size |
|---|---|---|---|
| L0 `setup/agent-templates/project-manager.md` | 5.0.0 | Read, Grep, Glob, Bash, Agent, TeamCreate, TeamDelete, SendMessage, TaskCreate, TaskList | 24.1K |
| L0 `setup/agent-templates/arch-testing.md` | 1.5.0 | Read, Grep, Glob, Bash, SendMessage | 13.0K |
| L0 `setup/agent-templates/arch-platform.md` | 1.4.0 | Read, Grep, Glob, Bash, SendMessage | 13.3K |
| L0 `setup/agent-templates/arch-integration.md` | 1.4.0 | Read, Grep, Glob, Bash, SendMessage | 12.2K |
| L0 `setup/agent-templates/quality-gater.md` | 2.2.0 | Read, Grep, Glob, Bash, SendMessage | 9.8K |

**L0 template-to-copy drift check:** `.claude/agents/{arch-*,quality-gater,project-manager}.md` are byte-identical to `setup/agent-templates/` sources (verified via `diff -q`). No drift currently.

**L1 (shared-kmp-libs) drift:**
- arch-testing: v1.4.0 (L0 is 1.5.0) — **stale**
- arch-platform: v1.3.0 (L0 is 1.4.0) — **stale**
- arch-integration: v1.3.0 (L0 is 1.4.0) — **stale**
- Has `l0_source`/`l0_hash`/`l0_synced` frontmatter (sync-l0 metadata)
- L1 carries **same Edit-directly bugs** as L0 plus older content

**L2 (DawSync) drift:**
- arch-testing: v1.5.0 — **matches L0 current**
- arch-platform: v1.4.0 — **matches L0 current**
- arch-integration: v1.4.0 — **matches L0 current**
- **Has project-specific guardian calls that MUST be preserved** (see per-file mapping below)
- Carries same Edit-directly bugs as L0 (same version, same bug)

---

## Bug Inventory (verified with file:line evidence)

### BUG 1 — quality-gater missing from session startup
**Status: ALREADY FIXED in L0 v5.0.0**
- Evidence: `setup/agent-templates/project-manager.md:65` already includes quality-gater in the Agent() sequence.
- Evidence: `setup/agent-templates/project-manager.md:106` already lists quality-gater as pre-flight checkbox #7.
- Evidence: `setup/agent-templates/project-manager.md:68` says "These **six** are **session team peers**".
- **Action:** Verify L1/L2 copies have this. L2 matches L0 ✓. L1 needs sync.

### BUG 2 — Pattern chain text-only, no mechanical enforcement
**Status: PARTIALLY ENFORCED — needs stronger during-wave language**
- Evidence: Pattern chain described in `arch-testing.md:68-72`, `arch-platform.md:76-80`, `arch-integration.md:64-68` (each architect has it).
- **Gap:** PRE-TASK Protocol (`arch-testing.md:38`, `arch-platform.md:37`, `arch-integration.md:37`) only requires context-provider consult "Before investigating or speccing work for a dev" — NOT during the wave.
- **Gap:** No language enforcing re-consult during wave when architect makes pattern decisions.
- **Action:** Add DURING-WAVE Protocol section to all 3 architects.

### BUG 3 — Scope validation gate missing (off-scope dispatch)
**Status: CONFIRMED MISSING**
- Evidence: Grep for `off-scope|scope validation|PLAN\.md|plan scope` in arch templates returns ZERO hits.
- **Action:** Add Scope Validation Gate section to all 3 architects requiring them to verify task is in `.planning/PLAN.md` scope before dispatching to dev.

### BUG 4 — Pre-flight checklist not blocking (weak language)
**Status: CLOSE — needs stronger failure-mode language**
- Evidence: `project-manager.md:114` says "If ANY checkbox is NO → STOP. Do not respond to user tasks. Do not plan. Do not use Agent(). Fix the failing checkbox first, then re-verify ALL from the top."
- **Gap:** Doesn't explicitly say "RESPOND ONLY with 'Setting up session'". Also the hard-gate text at line 91 says it but is separated from the checklist.
- **Action:** Merge the hard-gate language with the pre-flight checklist consequence. Add explicit response template.

### BUG 5 — Architects bypass dev dispatch; Write/Edit tools
**Status: MIXED — tools already correct, TEXT contradicts tools**
- Evidence: All 3 architects have `tools: Read, Grep, Glob, Bash, SendMessage` (no Write/Edit). ✓
- **Contradictory text (CONFIRMED bugs):**
  - `arch-testing.md:86` — "Edit directly — max 1-2 lines" (architect has no Edit tool)
  - `arch-testing.md:125` — "fix directly, else escalate"
  - `arch-testing.md:146` — "Trivial fixes (import, assertion) you may fix directly"
  - `arch-platform.md:94` — "Edit directly — max 1-2 lines"
  - `arch-platform.md:102` — "Edit a single import line — this is the ONLY kind of direct fix allowed"
  - `arch-integration.md:82` — "Edit directly — max 1-2 lines"
  - `arch-integration.md:156` — "Trivial fixes (import, annotation, DI registration) you may fix directly"
- **Action:** Rewrite the trivial/non-trivial tables: trivial fixes ALWAYS go to dev. No exceptions. Architects have NO file-modify capability — even "Edit directly" is impossible.

### BUG 6 — Team health monitoring absent
**Status: PARTIAL — unresponsive detection exists, integrity check missing**
- Evidence: `project-manager.md:193` has "If architect unresponsive → SendMessage, then re-spawn with SAME name".
- **Gap:** No post-wave team integrity check. No instruction to verify all 6+4 peers still alive.
- **Action:** Add "Post-Wave Team Integrity Check" section to PM after each architect verdict collection.

### BUG 7 — Weak language (should→MUST drift)
**Status: MOSTLY CLEAN — 3 non-critical "should"s found**
- Evidence: Grep for `\bshould\b` in arch-*.md returns:
  - `arch-platform.md:52` — "what should pass" (non-critical, descriptive)
  - `arch-platform.md:55` — "The dev should be able to" (non-critical, goal statement)
  - `arch-platform.md:63` — "this should be verified" (non-critical, example quote)
- **Action:** These 3 are low-priority. Audit other templates for critical-section "should" (deferred to separate task if time permits). Primary weak-language bugs were fixed in prior PRs.

### BUG 8 — Architect exact fixes (prose instead of file:line:old:new)
**Status: CONFIRMED MISSING**
- Evidence: Grep for `file:line|exact fix|old string|new string` in arch-*.md returns ZERO hits.
- Evidence: Proactive Dev Support sections (e.g., `arch-platform.md:45-55`) mention "file paths + line numbers" but not the `old→new` exact-string requirement.
- **Action:** Add Exact Fix Format section requiring `file:line:old:new` when dispatching fixes.

### BUG 9 — Selective dev spawning not enforced
**Status: ALREADY FIXED in L0 v5.0.0 — needs L1 backport**
- Evidence: `project-manager.md:80-86` ("Selective spawning (MANDATORY)") and `project-manager.md:108-111` (checkboxes 9-12 with SKIP option).
- **Gap:** The selective-spawn logic says "skip if zero tasks" but doesn't FORCE pre-spawn scope evaluation.
- **Action:** Strengthen `project-manager.md:80-86` to require explicit "evaluate scope FIRST" output BEFORE any core-dev Agent() call.

### BUG 10 — Architect context-during-wave (consult only at start)
**Status: CONFIRMED — PRE-TASK only, no MID-TASK**
- Evidence: `arch-testing.md:38`, `arch-platform.md:37`, `arch-integration.md:37` all say "Before investigating or speccing work for a dev" (pre-task only).
- Evidence: `arch-testing.md:44`, `arch-platform.md:43`, `arch-integration.md:43` all say "Skip only if context-provider already answered this exact query earlier in the same session" — implies consult once at start.
- **Action:** Add DURING-WAVE Protocol requiring architect to SendMessage context-provider whenever encountering a pattern decision (not just once at wave start).

---

## Wave 1: Fix L0 `setup/agent-templates/`

**Objective:** Apply all 10 bug fixes to the 5 L0 source templates.
**Files touched:** 5 (`project-manager.md`, `arch-testing.md`, `arch-platform.md`, `arch-integration.md`, `quality-gater.md`).
**Version bumps:** project-manager 5.0.0 → 5.1.0; arch-testing 1.5.0 → 1.6.0; arch-platform 1.4.0 → 1.5.0; arch-integration 1.4.0 → 1.5.0; quality-gater unchanged.
**Owner:** dev (any); fixes are template edits, no code.

### W1.1 — arch-testing.md fixes

| # | File:Line | old_string | new_string |
|---|---|---|---|
| 1 | `arch-testing.md:9` | `template_version: "1.5.0"` | `template_version: "1.6.0"` |
| 2 | `arch-testing.md:85-87` (TRIVIAL table row) | `\| **TRIVIAL (you fix)** \| Add missing import, fix typo in annotation, add `@Suppress` \| Edit directly — max 1-2 lines \|` | `\| **NEVER you fix** \| Add missing import, fix typo in annotation, add @Suppress \| SendMessage to PM for dev — you have NO Edit tool \|` |
| 3 | `arch-testing.md:125` | `- If any test fails: analyze cause → if fix is trivial (missing import, wrong assertion) → fix directly, else escalate` | `- If any test fails: analyze cause → SendMessage to PM requesting test-specialist. You NEVER fix directly (no Edit tool).` |
| 4 | `arch-testing.md:146` | `**Non-trivial fixes go through PM → dev. Trivial fixes (import, assertion) you may fix directly.**` | `**ALL fixes go through PM → dev. You have NO Write/Edit tool. "Trivial" does not exist for architects.**` |
| 5 | After `arch-testing.md:44` (PRE-TASK Protocol section end) | (insert new section) | New section **DURING-WAVE Protocol (MANDATORY)**: SendMessage context-provider whenever encountering ANY pattern decision during the wave — not just at start. Never rely on a single pre-task consult for the full wave. |
| 6 | After `arch-testing.md:44` (before DURING-WAVE) | (insert new section) | New section **Scope Validation Gate (MANDATORY)**: Before dispatching ANY dev task, Read `.planning/PLAN.md` and verify the task is in active scope. Off-scope = DO NOT dispatch. SendMessage to project-manager with summary="OFF-SCOPE REQUEST" and evidence. |
| 7 | After `arch-testing.md:77` (Requesting extra devs section) | (insert new section) | New section **Exact Fix Format (MANDATORY)**: When requesting a fix via SendMessage, ALWAYS provide: file path, line number, old_string, new_string. NEVER prose descriptions. Template: "file: `{path}`, line `{N}`, replace `{old}` with `{new}`." |

### W1.2 — arch-platform.md fixes

| # | File:Line | old_string | new_string |
|---|---|---|---|
| 1 | `arch-platform.md:9` | `template_version: "1.4.0"` | `template_version: "1.5.0"` |
| 2 | `arch-platform.md:93-95` (TRIVIAL table row) | `\| **TRIVIAL (you fix)** \| Add missing import, fix typo in annotation, add `@Suppress` \| Edit directly — max 1-2 lines \|` | `\| **NEVER you fix** \| Add missing import, fix typo in annotation, add @Suppress \| SendMessage to PM for dev — you have NO Edit tool \|` |
| 3 | `arch-platform.md:97-108` (CORRECT/WRONG block) | ```// CORRECT: fix trivial (single import)\n// Edit a single import line — this is the ONLY kind of direct fix allowed``` | ```// NEVER: architects have Read/Grep/Glob/Bash/SendMessage only\n// NEVER: architects edit ANY .kt/.ts/.xml/.kts file``` (keep the other CORRECT/WRONG lines) |
| 4 | After `arch-platform.md:43` (PRE-TASK Protocol section end) | (insert new section) | New section **DURING-WAVE Protocol (MANDATORY)**: Same as arch-testing W1.1 #5. |
| 5 | After `arch-platform.md:43` (before DURING-WAVE) | (insert new section) | New section **Scope Validation Gate (MANDATORY)**: Same as arch-testing W1.1 #6. |
| 6 | After `arch-platform.md:85` (Requesting extra devs section) | (insert new section) | New section **Exact Fix Format (MANDATORY)**: Same as arch-testing W1.1 #7. |

### W1.3 — arch-integration.md fixes

| # | File:Line | old_string | new_string |
|---|---|---|---|
| 1 | `arch-integration.md:9` | `template_version: "1.4.0"` | `template_version: "1.5.0"` |
| 2 | `arch-integration.md:81-83` (TRIVIAL table row) | `\| **TRIVIAL (you fix)** \| Add missing import, fix typo in annotation, add `@Suppress` \| Edit directly — max 1-2 lines \|` | `\| **NEVER you fix** \| Add missing import, fix typo in annotation, add @Suppress \| SendMessage to PM for dev — you have NO Edit tool \|` |
| 3 | `arch-integration.md:156` | `**Non-trivial fixes go through PM → dev. Trivial fixes (import, annotation, DI registration) you may fix directly.**` | `**ALL fixes go through PM → dev. You have NO Write/Edit tool. "Trivial" does not exist for architects.**` |
| 4 | After `arch-integration.md:43` (PRE-TASK Protocol section end) | (insert new section) | New section **DURING-WAVE Protocol (MANDATORY)**: Same as arch-testing W1.1 #5. |
| 5 | After `arch-integration.md:43` (before DURING-WAVE) | (insert new section) | New section **Scope Validation Gate (MANDATORY)**: Same as arch-testing W1.1 #6. |
| 6 | After `arch-integration.md:73` (Requesting extra devs section) | (insert new section) | New section **Exact Fix Format (MANDATORY)**: Same as arch-testing W1.1 #7. |

### W1.4 — project-manager.md fixes

| # | File:Line | old_string | new_string |
|---|---|---|---|
| 1 | `project-manager.md:9` | `template_version: "5.0.0"` | `template_version: "5.1.0"` |
| 2 | `project-manager.md:80-86` (Selective spawning MANDATORY) | Current text starting "**Selective spawning (MANDATORY)**: Before spawning core devs, evaluate the sprint scope:..." | Strengthened version: "**Selective spawning (MANDATORY — evaluate BEFORE any Agent() call)**: You MUST produce a scope evaluation table BEFORE calling Agent() to spawn any core dev. Format: `\| Layer \| Tasks in plan \| Spawn? \|`. Skip specialists with zero tasks. Do NOT default to spawning all 4." |
| 3 | `project-manager.md:90-91` (hard gate paragraph) | `**⛔ HARD GATE — Session setup is mandatory before anything else:**\nIf you receive a user task before creating the session team, respond ONLY with: _"Setting up session — creating session team first."_ Then create the session team, add all 6 peers, and complete the pre-flight checklist. Do NOT plan, do NOT use Agent() for work, do NOT respond to the task until all 6 are added to the session team.` | `**⛔ HARD GATE — Session setup blocks ALL work:**\nIf you receive a user task before creating the session team: RESPOND ONLY with "Setting up session — creating session team first." DO NOT plan. DO NOT spawn agents. DO NOT respond to the user task. Complete TeamCreate → all 6 peers → pre-flight checklist FIRST. If ANY pre-flight checkbox (1-8) is NO → same response, same restriction, fix it before anything else.` |
| 4 | After `project-manager.md:303` (Architect Verification Gate section end, diagram) | (insert new subsection) | New subsection **Post-Wave Team Integrity Check (MANDATORY)**: After collecting verdicts from all architects, verify team integrity: (a) Bash read team config file, (b) confirm context-provider, doc-updater, arch-testing, arch-platform, arch-integration, quality-gater, and all core devs still alive, (c) if any peer missing, IMMEDIATELY re-spawn with SAME name AND SAME team_name (`Agent(name="X", team_name="session-{slug}", ...)`). NEVER append "-v2" or skip the check. |

### W1.5 — quality-gater.md

No changes needed this wave. quality-gater v2.2.0 is current and consistent.

### W1.6 — Verification

- Bash: `cd C:/Users/34645/AndroidStudioProjects/AndroidCommonDoc && grep -E "Edit directly|fix directly|Edit a single" setup/agent-templates/arch-*.md` → MUST return zero hits.
- Bash: `grep "NEVER you fix" setup/agent-templates/arch-*.md` → MUST return 3 hits (1 per architect).
- Bash: `grep "Scope Validation Gate" setup/agent-templates/arch-*.md` → MUST return 3 hits.
- Bash: `grep "DURING-WAVE Protocol" setup/agent-templates/arch-*.md` → MUST return 3 hits.
- Bash: `grep "Exact Fix Format" setup/agent-templates/arch-*.md` → MUST return 3 hits.
- Bash: `grep "Post-Wave Team Integrity Check" setup/agent-templates/project-manager.md` → MUST return 1 hit.

---

## Wave 2: Sync `.claude/agents/` Copies + Regenerate Registry

**Objective:** Copy all 5 modified L0 templates to `.claude/agents/` and regenerate the skill registry.
**Files touched:** 5 copies + `mcp-server/build/registry.json` (or wherever registry is output).
**Owner:** dev (any).

### W2.1 — Copy templates to `.claude/agents/`

Bash commands (one per file):
```
cp setup/agent-templates/arch-testing.md .claude/agents/arch-testing.md
cp setup/agent-templates/arch-platform.md .claude/agents/arch-platform.md
cp setup/agent-templates/arch-integration.md .claude/agents/arch-integration.md
cp setup/agent-templates/project-manager.md .claude/agents/project-manager.md
cp setup/agent-templates/quality-gater.md .claude/agents/quality-gater.md
```

### W2.2 — Regenerate registry

Bash: `node mcp-server/build/cli/generate-registry.js $(pwd)` (verify correct invocation — it expects the project root as argument).

### W2.3 — Update MIGRATIONS.json

Add new version entries to `setup/agent-templates/MIGRATIONS.json` under each template:
- project-manager 5.1.0: "Selective-spawn enforcement, hard-gate strengthened, team integrity check"
- arch-testing 1.6.0: "Removed Edit-directly contradictions, added Scope/During-wave/Exact-fix gates"
- arch-platform 1.5.0: same
- arch-integration 1.5.0: same
- All marked `breaking: false` (text-only strengthening, no protocol change that would break existing consumers).

### W2.4 — Verification

- Bash: `diff -q setup/agent-templates/arch-testing.md .claude/agents/arch-testing.md` → MUST return empty (files match).
- Bash: `diff -q setup/agent-templates/project-manager.md .claude/agents/project-manager.md` → MUST return empty.
- Bash: Registry file exists and was modified < 1min ago.

---

## Wave 3: L1 (shared-kmp-libs) Surgical Propagation

**Objective:** Apply the same 10 bug fixes to L1 private agents, preserving any L1-specific content.
**Files touched:** 5 in `../shared-kmp-libs/.claude/agents/`.
**Strategy:** Since L1 is at OLDER versions (1.3.0/1.4.0) and has no unique project content in arch templates beyond `l0_source` frontmatter metadata, the simplest surgical path is:

1. Read each L1 file to confirm no hidden L1-specific customizations.
2. Copy the updated L0 template body.
3. PRESERVE the L1 `l0_source`/`l0_hash`/`l0_synced` frontmatter lines.
4. Update `l0_hash` to the new sha256 of the L0 source and `l0_synced` to 2026-04-05.

**Tool restriction:** ALL file operations in `../shared-kmp-libs/` MUST use Bash (cp, sed, cat) per memory rule (feedback_never_overwrite_l2_agents.md). NEVER use Write/Edit tools for sibling dirs.

**Owner:** dev (any).

### W3.1 — Per-file surgical updates

For each of the 5 L1 files (arch-testing, arch-platform, arch-integration, project-manager, quality-gater):

1. Bash: `cat ../shared-kmp-libs/.claude/agents/{file}.md` — read current state.
2. Bash: Extract L1 frontmatter metadata lines (`l0_source`, `l0_hash`, `l0_synced`).
3. Bash: Read new L0 source from `setup/agent-templates/{file}.md`.
4. Bash: Write a merged file with:
   - L0 frontmatter fields
   - L1 metadata lines inserted after `template_version`
   - L0 body (everything after the `---` closing)
5. Bash: Compute sha256 of updated L0 source, update `l0_hash` line.
6. Bash: Update `l0_synced` to `2026-04-05`.

Example Bash pattern (for one file, rest follow same pattern):
```bash
cd C:/Users/34645/AndroidStudioProjects/AndroidCommonDoc
L1_DIR=../shared-kmp-libs/.claude/agents
# compute new hash
NEW_HASH=$(sha256sum setup/agent-templates/arch-testing.md | cut -d' ' -f1)
# extract body from L0 (everything after second ---)
awk '/^---$/{c++; if(c==2){print; next}} c>=2{print}' setup/agent-templates/arch-testing.md > /tmp/l0-body.md
# build new L1 file with merged frontmatter
cat > $L1_DIR/arch-testing.md << EOF
---
name: arch-testing
description: "..."
tools: Read, Grep, Glob, Bash, SendMessage
model: sonnet
domain: architecture
intent: [testing, TDD, coverage, test-quality]
token_budget: 4000
template_version: "1.6.0"
l0_source: C:\Users\34645\AndroidStudioProjects\AndroidCommonDoc
l0_hash: sha256:$NEW_HASH
l0_synced: 2026-04-05
skills:
  - test
  - test-full-parallel
  - coverage
EOF
cat /tmp/l0-body.md >> $L1_DIR/arch-testing.md
```

(A cleaner approach: `/sync-l0` skill may already handle this — verify availability. If it exists, use it.)

### W3.2 — Verification

- Bash: `grep "Edit directly" ../shared-kmp-libs/.claude/agents/arch-*.md` → MUST return zero hits.
- Bash: `grep "NEVER you fix" ../shared-kmp-libs/.claude/agents/arch-*.md` → MUST return 3 hits.
- Bash: `grep "template_version" ../shared-kmp-libs/.claude/agents/arch-*.md` → MUST show 1.6.0/1.5.0/1.5.0.
- Bash: `grep "l0_synced: 2026-04-05" ../shared-kmp-libs/.claude/agents/*.md` → MUST show updated dates.

---

## Wave 4: L2 (DawSync) Surgical Propagation — PRESERVE project content

**Objective:** Apply the same 10 bug fixes to L2 private agents. L2 has **DawSync-specific guardian calls that MUST NOT be overwritten**.
**Files touched:** 5 in `../DawSync/.claude/agents/`.
**Tool restriction:** Bash-only per feedback_never_overwrite_l2_agents.md. Zero exceptions.
**Owner:** dev (any).

### L2-specific content INVENTORY (MUST preserve exactly)

| File | Line | Content (L2-specific) |
|---|---|---|
| `arch-testing.md` | 160 | Guardian Call: `daw-guardian` ("Validate background/scheduler changes") |
| `arch-platform.md` | 191 | Guardian Call: `producer-consumer-validator` ("Validate source set changes") |
| `arch-platform.md` | 192 | Guardian Call: `version-checker` ("Check version alignment after domain model changes") |
| `arch-integration.md` | 174 | Guardian Call: `freemium-gate-checker` ("Validate tier enforcement after wiring changes") |
| `arch-integration.md` | 175 | Guardian Call: `firebase-auth-reviewer` ("Security review after auth changes") |

Any text customizations in L2 `project-manager.md` or `quality-gater.md` (routing table, module map, customize sections) MUST be re-verified before overwriting. **Do NOT cp-overwrite these files** — surgical sed replacements only.

### W4.1 — Strategy

**For arch-testing, arch-platform, arch-integration (L2 DawSync):** These are the files with L2-specific guardian calls in the "Guardian Calls" table. Strategy:

1. Read L2 file via Bash `cat`, identify exact line ranges of L2-specific tables (Guardian Calls table body).
2. Build a replacement file by:
   - Taking the updated L0 body
   - Locating the generic `{{CUSTOMIZE: Add project-specific guardian calls here}}` line in the L0 body
   - Replacing the CUSTOMIZE marker with the verbatim L2 Guardian Calls table body
3. Write result back via Bash `cat > file << EOF`

**For project-manager.md (L2 DawSync):** This file may have routing table customizations in L2. Diff first to understand what's custom:
```bash
diff setup/agent-templates/project-manager.md ../DawSync/.claude/agents/project-manager.md
```
- If only frontmatter metadata differs (l0_source/hash/synced) and the body matches → safe to replace body.
- If routing table or customize blocks differ → sed-based targeted replacements instead.

**For quality-gater.md (L2 DawSync):** Same diff-first strategy.

### W4.2 — Per-file Bash procedure (template)

```bash
cd C:/Users/34645/AndroidStudioProjects/AndroidCommonDoc
L2_DIR=../DawSync/.claude/agents

# Step 1: Extract L2-specific Guardian Calls table
# (for arch-testing)
awk '/^### Guardian Calls/,/^{{CUSTOMIZE|^\#\# /' $L2_DIR/arch-testing.md > /tmp/l2-guardians-testing.md

# Step 2: Backup L2 file
cp $L2_DIR/arch-testing.md /tmp/l2-arch-testing.bak

# Step 3: Build merged file from L0 source
# (replace {{CUSTOMIZE:...}} marker with the L2 guardian table entries)
sed -e '/{{CUSTOMIZE: Add project-specific guardian calls here}}/r /tmp/l2-guardians-testing.md' \
    -e '/{{CUSTOMIZE: Add project-specific guardian calls here}}/d' \
    setup/agent-templates/arch-testing.md > /tmp/merged-arch-testing.md

# Step 4: Preserve L2 frontmatter metadata (l0_source, l0_hash, l0_synced)
# Extract from backup, inject into merged
...

# Step 5: Atomic replacement
mv /tmp/merged-arch-testing.md $L2_DIR/arch-testing.md
```

**Critical checkpoint after each file:** Bash `diff /tmp/l2-arch-testing.bak $L2_DIR/arch-testing.md` — visually verify only EXPECTED changes occurred (bug fixes + hash update). If ANYTHING unexpected → restore from backup.

### W4.3 — Verification

- Bash: `grep "daw-guardian" ../DawSync/.claude/agents/arch-testing.md` → MUST still return the original line.
- Bash: `grep "producer-consumer-validator" ../DawSync/.claude/agents/arch-platform.md` → MUST still return the original line.
- Bash: `grep "version-checker" ../DawSync/.claude/agents/arch-platform.md` → MUST still return the original line.
- Bash: `grep "freemium-gate-checker" ../DawSync/.claude/agents/arch-integration.md` → MUST still return the original line.
- Bash: `grep "firebase-auth-reviewer" ../DawSync/.claude/agents/arch-integration.md` → MUST still return the original line.
- Bash: `grep "Edit directly" ../DawSync/.claude/agents/arch-*.md` → MUST return zero hits.
- Bash: `grep "NEVER you fix" ../DawSync/.claude/agents/arch-*.md` → MUST return 3 hits.
- Bash: `grep "l0_synced: 2026-04-05" ../DawSync/.claude/agents/arch-*.md` → MUST show updated dates.
- Bash: `grep "Scope Validation Gate" ../DawSync/.claude/agents/arch-*.md` → MUST return 3 hits.
- Bash: `grep "DURING-WAVE Protocol" ../DawSync/.claude/agents/arch-*.md` → MUST return 3 hits.
- Bash: `grep "Exact Fix Format" ../DawSync/.claude/agents/arch-*.md` → MUST return 3 hits.

**If ANY L2-specific guardian line is missing from the post-change file: STOP, restore from /tmp backup, and re-do the merge.**

---

## Wave 5: /pre-pr + Commit

**Objective:** Validate all changes pass L0 quality gates, then commit.
**Owner:** PM orchestrates, quality-gater runs, then PM commits.

### W5.1 — L0 /pre-pr

Run `/pre-pr` at L0 root: `cd C:/Users/34645/AndroidStudioProjects/AndroidCommonDoc && /pre-pr`

Must pass:
- Commit-lint
- Detekt (no Kotlin changes this PR, but frontmatter validators may run)
- Doc structure validation
- Agent template tests: `cd mcp-server && npm test` (Vitest integration suite — enforces Wave 1 template rules + dual-location sync)

### W5.2 — Commit to develop

Branch: `feature/l0-template-bugs-v5.1.0` (or similar per Git Flow).

Commit messages (Conventional Commits, signed with Claude co-author):
```
fix(agents): remove Edit-directly contradictions + add scope/during-wave/exact-fix gates

Fixes 6 architect template bugs observed in past sessions:
- BUG 5: Removed "Edit directly" contradictions (architects have no Edit tool)
- BUG 8: Added Exact Fix Format section (file:line:old:new required)
- BUG 3: Added Scope Validation Gate (verify task in PLAN.md before dispatch)
- BUG 10: Added DURING-WAVE Protocol (re-consult context-provider mid-wave)
- BUG 4: Strengthened PM hard-gate + pre-flight failure response
- BUG 6: Added Post-Wave Team Integrity Check

Bumps: project-manager 5.0.0→5.1.0, arch-testing 1.5.0→1.6.0,
       arch-platform 1.4.0→1.5.0, arch-integration 1.4.0→1.5.0.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

### W5.3 — L1/L2 commits (separate repos)

**User approval REQUIRED before committing to L1 or L2** (per `NEVER overwrite L2 agents` memory).

L1 commit (in `../shared-kmp-libs`):
```
chore(agents): sync L0 agent templates — bugs fixed in AndroidCommonDoc v5.1.0
```

L2 commit (in `../DawSync`):
```
chore(agents): sync L0 agent templates — preserve DawSync guardian calls
```

### W5.4 — Push + CI monitor

After each commit, push to feature branch, wait for CI green, then open PR to develop.

---

## Risk Matrix

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| L2 DawSync-specific guardian calls lost | MEDIUM | HIGH | Backup before sed, grep-verify post-sync (5 explicit checks in W4.3) |
| L1/L2 `l0_source`/`l0_hash` metadata corrupted | MEDIUM | MEDIUM | Extract-and-preserve pattern in W3.1/W4.2 |
| MIGRATIONS.json becomes out of sync | LOW | LOW | W2.3 explicit step |
| `.claude/agents/` drift from templates post-commit | LOW | MEDIUM | W2.4 diff verification |
| Registry file not regenerated | LOW | MEDIUM | W2.2 explicit step |
| New "Edit directly" language creeps back | LOW | HIGH | W1.6/W3.2/W4.3 grep checks; future audit should run |

---

## Open Questions (for PM to decide)

1. **Should /sync-l0 skill handle Waves 3 and 4?** If yes, use it instead of manual Bash. Verify skill still respects L2 `l2_specific` sections before running.
2. **User approval cadence:** Plan assumes user approves L0 commit autonomously (feature branch, develop target). L1/L2 commits require explicit user approval. Confirm before W5.3.
3. **Should BUG 7 ("should"→MUST audit of non-arch templates) be in-scope this session?** Deferred for now (3 low-priority instances only, all in non-critical descriptive text).
4. **Version bump strategy:** Minor (1.5.0 → 1.6.0) vs patch (1.5.0 → 1.5.1)? Plan uses minor because multiple new MANDATORY sections are added (scope gate, during-wave, exact-fix).

---

## Execution Order (critical path)

```
Wave 1 (L0 templates) → Wave 2 (copies+registry) → Wave 3 (L1) → Wave 4 (L2) → Wave 5 (commit)
```

Waves are sequential. Wave 2 depends on Wave 1, etc. No parallelization within waves (single file per dev dispatch, sequentially verified).

**Dev assignments:**
- Wave 1: any layer dev (text edits only, no code). Recommend `test-specialist` (no coding load) or `ui-specialist`.
- Wave 2: any layer dev + test-specialist for registry regeneration.
- Wave 3: test-specialist (L1 shared-kmp-libs).
- Wave 4: test-specialist (L2 DawSync). High-care wave — direct architect oversight required.
- Wave 5: PM commits, quality-gater validates.

**Architect assignments:**
- arch-integration: primary owner (template changes are integration concerns — how agents wire together).
- arch-testing: verify all grep checkpoints execute correctly.
- arch-platform: verify cross-project consistency (L0/L1/L2 parity).

---

## Done Criteria

- [ ] All 10 bugs fixed in L0 templates with file:line:old:new evidence
- [ ] `.claude/agents/` copies identical to templates (diff -q empty)
- [ ] Registry regenerated
- [ ] MIGRATIONS.json updated
- [ ] L1 synced, L1 metadata preserved
- [ ] L2 synced, all 5 L2-specific guardian calls preserved (grep-verified)
- [ ] All grep verification gates pass (15+ grep checks across waves)
- [ ] /pre-pr passes at L0
- [ ] Conventional commit created on feature branch
- [ ] User approved L1/L2 commits before pushing
