# Wave 21 Plan — Chain 1+2+3+4

> Generated: 2026-04-20
> Status: LOCKED FOR DISPATCH
> Branch: feature/wave21-enforcement-portability (create from develop)

---

## Context (from context-provider + reference files)

### Wave 20 close-out state
- Two PRs #53 + #54 merged to `develop` @ `7703566` (top of branch)
- 2082 unit tests green, 25 /work routing tests locked
- Registry: 152 entries (61 skills + agents + commands), all hashes current
- `skills/registry.json` `l0_root` confirmed hardcoded: `C:\Users\34645\AndroidStudioProjects\AndroidCommonDoc`

### Recurring frictions targeted by this wave
1. Registry hash drift caught 2x (quality-gater retry + CI fail) — needs pre-commit hook
2. `readme-audit.sh --fix` is a no-op — doc-updater manually fixed 27-item drift in Wave 20
3. `l0_root` hardcoded path breaks portability across machines
4. Scope-extension protocol violated 2x by architects — feedback memory is insufficient enforcement

### Key infrastructure verified
- `scripts/sh/rehash-registry.sh` — supports `--check` flag (exit 1 if stale), Python-based, CI-proven
- `scripts/sh/install-git-hooks.sh` — already exists, installs `pre-commit` (pattern-lint) + `commit-msg`
- `scripts/tests/rehash-registry.bats` — 14 tests covering rehash + check modes
- `scripts/tests/*.bats` — run via `npx bats scripts/tests/*.bats` in CI (reusable-shell-tests.yml)
- CI already runs `rehash-registry.sh --check` in `skill-registry` job (l0-ci.yml:214-216)
- `readme-audit.sh` — 370 lines, 10 audit categories, `FIX_MODE=false` flag parsed but body unused
- `mcp-server/src/registry/skill-registry.ts` — `l0_root: rootDir` written at line 466 (generateRegistry)
- `mcp-server/src/sync/sync-engine.ts` — reads `l0_root` at line 759 for merge context only
- `docs/guides/` — NO `pre-commit-hooks.md` yet (confirmed absent)
- `docs/agents/` — NO `scope-extension-protocol.md` yet (confirmed absent)
- `.claude/hooks/` — no architect-scope-gate hook (confirmed absent)

---

## Scope summary

- Sprint 1: Registry rehash pre-commit hook
- Sprint 2: `readme-audit.sh` FIX_MODE implementation
- Sprint 3: `l0_root` portability in registry.json + generator
- Sprint 4: Architect scope-extension mechanical gate (Option A with escape hatch)

**Ordering rationale**: Sprints 1+2+3 land first (no gate dependency). Sprint 4 lands last — its gate applies to Wave 22+, not retroactively to Sprints 1-3 of this wave.

---

## Wave 1 — Registry Rehash Pre-Commit Hook

**Goal**: Mechanically prevent Wave 20's 2x pattern where SKILL.md edits committed without subsequent rehash.

### Scope files (machine-readable)
- `scripts/sh/install-git-hooks.sh` (MODIFY — copy/source pre-commit-hook.sh into .git/hooks/pre-commit during install)
- `scripts/sh/pre-commit-hook.sh` (NEW — standalone hook script body, sourced by install-git-hooks.sh)
- `scripts/tests/pre-commit-hook.bats` (NEW — bats coverage)
- `docs/guides/pre-commit-hooks.md` (NEW — guide doc)
- `CLAUDE.md` (MODIFY — add pointer to pre-commit-hooks.md, NOT inline content)
- `.github/workflows/l0-ci.yml` (VERIFY ONLY — CI already has rehash check; confirm no gap)
- `.gitignore` (MODIFY — add entries: .androidcommondoc/, .gsd/milestones/, .claude/scheduled_tasks.lock)

**Out of scope for Wave 1**: `.git/hooks/` (runtime artifact, not committed), Husky (not in use).

### Layer evaluation
| Layer | Tasks | Spawn? |
|---|---|---|
| test | bats tests for hook | YES |
| ui | none | SKIP |
| domain | none | SKIP |
| data | none | SKIP |

