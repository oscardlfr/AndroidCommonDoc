# T02: 07-consumer-guard-tests 02

**Slice:** S03 — **Milestone:** M002

## Description

Validate guard templates by installing them in DawSync (full architecture scan), DawSync worktree track-E (canary pass on feature branch), and OmniSound (canary pass), proving the end-to-end flow works from install to test execution across multiple consumers and worktrees.

Purpose: GUARD-03 requires validation against at least one consuming project. DawSync gets a full scan (all guard tests run against real code). The DawSync worktree at `.claude/worktrees/track-E` (branch: `feature/precloud-full-test-coverage-wave`) gets a separate install to validate that guard tests work in git worktree checkouts -- per user decision "Validate in DawSync worktree as well." OmniSound gets a canary pass (templates install and scope assertions confirm non-empty). Any architecture violations found in DawSync are reported to the user for fix in their track-E terminal -- we do NOT fix consumer code in this phase.

Output: konsist-guard/ modules installed and validated in DawSync (main + worktree) and OmniSound. Checkpoint for violation triage.

## Must-Haves

- [ ] "Install script runs successfully against DawSync producing konsist-guard/ module"
- [ ] "DawSync guard tests compile and run via ./gradlew :konsist-guard:test"
- [ ] "DawSync canary assertion confirms non-empty scope under com.dawsync"
- [ ] "Install script runs successfully against DawSync worktree (track-E) producing konsist-guard/ module"
- [ ] "DawSync worktree guard tests compile and canary passes"
- [ ] "OmniSound install produces konsist-guard/ module with canary pass"
- [ ] "Architecture violations in DawSync (if any) are reported to user, not fixed"
- [ ] "All three consumer settings.gradle.kts files include ':konsist-guard'"

## Files

- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
