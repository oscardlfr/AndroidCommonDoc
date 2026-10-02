#!/usr/bin/env bats
# local-ci.sh: engine selection, fail-fast preconditions and the commands it would run. Hermetic: every test runs the
# script with a PATH that holds only the tools it needs, so the result never depends on Docker or act being installed
# on the machine (a GitHub runner has Docker, a developer laptop may not).

SCRIPT="$BATS_TEST_DIRNAME/../sh/local-ci.sh"
WORKFLOW_SOURCE="$BATS_TEST_DIRNAME/../../.github/workflows/reusable-shell-tests.yml"

setup() {
  PROJECT="$BATS_TEST_TMPDIR/project"
  FAKEBIN="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$PROJECT/.github/workflows" "$PROJECT/scripts/tests" "$PROJECT/.androidcommondoc" "$FAKEBIN"
  cp "$WORKFLOW_SOURCE" "$PROJECT/.github/workflows/reusable-shell-tests.yml"
  : > "$PROJECT/scripts/tests/a.test.js"
  : > "$PROJECT/scripts/tests/r33-wire-protocol.test.js"
  local tool
  for tool in bash node grep sed awk tr wc head cat uname dirname mktemp rm mkdir xargs printf env; do
    ln -s "$(command -v "$tool")" "$FAKEBIN/$tool"
  done
  RUN_PATH="$FAKEBIN"
}

with_docker_and_act() {
  printf '#!/bin/sh\nexit 0\n' > "$FAKEBIN/docker"; printf '#!/bin/sh\nexit 0\n' > "$FAKEBIN/act"
  chmod +x "$FAKEBIN/docker" "$FAKEBIN/act"
}

local_ci() { PATH="$RUN_PATH" run "$BASH" "$SCRIPT" --project-root "$PROJECT" "$@"; }
write_config() { printf '%s\n' "$1" > "$PROJECT/.androidcommondoc/local-ci.json"; }

@test "no config file: the engine is native" {
  local_ci --dry-run
  [ "$status" -eq 0 ]
  [[ "$output" == *"engine=native"* ]]
  [[ "$output" == *"run-bats-sharded.cjs"* ]]
}

@test "native runs the shard count of the workflow matrix, with no wave, in a hermetic environment" {
  local_ci --dry-run --job bats
  [ "$status" -eq 0 ]
  [[ "$output" == *"--shard-count 8"* ]]
  [[ "$output" == *"--wave-slug none"* ]]
  [[ "$output" == *"GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 HOME_IS_TEMP=yes"* ]]
}

@test "native runs the Node hook roster minus the skips declared in the workflow" {
  local_ci --dry-run --job hooks
  [ "$status" -eq 0 ]
  [[ "$output" == *"a.test.js"* ]]
  [[ "$output" != *"r33-wire-protocol.test.js"* ]]
}

@test "engine act without Docker fails with the install instruction and exit 2" {
  write_config '{"engine": "act"}'
  local_ci
  [ "$status" -eq 2 ]
  [[ "$output" == *"needs Docker"* ]]
  case "$(uname -s)" in
    Darwin) [[ "$output" == *"brew install colima docker act"* ]] ;;
    MINGW*|MSYS*|CYGWIN*) [[ "$output" == *"winget install nektos.act"* ]] ;;
    *) [[ "$output" == *"Install: Docker Engine"* ]] ;;
  esac
}

@test "engine act with Docker but without act fails naming act and exit 2" {
  write_config '{"engine": "act"}'
  printf '#!/bin/sh\nexit 0\n' > "$FAKEBIN/docker"; chmod +x "$FAKEBIN/docker"
  local_ci
  [ "$status" -eq 2 ]
  [[ "$output" == *"needs act"* ]]
  [[ "$output" == *"Install:"* ]]
}

@test "engine act with a stopped Docker daemon fails before running anything, exit 2" {
  write_config '{"engine": "act"}'
  with_docker_and_act
  printf '#!/bin/sh\nexit 1\n' > "$FAKEBIN/docker"
  local_ci
  [ "$status" -eq 2 ]
  [[ "$output" == *"daemon is not running"* ]]
}

@test "engine act runs one container per shard of the workflow matrix plus the hooks job" {
  write_config '{"engine": "act"}'
  with_docker_and_act
  local_ci --dry-run
  [ "$status" -eq 0 ]
  [ "$(grep -c -- '-j bats --matrix' <<< "$output")" -eq 8 ]
  [[ "$output" == *"shard:7"* ]]
  [[ "$output" == *"-j bats-post"* ]]
  [[ "$output" == *"ubuntu-latest=catthehacker/ubuntu:act-latest"* ]]
  [[ "$output" == *"androidcommondoc_path=."* ]]
  # act runs a clean clone of the committed HEAD, never the (possibly linked-worktree) checkout itself.
  [[ "$output" == *"-C CLONE_OF_HEAD"* ]]
  [[ "$output" == *"-W .github/workflows/reusable-shell-tests.yml"* ]]
}

