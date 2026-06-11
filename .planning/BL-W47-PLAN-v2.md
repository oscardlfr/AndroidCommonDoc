# BL-W47 — Adaptive Harness Redesign Plan v2

> **Status**: PLANNED
> **Date**: 2026-06-11
> **Supersedes**: BL-W47-PLAN.md (v1, created 2026-05-09)
> **Ground truth**: `.planning/AUDIT-harness-2026-06.md` (2026-06-11, ~2.15M subagent tokens; do NOT re-derive evidence from other sources — cite audit sections)
> **Part E wins**: where Part E findings conflict with earlier audit sections, Part E is authoritative

---

## 1. Governing Principles

### Portability tiers (Gate record item 3, A0 binding)

| Tier | Contract | Examples | Must work without Claude Code? |
|------|----------|----------|-------------------------------|
| T1 — Invariants | git hooks, CI jobs | commit-msg-hook.sh, pre-push hook, drift-audit.yml, commit-lint | YES — universal |
| T2 — Artifacts/Protocols | files: PLAN.md, verdict files, stamps, bundles, sentinels | context-bundles/*.md, arch-*-verdict.md, quality-gate.stamp | YES — any file-reading agent |
| T3 — Orchestration | Claude Code adapters | SubagentStart hooks, agent teams, SendMessage, TeammateIdle/TaskCompleted | NO — Claude-only accelerators |

**Full T3 parity is explicitly NOT a v2 goal.** Every PR section below includes a "Works without Claude Code?" classification.

### Part E precedence rule

Part E of the audit OVERRIDES any earlier audit section it conflicts with. The 5 Top-5 directives are binding:
1. Portability layer-contract per A0; per-PR "works without Claude Code?" row.
2. PR-0a (firing matrix) is its own first PR; all peer-subject hook work conditional on its outcome.
3. Answer the topology question: subagent-first pilot + per-primitive experimental-risk table + explicit disposition of 3-phase model and L1 #26.
4. Mechanical wave-class classifier with auto-escalation + QG declared-vs-touched check; D11 fast-path in-plan.
5. Sequence against Mac migration; terminal L1/L2 sync step with doctrine adjudication; RESEARCH doc marked superseded.

### Redesign success metric

**RESOLVED = N waves recurrence-free** (Part E #16). Not "countermeasure shipped." Each finding must be re-verified after v2 lands and confirmed absent for ≥2 subsequent waves before the backlog item closes.

---

## 2. Per-Primitive Dependency-Risk Table (Part E #3)

| Primitive | Status | Risk if it breaks | Fallback |
|-----------|--------|-------------------|---------|
| git commit-msg hook | GA (git native) | LOW | CI commit-lint backstop |
| git pre-push hook (new, PR-0b) | GA (git native) | LOW | CI branch-protection rules |
| CI jobs (drift-audit, commit-lint) | GA | LOW | Manual gate |
| Files: PLAN.md, verdict files, stamps, bundles | Trivially portable | NONE | N/A |
| PreToolUse/PostToolUse hooks | GA (Claude Code) | MED — firing verified for main agent and Agent-tool subagents, NOT for in-process peers (W1) | Move invariants to T1/T2 |
| SubagentStart + additionalContext | VERIFIED-YES (doc-level only; not locally exercised) | MED — injection path unconfirmed for teammate respawn | File bundle primary (T2); SubagentStart = progressive enhancement |
| TeammateIdle / TaskCompleted exit-2 | VERIFIED-YES (doc-level; not locally exercised) | MED | File/inbox-ack fallback (T2) |
| Agent Teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) | **EXPERIMENTAL** — known limitations around session resumption, task coordination, shutdown | HIGH — topology depends on it | Subagent-first wave class as pilot alternative |
| Task tools (TaskCreate/TaskList/TaskUpdate) | GA (default since v2.1.142) | LOW | File-based task tracking fallback |
| Monitor / Workflow tools | GA (v2.1.98+ / v2.1.154+) | LOW — not core to this plan | N/A for v2 |
| `ccs` CLI (council multi-provider) | **NOT READY** — binary present, profiles empty, no GLM/Gemini auth | HIGH if relied on | Agent `model` param for model diversity (intra-Anthropic only) |
| Agent `model` param | GA | LOW | Default model fallback |

---

## 3. Fresh Preconditions

v1's Steps 2-4 are fossils (kmp-test-runner cited at v0.9, shipped is v0.14.0; L1/L2 syncs already done). v2 preconditions:

- Research currency: this audit (2026-06-11) is the current primitive ground truth. A2 supersedes RESEARCH-adaptive-harness.md.
- Pre-wave cleanup (Section 4 below) committed and merged BEFORE PR-0a opens.
- Mac migration ordering: items marked MOOT-ON-MAC are still worth shipping now if they take <30 min; items marked DO-ON-MAC are deferred explicitly. The SHIP-NOW items have value independent of platform.
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` confirmed set (already in env per A1).
- Open clean session; no in-flight team from a prior BL-W wave.

---

## 4. PR Sequence

### Pre-wave Cleanup (commits before PR-0a, NOT a PR)

**Goal**: Rescue lost audit trail, commit stale untracked files, sweep stale teams, diet MEMORY.md.

**Scope**:
- D1: Rescue the 2 untracked mangled-path root files (`Users\303\24645...`) into `.planning/wave-kotlin240/` with canonical names, then `git rm` the strays.
- D2: Commit `.claude/wave-quality-gates/cancellation-detekt.md` (tracked-sentinel convention since BL-W42).
- D3: TeamDelete sweep — 29 stale team dirs + 4 dead `session-bl-w48` entries; `session-bl-w48` NEVER reused.
- D5: MEMORY.md index diet — one-line entries; archive pre-May 2026 entries to topic files until MEMORY.md ≤ 20KB.

**Success criteria**:
- `rtk git status` shows no untracked files at repo root or `.planning/wave-kotlin240/`.
- `cat ~/.claude/projects/.../memory/MEMORY.md | wc -l` reports < 100 lines.
- No stale team dirs under `~/.claude/teams/`.

**Works without Claude Code?** YES (T1/T2 — all file operations).
**Mac column**: SHIP-NOW (path rescue is platform-independent content fix).
**Dependency**: must complete before PR-0a.

---

### PR-0a — Empirical Firing Matrix (standalone, lands first)

**Goal**: Determine definitively which hook events fire for (i) main agent, (ii) Agent-tool subagents, (iii) in-process team peers — across the PreToolUse Write/Edit/SendMessage/TaskUpdate legs, SubagentStart/SubagentStop, TeammateIdle/TaskCompleted. Results condition ALL peer-subject hook work downstream (PR-0c, PR2, PR3, PR4).

**Scope** (files whose existence was verified via the audit's R2 ground truth):
- Probe harness: a small bats test or scripted Claude session that fires each event class and captures the hook log.
- D10 probe: verify plan-md-write-gate Edit bypass is closed (R1b prep-13 claims it was fixed; PR-0a confirms empirically).
- OQ3 column: confirm whether hook-visible identity for teammate spawns is `name` or `subagent_type`.
- Matrix output artifact: `.planning/BL-W47-firing-matrix.md` — table with rows = event types, columns = agent class (main / subagent / peer), cells = FIRES / NO-FIRE / UNCONFIRMED.

**Falsifiable success criteria**:
- `.planning/BL-W47-firing-matrix.md` exists and contains a filled 3-column table for all 12 event classes in A2.
- Each cell is labeled FIRES, NO-FIRE, or UNCONFIRMED-UNTESTABLE (with reason).
- D10 cell explicitly labeled.
- OQ3 column populated.

**Risks**: testing requires live Claude Code session; matrix may return UNCONFIRMED for some cells. Mitigation: label those cells and note the portability fallback (move to T1/T2).
**Rollback**: matrix is read-only research artifact; no hooks changed.
**Works without Claude Code?** NO (T3 test by definition). Matrix output = T2 artifact.
**Mac column**: SHIP-NOW — empirical matrix is more valuable on Mac (no backslash mangling).
**Dependency on this PR**: PR-0c, PR2 (SubagentStart adapter), PR3 (suffix-tolerant hook rewrites), PR4 (TeammateIdle/TaskCompleted) are all CONDITIONAL on this matrix. State this in their dependency rows explicitly.

---

### PR-0b — Portable Git/CI Layer (model-agnostic authoritative core)

**Goal**: Close the peer-bypass gap for push stamps; fix the `rtk git commit` branch-guard bypass; evaluate git-layer ports for amend-gate and branch-guard.

**Scope**:
- `scripts/sh/pre-push-hook.sh` (NEW): git pre-push hook enforcing the two-stamp requirement (quality-gate.stamp + pre-pr.stamp ≤ 30min, HEAD match). Install via `install-git-hooks.sh`. Closes the current gap: no git pre-push hook exists (A1), so the peer bypass documented in W1 has zero backstop below Claude hooks.
- Branch-guard `rtk` prefix fix: `branch-guard.js:38` checks `tokens[0] !== 'git'` — `rtk git commit` bypasses it. Fix: strip leading `rtk` token before command token check.
- Amend-gate git-layer evaluation: assess whether `commit --amend` detection in the commit-msg hook is sufficient or needs a separate `prepare-commit-msg` hook. Decide and document.
- CI root-garbage check: add a CI step (or extend drift-audit.yml) that fails if any `Users*` mangled-path files exist at repo root (D1 recurrence prevention).

**Falsifiable success criteria**:
- `scripts/sh/pre-push-hook.sh` exists, `git update-index --chmod=+x` applied, bats coverage ≥ 2 tests (stamp-missing blocks, stamps-fresh passes).
- `branch-guard.js` — `rtk git commit` on a protected branch exits 2 (bats test).
- CI step present in drift-audit.yml; `Users*` root file triggers CI failure in a test run.
- Amend-gate decision recorded in `.planning/BL-W47-firing-matrix.md` appendix or a dedicated note.

**Risks**: pre-push hook new behavior — accidental block on valid pushes. Mitigation: bypass env var `SKIP_PUSH_GATE=1` (matches existing pattern).
**Rollback**: `git update-index --chmod=-x scripts/sh/pre-push-hook.sh` or uninstall hook.
**Works without Claude Code?** YES (T1 — pure git/CI layer).
**Mac column**: SHIP-NOW (cross-platform; no backslash paths involved).
**Dependency**: independent; can ship in parallel with PR-0a research.

---

### PR-0c — Hook Surgery & Consolidation (conditional on PR-0a)

**Goal**: Fix the architectural weaknesses in the hook layer identified in W2 and Part E #11. Conditional: peer-subject hook changes only apply if PR-0a's matrix confirms the relevant event class fires.

**Scope** (all files verified to exist in R2 ground truth):
- `.claude/hooks/architect-scope-gate.js`: currently reads top-level `.planning/PLAN.md` (stale W22 content per W6) — fix to read the wave-scoped path (`wave-{slug}/PLAN.md`).
- `.claude/hooks/architect-bash-write-gate.js`: (a) literal-vs-effective path fix — reject redirect targets with backslash or drive-prefix (literal path, not effective path, currently exempted); (b) node-eval blind spot — detect `node -e` patterns that write files and validate them.
- Architect verdict-write channel decision (W2 root cause fix): choose between (a) scoped Write allowlist for `wave-*/arch-*-verdict.md` paths only, or (b) a `verdict-writer` MCP tool. Decision recorded in verdict. Two-phase-integrity check: single Write containing both `APPROVED-PREP` + `APPROVED-VERIFY-FINAL` tokens in one file is rejected (must be two separate commits).
- D8: role attribution in tool-use-logger — log `agent_name` + `agent_type` per call; add log rotation (20MB cap, gzip old segments). This is a prerequisite for measuring topology diet (Part E #9 caveat honored: don't cite 62.5% as idle evidence until attribution exists).
- D12: CP-gate exemption tuning — PM meta-reads (CLAUDE.md, MEMORY.md, tl-*.md) should not trigger CP-gate blocks (#1/#2/#3 L1 friction). Fix exemption list + update error text to not instruct the dangerous heredoc route.
- Dead stub removal: `.claude/hooks/quality-gate-pre-commit.sh` (still registered, functionally dead per R2) — unregister and delete.
- D4: `agents.manifest.yaml` header "38/38" → "39/39" (one-line fix).
- Consolidate the 3-way push gate into the pre-push hook from PR-0b (reduce hook registrations; set a measurable target: ≥5 fewer registrations or BL-W31.7-03 re-opened as PARTIAL).

**Conditional on PR-0a** (document explicitly in PR header):
- If PR-0a matrix shows NO-FIRE for in-process peers: move any peer-subject invariants currently only in PreToolUse hooks to T1/T2 (git hooks or CI). Do NOT polish potentially-dead-code hooks.

**Falsifiable success criteria**:
- `architect-scope-gate.js` reads the wave slug path — bats test: create a mock `wave-test/PLAN.md` and confirm scope is read from it, not root.
- `architect-bash-write-gate.js` — bats test: backslash-path redirect target blocked; node-eval write attempt blocked.
- Verdict-write channel decision committed to `.planning/BL-W47-verdict-channel.md` with rationale and implementation.
- Two-phase-integrity check — bats test: single-file dual-token write exits 2.
- tool-use-logger emits `agent_name` field; `wc -l` of log file does not grow beyond 200K lines (rotation fires).
- Total hook registrations in `.claude/settings.json` ≤ 38 (down from current 43), OR a comment in the PR notes that BL-W31.7-03 stays open.
- D12 exemption: `CLAUDE.md` read by PM does not trigger CP-gate block — bats simulation.

**Risks**: Verdict-write channel decision is HIGH impact — wrong choice breaks architect flow. Mitigation: implement WARN-mode first for one wave before full enforcement.
**Rollback**: revert commit for each sub-item independently (separate commits per sub-item mandated).
**Works without Claude Code?** NO for hook changes (T3); YES for manifest header fix (T2).
**Mac column**: literal-vs-effective path fix = SHIP-NOW (backslash issue persists in zsh even post-migration). Dead stub removal = SHIP-NOW. Node-eval fix = SHIP-NOW.
**Dependency**: CONDITIONAL on PR-0a matrix for peer-subject items.

---

### Ex-PR1 (renamed) — Plan-phase Q&A + Spec-Amendment Pause

**Goal**: Planner proactively asks clarifying questions before producing a plan (canonical Anthropic plan-mode behavior, confirmed by A2 item 12). Spec-amendment pause unified with PR6's ack-checkpoint primitive.

**Already shipped — DO NOT REDO**: planner AMEND Obedience (#180), User Decision Broadcast 60s SLA (prep-13), BRIEF-HOOK-CONFLICT block (prep-12), plan-mode-spawn-planner hook skeleton.

**Remaining scope** (scope-file corrections from Part B PR1 — v1 cited nonexistent paths):
- `docs/agents/main-agent-orchestration-guide.md` (not `team-lead.md` — retired W31.6): add "main-as-orchestrator in plan mode MUST ask 2-5 clarifying questions before drafting."
- `setup/agent-templates/planner.md` (v1.12.0): add explicit `AskUserQuestion` step BEFORE WriteFile(PLAN.md); questions limited to spec-ambiguity (feedback_stop_asking: no mid-execution questions).
- `.claude/hooks/plan-mode-spawn-planner.js`: consolidate 4 registrations → 1 (v1 E#13 bullet, cheap); add regression-guard check for Q&A template version.
- Spec-amendment-pause mechanics: planner sends questions → team-lead relays via AskUserQuestion → planner resumes via SendMessage auto-resume (A2 item 5). Pause at next ack-checkpoint (file boundary) unified with PR6 mechanism — one pause primitive, two triggers. Mid-write interrupt impossible (no preemption API, A2 item 12 negative).

**Falsifiable success criteria**:
- In a test plan-mode session with an under-specified task, planner emits at least 2 AskUserQuestion calls before writing PLAN.md.
- `plan-mode-spawn-planner.js` has exactly 1 registration in `settings.json` (down from current 4).
- Spec-amendment-pause protocol documented in `docs/agents/main-agent-orchestration-guide.md` with worked example.

**Risks**: Q&A step adds friction to trivial waves. Mitigation: questions conditional ("if any of these axes are unclear") — zero friction when spec is complete.
**Rollback**: revert template commit.
**Works without Claude Code?** AskUserQuestion = T3 (Claude-only). File protocol for Q&A = T2 fallback (planner writes an `open-questions.md`, team-lead reads and relays manually).
**Mac column**: SHIP-NOW (pure template/doc change).
**Dependency**: none; independent of PR-0a.

---

### Ex-PR2 (INVERTED) — File-based Context Bundles as Primary

**Goal**: Context-exhausted agents (specialists, architects, doc-updater) receive structured context bundles via files first. SubagentStart additionalContext injection is a progressive enhancement, enabled only if PR-0a confirms it fires for the relevant spawn class.

**INVERSION rationale** (Part E #2, binding): v1 anchored on SubagentStart for the wrong subject class (broken class IS in-process teammates, W1); file bundles are verified-by-construction and portable to any model/CLI.

**Bundle design**:
- Storage: `.planning/wave-{slug}/context-bundles/{role}.md` (OQ1 resolved: wave dirs already gitignored; co-located with verdicts).
- TTL: session-scoped (OQ2 resolved). Bundle carries `created_at` + wave slug header; consumer ignores bundles from older waves.
- Content (OQ5 first task — bundle JSON Schema before implementation): PATTERNS-only (doc references, frontmatter slugs). NO arbitrary file contents, NO work forecasts. CP writes the bundle; the spawn prompt mandates "Read your bundle first before any other action."
- Bundle schema: architect-role bundles also absorb the dissolved PR5 "pre-rotate brief" content spec (current verdict status, in-flight findings, pending dispatches).

**Primary delivery contract (T2 — portable)**:
- CP adds `write_bundle(role, plan_id, status_snapshot)` method writing `context-bundles/{role}.md`.
- Every spawn prompt contains: "Read `context-bundles/{role}.md` first before any other action."
- CP template updated with PATTERNS-only boundary (explicit section in `docs/agents/context-provider-adoption-hooks.md`).

**Progressive enhancement (T3 — conditional on PR-0a)**:
- `.claude/hooks/subagent-start-context-bundle.js` (NEW): if PR-0a confirms SubagentStart fires for the relevant spawn class → inject bundle content via `additionalContext`.
- `.claude/hooks/session-start-compact-resync.js` (NEW): if PR-0a confirms SessionStart `compact` matcher fires → re-inject critical context post-compaction.

**Self-verification leg**: `TaskCompleted` exit-2 for teammates + `SubagentStop` for subagents (OQ9 resolution, doc-verified per A2 items 2/8). Portable fallback (T2): TL-side files-vs-claims check on READY-FOR-REVIEW (already protocol, no new hook needed).

**Falsifiable success criteria**:
- OQ5 deliverable: `context-bundles/schema.json` (or equivalent `.md` schema spec) committed before any bundle-writing code.
- CP `write_bundle` method exists in template; bats test: call method, confirm `context-bundles/test-specialist.md` is written with correct headers.
- In a live session: a specialist respawn prompt includes "Read your bundle first" and the bundle file exists.
- SubagentStart hook (if enabled): bats test using a mock bundle confirms `additionalContext` is populated.

**Risks**: Bundle staleness (wrong wave). Mitigation: wave-slug header check; consumer validation.
**Rollback**: disable SubagentStart hook registration; file bundles remain (harmless).
**Works without Claude Code?** Primary (T2) YES. SubagentStart hook (T3) NO — gracefully degrades to file-only.
**Mac column**: SHIP-NOW (file bundles), DO-ON-MAC (SubagentStart hook — test more cleanly without path mangling).
**Dependency**: OQ5 schema task first; SubagentStart hook conditional on PR-0a.

---

### Ex-PR3 (REFRAMED) — Rotation Doc Fix + Stale-Suffix Guard

**Goal**: Fix the 4 wrong rotation documents (hard cutover — flagging wrong docs is incoherent, OQ4 resolved), add stale-suffix guard, make hook matching suffix-tolerant where confirmed relevant by PR-0a.

**Evidence** (Part B PR3): same-name respawn SUFFIXES (does not replace); dead-inbox routing proven twice; `tl-session-setup.md` L53/L55-59, `tl-phase-execution.md` L77, `tl-verification-gates.md` L139, and `docs/agents/context-rotation-guide.md` all prescribe empirically false behavior.

**Scope**:
- Hard cutover on 4 rotation docs: replace same-name-respawn text with: "SendMessage to a stopped subagent auto-resumes it (native primitive). For teammates, spawn a new indexed peer (e.g., `test-specialist-2`); do NOT re-use the same name — routing goes to a dead inbox."
- Stale-suffix guard: new hook or extension of agent-spawn-validator — block ACCIDENTAL same-name spawn (where a prior peer of that name exists, WARN→BLOCK after one wave); ALLOW intentional indexed overflow (`test-specialist-2` is explicitly documented as valid overflow). Guard merges the 2026-06-07 backlog item.
- Suffix-tolerant matching (CONDITIONAL on PR-0a): if PR-0a confirms the 4 exact-match lists are relevant (premature-execution-gate.js:111 SUBJECT_TYPES, specialist-task-completion-gate, knowledge-currency-gate, architect-verdict-presence-gate) + the `arch-[a-z]+` verdict regex — update each to tolerate indexed suffixes. `plan-mode-spawn-planner.js` name check: tolerate `planner-2` if it carries the right subagent_type.

**Falsifiable success criteria**:
- All 4 rotation docs updated; `grep -r "same-name" docs/agents/` returns no lines prescribing same-name respawn as context-clearing.
- Stale-suffix guard: bats test — spawn a second agent with existing peer name → WARN logged (first wave) then BLOCK (after enabling strict mode).
- Suffix-tolerant matching (if enabled): bats test — `test-specialist-2` passes through specialist-task-completion-gate without rejection.

**Risks**: Hard cutover on rotation docs may break sessions mid-wave if a lead reads stale cached guidance. Mitigation: land during a clean-session window (between waves).
**Rollback**: revert rotation doc commit; disable stale-suffix guard via bypass env.
**Works without Claude Code?** Rotation doc fix = T2 YES. Stale-suffix hook = T3 NO — doc fix is the portable signal.
**Mac column**: SHIP-NOW (doc fix). DO-ON-MAC (suffix-tolerant hook rewrites if PR-0a shows low-priority for peer class).
**Dependency**: suffix-tolerant hook changes CONDITIONAL on PR-0a matrix.

---

### Ex-PR4 — Spawn Table + Mechanical Wave-Class Classifier

**Goal**: Planner-owned Spawn Table artifact; mechanical path-based wave-class classifier with auto-escalation; D11 sanctioned fast-path; fix tl-session-start L228 contradiction; TaskList shared-vs-per-lead decision.

**Already shipped — DO NOT REDO**: selective spawning MANDATORY (tl-session-setup v2 scope table); task-completion gate + protocol (specialist-task-completion-gate, prep-10).

**Scope**:
- Spawn Table in PLAN.md (unshipped, grep-verified absent): planner adds `### Spawn Table` section per wave. Format: `| Role | Count | Reason |`. Hook-enforced: premature-execution-gate.js requires Spawn Table presence before EXECUTE phase.
- Adaptive floor by wave class (Gate record item 2 APPROVED): class-scoped minimum peer counts. Proposed defaults (consistent with NO-OP cert data and user approval):
  - HARNESS class (touches `.claude/hooks`, `settings.json`, `scripts/`, `setup/agent-templates/`, `.github/`): 3 architects, planner, CP, doc-updater, QG (full 7-peer floor)
  - DOC class: 1 architect (domain-relevant only), CP, doc-updater, QG (4-peer floor)
  - FAST-PATH class (D11 sanctioned): orchestrator + CP only; no planner, no architects (2-peer floor; entry criterion: ≤3 files, no hook/template/CI changes, explicitly designated by user)
  - `feedback_always_3_architects` memory → SUPERSEDED-CANDIDATE (present the NO-OP stub data alongside it)