### Architect routing
- **arch-platform**: Implement the rehash pre-commit hook as a split: standalone script + installer update.
  1. Write NEW `scripts/sh/pre-commit-hook.sh` — standalone hook body: detects staged `skills/*/SKILL.md` or `skills/registry.json` → runs `bash scripts/sh/rehash-registry.sh --project-root "$(pwd)" --check` → exit non-zero with clear message if stale. Supports `--verbose` flag for debug output.
  2. Modify `scripts/sh/install-git-hooks.sh` — copy/source `scripts/sh/pre-commit-hook.sh` into `.git/hooks/pre-commit` during install.
  3. Write `docs/guides/pre-commit-hooks.md` (new doc, ≤300 lines)
  4. Add 1-line pointer in `CLAUDE.md` under Commands section (e.g., `- Pre-commit hooks: see docs/guides/pre-commit-hooks.md`)
  5. Update `.gitignore` to silence 3 runtime artifact paths: `.androidcommondoc/`, `.gsd/milestones/`, `.claude/scheduled_tasks.lock`

- **arch-testing**: Review the bats test spec below and confirm or refine before dispatch to test-specialist.

- **arch-integration**: Verify `l0-ci.yml` skill-registry job already covers rehash check (confirmed at line 214-216). Report to PM before touching CI file if gap found.

### Dev dispatch specs
- **test-specialist** (spawn): Write `scripts/tests/pre-commit-hook.bats` covering:
  - (a) clean commit (no SKILL.md staged) → hook exits 0, no rehash check invoked
  - (b) SKILL.md staged with stale hash → hook exits non-zero with error message
  - (c) SKILL.md staged with fresh hash → hook exits 0
  - (d) `registry.json` staged with stale hash → hook exits non-zero
  - (e) non-SKILL.md changes only → hook skips check entirely
  - Use tmpdir fixture pattern from `rehash-registry.bats` (setup/teardown with mktemp -d)
  - Test the hook script output, NOT the `install-git-hooks.sh` installer

### Acceptance criteria (quality-gater Phase 3)
- [ ] `install-git-hooks.sh` generates a pre-commit hook that runs rehash check on SKILL.md/registry.json changes
- [ ] All 5 bats test cases pass via `npx bats scripts/tests/pre-commit-hook.bats`
- [ ] `docs/guides/pre-commit-hooks.md` created (≤300 lines), linked from guides-hub
- [ ] CLAUDE.md updated with pointer (NOT inline content — pointers only per CLAUDE.md constraint)
- [ ] CI `rehash-registry.sh --check` step confirmed present — no new CI job needed
- [ ] `readme-audit.sh` clean after adding new doc/script entries
- [ ] `git status` shows clean working tree (no untracked runtime artifacts)
- [ ] `scripts/sh/pre-commit-hook.sh` exists as standalone script (not heredoc-only)
- [ ] `install-git-hooks.sh` sources `pre-commit-hook.sh` at install time

---

## Wave 2 — `readme-audit.sh` FIX_MODE Implementation

**Goal**: Make `--fix` functional so future doc drift can be auto-remediated without manual edits.

### Scope files (machine-readable)
- `scripts/sh/readme-audit.sh` (MODIFY — implement FIX_MODE branches)
- `scripts/ps1/readme-audit.ps1` (VERIFY — check if PS1 version exists; if yes, update for parity)
- `scripts/tests/readme-audit-fix.bats` (NEW — golden-file bats tests)
- `skills/readme-audit/SKILL.md` (MODIFY — update description to clarify FIX_MODE is now implemented)

### Fixable checks (from script audit)
The following `add_finding` calls already pass `"true"` as fixable flag — implement FIX_MODE for each:

