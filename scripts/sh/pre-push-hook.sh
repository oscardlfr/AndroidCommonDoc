#!/usr/bin/env bash
# pre-push-hook.sh — Git pre-push hook: two-stamp push gate (BL-W47 PR-0b).
#
# Git-layer backstop below the Claude-layer push gates (quality-gate-pre-push.sh,
# pre-push-pre-pr-gate.js). Runs under git's bash on Windows git-bash and Linux.
# Closes the in-process-peer bypass: Claude hooks key on agent names; this hook
# fires for EVERY push from this clone regardless of who runs it (incl. `rtk git push`).
#
# Enforces BOTH stamps for pushes that update feature-branch heads:
#   .androidcommondoc/quality-gate.stamp — PASS, <=30 min, NEWER than pushed commit
#   .androidcommondoc/pre-pr.stamp       — PASS, <=30 min, head == pushed sha
#
# Exempt per stdin line: deletions (zero local-sha); non-branch refs (tags/notes);
# refs/heads/{develop,master,main} (PR-merge flow — server-side branch protection
# + PR CI gate those). Force pushes are NOT exempt (not detectable here; stricter
# than the Claude layer by design — use the bypass for sanctioned rewrites).
#
# Bypass: SKIP_PUSH_GATE=1 git push ...   (explicit user authorization only)
#
# git pre-push contract: argv = <remote-name> <remote-url>;
# stdin lines = "<local-ref> <local-sha> <remote-ref> <remote-sha>"; exit != 0 blocks.
# Fail-CLOSED: missing/malformed stamps, missing python3, unreadable sha => block.
# (Contrast commit-msg-hook.sh fail-open: that is a format check; this is a security gate.)

set -euo pipefail

MAX_AGE_SECS=1800
ZERO_SHA="0000000000000000000000000000000000000000"

# -- 0. Bypass ---------------------------------------------------------------
if [[ "${SKIP_PUSH_GATE:-}" == "1" ]]; then
  echo "[pre-push-hook] BYPASSED via SKIP_PUSH_GATE=1" >&2
  exit 0
fi

