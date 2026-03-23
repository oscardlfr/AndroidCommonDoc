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

L0_ROOT="$BATS_TEST_DIRNAME/../.."
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

@test "parity: Get-KoverTaskFallbacks exists in PS1" {
    grep -q "function Get-KoverTaskFallbacks" "$PS1_LIB"
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

@test "parity: PS1 run-parallel has kover fallback retry (Get-KoverTaskFallbacks)" {
    grep -q "Get-KoverTaskFallbacks" "$PS1_DIR/run-parallel-coverage-suite.ps1"
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
    sed -n '/What gets synced/,/^### /p' "$README" | grep -q "40"
    sed -n '/What gets synced/,/^### /p' "$README" | grep -q "27"
}

@test "README: 'What gets synced' clarifies what is NOT synced" {
    sed -n '/What gets synced/,/^### /p' "$README" | grep -qi "not synced"
}

@test "README: docs count is 55 sub-docs" {
    grep -q "55 sub-docs" "$README"
}

@test "README: vitest count is 1164" {
    grep -q "1164 tests" "$README"
}

@test "README: vitest files count is 85" {
    grep -q "85 test files" "$README"
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