@test "engine act runs the containers as a non-root user with an init and a writable HOME, like a GitHub runner" {
  write_config '{"engine": "act"}'
  with_docker_and_act
  local_ci --dry-run --job hooks
  [ "$status" -eq 0 ]
  [[ "$output" == *"--user\\ 1001:1001\\ --init"* ]]
  [[ "$output" == *"HOME=/tmp/runner-home"* ]]
  [[ "$output" == *"--container-daemon-socket -"* ]]
}

@test "--shards re-runs only the named shards and rejects one that is not in the matrix" {
  write_config '{"engine": "act"}'
  with_docker_and_act
  local_ci --dry-run --job bats --shards "4 7"
  [ "$status" -eq 0 ]
  [ "$(grep -c -- '-j bats --matrix' <<< "$output")" -eq 2 ]
  [[ "$output" == *"shard:4"* && "$output" == *"shard:7"* ]]
  local_ci --dry-run --shards "9"
  [ "$status" -eq 2 ]
  [[ "$output" == *"not a shard of the workflow matrix"* ]]
}

@test "--shards is an act option: with engine native it is a usage error" {
  local_ci --dry-run --shards "1"
  [ "$status" -eq 2 ]
  [[ "$output" == *"--shards needs engine act"* ]]
}

@test "native refuses to start without the built mcp-server and names the command, exit 2" {
  mkdir -p "$PROJECT/mcp-server"
  : > "$PROJECT/mcp-server/package-lock.json"
  local_ci --job hooks
  [ "$status" -eq 2 ]
  [[ "$output" == *"npm ci && npm run build"* ]]
}

@test "the engine flag wins over the config file" {
  write_config '{"engine": "act"}'
  local_ci --dry-run --engine native
  [ "$status" -eq 0 ]
  [[ "$output" == *"engine=native"* ]]
}

@test "engine none does nothing and succeeds" {
  write_config '{"engine": "none"}'
  local_ci
  [ "$status" -eq 0 ]
  [[ "$output" == *"engine is none"* ]]
}

@test "an unknown engine, malformed JSON, an unknown job and a missing workflow are usage errors" {
  write_config '{"engine": "docker"}'
  local_ci --dry-run
  [ "$status" -eq 2 ]
  [[ "$output" == *"unknown engine"* ]]
  write_config '{not json'
  local_ci --dry-run
  [ "$status" -eq 2 ]
  [[ "$output" == *"not valid JSON"* ]]
  rm "$PROJECT/.androidcommondoc/local-ci.json"
  local_ci --dry-run --job everything
  [ "$status" -eq 2 ]
  local_ci --dry-run --engine
  [ "$status" -eq 2 ]
  [[ "$output" == *"--engine needs a value"* ]]
  rm "$PROJECT/.github/workflows/reusable-shell-tests.yml"
  local_ci --dry-run
  [ "$status" -eq 2 ]
  [[ "$output" == *"workflow not found"* ]]
}

@test "--help prints the usage header only, exit 0" {
  local_ci --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Exit codes:"* ]]
  [[ "$output" != *"WORKFLOW_RELATIVE="* ]]
}

@test "the PowerShell twin forwards to the same bash script" {
  grep -qF "'local-ci.sh'" "$BATS_TEST_DIRNAME/../ps1/local-ci.ps1"
  grep -qF '@ArgList' "$BATS_TEST_DIRNAME/../ps1/local-ci.ps1"
}

@test "engine act from a detached HEAD: the snapshot clone act receives carries a loose branch ref, so .git/refs survives docker cp" {
  write_config '{"engine": "act"}'
  ln -s "$(command -v git)" "$FAKEBIN/git"
  git -C "$PROJECT" init -q
  git -C "$PROJECT" -c user.email=t@t -c user.name=t add -A
  git -C "$PROJECT" -c user.email=t@t -c user.name=t commit -q -m "chore(scripts): fixture"
  git -C "$PROJECT" checkout -q --detach HEAD
  printf '#!/bin/sh\nexit 0\n' > "$FAKEBIN/docker"
  cat > "$FAKEBIN/act" <<FAKE
#!/bin/sh
# Records what the snapshot clone looks like at the moment act would copy it into a container.
while [ "\$#" -gt 0 ]; do [ "\$1" = "-C" ] && { src="\$2"; break; }; shift; done
{ [ -f "\$src/.git/refs/heads/local-ci" ] && echo present || echo missing; } > "$BATS_TEST_TMPDIR/refs-seen"
exit 0
FAKE
  chmod +x "$FAKEBIN/docker" "$FAKEBIN/act"
  local_ci --job hooks
  [ "$status" -eq 0 ]
  [ "$(cat "$BATS_TEST_TMPDIR/refs-seen")" = "present" ]
}
