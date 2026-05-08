# arch-testing Verify — BL-W44-S2 PR4

**Verdict: APPROVE**

## Modules Tested
- vitest (mcp-server): PASS — 2532/2532
- bats validate-agent-templates.bats: PASS — 4/4
- bats copilot-templates-stability.bats: PASS — 4/4
- bats architect-bash-write-gate.bats: PASS — 84/84 (5 new BL-W44-S2 cases at #80-#84)

## Commit-by-Commit Analysis

### Commit 1: plan-mode-spawn-planner sentinel fix
File: mcp-server/tests/unit/hooks/plan-mode-spawn-planner.test.ts
Count: 7 it() blocks confirmed.
Coverage:
- EnterPlanMode from subdirectory writes sentinel to project root, not subdir (#1)
- walk-up fallback via .git marker when git rev-parse fails (#2)
- walk-up fallback via mcp-server/package.json marker (#3)
- EnterPlanMode from project root writes sentinel (#4)
- CLAUDE_SKIP_PLANNER=1 does not write sentinel (#5)
- ExitPlanMode PostToolUse deletes sentinel from project root regardless of cwd (#6)
- ExitPlanMode PostToolUse is no-op when sentinel does not exist (#7)
Quality: Uses spawnSync with fake git binary for fallback path; real tmpdir teardown; cwd-independence proven by root vs subdir assertion. Behavioral.

### Commit 2: architect-bash-write-gate isExemptTarget for wave-quality-gates
File: scripts/tests/architect-bash-write-gate.bats (existing suite extended)
Choice rationale: bats is correct for this hook — the gate runs as a Bash hook (Node.js CLI) and
the existing 79-test coverage base already lives in bats. Vitest would require a module shim for
isExemptTarget(); bats tests the real hook end-to-end via cat|node invocation. Correct choice.
New cases (tests #80-#84):
- ALLOW: redirect to .claude/wave-quality-gates/arch-platform-prep-*.md (#80)
- ALLOW: redirect to .claude/wave-quality-gates/arch-testing-verify-*.md (#81)
- ALLOW: redirect to .claude/wave-quality-gates/arch-integration-light-*.md (#82)
- BLOCK: redirect to .claude/wave-quality-gates/bl-w44-s2-pr1.md (sentinel, no arch- prefix) (#83)
- BLOCK: redirect to docs/agents/foo.md (arbitrary project path) (#84)
All 84/84 pass including all pre-existing cases (regression-clean).

### Commit 3: validate-agent-templates Check 7 jq tuple lookup
File: scripts/tests/validate-agent-templates.bats (new file)
Count: 4/4 confirmed.
Coverage:
- Registered (name, version) tuple PASS (#1)
- Name registered, version missing FAIL (#2)
- Version exists for DIFFERENT agent FAIL — the false-positive regression (#3)
- MIGRATIONS.json missing graceful skip (#4)
Quality: make_fixtures helper builds realistic MIGRATIONS.json + template file in BATS_TEST_TMPDIR.
Test #3 is the load-bearing regression case: agent-a claims 2.0.0, only agent-b owns 2.0.0 — must FAIL.

### Commit 4: copilot-templates investigation
File: scripts/tests/copilot-templates-stability.bats (new file)
Count: 4/4 confirmed.
Coverage:
- generate-registry.js leaves file byte-identical (#1)
- registry run introduces no new git diff to the file (#2)
- Stale Regenerate instruction absent (#3)
- MANUALLY MAINTAINED comment present (#4)
Quality: Tests #1+#2 are independent verification methods for the same invariant (belt+suspenders).
setup_file skip guard when build not present prevents false failure in CI without build.

## Bats Choice Validation (Commit 2)
Dispatch said vitest per original dispatch but test-specialist confirmed bats.
CORRECT: architect-bash-write-gate.js is a Node.js CLI invoked as a shell hook.
The entire test suite uses cat|node end-to-end invocation. Adding 5 vitest unit tests
for isExemptTarget() in isolation while 79 integration tests already cover it would be
redundant and inconsistent with project convention. Bats confirmed correct.

## Issues Found
None.

## Cross-Architect Checks
- arch-platform: APPROVE on disk (arch-platform-prep-bl-w44-s2-pr2.md per dispatch)

## Evidence
- vitest: 2532/2532 pass (21350ms)
- bats validate-agent-templates.bats: 4/4 pass
- bats copilot-templates-stability.bats: 4/4 pass
- bats architect-bash-write-gate.bats: 84/84 pass
- Vitest [EXPECT FAIL] tests in rtk output are intentional (skill-routing-validation expected failures)