1. **Check 1 (SKILL TABLE COUNT)**: Update `Available Skills (N)` header in AGENTS.md to `$actual_skill_count`
2. **Check 1 (MISSING SKILL ROW)**: Append skill row to AGENTS.md table (skill name + description from SKILL.md frontmatter)
3. **Check 1 (PHANTOM SKILL ROW)**: Remove phantom row from AGENTS.md table
4. **Check 2 (MCP TOOL COUNT)**: Update `MCP Tools (N)` header in AGENTS.md
5. **Check 2 (MISSING MCP ROW)**: Append tool row to AGENTS.md
6. **Check 2 (PHANTOM MCP ROW)**: Remove phantom row
7. **Check 3 (MISSING AGENT ROW)**: Append agent row to README.md agents table
8. **Check 4 (MISSING SCRIPT ROW)**: Append script row to README.md scripts table
9. **Check 4 (PHANTOM SCRIPT ROW)**: Remove phantom row
10. **Check 5 (MISSING GUIDE LINK)**: Append link to `docs/guides/guides-hub.md`
11. **Check 6b (MISSING HUB ROW in README DOC TABLE)**: Add hub row to README Documentation table
12. **Check 6b (HUB COUNT MISMATCH)**: Update count comment in README Documentation table
13. **Check 7 (PROSE COUNT)**: Update number in prose (MCP tools, Detekt rules, guides, sub-docs, commands)
14. **Check 8 (SCRIPT TREE COUNT)**: Update count comment in README project tree

**Non-fixable checks** (leave as audit-only): broken-link checks, cross-references requiring human judgment.

**Implementation note**: Use Python3 for in-place file edits, NOT `sed -i` — Windows CRLF safety (same lesson as MIGRATIONS.json repair in Wave 20).

### Layer evaluation
| Layer | Tasks | Spawn? |
|---|---|---|
| test | golden-file bats tests | YES |
| ui | none | SKIP |
| domain | none | SKIP |
| data | none | SKIP |

### Architect routing
- **arch-platform**: Implement FIX_MODE branches in `readme-audit.sh`. After the report block (after line ~337), add a `fix_findings()` function that iterates `FINDINGS[]` where `fixable=true` and applies Python3 in-place edits to README.md / AGENTS.md. Preserve audit-only path as default. Update `skills/readme-audit/SKILL.md` frontmatter description after implementation.

- **arch-testing**: Review bats golden-file spec. Confirm approach: minimal fixture README.md + AGENTS.md in tmpdir, run `--fix`, assert output matches expected state.

- **arch-integration**: Check if `scripts/ps1/readme-audit.ps1` exists. Report to PM before touching it. Script-parity validator enforces parity — if PS1 exists, it needs updating.

### Dev dispatch specs
- **test-specialist** (spawn): Write `scripts/tests/readme-audit-fix.bats` with golden-file tests:
  - Setup: tmpdir with fixture README.md (stale counts), fixture AGENTS.md (missing skill row)
  - Test (a): `--fix` updates skill count header correctly
  - Test (b): `--fix` adds missing skill row
  - Test (c): `--fix` removes phantom row
  - Test (d): `--fix` updates prose count (MCP tools number)
  - Test (e): audit-only mode (no `--fix`) does NOT modify files
  - Each test: compare file content before/after via `diff` or string match

### Acceptance criteria (quality-gater Phase 3)
- [ ] `readme-audit.sh --fix` actually modifies README.md/AGENTS.md for the 14 fixable checks
- [ ] Audit-only mode unchanged (default, no `--fix`)
- [ ] All golden-file bats tests pass
- [ ] PS1 parity assessed — either updated or documented as out-of-scope with justification
- [ ] `skills/readme-audit/SKILL.md` hash rehashed after edit
- [ ] Full bats suite (`npx bats scripts/tests/*.bats`) passes

---

## Wave 3 — `skills/registry.json` `l0_root` Portability

**Goal**: Remove hardcoded Windows absolute path from committed `registry.json`.

### Scope files (machine-readable)
- `mcp-server/src/registry/skill-registry.ts` (MODIFY — change `l0_root: rootDir` to `l0_root: "."`)
- `skills/registry.json` (MODIFY — value updated by re-running generate-registry.js)
- `mcp-server/tests/` (VERIFY — check for tests asserting absolute l0_root; update if found)

### Decision: Option (a) — relative path `"."`

Rationale:
- `registry.json` lives at `skills/registry.json` — consumers resolve relative to repo root
- `sync-engine.ts:759` reads `l0_root` for merge context only (runtime resolution from projectRoot, not from registry file)
- Simplest change: `l0_root: "."` in generated output
- No placeholder substitution needed at sync-l0 time
- Update `generateRegistry()` in `skill-registry.ts` line 466: `l0_root: "."` (constant, not `rootDir`)