- Mechanical path-based classifier (Part E #5): PLAN.md declares wave class + path manifest (list of files touched). If any committed file path matches `.claude/hooks`, `settings.json`, `scripts/`, `setup/agent-templates/`, `.github/` → auto-escalate to HARNESS class. Out-of-class commit BLOCKS (pre-commit hook check). QG step verifies declared-class-vs-touched-paths.
- tl-session-start.md L228 contradiction fix: remove "Spawn the 5 core specialists… No exceptions" (conflicts with tl-session-setup v2 selective-spawning MANDATE).
- TaskList shared-vs-per-lead decision: `CLAUDE_CODE_TASK_LIST_ID` enables sharing (A2 item 10). Decide: shared task list per wave (team-lead sets env var, all peers see same list) vs per-lead (current default). Record decision in `docs/agents/main-agent-orchestration-guide.md`.

**Falsifiable success criteria**:
- `setup/agent-templates/planner.md` contains `### Spawn Table` section with example table.
- `premature-execution-gate.js` blocks EXECUTE if no `### Spawn Table` section in PLAN.md — bats test.
- Path-based classifier: `pre-commit-hook.sh` (or new hook) reads PLAN.md declared class; commit touching `.claude/hooks/` on a DOC-class wave exits 2 — bats test.
- tl-session-start.md: `grep "No exceptions" docs/agents/tl-session-start.md` returns no match.
- TaskList decision recorded in `docs/agents/main-agent-orchestration-guide.md` under a `### Task List Sharing` section.

**Risks**: False-positive escalations from path classifier on legitimate refactors. Mitigation: classifier reads PLAN.md declared class first; auto-escalation only fires if declared class is lower than path evidence; a `WAVE_CLASS_OVERRIDE=HARNESS` env var for manual override.
**Rollback**: disable path classifier via env; Spawn Table requirement can be bypassed with `SKIP_SPAWN_TABLE=1`.
**Works without Claude Code?** Spawn Table (T2) YES. Path classifier hook (T3) NO — but the file manifest is T2 and auditable.
**Mac column**: SHIP-NOW (pure doc/template changes); classifier hook = SHIP-NOW (no backslash paths).
**Dependency**: independent; can ship after PR-0a/0b.

---

### Ex-PR6 (REFRAMED) — HOLD Ack-Checkpoint Protocol

**Goal**: Implement cooperative HOLD ack-checkpoint. Preemption is NOT available (both channels confirmed, Part B PR6). Drop the SDK-preemption research leg entirely.

**Native anchors (A2 items 8, 9 — doc-verified, not locally exercised)**:
- `TeammateIdle` exit-2: keep teammate working / inject feedback.
- `TaskCompleted` exit-2: block completion with feedback.

**Scope**:
- OQ10 first task: determine checkpoint density (per-file-write vs per-commit) before implementing. Recommendation from audit: checkpoint per commit (not per file — high-frequency writers flood acks). Record in `.planning/BL-W47-hold-checkpoint-decision.md`.
- Hookless file/inbox-ack fallback (T2 — portable, primary): when HOLD pending, team-lead writes `.planning/wave-{slug}/HOLD.md`; specialists check for this file at every commit boundary before pushing.
- TeammateIdle/TaskCompleted Claude adapters (T3 — conditional on PR-0a): if PR-0a confirms these fire correctly, implement exit-2 hooks as progressive enhancement.
- Spec-amendment-pause unified: PR1's pause primitive uses the same ack-checkpoint file mechanism (HOLD.md or a named pause file). One primitive, two triggers (mid-flight scope change vs explicit HOLD signal).
- Update specialist templates: "At each commit boundary, check for `.planning/wave-{slug}/HOLD.md`. If present, stop, ack by appending your name+timestamp to the file, and await team-lead reply before continuing."
- Drop: SDK-preemption research, same-name verification (answered in PR3), pre-rotate-brief PR (dissolved into PR2).

**Falsifiable success criteria**:
- OQ10 deliverable: `.planning/BL-W47-hold-checkpoint-decision.md` exists with density decision and rationale.
- HOLD.md protocol: bats simulation — write HOLD.md to wave dir, run specialist bats mock, confirm specialist mock detects file and halts.
- TeammateIdle exit-2 hook (if enabled by PR-0a): bats test — idle teammate exits 2 and receives feedback injection.
- Specialist templates: `grep "HOLD.md" setup/agent-templates/` returns ≥3 specialist template matches.

**Risks**: HOLD.md check is cooperative — a specialist that doesn't follow the protocol won't stop. Mitigation: QG verifies HOLD.md handling in specialist templates as part of template audit.
**Rollback**: remove HOLD.md check from templates (no hook to unregister for the portable path).
**Works without Claude Code?** HOLD.md file check (T2) YES. TeammateIdle hooks (T3) NO — degrades gracefully to file-only.
**Mac column**: SHIP-NOW (file protocol). DO-ON-MAC (TeammateIdle hooks if confirmed by PR-0a).
**Dependency**: OQ10 density decision first; TeammateIdle/TaskCompleted hooks conditional on PR-0a.

---

### Topology Pilot — Subagent-First Wave Class

**Goal**: Answer the topology question Part E #3 raises. Measure a subagent-first wave (orchestrator + disposable subagents + file contracts, no peer team) against the peer-team baseline. Pilot outcome decides 3-phase model fate.

**Evidence motivating this**: this audit session itself ran CP + 14 single-use subagents (~2.05M tokens, zero idle peers, zero ceremony) — the fan-out/synthesis model handled evidence-heavy work without floor cost. L2 S1-I4: fresh disposable subagent beat 176k-token bloated persistent peer. A5 conclusion: value concentrated in 1 relevant architect + mechanical gates; cost is structural.

**Design**:
- Choose one DOC-class or FAST-PATH-class wave as pilot; orchestrator fans out to disposable single-use subagents (Agent tool, not TeamCreate).
- File contracts: subagents READ bundle, WRITE output file, STOP. Orchestrator synthesizes.
- Measure: total tokens, wall clock, error rate, finding quality vs a comparable peer-team wave.
- Attribution prerequisite: D8 role-attribution from PR-0c must ship first so the comparison is meaningful.
- Pilot outcome recorded in `.planning/BL-W47-pilot-results.md`.

**Decision gate**: if subagent-first matches or beats peer-team on a DOC-class wave, 3-phase model is retired for DOC/FAST-PATH classes. If peer-team wins, retain. Decision explicitly recorded, not silently inherited.

**L1 #26 disposition**: single-node routing (the only OPEN CRITICAL in the L1 friction log). Two options:
- Include routing work in PR-0c (fan-out capable team-lead sub-dispatches via Workflow tool) — RECOMMENDED if pilot shows peer-team viable for HARNESS class.
- Mark ACCEPTED-OPEN with explicit rationale if pilot shows subagent-first replaces peer routing entirely for most wave classes. Rationale: single-node bottleneck only matters if peers are the primary execution unit.
- **Decision deferred to pilot results; not silent.** Pilot outcome recorded before this is marked ACCEPTED-OPEN.

**Works without Claude Code?** NO (T3 — Agent tool is Claude-only). Results (T2) portable.
**Mac column**: DO-ON-MAC preferred (cleaner subagent semantics, no path mangling).
**Dependency**: D8 role-attribution (PR-0c) must ship first.

---

### Council Design Section (design only — implementation NEXT iteration, user's sole deferral)

Per Gate record item 4: design is in v2; implementation goes to the next iteration.

**Planning-phase seam**:
- Optional flag-gated council step in planner protocol: draft plan written to `.planning/PLAN-DRAFT.md` → N independent anonymous critic subagents (each receives only the draft, not each other's outputs) → critiques written to `.planning/council/critic-{n}.md` → chairman subagent synthesizes to `.planning/council/synthesis.md` → planner applies amendments → final PLAN.md written.
- Trigger: `COUNCIL_REVIEW=1` env var (opt-in; HIGH-risk or harness-touching waves only).
- Council I/O as files (T2 per A0).

**QG evolution**:
- Existing 3-arch deliberation is a proto-council (Stage-2-shaped, mono-model). Generalize: QG deliberation allows N council seats.
- Model diversity via Agent `model` param (intra-Anthropic today: sonnet/opus/haiku/fable diversity). `ccs` multi-provider when profiles configured (NOT ready today — see primitive risk table).
- All QG council I/O written to files (`.planning/wave-{slug}/qg-council/`) per A0.

**What is NOT designed here** (defers to implementation):
- `ccs` CLI integration (profiles empty, no auth).
- Anonymization infra (prompt-level construct; no infra needed).
- Chairman election protocol.

**Works without Claude Code?** Design artifact (T2) YES. Implementation will be T3.

---

### Terminal Step — L1/L2 Sync + Doctrine Adjudication

**Goal**: Propagate harness fixes to L1 (shared-kmp-libs) and adjudicate the L2 (DawSync) spawn-upfront doctrine divergence. Honor `never-overwrite-L2-agents` memory.

**Scope** (D7 + Part E #15):
- D7: DawSync hooks still use `cat /dev/stdin` (BL-W42 PR4 fix never propagated; still registered there). Fix by updating DawSync's copy directly from the L0 session terminal (sibling dir permission confirmed).
- Doctrine adjudication: L2 locally institutionalized spawn-everything-upfront-and-idle (WAVE1-KICKOFF) — actively opposes v2 selective-spawning and adaptive-floor rules. Options: (a) override (update L2 templates to match L0 adaptive floor — high impact), (b) preserve-local (accept L2 divergence, document it). Recommendation: override for the selective-spawning MANDATE (memory: `tl-session-setup.md` v2 selective spawning is MANDATORY); preserve-local for L2-specific spawn counts that reflect its actual domain topology. Never overwrite L2's private agent files with L0 copies.
- L1 (shared-kmp-libs): apply any template version bumps that landed in v2 PRs; verify no private agent files are overwritten.
- `RESEARCH-adaptive-harness.md`: add `SUPERSEDED-BY-AUDIT` header note (SubagentStop existence, event count ~9→30, same-name semantics, native task/Workflow tools all changed; A2 of the audit is current primitive ground truth).

**Falsifiable success criteria**:
- `grep -r "cat /dev/stdin" C:\Users\34645\AndroidStudioProjects\DawSync\.claude\hooks\` returns no matches.
- L2 WAVE1-KICKOFF template updated OR a `docs/agents/l2-topology-divergence.md` note filed with explicit rationale.
- `RESEARCH-adaptive-harness.md` first line: `> **SUPERSEDED-BY-AUDIT**: see .planning/AUDIT-harness-2026-06.md`.

**Works without Claude Code?** YES (T1/T2 — file edits via terminal).
**Mac column**: SHIP-NOW.
**Dependency**: last step (wait until all harness PRs are merged so we propagate the final versions).

---

### Wave-Close

- D6: unify dual backlog sources (root BACKLOG.md "5 PRs" stale vs `.planning/backlog.md` 6-PR plan). Declare hierarchy or merge. Update root BACKLOG.md when v2 ships.
- D9: add `validate-doc-update` performance backlog row with owner (avg 160s/call; MCP perf issue, not harness-critical).
- Dead-skill pruning backlog row: 46/61 skills at 0.94% traffic (Part E #17). Owner needed.
- MEMORY.md: write shipped-marker for BL-W47 in the same commit as wave-close (wave-close-in-same-PR rule).

---

## 5. Delta vs v1 — What Changed and Why

| v1 PR | v2 Disposition | Rationale |
|-------|---------------|-----------|
| PR1 Plan-mode Q&A | AMEND | Gap still real; scope-file paths corrected (team-lead.md retired W31.6); pause unified with PR6 |
| PR2 SubagentStart bundles | INVERTED (Part E #2) | File bundles = primary T2 contract; SubagentStart = T3 progressive enhancement gated on PR-0a |
| PR3 Same-name respawn verification | RESOLVED-BY-EVIDENCE → REFRAME | Question answered empirically (suffix, dead-inbox); remainder is rotation doc fix + stale-suffix guard |
| PR4 Adaptive Spawn Table | AMEND (cut to remainder) | Half shipped (selective spawning, task-completion gate); remainder = Spawn Table + classifier + doc contradiction fix |
| PR5 Architect rotation briefs | MERGE/DISSOLVE | Conflicts with persistent-architect doctrine; content absorbed by PR2 bundle design |
| PR6 HOLD preemption | AMEND (re-scoped) | Preemption NOT available (both channels); reframed as cooperative ack-checkpoint; SDK-preemption leg dropped |

**What v2 adds that v1 lacked**:
- A0 portability tier contract (T1/T2/T3 classification per item)
- PR-0a empirical firing matrix (conditions all peer-subject hook work)
- PR-0b portable git/CI layer (git pre-push hook, rtk fix, CI root-garbage check)
- PR-0c hook surgery with measurable targets
- Mechanical wave-class classifier with auto-escalation
- Per-primitive dependency-risk table
- Subagent-first topology pilot with explicit decision gate
- Council design section (planning-phase + QG evolution)
- L1 #26 routing disposition (explicit — not silent)
- Terminal L1/L2 sync step with doctrine adjudication
- All 12 Part D findings with homes (nothing parked)

**v1 legs DROPPED** (with evidence):
- SDK-preemption research: answered NO (both channels, A2)
- Same-name verification: answered empirically (suffix behavior, dead-inbox) — not research, it's a doc fix
- Pre-rotate-brief PR (v1 PR5): conflicts with persistent-architect doctrine; absorbed by PR2 bundles
- v1 pre-flight fossil Steps 2-4: kmp-test-runner at 0.9 vs shipped 0.14.0; L1/L2 syncs done

---

## 6. Minimum Shippable Core vs Extensions

**Core (one wave, sequence-ordered)**:
1. Pre-wave cleanup (D1/D2/D3/D5)
2. PR-0a empirical firing matrix
3. PR-0b portable git/CI layer
4. Ex-PR2 file bundles (T2 primary path only — OQ5 schema + CP write_bundle + spawn prompt mandate)
5. Ex-PR3 rotation doc fix (hard cutover on 4 docs)

This core is fully portable (T1/T2) except PR-0a (which is research, not a hook change). It does not require PR-0a results to ship.

**Extensions (entry criteria required)**:
- PR-0c hook surgery: CONDITIONAL on PR-0a matrix (don't polish potentially-dead-code).
- Ex-PR1 Q&A restoration: independent; low risk; ship alongside core if bandwidth allows.
- Ex-PR2 SubagentStart adapter: requires PR-0a matrix confirmation.
- Ex-PR3 suffix-tolerant hook rewrites: requires PR-0a matrix confirmation.
- Ex-PR4 Spawn Table + classifier: independent; medium complexity; ship after core.
- Ex-PR6 HOLD ack-checkpoint: OQ10 density decision required first.
- Topology pilot: D8 role-attribution (PR-0c) must ship first.
- Council design: design only in v2; implementation explicitly next iteration.
- Terminal L1/L2 sync: last step after all PRs merged.

---

## 7. Explicit Dispositions

**L1 #26 (single-node routing, OPEN CRITICAL)**: not silently accepted. Two paths recorded in Topology Pilot section above. Decision deferred to pilot results — not ACCEPTED-OPEN until pilot data exists.

**3-phase model**: decided by pilot outcome (topology pilot section). Not silently inherited.

**OQ5 (bundle schema)**: first implementation task in Ex-PR2.

**OQ10 (HOLD checkpoint density)**: first task in Ex-PR6.

**`feedback_always_3_architects`**: SUPERSEDED-CANDIDATE per Gate record item 2 and Part E #14. Present the NO-OP stub data (5/9 stub verdicts, kotlin240 zero-ceremony) alongside the memory. Proposed superseding rule: class-scoped architect counts (HARNESS=3, DOC=1) in PR4.

**`RESEARCH-adaptive-harness.md`**: mark SUPERSEDED-BY-AUDIT in terminal sync step.

**BL-W31.7-03 (hook reduction)**: stays OPEN-PARTIAL until PR-0c sets and meets a measurable registration/LOC target (currently 43 registrations / 3,344 LOC; target ≥5 fewer registrations).

---

## 8. Open Questions for User

None blocking plan execution. All 11 OQs from v1 are disposed (Part C). All Part D findings have homes. All 18 Part E findings are reflected in the plan structure.

The one genuine fork the audit leaves open is the L1 #26 routing decision — but this is explicitly conditioned on pilot results, not a planning-time question. The pilot section records both options.

If the topology pilot reveals a third option (e.g., Workflow tool fan-out within the peer-team model), team-lead should surface it before the pilot result is locked. Not blocking; surfacing here for awareness.

---

*Ground truth: `.planning/AUDIT-harness-2026-06.md` (2026-06-11). Do not re-derive. Cite audit sections.*
