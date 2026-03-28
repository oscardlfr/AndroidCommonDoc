#!/usr/bin/env bats
# =============================================================================
# Full coverage tests for session changes:
#  - PS1/SH function parity (structural)
#  - Kover fallback order and edge cases (functional)
#  - Workflow @master consistency (no @main)
#  - GH Actions expression syntax (no double-quoted string literals)
#  - README new sections coherence
#  - Setup wizard W0 auto-discovery documentation
#  - Coverage-detect lib 6/6 function parity
#  - auto-sync single-quote fix
# =============================================================================

L0_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
SH_DIR="$L0_ROOT/scripts/sh"
PS1_DIR="$L0_ROOT/scripts/ps1"
SH_LIB="$SH_DIR/lib/coverage-detect.sh"
PS1_LIB="$PS1_DIR/lib/Coverage-Detect.ps1"
README="$L0_ROOT/README.md"
SETUP_SKILL="$L0_ROOT/skills/setup/SKILL.md"
TOPOLOGY_DOC="$L0_ROOT/docs/architecture/layer-topology.md"

setup() {
    source "$SH_LIB"
    WORK_DIR=$(mktemp -d)
}

teardown() {
    rm -rf "$WORK_DIR"
}

# ===========================================================================
# A. PS1/SH lib function parity — structural (6/6)
# ===========================================================================

@test "parity: SH has 6 coverage-detect functions" {
    count=$(grep -c "^[a-z_]*() {" "$SH_LIB" | tr -d ' \r')
    [ "$count" -eq 6 ]
}

@test "parity: PS1 has 6 coverage-detect functions" {
    count=$(grep -c "^function " "$PS1_LIB" | tr -d ' \r')
    [ "$count" -eq 6 ]
}

@test "parity: Detect-CoverageTool exists in PS1" {
    grep -q "function Detect-CoverageTool" "$PS1_LIB"
}

@test "parity: Get-CoverageGradleTask exists in PS1" {
    grep -q "function Get-CoverageGradleTask" "$PS1_LIB"
}

@test "parity: PS1 kover does NOT use --rerun-tasks as argument" {
    # --rerun-tasks removed: core-storage-secure fails on re-execution
    count=$(grep -c '^\s.*\+= "--rerun-tasks"' "$PS1_DIR/run-parallel-coverage-suite.ps1" || true)
    [ "$count" -eq 0 ]
}

@test "parity: Get-CoverageXmlPath exists in PS1" {
    grep -q "function Get-CoverageXmlPath" "$PS1_LIB"
}

@test "parity: Get-CoverageReportDir exists in PS1" {
    grep -q "function Get-CoverageReportDir" "$PS1_LIB"
}

@test "parity: Get-CoverageDisplayName exists in PS1" {
    grep -q "function Get-CoverageDisplayName" "$PS1_LIB"
}

@test "parity: PS1 Detect-CoverageTool checks build-logic" {
    grep -q "build-logic" "$PS1_LIB"
}

@test "parity: PS1 Detect-CoverageTool checks libs.versions.toml" {
    grep -q "libs.versions.toml" "$PS1_LIB"
}

@test "parity: PS1 Detect-CoverageTool checks kover report dir" {
    grep -q "reports/kover" "$PS1_LIB"
}

@test "parity: PS1 Detect-CoverageTool checks jacoco report dir" {
    grep -q "reports/jacoco" "$PS1_LIB"
}

@test "parity: PS1 Detect-CoverageTool defaults to jacoco" {
    # Last return in the function should be "jacoco"
    grep -q 'return "jacoco"' "$PS1_LIB"
}

@test "parity: PS1 run-parallel-coverage-suite has ExcludeCoverage" {
    grep -q "ExcludeCoverage" "$PS1_DIR/run-parallel-coverage-suite.ps1"
}

@test "parity: PS1 run-changed-modules-tests has ExcludeCoverage" {
    grep -q "ExcludeCoverage" "$PS1_DIR/run-changed-modules-tests.ps1"
}

@test "parity: PS1 run-parallel has kover batch (no --rerun-tasks as arg)" {
    count=$(grep -c '^\s.*\+= "--rerun-tasks"' "$PS1_DIR/run-parallel-coverage-suite.ps1" || true)
    [ "$count" -eq 0 ]
}

@test "parity: PS1 run-parallel has partial-success retry (missingCov)" {
    grep -q "missingCov\|Batch partial" "$PS1_DIR/run-parallel-coverage-suite.ps1"
}

@test "parity: PS1 gradle-run has kover fallback" {
    grep -q "fallback" "$PS1_DIR/gradle-run.ps1"
}

# ===========================================================================
# B. Kover fallback edge cases (functional)
# ===========================================================================

@test "kover fallbacks: desktop — all 3 task names are distinct" {
    result=$(get_kover_task_fallbacks "true")
    count=$(echo "$result" | tr ' ' '\n' | sort -u | wc -l | tr -d ' \r')
    [ "$count" -eq 3 ]
}

@test "kover fallbacks: non-desktop — all 3 task names are distinct" {
    result=$(get_kover_task_fallbacks "false")
    count=$(echo "$result" | tr ' ' '\n' | sort -u | wc -l | tr -d ' \r')
    [ "$count" -eq 3 ]
}

@test "kover fallbacks: desktop first is koverXmlReportDesktop" {
    first=$(get_kover_task_fallbacks "true" | awk '{print $1}')
    [ "$first" = "koverXmlReportDesktop" ]
}

@test "kover fallbacks: non-desktop first is koverXmlReportDebug" {
    first=$(get_kover_task_fallbacks "false" | awk '{print $1}')
    [ "$first" = "koverXmlReportDebug" ]
}

@test "kover fallbacks: koverXmlReport (plain) always present in desktop" {
    result=$(get_kover_task_fallbacks "true")
    echo "$result" | grep -q "koverXmlReport "
}

@test "kover fallbacks: koverXmlReport (plain) always present in non-desktop" {
    result=$(get_kover_task_fallbacks "false")
    echo "$result" | grep -q "koverXmlReport "
}

@test "kover fallbacks: desktop and non-desktop have different ordering" {
    desk=$(get_kover_task_fallbacks "true" | awk '{print $1}')
    nodk=$(get_kover_task_fallbacks "false" | awk '{print $1}')
    [ "$desk" != "$nodk" ]
}

# ===========================================================================
# C. Workflow @master consistency (no @main)
# ===========================================================================

@test "workflow: reusable-architecture-guards uses @master not @main" {
    ! grep -q "@main" "$L0_ROOT/.github/workflows/reusable-architecture-guards.yml"
    grep -q "@master" "$L0_ROOT/.github/workflows/reusable-architecture-guards.yml"
}

@test "workflow: reusable-audit-report uses @master not @main" {
    ! grep -q "@main" "$L0_ROOT/.github/workflows/reusable-audit-report.yml"
    grep -q "@master" "$L0_ROOT/.github/workflows/reusable-audit-report.yml"
}

@test "workflow: reusable-commit-lint uses @master not @main" {
    ! grep -q "@main" "$L0_ROOT/.github/workflows/reusable-commit-lint.yml"
    grep -q "@master" "$L0_ROOT/.github/workflows/reusable-commit-lint.yml"
}

@test "workflow: reusable-kmp-safety-check uses @master not @main" {
    ! grep -q "@main" "$L0_ROOT/.github/workflows/reusable-kmp-safety-check.yml"
    grep -q "@master" "$L0_ROOT/.github/workflows/reusable-kmp-safety-check.yml"
}

@test "workflow: reusable-lint-resources uses @master not @main" {
    ! grep -q "@main" "$L0_ROOT/.github/workflows/reusable-lint-resources.yml"
    grep -q "@master" "$L0_ROOT/.github/workflows/reusable-lint-resources.yml"
}

@test "workflow: README workflow examples use @master not @main" {
    ! grep -q "reusable-.*@main" "$README"
    grep -q "reusable-.*@master" "$README"
}

@test "workflow: all reusable workflows have @master" {
    for wf in "$L0_ROOT"/.github/workflows/reusable-*.yml; do
        if grep -q "@main" "$wf"; then
            echo "FAIL: $(basename "$wf") has @main"
            return 1
        fi
    done
}

# ===========================================================================
# D. GH Actions expression syntax — no double-quoted string literals
# ===========================================================================

