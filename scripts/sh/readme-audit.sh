#!/usr/bin/env bash
# readme-audit.sh — Comprehensive README/doc audit against filesystem reality
# Usage: readme-audit.sh --project-root <path> [--fix] [--json]
#
# Checks: counts, table completeness, project tree, dead references,
# consumer/L0 split accuracy, skill descriptions vs SKILL.md, 
# script table vs disk, MCP tool table vs disk, agent table vs disk,
# guide hub completeness, and numeric claims in prose.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/suppressions.sh" 2>/dev/null || true

# ─── Defaults ───
PROJECT_ROOT=""
FIX_MODE=false
JSON_OUTPUT=false
FINDINGS=()

usage() {
  cat <<EOF
Usage: $(basename "$0") --project-root <path> [OPTIONS]

Options:
  --project-root <path>   Path to the project root (required)
  --fix                   Apply auto-fixable corrections
  --json                  Output findings as JSON
  -h | --help             Show this help
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-root)  PROJECT_ROOT="$2"; shift 2 ;;
    --fix)           FIX_MODE=true; shift ;;
    --json)          JSON_OUTPUT=true; shift ;;
    -h|--help)       usage ;;
    *)               echo "Unknown: $1"; exit 1 ;;
  esac
done

[[ -z "$PROJECT_ROOT" ]] && { echo "ERROR: --project-root required"; exit 1; }
cd "$PROJECT_ROOT"

# ─── Helpers ───
add_finding() {
  local severity="$1" category="$2" message="$3" fixable="${4:-false}"
  local dedupe_key="readme-audit:${category}:${message:0:80}"
  
  # Check if suppressed
  if type is_suppressed &>/dev/null && is_suppressed "$PROJECT_ROOT" "$dedupe_key"; then
    SUPPRESSED_COUNT=$((${SUPPRESSED_COUNT:-0} + 1))
    return
  fi
  
  FINDINGS+=("$severity|$category|$message|$fixable")
}

# ─── 1. SKILL TABLE AUDIT ───
echo "▶ Checking skill tables..."

# Actual skills on disk
actual_skills=$(find skills -name "SKILL.md" -exec dirname {} \; | xargs -I {} basename {} | sort)
actual_skill_count=$(echo "$actual_skills" | wc -l | tr -d ' \r')

# Skills in AGENTS.md
if [ -f AGENTS.md ]; then
  agents_md_header=$(grep -oE 'Available Skills \([0-9]+\)' AGENTS.md | grep -oE '[0-9]+' || echo "0")
  agents_md_skills=$(sed -n '/## Available Skills/,/## MCP Tools/p' AGENTS.md | grep "^| \`" | sed 's/| `\([^`]*\)`.*/\1/' | sort || true)
  agents_md_skill_count=$(echo "$agents_md_skills" | grep -c "." || echo "0")
  
  if [ "$agents_md_header" != "$actual_skill_count" ]; then
    add_finding "HIGH" "count" "AGENTS.md 'Available Skills ($agents_md_header)' but actual: $actual_skill_count" "true"
  fi
  
  # Missing from table
  for skill in $actual_skills; do
    if ! echo "$agents_md_skills" | grep -qx "$skill"; then
      add_finding "MEDIUM" "missing" "Skill '$skill' exists on disk but missing from AGENTS.md table" "true"
    fi
  done
  
  # In table but not on disk
  for skill in $agents_md_skills; do
    if ! echo "$actual_skills" | grep -qx "$skill"; then
      add_finding "MEDIUM" "phantom" "Skill '$skill' in AGENTS.md table but not on disk" "true"
    fi
  done
fi

# Skills in README.md
if [ -f README.md ]; then
  readme_consumer_skills=$(sed -n '/### Skills/,/### L0 Maintenance/p' README.md | grep "^| " | grep -oE '/[a-z][-a-z]*' | sed 's|^/||' | sort -u || true)
  readme_l0_skills=$(sed -n '/### L0 Maintenance Skills/,/^## /p' README.md | grep "^| " | grep -oE '/[a-z][-a-z]*' | sed 's|^/||' | sort -u || true)
