## Architect Verdict: Integration (Wave 31 PREP)

**Verdict: APPROVE with 3 mandatory spec clarifications before dispatch**

---

### Question 1: plan-context.js PreToolUse Write/Edit guard — caller identity vs session flag

**Finding**: Current `plan-context.js` is PostToolUse only (EnterPlanMode). No PreToolUse Write/Edit block exists. Bug 2 confirmed pending.

**Recommendation: session flag approach (safer and testable)**

- **Caller identity** is not reliably available in hook stdin payload — hooks receive `tool_name` + `tool_input`, not agent/process identity. A subagent planner running `Write(path=".planning/PLAN-W31.md")` looks identical to the main context doing the same write.
- **Session flag**: EnterPlanMode PostToolUse hook sets a flag file (e.g. `.planning/.plan-mode-active`) when plan mode is entered. PreToolUse Write/Edit hook reads that flag. If active + target matches `PLAN*.md`, block — UNLESS the write is coming via the hook's own `process.env` sentinel (see below).
- **Planner exception**: planner subagent writes PLAN files legitimately. The cleanest gate is: block ALL writes to `PLAN*.md` when flag is set, then have the planner SKILL.md instruct the planner to call `ExitPlanMode` before writing the file, then re-enter. Alternatively, the hook checks for an env sentinel `PLANNER_WRITE_ALLOWED=1` set by the subagent spawn prompt.

**Concrete proposal for spec**: Use session flag file + ExitPlanMode-before-write pattern. This is testable (integration test reads flag file + asserts block; second test asserts no block after ExitPlanMode clears the flag). Avoid caller-identity approach — it is not reliably surfaced in hook payloads.

---

### Question 2: bash-cli-spawn-gate.js regex coverage

**Finding**: Plan detects `claude --agent-id` and `claude --team-name`. These are the primary patterns but coverage is incomplete.

**Additional patterns to catch**:
- `claude -p` with quoted agent names (e.g. `claude -p "you are team-lead"`) — used as workaround when --agent-id not available
- `claude --print` (alias for -p) with agent persona prompts

**False-positive risk**: `claude --help`, `claude --version`, `claude --dangerously-skip-permissions` are all legitimate main-context Bash uses. The gate should only block when the pattern implies spawning a named agent persona.

**Concrete proposal**: Regex `claude\s+(--agent-id|--team-name|-p\s+["']you are |--print\s+["']you are )`. Test 3 should verify `claude --help` does NOT trigger the block (false-positive regression test).

---

### Question 3: /work SKILL.md + CP gate chicken-and-egg

**Finding** (verified): `skills/work/SKILL.md` line 111/114 already routes team-lead in-process: "Read `.claude/agents/team-lead.md`, act as team-lead in-process." Bug 4's fix is already partially implemented. The plan says "rewrite /work SKILL.md execution model — remove Agent(subagent_type=team-lead)" — confirmed: line 176 already has `NEVER spawn orchestrator agents via Agent()`. The substantive change needed is removing any remaining Agent() call for team-lead if one still exists anywhere in SKILL.md.

**CP gate question**: When main context reads `skills/work/SKILL.md` at `/work` invocation, the CP gate hook fires on the FIRST Grep/Glob/Bash search call, not on Read. Reading SKILL.md via the Read tool is not a search call. No chicken-and-egg issue — the gate only blocks search-type tools, not file reads. SKILL content can be read inline by main context without triggering the gate.

**Verdict on Q3**: No blocker. The plan's fix is correct but the current state may already satisfy Bug 4 — dev must grep for any remaining `Agent(subagent_type="team-lead")` or `Agent(name="team-lead")` in SKILL.md before writing new content. Spec should include this pre-check.

---

### Question 4: Registry rehash scope — generate-registry.js covers SKILL.md?

**Finding**: `generate-registry.js` scans `.claude/agents/*.md` and `skills/*/SKILL.md` for registry entries (based on prior wave history and registry-integration.test.ts). SKILL.md changes DO affect registry hashes. W31-00 touches `skills/work/SKILL.md` — registry rehash is required after that edit.

**No issue**: plan already states "Registry rehash after EVERY template edit round." SKILL.md is covered.

---

### Question 5: l0-manifest.json `migrations_applied` field — schema validator impact

**Finding (BLOCKER — spec gap)**: `ManifestSchemaV2` in `mcp-server/src/sync/manifest-schema.ts` (line 75-85) is a strict Zod schema. It does NOT currently contain a `migrations_applied` field. Adding `"migrations_applied": []` to a consumer's `l0-manifest.json` without updating the Zod schema will cause `validateManifest()` to FAIL with a parse error (Zod strict mode rejects unknown keys by default).

**Mandatory spec addition**: `applyMigrations()` M002 must also update `ManifestSchemaV2` to add `migrations_applied: z.array(z.string()).optional().default([])` AND update `manifest-schema.ts` tests. The plan currently only mentions adding the field to the JSON file — missing the schema update is a guaranteed runtime breakage.

**File to add to scope**: `mcp-server/src/sync/manifest-schema.ts` must be in the W31-03 scope lock.

---

### Question 6: CI Vitest glob coverage for integration tests

**Finding**: `vitest.config.ts` glob is `"tests/**/*.test.ts"` (line 6). This matches `tests/integration/*.test.ts` and `tests/unit/*.test.ts` — both subdirectories are covered. All 6 new W31 test files will be picked up automatically.

**No issue.**

---

### Wiring Verification

| Component | Status |
|-----------|--------|
| plan-context.js PreToolUse (Bug 2) | Spec needs session-flag clarification before dispatch |
| bash-cli-spawn-gate.js (Bug 3) | Regex needs `-p` pattern + false-positive test |
| /work SKILL.md in-process routing | Already partially correct; dev must pre-check before rewrite |
| migrations_applied + Zod schema | HARD BLOCKER — manifest-schema.ts must be in scope |
| Vitest glob for integration tests | Covered — no action needed |
| Registry rehash post-SKILL.md | Covered by plan |

### Escalated Items

None — all issues are resolvable within W31-03 scope with spec amendments.

### Cross-Architect Checks

- arch-platform: Q3 /work routing confirmed already correct — no new routing change needed beyond confirming no Agent() spawn remains
- arch-testing: integration test glob confirmed covered

