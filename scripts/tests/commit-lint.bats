#!/usr/bin/env bats
#
# Tests for .github/workflows/reusable-commit-lint.yml SCOPE_PATTERN regex.
# Mirrors the workflow's pattern-construction logic (VALID_SCOPES → SCOPE_LIST →
# SCOPE_PATTERN → FULL_PATTERN). Uses grep -E (ERE) — behaviorally identical to
# the workflow's grep -P for this pattern class (no PCRE-only constructs used).
#
# BL-W32-13: compound module scopes accepted when base token is in valid_scopes.

setup() {
  VALID_SCOPES="core,data,ui,feature,ci,deps,release,docs,detekt,mcp,skills,scripts,agents,archive,di,guides,tests,tools"
  SCOPE_LIST=$(echo "$VALID_SCOPES" | tr ',' '|')
  VALID_TYPES="feat,fix,docs,style,refactor,perf,test,build,ci,chore,revert"
  TYPE_PATTERN=$(echo "$VALID_TYPES" | tr ',' '|')
  SCOPE_PATTERN="(\(($SCOPE_LIST)(-[a-z0-9]+)*\))?"
  FULL_PATTERN="^(${TYPE_PATTERN})${SCOPE_PATTERN}!?: .+"
}

# (a) Compound scope accepted — base token in valid_scopes + hyphenated suffix
@test "compound scope core-error-sdk is accepted" {
  run bash -c "echo 'feat(core-error-sdk): add thing' | grep -E \"$FULL_PATTERN\""
  [ "$status" -eq 0 ]
}

# (b) Single base scope still accepted — no regression on existing commits
@test "single base scope core is accepted" {
  run bash -c "echo 'fix(core): typo fix' | grep -E \"$FULL_PATTERN\""
  [ "$status" -eq 0 ]
}

# (c) Invalid base prefix rejected — unknown base token not in valid_scopes
@test "invalid base scope nonexistent-thing is rejected" {
  run bash -c "echo 'feat(nonexistent-thing): bad commit' | grep -E \"$FULL_PATTERN\""
  [ "$status" -ne 0 ]
}

# (d) Amendment 1: empty scope (no scope) must be accepted
@test "empty scope (no scope) is accepted" {
  run bash -c "echo 'feat: add thing' | grep -E \"$FULL_PATTERN\""
  [ "$status" -eq 0 ]
}

# (e) Amendment 1: trailing hyphen in scope must be rejected
@test "trailing hyphen in scope is rejected" {
  run bash -c "echo 'feat(core-): add thing' | grep -E \"$FULL_PATTERN\""
  [ "$status" -ne 0 ]
}
