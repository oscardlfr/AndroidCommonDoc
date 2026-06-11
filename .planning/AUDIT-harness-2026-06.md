# Harness Audit — 2026-06 (pre-BL-W47 redesign)

> **Date:** 2026-06-11 | **Session:** documentation-only audit (no implementation)
> **Purpose:** Deliverables 1-3 of the BL-W47 redesign mandate: (A) current-state audit of the orchestration harness, (B) per-PR verdict on `.planning/BL-W47-PLAN.md` v1, (C) disposition of its 11 open design questions, (C-bis) plan-council assessment, (D) findings folded into plan homes, (E) adversarial self-audit, (Gate record) closure decisions.
> **Method:** context-provider + 15 single-use research subagents (~2.15M subagent tokens); primitive verification doc-level only (user decision 2026-06-11) via two channels (Context7 `/websites/code_claude` + live WebFetch of code.claude.com docs and CHANGELOG, CLI latest 2.1.173 — caveat: both mirror the same upstream; only local exercise is a true second channel) plus local ground truth from this session's own tooling. An adversarial self-audit pass (18 findings, Part E) was applied 2026-06-11 and OVERRIDES earlier sections where noted. Evidence sources: 99 `feedback_*` + 33 `project_*` memory files, all 34 hooks + 3 git-layer scripts, 16 tl-* + 9 arch-* docs + templates, 6 recent wave dirs, L1 friction log (#1-#115, 100% classified), L2 DawSync incident corpus, 5-week tool-use analytics (21,902 calls).

---

## Part A — Current-state audit

### A0. Governing requirement (user mandate, 2026-06-11): model-agnostic harness

The user's vision: **the harness must be usable with ANY AI model/CLI, not only Claude Code.** Verified status: this requirement appears NOWHERE in BL-W47-PLAN.md, RESEARCH-adaptive-harness.md, `.planning/backlog.md`, or root BACKLOG.md (grep-verified 2026-06-11). The v1 plan — and large parts of this audit's original Part B — anchor on Claude-only primitives (SubagentStart, agent teams, SendMessage, TeammateIdle/TaskCompleted, AskUserQuestion).

Existing seeds of multi-platform support: `setup/copilot-templates/` (49 prompt files + 4 instruction variants), `copilot-adapter.sh` (Wave B), the `copilot` frontmatter field consumed by template-sync-validator, the agentskills.io open-standard pilot (prep-5, WARN-only CI), and the quality-gater "Option B skill abstraction" ruling ("project-agnostic"). None of these covers ORCHESTRATION — they cover skills/instructions consumption only.

