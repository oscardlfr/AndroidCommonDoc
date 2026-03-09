#!/usr/bin/env bash
# Copilot Adapter -- Generates setup/copilot-templates/*.prompt.md from skills/*/SKILL.md
# Part of the AndroidCommonDoc adapter pipeline.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Work from repo root so relative paths work with python3 on all platforms
cd "$REPO_ROOT"

SKILLS_DIR="skills"
OUTPUT_DIR="setup/copilot-templates"
PARAMS_FILE="skills/params.json"

mkdir -p "$OUTPUT_DIR"

if [ ! -f "$PARAMS_FILE" ]; then
  echo "ERROR: params.json not found at $PARAMS_FILE" >&2
  exit 1
fi

# Pre-generate copilot parameter prompts from params.json
COPILOT_CACHE=$(python3 -c "
import json, re

with open('skills/params.json') as f:
    data = json.load(f)

params = data.get('parameters', {})
for pname, p in params.items():
    desc = p.get('description', '')
    copilot = p.get('mapping', {}).get('copilot', '')
    if not copilot:
        continue
    # Extract label from \${input:varName:label}
    m = re.search(r'\\$\\{input:(\\w+):([^}]+)\\}', copilot)
    if m:
        label = m.group(2)
        label = label[0].upper() + label[1:]
        line = label + ': ' + copilot
    else:
        line = desc + ': ' + copilot
    print(pname + '\t' + line + '\t' + copilot)
")

count=0

for skill_dir in "$SKILLS_DIR"/*/; do
  skill_file="$skill_dir/SKILL.md"
  [ -f "$skill_file" ] || continue

  # Parse frontmatter
  name=$(awk '/^---$/{n++; next} n==1 && /^name:/{gsub(/^name:\s*"?|"?\s*$/,"",$0); print; exit}' "$skill_file")
  description=$(awk '/^---$/{n++; next} n==1 && /^description:/{sub(/^description:\s*"?/,""); sub(/"?\s*$/,""); print; exit}' "$skill_file")

  # Extract frontmatter params list
  param_names=$(awk '
    /^---$/{n++; next}
    n>=2{exit}
    n==1 && /^\s+params:/{in_params=1; next}
    n==1 && in_params && /^\s+-\s+/{gsub(/^\s+-\s+/,""); print; next}
    n==1 && in_params && !/^\s+-/{exit}
  ' "$skill_file")

  # Build parameter prompt lines using cached copilot data
  param_prompts=""
  while IFS= read -r pname; do
    [ -z "$pname" ] && continue
    prompt_line=$(echo "$COPILOT_CACHE" | awk -F'\t' -v p="$pname" '$1==p{print $2; exit}')
    if [ -n "$prompt_line" ]; then
      param_prompts="${param_prompts}${prompt_line}
"
    fi
  done <<< "$param_names"

  # Check if this is an orchestration workflow
  is_orchestration=$(awk '/^## Implementation/{found=1; next} found && /orchestration workflow/{print "yes"; exit}' "$skill_file")

  # Extract implementation sections
  impl_mac=$(awk '
    /^## Implementation/{in_impl=1; next}
    in_impl && /^### macOS \/ Linux/{in_mac=1; next}
    in_mac && /^```bash/{in_code=1; next}
    in_mac && in_code && /^```/{exit}
    in_mac && in_code{print}
  ' "$skill_file")

  impl_win=$(awk '
    /^## Implementation/{in_impl=1; next}
    in_impl && /^### Windows/{in_win=1; next}
    in_win && /^```powershell/{in_code=1; next}
    in_win && in_code && /^```/{exit}
    in_win && in_code{print}
  ' "$skill_file")

  # Generate the Copilot prompt file
  output_file="$OUTPUT_DIR/$name.prompt.md"

  {
    echo "<!-- GENERATED from skills/$name/SKILL.md -- DO NOT EDIT MANUALLY -->"
    echo "<!-- Regenerate: bash adapters/generate-all.sh -->"
    echo "---"
    echo "mode: agent"
    echo "description: \"$description\""
    echo "---"
    echo ""
    echo "$description"
    echo ""
    if [ -n "$param_prompts" ]; then
      printf "%s" "$param_prompts"
      echo ""
    fi
    echo "## Implementation"
    echo ""
    if [ "$is_orchestration" = "yes" ]; then
      awk '/^## Implementation/{found=1; next} found && /^## /{exit} found{print}' "$skill_file" | sed '1{/^$/d}'
    else
      echo "### macOS / Linux"
      echo '```bash'
      echo "$impl_mac"
      echo '```'
      echo ""
      echo "### Windows (PowerShell)"
      echo '```powershell'
      echo "$impl_win"
      echo '```'
    fi
  } > "$output_file"

  count=$((count + 1))
  echo "  Generated: setup/copilot-templates/$name.prompt.md"
done

echo "Copilot adapter: $count prompts generated."
