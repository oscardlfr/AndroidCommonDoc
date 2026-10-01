#!/usr/bin/env bash
# local-ci.sh -- run what GitHub CI runs for the shell and hook tests, on this machine, before pushing.
#
# The workflow stays the single definition of the jobs: this script only picks an engine and delegates.
#   act     the Linux jobs of .github/workflows/reusable-shell-tests.yml, executed by `act` in the same Ubuntu image
#           family as the CI runner (needs Docker), one container per Bats shard, in parallel
#   native  the existing sharded runner (scripts/tools/run-bats-sharded.cjs) and the Node hook-test roster on the
#           host OS, in a hermetic environment (temporary HOME, no global or system git config)
#   none    do nothing (explicitly disabled)
#
# Engine, highest priority first: --engine, the config file, then native.
# Config: .androidcommondoc/local-ci.json, e.g. {"engine": "act"} (per machine, git-ignored).
#
# Usage:
#   local-ci.sh [--project-root <path>] [--engine act|native|none] [--job bats|hooks|all]
#               [--shards "<N> <N> ..."] [--max-parallel <N>] [--dry-run]
#   --shards re-runs only those shards of the act engine (default: every shard of the workflow matrix)
#
# Exit codes:
#   0  every selected job passed (or engine is none)
#   1  a test job failed
#   2  usage, configuration or precondition error (missing Docker/act, unknown engine, missing workflow)

set -euo pipefail

WORKFLOW_RELATIVE=".github/workflows/reusable-shell-tests.yml"
CONFIG_RELATIVE=".androidcommondoc/local-ci.json"
ACT_IMAGE="${LOCAL_CI_ACT_IMAGE:-catthehacker/ubuntu:act-latest}"
MAX_SHORT_TMPDIR=42

usage() { sed -n '2,/^set -uo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; }
die() { echo "local-ci: $*" >&2; exit 2; }

PROJECT_ROOT=""
ENGINE_FLAG=""
JOB="all"
MAX_PARALLEL=4
SHARDS_FLAG=""
DRY_RUN=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --project-root) PROJECT_ROOT="${2:-}"; shift 2 ;;
    --engine) ENGINE_FLAG="${2:-}"; shift 2 ;;
    --job) JOB="${2:-}"; shift 2 ;;
    --shards) SHARDS_FLAG="${2:-}"; shift 2 ;;
    --max-parallel) MAX_PARALLEL="${2:-}"; shift 2 ;;
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
if [ -n "$SHARDS_FLAG" ]; then
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
    Darwin) echo "brew install colima docker act && colima start --cpu 6 --memory 12   (OrbStack also works)" ;;
    MINGW*|MSYS*|CYGWIN*) echo "install Docker Desktop or Podman Desktop on WSL2, then: winget install nektos.act" ;;
    *) echo "install Docker Engine (https://docs.docker.com/engine/install/) and act (https://nektosact.com/installation/)" ;;
  esac
}

run() {
  if [ "$DRY_RUN" -eq 1 ]; then printf 'DRY-RUN:'; printf ' %q' "$@"; printf '\n'; return 0; fi
  "$@"
}

