#!/usr/bin/env bash
# Copilot Adapter -- Generates setup/copilot-templates/*.prompt.md from skills/*/SKILL.md
# Part of the AndroidCommonDoc adapter pipeline.
#
# Respects the `copilot` frontmatter field:
#   copilot: true   → generate template (scripted or behavioral)
#   copilot: false  → skip
#   (missing)       → warn and skip
#
# Template types:
#   - scripted:   skills with ## Implementation (bash/powershell code blocks)
#   - behavioral: skills with copilot-template-type: behavioral (instruction-based)
#
# Options:
#   --clean   Remove orphaned templates whose skill is now copilot: false
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

SKILLS_DIR="skills"
OUTPUT_DIR="setup/copilot-templates"
PARAMS_FILE="skills/params.json"
CLEAN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --clean) CLEAN=true; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

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

count_scripted=0
count_behavioral=0
count_skipped=0
generated_names=()

for skill_dir in "$SKILLS_DIR"/*/; do
  skill_file="$skill_dir/SKILL.md"
  [ -f "$skill_file" ] || continue

  # Parse frontmatter fields
  name=$(awk '/^---$/{n++; next} n==1 && /^name:/{gsub(/^name:\s*"?|"?\s*$/,"",$0); print; exit}' "$skill_file")
  description=$(awk '/^---$/{n++; next} n==1 && /^description:/{sub(/^description:\s*"?/,""); sub(/"?\s*$/,""); print; exit}' "$skill_file")
  copilot_enabled=$(awk '/^---$/{n++; next} n==1 && /^copilot:/{gsub(/^copilot:\s*/,"",$0); gsub(/\s*$/,"",$0); print; exit}' "$skill_file")
  template_type=$(awk '/^---$/{n++; next} n==1 && /^copilot-template-type:/{gsub(/^copilot-template-type:\s*/,"",$0); gsub(/\s*$/,"",$0); print; exit}' "$skill_file")

  # Warn on missing copilot field
  if [ -z "$copilot_enabled" ]; then
    echo "  WARNING: $skill_file has no 'copilot:' frontmatter field" >&2
    count_skipped=$((count_skipped + 1))
    continue
  fi

  # Skip copilot: false
  if [ "$copilot_enabled" != "true" ]; then
    echo "  Skipped (copilot: false): $name"
    count_skipped=$((count_skipped + 1))
    continue
  fi

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

  output_file="$OUTPUT_DIR/$name.prompt.md"

  # Determine template type: behavioral or scripted
  if [ "$template_type" = "behavioral" ]; then
    # Behavioral template: emit full skill body as instructions
    body=$(awk '
      BEGIN { in_fm=0; past_fm=0 }
      /^---$/ && !in_fm { in_fm=1; next }
      /^---$/ && in_fm && !past_fm { past_fm=1; next }
      past_fm { print }
    ' "$skill_file" | sed '1{/^$/d}')

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
      echo "## Instructions"
      echo ""
      echo "$body"
    } > "$output_file"

    count_behavioral=$((count_behavioral + 1))
    generated_names+=("$name")
    echo "  Generated (behavioral): setup/copilot-templates/$name.prompt.md"
  else
    # Scripted template: extract Implementation code blocks
    is_orchestration=$(awk '/^## Implementation/{found=1; next} found && /orchestration workflow/{print "yes"; exit}' "$skill_file")

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

    count_scripted=$((count_scripted + 1))
    generated_names+=("$name")
    echo "  Generated (scripted): setup/copilot-templates/$name.prompt.md"
  fi
done

# Clean orphaned templates if --clean is specified
count_cleaned=0
if $CLEAN; then
  for template in "$OUTPUT_DIR"/*.prompt.md; do
    [ -f "$template" ] || continue
    tname=$(basename "$template" .prompt.md)
    is_generated=false
    for gname in "${generated_names[@]}"; do
      [ "$tname" = "$gname" ] && is_generated=true && break
    done
    if ! $is_generated; then
      rm "$template"
      count_cleaned=$((count_cleaned + 1))
      echo "  Cleaned orphan: $tname.prompt.md"
    fi
  done
fi

total=$((count_scripted + count_behavioral))
echo ""
echo "Copilot adapter: $total prompts generated ($count_scripted scripted, $count_behavioral behavioral), $count_skipped skipped."
if [ $count_cleaned -gt 0 ]; then
  echo "Copilot adapter: $count_cleaned orphaned templates removed."
fi
