#!/usr/bin/env bash
# local-ci.sh -- run what GitHub CI runs for the shell and hook tests, on this machine, before pushing.
#
# The workflow stays the single definition of the jobs: this script only picks an engine and delegates.
#   act     the Linux jobs of .github/workflows/reusable-shell-tests.yml (every bats shard and the hooks job), run
#           by `act` in Docker on an Ubuntu 24.04 image like the CI runner, on a clean clone of the committed HEAD
#   native  the existing sharded runner (scripts/tools/run-bats-sharded.cjs; scripts/sh/run-bats.sh on Windows) and
#           the Node hook-test roster on the host, hermetic: temporary HOME, no global or system git config
#   none    do nothing (explicitly disabled)
#
# Engine, highest priority first: --engine, the config file, then native.
# Config: .androidcommondoc/local-ci.json, e.g. {"engine": "act"} (per machine, git-ignored).
#
# Usage:
#   local-ci.sh [--project-root <path>] [--engine act|native|none] [--job bats|hooks|all]
#               [--shards "<N> <N> ..."] [--max-parallel <N>] [--dry-run]
#   --shards        act only: run just these shards of the workflow matrix (default: every shard)
#   --max-parallel  shards run at the same time (default 4)
#   --dry-run       print the commands without running them
#
# Exit codes:
#   0  every selected job passed (or engine is none)
#   1  a test job failed
#   2  usage, configuration or precondition error (missing Docker/act, unknown engine, missing workflow)

set -euo pipefail

WORKFLOW_RELATIVE=".github/workflows/reusable-shell-tests.yml"
CONFIG_RELATIVE=".androidcommondoc/local-ci.json"
ACT_IMAGE="${LOCAL_CI_ACT_IMAGE:-catthehacker/ubuntu:act-latest}"

usage() { sed -n '2,/^set -e/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; }
die() { echo "local-ci: $*" >&2; exit 2; }

PROJECT_ROOT=""
ENGINE_FLAG=""
JOB="all"
MAX_PARALLEL=4
SHARDS_FLAG=""
DRY_RUN=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --project-root|--engine|--job|--shards|--max-parallel)
      [ "$#" -ge 2 ] || { echo "local-ci: $1 needs a value" >&2; usage >&2; exit 2; }
      case "$1" in
        --project-root) PROJECT_ROOT="$2" ;;
        --engine) ENGINE_FLAG="$2" ;;
        --job) JOB="$2" ;;
        --shards) SHARDS_FLAG="$2" ;;
        --max-parallel) MAX_PARALLEL="$2" ;;
      esac
      shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "local-ci: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[ -n "$PROJECT_ROOT" ] || PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROJECT_ROOT="$(cd "$PROJECT_ROOT" 2>/dev/null && pwd)" || die "--project-root is not a directory"
case "$JOB" in bats|hooks|all) ;; *) die "--job must be bats, hooks or all" ;; esac
case "$MAX_PARALLEL" in ''|*[!0-9]*|0) die "--max-parallel must be a positive integer" ;; esac

WORKFLOW="$PROJECT_ROOT/$WORKFLOW_RELATIVE"
[ -f "$WORKFLOW" ] || die "workflow not found: $WORKFLOW_RELATIVE"

read_config_engine() {
  local file="$PROJECT_ROOT/$CONFIG_RELATIVE"
  [ -f "$file" ] || return 0
  node -e '
    let engine;
    try { engine = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).engine; }
    catch (error) { console.error("invalid JSON: " + error.message); process.exit(3); }
    if (engine !== undefined) process.stdout.write(String(engine));
  ' "$file" || die "$CONFIG_RELATIVE is not valid JSON"
}

# A failure inside $(...) only leaves the subshell, so each read is checked here, once.
CONFIG_ENGINE="$(read_config_engine)" || exit 2
ENGINE="${ENGINE_FLAG:-$CONFIG_ENGINE}"
ENGINE="${ENGINE:-native}"
case "$ENGINE" in act|native|none) ;; *) die "unknown engine '$ENGINE' (expected act, native or none)" ;; esac

# The shard list comes from the workflow matrix, so the CI definition stays the only one.
workflow_shards() {
  local line
  line="$(grep -E '^[[:space:]]*shard:[[:space:]]*\[' "$WORKFLOW" | head -n 1 || true)"
  [ -n "$line" ] || die "no 'shard: [...]' matrix found in $WORKFLOW_RELATIVE"
  printf '%s' "$line" | sed -e 's/.*\[//' -e 's/\].*//' -e 's/,/ /g'
}