run_act() {
  command -v docker >/dev/null 2>&1 || die "engine act needs Docker, which is not installed. $(install_hint)"
  command -v act >/dev/null 2>&1 || die "engine act needs act, which is not installed. $(install_hint)"
  if [ "$DRY_RUN" -eq 0 ]; then
    docker info >/dev/null 2>&1 || die "Docker is installed but its daemon is not running. $(install_hint)"
  fi
  local logs="$PROJECT_ROOT/.androidcommondoc/local-ci"
  mkdir -p "$logs/artifacts"
  rm -f "$logs"/shard-*.exit
  # --container-daemon-socket -: the jobs never use Docker themselves, and mounting the host socket breaks on
  # Colima and Podman, where that path does not exist inside the VM.
  # --user 1001 and the HOME/npm variables: a GitHub runner is not root, and as root the permission tests (EACCES,
  # credential isolation, directory identity) fail for a reason CI never sees. --init: a runner has a real init that
  # reaps killed children; without one a SIGKILLed process stays a zombie and the recovery tests see it alive.
  local act_base=(act workflow_call -W "$WORKFLOW_RELATIVE" --input androidcommondoc_path=. -P "ubuntu-latest=$ACT_IMAGE" --container-daemon-socket - --artifact-server-path "$logs/artifacts"
    --container-options "--user 1001:1001 --init" --env HOME=/tmp/runner-home --env npm_config_prefix=/tmp/runner-npm --env npm_config_cache=/tmp/runner-npm-cache)
  local failed=0 shard

  if [ "$JOB" = bats ] || [ "$JOB" = all ]; then
    if [ "$DRY_RUN" -eq 1 ]; then
      for shard in $SHARDS; do run "${act_base[@]}" -j bats --matrix "shard:$shard"; done
    else
      # Parallel act runs would race on the shared ~/.cache/act (it fails with 'Unable to checkout ... EOF'), so each
      # shard gets its own action cache and its own artifact-server port.
      local runner="$logs/run-shard.sh"
      {
        echo '#!/usr/bin/env bash'
        printf '%q ' "${act_base[@]}"
        echo '-j bats --matrix "shard:$1" --artifact-server-port "$((34600 + $1))" --action-cache-path "$LOCAL_CI_LOGS/action-cache-$1" > "$LOCAL_CI_LOGS/shard-$1.log" 2>&1'
        echo 'echo $? > "$LOCAL_CI_LOGS/shard-$1.exit"; echo "shard $1: exit $(cat "$LOCAL_CI_LOGS/shard-$1.exit")"'
      } > "$runner"
      export LOCAL_CI_LOGS="$logs"
      printf '%s\n' $SHARDS | (cd "$PROJECT_ROOT" && xargs -n 1 -P "$MAX_PARALLEL" bash "$runner") || failed=1
      for shard in $SHARDS; do
        [ "$(cat "$logs/shard-$shard.exit" 2>/dev/null || echo 1)" = 0 ] || { echo "shard $shard failed, see $logs/shard-$shard.log" >&2; failed=1; }
      done
    fi
  fi
  if [ "$JOB" = hooks ] || [ "$JOB" = all ]; then
    if [ "$DRY_RUN" -eq 1 ]; then run "${act_base[@]}" -j bats-post
    else (cd "$PROJECT_ROOT" && "${act_base[@]}" -j bats-post > "$logs/hooks.log" 2>&1) || { echo "hooks failed, see $logs/hooks.log" >&2; failed=1; }
    fi
  fi
  return "$failed"
}

run_native() {
  local real_cache failed=0
  real_cache="$(npm config get cache 2>/dev/null || true)"
  tmp_home="$(mktemp -d)"   # global on purpose: the EXIT trap runs after this function returns
  trap 'rm -rf "$tmp_home"' EXIT
  # Hermetic: no identity or settings leak in from this machine, as on a CI runner.
  export HOME="$tmp_home" GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
  [ -z "$real_cache" ] || export npm_config_cache="$real_cache"
  # macOS: the per-user TMPDIR is too long for the isolation path budget of the suite.
  if [ "$(uname -s)" = Darwin ] && [ "$(printf %s "${TMPDIR:-}" | wc -c | tr -d ' \r')" -gt "$MAX_SHORT_TMPDIR" ]; then export TMPDIR=/private/tmp/l0ci; mkdir -p "$TMPDIR"; fi

  [ "$DRY_RUN" -eq 0 ] || echo "DRY-RUN-ENV: GIT_CONFIG_GLOBAL=$GIT_CONFIG_GLOBAL GIT_CONFIG_NOSYSTEM=$GIT_CONFIG_NOSYSTEM HOME_IS_TEMP=$([ "$HOME" = "$tmp_home" ] && echo yes || echo no)"
  local count
  count="$(echo "$SHARDS" | wc -w | tr -d ' \r')"
  if [ "$JOB" = bats ] || [ "$JOB" = all ]; then
    run node "$PROJECT_ROOT/scripts/tools/run-bats-sharded.cjs" --project-root "$PROJECT_ROOT" \
      --shard-count "$count" --max-parallel "$MAX_PARALLEL" --wave-slug none || failed=1
  fi
  if [ "$JOB" = hooks ] || [ "$JOB" = all ]; then
    local file skip skipped
    for file in "$PROJECT_ROOT"/scripts/tests/*.test.js; do
      skipped=0
      for skip in $(workflow_hook_skips); do case "$file" in *"$skip") skipped=1 ;; esac; done
      [ "$skipped" -eq 0 ] || continue
      run node "$file" || { echo "FAILED: ${file#"$PROJECT_ROOT"/}" >&2; failed=1; }
    done
  fi
  return "$failed"
}

echo "local-ci: engine=$ENGINE job=$JOB root=$PROJECT_ROOT"
case "$ENGINE" in
  none) echo "local-ci: engine is none, nothing to run"; exit 0 ;;
  act) status=0; run_act || status=$? ;;
  native)
    echo "local-ci: native does not cover Linux or Windows differences; use engine act for that" >&2
    status=0; run_native || status=$? ;;
esac
[ "$status" -eq 0 ] && echo "local-ci: PASS" || echo "local-ci: FAIL" >&2
exit "$status"