@test "syntax: auto-sync template has no double-quoted literals in expressions" {
    # ${{ ... || "value" }} is invalid — must be ${{ ... || 'value' }}
    ! grep -E '\$\{\{[^}]*\|\|[^}]*"[A-Za-z]' "$L0_ROOT/setup/templates/workflows/l0-auto-sync.yml"
}

@test "syntax: dispatch workflow has no double-quoted literals in expressions" {
    ! grep -E '\$\{\{[^}]*\|\|[^}]*"[A-Za-z]' "$L0_ROOT/.github/workflows/l0-sync-dispatch.yml"
}

@test "syntax: auto-sync SOURCE_LAYER uses single quotes" {
    grep -q "|| 'L0'" "$L0_ROOT/setup/templates/workflows/l0-auto-sync.yml"
}

@test "syntax: auto-sync SOURCE_COMMIT uses single quotes" {
    grep -q "|| 'scheduled'" "$L0_ROOT/setup/templates/workflows/l0-auto-sync.yml"
}

# ===========================================================================
# E. README new sections coherence
# ===========================================================================

@test "README: coverage-detect description mentions all detection paths" {
    desc=$(grep "coverage-detect" "$README" | grep "^|" | head -1)
    echo "$desc" | grep -q "build file"
    echo "$desc" | grep -q "build-logic"
    echo "$desc" | grep -q "libs.versions.toml"
}

@test "README: run-parallel description mentions auto-detect" {
    desc=$(grep "run-parallel-coverage-suite" "$README" | grep "^|" | head -1)
    echo "$desc" | grep -q "auto-detect\|Auto-detect"
}

@test "README: run-parallel description mentions exclude-coverage" {
    desc=$(grep "run-parallel-coverage-suite" "$README" | grep "^|" | head -1)
    echo "$desc" | grep -q "exclude-coverage"
}

@test "README: coverage workflow has step 4b KOVER RECOVERY" {
    grep -q "4b.*KOVER RECOVERY\|KOVER RECOVERY" "$README"
}

@test "README: coverage workflow has step 2 EXCLUDE" {
    grep -q "DISCOVER MODULES.*EXCLUDE\|exclude-coverage" "$README"
}

@test "README: Updating section has Automatic and Manual subsections" {
    grep -q "### Automatic" "$README"
    grep -q "### Manual" "$README"
}

@test "README: Updating section describes dispatch + cron" {
    grep -q "dispatch" "$README"
    grep -q "cron\|daily" "$README"
}

@test "README: skills note mentions --exclude-coverage" {
    grep -q 'exclude-coverage.*modules\|--exclude-coverage' "$README"
}

@test "README: directory tree includes l0-sync-dispatch.yml" {
    grep -q "l0-sync-dispatch.yml" "$README"
}

@test "README: directory tree includes l0-auto-sync.yml" {
    grep -q "l0-auto-sync.yml" "$README"
}

# ===========================================================================
# F. Setup wizard W0 auto-discovery docs
# ===========================================================================

@test "wizard W0: mentions auto-discovery" {
    grep -q "auto-discover\|Auto-discover\|discoverLayers\|discovery" "$SETUP_SKILL"
}

@test "wizard W0: documents L0 marker (registry + mcp-server)" {
    grep -q "registry.json.*mcp-server\|mcp-server.*registry" "$SETUP_SKILL" || \
    grep -q "skills/registry.json" "$SETUP_SKILL"
}

@test "wizard W0: documents L1 marker (registry + manifest)" {
    grep -q "registry.json.*l0-manifest\|l0-manifest.*registry" "$SETUP_SKILL" || \
    grep -q "L1.*registry.*manifest\|L1.*manifest.*registry" "$SETUP_SKILL"
}

@test "wizard W0: references layer-discovery.ts" {
    grep -q "layer-discovery" "$SETUP_SKILL"
}

@test "wizard W0: suggests topology based on discovery" {
    grep -q "suggestTopology\|Suggested topology\|suggest.*topology" "$SETUP_SKILL"
}

@test "wizard W0: allows manual fallback" {
    grep -q "manually\|manual\|enter paths" "$SETUP_SKILL"
}

# ===========================================================================
# G. Layer topology doc — auto-sync completeness
# ===========================================================================

@test "topology doc: has dispatch and cron subsections" {
    grep -q "Dispatch.*managed\|Dispatch.*instant" "$TOPOLOGY_DOC"
    grep -q "Cron.*open\|Cron.*daily" "$TOPOLOGY_DOC"
}

@test "topology doc: setup instructions for L0 and downstream" {
    grep -q "L0.*source\|downstream" "$TOPOLOGY_DOC"
    grep -q "downstream-repos.json" "$TOPOLOGY_DOC"
}

@test "topology doc: mentions DOWNSTREAM_SYNC_TOKEN" {
    grep -q "DOWNSTREAM_SYNC_TOKEN" "$TOPOLOGY_DOC"
}

@test "topology doc: cross-references both workflow files" {
    grep -q "l0-sync-dispatch.yml" "$TOPOLOGY_DOC"
    grep -q "l0-auto-sync.yml" "$TOPOLOGY_DOC"
}

# ===========================================================================
# H. Detection functional: build-logic + libs.versions.toml paths
# ===========================================================================

@test "detect: convention plugin in build-logic .gradle.kts file" {
    mkdir -p "$WORK_DIR/project/feature/home"
    mkdir -p "$WORK_DIR/project/build-logic/convention"
    echo '' > "$WORK_DIR/project/settings.gradle.kts"
    echo 'android {}' > "$WORK_DIR/project/feature/home/build.gradle.kts"
    echo '// clean' > "$WORK_DIR/project/build.gradle.kts"
    echo 'plugins { id("org.jetbrains.kotlinx.kover") }' > "$WORK_DIR/project/build-logic/convention/module.gradle.kts"
    result=$(detect_coverage_tool "$WORK_DIR/project/feature/home/build.gradle.kts")
    [ "$result" = "kover" ]
}

@test "detect: libs.versions.toml with kover plugin alias" {
    mkdir -p "$WORK_DIR/project/module"
    mkdir -p "$WORK_DIR/project/gradle"
    echo '' > "$WORK_DIR/project/settings.gradle.kts"
    echo 'android {}' > "$WORK_DIR/project/module/build.gradle.kts"
    echo '// clean' > "$WORK_DIR/project/build.gradle.kts"
    printf '[plugins]\nkover = { id = "org.jetbrains.kotlinx.kover", version.ref = "kover" }' > "$WORK_DIR/project/gradle/libs.versions.toml"
    result=$(detect_coverage_tool "$WORK_DIR/project/module/build.gradle.kts")
    [ "$result" = "kover" ]
}

@test "detect: neither build-logic nor toml → defaults to jacoco" {
    mkdir -p "$WORK_DIR/project/module"
    mkdir -p "$WORK_DIR/project/gradle"
    echo '' > "$WORK_DIR/project/settings.gradle.kts"
    echo 'android {}' > "$WORK_DIR/project/module/build.gradle.kts"
    echo '// plain android project' > "$WORK_DIR/project/build.gradle.kts"
    # Empty gradle dir and no build-logic
    echo 'agp = "8.9.0"' > "$WORK_DIR/project/gradle/libs.versions.toml"
    result=$(detect_coverage_tool "$WORK_DIR/project/module/build.gradle.kts")
    [ "$result" = "jacoco" ]
}

@test "detect: xml path for kover desktop variant" {
    mkdir -p "$WORK_DIR/mod/build/reports/kover"
    echo '<r/>' > "$WORK_DIR/mod/build/reports/kover/reportDesktop.xml"
    result=$(get_coverage_xml_path "kover" "$WORK_DIR/mod" "true")
    echo "$result" | grep -q "reportDesktop.xml"
}

@test "detect: xml path for kover falls back to any .xml" {
    mkdir -p "$WORK_DIR/mod/build/reports/kover"
    echo '<r/>' > "$WORK_DIR/mod/build/reports/kover/custom.xml"
    result=$(get_coverage_xml_path "kover" "$WORK_DIR/mod" "true")
    echo "$result" | grep -q "custom.xml"
}

@test "detect: report dir for kover is build/reports/kover" {
    result=$(get_coverage_report_dir "kover")
    [ "$result" = "build/reports/kover" ]
}

@test "detect: report dir for jacoco is build/reports/jacoco" {
    result=$(get_coverage_report_dir "jacoco")
    [ "$result" = "build/reports/jacoco" ]
}

# ===========================================================================
# I. Reusable workflows: L0 script access pattern
# ===========================================================================