**Risk**: If any MCP tool reads `registry.json.l0_root` and uses it as an absolute path for file I/O, this breaks. arch-integration MUST grep all `l0_root` consumers before dev dispatch. Confirmed so far: only `skill-registry.ts:466` (write) and `sync-engine.ts:759` (runtime merge context — safe).

### Layer evaluation
| Layer | Tasks | Spawn? |
|---|---|---|
| test | unit test update if needed | CONDITIONAL |
| ui | none | SKIP |
| domain | none | SKIP |
| data | none | SKIP |

### Architect routing
- **arch-platform**: Change `generateRegistry()` in `skill-registry.ts` to write `l0_root: "."`. Then run `node mcp-server/build/cli/generate-registry.js` and `bash scripts/sh/rehash-registry.sh --project-root .` to regenerate registry with new value. Commit registry.json + skill-registry.ts together.

- **arch-integration**: Before dev dispatch — grep all `mcp-server/src/` for `l0_root` consumers. Confirmed safe: only `sync-engine.ts:759`. If additional consumers found, report to PM before dispatch. Confirm CI `mcp-server` job passes after change.

- **arch-testing**: Check `mcp-server/tests/` for registry shape tests. If test asserts `l0_root` equals absolute path, flag for update. Otherwise, add assertion that `l0_root === "."`.

### Dev dispatch specs
- **data-layer-specialist** (conditional): Only spawn if arch-testing finds consumer tests that need updating.

### Acceptance criteria (quality-gater Phase 3)
- [ ] `skills/registry.json` `l0_root` value is `"."` (not a Windows absolute path)
- [ ] `node mcp-server/build/cli/generate-registry.js` generates `l0_root: "."` reproducibly
- [ ] `bash scripts/sh/rehash-registry.sh --check` exits 0 after regen
- [ ] MCP server builds and all existing tests pass (`cd mcp-server && npm test`)
- [ ] No `l0_root` consumers broken (verified by grep + test run)

---

## Wave 4 — Architect Scope-Extension Mechanical Gate (Option A)

**Goal**: Move scope-extension enforcement from feedback-memory (gameable) to a PreToolUse hook that blocks Write/Edit on out-of-scope files by arch-* agents.

### Chosen approach: Option A — PreToolUse hook on architect Write/Edit

**Escape hatch**: `SCOPE_GATE_DISABLE=1` env var bypasses gate but logs bypass to `.planning/scope-gate-bypasses.log` with timestamp + file + agent.

**Scope source**: `.planning/PLAN.md` — current wave's scope files sections parsed as machine-readable list (already structured as bullet lists in this plan). Hook reads PLAN.md and extracts lines matching `- \`path/to/file\`` pattern from the active wave section.

### Scope files (machine-readable)
- `.claude/hooks/architect-scope-gate.js` (NEW — PreToolUse hook)
- `docs/agents/scope-extension-protocol.md` (NEW — formalizes authorization workflow)
- `.claude/settings.json` (MODIFY — register new hook for PreToolUse)

### Layer evaluation
| Layer | Tasks | Spawn? |
|---|---|---|
| test | hook unit tests | YES |
| ui | none | SKIP |
| domain | none | SKIP |
| data | none | SKIP |

### Architect routing
- **arch-integration**: Design and spec the hook contract. The hook:
  1. Reads agent identity from `CLAUDE_AGENT_ID` env var or equivalent — if non-arch caller, allow (fail-open)
  2. Reads `tool_input.path` (Write) or `tool_input.file_path` (Edit) from the tool call JSON
  3. Reads `.planning/PLAN.md` and extracts scope-file lines (pattern: `- \`<path>\`` in Scope files sections)
  4. Compares normalized target path against scope list
  5. If not in scope AND `SCOPE_GATE_DISABLE != "1"` → return `{"decision": "block", "reason": "File <X> not in current wave scope. SendMessage team-lead for authorization."}`
  6. If `SCOPE_GATE_DISABLE=1` → append to `.planning/scope-gate-bypasses.log` → allow
  7. Register hook in `.claude/settings.json` hooks array as PreToolUse for Write + Edit tools