# -- 1. Read ALL stdin lines first, classify gated refs ----------------------
gated_shas=()
while read -r local_ref local_sha remote_ref remote_sha; do
  [[ -z "${local_sha:-}" ]] && continue
  [[ "$local_sha" == "$ZERO_SHA" ]] && continue                # deletion push
  case "$remote_ref" in
    refs/heads/develop|refs/heads/master|refs/heads/main) ;;   # PR-merge flow (exact match)
    refs/heads/*) gated_shas+=("$local_sha") ;;                # feature branch -> gated
    *) ;;                                                      # tags/notes/etc -> exempt
  esac
done

[[ ${#gated_shas[@]} -eq 0 ]] && exit 0   # nothing gated

# -- 2. Repo root (worktree-aware) + stamp paths ------------------------------
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
QG_STAMP="$REPO_ROOT/.androidcommondoc/quality-gate.stamp"
PP_STAMP="$REPO_ROOT/.androidcommondoc/pre-pr.stamp"

block() {  # $1 = failing component, $2 = reason
  {
    echo "[pre-push-hook] BLOCKED: $1 — $2"
    echo "  Two-stamp rule: BOTH stamps must exist, be PASS, be <=30 min old, and match the pushed commit."
    echo "    quality-gate.stamp -> run /quality-gate to refresh   ($QG_STAMP)"
    echo "    pre-pr.stamp       -> run /pre-pr to refresh         ($PP_STAMP)"
    echo "  /pre-pr is required for ALL pushes, including intermediate pushes. Re-run /pre-pr before"
    echo "  each push, OR squash to a single push at PR-open time."
    echo "  Bypass (explicit user authorization only): SKIP_PUSH_GATE=1 git push ..."
  } >&2
  exit 1
}

# -- 3. Interpreter check (fail-CLOSED) ---------------------------------------
command -v python3 >/dev/null 2>&1 || \
  block "infrastructure" "python3 not found on PATH (required to parse stamps). Install python3, or bypass below"

# -- validate_stamp <path>: prints "OK <epoch> <head|->" or "FAIL <reason>" ----
# Handles BOTH stamp shapes (single-line and pretty-printed JSON).
validate_stamp() {
  python3 - "$1" "$MAX_AGE_SECS" <<'PYEOF'
import json, sys, time, calendar, datetime
path, max_age = sys.argv[1], int(sys.argv[2])
def fail(msg):
    print("FAIL " + msg); sys.exit(0)
try:
    with open(path, encoding="utf-8") as f:
        stamp = json.load(f)
except FileNotFoundError:
    fail("missing — gate has not been run (or stamp was deleted)")
except Exception:
    fail("malformed JSON")
if stamp.get("verdict") != "PASS":
    fail("verdict is '%s', not PASS" % stamp.get("verdict"))
ts = stamp.get("timestamp") or ""
try:
    epoch = calendar.timegm(time.strptime(ts, "%Y-%m-%dT%H:%M:%SZ"))
except ValueError:
    try:
        epoch = int(datetime.datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp())
    except Exception:
        fail("unparseable timestamp '%s'" % ts)
age = int(time.time()) - epoch
if age < -120:
    fail("future timestamp (stamp is %d s ahead of system clock — clock skew or tampered stamp)" % (-age))
if age > max_age:
    fail("stale (%d min old, max 30)" % (age // 60))
head = stamp.get("head") or "-"
if head != "-" and len(head) != 40:
    fail("head '%s' is not a full 40-char SHA" % head)
print("OK %d %s" % (epoch, head))
PYEOF
}

# -- 4. quality-gate.stamp -----------------------------------------------------
qg_result="$(validate_stamp "$QG_STAMP")"
case "$qg_result" in
  OK\ *) read -r _ qg_epoch qg_head <<< "$qg_result" ;;
  *)     block "quality-gate.stamp" "${qg_result#FAIL }. Run /quality-gate, then re-push" ;;
esac

# -- 5. pre-pr.stamp -------------------------------------------------------------
pp_result="$(validate_stamp "$PP_STAMP")"
case "$pp_result" in
  OK\ *) read -r _ pp_epoch pp_head <<< "$pp_result" ;;
  *)     block "pre-pr.stamp" "${pp_result#FAIL }. Run /pre-pr, then re-push" ;;
esac
[[ "$pp_head" == "-" ]] && block "pre-pr.stamp" "has no 'head' field — re-run /pre-pr"

# -- 6. Per-pushed-sha checks ----------------------------------------------------
# Multi-ref pre-check: pre-pr.stamp carries a single head, so a push updating
# several feature refs with DIFFERENT tips can never validate — name the real
# cause instead of a misleading per-sha "head mismatch".
first_sha="${gated_shas[0]}"
for sha in "${gated_shas[@]}"; do
  if [[ "$sha" != "$first_sha" ]]; then
    block "pre-pr.stamp" "multi-ref feature push detected (multiple distinct tip SHAs) — a single-head stamp cannot vouch for more than one ref. Push one feature ref at a time, re-running /pre-pr for each final commit"
  fi
done

for sha in "${gated_shas[@]}"; do
  if [[ "$pp_head" != "$sha" ]]; then
    block "pre-pr.stamp" "head ($pp_head) does not match pushed commit ($sha). Re-run /pre-pr on the final commit"
  fi
  if [[ "$qg_head" != "-" && "$qg_head" != "$sha" ]]; then
    block "quality-gate.stamp" "head ($qg_head) does not match pushed commit ($sha). Re-run /quality-gate on the final commit"
  fi
  commit_epoch="$(git log -1 --format=%ct "$sha" 2>/dev/null || echo "")"
  [[ -z "$commit_epoch" ]] && block "infrastructure" "cannot read committer date of $sha"
  if (( commit_epoch > qg_epoch )); then
    block "quality-gate.stamp" "is OLDER than the pushed commit — the commit was created/amended/rebased AFTER the quality gate ran. Re-run /quality-gate on the final commit"
  fi
done

echo "[pre-push-hook] OK: both stamps PASS + fresh and match the pushed commit(s)." >&2
exit 0
