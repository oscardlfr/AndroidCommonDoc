#!/usr/bin/env bats
#
# Tests for .claude/hooks/branch-guard.js (BL-W35-08).
# test-infra: bats fixture-driven (Approach A -- PATH stub, cross-platform).
# On Windows/Git Bash: .cmd fake git + Windows-format PATH (cygpath).
# On Linux/macOS: shell fake git + Unix PATH.
# FAKE_GIT_BRANCH env var controls the branch reported by the fake git.

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/branch-guard.js"

setup() {
  FAKE_BIN="$BATS_TEST_TMPDIR/fake-bin-$$"
  mkdir -p "$FAKE_BIN"

  if command -v cygpath >/dev/null 2>&1; then
    # Windows / Git Bash: node execSync uses Windows-style PATH
    printf '@echo off\r\nif "%%1"=="rev-parse" if "%%2"=="--abbrev-ref" if "%%3"=="HEAD" (\r\n  echo %%FAKE_GIT_BRANCH%%\r\n  exit /b 0\r\n)\r\n"C:\\Program Files\\Git\\cmd\\git.exe" %%*\r\n' \
      > "$FAKE_BIN/git.cmd"
    FAKE_PATH="$(cygpath -w "$FAKE_BIN");${PATH}"
  else
    # Linux / macOS: standard shell stub + Unix PATH
    cat > "$FAKE_BIN/git" <<'GIT_STUB'
#!/usr/bin/env bash
if [ "$1" = "rev-parse" ] && [ "$2" = "--abbrev-ref" ] && [ "$3" = "HEAD" ]; then
  echo "${FAKE_GIT_BRANCH:-detached-head-stub}"
  exit 0
fi
exec /usr/bin/git "$@"
GIT_STUB
    chmod +x "$FAKE_BIN/git"
    FAKE_PATH="$FAKE_BIN:$PATH"
  fi

  INPUT_FILE="$BATS_TEST_TMPDIR/input.json"
}

teardown() {
  rm -rf "$BATS_TEST_TMPDIR/fake-bin-$$" "$INPUT_FILE"
}

make_input() {
  local cmd="$1" tool="${2:-Bash}"
  python3 -c "
import json, sys
sys.stdout.write(json.dumps({'tool_name': '$tool', 'tool_input': {'command': '$cmd'}, 'session_id': 'test', 'agent_type': 'team-lead'}))
" > "$INPUT_FILE"
}

# ── Block scenarios ─────────────────────────────────────────────────────────

@test "blocks git commit on develop" {
  make_input 'git commit -m "msg"'
  run env "PATH=$FAKE_PATH" FAKE_GIT_BRANCH="develop" bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"git checkout -b feature/"* ]]
}

@test "blocks git merge on develop" {
  make_input "git merge origin/feature/foo"
  run env "PATH=$FAKE_PATH" FAKE_GIT_BRANCH="develop" bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 2 ]
}

@test "blocks git merge --ff-only on develop" {
  make_input "git merge --ff-only origin/feature/foo"
  run env "PATH=$FAKE_PATH" FAKE_GIT_BRANCH="develop" bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 2 ]
}

@test "blocks git rebase on develop" {
  make_input "git rebase main"
  run env "PATH=$FAKE_PATH" FAKE_GIT_BRANCH="develop" bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 2 ]
}

@test "blocks git cherry-pick on develop" {
  make_input "git cherry-pick abc123"
  run env "PATH=$FAKE_PATH" FAKE_GIT_BRANCH="develop" bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 2 ]
}

@test "blocks git revert on develop" {
  make_input "git revert HEAD"
  run env "PATH=$FAKE_PATH" FAKE_GIT_BRANCH="develop" bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 2 ]
}

@test "blocks git commit on master" {
  make_input 'git commit -m "msg"'
  run env "PATH=$FAKE_PATH" FAKE_GIT_BRANCH="master" bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 2 ]
}

# ── Allow scenarios (read-only / non-blocked subcommands) ────────────────────