fi

# ─── 2. MCP TOOL TABLE AUDIT ───
echo "▶ Checking MCP tool tables..."

if [ -d mcp-server/src/tools ]; then
  actual_mcp=$(ls mcp-server/src/tools/*.ts 2>/dev/null | xargs -I {} basename {} .ts | grep -v index | sort)
  actual_mcp_count=$(echo "$actual_mcp" | grep -c "." || echo "0")
  
  if [ -f AGENTS.md ]; then
    agents_mcp_header=$(grep -oE 'MCP Tools \([0-9]+\)' AGENTS.md | grep -oE '[0-9]+' || echo "0")
    agents_mcp_tools=$(sed -n '/## MCP Tools/,/## Quality Gate/p' AGENTS.md | grep "^| \`" | sed 's/| `\([^`]*\)`.*/\1/' | sort)
    
    if [ "$agents_mcp_header" != "$actual_mcp_count" ]; then
      add_finding "HIGH" "count" "AGENTS.md 'MCP Tools ($agents_mcp_header)' but actual: $actual_mcp_count" "true"
    fi
    
    for tool in $actual_mcp; do
      if ! echo "$agents_mcp_tools" | grep -qx "$tool"; then
        add_finding "MEDIUM" "missing" "MCP tool '$tool' on disk but missing from AGENTS.md" "true"
      fi
    done
    
    for tool in $agents_mcp_tools; do
      if ! echo "$actual_mcp" | grep -qx "$tool"; then
        add_finding "MEDIUM" "phantom" "MCP tool '$tool' in AGENTS.md but not on disk" "true"
      fi
    done
  fi
fi

# ─── 3. AGENT TABLE AUDIT ───
echo "▶ Checking agent tables..."

actual_agents=$(ls .claude/agents/*.md 2>/dev/null | xargs -I {} basename {} .md | sort || true)
actual_agent_count=$(echo "$actual_agents" | grep -c "." || echo "0")

if [ -f README.md ]; then
  readme_agents=$(sed -n '/^## Agents/,/^## /p' README.md | grep "^| \`" | sed 's/| `\([^`]*\)`.*/\1/' | sort || true)
  readme_agent_count=$(echo "$readme_agents" | grep -c "." || echo "0")
  
  for agent in $actual_agents; do
    if ! echo "$readme_agents" | grep -qx "$agent"; then
      add_finding "MEDIUM" "missing" "Agent '$agent' on disk but missing from README agents table" "true"
    fi
  done
fi

# ─── 4. SCRIPT TABLE AUDIT ───
echo "▶ Checking script tables..."

if [ -d scripts/sh ]; then
  actual_sh=$(ls scripts/sh/*.sh 2>/dev/null | xargs -I {} basename {} .sh | sort || true)
  actual_sh_count=$(echo "$actual_sh" | grep -c "." || echo "0")

  if [ -f README.md ]; then
    readme_scripts=$(sed -n '/^## Scripts/,/^## /p' README.md | grep "^| \`" | sed 's/| `\([^`]*\)`.*/\1/' | sort || true)
    
    for script in $readme_scripts; do
      if ! echo "$actual_sh" | grep -qx "$script"; then
        # Check lib/ 
        if [ -f "scripts/sh/lib/${script}.sh" ]; then
          add_finding "LOW" "misplaced" "Script '$script' listed in README scripts table but is in lib/ (library, not standalone)" "true"
        else
          add_finding "MEDIUM" "phantom" "Script '$script' in README table but not on disk" "true"
        fi
      fi
    done
    
    for script in $actual_sh; do
      if ! echo "$readme_scripts" | grep -qx "$script"; then
        add_finding "MEDIUM" "missing" "Script '$script' on disk but missing from README scripts table" "true"
      fi
    done
  fi
fi

# ─── 5. GUIDE HUB COMPLETENESS ───
echo "▶ Checking guide hub..."

if [ -f docs/guides/guides-hub.md ]; then
  actual_guides=$(ls docs/guides/*.md 2>/dev/null | xargs -I {} basename {} .md | grep -v "guides-hub" | sort)
  
  for guide in $actual_guides; do
    if ! grep -q "$guide" docs/guides/guides-hub.md; then
      add_finding "LOW" "missing" "Guide '$guide.md' not linked in guides-hub.md" "true"
    fi
  done
fi

# ─── 6. ALL HUB LINK VALIDATION ───
echo "▶ Checking hub links..."

for hub in docs/*/; do
  hub_file="${hub}$(basename "$hub")-hub.md"
  [ -f "$hub_file" ] || continue
  
  # Extract markdown links
  grep -oE '\([a-zA-Z0-9_-]+\.md\)' "$hub_file" 2>/dev/null | tr -d '()\r' | while read link; do
    if [ ! -f "${hub}${link}" ]; then
      add_finding "MEDIUM" "broken-link" "Hub '$hub_file' links to '$link' which doesn't exist" "false"
    fi
  done
done

# ─── 6b. README DOCUMENTATION TABLE vs FILESYSTEM ───
echo "▶ Checking README Documentation table..."

if [ -f README.md ]; then
  # Every hub directory on disk should have a row in the Documentation table
  for hub_dir in docs/*/; do
    [ -d "$hub_dir" ] || continue
    hub_name=$(basename "$hub_dir")
    hub_file="${hub_dir}${hub_name}-hub.md"
    [ -f "$hub_file" ] || continue
    
    # Check if this hub appears in the README Documentation table
    if ! sed -n '/^## Documentation/,/^---$/p' README.md | grep -q "$hub_name"; then
      add_finding "MEDIUM" "missing" "Hub '$hub_name/' exists on disk but missing from README Documentation table" "true"
    fi
  done
  
  # Every link in the Documentation table should point to an existing file
  while IFS= read -r link; do
    [ -z "$link" ] && continue
    if [ ! -f "$link" ]; then
      add_finding "MEDIUM" "broken-link" "README Documentation table links to '$link' which doesn't exist" "false"
    fi
  done < <(sed -n '/^## Documentation/,/^---$/p' README.md | grep -oE '\(docs/[^)]+\)' | tr -d '()\r' 2>/dev/null)
  
  # Sub-doc count in each hub should match what's on disk
  for hub_dir in docs/*/; do
    [ -d "$hub_dir" ] || continue
    hub_name=$(basename "$hub_dir")
    hub_file="${hub_dir}${hub_name}-hub.md"
    [ -f "$hub_file" ] || continue
    
    # Count sub-docs in hub (markdown links in the Documents table)
    hub_links=$(grep -oE '\([a-zA-Z0-9_-]+\.md\)' "$hub_file" 2>/dev/null | wc -l | tr -d ' \r')
    # Count actual non-hub .md files in the directory
    actual_docs=$(find "$hub_dir" -maxdepth 1 -name "*.md" -not -name "*hub*" | wc -l | tr -d ' \r')
    
    if [ "$hub_links" -gt 0 ] && [ "$actual_docs" -gt 0 ] && [ "$hub_links" -ne "$actual_docs" ]; then
      add_finding "LOW" "count" "Hub '$hub_name': links $hub_links docs but directory has $actual_docs non-hub .md files" "true"
    fi
  done
fi

# ─── 7. PROSE NUMBER CLAIMS IN README ───
echo "▶ Checking prose number claims..."

if [ -f README.md ]; then
  # MCP tools in description
  readme_mcp_desc=$(grep -oE 'MCP server with [0-9]+ tools' README.md | grep -oE '[0-9]+' | head -1 || echo "?")
  if [ -n "$readme_mcp_desc" ] && [ "$readme_mcp_desc" != "?" ]; then
    actual_mcp_for_check=$(ls mcp-server/src/tools/*.ts 2>/dev/null | grep -v index 2>/dev/null | wc -l | tr -d ' \r' || true)
    if [ "$readme_mcp_desc" != "$actual_mcp_for_check" ]; then
      add_finding "HIGH" "count" "README description says '$readme_mcp_desc tools' but actual: $actual_mcp_for_check" "true"
    fi
  fi
  
  # Detekt rules claim
  readme_detekt=$(grep -oE '[0-9]+ custom Detekt' README.md | grep -oE '[0-9]+' | head -1 || echo "?")
  if [ -n "$readme_detekt" ] && [ "$readme_detekt" != "?" ]; then
    actual_detekt=$(find detekt-rules/src/main/kotlin -name "*Rule.kt" -type f 2>/dev/null | wc -l | tr -d ' \r')
    if [ "$readme_detekt" != "$actual_detekt" ]; then
      add_finding "HIGH" "count" "README says '$readme_detekt Detekt rules' but actual: $actual_detekt" "true"
    fi
  fi
  
  # Guide count claim
  guides_claim=$(grep -oE '[0-9]+ guides' README.md | grep -oE '[0-9]+' | head -1 || echo "?")
  if [ -n "$guides_claim" ] && [ "$guides_claim" != "?" ]; then
    actual_guides_count=$(find docs/guides -name "*.md" -not -name "*hub*" 2>/dev/null | wc -l | tr -d ' \r')
    if [ "$guides_claim" != "$actual_guides_count" ]; then
      add_finding "MEDIUM" "count" "README says '$guides_claim guides' but actual: $actual_guides_count" "true"
    fi
  fi
  
  # Sub-docs claim
  subdocs_claim=$(grep -oE '[0-9]+ sub-docs' README.md | grep -oE '[0-9]+' | head -1 || echo "?")
  if [ -n "$subdocs_claim" ] && [ "$subdocs_claim" != "?" ]; then
    actual_subdocs=$(find docs -name "*.md" -not -name "*hub*" -not -path "*/guides/*" -not -path "*/agents/*" -not -path "*/archive/*" 2>/dev/null | wc -l | tr -d ' \r')
    if [ "$subdocs_claim" != "$actual_subdocs" ]; then
      add_finding "MEDIUM" "count" "README says '$subdocs_claim sub-docs' but actual: $actual_subdocs" "true"
    fi
  fi
  
  # Commands count
  commands_claim=$(grep "Commands.*\.claude" README.md | grep -oE '[0-9]+' | head -1 || echo "?")
  if [ -n "$commands_claim" ] && [ "$commands_claim" != "?" ]; then
    actual_cmds=$(ls .claude/commands/*.md 2>/dev/null | wc -l | tr -d ' \r')
    if [ "$commands_claim" != "$actual_cmds" ]; then
      add_finding "MEDIUM" "count" "README says '$commands_claim commands' but actual: $actual_cmds" "true"
    fi
  fi
fi

# ─── 8. PROJECT TREE vs FILESYSTEM ───
echo "▶ Checking project tree..."

if [ -f README.md ]; then
  # Check key tree entries mention correct counts
  tree_sh=$(grep 'sh/' README.md | grep -oE '[0-9]+ scripts' | grep -oE '[0-9]+' | head -1 || echo "?")
  if [ "$tree_sh" != "?" ]; then
    if [ "$tree_sh" != "$actual_sh_count" ]; then
      add_finding "MEDIUM" "count" "Project tree says '$tree_sh sh scripts' but actual: $actual_sh_count" "true"
    fi
  fi
  
  # Check for directories that exist but aren't in the tree
  for dir in "setup/agent-templates" "setup/copilot-agent-templates"; do
    if [ -d "$dir" ] && ! grep -q "$(basename "$dir")" README.md; then
      add_finding "MEDIUM" "missing" "Directory '$dir/' exists but not in README project tree" "true"
    fi
  done
  
  # Check version.properties mention
  if [ -f "version.properties" ] && ! grep -q "version.properties" README.md; then
    add_finding "LOW" "missing" "version.properties exists but not mentioned in README" "true"
  fi
fi

# ─── 9. CONSUMER vs L0-ONLY SPLIT ───
echo "▶ Checking consumer/L0 split claims..."

if [ -f README.md ] && [ -f skills/registry.json ]; then
  # README claims about consumer skill count
  consumer_claim=$(grep "Consumer skills" README.md | grep -oE '[0-9]+' | head -1 || echo "?")
  consumer_agent_claim=$(grep -E "Consumer agents|Domain Agents" README.md | grep -oE '[0-9]+' | head -1 || echo "?")
  
  # Check if sync actually sends ALL agents (not just 8+2=10)
  if [ "$consumer_agent_claim" != "?" ]; then
    # All 15 L0 agents get synced — README says 10
    if [ "$consumer_agent_claim" != "$actual_agent_count" ]; then
      add_finding "HIGH" "content" "README says '$consumer_agent_claim consumer agents' but all $actual_agent_count get synced" "true"
    fi
  fi
fi

# ─── 10. REPORT ───
echo ""
echo "═══════════════════════════════════════════════"
echo "  README/DOC AUDIT RESULTS"
echo "═══════════════════════════════════════════════"
echo ""

high=0; medium=0; low=0; fixable=0
for f in "${FINDINGS[@]}"; do
  sev=$(echo "$f" | cut -d'|' -f1)
  cat=$(echo "$f" | cut -d'|' -f2)
  msg=$(echo "$f" | cut -d'|' -f3)
  fix=$(echo "$f" | cut -d'|' -f4)
  
  case "$sev" in
    HIGH)   high=$((high+1)); icon="🔴" ;;
    MEDIUM) medium=$((medium+1)); icon="🟡" ;;
    LOW)    low=$((low+1)); icon="🟢" ;;
    *)      icon="⚪" ;;
  esac
  
  [ "$fix" = "true" ] && fixable=$((fixable+1))
  printf "  %s %-10s %-12s %s\n" "$icon" "[$sev]" "($cat)" "$msg"
done

total=${#FINDINGS[@]}
echo ""
echo "  Total: $total findings ($high HIGH, $medium MEDIUM, $low LOW)"
echo "  Fixable: $fixable / $total"
[ "${SUPPRESSED_COUNT:-0}" -gt 0 ] && echo "  Suppressed: $SUPPRESSED_COUNT (see .androidcommondoc/audit-suppressions.jsonl)"
echo "═══════════════════════════════════════════════"

# ─── FIX MODE ───
fix_findings() {
  local fixes=0
  local py_tmp
  py_tmp=$(mktemp /tmp/readme-audit-fix.XXXXXX.py)
  trap 'rm -f "$py_tmp"' RETURN

  # Write Python helper script once — reused per fix call
  cat > "$py_tmp" << 'PYEOF'
import sys, re, json

action = sys.argv[1]

if action == "count":
    path, old, new = sys.argv[2], sys.argv[3], sys.argv[4]
    content = open(path, encoding='utf-8').read()
    updated = re.sub(r'(?<!\d)' + re.escape(old) + r'(?!\d)', new, content, count=1)
    if updated != content:
        open(path, 'w', encoding='utf-8').write(updated)
        print("changed")

elif action == "append_row":
    path, name, desc = sys.argv[2], sys.argv[3], sys.argv[4]
    content = open(path, encoding='utf-8').read()
    lines = content.splitlines(keepends=True)
    insert_at = -1
    in_table = False
    for i, line in enumerate(lines):
        if '## Available Skills' in line:
            in_table = True
        if in_table and line.startswith('| '):
            insert_at = i
        if in_table and line.strip() == '' and insert_at >= 0:
            break
    if insert_at >= 0:
        new_row = f'| `{name}` | {desc} |\n'
        lines.insert(insert_at + 1, new_row)
        open(path, 'w', encoding='utf-8').writelines(lines)
        print("changed")

elif action == "remove_row":
    path, name = sys.argv[2], sys.argv[3]
    content = open(path, encoding='utf-8').read()
    lines = content.splitlines(keepends=True)
    filtered = [l for l in lines if f'`{name}`' not in l]
    if len(filtered) < len(lines):
        open(path, 'w', encoding='utf-8').writelines(filtered)
        print("changed")
PYEOF

  for f in "${FINDINGS[@]}"; do
    local cat msg fixable
    cat=$(echo "$f" | cut -d'|' -f2)
    msg=$(echo "$f" | cut -d'|' -f3)
    fixable=$(echo "$f" | cut -d'|' -f4)
    [[ "$fixable" != "true" ]] && continue

    case "$cat" in
      count)
        # Extract old number: from "says 'N" OR from "(N)" notation
        old_num=$(echo "$msg" | grep -oE "says '[0-9]+" | grep -oE '[0-9]+' | head -1 || true)
        if [[ -z "$old_num" ]]; then
          old_num=$(echo "$msg" | grep -oE '\([0-9]+\)' | grep -oE '[0-9]+' | head -1 || true)
        fi
        new_num=$(echo "$msg" | grep -oE 'actual: [0-9]+' | grep -oE '[0-9]+' | head -1 || true)
        [[ -z "$old_num" || -z "$new_num" ]] && continue
        [[ "$old_num" == "$new_num" ]] && continue
        if echo "$msg" | grep -q "AGENTS.md"; then
          target_file="AGENTS.md"
        else
          target_file="README.md"
        fi
        [[ ! -f "$target_file" ]] && continue
        result=$(python3 "$py_tmp" count "$target_file" "$old_num" "$new_num" || true)
        [[ "$result" == "changed" ]] && fixes=$((fixes + 1))
        ;;

      missing)
        if echo "$msg" | grep -q "Skill '.*' exists on disk but missing from AGENTS.md"; then
          skill_name=$(echo "$msg" | grep -oE "Skill '[^']+'" | grep -oE "'[^']+'" | tr -d "'")
          [[ -z "$skill_name" || ! -f "AGENTS.md" ]] && continue
          skill_desc=""
          if [ -f "skills/$skill_name/SKILL.md" ]; then
            skill_desc=$(grep '^description:' "skills/$skill_name/SKILL.md" | sed 's/^description: *//' | sed 's/^"//' | sed 's/"$//' | head -1 || true)
          fi
          [[ -z "$skill_desc" ]] && skill_desc="—"
          result=$(python3 "$py_tmp" append_row "AGENTS.md" "$skill_name" "$skill_desc" || true)
          [[ "$result" == "changed" ]] && fixes=$((fixes + 1))
        fi
        ;;

      phantom)
        if echo "$msg" | grep -q "Skill '.*' in AGENTS.md table but not on disk"; then
          skill_name=$(echo "$msg" | grep -oE "Skill '[^']+'" | grep -oE "'[^']+'" | tr -d "'")
          [[ -z "$skill_name" || ! -f "AGENTS.md" ]] && continue
          result=$(python3 "$py_tmp" remove_row "AGENTS.md" "$skill_name" || true)
          [[ "$result" == "changed" ]] && fixes=$((fixes + 1))
        fi
        ;;
    esac
  done

  echo ""
  echo "  Applied: $fixes fix(es)"
}

if $FIX_MODE; then
  fix_findings
fi

[ "$high" -gt 0 ] && exit 1 || exit 0