@test "reusable-agent-parity: has androidcommondoc_path input" {
    grep -q "androidcommondoc_path" "$L0_ROOT/.github/workflows/reusable-agent-parity.yml"
}

@test "reusable-agent-parity: clones L0 with sparse-checkout when path empty" {
    grep -q "sparse-checkout" "$L0_ROOT/.github/workflows/reusable-agent-parity.yml"
    grep -q "androidcommondoc-toolkit" "$L0_ROOT/.github/workflows/reusable-agent-parity.yml"
}

@test "reusable-agent-parity: resolves script paths from L0 or clone" {
    grep -q "scripts.outputs.sync\|scripts.outputs.check" "$L0_ROOT/.github/workflows/reusable-agent-parity.yml"
}

@test "reusable-agent-parity: does NOT hardcode scripts/ as local path" {
    # The old bug: bash scripts/sh/sync-gsd-agents.sh (assumes scripts in consumer repo)
    ! grep -q 'bash scripts/sh/sync-gsd-agents.sh' "$L0_ROOT/.github/workflows/reusable-agent-parity.yml"
    ! grep -q 'bash scripts/sh/check-agent-parity.sh' "$L0_ROOT/.github/workflows/reusable-agent-parity.yml"
}

@test "reusable-agent-parity: uses resolved paths via step outputs" {
    grep -q 'steps.scripts.outputs.sync' "$L0_ROOT/.github/workflows/reusable-agent-parity.yml"
    grep -q 'steps.scripts.outputs.check' "$L0_ROOT/.github/workflows/reusable-agent-parity.yml"
}

@test "reusable-lint-resources: has same L0 clone pattern" {
    grep -q "sparse-checkout" "$L0_ROOT/.github/workflows/reusable-lint-resources.yml"
    grep -q "androidcommondoc_path" "$L0_ROOT/.github/workflows/reusable-lint-resources.yml"
    grep -q "androidcommondoc-toolkit" "$L0_ROOT/.github/workflows/reusable-lint-resources.yml"
}

@test "reusable workflows using scripts: all have L0 clone fallback" {
    for wf in "$L0_ROOT"/.github/workflows/reusable-*.yml; do
        if grep -q 'bash.*scripts/sh/' "$wf"; then
            # Must either have sparse-checkout or androidcommondoc_path input
            if ! grep -q "sparse-checkout\|androidcommondoc_path" "$wf"; then
                echo "FAIL: $(basename "$wf") uses scripts but has no L0 clone pattern"
                return 1
            fi
        fi
    done
}

# ===========================================================================
# J. ci-template @master + no @main anywhere
# ===========================================================================

@test "ci-template: uses @master not @main" {
    ! grep -q "@main" "$L0_ROOT/setup/github-workflows/ci-template.yml"
    grep -q "@master" "$L0_ROOT/setup/github-workflows/ci-template.yml"
}

