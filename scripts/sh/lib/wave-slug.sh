#!/usr/bin/env bash
# wave-slug.sh — Shared bash wave-slug resolver. Source this file.
#
# Provides: get_wave_slug <project_root>
#   Prints the active wave slug to stdout.
#   Mirrors JS getWaveSlug in premature-execution-gate.js (canonical).
#   Returns empty string if no wave is active.
#
# Priority order (mirrors JS canonical):
#   1. CLAUDE_WAVE_SLUG env var (trimmed; reject develop/master/main/HEAD)
#   2. git symbolic-ref --short HEAD (primary), abbrev-ref (fallback); last-segment extraction
#   3. Alias scan: single .planning/wave-*/PLAN.md dir
#
# grep-assignment safety: all grep captures use || true (set -euo pipefail safe).

# Validate slug against allowlist — returns 0 (valid) or 1 (invalid).
# Allowlist: ^[A-Za-z0-9._-]+$  Reject: empty, ".", "..", slash, backslash.
_validate_slug() {
  local s="$1"
  [[ -z "$s" ]] && return 1
  [[ "$s" == "." || "$s" == ".." ]] && return 1
  [[ "$s" == */* || "$s" == *\\* ]] && return 1
  [[ "$s" =~ ^[A-Za-z0-9._-]+$ ]] || return 1
  return 0
}

get_wave_slug() {
  local project_root="${1:-$(pwd)}"
  local reject_list="develop master main HEAD"

  # Priority 1: explicit env var
  local env_slug
  env_slug="$(printf '%s' "${CLAUDE_WAVE_SLUG:-}" | tr -d '[:space:]')"
  if [[ -n "$env_slug" ]]; then
    local is_rejected=0
    for r in $reject_list; do
      [[ "$env_slug" == "$r" ]] && is_rejected=1 && break
    done
    if [[ "$is_rejected" -eq 0 ]]; then
      if _validate_slug "$env_slug"; then
        printf '%s' "$env_slug"
        return 0
      fi
    fi
  fi

  # Priority 2: git branch (symbolic-ref primary, abbrev-ref fallback)
  local branch=""
  branch="$(git -C "$project_root" symbolic-ref --short HEAD 2>/dev/null || true)"
  if [[ -z "$branch" ]]; then
    branch="$(git -C "$project_root" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  fi
  if [[ -n "$branch" && "$branch" != "HEAD" ]]; then
    local is_rejected=0
    for r in $reject_list; do
      [[ "$branch" == "$r" ]] && is_rejected=1 && break
    done
    if [[ "$is_rejected" -eq 0 ]]; then
      # Last-segment extraction (P2b: covers codex/* and feature/* branches)
      local slug="${branch##*/}"
      local slug_rejected=0
      for r in $reject_list; do
        [[ "$slug" == "$r" ]] && slug_rejected=1 && break
      done
      if [[ -n "$slug" && "$slug_rejected" -eq 0 ]]; then
        if _validate_slug "$slug"; then
          printf '%s' "$slug"
          return 0
        fi
      fi
    fi
  fi

  # Priority 3: alias scan — single .planning/wave-*/PLAN.md dir
  local planning_dir="$project_root/.planning"
  if [[ -d "$planning_dir" ]]; then
    local wave_dirs=()
    while IFS= read -r d; do
      [[ -f "$d/PLAN.md" ]] && wave_dirs+=("$d")
    done < <(find "$planning_dir" -maxdepth 1 -name 'wave-*' -type d 2>/dev/null || true)
    if [[ "${#wave_dirs[@]}" -eq 1 ]]; then
      local dir_name
      dir_name="$(basename "${wave_dirs[0]}")"
      local alias_slug="${dir_name#wave-}"
      if _validate_slug "$alias_slug"; then
        printf '%s' "$alias_slug"
        return 0
      fi
    fi
  fi

  printf ''
  return 0
}
