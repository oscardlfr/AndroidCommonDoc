#!/usr/bin/env bash
set -euo pipefail

# dokka-to-docs.sh -- Transform Dokka Markdown output into docs/api/ with YAML frontmatter.
#
# Usage:
#   dokka-to-docs.sh <project_root> [--input build/dokka] [--output docs/api] [--dry-run]
#
# Requires: Dokka Markdown output in --input directory.
# Optional: if Dokka hasn't run, exits gracefully with a message.

TOOLKIT_ROOT="${ANDROID_COMMON_DOC:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# --- Argument parsing ---
PROJECT_ROOT=""
INPUT_DIR=""
OUTPUT_DIR=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --help|-h)
            echo "Usage: $0 <project_root> [--input dir] [--output dir] [--dry-run]"
            echo ""
            echo "Transform Dokka Markdown output into docs/api/ with YAML frontmatter."
            echo "Creates hub docs per module and sub-docs per class/interface."
            echo ""
            echo "Options:"
            echo "  --input DIR    Dokka output directory (default: build/dokka)"
            echo "  --output DIR   Output directory (default: docs/api)"
            echo "  --dry-run      Show what would be generated without writing"
            exit 0
            ;;
        --input)
            INPUT_DIR="$2"
            shift 2
            ;;
        --output)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        *)
            if [[ -z "$PROJECT_ROOT" ]]; then
                PROJECT_ROOT="$1"
            fi
            shift
            ;;
    esac
done

if [[ -z "$PROJECT_ROOT" ]]; then
    echo "Error: project_root required" >&2
    exit 1
fi

INPUT_DIR="${INPUT_DIR:-$PROJECT_ROOT/build/dokka}"
OUTPUT_DIR="${OUTPUT_DIR:-$PROJECT_ROOT/docs/api}"

# --- Check prerequisites ---
if [[ ! -d "$INPUT_DIR" ]]; then
    echo "ℹ Dokka output not found at $INPUT_DIR"
    echo "  Run './gradlew dokkaGenerate' first, or skip if Dokka is not configured."
    echo "  This is optional — the doc integrity system works without Dokka."
    exit 0
fi

GENERATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
MODULES_PROCESSED=0
DOCS_GENERATED=0
HUBS_GENERATED=0

# --- Helper: generate frontmatter ---
generate_frontmatter() {
    local slug="$1"
    local module="$2"
    local description="$3"
    local is_hub="${4:-false}"

    cat <<FRONTMATTER
---
scope: [api, $module]
sources: [$module]
targets: [all]
slug: $slug
status: active
layer: L1
category: api
description: "$description"
version: 1
last_updated: "$(date -u +"%Y-%m")"
generated: true
generated_from: dokka
generated_at: "$GENERATED_AT"
FRONTMATTER

    if [[ "$is_hub" == "true" ]]; then
        echo "parent: api-hub"
    else
        echo "parent: ${module}-api-hub"
    fi
    echo "---"
    echo ""
}

# --- Helper: sanitize filename ---
to_kebab() {
    echo "$1" | sed -E 's/([A-Z])/-\L\1/g; s/^-//; s/[^a-z0-9-]/-/g; s/-+/-/g; s/-$//'
}

# --- Process each module directory ---
echo "## Dokka → docs/api/ transformer"
echo ""

for module_dir in "$INPUT_DIR"/*/; do
    [[ ! -d "$module_dir" ]] && continue

    module_name=$(basename "$module_dir")
    module_slug=$(to_kebab "$module_name")
    module_output="$OUTPUT_DIR/$module_slug"

    echo "Processing module: $module_name"

    # Collect all .md files in the module
    md_files=()
    while IFS= read -r -d '' f; do
        md_files+=("$f")
    done < <(find "$module_dir" -name "*.md" -type f -print0 2>/dev/null)

    if [[ ${#md_files[@]} -eq 0 ]]; then
        echo "  ⏭ No markdown files, skipping"
        continue
    fi

    if [[ "$DRY_RUN" == true ]]; then
        echo "  [dry-run] Would create: $module_output/"
        echo "  [dry-run] Hub: ${module_slug}-hub.md"
        echo "  [dry-run] Sub-docs: ${#md_files[@]} files"
        ((MODULES_PROCESSED++))
        ((DOCS_GENERATED += ${#md_files[@]} + 1))
        ((HUBS_GENERATED++))
        continue
    fi

    mkdir -p "$module_output"

    # --- Generate hub doc ---
    hub_file="$OUTPUT_DIR/${module_slug}-hub.md"
    {
        generate_frontmatter "${module_slug}-api-hub" "$module_name" "API documentation hub for $module_name module" "true"
        echo "# $module_name API"
        echo ""
        echo "Auto-generated from KDoc via Dokka. Do not edit manually — run \`/generate-api-docs\` to regenerate."
        echo ""
        echo "## Sub-documents"
        echo ""
        echo "| Class/Interface | Description |"
        echo "|----------------|-------------|"
    } > "$hub_file"

    ((HUBS_GENERATED++))

    # --- Process each markdown file as a sub-doc ---
    for md_file in "${md_files[@]}"; do
        filename=$(basename "$md_file" .md)
        slug=$(to_kebab "$filename")

        # Extract first heading as description
        first_heading=$(grep -m1 '^#' "$md_file" 2>/dev/null | sed 's/^#\+\s*//' || echo "$filename")

        # Read content (strip any existing frontmatter from Dokka output)
        content=$(sed '/^---$/,/^---$/d' "$md_file" 2>/dev/null || cat "$md_file")

        # Truncate to 300 lines (sub-doc limit)
        line_count=$(echo "$content" | wc -l)
        if [[ $line_count -gt 280 ]]; then
            content=$(echo "$content" | head -n 280)
            content+=$'\n\n> Truncated at 280 lines. See source code for full documentation.'
        fi

        # Write sub-doc
        sub_file="$module_output/${slug}.md"
        {
            generate_frontmatter "${module_slug}-${slug}" "$module_name" "$first_heading"
            echo "$content"
        } > "$sub_file"

        # Add to hub table
        echo "| [$first_heading](${module_slug}/${slug}.md) | ${first_heading} |" >> "$hub_file"

        ((DOCS_GENERATED++))
    done

    ((MODULES_PROCESSED++))
    echo "  ✓ $module_name: hub + ${#md_files[@]} sub-docs"
done

echo ""
echo "## Summary"
echo "- Modules processed: $MODULES_PROCESSED"
echo "- Docs generated: $DOCS_GENERATED ($HUBS_GENERATED hubs + $((DOCS_GENERATED - HUBS_GENERATED)) sub-docs)"
echo "- Output: $OUTPUT_DIR"
if [[ "$DRY_RUN" == true ]]; then
    echo "- Mode: DRY RUN (no files written)"
fi
