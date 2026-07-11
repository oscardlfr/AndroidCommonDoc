#!/usr/bin/env bash
# verify-git-hooks.sh — clone-gating verifier (H1 Push Authority Bootstrap).
#
# USAGE
#   verify-git-hooks.sh [--repo-root <path>]
#
# --repo-root <path>   Repo root to verify against (default: `git rev-parse
#                       --show-toplevel`) — same flag name and override
#                       precedence as emit-push-proof.sh's own --repo-root.
#
# WHAT IT CHECKS
#   Confirms the git-layer pre-push hook — resolved via `git rev-parse
#   --git-path hooks/pre-push` so core.hooksPath and worktrees are honored,
#   NEVER a hardcoded .git/hooks/pre-push — is installed AND byte-identical,
#   after CRLF->LF normalization on BOTH sides, to the canonical source at
#   scripts/sh/pre-push-hook.sh. This is the single primitive that
#   emit-push-proof.sh (mint), push-authorization-gate.js (JS gate), and
#   setup-check.ts (Check 7) all delegate to.
#
# REASON CODES (checked IN THIS ORDER — the first failing check wins; later
# checks are never attempted once an earlier one fails):
#   1. canonical-source-missing — scripts/sh/pre-push-hook.sh is unresolvable
#      or unreadable. Checked FIRST, UNCONDITIONALLY — never a silent
#      both-sides-unreadable "vacuous pass".
#   2. hook-absent — resolved hook path is not a regular file (symlink-
#      following `-f` test; fails closed on a dangling symlink target).
#   3. hook-not-executable — hook exists but is not executable (symlink-
#      following `-x` test).
#   4. hook-marker-missing — hook exists+executable but lacks the
#      ACDOC-PRE-PUSH-GATE marker line (no CRLF sensitivity needed for a
#      plain substring test).
#   5. hook-drifted — marker present but sha256(installed) != sha256(canonical)
#      once BOTH sides are CRLF->LF normalized. An untracked installed hook is
#      frozen at install-time line endings, so one-sided normalization would
#      false-positive on a line-ending-only difference (e.g. after a
#      .gitattributes change or a Windows core.autocrlf checkout).
#
# OUTPUT / EXIT CODES
#   0        all checks pass. Stdout is silent; a confirmation line is
#            written to stderr.
#   nonzero  exactly one reason code above is printed ALONE on stdout (a
#            single line, nothing else on stdout) so callers can capture it
#            via `code="$(verify-git-hooks.sh ...)"`. A human-readable
#            BLOCKED line is written to stderr in every failure case.
#            A usage/argument error (unknown flag, no sha256 tool on PATH,
#            etc.) also exits nonzero but is NOT one of the 5 reason codes
#            above — stdout stays empty for that path; the error goes to
#            stderr only.
#
# Fail-CLOSED throughout: any unresolved condition is a nonzero exit, never
# a silent pass.

set -euo pipefail

MARKER="ACDOC-PRE-PUSH-GATE"
REPO_ROOT_OVERRIDE=""

usage() {
  sed -n '2,/^$/p' "$0"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-root)
      REPO_ROOT_OVERRIDE="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[verify-git-hooks] ERROR: unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

# -- Repo root resolution (never ambient $PWD once resolved) ------------------
if [[ -n "$REPO_ROOT_OVERRIDE" ]]; then
  REPO_ROOT="$REPO_ROOT_OVERRIDE"
else
  REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi

CANONICAL_SOURCE="$REPO_ROOT/scripts/sh/pre-push-hook.sh"

fail() {  # $1 = reason code, $2 = human-readable detail
  echo "$1"
  {
    echo "[verify-git-hooks] BLOCKED: $1 — ${2:-}"
    echo "  Fix: bash scripts/sh/install-git-hooks.sh   (or: make install-git-hooks)"
  } >&2
  exit 1
}

sha256_of() {  # $1 = file path; prints hex digest of the file's content after
               # folding CRLF (\r\n) pairs to LF -- a lone \r NOT immediately
               # followed by \n (e.g. a mid-line stray CR byte) is left
               # untouched and therefore still changes the digest. Mirrors the
               # canonical `content.replace(b'\r\n', b'\n')` idiom in
               # emit-push-proof.sh; applied identically to the installed hook
               # and the canonical source before hashing (see reason code 5).
  local norm='import sys; sys.stdout.buffer.write(sys.stdin.buffer.read().replace(b"\r\n", b"\n"))'
  if command -v sha256sum >/dev/null 2>&1; then
    python3 -c "$norm" < "$1" | sha256sum | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    python3 -c "$norm" < "$1" | shasum -a 256 | awk '{print $1}'
  else
    echo "[verify-git-hooks] ERROR: neither sha256sum nor shasum found on PATH" >&2
    exit 1
  fi
}

# -- 1. canonical-source-missing (FIRST, unconditional sanity floor) ----------
if [[ ! -f "$CANONICAL_SOURCE" || ! -r "$CANONICAL_SOURCE" ]]; then
  fail "canonical-source-missing" "unresolvable/unreadable: $CANONICAL_SOURCE"
fi

# -- Resolve the installed hook path (worktree- and core.hooksPath-aware) -----
# `--git-path` is RELATIVE in the default unconfigured case (the common case
# in this repo today) — join against $REPO_ROOT, NEVER ambient $PWD.
raw_git_path="$(git -C "$REPO_ROOT" rev-parse --git-path hooks/pre-push 2>/dev/null)" \
  || fail "hook-absent" "could not resolve hooks path via git -C \"$REPO_ROOT\" rev-parse --git-path hooks/pre-push (not a git repository?)"

case "$raw_git_path" in
  /*) HOOK_PATH="$raw_git_path" ;;
  *)  HOOK_PATH="$REPO_ROOT/$raw_git_path" ;;
esac

# -- 2. hook-absent -------------------------------------------------------------
if [[ ! -f "$HOOK_PATH" ]]; then
  fail "hook-absent" "resolved hook path is not a regular file: $HOOK_PATH"
fi

# -- 3. hook-not-executable ------------------------------------------------------
if [[ ! -x "$HOOK_PATH" ]]; then
  fail "hook-not-executable" "$HOOK_PATH exists but is not executable"
fi

# -- 4. hook-marker-missing -------------------------------------------------------
if ! grep -qF "$MARKER" "$HOOK_PATH"; then
  fail "hook-marker-missing" "$HOOK_PATH does not contain the $MARKER marker"
fi

# -- 5. hook-drifted (CRLF-normalized sha256 on BOTH sides) ----------------------
installed_sha="$(sha256_of "$HOOK_PATH")"
canonical_sha="$(sha256_of "$CANONICAL_SOURCE")"
if [[ "$installed_sha" != "$canonical_sha" ]]; then
  fail "hook-drifted" "$HOOK_PATH sha256 ($installed_sha) != canonical $CANONICAL_SOURCE sha256 ($canonical_sha) after CRLF normalization"
fi

echo "[verify-git-hooks] OK: $HOOK_PATH is installed, executable, and byte-identical (CRLF-normalized) to $CANONICAL_SOURCE" >&2
exit 0
