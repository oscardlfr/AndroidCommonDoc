#!/usr/bin/env bats

setup() {
  fixture_root="$BATS_TEST_TMPDIR/hooks-installer"
  toolkit_root="$fixture_root/AndroidCommonDoc"
  consumer_root="$fixture_root/Consumer"
  mkdir -p "$toolkit_root/setup" "$toolkit_root/.claude/hooks" "$consumer_root/.claude/hooks"
  cp "$BATS_TEST_DIRNAME/../../setup/install-hooks.sh" "$toolkit_root/setup/install-hooks.sh"
  cp "$BATS_TEST_DIRNAME/../../.claude/hooks/detekt-post-write.sh" "$toolkit_root/.claude/hooks/detekt-post-write.sh"
  cp "$BATS_TEST_DIRNAME/../../.claude/hooks/detekt-pre-commit.sh" "$toolkit_root/.claude/hooks/detekt-pre-commit.sh"
  cp "$BATS_TEST_DIRNAME/../../.claude/hooks/branch-guard.js" "$toolkit_root/.claude/hooks/branch-guard.js"
}

@test "installer makes newly copied shell hooks executable" {
  run env ANDROID_COMMON_DOC="$toolkit_root" bash "$toolkit_root/setup/install-hooks.sh" --projects Consumer
  [ "$status" -eq 0 ]
  [ -x "$consumer_root/.claude/hooks/detekt-post-write.sh" ]
  [ -x "$consumer_root/.claude/hooks/detekt-pre-commit.sh" ]
}

@test "installer repairs identical non-executable hooks without force" {
  cp "$toolkit_root/.claude/hooks/detekt-post-write.sh" "$consumer_root/.claude/hooks/detekt-post-write.sh"
  cp "$toolkit_root/.claude/hooks/detekt-pre-commit.sh" "$consumer_root/.claude/hooks/detekt-pre-commit.sh"
  chmod 0644 "$consumer_root/.claude/hooks/detekt-post-write.sh" "$consumer_root/.claude/hooks/detekt-pre-commit.sh"

  run env ANDROID_COMMON_DOC="$toolkit_root" bash "$toolkit_root/setup/install-hooks.sh" --projects Consumer
  [ "$status" -eq 0 ]
  [[ "$output" == *"Repaired executable bit: detekt-post-write.sh"* ]]
  [[ "$output" == *"Repaired executable bit: detekt-pre-commit.sh"* ]]
  [ -x "$consumer_root/.claude/hooks/detekt-post-write.sh" ]
  [ -x "$consumer_root/.claude/hooks/detekt-pre-commit.sh" ]
  cmp -s "$toolkit_root/.claude/hooks/detekt-post-write.sh" "$consumer_root/.claude/hooks/detekt-post-write.sh"
  cmp -s "$toolkit_root/.claude/hooks/detekt-pre-commit.sh" "$consumer_root/.claude/hooks/detekt-pre-commit.sh"
}

@test "installer reports conflicting hook content instead of blessing it" {
  printf '%s\n' '#!/usr/bin/env bash' 'echo consumer-owned' > "$consumer_root/.claude/hooks/detekt-pre-commit.sh"
  chmod 0644 "$consumer_root/.claude/hooks/detekt-pre-commit.sh"

  run env ANDROID_COMMON_DOC="$toolkit_root" bash "$toolkit_root/setup/install-hooks.sh" --projects Consumer
  [ "$status" -eq 1 ]
  [[ "$output" == *"Conflict: detekt-pre-commit.sh differs from the toolkit"* ]]
  [ ! -x "$consumer_root/.claude/hooks/detekt-pre-commit.sh" ]
  grep -q 'consumer-owned' "$consumer_root/.claude/hooks/detekt-pre-commit.sh"
}
