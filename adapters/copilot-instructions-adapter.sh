#!/usr/bin/env bash
# Copilot Instructions Adapter -- Generates copilot-instructions.md from docs/*.md
# Extracts DO/DON'T patterns, Key insights, and Detekt rule descriptions.
# Part of the AndroidCommonDoc adapter pipeline.
#
# Environment:
#   ANDROID_COMMON_DOC_PROJECT_TYPE  kmp | android-only | ""  (default: include all)
#     When set to "android-only", sections that only apply to KMP are excluded.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Work from repo root so relative paths work with python3 on all platforms
cd "$REPO_ROOT"

DOCS_DIR="docs"
OUTPUT_DIR="setup/copilot-templates"
OUTPUT_FILE="$OUTPUT_DIR/copilot-instructions-generated.md"
# Also write a platform-filtered variant when PROJECT_TYPE is set
PROJECT_TYPE="${ANDROID_COMMON_DOC_PROJECT_TYPE:-all}"

mkdir -p "$OUTPUT_DIR"

if [ ! -d "$DOCS_DIR" ]; then
  echo "ERROR: docs directory not found at $DOCS_DIR" >&2
  exit 1
fi

python3 - "$PROJECT_TYPE" "$DOCS_DIR" "$OUTPUT_FILE" <<'PYEOF'
import os, re, sys

project_type = sys.argv[1]   # "kmp" | "android-only" | "all"
docs_dir     = sys.argv[2]
output_file  = sys.argv[3]

# ── KMP-only signals ───────────────────────────────────────────────────────────
# A section/doc is KMP-only if any of the following is true:
#   1. Frontmatter has applies_to containing "kmp" without "android-only"
#   2. File path contains one of the KMP-only path segments
#   3. Section heading contains "KMP" or "Multiplatform" or "Source Set"
#
# When project_type == "android-only" these sections are dropped with a note.
# When project_type == "kmp" or "all" everything is included.

KMP_PATHS = {
    "kmp-architecture",
    "kmp-architecture-modules",
    "kmp-architecture-sourceset",
    "gradle-patterns-conventions",  # applies_to: [kmp, agp-9]
    "gradle-hub",                   # applies_to: [kmp, agp-9]
}

KMP_SECTION_KEYWORDS = [
    "KMP", "Kotlin Multiplatform", "Source Set", "commonMain",
    "expect/actual", "Offline-First System Design",  # KMP-focused arch pattern
]

def doc_is_kmp_only(rel_path: str, content: str) -> bool:
    """Return True if this doc should be excluded for android-only projects."""
    # Check path basename
    basename = os.path.basename(rel_path).replace(".md", "")
    if basename in KMP_PATHS:
        return True

    # Check frontmatter
    fm_match = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    if fm_match:
        fm = fm_match.group(1)

        # applies_to: [kmp, ...] without android-only → KMP-only
        at = re.search(r'applies_to:\s*\[([^\]]+)\]', fm)
        if at:
            applies_to = [x.strip() for x in at.group(1).split(',')]
            if 'kmp' in applies_to and 'android-only' not in applies_to:
                return True

        # targets defined but 'android' not present → not relevant for android-only
        tg = re.search(r'targets:\s*\[([^\]]+)\]', fm)
        if tg:
            targets = [x.strip().strip('"').strip("'") for x in tg.group(1).split(',')]
            # 'all' means universal
            if 'all' not in targets and 'android' not in targets:
                return True

    return False

def section_is_kmp_only(heading: str) -> bool:
    """Return True if a ## section heading is KMP-specific."""
    return any(kw in heading for kw in KMP_SECTION_KEYWORDS)

# ── Extraction helpers ─────────────────────────────────────────────────────────

def get_code_comment(lines, start_idx):
    """Look ahead from a DO/DON'T heading to find context in the next code block."""
    for j in range(start_idx + 1, min(start_idx + 8, len(lines))):
        line = lines[j].strip()
        if line.startswith('// BAD:'):
            return line[3:].strip()
        if line.startswith('// Source:') or line.startswith('// GOOD:'):
            return line[3:].strip()
        if line.startswith('//') and len(line) > 5 and not line.startswith('// ...'):
            return line[3:].strip()
    return None