**Design principle for v2 (binding):** classify every mechanism as
- **PORTABLE CORE** — file/git/CI contracts: PLAN.md, verdict files, stamps, sentinels, bundle FILES, commit-msg/pre-push git hooks, CI jobs, scripts. Invariants and context handoff MUST live here — they work with any model/CLI that can read files and run git.
- **CLAUDE ADAPTER** — hook events, agent teams, SendMessage, AskUserQuestion, Workflow tool. Acceleration/UX only; never the sole carrier of an invariant.
Every v2 PR carries a "works without Claude Code?" row. (This generalizes the already-proven PR #206 three-layer lesson: the git layer is authoritative precisely because it is universal.)

### A1. System map (as of develop @ 307f15d)

- **Hooks:** 34 files (28 .js + 6 .sh), 43 registrations in `.claude/settings.json` (PreToolUse 30 / PostToolUse 13), 3,344 LOC. Plus git layer: `commit-msg-hook.sh` (universal scope gate, PR #206), `pre-commit-hook.sh` (registry/manifest drift), `install-git-hooks.sh` — **no git pre-push hook exists**. Plus CI: `drift-audit.yml` (hook-manifest-coverage, topology WARN), commit-lint, Detekt.
- **Agents:** 39 manifest keys, exact 1:1 parity `.claude/agents/` ↔ `setup/agent-templates/` (manifest header still says "38/38" — drift). `agent-spawn-validator` blocks non-manifest types + template SHA drift.
- **Topology (documented):** 3-phase model (Plan → Execute → QG). 7 mandatory peers hook-enforced (`wave-topology.yaml`): 3 architects, planner, context-provider, doc-updater, quality-gater. Core specialists: **selective spawning is now MANDATORY** (`tl-session-setup.md` v2 L32-47: scope evaluation table, "Do NOT default to spawning all 5") — but `tl-session-start.md` L228 still says "Spawn the 5 core specialists… No exceptions" (live doc contradiction). Multi-instance/indexed counts do not exist; overflow `{specialist}-2` only on architect request.
- **Gates in force:** premature-execution (APPROVED-PREP literal in `arch-<arch>-verdict.md`), verdict-presence, two-stamp pre-push (quality-gate.stamp + pre-pr.stamp ≤30min), QG sentinel (wave-phase-gate Rule A), plan-md-write (planner-exclusive), CP-consultation, branch-guard, amend-gate, commit-scope (now authoritative at git layer), task-completion (specialists can't self-complete), kmp-test-runner CLI mandate.
- **Template surface:** planner 1.12.0, context-provider 3.4.4, arch-platform 1.32.0, quality-gater 2.11.0, doc-updater 2.10.0 (v1 plan cited 1.10.0/3.4.0/1.27.0 — all stale).

### A2. Verified Claude Code primitives (2026-06-11, doc-level, dual-channel)

| # | Primitive | Verdict | Evidence |
|---|---|---|---|
| 1 | `SubagentStart` hook + `additionalContext` | **VERIFIED-YES** | hooks ref: injection "at the start of the conversation, before the first prompt"; input has `agent_id`/`agent_type` |
| 2 | `SubagentStop` hook | **VERIFIED-YES** | hooks ref + SDK typed input (`agent_transcript_path`, `last_assistant_message`); frontmatter `Stop` auto-converts to `SubagentStop` |
| 3 | Hook event surface | **30 events** per docs site (TS SDK enum lists 20) — incl. `PostCompact`, `TeammateIdle`, `TaskCompleted`, `TaskCreated`, `SessionEnd`, `PermissionRequest`, `WorktreeCreate/Remove` | hooks ref lifecycle table; v1 research knew ~9 |
| 4 | Agent Teams GA? | **VERIFIED-NO — still experimental**, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` required (set in this env), v2.1.32+, "known limitations around session resumption, task coordination, and shutdown" | agent-teams + env-vars docs |
| 5 | SendMessage → stopped **subagent** | **VERIFIED-YES: auto-resumes in background with FULL history** ("picks up exactly where it stopped"); resume is by `agent_id`; `Agent` tool `resume` param removed | sub-agents + tools-reference; exercised live this session (CP follow-up) |
| 6 | SendMessage → dead **teammate** | **UNRESOLVED/negative** — docs: "/resume does not restore in-process teammates… tell the lead to spawn new teammates" | agent-teams Limitations |
| 7 | Same-name respawn semantics | **VERIFIED-NO (undocumented)** + **empirically refuted in L0 twice**: respawn SUFFIXES (`-2/-3`), canonical name routes to dead inbox (feedback_stale_team_suffix_collision; PR #206 saga 2026-06-07: misrouted messages + completeness-gate deadlock) | docs + memory |
| 8 | `TeammateIdle` / `TaskCompleted` hooks | **VERIFIED-YES** — exit 2 on TeammateIdle keeps teammate working; exit 2 on TaskCompleted blocks completion with feedback | agent-teams + hooks ref |
| 9 | `SessionStart` `compact` matcher | **VERIFIED-YES** (plus separate `PreCompact`/`PostCompact` events) | hooks ref matcher table |
| 10 | Native task tools | **VERIFIED-YES** — TaskCreate/TaskGet/TaskList/TaskUpdate default since v2.1.142 (TodoWrite off); persist across compaction; shareable via `CLAUDE_CODE_TASK_LIST_ID` | tools-reference; used live this session |
| 11 | Monitor / Workflow tools | **VERIFIED-YES** — Monitor v2.1.98+; dynamic Workflow v2.1.154+ ("tens to hundreds of agents", judge-panel pattern documented) | tools-reference, workflows, whats-new W15 |
| 12 | Plan-mode clarifying questions | **VERIFIED-YES** ("Clarifying questions are especially common in plan mode"; AskUserQuestion); exercised live this session | agent-sdk/user-input, permission-modes |

**Channel discrepancy note:** Context7 initially returned 11 events, corrected to 20 via TS SDK; live docs list 30. All load-bearing events for this plan were confirmed by BOTH channels.

### A3. Strengths (evidence-backed)

1. **The mechanical floor works where it exists.** Full-team spawn: 1h22m late (L1 #25 CRITICAL) → <1min after team-completeness-gate (#47). Review Depth Mandate: shallow APPROVEs (#29/#30) → architects catching real defects pre-dispatch (#49/#51/#65/#69/#101). Decision relay: 17min gap (#78) → 3min HOLD release (#79) after prep-13 60s SLA. Friction resolution rate: **49/77 non-positive signals RESOLVED (64%), 6/7 CRITICALs closed** — the 22-prep-wave program demonstrably worked.
2. **Architects earn their seat when domain-relevant:** cancellation-detekt ADDENDA A/B (wrong script path would have ENOENT'd doc-updater; sh:102 inventory gap), prep-21 3-field promotion mandate, prep-22 33-vs-34 coverage near-miss, STRICT CE ruling honored in implementation (R4).
3. **Layered enforcement model emerged:** PreToolUse (early feedback) → git hooks (authoritative, universal) → CI (backstop) → manifest coverage (CI-enforced 100%). PR #206 proved the model by porting commit-scope to the git layer after the peer bypass.
4. **The ingestion loop and verdict-to-disk discipline matured:** L1 #58 (CP WebFetch→ingestion "mature"), #80 (all 3 architects persist verdicts), three-stage threat model (#75), grep-evidence mandate (#68/#88).
5. **POSITIVE corpus is large:** 31/108 L1 signals are keep-doing patterns (PRE-DISPATCH audits, CONCERNS-FIRST, planner pre-dispatch audits catching 3-7 BLOCKING each).

### A4. Weaknesses — recurring frictions (each with evidence)

**W1. Enforcement-layer scoping is unverified and partially theater.**
PreToolUse Bash hooks PROVEN not to fire for in-process team peers (feedback_pretooluse_hooks_orchestrator_only, PR #206); Write/Edit/SendMessage/TaskUpdate legs UNVERIFIED. 8 gates are pure peer-subject hooks (architect-bash-write/self-edit/scope, premature-execution, task-completion, verdict-presence, knowledge-currency, CP-gate peer legs) — potentially no-ops for their only subjects. Counter-evidence exists (arch-testing blocked twice in BL-W33; this session's subagents WERE blocked by CP-gate — so hooks DO fire for Agent-tool subagents; the broken class is in-process teammates). **Peer-unguarded invariants with NO backstop: local commits on develop (branch-guard), amend discipline, all three push stamps (no git pre-push hook).** Bonus: `rtk git commit` bypasses branch-guard (`tokens[0] !== 'git'`, branch-guard.js:38) while RTK prefixing is MANDATED. (R2 §2, §4)

**W2. The verdict pipeline is the chronic weak link.**
4 of 6 recent waves show verdict pathologies (R4): prep-19 relay workaround + live-verdict clobber + restore; kotlin240 mangled root paths + empty interpolation holes + missing arch-testing verdict; prep-20 double-spacing; prep-21/22 dual-token single-write stamping (`APPROVED-PREP`+`APPROVED-VERIFY-FINAL` together — hollows the two-phase review). Root cause is structural: Write/Edit denied to arch-* + stale scope gate (W6) pushes architects to hand-rolled Bash/node writes on Windows; architect-verdict-presence-gate's own error text instructs the dangerous heredoc route; architect-bash-write-gate validates the LITERAL string not the effective path (mangled `C:\Users\...` matches the exemption regex) and has a total node-eval blind spot (introduced knowingly BL-W46 PR3). The kotlin240 incident was predicted verbatim by prep-19 WAVE-CLOSE L30 seven days earlier; its audit trail (3 BLOCKERs + 4 fixes) now lives in two unreadable untracked root files. Token appeasement observed: EXECUTE-style audits stamped `APPROVED-PREP` to satisfy the literal-token gate. (R4 §1-2, R2 §5)

**W3. Ceremony scales with hooks, not with risk.**
prep-22: "7-peer team" for a 3-file doc wave; prep-20/21/22: 5 of 9 architect verdicts are NO-OP stubs whose only function is emitting gate tokens; prep-21 PLAN: "All 3 architects spawn upfront (team-completeness-gate requires it)" with 2 pre-declared NOOP. Meanwhile kotlin240 — the heaviest wave (toolchain bump, 12-commit stack) — ran with NO PLAN.md, no QG sentinel, no arch-testing verdict. **Inverse correlation of rigor to risk.** (R4 §4)

**W4. Routing concentrates on one node; identity is fragile.**
L1 #26 (the only OPEN CRITICAL): architects are gates, not delegators — all routing through PM/team-lead single point of failure. Same-name respawn suffixes and dead-inbox messages (twice proven, W7-era + PR #206). No queue/inbox visibility (#8) → premature "unresponsive" escalations. Correction-routing ambiguity (#10/#11). L2's worst incident: PM bypassed the whole chain, spawned anonymous devs — architects idle 11h+, specialists idle 9h+ (S1-I8, user-detected). (R5, R6)

**W5. Context economics are unmanaged.**
35 days of telemetry: 21,902 calls; SendMessage #3 at 15.6% (3,422) — peer messaging is a first-order cost; **62.5% of 2,093 distinct agent IDs made ≤5 tool calls** (42.7% ≤2) — CAVEAT Part E #9: this bucket includes by-design single-use subagents; do NOT read as idle-peer evidence; role attribution missing from the log (D8). Cancellation-detekt: ~70 messages ≈ 40-45K tokens for a 13-commit wave; ≥10 roles. L2 figures: ui-specialist idle = 35K tokens wasted (now cited in tl-session-setup as the selective-spawning rationale); test-specialist context bloat 176k tokens → 4 failed dispatches → fresh anonymous subagent succeeded in one pass; planner W30: 31 tool uses / 64.4k tokens for "4-6 SendMessage roundtrips" of work; CP idle 28min; doc-updater idle 2h. PM file-read bottleneck (#5 HIGH, OPEN) unaddressed — CP pattern lookups don't substitute file-content reads; the memory-validated fix is exactly PR2's bundle concept (DEV_CONTEXT.md "most practical"). Hook overhead: every Bash call spawns ~17 hook processes (×8,193 Bash calls ≈ 139k spawns/35d); `validate-doc-update` averages 160s/call. 48 CP-bypass blocks. 46/61 skills + own MCP at 0.94% of traffic (dead weight). (R8, R6, R4, R2 §4)

**W6. Docs/protocol drift — including self-contradiction.**
tl-session-start L228 ("spawn the 5… No exceptions") vs tl-session-setup v2 selective-spawning MANDATE. tl-session-setup L53/L55-59 + tl-phase-execution L77 + tl-verification-gates L139 + context-rotation-guide all prescribe same-name respawn as "replaces the old peer / clears persistent context" — **empirically false** (suffix collision). architect-scope-gate reads top-level `.planning/PLAN.md` (stale Wave-22 content) while planner writes `wave-<slug>/PLAN.md` — architect Write/Edit is checked against a dead scope list. L2 locally institutionalized spawn-everything-upfront-and-idle (WAVE1-KICKOFF) — directly opposing both old PR4 and L0's own selective-spawning rule. Dual backlog sources (root BACKLOG.md "5 PRs" vs `.planning/backlog.md` 6-PR plan). L0's `cat /dev/stdin` fix (BL-W42 PR4) never propagated to DawSync hooks (still live + registered there). (R3, R6, R4)

**W7. Self-report integrity.**
"Done"/"LOCKED" without applied work: planner FALSE LOCK ×2 in one wave; CP silent truncation + planner padding to fake a matching total (prep-22 near-miss); test-specialist API drift ×3; dev test-gaming ×4+ (proposed `git diff --stat` QG check never shipped); architect false-alarm full cycle burned (cancellation-detekt manifest scare, withdrawn). Mitigations are checklists; only TaskCompleted-class gates are mechanical. (R1a §2, R1b §4, R4)

**W8. Windows-era residue (Mac migration pending ~2026-06-07+).**
Path mangling class unresolved by design (deferred as "obsoleted by Mac migration") — but it cost the kotlin240 audit trail in the interim. `os.tmpdir()` flag state orphans on new sessions; exec-bit CI check never shipped. Several fixes become moot post-migration; the *literal-vs-effective path validation* gap in architect-bash-write-gate does not (backslashes in zsh still differ from JS strings). (R4 §2, R1a §I, R2 §5)

### A5. Token cost vs value of the current topology

- **Cost drivers (measured, attributed signals only per Part E #9):** mandatory 7-peer floor on every wave regardless of size (W3); 15.6% of all tool calls are peer messaging; ~40-45K tokens of messaging per mid-size wave; NO-OP architect ceremony on doc-waves (5/9 stub verdicts); L2 idle incidents (35K ui-specialist, 9-11h architects/devs); 17 hook processes per Bash call.
- **Value delivered (measured):** 64% friction-resolution rate across 22 prep-waves; real defect catches by domain-relevant architects (A3.2); near-miss catches (prep-22 33-vs-34) — concentrated in ONE relevant architect per wave, while the other two stamp tokens.
- **Comparative datapoint:** this audit session ran CP + 14 single-use subagents (~2.05M subagent tokens, zero idle peers, zero ceremony) — the fan-out/synthesis model scales to evidence-heavy work without the floor cost. L2's S1-I4 shows the same: a fresh disposable subagent beat a 176k-token bloated persistent peer.
- **Conclusion:** the topology's value is real but concentrated (1 relevant architect + mechanical gates); its cost is structural (fixed floor + messaging + idle peers). The adaptive direction of BL-W47 remains correct — but the floor itself (not just specialists) is where the waste is.

---

## Part B — Verdict per v1 PR

| v1 PR | Verdict | Summary |
|---|---|---|
| PR1 Plan-mode Q&A + spec-amendment pause | **AMEND** | Gap still real; primitives confirmed; partial overlaps shipped (AMEND-obedience #180, broadcast SLA prep-13, BRIEF-HOOK-CONFLICT prep-12) |
| PR2 SubagentStart bundles + CP cache-slice | **KEEP (INVERTED — see Part E #2)** | Strongest surviving PR, but redesigned: bundle FILES + spawn-prompt reference = PRIMARY (portable, verified-by-construction); SubagentStart injection = optional Claude adapter gated on the PR-0a firing matrix |
| PR3 Same-name respawn verification | **RESOLVED-BY-EVIDENCE → REFRAME** | Question answered (suffixes, doesn't replace; undocumented; SendMessage-resume is the native primitive). Remainder: fix WRONG rotation docs + stale-suffix guard + hook compat |
| PR4 Adaptive Spawn Table + task-completion | **AMEND (cut to remainder)** | Half shipped: selective spawning MANDATORY (tl-session-setup v2), task-completion gate+protocol (prep-10 = Amendment E satisfied). Remainder: multi-instance + adaptive FLOOR + 4 exact-match hook lists + verdict regex + doc contradiction |
| PR5 Architect rotation briefs | **MERGE → dissolve into PR2+PR3 remainders** | Nothing shipped; contradicts persistent-architect doctrine; trigger unbound; with bundles + rotation fix it reduces to "apply bundle-respawn to architects". Real arch cost is NO-OP ceremony (PR4's floor question), not rotation |
| PR6 HOLD preemption | **AMEND (keep, re-scoped)** | True preemption: VERIFIED-NO. Native anchors found: TeammateIdle exit-2 + TaskCompleted exit-2 → ack-checkpoint design. Races still live (2 in cancellation-detekt, 2026-06-10) |

### PR1 — AMEND
- **Still true:** planner 1.12.0 has no clarifying-questions step (no AskUserQuestion in tools; "Open Questions" section is post-hoc and addressed to team-lead). Official docs confirm Q&A as canonical plan-mode behavior. Friction #15/#50/#52 OPEN.
- **Already shipped (do not redo):** planner AMEND Obedience (#180), User Decision Broadcast 60s SLA (prep-13 — closed #76/#78), BRIEF-HOOK-CONFLICT block (prep-12), plan-mode hook skeleton (plan-context, plan-mode-spawn-planner, plan-md-write-gate).
- **Amend:** mechanics = planner SendMessage questions → team-lead relays via AskUserQuestion → planner resumes (SendMessage auto-resume now native). Scope-amendment pause merges with PR6's ack-checkpoint design (one pause primitive, two triggers). Constraint from memory: questions confined to plan-time spec ambiguity (feedback_stop_asking forbids mid-execution question-asking).
- **Scope-file corrections:** v1 targets `setup/agent-templates/tl-session-setup.md:53` and `team-lead.md` — neither exists (docs live in `docs/agents/`; team-lead.md retired W31.6).

### PR2 — KEEP (INVERTED per Part E #2)
- **Confirmed:** SubagentStart + additionalContext (injection pre-first-prompt), SessionStart compact matcher, SubagentStop (OQ8 resolved YES). Zero SubagentStart/SessionStart hooks exist today; plan-context.js is the only additionalContext pattern to copy. Post-compaction resync is currently a manual doc protocol.
- **Evidence demand:** #5 PM read bottleneck (OPEN HIGH), CP idle 28min, doc-updater 2h, DEV_CONTEXT.md named "most practical" fix in memory, tmpdir flag state orphaning on new sessions.
- **Amend:** (a) self-verification leg should anchor on **TaskCompleted exit-2** (native, fires on completion attempt — better than all three options listed in v1 OQ9) with SubagentStop for subagent lifecycle; (b) bundle content rules from memory: PATTERNS-only CP slice, lean standby-only (no work forecasts — feedback_spawn_prompt_hygiene), bundles are rotation/compaction fallback, not default lifecycle (feedback_persistent_dev_model); (c) ~~first task = empirical firing matrix inside PR2~~ **SUPERSEDED by Part E #2/#12: the firing matrix is PR-0a's job (standalone, lands first)** — PR2 must not self-block on its own precondition.
- **INVERSION (Part E #2, binding):** the PRIMARY bundle delivery contract is **file-based**: CP writes `context-bundles/{name}.md`, every spawn prompt carries a mandatory "Read your bundle first" line. This is verified-by-construction, hook-independent, and PORTABLE (A0). `SubagentStart` `additionalContext` injection becomes a progressive enhancement enabled only if PR-0a's matrix proves it fires for the relevant spawn class. Rationale: the audit's original "SubagentStart sidesteps the peer-firing problem" claim contradicted its own W1 (the broken class IS in-process teammates, and respawn targets are teammates).

### PR3 — RESOLVED-BY-EVIDENCE → REFRAME as "rotation & identity fix"
- **Answered:** same-name respawn does NOT replace (suffixes; dead-inbox routing) — docs document no name-reuse semantics; stopped-subagent SendMessage auto-resume (full context) is the native continuation primitive; dead teammates per docs: "spawn new teammates".
- **Consequences:** tl-session-setup L53/L55-59, tl-phase-execution L77, tl-verification-gates L139, context-rotation-guide — ALL prescribe behavior that is empirically false → doc-bug fix, not research. The 2026-06-07 backlog item "stale-suffix spawn guard" MERGES here: guard must block ACCIDENTAL same-name respawn (silent suffix) while allowing INTENTIONAL indexed overflow (`{specialist}-2` is a documented rotation path).
- **Hook compat blockers found (R2):** `agent-spawn-validator` exact `manifest.agents[subagentType]` lookup (indexed instances must vary `name`, never `subagent_type`); `plan-mode-spawn-planner` requires `name === 'planner'` exactly; 4 exact-match agent lists (premature-execution-gate.js:111 SUBJECT_TYPES, specialist-task-completion-gate, knowledge-currency-gate, architect-verdict-presence-gate) + verdict regex `arch-[a-z]+` rejects indexed architects — vs CP hooks already suffix-safe via `startsWith`.

### PR4 — AMEND (cut to remainder)
- **Shipped, do not redo:** selective spawning (subset-of-5, mandatory scope table) + task-completion semantics (specialist-task-completion-gate + protocol ×9 templates, prep-10).
- **Refuted premise:** "fixed 6+5 always" is no longer the documented baseline; native teams topology is dynamic (replacement spawns, TeammateIdle/TaskCreated/TaskCompleted, dependency-aware shared task list).
- **Remainder (the real PR):** (1) Spawn Table artifact in PLAN.md as planner output contract (`|Role|Count|Reason|` — still unshipped, grep-verified); (2) **adaptive mandatory FLOOR by wave class** — the measured waste is the 7-peer floor + 3-arch NO-OP ceremony on doc-waves (W3); collision with feedback_always_3_architects → **USER DECIDED at gate (2026-06-11): adaptive floor APPROVED** — planner proposes counts per wave class via Spawn Table, the floor per class is the hook-enforced minimum, the 3-architects memory becomes superseded-candidate (Part E #14); (3) suffix-tolerant matching in the 4 hook lists + verdict regex; (4) resolve tl-session-start L228 contradiction; (5) reconcile L2's spawn-upfront divergence at next sync.

### PR5 — MERGE (dissolve)
- Nothing shipped; pre-rotate-brief exists only in the plan. Conflicts with persistent-architect doctrine (memory: architects must keep decision rationale across phases). TeammateIdle/TaskCompleted now give native observability; PR2's bundles + PR3's rotation fix make "architect rotation" a parameterization, not a PR. The actual architect cost problem is the mandatory floor (PR4 remainder). Salvage: pre-rotate brief content spec → becomes the bundle-content spec for architect roles in PR2.

### PR6 — AMEND (keep, re-scoped)
- **Resolved negative:** no tool-call interruption/preemption API exists for running agents (both channels). Drop the "research SDK preemption" leg.
- **Native anchors:** TeammateIdle exit-2 (keep working / inject feedback), TaskCompleted exit-2 (block completion) → ack-checkpoint protocol: HOLD takes effect at next checkpoint (file boundary / commit boundary), not mid-write.
- **Evidence still live:** #16/#19/#35/#38 OPEN; 2 hold-vs-commit races in cancellation-detekt (4a supersede; bats atomicity flag — both post-commit, rebase forbidden → accept-with-record); L2 S2-F10 contradictory "CONFIRMED HOLD … dispatch now" message → wrong commit landed.
- **Constraints from memory:** one-topic-per-message discipline exists (CANCEL must be own message); ask-stuck-peers-first rule; platform reality: forced kill historically unreliable, shutdown latency ~38s — design for cooperative checkpoints, not termination.

### NEW candidate the v1 plan lacks (recommendation; SPLIT per Part E #12)
**PR-0a — Empirical firing matrix (pure research, lands FIRST, standalone).** Which hook events fire for (i) main agent, (ii) Agent-tool subagents, (iii) in-process team peers — covering PreToolUse Write/Edit/SendMessage/TaskUpdate legs, SubagentStart/SubagentStop, TeammateIdle/TaskCompleted; plus OQ3's name-vs-subagent_type visibility and D10 (plan-md-write-gate Edit bypass). Its outcome CONDITIONS all hook work in PR-0c/PR2/PR3/PR4 — peer-subject hook edits before the matrix is potential dead-code polishing (Part E #10).
**PR-0b — Portable git/CI layer (model-agnostic authoritative core, per A0).** Git pre-push hook (close the 3-stamp peer bypass — none exists today); evaluate branch-guard + amend-gate git-layer ports; CI root-garbage check (`Users*` files); branch-guard `rtk` prefix fix.
**PR-0c — Hook surgery & consolidation (conditional on PR-0a).** Consolidate the 3-way push gate; remove the dead quality-gate-pre-commit.sh stub (still registered); fix architect-scope-gate stale input (top-level PLAN.md = Wave-22 content — removes the pressure pushing architects into the Bash-heredoc route, W2's root); architect-bash-write-gate literal-vs-effective fix (reject backslash/drive-prefix redirect targets) + node-eval blind spot; **architect verdict-write channel decision** (scoped Write allowlist for `wave-*/arch-*-verdict.md` vs a verdict-writer tool — W2's actual fix) + two-phase-integrity check (single write containing both APPROVED tokens rejected); D8 role-attribution in tool-use-logger + log rotation; D12 CP-gate exemption tuning; D4 manifest count fix.
Scope-creep guard: each sub-PR has its own falsifiable exit; Mac-migration column (SHIP-NOW / MOOT-ON-MAC / DO-ON-MAC) mandatory per item — BACKLOG already ruled the backslash-heredoc class "obsoleted by Mac migration" and PR-0c must adjudicate against that ruling, not ignore it (Part E #6). BL-W31.7-03 (hook reduction) is only PARTIALLY closed by this — set a measurable registration/LOC target or re-mark it open (Part E #17).

---

## Part C — The 11 open design questions

| OQ | Disposition |
|---|---|
| 1. Bundle storage location | **RESOLVED:** `.planning/wave-{slug}/context-bundles/` (wave dirs already gitignored; co-located with verdicts; PATTERNS-only content lowers sensitivity). |
| 2. Bundle TTL | **RESOLVED:** session-scoped; bundle carries `created_at` + wave slug; consumer ignores bundles from a different/older wave. No timer machinery. |
| 3. Indexed-name registry | **RESOLVED (verification folded into PR-0a matrix, Part E #18):** no manifest entries — identity = `name`, role = `subagent_type` (validator keys on type; names free). Required instead: suffix-tolerant matching in 4 hook lists + verdict regex + plan-mode-spawn-planner name check (R2 inventory). PR-0a adds one column: is `name` vs `subagent_type` hook-visible for teammate spawns? |
| 4. Backwards compat (rotation protocol) | **RESOLVED: hard cutover for docs** (current text is factually wrong — flag-gating wrong docs is incoherent); stale-suffix guard ships WARN-first → BLOCK after one wave. |
| 5. CP cache-slice JSON Schema | **CARRY-OVER** to v2 PR2 (first implementation task; PATTERNS-only boundary already ruled, prep-8 Amendment 2b). |
| 6. PR3 rollback plan | **RESOLVED/moot:** remainder is doc fix + additive guard hook with bypass env — trivially reversible; no production rotation change to roll back. |
| 7. Spec-amendment-pause granularity | **RESOLVED:** pause at next ack-checkpoint (file boundary), unified with PR6 mechanism; mid-write interrupt impossible (no preemption API). |
| 8. SubagentStop existence | **RESOLVED: VERIFIED-YES** (2026-06-11, both channels). |
| 9. Self-verification hook event | **RESOLVED-PENDING-MATRIX (downgraded, Part E #8):** `TaskCompleted` exit-2 for teammates + `SubagentStop` for subagents — doc-verified only, never locally exercised; PR-0a must confirm firing. Portable fallback regardless of outcome: TL-side files-vs-claims check on READY-FOR-REVIEW (already protocol). |
| 10. HOLD checkpoint density | **CARRY-OVER (with recommendation):** checkpoint per file-write or commit; ack required only when HOLD pending (no steady-state flood). Tune in v2 PR6. |
| 11. TaskUpdate hook intercept compat | **RESOLVED empirically:** specialist-task-completion-gate shipped prep-10 with exact-match TaskUpdate registration; no double-fire across 12+ subsequent waves. |

---

## Part C-bis — Plan-council assessment (user request 2026-06-11)

**Pattern (verified against karpathy/llm-council):** Stage 1 parallel first opinions from multiple models → Stage 2 anonymized cross-review with ranking → Stage 3 designated chairman synthesizes. Repo is an unsupported "Saturday hack" — pattern adoptable, code not needed.

**Local primitives available today:**
- **Workflow tool judge-panel (native, zero setup):** N independent attempts from different angles → parallel judges → synthesis; supports per-agent `model` overrides. Covers Stages 1-3 intra-Anthropic.
- **Agent tool `model` param (native):** sonnet/opus/haiku/fable diversity for council seats.
- **`ccs` CLI (installed, NOT ready):** binary present, 2 Claude accounts; `profiles: {}` and `oauth_accounts: {}` EMPTY — no GLM/Kimi/Gemini/Codex auth configured. Multi-provider council requires a setup step.
- Anonymization + chairman are prompt-level constructs (no infra).

**Coherent seams in the planning phase:** (a) post-draft PLAN review — council critiques the draft (risks, gaps, alternatives), planner acts as chairman integrating amendments before the user gate; (b) gray-area deliberation (OQ-class questions). Cost mandates **opt-in / flag-gated** (e.g., only harness-touching or HIGH-risk waves) — a per-plan council on every wave contradicts the wave's own token-economy goals.

**User direction (gate, 2026-06-11):** the council orients how BOTH the **planning phase AND the quality gate** will work — v2 must DESIGN that target shape; implementation goes to the NEXT iteration. Note the existing QG protocol is already a proto-council: "QG deliberates with all 3 architects — skipping deliberation voids the gate" is Stage-2-shaped with a mono-model panel. The v2 design therefore specifies: (a) planner protocol seam — optional flag-gated `council` step (draft plan in → independent critiques, anonymized → chairman synthesis out); (b) QG deliberation evolution — the 3-arch deliberation generalized to N council seats with model diversity (Agent `model` param intra-Anthropic now; ccs multi-provider once auth is configured); (c) portability per A0 — council I/O as files (critiques on disk), seat invocation pluggable (Agent tool / external CLI). Implementation: next iteration, as the user mandated.

---

## Part D — Findings folded into the plan (user directive 2026-06-11: "quiero dejar todo perfecto" — nothing parked; the ONLY deferred item is council implementation)

Every finding gets a HOME. "Pre-wave cleanup" = first commits of the v2 wave (or an immediate micro-wave), before PR-0a.

| # | Finding | Evidence | HOME in v2 |
|---|---|---|---|
| D1 | 2 untracked mangled-path root files contain the LOST kotlin240 audit trail (3 BLOCKERs + 4 fixes adjudication) | git status; R4 §2 | **Pre-wave cleanup**: rescue content into `.planning/wave-kotlin240/` with canonical names, then delete strays |
| D2 | Untracked sentinel `.claude/wave-quality-gates/cancellation-detekt.md` | git status | **Pre-wave cleanup**: commit (tracked-sentinel convention since BL-W42) |
| D3 | 29 stale team dirs + 4 dead `session-bl-w48` entries (name burned) | teams dir listing | **Pre-wave cleanup**: TeamDelete sweep; `session-bl-w48` never reused |
| D4 | `agents.manifest.yaml` header "38/38" vs 39 actual | R2/explorer | **PR-0c** (one-line, rides hook surgery) |
| D5 | MEMORY.md 29.9KB > 24.4KB (truncated at load); 58 files unindexed | recon | **Pre-wave cleanup**: index-diet pass (one-line entries; archive pre-May) |
| D6 | Root BACKLOG.md "5 PRs" stale; dual backlog sources of truth | R1; R4 §4 | **v2 wave-close step**: unify or declare hierarchy; BACKLOG updated when v2 ships |
| D7 | DawSync hooks still `cat /dev/stdin` (L0 fix never propagated; registered there) | R6 §2 | **v2 terminal L1/L2 sync step** (owned, with doctrine adjudication — Part E #15) |
| D8 | tool-use-log 20.6MB unrotated; 22.5% calls unattributed; no role attribution | R8 | **PR-0c**: rotation + role/name logging (prereq to MEASURE the topology diet — Part E #9) |
| D9 | `validate-doc-update` avg 160s/call (25× slowest) | R8 | **v2 backlog row with owner** (MCP perf; not harness-critical) |
| D10 | plan-md-write-gate Edit-bypass — verify actually closed | R1b prep-13; R2 | **PR-0a matrix** (one probe) |
| D11 | kotlin240 ran with no PLAN.md/sentinel — process-bypass precedent | R4 §1 | **PR4**: sanctioned fast-path = smallest wave class with minimum invariant set (in-plan, not parked) |
| D12 | CP-gate over-blocking PM meta-reads + misleading error text (L1 #1/#2/#3) | R5 | **PR-0c** |

---

## Part E — Self-audit (adversarial pass, 2026-06-11) — BINDING on v2

Fresh-context adversarial review of this document + the v1 plan (6/6 spot-checked facts held; the attack targets verdict logic, not evidence). 18 findings; where they overturn earlier sections, Part E wins. Full table condensed:

| # | Sev | Finding (condensed) | v2 fix |
|---|---|---|---|
| 1 | HIGH | Zero portability assessment — Part B anchored on Claude-only primitives; A3.3 stated the portable-layer lesson and never generalized it | A0 added (binding); every PR gets "works without Claude Code?" row |
| 2 | HIGH | PR2 anchored on unverified mechanism for the wrong subject class (W1's broken class IS teammates); hookless file-bundle design never weighed as primary | PR2 INVERTED (applied): file+spawn-prompt = primary; SubagentStart = adapter gated on PR-0a |
| 3 | HIGH | Verdict dodged the topology question its own data raises (fan-out beat peers; teams experimental; SendMessage 15.6%) — no PR pilots subagent-first; PR5 dissolved citing doctrine the data undermines | v2 adds: per-primitive dependency-risk table (GA/experimental/undocumented + fallback each); a **subagent-first pilot wave-class** measured vs peer baseline; PR5 re-judged on data |
| 4 | HIGH | L1 #26 (only OPEN CRITICAL: single-node routing, no queue visibility) has NO PR — silence is not a disposition | v2 must include routing work or an explicit ACCEPTED-OPEN line at the user gate |
| 5 | HIGH | Adaptive floor lacked classifier/assignor/escalation (both failure directions already happened: prep-22 over-ceremony, kotlin240 zero-ceremony) | Mechanical path-based classifier: PLAN.md declares class + path manifest; touching `.claude/hooks\|settings.json\|scripts\|setup/agent-templates\|.github` auto-escalates to HARNESS class; out-of-class commit BLOCKS; QG verifies declared-vs-touched; D11 fast-path in PR4 |
| 6 | HIGH | No Mac-migration sequencing (migration IN PROGRESS per BACKLOG; backslash class already ruled "obsoleted by Mac") — PR-0 hardened items against a standing obsolescence ruling | Every PR-0/PR2 item gets SHIP-NOW / MOOT-ON-MAC / DO-ON-MAC column; explicit wave-vs-migration ordering decision |
| 7 | MED | "Dual-channel" verification overstated — Context7 mirrors the same code.claude.com upstream; mirrors diverged on the exact surface (hook events) PR2/PR6 need | Primitive verdicts labeled SINGLE-SOURCE-DOC unless locally exercised; PR-0a is the only true second channel |
| 8 | MED | Live-exercise asymmetry inverted: the 3 NOT-exercised primitives (SubagentStart inject, TeammateIdle, TaskCompleted) are precisely PR2/PR6/OQ9 anchors | OQ9 downgraded (applied); PR6 carries a hookless file/inbox-ack fallback (also the portable variant) |
| 9 | MED | 62.5%-≤5-calls stat double-counts single-use subagents (by-design ≤5 calls) as waste; audit's own 14 subagents sit in that bucket; 2.05M subagent tokens never priced against the 40-45K/wave messaging it criticizes | Do NOT cite 62.5% as idle evidence; floor argument rests on attributed signals (NO-OP verdicts, L2 idle incidents, SendMessage share); D8 role-attribution ships early to measure the diet |
| 10 | MED | Sequencing contradiction: PR3/PR4 mandate suffix-tolerant rewrites of hooks W1 says may be no-ops for peers | All peer-subject hook edits CONDITIONAL on PR-0a outcome; if no-fire → invariants move to git/CI layer |
| 11 | MED | W2's root cause named but never fixed: architects still have NO safe write path; dual-token stamping has zero mechanical countermeasure | PR-0c gains: verdict-write-channel decision (scoped Write allowlist vs verdict-writer tool) + two-phase-integrity check (applied) |
| 12 | MED | PR-0 was 6 sub-items across ≥3 risk domains (scope creep); matrix can't share a PR with work it might invalidate; D12 routed to PR-0 while parked in Part D (self-contradiction) | PR-0 split 0a/0b/0c (applied); Part D re-homed (applied) |
| 13 | MED | Six v1 items the audit never judged | Dispositions below |
| 14 | MED | Floor framed as memory-vs-data deadlock using a 74-day-old memory (`feedback_always_3_architects` predates Review Depth Mandate + selective spawning + all 22 preps; its cross-verify rationale hollowed by 5/9 NO-OP stubs) | Present that memory as SUPERSEDED-CANDIDATE with the NO-OP data; propose class-scoped architect counts (HARNESS=3, doc=1) — consistent with user's adaptive-floor decision at this gate |
| 15 | LOW | L1/L2 sync hand-waved; L2 doctrine (spawn-upfront) actively opposes what v2 will propagate; D7 parked | v2 terminal sync step with owner + per-doctrine divergence adjudication (override vs preserve-local, honoring never-overwrite-L2 memory) |
| 16 | LOW | 64% friction-resolution is self-graded ("RESOLVED" = countermeasure shipped, not recurrence-free) | v2 defines RESOLVED = N waves recurrence-free; redesign success metric defined the same way |
| 17 | LOW | PR-0 overclaimed closing BL-W31.7-03 (no reduction target; 43 registrations / 3,344 LOC / 17 procs-per-Bash untouched; 46/61 dead skills homeless) | PR-0c sets measurable registration/LOC target or 31.7-03 stays open; dead-skill pruning gets a backlog row |
| 18 | LOW | OQ3 resolution asserted, never exercised | Folded into PR-0a matrix (applied) |

**Six v1 items previously unjudged — dispositions:**
1. v1 primitives row "TaskList per-session-lead (assumed shared, wrong)" → **REFUTED-BY-PLATFORM**: tasks now shareable via `CLAUDE_CODE_TASK_LIST_ID` (~/.claude/tasks/); PR4 task design must decide shared-vs-per-lead explicitly.
2. BL-W31.7-05 "eliminate Phase 1/2/3 split" (folded into v1 PR4) → **carried into the topology question (E#3)**: the 3-phase model's keep/kill/reshape is decided by the subagent-first pilot outcome + Spawn Table design, not silently inherited.
3. v1 PR1 `plan-mode-spawn-planner.js` regression-guard bullet → **KEEP inside PR1** (cheap; hook exists and is registered 4×, one leg post-hoc — consolidate while touching).
4. v1 exclusion BL-W31.7-04 (spawn-prompt diet pass 3) → **stays excluded** but PR2 bundle design must not regrow spawn prompts (bundle replaces inline context, not adds to it).
5. v1 pre-flight checklist Steps 2-4 → **FOSSIL, void**: kmp-test-runner cited at 0.9 (shipped is 0.14.0), L1/L2 syncs long done; v2 writes fresh preconditions.
6. `RESEARCH-adaptive-harness.md` → **mark SUPERSEDED-BY-AUDIT** (header note): SubagentStop existence, event count (~9 → 30), same-name semantics, native task/Workflow tools all changed; A2 of this document is the current primitive ground truth.

**Top-5 directives for the v2 planner (binding):**
1. Portability layer-contract per A0 — invariants + context handoff via files/git/CI only; Claude hooks are optional adapters; per-PR "works without Claude Code?" row.
2. PR-0a (firing matrix) is its own first PR; all peer-subject hook work conditional on its outcome.
3. Answer the topology question: subagent-first pilot wave-class + per-primitive experimental-risk table + explicit disposition of the 3-phase model and L1 #26.
4. Mechanical wave-class classifier with auto-escalation + QG declared-vs-touched check; D11 fast-path in-plan; 3-arch memory presented as superseded-candidate with data.
5. Sequence against the in-progress Mac migration (per-item SHIP-NOW/MOOT-ON-MAC/DO-ON-MAC); terminal owned L1/L2 sync step with doctrine adjudication; fresh preconditions; RESEARCH doc marked superseded.

## Gate record — CLOSED 2026-06-11

User decisions captured at the gate (binding inputs to BL-W47-PLAN-v2):
1. **Verdict APPROVED** (Part B table + Part C dispositions + Part E overrides) — final validation pass applied 2026-06-11 (4 patch-desync fixes: PR2 header, PR4 decision recorded, W5/A5 stat caveats, purpose line).
2. **Adaptive floor by wave class: APPROVED** — planner emits Spawn Table (|Role|Count|Reason|) per wave; per-class floor is the hook-enforced minimum; mechanical path-based classifier with auto-escalation (Part E #5); `feedback_always_3_architects` becomes superseded-candidate.
3. **A0 portability: APPROVED as TIERS** — T1 invariants (git/CI, 100% portable), T2 artifacts/protocols (files: PLAN/verdicts/stamps/bundles — portable to any file-reading agent), T3 orchestration (per-platform ADAPTERS, Claude first; A2A protocol = watch-item for cross-platform agent coordination). Full T3 parity is explicitly NOT a v2 goal.
4. **Council: DESIGN in v2, IMPLEMENT next iteration** (user's only deferral) — design covers BOTH the planning phase (flag-gated council step in planner protocol) AND the quality gate (3-arch deliberation generalized to N seats with model diversity); I/O as files per A0.
5. **PR-0a/0b/0c IN SCOPE** (presented package closed by user "haz una ultima validacion y cierra el gate").
6. **Part D: all 12 findings folded into plan homes** (user: "quiero dejar todo perfecto") — nothing parked.
7. Sequencing recommendation accepted as planner input: pre-wave cleanup → PR-0a → PR-0b → PR-B(files) → PR-C(docs+guard) → pilot-informed decisions → PR-D → PR-E; minimum shippable core = cleanup + 0a + 0b + bundles-as-files + rotation-doc fix.

## Appendix — evidence stream index

| Stream | Source | Coverage |
|---|---|---|
| R1a | 99 feedback_* memory files | friction taxonomy, top-10 unenforced lessons, plan contradictions |
| R1b | 33 project_* memory files | wave→harness chronology, mechanical floor inventory, plan-PR overlap |
| R2 | 34 hooks + git layer + manifest | per-hook table, peer-bypass analysis, indexed-name blockers, LOC stats, mangled-path mechanics |
| R3 | 16 tl-* + 9 arch-* + guide + templates | topology ground truth, rotation text, versions, top-5 plan contradictions |
| R4 | 6 recent wave dirs | retro frictions, kotlin240 incident reconstruction, ceremony-vs-risk data |
| R5 | L1 friction log #1-#115 | 100% classification: 49 RESOLVED / 27 OPEN / 1 OBSOLETE / 31 POSITIVE |
| R6 | L2 DawSync corpus | 22-incident catalog, idle-peer economics, doctrine divergences |
| R7 + CP | code.claude.com + Context7 (dual channel) | 12 primitive verdicts, CLI 2.1.173 |
| R8 | tool-use analytics 35d | 21,902 calls, agent long-tail, CP bypasses, dead skills |
| E | adversarial-auditor (fresh context) on this doc + v1 plan | 18 weaknesses; overrides applied in-place; 6/6 fact spot-checks held |
| A0 | grep verification 2026-06-11 | model-agnostic requirement ABSENT from v1 plan + both backlogs; copilot/agentskills seeds inventoried |
