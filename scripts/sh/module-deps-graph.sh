#!/usr/bin/env bash
set -euo pipefail

# module-deps-graph.sh -- Build module dependency graph from Gradle project() deps.
#
# Usage:
#   module-deps-graph.sh <project_root> [--output adjacency|mermaid] [--detect-cycles]

TOOLKIT_ROOT="${ANDROID_COMMON_DOC:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# --- Argument parsing ---
PROJECT_ROOT=""
OUTPUT_MODE="adjacency"
DETECT_CYCLES=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --help|-h)
            echo "Usage: $0 <project_root> [--output adjacency|mermaid] [--detect-cycles]"
            echo ""
            echo "Parses build.gradle.kts for project() dependencies and builds a graph."
            echo "Outputs JSON (adjacency) or Mermaid diagram to stdout."
            exit 0
            ;;
        --output)
            OUTPUT_MODE="$2"
            shift 2
            ;;
        --detect-cycles)
            DETECT_CYCLES=true
            shift
            ;;
        *)
            if [[ -z "$PROJECT_ROOT" ]]; then
                PROJECT_ROOT="$1"
            else
                echo "Unknown option: $1" >&2
                exit 1
            fi
            shift
            ;;
    esac
done

if [[ -z "$PROJECT_ROOT" ]]; then
    echo '{"error":"project_root is required"}' >&2
    exit 1
fi

SETTINGS="$PROJECT_ROOT/settings.gradle.kts"
if [[ ! -f "$SETTINGS" ]]; then
    SETTINGS="$PROJECT_ROOT/settings.gradle"
fi

# --- Discover modules ---
declare -A ADJACENCY
MODULES=()

while IFS= read -r mod; do
    [[ -z "$mod" ]] && continue
    MODULES+=("$mod")
    ADJACENCY["$mod"]=""
done < <(grep -oE 'include\s*\(\s*"[^"]+"' "$SETTINGS" 2>/dev/null \
    | sed 's/include\s*(\s*"//;s/"//' || true)

# --- Parse dependencies per module ---
for mod in "${MODULES[@]}"; do
    mod_path="${mod//:///}"
    mod_path="${mod_path#/}"
    build_file="$PROJECT_ROOT/$mod_path/build.gradle.kts"
    if [[ ! -f "$build_file" ]]; then
        continue
    fi

    deps=""
    while IFS= read -r dep; do
        [[ -z "$dep" ]] && continue
        if [[ -n "$deps" ]]; then
            deps="$deps,$dep"
        else
            deps="$dep"
        fi
    done < <(grep -oE 'project\s*\(\s*"[^"]+"' "$build_file" 2>/dev/null \
        | sed 's/project\s*(\s*"//;s/"//' || true)

    ADJACENCY["$mod"]="$deps"
done

# --- Find leaf modules (no outgoing deps) ---
LEAVES=""
for mod in "${MODULES[@]}"; do
    if [[ -z "${ADJACENCY[$mod]:-}" ]]; then
        if [[ -n "$LEAVES" ]]; then
            LEAVES="$LEAVES,\"$mod\""
        else
            LEAVES="\"$mod\""
        fi
    fi
done

# --- Cycle detection (simple DFS) ---
CYCLES="[]"
if [[ "$DETECT_CYCLES" == "true" ]]; then
    # Use a python one-liner for cycle detection to avoid complex bash
    ADJ_JSON="{"
    first=true
    for mod in "${MODULES[@]}"; do
        if [[ "$first" == "true" ]]; then first=false; else ADJ_JSON="$ADJ_JSON,"; fi
        deps_arr=""
        IFS=',' read -ra dep_list <<< "${ADJACENCY[$mod]:-}"
        for d in "${dep_list[@]}"; do
            [[ -z "$d" ]] && continue
            if [[ -n "$deps_arr" ]]; then deps_arr="$deps_arr,\"$d\""; else deps_arr="\"$d\""; fi
        done
        ADJ_JSON="$ADJ_JSON\"$mod\":[$deps_arr]"
    done
    ADJ_JSON="$ADJ_JSON}"

    CYCLES=$(python3 -c "
import json, sys
adj = json.loads(sys.argv[1])
visited, rec_stack, cycles = set(), set(), []
def dfs(node, path):
    visited.add(node); rec_stack.add(node); path.append(node)
    for nb in adj.get(node, []):
        if nb in rec_stack:
            idx = path.index(nb)
            cycles.append(path[idx:] + [nb])
        elif nb not in visited:
            dfs(nb, path)
    path.pop(); rec_stack.discard(node)
for n in adj:
    if n not in visited: dfs(n, [])
print(json.dumps(cycles))
" "$ADJ_JSON" 2>/dev/null || echo "[]")
fi

# --- Output ---
if [[ "$OUTPUT_MODE" == "mermaid" ]]; then
    echo "graph TD"
    for mod in "${MODULES[@]}"; do
        safe_id="${mod//:/_}"
        safe_id="${safe_id#_}"
        IFS=',' read -ra dep_list <<< "${ADJACENCY[$mod]:-}"
        for d in "${dep_list[@]}"; do
            [[ -z "$d" ]] && continue
            safe_dep="${d//:/_}"
            safe_dep="${safe_dep#_}"
            echo "    ${safe_id}[\"$mod\"] --> ${safe_dep}[\"$d\"]"
        done
    done
else
    ADJ_OUT="{"
    first=true
    for mod in "${MODULES[@]}"; do
        if [[ "$first" == "true" ]]; then first=false; else ADJ_OUT="$ADJ_OUT,"; fi
        deps_arr=""
        IFS=',' read -ra dep_list <<< "${ADJACENCY[$mod]:-}"
        for d in "${dep_list[@]}"; do
            [[ -z "$d" ]] && continue
            if [[ -n "$deps_arr" ]]; then deps_arr="$deps_arr,\"$d\""; else deps_arr="\"$d\""; fi
        done
        ADJ_OUT="$ADJ_OUT\"$mod\":[$deps_arr]"
    done
    ADJ_OUT="$ADJ_OUT}"

    echo "{\"adjacency\":$ADJ_OUT,\"cycles\":$CYCLES,\"leaf_modules\":[$LEAVES]}"
fi

exit 0