@test "allows git status on develop" {
  make_input "git status"
  run env "PATH=$FAKE_PATH" FAKE_GIT_BRANCH="develop" bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "allows git log on develop" {
  make_input "git log --oneline"
  run env "PATH=$FAKE_PATH" FAKE_GIT_BRANCH="develop" bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "allows git diff on develop" {
  make_input "git diff HEAD"
  run env "PATH=$FAKE_PATH" FAKE_GIT_BRANCH="develop" bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "allows git push on develop (GitHub handles this)" {
  make_input "git push origin feature/foo"
  run env "PATH=$FAKE_PATH" FAKE_GIT_BRANCH="develop" bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "allows git commit on feature branch" {
  make_input 'git commit -m "msg"'
  run env "PATH=$FAKE_PATH" FAKE_GIT_BRANCH="feature/my-feature" bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "allows git merge on feature branch" {
  make_input "git merge main"
  run env "PATH=$FAKE_PATH" FAKE_GIT_BRANCH="feature/my-feature" bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "allows git commit on detached-head-stub (fail-open)" {
  make_input 'git commit -m "msg"'
  run env "PATH=$FAKE_PATH" FAKE_GIT_BRANCH="detached-head-stub" bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "CLAUDE_BRANCH_GUARD_DISABLED=1 allows git commit on develop" {
  make_input 'git commit -m "msg"'
  run env "PATH=$FAKE_PATH" FAKE_GIT_BRANCH="develop" CLAUDE_BRANCH_GUARD_DISABLED=1 bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "allows git with flag prefix on develop (e.g. git -m flag)" {
  make_input "git -m someflag"
  run env "PATH=$FAKE_PATH" FAKE_GIT_BRANCH="develop" bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "allows non-Bash tool_name (Write) -- passthrough" {
  make_input 'git commit -m "msg"' "Write"
  run env "PATH=$FAKE_PATH" FAKE_GIT_BRANCH="develop" bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "allows non-git command (npm install)" {
  make_input "npm install"
  run env "PATH=$FAKE_PATH" FAKE_GIT_BRANCH="develop" bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "blocks git -C /path commit on develop (subcommand resolution past flags)" {
  make_input "git -C /tmp/repo commit -m msg"
  run env "PATH=$FAKE_PATH" FAKE_GIT_BRANCH="develop" bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 2 ]
}

# ── WS2 bypass-class cases (BL-W47 PR-0b) ────────────────────────────────────
# These cases verify the parser fix correctly handles compound commands and
# prefix patterns that previously let blocked subcommands slip through.

@test "blocks rtk git commit on develop (rtk-prefix bypass class)" {
  make_input "rtk git commit -m msg"
  run env "PATH=$FAKE_PATH" FAKE_GIT_BRANCH="develop" bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 2 ]
}

@test "blocks cd /x && git commit on develop (compound-command bypass class)" {
  make_input "cd /x && git commit -m msg"
  run env "PATH=$FAKE_PATH" FAKE_GIT_BRANCH="develop" bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 2 ]
}

@test "blocks FOO=1 git commit on develop (env-prefix bypass class)" {
  make_input "FOO=1 git commit -m x"
  run env "PATH=$FAKE_PATH" FAKE_GIT_BRANCH="develop" bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 2 ]
}

@test "blocks git add . && rtk git commit on develop (compound with rtk-prefix)" {
  make_input "git add . && rtk git commit -m x"
  run env "PATH=$FAKE_PATH" FAKE_GIT_BRANCH="develop" bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 2 ]
}

@test "allows rtk git status on develop (rtk-prefix read-only control)" {
  make_input "rtk git status"
  run env "PATH=$FAKE_PATH" FAKE_GIT_BRANCH="develop" bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "allows cd /x && npm test on develop (non-git compound control)" {
  make_input "cd /x && npm test"
  run env "PATH=$FAKE_PATH" FAKE_GIT_BRANCH="develop" bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

# ── Managed linked worktrees (desktop Code tab) ─────────────────────────────────
# The hook process runs in the project directory, which for a managed linked worktree is the MAIN checkout (often on
# develop), while the session works in the linked worktree. The branch that matters is the session's own
# (event.cwd, or `git -C <path>`). These cases use real repositories, never the PATH stub.

make_worktree_fixture() {
  REAL_GIT=/usr/bin/git
  MAIN="$BATS_TEST_TMPDIR/main-checkout"
  FEATURE_WT="$BATS_TEST_TMPDIR/feature-worktree"
  PROTECTED_WT="$BATS_TEST_TMPDIR/protected-worktree"
  mkdir -p "$MAIN"
  $REAL_GIT -C "$MAIN" init -q -b develop
  $REAL_GIT -C "$MAIN" config user.email guard@test.local
  $REAL_GIT -C "$MAIN" config user.name Guard
  $REAL_GIT -C "$MAIN" commit -q --allow-empty -m init
  $REAL_GIT -C "$MAIN" worktree add -q -b feature/l0-consumer-readiness "$FEATURE_WT"
  $REAL_GIT -C "$MAIN" worktree add -q -b master "$PROTECTED_WT"
  MAIN="$(cd "$MAIN" && pwd -P)"; FEATURE_WT="$(cd "$FEATURE_WT" && pwd -P)"; PROTECTED_WT="$(cd "$PROTECTED_WT" && pwd -P)"
}

# run_guard <hook-process-cwd> <event-cwd-or-empty> <command>
run_guard() {
  local proc_cwd="$1" event_cwd="$2" cmd="$3"
  python3 - "$event_cwd" "$cmd" > "$INPUT_FILE" <<'PY'
import json, sys
event = {'tool_name': 'Bash', 'tool_input': {'command': sys.argv[2]}, 'session_id': 'test'}
if sys.argv[1]:
    event['cwd'] = sys.argv[1]
sys.stdout.write(json.dumps(event))
PY
  run bash -c "cd '$proc_cwd' && cat '$INPUT_FILE' | node '$HOOK'"
}

@test "worktree: allows a commit in a linked worktree on a feature branch although the hook runs in the develop checkout" {
  make_worktree_fixture
  run_guard "$MAIN" "$FEATURE_WT" 'git commit -m msg'
  [ "$status" -eq 0 ]
}

@test "worktree: blocks a commit in the main checkout on develop even when the hook runs elsewhere" {
  make_worktree_fixture
  run_guard "$FEATURE_WT" "$MAIN" 'git commit -m msg'
  [ "$status" -eq 2 ]
  [[ "$output" == *"protected branch \`develop\`"* ]]
}

@test "worktree: blocks a commit in a linked worktree that is itself on master" {
  make_worktree_fixture
  run_guard "$MAIN" "$PROTECTED_WT" 'git commit -m msg'
  [ "$status" -eq 2 ]
  [[ "$output" == *"protected branch \`master\`"* ]]
}

@test "worktree: git -C resolves the target worktree, not the session's" {
  make_worktree_fixture
  run_guard "$MAIN" "$MAIN" "git -C $FEATURE_WT commit -m msg"
  [ "$status" -eq 0 ]
  run_guard "$FEATURE_WT" "$FEATURE_WT" "git -C $MAIN commit -m msg"
  [ "$status" -eq 2 ]
}

@test "worktree: merge and compound commands follow the same session worktree" {
  make_worktree_fixture
  run_guard "$MAIN" "$FEATURE_WT" 'git merge main'
  [ "$status" -eq 0 ]
  run_guard "$FEATURE_WT" "$MAIN" 'git add -A && git merge main'
  [ "$status" -eq 2 ]
}

@test "worktree: a missing, relative or nonexistent event cwd falls back to the hook process cwd" {
  make_worktree_fixture
  run_guard "$MAIN" "" 'git commit -m msg'
  [ "$status" -eq 2 ]
  run_guard "$FEATURE_WT" "" 'git commit -m msg'
  [ "$status" -eq 0 ]
  run_guard "$MAIN" "relative/path" 'git commit -m msg'
  [ "$status" -eq 2 ]
  run_guard "$MAIN" "$BATS_TEST_TMPDIR/does-not-exist" 'git commit -m msg'
  [ "$status" -eq 2 ]
}