# ── Walk docs ──────────────────────────────────────────────────────────────────

output_lines = []

# Header
output_lines.append('<!-- GENERATED from docs/*.md -- DO NOT EDIT MANUALLY -->')
output_lines.append('<!-- Regenerate: bash adapters/generate-all.sh -->')
if project_type == 'android-only':
    output_lines.append('<!-- Filtered for: Android-only projects (KMP sections excluded) -->')
output_lines.append('# AndroidCommonDoc Coding Patterns')
output_lines.append('')
if project_type == 'android-only':
    output_lines.append('Follow these patterns when writing Kotlin Android code in this project.')
else:
    output_lines.append('Follow these patterns when writing Kotlin/KMP code in this project.')
output_lines.append('')

doc_count = 0
skipped_kmp = 0

for root, dirs, files in os.walk(docs_dir):
    dirs.sort()
    for doc in sorted(files):
        if not doc.endswith('.md'):
            continue

        filepath = os.path.join(root, doc)
        rel_path = os.path.relpath(filepath, docs_dir)

        try:
            with open(filepath, encoding='utf-8', errors='replace') as f:
                content = f.read()
        except Exception:
            continue

        # Skip KMP-only docs for android-only projects
        if project_type == 'android-only' and doc_is_kmp_only(rel_path, content):
            skipped_kmp += 1
            continue

        lines = content.split('\n')

        # Extract title from first '# ' heading
        title = None
        for line in lines:
            if line.startswith('# '):
                title = line.lstrip('# ').strip()
                break
        if title is None:
            title = doc.replace('.md', '').replace('-', ' ').title()

        # Skip KMP-flavoured section titles for android-only
        if project_type == 'android-only' and section_is_kmp_only(title):
            skipped_kmp += 1
            continue

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

        # Skip docs with nothing extractable
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

# ── Detekt rules section ───────────────────────────────────────────────────────

output_lines.append('## Architecture Rules (Enforced by Detekt)')
output_lines.append('')
output_lines.append('These rules are automatically enforced by the AndroidCommonDoc custom Detekt rule set.')
output_lines.append('Violations will be flagged during builds and during AI-assisted development via hooks.')
output_lines.append('')

# Rules that apply to both android-only and kmp
shared_rules = [
    '**Sealed UiState**: UiState types must be sealed interface/class, not data class with boolean flags',
    '**CancellationException**: Always rethrow CancellationException in catch blocks -- never swallow it',
    '**WhileSubscribed Timeout**: Must specify non-zero timeout (use 5_000ms) in stateIn(WhileSubscribed(...))',
    '**No Channel for UI Events**: Use MutableSharedFlow for ephemeral events, not Channel',
    '**No Silent Catch**: catch blocks must not silently swallow exceptions',
    '**No Hardcoded Strings in ViewModel**: User-facing strings must use UiText/StringResource',
    '**No Magic Numbers in UseCase**: Use named constants instead of magic literals',
]

# Rules that only apply to KMP (platform boundaries)
kmp_rules = [
    '**No Platform Deps in ViewModel**: No android.*, java.*, or platform.* imports in ViewModel classes (KMP only)',
]

for rule in shared_rules:
    output_lines.append(f'- {rule}')

if project_type != 'android-only':
    for rule in kmp_rules:
        output_lines.append(f'- {rule}')

output_lines.append('')

# ── Write output ───────────────────────────────────────────────────────────────

os.makedirs(os.path.dirname(output_file), exist_ok=True)
with open(output_file, 'w', encoding='utf-8') as f:
    f.write('\n'.join(output_lines))

print(f'Copilot instructions adapter: generated {output_file}')
print(f'  Sections: {doc_count} docs included', end='')
if skipped_kmp:
    print(f', {skipped_kmp} KMP-only doc(s) excluded (android-only mode)', end='')
print()
PYEOF

# If a project type was passed in, also write a platform-specific variant
if [ "$PROJECT_TYPE" = "android-only" ]; then
    VARIANT_FILE="${OUTPUT_DIR}/copilot-instructions-android-only.md"
    # The main output already has the filtered content — just copy it
    cp "$OUTPUT_FILE" "$VARIANT_FILE"
    echo "  Variant written: $VARIANT_FILE"
fi
