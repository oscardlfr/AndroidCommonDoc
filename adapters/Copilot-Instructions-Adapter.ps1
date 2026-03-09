# Copilot Instructions Adapter -- Generates copilot-instructions.md from docs/*.md
# Extracts DO/DON'T patterns, Key insights, and Detekt rule descriptions.
# Part of the AndroidCommonDoc adapter pipeline (PowerShell counterpart of SH script).
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$DocsDir = "docs"
$OutputDir = "setup/copilot-templates"
$OutputFile = "$OutputDir/copilot-instructions-generated.md"

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

if (-not (Test-Path $DocsDir)) {
    Write-Error "docs directory not found at $DocsDir"
    exit 1
}

# Use the same python3 logic as the SH counterpart to produce byte-identical output
python3 -c @"
import os, re

docs_dir = 'docs'
output_lines = []

# Header
output_lines.append('<!-- GENERATED from docs/*.md -- DO NOT EDIT MANUALLY -->')
output_lines.append('<!-- Regenerate: bash adapters/generate-all.sh -->')
output_lines.append('# AndroidCommonDoc Coding Patterns')
output_lines.append('')
output_lines.append('Follow these patterns when writing Kotlin/KMP code in this project.')
output_lines.append('')

def get_code_comment(lines, start_idx):
    for j in range(start_idx + 1, min(start_idx + 8, len(lines))):
        line = lines[j].strip()
        if line.startswith('// BAD:'):
            return line[3:].strip()
        if line.startswith('// Source:') or line.startswith('// GOOD:'):
            return line[3:].strip()
        if line.startswith('//') and len(line) > 5 and not line.startswith('// ...'):
            return line[3:].strip()
    return None

doc_count = 0

for doc in sorted(os.listdir(docs_dir)):
    if not doc.endswith('.md'):
        continue

    filepath = os.path.join(docs_dir, doc)
    with open(filepath, encoding='utf-8') as f:
        content = f.read()

    lines = content.split('\n')

    title = None
    for line in lines:
        if line.startswith('# '):
            title = line.lstrip('# ').strip()
            break
    if title is None:
        title = doc.replace('.md', '').replace('-', ' ').title()

    do_dont_lines = []
    key_insights = []

    for i, line in enumerate(lines):
        stripped = line.strip()

        if stripped.startswith("**DON'T") or stripped.startswith('**DON\u2019T'):
            context = get_code_comment(lines, i)
            if context:
                do_dont_lines.append("- DON'T: " + context)
            else:
                do_dont_lines.append("- DON'T: (see pattern doc for details)")
        elif stripped.startswith('**DO') and ('Correct' in stripped or 'Recommended' in stripped):
            context = get_code_comment(lines, i)
            if context:
                do_dont_lines.append('- DO: ' + context)
            else:
                do_dont_lines.append('- DO: (see pattern doc for details)')

        if '**Key insight' in stripped:
            insight = re.sub(r'\*\*Key insight:?\*\*:?\s*', '', stripped)
            if insight:
                key_insights.append(insight)

    if not do_dont_lines and not key_insights:
        continue

    doc_count += 1
    output_lines.append('## ' + title)
    output_lines.append('')
    for item in do_dont_lines:
        output_lines.append(item)
    if key_insights:
        if do_dont_lines:
            output_lines.append('')
        for insight in key_insights:
            output_lines.append('- Key insight: ' + insight)
    output_lines.append('')

output_lines.append('## Architecture Rules (Enforced by Detekt)')
output_lines.append('')
output_lines.append('These rules are automatically enforced by the AndroidCommonDoc custom Detekt rule set.')
output_lines.append('Violations will be flagged during builds and during AI-assisted development via hooks.')
output_lines.append('')
output_lines.append('- **Sealed UiState**: UiState types must be sealed interface/class, not data class with boolean flags')
output_lines.append('- **CancellationException**: Always rethrow CancellationException in catch blocks -- never swallow it')
output_lines.append('- **No Platform Deps in ViewModel**: No android.*, java.*, or platform.* imports in ViewModel classes')
output_lines.append('- **WhileSubscribed Timeout**: Must specify non-zero timeout (use 5_000ms) in stateIn(WhileSubscribed(...))')
output_lines.append('- **No Channel for UI Events**: Use MutableSharedFlow for ephemeral events, not Channel')
output_lines.append('')

print('\n'.join(output_lines))
"@ | Out-File -FilePath $OutputFile -Encoding utf8NoBOM -NoNewline

$sectionCount = (Select-String -Path $OutputFile -Pattern '^## ' | Measure-Object).Count
Write-Output "Copilot instructions adapter: generated $OutputFile with $sectionCount sections."