SHARDS="$(workflow_shards)" || exit 2
SHARD_COUNT="$(echo "$SHARDS" | wc -w | tr -d ' \r')"
if [ -n "$SHARDS_FLAG" ]; then
  [ "$ENGINE" = act ] || die "--shards needs engine act (native runs the whole planned suite)"
  for requested in $SHARDS_FLAG; do
    case " $SHARDS " in *" $requested "*) ;; *) die "--shards: $requested is not a shard of the workflow matrix ($SHARDS)" ;; esac
  done
  SHARDS="$SHARDS_FLAG"
fi

# The Node hook-test skip roster also lives only in the workflow.
workflow_hook_skips() {
  awk '/SKIP_PATTERNS=\(/{f=1; next} f && /^[[:space:]]*\)/{exit} f' "$WORKFLOW" | tr -d "'\r "
}

install_hint() {
  case "$(uname -s)" in
    Darwin) echo "Install: brew install colima docker act && colima start --cpu 6 --memory 12   (OrbStack also works)" ;;
    MINGW*|MSYS*|CYGWIN*) echo "Install: Docker Desktop or Podman Desktop on WSL2, then: winget install nektos.act" ;;
    *) echo "Install: Docker Engine (https://docs.docker.com/engine/install/) and act (https://nektosact.com/installation/)" ;;
  esac
}

run() {
  if [ "$DRY_RUN" -eq 1 ]; then printf 'DRY-RUN:'; printf ' %q' "$@"; printf '\n'; return 0; fi
  "$@"
}

# Temporary files go under a short base: macOS gives every user a 48-character TMPDIR, longer than the suite's path
# budget, and the act snapshot path is also the workspace path inside the container.
short_tmp_base() { if [ "$(uname -s)" = Darwin ]; then echo /private/tmp; else echo /tmp; fi; }
WORK_DIR=""
cleanup() { [ -z "$WORK_DIR" ] || rm -rf -- "$WORK_DIR"; }
trap cleanup EXIT

# act needs a self-contained git repository: in a linked worktree .git is a file pointing at a host path the container
# cannot see. CI checks out a commit, so a clean clone of HEAD is also the faithful input.
snapshot_head() {
  local sha
  sha="$(git -C "$PROJECT_ROOT" rev-parse HEAD 2>/dev/null)" || die "engine act needs a git repository with a commit"
  [ -z "$(git -C "$PROJECT_ROOT" status --porcelain --untracked-files=no)" ] \
    || echo "local-ci: uncommitted changes are NOT validated; act runs the committed HEAD $sha" >&2
  git clone --quiet --no-checkout "$PROJECT_ROOT" "$WORK_DIR/repo" || die "could not clone $PROJECT_ROOT"
  git -C "$WORK_DIR/repo" checkout --quiet --detach "$sha" || die "could not check out $sha"
  echo "local-ci: act runs commit $sha"
}

run_act() {
  command -v docker >/dev/null 2>&1 || die "engine act needs Docker, which is not installed. $(install_hint)"
  command -v act >/dev/null 2>&1 || die "engine act needs act, which is not installed. $(install_hint)"
  local logs="$PROJECT_ROOT/.androidcommondoc/local-ci" src="CLONE_OF_HEAD"
  if [ "$DRY_RUN" -eq 0 ]; then
    docker info >/dev/null 2>&1 || die "Docker is installed but its daemon is not running. $(install_hint)"
    WORK_DIR="$(mktemp -d "$(short_tmp_base)/local-ci.XXXXXX")"
    snapshot_head
    src="$WORK_DIR/repo"
    mkdir -p "$logs/artifacts"
    rm -f "$logs"/shard-*.exit
  fi
  # --input androidcommondoc_path=.: the toolkit scripts come from the commit under test, not from a clone of the
  #   default branch. --container-daemon-socket -: no job uses Docker, and the host socket path does not exist inside
  #   the Colima or Podman VM. --user 1001, --init and the HOME/npm variables: a GitHub runner is a non-root user with
  #   an init that reaps killed children; as root the permission tests (EACCES, credential isolation) and the recovery
  #   tests (zombie processes) fail for reasons CI never sees.
  local act_base=(act workflow_call -C "$src" -W "$WORKFLOW_RELATIVE" --input androidcommondoc_path=.
    -P "ubuntu-latest=$ACT_IMAGE" --container-daemon-socket - --artifact-server-path "$logs/artifacts"
    --container-options "--user 1001:1001 --init" --env HOME=/tmp/runner-home
    --env npm_config_prefix=/tmp/runner-npm --env npm_config_cache=/tmp/runner-npm-cache)
  local failed=0 shard

  if [ "$JOB" = bats ] || [ "$JOB" = all ]; then
    if [ "$DRY_RUN" -eq 1 ]; then
      for shard in $SHARDS; do run "${act_base[@]}" -j bats --matrix "shard:$shard"; done
    else
      # Parallel act runs race on the shared ~/.cache/act ('Unable to checkout ... EOF'), so each shard gets its own
      # action cache and its own artifact-server port.
      local runner="$WORK_DIR/run-shard.sh"
      {
        echo '#!/usr/bin/env bash'
        printf '%q ' "${act_base[@]}"
        echo '-j bats --matrix "shard:$1" --artifact-server-port "$((34600 + $1))" --action-cache-path "$LOCAL_CI_LOGS/action-cache-$1" > "$LOCAL_CI_LOGS/shard-$1.log" 2>&1'
        echo 'echo $? > "$LOCAL_CI_LOGS/shard-$1.exit"; echo "shard $1: exit $(cat "$LOCAL_CI_LOGS/shard-$1.exit")"'
      } > "$runner"
      export LOCAL_CI_LOGS="$logs"
      printf '%s\n' $SHARDS | xargs -n 1 -P "$MAX_PARALLEL" bash "$runner" || failed=1
      for shard in $SHARDS; do
        [ "$(cat "$logs/shard-$shard.exit" 2>/dev/null || echo 1)" = 0 ] || { echo "shard $shard failed, see $logs/shard-$shard.log" >&2; failed=1; }
      done
    fi
  fi
  if [ "$JOB" = hooks ] || [ "$JOB" = all ]; then
    if [ "$DRY_RUN" -eq 1 ]; then run "${act_base[@]}" -j bats-post
    else "${act_base[@]}" -j bats-post > "$logs/hooks.log" 2>&1 || { echo "hooks failed, see $logs/hooks.log" >&2; failed=1; }
    fi
  fi
  return "$failed"
}

