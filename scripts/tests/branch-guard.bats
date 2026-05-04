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
