#!/usr/bin/env bash
# Portable instruction Copilot adapter.
# Reads the checked-in AGENTS.md contract plus the project-root CLAUDE.md adapter.
# Personal ~/.claude state is intentionally never an input to generated artifacts.
#
# Part of the AndroidCommonDoc adapter pipeline.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Work from repo root so relative paths work
cd "$REPO_ROOT"

OUTPUT_DIR="setup/copilot-templates"
OUTPUT_FILE="$OUTPUT_DIR/copilot-instructions-from-claude-md.md"

mkdir -p "$OUTPUT_DIR"

AGENTS_CONTRACT="AGENTS.md"
L0_PROJECT="CLAUDE.md"

if [ ! -f "$AGENTS_CONTRACT" ]; then
  echo "ERROR: Portable instruction contract not found at $AGENTS_CONTRACT" >&2
  exit 1
fi

if [ ! -f "$L0_PROJECT" ]; then
  echo "ERROR: Project CLAUDE.md not found at $L0_PROJECT" >&2
  exit 1
fi

python3 -c "
import os, re, sys

def read_file(path):
    \"\"\"Read a file and return its content, or empty string if not found.\"\"\"
    try:
        with open(path, encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        return ''

def extract_sections(content):
    \"\"\"Extract markdown sections as (heading, lines[]) pairs.
    Skips identity headers (blockquote at top) and code fences.\"\"\"
    sections = []
    current_heading = None
    current_lines = []
    in_code_block = False

    for line in content.split('\n'):
        stripped = line.strip()

        # Track code blocks
        if stripped.startswith('\`\`\`'):
            in_code_block = not in_code_block
            if current_heading:
                current_lines.append(line)
            continue

        if in_code_block:
            if current_heading:
                current_lines.append(line)
            continue

        # Skip identity header blockquotes at the start
        if stripped.startswith('>') and not current_heading:
            continue

        # Detect section headings
        if stripped.startswith('## '):
            if current_heading:
                sections.append((current_heading, current_lines))
            current_heading = stripped.lstrip('# ').strip()
            current_lines = []
            continue

        # Skip top-level heading
        if stripped.startswith('# ') and not current_heading:
            continue

        if current_heading:
            current_lines.append(line)

    if current_heading:
        sections.append((current_heading, current_lines))

    return sections

def extract_rules(lines):
    \"\"\"Extract bullet-point rules from section lines.
    Returns list of rule strings (without leading dash).\"\"\"
    rules = []
    in_code_block = False
    in_table = False

    for line in lines:
        stripped = line.strip()

        if stripped.startswith('\`\`\`'):
            in_code_block = not in_code_block
            continue
        if in_code_block:
            continue

        # Detect tables
        if stripped.startswith('|'):
            in_table = True
            rules.append(stripped)
            continue
        elif in_table and not stripped.startswith('|'):
            in_table = False

        # Bullet point rules
        # Preserve both unordered rules and ordered workflow obligations.
        if stripped.startswith('- ') or re.match(r'^\d+\.\s+', stripped):
            rules.append(stripped)

    return rules

# Sections to skip (not relevant for Copilot instructions)
SKIP_SECTIONS = {
    'developer context',
    'developer context (user-specific)',
    'what this project is',
    'vault sync',
    'session continuity',
    'wave 1: parallel pre-cloud tracks',
    'test coverage',
}

# Read the checked-in portable contract and Claude adapter.
agents_contract = read_file('AGENTS.md')
claude_adapter = read_file('CLAUDE.md')

# Extract sections from both
contract_sections = extract_sections(agents_contract)
adapter_sections = extract_sections(claude_adapter)

# Build output
output_lines = []
output_lines.append('<!-- GENERATED from AGENTS.md + CLAUDE.md -- DO NOT EDIT MANUALLY -->')
output_lines.append('<!-- Regenerate: bash adapters/claude-md-copilot-adapter.sh -->')
output_lines.append('# Coding Instructions')
output_lines.append('')
output_lines.append('These instructions are generated only from the checked-in portable contract and Claude adapter.')
output_lines.append('Follow these rules when writing code in this project.')
output_lines.append('')

# Track which headings we have already emitted
emitted_headings = set()
section_count = 0

# First emit the portable contract.
for heading, lines in contract_sections:
    if heading.lower() in SKIP_SECTIONS:
        continue

    rules = extract_rules(lines)
    if not rules:
        continue

    section_count += 1
    output_lines.append('## ' + heading)
    output_lines.append('')
    for rule in rules:
        output_lines.append(rule)
    output_lines.append('')
    emitted_headings.add(heading.lower())

# Then emit Claude-specific adapter sections (skip duplicates).
for heading, lines in adapter_sections:
    if heading.lower() in SKIP_SECTIONS:
        continue

    rules = extract_rules(lines)
    if not rules:
        continue

    # If heading already emitted from L0, prefix with project context
    display_heading = heading
    if heading.lower() in emitted_headings:
        display_heading = heading + ' (Project-Specific)'

    section_count += 1
    output_lines.append('## ' + display_heading)
    output_lines.append('')
    for rule in rules:
        output_lines.append(rule)
    output_lines.append('')
    emitted_headings.add(heading.lower())

print('\n'.join(output_lines))
" > "$OUTPUT_FILE"

count=$(grep -c '^## ' "$OUTPUT_FILE" || echo "0")
echo "Portable instruction Copilot adapter: generated $OUTPUT_FILE with $count sections."