- **arch-platform**: Write `docs/agents/scope-extension-protocol.md` (≤300 lines) formalizing:
  - When scope extension is required (any file not in PLAN.md scope list)
  - How to request authorization (SendMessage team-lead format with: blocker, proposed fix, file, wave)
  - How to use bypass escape hatch (`SCOPE_GATE_DISABLE=1`) and view bypass log
  - Pointer to `.planning/PLAN.md` as canonical scope source

- **arch-testing**: Spec unit tests for the hook in Node.js (co-locate with `mcp-server/tests/` or `scripts/tests/scope-gate.test.js`). Cover: in-scope file → allow, out-of-scope → block, bypass env var → allow + log written, non-arch agent → allow.

### Dev dispatch specs
- **test-specialist** (spawn): Write unit tests for `.claude/hooks/architect-scope-gate.js` per arch-testing spec. Use Node.js assert or Jest (check existing test harness in `mcp-server/tests/`).

### Acceptance criteria (quality-gater Phase 3)
- [ ] Hook blocks arch-* Write/Edit for out-of-scope files (verified by manual test)
- [ ] Hook allows in-scope files without friction
- [ ] `SCOPE_GATE_DISABLE=1` bypass works and writes to `.planning/scope-gate-bypasses.log`
- [ ] Non-arch agents unaffected (fail-open for unknown agent IDs)
- [ ] Hook registered in `.claude/settings.json`
- [ ] `docs/agents/scope-extension-protocol.md` created (≤300 lines), linked from docs/agents hub
- [ ] Unit tests pass

---

## Wave Sequence & Dependencies

```
Wave 1 (hook)     ──┐
Wave 2 (fix)        ├──→ independent, run in parallel
Wave 3 (l0_root)  ──┘
                      ↓
Wave 4 (gate)     ── runs after Waves 1-3 committed (gate scopes future waves, not W21 retroactively)
```

- **Wave 1 + Wave 2 + Wave 3**: fully independent, can execute in parallel across dev teams
- **Wave 4**: must run after Waves 1-3 are committed so scope-gate applies to Wave 22+ only
- **Single PR strategy**: all 4 waves on `feature/wave21-enforcement-portability`, one PR to develop

---

## Cross-Department Impact

- Product: none
- Marketing: none
- CLAUDE.md: pointer-only update (Wave 1) — no inline content added per CLAUDE.md constraint

---

## Risks

| Risk | Mitigation |
|---|---|
| Hook `CLAUDE_AGENT_ID` env var unavailable in hooks context | arch-integration prototypes detection first; fallback: fail-open (allow) for unidentifiable callers |
| `readme-audit.sh --fix` sed edits corrupt README.md on Windows (CRLF) | arch-platform: use Python3 for in-place edits, NOT `sed -i` (same lesson as Wave 20 MIGRATIONS.json) |
| `l0_root: "."` breaks sync-engine.ts runtime consumer | Confirmed safe at line 759 (merge context only, not file I/O); grep before dispatch |
| Pre-commit hook slows commits for non-SKILL.md changes | Hook exits 0 immediately when no SKILL.md or registry.json staged — O(1) check |
| Wave 4 gate blocks legitimate fixes during Wave 22 before authorization | Escape hatch + bypass log provides authorized path |
| Registry regen after l0_root change triggers drift | Sequence: generate-registry.js → rehash-registry.sh → commit. Acceptance criteria blocks otherwise |
| New bats files (pre-commit-hook.bats, readme-audit-fix.bats) increase CI time | Minimal — bats suite is already fast; acceptable regression |

---

## Verification

After each wave:
1. `npx bats scripts/tests/*.bats` — all bats tests pass
2. `cd mcp-server && npm test` — TS unit tests pass
3. `bash scripts/sh/readme-audit.sh --project-root .` — 0 HIGH findings
4. `bash scripts/sh/rehash-registry.sh --project-root . --check` — exit 0
5. Wave 4 only: manually trigger scope-gate with an out-of-scope Edit — confirm block message

---

## LOCK SIGNATURE
LOCKED FOR DISPATCH — 2026-04-20 — file line count: 273
