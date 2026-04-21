#!/usr/bin/env bash
# audit-wiring.sh — one-shot tool/skill wiring audit for AndroidCommonDoc L0.
# Cross-references MCP tools × skills × waves × agents × top-level docs.
# Prints a single Markdown report to stdout.

set -euo pipefail

ROOT="${1:-.}"
cd "$ROOT"

TOOLS_DIR="mcp-server/src/tools"
SKILLS_DIR="skills"
AGENTS_DIRS=(".claude/agents" "setup/agent-templates")
DOCS=("CLAUDE.md" "README.md" "skills/full-audit/profiles.json")

# Collect inventories ---------------------------------------------------------
# Extract REGISTERED tool names (from server.registerTool("<name>", ...)), not file basenames.
# Handles naming drift: check-freshness.ts registers as check-doc-freshness,
# verify-kmp.ts registers as verify-kmp-packages.
mapfile -t TOOLS < <(
  for f in "$TOOLS_DIR"/*.ts; do
    [ "$(basename "$f")" = "index.ts" ] && continue
    # Find the first string literal after server.registerTool( OR server.tool(
    # (MCP SDK supports both — older files use .tool, newer use .registerTool)
    # || true so `set -e` + `pipefail` don't abort on files w/o a match
    { grep -E -A1 "server\.(registerTool|tool)\(" "$f" 2>/dev/null | \
      grep -oE '"[a-z][a-z-]+"' | head -1 | tr -d '"'; } || true
  done | sort -u | grep -v '^$'
)

mapfile -t SKILLS < <(find "$SKILLS_DIR" -mindepth 1 -maxdepth 1 -type d \
  -exec basename {} \; | sort)

count_grep() {
  local pattern="$1"; shift
  local hits=0
  for target in "$@"; do
    [ -e "$target" ] || continue
    local c
    c=$(grep -rlF -- "$pattern" "$target" 2>/dev/null | wc -l | tr -d ' ')
    hits=$((hits + c))
  done
  echo "$hits"
}

# MCP tools matrix ------------------------------------------------------------
echo "# Wiring Audit — $(date +%F)"
echo
echo "## MCP Tools (${#TOOLS[@]} total)"
echo
echo "| Tool | agents | templates | skills | CLAUDE | README | profiles | status |"
echo "|---|---:|---:|---:|---:|---:|---:|---|"

wired=0; orphan=0; marketing_only=0
for tool in "${TOOLS[@]}"; do
  a=$(count_grep "$tool" ".claude/agents")
  t=$(count_grep "$tool" "setup/agent-templates")
  s=$(count_grep "$tool" "skills")
  c=$(count_grep "$tool" "CLAUDE.md")
  r=$(count_grep "$tool" "README.md")
  p=$(count_grep "$tool" "skills/full-audit/profiles.json")

  behavioral=$((a + t + s + p))
  doc_only=$((c + r))

  if [ "$behavioral" -gt 0 ]; then
    status="WIRED"; wired=$((wired + 1))
  elif [ "$doc_only" -gt 0 ]; then
    status="MARKETING"; marketing_only=$((marketing_only + 1))
  else
    status="ORPHAN"; orphan=$((orphan + 1))
  fi
  echo "| \`$tool\` | $a | $t | $s | $c | $r | $p | $status |"
done

echo
echo "**Summary:** WIRED=$wired, MARKETING-ONLY=$marketing_only, ORPHAN=$orphan"

# Skills matrix ---------------------------------------------------------------
echo
echo "## Skills (${#SKILLS[@]} total)"
echo
echo "| Skill | agents | templates | waves | CLAUDE | README | status |"
echo "|---|---:|---:|---:|---:|---:|---|"

s_wired=0; s_orphan=0; s_marketing=0
for skill in "${SKILLS[@]}"; do
  a=$(count_grep "$skill" ".claude/agents")
  t=$(count_grep "$skill" "setup/agent-templates")
  w=$(count_grep "$skill" "skills/full-audit/profiles.json")
  c=$(count_grep "$skill" "CLAUDE.md")
  r=$(count_grep "$skill" "README.md")

  behavioral=$((a + t + w))
  doc_only=$((c + r))

  if [ "$behavioral" -gt 0 ]; then
    status="WIRED"; s_wired=$((s_wired + 1))
  elif [ "$doc_only" -gt 0 ]; then
    status="MARKETING"; s_marketing=$((s_marketing + 1))
  else
    status="ORPHAN"; s_orphan=$((s_orphan + 1))
  fi
  echo "| \`$skill\` | $a | $t | $w | $c | $r | $status |"
done

echo
echo "**Summary:** WIRED=$s_wired, MARKETING-ONLY=$s_marketing, ORPHAN=$s_orphan"

# Agent MCP tool declaration audit --------------------------------------------
echo
echo "## Agents with MCP tool declaration in frontmatter"
echo
echo "Agents that CLAIM to use MCP tools in prose but don't list them in \`tools:\` frontmatter are wired-by-prose-only — the harness won't load the MCP schemas for them."
echo
echo "| Agent | prose refs (MCP) | frontmatter declares MCP | gap |"
echo "|---|---:|---:|---|"

for dir in "${AGENTS_DIRS[@]}"; do
  [ -d "$dir" ] || continue
  for f in "$dir"/*.md; do
    [ -f "$f" ] || continue
    prose=$(grep -cE 'search-docs|find-pattern|module-health|dependency-graph|pattern-coverage|code-metrics|l0-diff|suggest-docs|api-surface-diff|validate-all|validate-claude-md' "$f" || true)
    # Check frontmatter tools line for mcp__ reference
    fm_mcp=$(awk '/^---$/{c++} c==1 && /^tools:/ {print}' "$f" | grep -c "mcp__" || true)
    if [ "$prose" -gt 0 ]; then
      gap="OK"
      [ "$fm_mcp" -eq 0 ] && gap="WIRING GAP"
      echo "| \`${f#./}\` | $prose | $fm_mcp | $gap |"
    fi
  done
done

echo
echo "_End of audit._"
