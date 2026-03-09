#!/usr/bin/env bash
# CLAUDE.md Copilot Adapter -- Generates copilot-instructions.md from CLAUDE.md files
# Reads L0 global (~/.claude/CLAUDE.md) + project-root CLAUDE.md, merges and flattens
# into a plain-markdown Copilot instructions file.
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

# Determine L0 global CLAUDE.md path
L0_GLOBAL="${HOME}/.claude/CLAUDE.md"
L0_PROJECT="CLAUDE.md"

if [ ! -f "$L0_GLOBAL" ]; then
  echo "WARNING: L0 global CLAUDE.md not found at $L0_GLOBAL" >&2
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
        if stripped.startswith('- '):
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

# Read both CLAUDE.md files
l0_global = read_file(os.path.expanduser('~/.claude/CLAUDE.md'))
l0_project = read_file('CLAUDE.md')

# Extract sections from both
global_sections = extract_sections(l0_global)
project_sections = extract_sections(l0_project)

# Build output
output_lines = []
output_lines.append('<!-- GENERATED from CLAUDE.md files -- DO NOT EDIT MANUALLY -->')
output_lines.append('<!-- Regenerate: bash adapters/claude-md-copilot-adapter.sh -->')
output_lines.append('# Coding Instructions')
output_lines.append('')
output_lines.append('These instructions are generated from the CLAUDE.md ecosystem (L0 global + project-specific).')
output_lines.append('Follow these rules when writing code in this project.')
output_lines.append('')

# Track which headings we have already emitted
emitted_headings = set()
section_count = 0

# First emit L0 global sections
for heading, lines in global_sections:
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

# Then emit project-specific sections (skip duplicates)
for heading, lines in project_sections:
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
echo "CLAUDE.md Copilot adapter: generated $OUTPUT_FILE with $count sections."