run_native() {
  local real_cache failed=0 windows=0
  case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) windows=1 ;; esac
  if [ "$DRY_RUN" -eq 0 ] && [ -f "$PROJECT_ROOT/mcp-server/package-lock.json" ] \
    && { [ ! -d "$PROJECT_ROOT/mcp-server/node_modules" ] || [ ! -d "$PROJECT_ROOT/mcp-server/build" ]; }; then
    die "engine native needs the built mcp-server, as the CI jobs build it. Run: (cd mcp-server && npm ci && npm run build)"
  fi
  real_cache="$(npm config get cache 2>/dev/null || true)"
  WORK_DIR="$(mktemp -d "$(short_tmp_base)/local-ci.XXXXXX")"
  mkdir -p "$WORK_DIR/home" "$WORK_DIR/tmp"
  # Hermetic: no identity or settings leak in from this machine, as on a CI runner.
  export HOME="$WORK_DIR/home" TMPDIR="$WORK_DIR/tmp" GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
  [ -z "$real_cache" ] || export npm_config_cache="$real_cache"
  [ "$DRY_RUN" -eq 0 ] || echo "DRY-RUN-ENV: GIT_CONFIG_GLOBAL=$GIT_CONFIG_GLOBAL GIT_CONFIG_NOSYSTEM=$GIT_CONFIG_NOSYSTEM HOME_IS_TEMP=$([ "$HOME" = "$WORK_DIR/home" ] && echo yes || echo no)"

  if [ "$JOB" = bats ] || [ "$JOB" = all ]; then
    if [ "$windows" -eq 1 ]; then
      # The sharded runner needs POSIX process groups; run-bats.sh's serial mode is the supported Windows path.
      run bash "$PROJECT_ROOT/scripts/sh/run-bats.sh" --project-root "$PROJECT_ROOT" --wave-slug none || failed=1
    else
      run node "$PROJECT_ROOT/scripts/tools/run-bats-sharded.cjs" --project-root "$PROJECT_ROOT" \
        --shard-count "$SHARD_COUNT" --max-parallel "$MAX_PARALLEL" --wave-slug none || failed=1
    fi
  fi
  if [ "$JOB" = hooks ] || [ "$JOB" = all ]; then
    local file skip skipped skips
    skips="$(workflow_hook_skips)"
    for file in "$PROJECT_ROOT"/scripts/tests/*.test.js; do
      skipped=0
      for skip in $skips; do case "$file" in *"$skip") skipped=1 ;; esac; done
      [ "$skipped" -eq 0 ] || continue
      run node "$file" || { echo "FAILED: ${file#"$PROJECT_ROOT"/}" >&2; failed=1; }
    done
  fi
  return "$failed"
}

echo "local-ci: engine=$ENGINE job=$JOB root=$PROJECT_ROOT"
status=0
case "$ENGINE" in
  none) echo "local-ci: engine is none, nothing to run"; exit 0 ;;
  act) run_act || status=$? ;;
  native)
    echo "local-ci: native runs on this OS only; it does not cover Linux or Windows differences (use engine act)" >&2
    run_native || status=$? ;;
esac
if [ "$status" -eq 0 ]; then echo "local-ci: PASS"; else echo "local-ci: FAIL" >&2; fi
exit "$status"