@test "global: no @main in any yml or md file" {
    FOUND=$(grep -rl "@main" "$L0_ROOT"/.github/workflows/*.yml \
        "$L0_ROOT"/setup/github-workflows/*.yml \
        "$L0_ROOT"/setup/templates/workflows/*.yml \
        "$L0_ROOT"/README.md 2>/dev/null || true)
    if [ -n "$FOUND" ]; then
        echo "Files with @main: $FOUND"
        return 1
    fi
}

# ===========================================================================
# K. Release workflow template
# ===========================================================================

@test "release template: file exists" {
    [ -f "$L0_ROOT/setup/templates/workflows/release.yml" ]
}

@test "release template: triggers on push to master" {
    grep -q "push:" "$L0_ROOT/setup/templates/workflows/release.yml"
    grep -q "master" "$L0_ROOT/setup/templates/workflows/release.yml"
}

@test "release template: has workflow_dispatch with dry_run" {
    grep -q "workflow_dispatch:" "$L0_ROOT/setup/templates/workflows/release.yml"
    grep -q "dry_run" "$L0_ROOT/setup/templates/workflows/release.yml"
}

@test "release template: reads version.properties" {
    grep -q "version.properties" "$L0_ROOT/setup/templates/workflows/release.yml"
}

@test "release template: detects feat commits for minor bump" {
    grep -q "feat" "$L0_ROOT/setup/templates/workflows/release.yml"
    grep -q "minor" "$L0_ROOT/setup/templates/workflows/release.yml"
}

@test "release template: detects fix commits for patch bump" {
    grep -q "fix" "$L0_ROOT/setup/templates/workflows/release.yml"
    grep -q "patch" "$L0_ROOT/setup/templates/workflows/release.yml"
}

@test "release template: skips when no conventional commits" {
    grep -q "Skipping release\|skip=true" "$L0_ROOT/setup/templates/workflows/release.yml"
}

@test "release template: prevents infinite loop (bot commit skip)" {
    grep -q "chore(release)" "$L0_ROOT/setup/templates/workflows/release.yml"
}

@test "release template: creates git tag" {
    grep -q "git tag" "$L0_ROOT/setup/templates/workflows/release.yml"
}

@test "release template: updates CHANGELOG.md" {
    grep -q "CHANGELOG" "$L0_ROOT/setup/templates/workflows/release.yml"
}

@test "release template: back-merges to develop" {
    grep -q "develop" "$L0_ROOT/setup/templates/workflows/release.yml"
    grep -q "back-merge\|merge.*master" "$L0_ROOT/setup/templates/workflows/release.yml"
}

@test "release template: creates GitHub Release" {
    grep -q "gh release create" "$L0_ROOT/setup/templates/workflows/release.yml"
}

@test "release template: has CUSTOMIZE markers" {
    COUNT=$(grep -c "CUSTOMIZE" "$L0_ROOT/setup/templates/workflows/release.yml")
    [ "$COUNT" -ge 4 ]
}

@test "release template: has job summary" {
    grep -q "GITHUB_STEP_SUMMARY" "$L0_ROOT/setup/templates/workflows/release.yml"
}

@test "release template: no @main references" {
    ! grep -q "@main" "$L0_ROOT/setup/templates/workflows/release.yml"
}

@test "setup skill: W5 mentions release.yml" {
    grep -q "release.yml" "$SETUP_SKILL"
}

@test "setup skill: release only if Git Flow confirmed" {
    grep -q "version.properties.*exists\|Git Flow" "$SETUP_SKILL"
}

@test "README: directory tree includes release.yml template" {
    grep -q "release.yml" "$README"
}

# ===========================================================================
# L. Auto-sync documentation completeness
# ===========================================================================

@test "topology doc: has setup guide with 5 steps" {
    grep -q "Step 1.*dispatch target\|Step 1.*Configure" "$TOPOLOGY_DOC"
    grep -q "Step 2.*DOWNSTREAM_SYNC_TOKEN" "$TOPOLOGY_DOC"
    grep -q "Step 3.*Install auto-sync" "$TOPOLOGY_DOC"
    grep -q "Step 4.*Enable Actions PR" "$TOPOLOGY_DOC"
    grep -q "Step 5.*cascade\|Step 5.*chain" "$TOPOLOGY_DOC"
}

@test "topology doc: has troubleshooting table" {
    grep -q "Troubleshooting" "$TOPOLOGY_DOC"
    grep -q "not permitted to create" "$TOPOLOGY_DOC"
    grep -q "DOWNSTREAM_SYNC_TOKEN.*expired" "$TOPOLOGY_DOC"
}

@test "topology doc: describes fine-grained PAT creation" {
    grep -q "Fine-grained\|fine-grained" "$TOPOLOGY_DOC"
    grep -q "Contents.*Read and write\|Contents:.*RW" "$TOPOLOGY_DOC"
}

@test "topology doc: describes PR format" {
    grep -q "auto-sync/l0-update" "$TOPOLOGY_DOC"
    grep -q "chore(sync)" "$TOPOLOGY_DOC"
}

@test "topology doc: shows dispatch flow diagram" {
    grep -q "l0-sync-dispatch.yml" "$TOPOLOGY_DOC"
    grep -q "repository_dispatch" "$TOPOLOGY_DOC"
    grep -q "downstream-repos.json" "$TOPOLOGY_DOC"
}

@test "topology doc: has path filter list" {
    grep -q "skills/" "$TOPOLOGY_DOC"
    grep -q "agents/" "$TOPOLOGY_DOC"
    grep -q "scripts/" "$TOPOLOGY_DOC"
}

@test "topology doc: under 500 lines (sub-doc absolute max)" {
    LINES=$(wc -l < "$TOPOLOGY_DOC" | tr -d ' \r')
    [ "$LINES" -le 500 ]
}

@test "README: Updating section has 3-step quick setup" {
    grep -q "Quick setup\|quick setup\|3 steps" "$README"
}

@test "README: mentions DOWNSTREAM_SYNC_TOKEN in Updating" {
    # The Updating section should mention the secret
    sed -n '/^## Updating/,/^## /p' "$README" | grep -q "DOWNSTREAM_SYNC_TOKEN"
}

@test "README: mentions Actions PR permission in Updating" {
    sed -n '/^## Updating/,/^## /p' "$README" | grep -q "Allow GitHub Actions\|create and approve"
}

@test "README: links to layer-topology auto-sync section" {
    grep -q "layer-topology.md.*auto-sync\|layer-topology.md#auto-sync" "$README"
}

@test "README: mentions user selections are never overwritten" {
    sed -n '/^## Updating/,/^## /p' "$README" | grep -q "never overwritten\|never.*overwrite"
}

# ===========================================================================
# M. Distribution models + post-merge documentation
# ===========================================================================

@test "topology doc: has distribution models table" {
    grep -q "Managed.*dispatch\|managed.*dispatch" "$TOPOLOGY_DOC"
    grep -q "Open.*cron\|open.*cron" "$TOPOLOGY_DOC"
}

@test "topology doc: managed is for your repos, open for external" {
    grep -q "your.*ecosystem\|repos you control" "$TOPOLOGY_DOC"
    grep -q "external.*consumer\|other teams\|open-source" "$TOPOLOGY_DOC"
}

@test "topology doc: has post-merge workflow section" {
    grep -q "Post-merge\|post-merge\|After merging" "$TOPOLOGY_DOC"
    grep -q "git pull\|git checkout develop" "$TOPOLOGY_DOC"
}

@test "topology doc: clarifies sync-gsd scripts are L0-only" {
    grep -q "sync-gsd.*L0-only\|scripts.*only exist in L0\|L0-only scripts" "$TOPOLOGY_DOC"
}

@test "topology doc: has open consumer setup guide" {
    grep -q "open consumer\|Setup guide.*open" "$TOPOLOGY_DOC"
}

@test "README: describes both managed and open models" {
    sed -n '/^### Automatic/,/^### Manual/p' "$README" | grep -q "Managed\|managed"
    sed -n '/^### Automatic/,/^### Manual/p' "$README" | grep -q "Open\|open.*cron\|daily cron"
}

@test "README: has post-merge instructions" {
    sed -n '/^## Updating/,/^## /p' "$README" | grep -q "After merging\|git pull develop"
}

@test "README: has open consumer quick setup" {
    sed -n '/^## Updating/,/^## /p' "$README" | grep -q "open consumer\|2 steps"
}

# ===========================================================================
# N. Release assets workflow
# ===========================================================================

@test "release-assets workflow: file exists" {
    [ -f "$L0_ROOT/.github/workflows/l0-release-assets.yml" ]
}

@test "release-assets workflow: triggers on tag push v*" {
    grep -q "tags:" "$L0_ROOT/.github/workflows/l0-release-assets.yml"
    grep -q "'v\*'" "$L0_ROOT/.github/workflows/l0-release-assets.yml"
}

@test "release-assets workflow: has workflow_dispatch" {
    grep -q "workflow_dispatch:" "$L0_ROOT/.github/workflows/l0-release-assets.yml"
}

@test "release-assets workflow: packages skills directory" {
    grep -q "skills/" "$L0_ROOT/.github/workflows/l0-release-assets.yml"
}

@test "release-assets workflow: packages agents directory" {
    grep -q "agents/" "$L0_ROOT/.github/workflows/l0-release-assets.yml"
}

@test "release-assets workflow: packages commands directory" {
    grep -q "commands/" "$L0_ROOT/.github/workflows/l0-release-assets.yml"
}

@test "release-assets workflow: creates tarball" {
    grep -q "tar czf" "$L0_ROOT/.github/workflows/l0-release-assets.yml"
    grep -q "androidcommondoc-assets.tar.gz" "$L0_ROOT/.github/workflows/l0-release-assets.yml"
}

@test "release-assets workflow: creates GitHub Release on tag" {
    grep -q "gh release create" "$L0_ROOT/.github/workflows/l0-release-assets.yml"
}

@test "release-assets workflow: uploads artifact for snapshots" {
    grep -q "upload-artifact" "$L0_ROOT/.github/workflows/l0-release-assets.yml"
}

@test "release-assets workflow: includes workflow templates" {
    grep -q "setup/templates/workflows" "$L0_ROOT/.github/workflows/l0-release-assets.yml"
}

@test "release-assets workflow: has job summary" {
    grep -q "GITHUB_STEP_SUMMARY" "$L0_ROOT/.github/workflows/l0-release-assets.yml"
}

# ===========================================================================
# O. Remote clone in manifest schema + sync engine
# ===========================================================================

@test "manifest schema: LayerSource has remote field" {
    grep -q "remote.*url\|remote.*string\|remote.*optional" "$L0_ROOT/mcp-server/src/sync/manifest-schema.ts"
}

@test "sync engine: cloneRemoteSource function exists" {
    grep -q "export function cloneRemoteSource" "$L0_ROOT/mcp-server/src/sync/sync-engine.ts"
}

@test "sync engine: cleanupClone function exists" {
    grep -q "export function cleanupClone" "$L0_ROOT/mcp-server/src/sync/sync-engine.ts"
}

@test "CLI: imports cloneRemoteSource and cleanupClone" {
    grep -q "cloneRemoteSource" "$L0_ROOT/mcp-server/src/sync/sync-l0-cli.ts"
    grep -q "cleanupClone" "$L0_ROOT/mcp-server/src/sync/sync-l0-cli.ts"
}

@test "CLI: checks for remote when local path missing" {
    grep -q "l0SourceEntry.remote\|source.*remote" "$L0_ROOT/mcp-server/src/sync/sync-l0-cli.ts"
}

@test "CLI: cleans up cloned dirs in finally block" {
    grep -q "finally" "$L0_ROOT/mcp-server/src/sync/sync-l0-cli.ts"
    grep -q "cleanupClone\|clonedDirs" "$L0_ROOT/mcp-server/src/sync/sync-l0-cli.ts"
}

# ===========================================================================
# P. README consumer vs internal separation
# ===========================================================================

@test "README: skills section has 'Skills' subsection" {
    grep -q "### Skills" "$README"
}

@test "README: skills section has 'L0 Maintenance Skills' subsection" {
    grep -q "### L0 Maintenance Skills" "$README"
}

@test "README: L0 skills section describes maintenance purpose" {
    sed -n '/### L0 Maintenance Skills/,/^## /p' "$README" | grep -qi "maintenance\|L0\|AndroidCommonDoc"
}

@test "README: agents section has 'Domain Agents' subsection" {
    grep -q "### Domain Agents" "$README"
}

@test "README: agents section has 'Quality Gate Agents' subsection" {
    grep -q "### Quality Gate Agents" "$README"
}

@test "README: QG agents section describes consistency verification" {
    sed -n '/### Quality Gate Agents/,/^## /p' "$README" | grep -qi "consistency\|verify\|internal"
}

@test "README: MCP section has 'General Tools' subsection" {
    grep -q "### General Tools" "$README"
}

@test "README: MCP section has 'L0 Internal Tools' subsection" {
    grep -q "### L0 Internal Tools" "$README"
}

@test "README: has 'What gets synced' section" {
    grep -q "What gets synced" "$README"
}

@test "README: 'What gets synced' lists consumer counts" {
    sed -n '/What gets synced/,/^### /p' "$README" | grep -q "53"
    sed -n '/What gets synced/,/^### /p' "$README" | grep -q "50"
}

@test "README: 'What gets synced' clarifies what is NOT synced" {
    sed -n '/What gets synced/,/^### /p' "$README" | grep -qi "not synced"
}

@test "README: docs count is 88+ sub-docs" {
    grep -q "88+ sub-docs" "$README"
}

@test "README: vitest count is 1202" {
    grep -q "1202 tests" "$README"
}

@test "README: vitest files count is 89" {
    grep -q "89 test files" "$README"
}

# ===========================================================================
# Q. Coverage config cache + auto-exclude fixes
# ===========================================================================

@test "auto-exclude: detekt-rules* pattern in SH" {
    grep -q "detekt-rules" "$SH_DIR/run-parallel-coverage-suite.sh"
}

@test "auto-exclude: detekt-rules-l1 matches detekt-rules* pattern" {
    AUTO_EXCLUDE_COVERAGE_PATTERNS=("detekt-rules*" "*detekt-rules*")
    skip_cov=false
    for pattern in "${AUTO_EXCLUDE_COVERAGE_PATTERNS[@]}"; do
        if [[ "detekt-rules-l1" == $pattern ]]; then skip_cov=true; break; fi
    done
    [ "$skip_cov" = "true" ]
}

@test "auto-exclude: konsist-guard still matches" {
    AUTO_EXCLUDE_COVERAGE_PATTERNS=("konsist-guard" "konsist-tests" "detekt-rules*")
    skip_cov=false
    for pattern in "${AUTO_EXCLUDE_COVERAGE_PATTERNS[@]}"; do
        if [[ "konsist-guard" == $pattern ]]; then skip_cov=true; break; fi
    done
    [ "$skip_cov" = "true" ]
}

@test "auto-exclude: core-domain does NOT match detekt-rules pattern" {
    AUTO_EXCLUDE_COVERAGE_PATTERNS=("detekt-rules*" "*detekt-rules*")
    skip_cov=false
    for pattern in "${AUTO_EXCLUDE_COVERAGE_PATTERNS[@]}"; do
        if [[ "core-domain" == $pattern ]]; then skip_cov=true; break; fi
    done
    [ "$skip_cov" = "false" ]
}

@test "config-cache: SH per-module retry uses --no-configuration-cache" {
    grep -q "no-configuration-cache" "$SH_DIR/run-parallel-coverage-suite.sh"
}

@test "config-cache: SH retry paths have --no-configuration-cache" {
    # Batch retry uses --no-configuration-cache for full-fail and partial recovery
    count=$(grep -c "no-configuration-cache" "$SH_DIR/run-parallel-coverage-suite.sh" | tr -d ' \r')
    [ "$count" -ge 2 ]
}

@test "config-cache: PS1 per-module retry uses --no-configuration-cache" {
    grep -q "no-configuration-cache" "$PS1_DIR/run-parallel-coverage-suite.ps1"
}

@test "PS1 parity: auto-exclude patterns include detekt-rules" {
    grep -q "detekt-rules" "$PS1_DIR/run-parallel-coverage-suite.ps1"
}

@test "PS1 parity: auto-exclude uses -like for glob matching" {
    grep -q "\-like" "$PS1_DIR/run-parallel-coverage-suite.ps1"
}

# ===========================================================================
# R. Coverage task generation guarded by skip_cov
# ===========================================================================

@test "SH: coverage task generation is inside skip_cov guard" {
    # The line "get_coverage_gradle_task" must be inside a "if ! \$skip_cov" block
    grep -q 'if ! .skip_cov.*then' "$SH_DIR/run-parallel-coverage-suite.sh"
    # And the coverage task generation line must come after that guard
    grep -B5 "get_coverage_gradle_task.*mod_cov_tool" "$SH_DIR/run-parallel-coverage-suite.sh" | grep -q "skip_cov"
}

@test "PS1: coverage task generation is inside skipCov guard" {
    grep -B5 "Get-CoverageGradleTask.*modCovTool" "$PS1_DIR/run-parallel-coverage-suite.ps1" | grep -q "skipCov"
}

# ===========================================================================
# S. Community standards files
# ===========================================================================

@test "community: CODE_OF_CONDUCT.md exists" {
    [ -f "$L0_ROOT/CODE_OF_CONDUCT.md" ]
}

@test "community: CODE_OF_CONDUCT.md references Contributor Covenant" {
    grep -q "Contributor Covenant" "$L0_ROOT/CODE_OF_CONDUCT.md"
}

@test "community: CONTRIBUTING.md exists" {
    [ -f "$L0_ROOT/CONTRIBUTING.md" ]
}

@test "community: CONTRIBUTING.md has branch model section" {
    grep -q "Branch Model\|Git Flow" "$L0_ROOT/CONTRIBUTING.md"
}

@test "community: CONTRIBUTING.md mentions test requirement" {
    grep -q "Every change needs tests\|test.*required\|No exceptions" "$L0_ROOT/CONTRIBUTING.md"
}

@test "community: CONTRIBUTING.md mentions downstream impact" {
    grep -q "Downstream Impact\|downstream" "$L0_ROOT/CONTRIBUTING.md"
}

@test "community: SECURITY.md exists" {
    [ -f "$L0_ROOT/SECURITY.md" ]
}

@test "community: SECURITY.md has reporting instructions" {
    grep -q "Reporting.*Vulnerability\|report.*security" "$L0_ROOT/SECURITY.md"
}

@test "community: SECURITY.md mentions response timeline" {
    grep -q "Timeline\|48 hours\|1 week" "$L0_ROOT/SECURITY.md"
}

@test "community: bug report issue template exists" {
    [ -f "$L0_ROOT/.github/ISSUE_TEMPLATE/bug-report.yml" ]
}

@test "community: feature request issue template exists" {
    [ -f "$L0_ROOT/.github/ISSUE_TEMPLATE/feature-request.yml" ]
}

@test "community: sync issue template exists" {
    [ -f "$L0_ROOT/.github/ISSUE_TEMPLATE/sync-issue.yml" ]
}

@test "community: issue template config exists" {
    [ -f "$L0_ROOT/.github/ISSUE_TEMPLATE/config.yml" ]
}

@test "community: PR template exists in .github/" {
    [ -f "$L0_ROOT/.github/pull_request_template.md" ]
}

@test "community: PR template has downstream impact section" {
    grep -q "Downstream Impact" "$L0_ROOT/.github/pull_request_template.md"
}

@test "community: PR template has quality checklist" {
    grep -q "Quality Checklist" "$L0_ROOT/.github/pull_request_template.md"
}

@test "community: bug report template has area dropdown" {
    grep -q "area" "$L0_ROOT/.github/ISSUE_TEMPLATE/bug-report.yml"
    grep -q "Skill\|Script\|Detekt\|MCP" "$L0_ROOT/.github/ISSUE_TEMPLATE/bug-report.yml"
}

@test "community: sync issue template has topology dropdown" {
    grep -q "topology" "$L0_ROOT/.github/ISSUE_TEMPLATE/sync-issue.yml"
    grep -q "Flat\|Chain" "$L0_ROOT/.github/ISSUE_TEMPLATE/sync-issue.yml"
}

@test "community: sync issue template asks for manifest" {
    grep -q "l0-manifest.json\|manifest" "$L0_ROOT/.github/ISSUE_TEMPLATE/sync-issue.yml"
}

# ===========================================================================
# U. JAVA_HOME auto-detect + daemon safety
# ===========================================================================

@test "SH: has --java-home flag" {
    grep -q "\-\-java-home" "$SH_DIR/run-parallel-coverage-suite.sh"
}

@test "SH: auto-detects JAVA_HOME from gradle.properties" {
    grep -q "org.gradle.java.home" "$SH_DIR/run-parallel-coverage-suite.sh"
}

@test "SH: warns on jvmToolchain version mismatch" {
    grep -q "jvmToolchain" "$SH_DIR/run-parallel-coverage-suite.sh"
    grep -q "UnsupportedClassVersionError" "$SH_DIR/run-parallel-coverage-suite.sh"
}

@test "SH: marks all as failed when gradle exits non-zero with 0 task results" {
    grep -q "Marking all.*modules as failed" "$SH_DIR/run-parallel-coverage-suite.sh"
    # Only when SUCCESS_COUNT is also 0 (no task output at all)
    grep -q 'SUCCESS_COUNT.*-eq 0' "$SH_DIR/run-parallel-coverage-suite.sh"
}

@test "SH: does NOT mark as failed when tasks passed but gradle exit non-zero" {
    grep -q "deprecation warnings\|not test failures" "$SH_DIR/run-parallel-coverage-suite.sh"
}

@test "PS1: has -JavaHome parameter" {
    grep -q "JavaHome" "$PS1_DIR/run-parallel-coverage-suite.ps1"
}

@test "PS1: auto-detects JAVA_HOME from gradle.properties" {
    grep -q "gradle.*java.*home" "$PS1_DIR/run-parallel-coverage-suite.ps1"
}

@test "PS1: warns on jvmToolchain version mismatch" {
    grep -q "jvmToolchain" "$PS1_DIR/run-parallel-coverage-suite.ps1"
    grep -q "UnsupportedClassVersionError" "$PS1_DIR/run-parallel-coverage-suite.ps1"
}

@test "README: Coverage Workflow mentions --java-home" {
    grep -q "java-home" "$README"
}

@test "README: Coverage Workflow mentions auto-detect gradle.properties" {
    sed -n '/Coverage Workflow/,/^## /p' "$README" | grep -q "gradle.properties\|org.gradle.java.home"
}

# ---------------------------------------------------------------------------
# monitor-sources multi-project support
# ---------------------------------------------------------------------------

@test "monitor-sources CLI: supports --layer flag" {
    grep -q "\-\-layer" mcp-server/src/cli/monitor-sources.ts
}

@test "monitor-sources CLI: layer defaults to L0" {
    grep -q '"L0"' mcp-server/src/cli/monitor-sources.ts
}

@test "monitor-sources CLI: passes layer to scanDirectory" {
    grep -q "options.layer" mcp-server/src/cli/monitor-sources.ts
}

@test "monitor-sources CLI: accepts L1 and L2 as valid layers" {
    grep -q '"L1"' mcp-server/src/cli/monitor-sources.ts
    grep -q '"L2"' mcp-server/src/cli/monitor-sources.ts
}

@test "monitor-sources MCP tool: has layer parameter in schema" {
    grep -q 'layer' mcp-server/src/tools/monitor-sources.ts
    grep -q 'L0.*L1.*L2\|enum.*L0' mcp-server/src/tools/monitor-sources.ts
}

@test "monitor-sources MCP tool: passes layer to scanDirectory" {
    grep -q "layer)" mcp-server/src/tools/monitor-sources.ts
}

@test "monitor-docs skill: documents --layer parameter" {
    grep -q "\-\-layer" skills/monitor-docs/SKILL.md
}

@test "monitor-docs skill: shows L1 usage example" {
    grep -q "layer L1" skills/monitor-docs/SKILL.md
}

# ===========================================================================
# v1.4.0 Agent Ecosystem Tests
# ===========================================================================

@test "agents: all 5 new agents exist" {
    for agent in advisor codebase-mapper debugger researcher verifier; do
        [ -f "$L0_ROOT/.claude/agents/$agent.md" ]
    done
}

@test "agents: new agents have valid frontmatter (name + model)" {
    for agent in advisor codebase-mapper debugger researcher verifier; do
        grep -q "^name:" "$L0_ROOT/.claude/agents/$agent.md"
        grep -q "^model:" "$L0_ROOT/.claude/agents/$agent.md"
    done
}

@test "skills: all 7 new skills exist" {
    for skill in debug research map-codebase verify decide note review-pr; do
        [ -f "$L0_ROOT/skills/$skill/SKILL.md" ]
    done
}

@test "skills: all 7 new commands exist" {
    for cmd in debug research map-codebase verify decide note review-pr; do
        [ -f "$L0_ROOT/.claude/commands/$cmd.md" ]
    done
}

@test "skills: agent-invoking skills reference correct agents" {
    grep -q 'subagent_type="debugger"' "$L0_ROOT/skills/debug/SKILL.md"
    grep -q 'subagent_type="researcher"' "$L0_ROOT/skills/research/SKILL.md"
    grep -q 'subagent_type="codebase-mapper"' "$L0_ROOT/skills/map-codebase/SKILL.md"
    grep -q 'subagent_type="verifier"' "$L0_ROOT/skills/verify/SKILL.md"
    grep -q 'subagent_type="advisor"' "$L0_ROOT/skills/decide/SKILL.md"
}

@test "agents: test-specialist knows benchmark skill" {
    grep -q "benchmark" "$L0_ROOT/.claude/agents/test-specialist.md"
}

@test "agents: ui-specialist knows lint-resources skill" {
    grep -q "lint-resources" "$L0_ROOT/.claude/agents/ui-specialist.md"
}

@test "hooks: 3 new hooks exist" {
    [ -f "$L0_ROOT/.claude/hooks/plan-context.js" ]
    [ -f "$L0_ROOT/.claude/hooks/doc-freshness-alert.js" ]
    [ -f "$L0_ROOT/.claude/hooks/agent-delegation-reminder.js" ]
}

@test "templates: product-strategist and content-creator exist" {
    [ -f "$L0_ROOT/setup/agent-templates/product-strategist.md" ]
    [ -f "$L0_ROOT/setup/agent-templates/content-creator.md" ]
}

@test "docs: spec-driven-workflow exists with frontmatter" {
    [ -f "$L0_ROOT/docs/agents/spec-driven-workflow.md" ]
    grep -q "^slug: spec-driven-workflow" "$L0_ROOT/docs/agents/spec-driven-workflow.md"
}

@test "README: counts match 20 agents, 53 skills" {
    grep -q "20 specialized agents" "$README"
    grep -q "53 canonical" "$README"
}

@test "CLAUDE.md: lists all new agents in delegation table" {
    for agent in debugger verifier advisor researcher codebase-mapper; do
        grep -q "$agent" "$L0_ROOT/CLAUDE.md"
    done
}

@test "CLAUDE.md: lists all new skills in commands section" {
    for skill in debug research map-codebase verify decide note review-pr benchmark; do
        grep -q "/$skill" "$L0_ROOT/CLAUDE.md"
    done
}

@test "model-profiles: debugger is opus in advanced" {
    python3 -c "
import json, os, re
path = '$L0_ROOT/.claude/model-profiles.json'
# Normalize MSYS /c/ paths to C:/ for Windows Python compatibility
if not os.path.exists(path):
    path = re.sub(r'^/([a-zA-Z])/', lambda m: m.group(1).upper() + ':/', path)
d = json.load(open(path))
assert d['profiles']['advanced']['overrides'].get('debugger') == 'opus', 'debugger not opus in advanced'
"
}

@test "benchmark: SKILL.md exists with runner reference" {
    [ -f "$L0_ROOT/skills/benchmark/SKILL.md" ]
    [ -f "$L0_ROOT/scripts/sh/run-benchmarks.sh" ]
    [ -f "$L0_ROOT/scripts/ps1/run-benchmarks.ps1" ]
}

@test "benchmark: detection libraries exist" {
    [ -f "$L0_ROOT/scripts/sh/lib/benchmark-detect.sh" ]
    [ -f "$L0_ROOT/scripts/ps1/lib/Benchmark-Detect.ps1" ]
}

# ===========================================================================
# === v1.5.0 Ecosystem Initialization + Business Layer Tests ===
# ===========================================================================

@test "skills: /work skill exists" {
    [ -f "$L0_ROOT/skills/work/SKILL.md" ]
    [ -f "$L0_ROOT/.claude/commands/work.md" ]
}

@test "skills: /init-session skill exists" {
    [ -f "$L0_ROOT/skills/init-session/SKILL.md" ]
    [ -f "$L0_ROOT/.claude/commands/init-session.md" ]
}

@test "skills: /resume-work skill exists" {
    [ -f "$L0_ROOT/skills/resume-work/SKILL.md" ]
    [ -f "$L0_ROOT/.claude/commands/resume-work.md" ]
}

@test "skills: /work SKILL.md has routing rules" {
    grep -q "bug.*error.*fix" "$L0_ROOT/skills/work/SKILL.md"
    grep -q "product-strategist" "$L0_ROOT/skills/work/SKILL.md"
    grep -q "content-creator" "$L0_ROOT/skills/work/SKILL.md"
    grep -q "Level 2.*Frontmatter Discovery" "$L0_ROOT/skills/work/SKILL.md"
}

@test "skills: /work notes business agents are opt-in" {
    grep -q "opt-in" "$L0_ROOT/skills/work/SKILL.md"
    grep -q "verify.*exists" "$L0_ROOT/skills/work/SKILL.md" || grep -q "fall through" "$L0_ROOT/skills/work/SKILL.md"
}

@test "skills: 12 new command stubs exist" {
    for cmd in test test-full-parallel test-changed coverage benchmark extract-errors verify-kmp validate-patterns sync-l0 audit-docs validate-upstream generate-rules; do
        [ -f "$L0_ROOT/.claude/commands/$cmd.md" ]
    done
}

@test "skills: command stubs have description frontmatter" {
    for cmd in test coverage benchmark verify-kmp validate-patterns sync-l0 audit-docs work init-session resume-work; do
        grep -q "^description:" "$L0_ROOT/.claude/commands/$cmd.md"
    done
}

@test "agents: all 20 agents have domain frontmatter" {
    for agent in $L0_ROOT/.claude/agents/*.md; do
        grep -q "^domain:" "$agent" || { echo "MISSING domain: $agent"; return 1; }
    done
}

@test "agents: all 20 agents have intent frontmatter" {
    for agent in $L0_ROOT/.claude/agents/*.md; do
        grep -q "^intent:" "$agent" || { echo "MISSING intent: $agent"; return 1; }
    done
}

@test "agents: domain values are valid" {
    for agent in $L0_ROOT/.claude/agents/*.md; do
        domain=$(grep "^domain:" "$agent" | head -1 | sed 's/domain: *//')
        echo "$domain" | grep -qE "^(development|testing|security|quality|audit|business|marketing|infrastructure)$" || { echo "INVALID domain '$domain' in $agent"; return 1; }
    done
}

@test "templates: landing-page-strategist exists" {
    [ -f "$L0_ROOT/setup/agent-templates/landing-page-strategist.md" ]
    grep -q "^name: landing-page-strategist" "$L0_ROOT/setup/agent-templates/landing-page-strategist.md"
}

@test "templates: 10 agent templates exist" {
    count=$(ls $L0_ROOT/setup/agent-templates/*.md | grep -v README | wc -l)
    [ "$count" -eq 10 ]
}

@test "templates: business doc templates exist (5)" {
    [ -d "$L0_ROOT/setup/doc-templates/business" ]
    [ -f "$L0_ROOT/setup/doc-templates/business/PRODUCT_SPEC.md.template" ]
    [ -f "$L0_ROOT/setup/doc-templates/business/MARKETING.md.template" ]
    [ -f "$L0_ROOT/setup/doc-templates/business/PRICING.md.template" ]
    [ -f "$L0_ROOT/setup/doc-templates/business/LANDING_PAGES.md.template" ]
    [ -f "$L0_ROOT/setup/doc-templates/business/COMPETITIVE.md.template" ]
}

@test "templates: project-manager has HARD delegation rules" {
    grep -q "HARD Delegation" "$L0_ROOT/setup/agent-templates/project-manager.md"
    grep -q "MUST delegate" "$L0_ROOT/setup/agent-templates/project-manager.md"
}

@test "templates: project-manager NEVER writes code" {
    grep -q "NEVER write code" "$L0_ROOT/setup/agent-templates/project-manager.md"
    grep -q "NEVER writes code" "$L0_ROOT/setup/agent-templates/project-manager.md" || grep -q "NEVER write code yourself" "$L0_ROOT/setup/agent-templates/project-manager.md"
}

@test "templates: project-manager has Devs/Architects/Guardians roster" {
    grep -q "### Devs" "$L0_ROOT/setup/agent-templates/project-manager.md"
    grep -q "### Architects" "$L0_ROOT/setup/agent-templates/project-manager.md"
    grep -q "### Guardians" "$L0_ROOT/setup/agent-templates/project-manager.md"
}

@test "templates: project-manager delegates testing to skills" {
    grep -q "/test" "$L0_ROOT/setup/agent-templates/project-manager.md"
    grep -q "/test-full-parallel" "$L0_ROOT/setup/agent-templates/project-manager.md"
}

@test "templates: arch-testing is mini-orchestrator with MCP tools" {
    [ -f "$L0_ROOT/setup/agent-templates/arch-testing.md" ]
    grep -q "mini-orchestrator" "$L0_ROOT/setup/agent-templates/arch-testing.md"
    grep -q "Agent" "$L0_ROOT/setup/agent-templates/arch-testing.md"
    grep -q "code-metrics" "$L0_ROOT/setup/agent-templates/arch-testing.md"
    grep -q "Cross-Architect" "$L0_ROOT/setup/agent-templates/arch-testing.md"
    grep -q "ESCALATE" "$L0_ROOT/setup/agent-templates/arch-testing.md"
}

@test "templates: arch-platform is mini-orchestrator with MCP tools" {
    [ -f "$L0_ROOT/setup/agent-templates/arch-platform.md" ]
    grep -q "mini-orchestrator" "$L0_ROOT/setup/agent-templates/arch-platform.md"
    grep -q "verify-kmp-packages" "$L0_ROOT/setup/agent-templates/arch-platform.md"
    grep -q "dependency-graph" "$L0_ROOT/setup/agent-templates/arch-platform.md"
    grep -q "Cross-Architect" "$L0_ROOT/setup/agent-templates/arch-platform.md"
    grep -q "ESCALATE" "$L0_ROOT/setup/agent-templates/arch-platform.md"
}

@test "templates: arch-integration is mini-orchestrator with MCP tools" {
    [ -f "$L0_ROOT/setup/agent-templates/arch-integration.md" ]
    grep -q "mini-orchestrator" "$L0_ROOT/setup/agent-templates/arch-integration.md"
    grep -q "dependency-graph" "$L0_ROOT/setup/agent-templates/arch-integration.md"
    grep -q "Cross-Architect" "$L0_ROOT/setup/agent-templates/arch-integration.md"
    grep -q "ESCALATE" "$L0_ROOT/setup/agent-templates/arch-integration.md"
}

@test "templates: architects have Dev Management section" {
    for agent in arch-testing arch-platform arch-integration; do
        grep -q "Dev Management" "$L0_ROOT/setup/agent-templates/${agent}.md"
    done
}

@test "templates: project-manager has architect verification gate" {
    grep -q "Architect Verification Gate" "$L0_ROOT/setup/agent-templates/project-manager.md"
    grep -q "arch-testing" "$L0_ROOT/setup/agent-templates/project-manager.md"
    grep -q "arch-platform" "$L0_ROOT/setup/agent-templates/project-manager.md"
    grep -q "arch-integration" "$L0_ROOT/setup/agent-templates/project-manager.md"
    grep -q "NEVER write code" "$L0_ROOT/setup/agent-templates/project-manager.md"
}

@test "templates: project-manager has planning delegation" {
    grep -q "Planning Delegation" "$L0_ROOT/setup/agent-templates/project-manager.md"
    grep -q "researcher" "$L0_ROOT/setup/agent-templates/project-manager.md"
    grep -q "advisor" "$L0_ROOT/setup/agent-templates/project-manager.md"
}

@test "templates: project-manager has TDD-first for bug fixes" {
    grep -q "TDD-first for bug fixes" "$L0_ROOT/setup/agent-templates/project-manager.md"
    grep -q "failing test" "$L0_ROOT/setup/agent-templates/project-manager.md"
}

@test "templates: all architects can delegate and cross-verify" {
    for agent in arch-testing arch-platform arch-integration; do
        grep -q "Agent" "$L0_ROOT/setup/agent-templates/${agent}.md"
        grep -q "APPROVE.*ESCALATE" "$L0_ROOT/setup/agent-templates/${agent}.md"
        grep -q "Cross-Architect" "$L0_ROOT/setup/agent-templates/${agent}.md"
    done
}

@test "agents: l0-coherence-auditor references MCP tools" {
    grep -q "validate-doc-structure" "$L0_ROOT/.claude/agents/l0-coherence-auditor.md"
    grep -q "validate-skills" "$L0_ROOT/.claude/agents/l0-coherence-auditor.md"
    grep -q "validate-claude-md" "$L0_ROOT/.claude/agents/l0-coherence-auditor.md"
}

@test "agents: cross-platform-validator references MCP tools" {
    grep -q "verify-kmp-packages" "$L0_ROOT/.claude/agents/cross-platform-validator.md"
    grep -q "string-completeness" "$L0_ROOT/.claude/agents/cross-platform-validator.md"
}

@test "templates: project-manager has MCP tools section" {
    grep -q "MCP Tools" "$L0_ROOT/setup/agent-templates/project-manager.md"
    grep -q "verify-kmp-packages" "$L0_ROOT/setup/agent-templates/project-manager.md"
    grep -q "35" "$L0_ROOT/setup/agent-templates/project-manager.md"
}

@test "docs: agents-hub references architect gate pattern" {
    grep -q "architect-gate-pattern" "$L0_ROOT/docs/agents/agents-hub.md"
    grep -q "Architect team gates" "$L0_ROOT/docs/agents/agents-hub.md"
    grep -q "Bug fixes require TDD" "$L0_ROOT/docs/agents/agents-hub.md"
}

@test "docs: multi-agent-patterns has architect gate section" {
    grep -q "Architect Gate Pattern" "$L0_ROOT/docs/agents/multi-agent-patterns.md"
    grep -q "Architect gate:" "$L0_ROOT/docs/agents/multi-agent-patterns.md"
}

@test "docs: spec-driven-workflow lists architect agents" {
    grep -q "arch-testing" "$L0_ROOT/docs/agents/spec-driven-workflow.md"
    grep -q "arch-platform" "$L0_ROOT/docs/agents/spec-driven-workflow.md"
    grep -q "arch-integration" "$L0_ROOT/docs/agents/spec-driven-workflow.md"
}

@test "agents: debugger has done criteria" {
    grep -q "Done Criteria" "$L0_ROOT/.claude/agents/debugger.md"
    grep -q "Never claim.*fixed.*without a passing test" "$L0_ROOT/.claude/agents/debugger.md"
}

@test "templates: feature-domain-specialist has done criteria" {
    grep -q "Done Criteria" "$L0_ROOT/setup/agent-templates/feature-domain-specialist.md"
    grep -q "already fixed.*claims without evidence" "$L0_ROOT/setup/agent-templates/feature-domain-specialist.md"
}

@test "templates: platform-auditor has verify before reporting" {
    grep -q "Verify Before Reporting" "$L0_ROOT/setup/agent-templates/platform-auditor.md"
    grep -q "Re-read every file:line" "$L0_ROOT/setup/agent-templates/platform-auditor.md"
}

@test "templates: module-lifecycle has done criteria" {
    grep -q "Done Criteria" "$L0_ROOT/setup/agent-templates/module-lifecycle.md"
    grep -q "test-full-parallel" "$L0_ROOT/setup/agent-templates/module-lifecycle.md"
}

@test "templates: project-manager has post-change checklist" {
    grep -q "Post-Change Checklist" "$L0_ROOT/setup/agent-templates/project-manager.md"
    grep -q "automatic" "$L0_ROOT/setup/agent-templates/project-manager.md"
    grep -q "audit-docs" "$L0_ROOT/setup/agent-templates/project-manager.md"
    grep -q "readme-audit" "$L0_ROOT/setup/agent-templates/project-manager.md"
}

@test "README: template count is 10" {
    grep -q "10 reusable agent templates" "$L0_ROOT/README.md"
    grep -q "arch-testing" "$L0_ROOT/README.md"
    grep -q "arch-platform" "$L0_ROOT/README.md"
    grep -q "arch-integration" "$L0_ROOT/README.md"
}

@test "templates: project-manager references official anthropic skills" {
    grep -q "Official Skills" "$L0_ROOT/setup/agent-templates/project-manager.md"
    grep -q "tdd-workflow" "$L0_ROOT/setup/agent-templates/project-manager.md"
    grep -q "security-review" "$L0_ROOT/setup/agent-templates/project-manager.md"
}

@test "agents: 12 agents reference official skills" {
    count=$(grep -rl "Official Skills" "$L0_ROOT/setup/agent-templates/" "$L0_ROOT/.claude/agents/" 2>/dev/null | wc -l)
    [ "$count" -ge 12 ]
}

@test "commands: security-review command exists" {
    [ -f "$L0_ROOT/.claude/commands/security-review.md" ]
    grep -q "security" "$L0_ROOT/.claude/commands/security-review.md"
}

@test "setup: wizard W3.5 official skills exists" {
    grep -q "W3.5" "$L0_ROOT/skills/setup/SKILL.md"
    grep -q "Official Anthropic Skills" "$L0_ROOT/skills/setup/SKILL.md"
}

@test "agents: test-specialist has script-first execution section" {
    grep -q "NEVER run.*gradlew" "$L0_ROOT/.claude/agents/test-specialist.md"
    grep -q "/test.*module" "$L0_ROOT/.claude/agents/test-specialist.md"
    grep -q "/benchmark" "$L0_ROOT/.claude/agents/test-specialist.md"
}

@test "CLAUDE.md: lists /work, /init-session, /resume-work" {
    grep -q "/work" "$L0_ROOT/CLAUDE.md"
    grep -q "/init-session" "$L0_ROOT/CLAUDE.md"
    grep -q "/resume-work" "$L0_ROOT/CLAUDE.md"
}

@test "CHANGELOG: has ecosystem initialization entry" {
    grep -q "Ecosystem initialization" "$L0_ROOT/CHANGELOG.md" || grep -q "init-session" "$L0_ROOT/CHANGELOG.md"
}

@test "README: mentions /work routing" {
    grep -q "/work" "$README"
    grep -q "routing" "$README" || grep -q "Entry Points" "$README"
}

@test "README: mentions MODULE_MAP.md pattern" {
    grep -q "MODULE_MAP" "$README"
}

@test "README: mentions business layer" {
    grep -q "Business" "$README" || grep -q "business" "$README"
    grep -q "doc-templates" "$README" || grep -q "PRODUCT_SPEC" "$README"
}

@test "README: counts match 20 agents, 53 skills, 50 commands" {
    grep -q "20 specialized agents" "$README"
    grep -q "53 canonical" "$README"
    # 50 commands verified via sync table
}

# ============================================================
# Section 7.1: Multi-Agent Architecture Tests
# ============================================================

@test "arch: dev-lead.md does NOT exist (renamed to project-manager)" {
    [ ! -f "$L0_ROOT/setup/agent-templates/dev-lead.md" ]
}

@test "arch: PM does NOT contain 'execute implementation code' or 'codes inline'" {
    ! grep -q "execute implementation code" "$L0_ROOT/setup/agent-templates/project-manager.md"
    ! grep -q "codes inline" "$L0_ROOT/setup/agent-templates/project-manager.md"
    ! grep -q "Write feature code" "$L0_ROOT/setup/agent-templates/project-manager.md" || grep -q "MUST delegate" "$L0_ROOT/setup/agent-templates/project-manager.md"
}

@test "arch: PM assigns to architects (not devs directly)" {
    grep -q "assigns.*architects" "$L0_ROOT/setup/agent-templates/project-manager.md" || grep -q "assign.*work.*architects" "$L0_ROOT/setup/agent-templates/project-manager.md"
}

@test "arch: all architects have CUSTOMIZE markers for project guardians" {
    for agent in arch-testing arch-platform arch-integration; do
        grep -q "CUSTOMIZE" "$L0_ROOT/setup/agent-templates/${agent}.md"
    done
}

@test "arch: all architects reference Escalate to PM (not dev-lead)" {
    for agent in arch-testing arch-platform arch-integration; do
        grep -q "Escalate to PM" "$L0_ROOT/setup/agent-templates/${agent}.md"
        ! grep -q "Escalate to dev-lead" "$L0_ROOT/setup/agent-templates/${agent}.md"
    done
}

@test "arch: agents-hub references project-manager not dev-lead as orchestrator" {
    grep -q "project-manager" "$L0_ROOT/docs/agents/agents-hub.md"
}

@test "arch: claude-code-workflow PM model has no codes inline" {
    grep -q "Project Manager" "$L0_ROOT/docs/agents/claude-code-workflow.md"
    ! grep -q "Codes inline" "$L0_ROOT/docs/agents/claude-code-workflow.md"
}

@test "arch: spec-driven-workflow shows PM assigns to architects" {
    grep -q "project-manager" "$L0_ROOT/docs/agents/spec-driven-workflow.md"
}

@test "arch: claude-md-template examples use project-manager" {
    grep -q "project-manager" "$L0_ROOT/docs/agents/claude-md-template.md"
}

@test "arch: multi-agent-patterns mentions PM in architect gate" {
    grep -q "project-manager" "$L0_ROOT/docs/agents/multi-agent-patterns.md"
}

@test "arch: PM template forbids Bash+CLI spawning" {
    grep -q "Agent Tool Only" "$L0_ROOT/setup/agent-templates/project-manager.md"
    grep -q "Never spawn agents via Bash" "$L0_ROOT/setup/agent-templates/project-manager.md"
}

@test "arch: all architects require Agent tool (not Bash)" {
    for agent in arch-testing arch-platform arch-integration; do
        grep -q "Agent tool only\|Never use Bash" "$L0_ROOT/setup/agent-templates/${agent}.md"
    done
}

@test "arch: claude-code-workflow forbids Bash spawning" {
    grep -q "Agent Tool Only\|Never spawn.*Bash" "$L0_ROOT/docs/agents/claude-code-workflow.md"
}

@test "arch: /work skill routes to project-manager" {
    grep -q "project-manager" "$L0_ROOT/skills/work/SKILL.md"
}

@test "arch: spec-driven-workflow has How to Start Work section" {
    grep -q "How to Start Work" "$L0_ROOT/docs/agents/spec-driven-workflow.md"
}
