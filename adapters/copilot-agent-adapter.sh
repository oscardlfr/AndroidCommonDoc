#!/usr/bin/env bash
# Copilot Agent Adapter — Generates .github/agents/*.agent.md from .claude/agents/*.md
# Part of the AndroidCommonDoc adapter pipeline.
#
# Transforms Claude Code agent format to GitHub Copilot agent format:
#   - Strips Claude-specific frontmatter fields (model, memory, skills)
#   - Maps tool names to Copilot equivalents
#   - Inlines referenced L0 skill summaries as context
#   - Outputs to .github/agents/ with .agent.md extension
#
# Usage:
#   copilot-agent-adapter.sh [--project-root <path>] [--l0-root <path>] [--dry-run]
#
# If --project-root is not given, adapts agents from the L0 setup/agent-templates/ directory.
# If --project-root is given, adapts that project's .claude/agents/ (L1/L2-specific only).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
L0_ROOT="${REPO_ROOT}"

PROJECT_ROOT=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-root) PROJECT_ROOT="$2"; shift 2 ;;
    --l0-root) L0_ROOT="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# ── Determine source and output directories ───────────────────────────────────

if [ -n "$PROJECT_ROOT" ]; then
  CLAUDE_AGENTS_DIR="$PROJECT_ROOT/.claude/agents"
  OUTPUT_DIR="$PROJECT_ROOT/.github/agents"
  MANIFEST="$PROJECT_ROOT/l0-manifest.json"

  if [ ! -d "$CLAUDE_AGENTS_DIR" ]; then
    echo "ERROR: No .claude/agents/ found in $PROJECT_ROOT" >&2
    exit 1
  fi

  # Only adapt L1/L2-specific agents (listed in l2_specific.agents)
  if [ -f "$MANIFEST" ]; then
    SPECIFIC_AGENTS=$(python3 -c "
import json, sys
with open('$MANIFEST') as f:
    m = json.load(f)
agents = m.get('l2_specific', m.get('l1_specific', {})).get('agents', [])
for a in agents:
    print(a)
" 2>/dev/null || true)
  else
    echo "WARN: No l0-manifest.json found — adapting ALL agents" >&2
    SPECIFIC_AGENTS=""
  fi
else
  # L0 mode: adapt templates
  CLAUDE_AGENTS_DIR="$L0_ROOT/setup/agent-templates"
  OUTPUT_DIR="$L0_ROOT/setup/copilot-agent-templates"
  SPECIFIC_AGENTS="" # adapt all
fi

mkdir -p "$OUTPUT_DIR"

# ── Tool name mapping ─────────────────────────────────────────────────────────
# Claude Code tools → Copilot coding agent equivalents
# Copilot uses: read, edit, search, run_terminal_command, insert, replace
# The mapping is approximate — Copilot auto-discovers available tools

declare -A TOOL_MAP=(
  ["Read"]="read"
  ["Grep"]="search"
  ["Glob"]="search"
  ["Bash"]="run_terminal_command"
  ["Write"]="edit"
  ["Agent"]=""  # Copilot uses @agent mentions inline, not a tool declaration
)

map_tools() {
  local claude_tools="$1"
  local copilot_tools=""
  local seen=""

  IFS=', ' read -ra tools <<< "$claude_tools"
  for tool in "${tools[@]}"; do
    tool=$(echo "$tool" | tr -d ' ')
    mapped="${TOOL_MAP[$tool]-__UNMAPPED__}"
    [ "$mapped" = "__UNMAPPED__" ] && mapped="$tool"
    [ -z "$mapped" ] && continue
    # Deduplicate
    if [[ ! " $seen " =~ " $mapped " ]]; then
      [ -n "$copilot_tools" ] && copilot_tools="$copilot_tools, "
      copilot_tools="$copilot_tools$mapped"
      seen="$seen $mapped"
    fi
  done
  echo "$copilot_tools"
}

# ── Skill summary inlining ────────────────────────────────────────────────────

get_skill_summary() {
  local skill_name="$1"
  local skill_file="$L0_ROOT/skills/$skill_name/SKILL.md"

  if [ ! -f "$skill_file" ]; then
    echo "  <!-- Skill '$skill_name' not found in L0 -->"
    return
  fi

  # Extract description from frontmatter
  local desc
  desc=$(awk '/^---$/{n++; next} n==1 && /^description:/{sub(/^description:\s*"?/,""); sub(/"?\s*$/,""); print; exit}' "$skill_file")

  echo "- **/$skill_name**: $desc"
}

# ── Process each agent ────────────────────────────────────────────────────────

count=0
skipped=0

for agent_file in "$CLAUDE_AGENTS_DIR"/*.md; do
  [ -f "$agent_file" ] || continue

  basename_file=$(basename "$agent_file")
  agent_name="${basename_file%.md}"

  # Skip README
  [ "$agent_name" = "README" ] && continue

  # If we have a specific list, only adapt those
  if [ -n "$SPECIFIC_AGENTS" ]; then
    if ! echo "$SPECIFIC_AGENTS" | grep -q "^${agent_name}$"; then
      skipped=$((skipped + 1))
      continue
    fi
  fi

  # ── Parse Claude frontmatter ──────────────────────────────────────────────

  name=$(awk '/^---$/{n++; next} n==1 && /^name:/{gsub(/^name:\s*/,""); print; exit}' "$agent_file")
  description=$(awk '/^---$/{n++; next} n==1 && /^description:/{sub(/^description:\s*"?/,""); sub(/"?\s*$/,""); print; exit}' "$agent_file")
  claude_tools=$(awk '/^---$/{n++; next} n==1 && /^tools:/{sub(/^tools:\s*/,""); print; exit}' "$agent_file")

  # Extract skills list
  skills=$(awk '
    /^---$/{n++; next}
    n>=2{exit}
    n==1 && /^skills:/{in_skills=1; next}
    n==1 && in_skills && /^  - /{gsub(/^  - /,""); print; next}
    n==1 && in_skills && !/^  -/{exit}
  ' "$agent_file")

  # Extract body (everything after second ---)
  body=$(awk '/^---$/{n++; next} n>=2{print}' "$agent_file")

  # ── Map to Copilot format ─────────────────────────────────────────────────

  copilot_tools=$(map_tools "$claude_tools")

  # ── Build Copilot agent file ──────────────────────────────────────────────

  output_file="$OUTPUT_DIR/${agent_name}.agent.md"

  if [ "$DRY_RUN" = true ]; then
    echo "  [dry-run] Would generate: $output_file"
    count=$((count + 1))
    continue
  fi

  {
    echo "<!-- GENERATED from .claude/agents/${basename_file} -- DO NOT EDIT MANUALLY -->"
    echo "<!-- Regenerate: bash adapters/copilot-agent-adapter.sh --project-root \$(pwd) -->"
    echo "---"
    echo "name: \"$name\""
    echo "description: \"$description\""
    if [ -n "$copilot_tools" ]; then
      echo "tools: [$copilot_tools]"
    fi
    echo "---"

    # Inline skill summaries if skills were referenced
    if [ -n "$skills" ]; then
      echo ""
      echo "## Available Skills (invoke via slash commands)"
      echo ""
      while IFS= read -r skill; do
        [ -z "$skill" ] && continue
        get_skill_summary "$skill"
      done <<< "$skills"
      echo ""
    fi

    # Body content (agent instructions)
    echo "$body"

  } > "$output_file"

  count=$((count + 1))
  echo "  Generated: $(basename "$OUTPUT_DIR")/${agent_name}.agent.md"
done

echo ""
echo "Copilot agent adapter: $count agents generated"
[ "$skipped" -gt 0 ] && echo "  ($skipped L0-synced agents skipped — only project-specific agents adapted)"
echo "  Output: $OUTPUT_DIR/"
