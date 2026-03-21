#!/usr/bin/env bats
# =============================================================================
# Tests for auto-sync infrastructure:
#  - l0-sync-dispatch.yml structure and triggers
#  - l0-auto-sync.yml (downstream template) structure and triggers
#  - downstream-repos.json format
#  - Setup wizard W5 integration (auto-sync template is offered)
#  - Manifest commit tracking (l0Commit field)
# =============================================================================

L0_ROOT="$BATS_TEST_DIRNAME/../.."
DISPATCH_WF="$L0_ROOT/.github/workflows/l0-sync-dispatch.yml"
AUTO_SYNC_WF="$L0_ROOT/setup/templates/workflows/l0-auto-sync.yml"
DOWNSTREAM_JSON="$L0_ROOT/.github/downstream-repos.json"
SETUP_SKILL="$L0_ROOT/skills/setup/SKILL.md"

setup() {
    WORK_DIR=$(mktemp -d)
}

teardown() {
    rm -rf "$WORK_DIR"
}

# ===========================================================================
# l0-sync-dispatch.yml — L0 outbound workflow
# ===========================================================================

@test "dispatch: workflow file exists" {
    [ -f "$DISPATCH_WF" ]
}

@test "dispatch: triggers on push to master" {
    grep -q "push:" "$DISPATCH_WF"
    grep -q "branches:.*master" "$DISPATCH_WF"
}

@test "dispatch: has path filters for relevant directories" {
    grep -q "skills/\*\*" "$DISPATCH_WF"
    grep -q "agents/\*\*" "$DISPATCH_WF"
    grep -q "scripts/\*\*" "$DISPATCH_WF"
    grep -q "docs/\*\*" "$DISPATCH_WF"
    grep -q "detekt-rules/\*\*" "$DISPATCH_WF"
    grep -q "mcp-server/src/\*\*" "$DISPATCH_WF"
}

@test "dispatch: filters versions-manifest.json changes" {
    grep -q "versions-manifest.json" "$DISPATCH_WF"
}

@test "dispatch: filters .claude/commands changes" {
    grep -q "\.claude/commands/\*\*" "$DISPATCH_WF"
}

@test "dispatch: reads downstream-repos.json" {
    grep -q "downstream-repos.json" "$DISPATCH_WF"
}

@test "dispatch: sends repository_dispatch with l0-sync event type" {
    grep -q "event_type=l0-sync" "$DISPATCH_WF"
}

@test "dispatch: includes l0_commit in payload" {
    grep -q "l0_commit" "$DISPATCH_WF"
}

@test "dispatch: includes source_layer in payload" {
    grep -q "source_layer" "$DISPATCH_WF"
}

@test "dispatch: uses DOWNSTREAM_SYNC_TOKEN secret" {
    grep -q "DOWNSTREAM_SYNC_TOKEN" "$DISPATCH_WF"
}

@test "dispatch: has concurrency group" {
    grep -q "concurrency:" "$DISPATCH_WF"
    grep -q "cancel-in-progress: true" "$DISPATCH_WF"
}

# ===========================================================================
# downstream-repos.json — target list
# ===========================================================================

@test "downstream-repos.json: file exists" {
    [ -f "$DOWNSTREAM_JSON" ]
}

@test "downstream-repos.json: is valid JSON array" {
    # Use cat piped to node to avoid MSYS path mangling
    cat "$DOWNSTREAM_JSON" | node -e "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{if(!Array.isArray(JSON.parse(d)))process.exit(1)})"
}

@test "downstream-repos.json: contains at least one repo" {
    COUNT=$(cat "$DOWNSTREAM_JSON" | node -e "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>console.log(JSON.parse(d).length))")
    [ "$COUNT" -ge 1 ]
}

@test "downstream-repos.json: entries are owner/repo format" {
    cat "$DOWNSTREAM_JSON" | node -e "
      let d=''; process.stdin.on('data',c=>d+=c);
      process.stdin.on('end',()=>{
        JSON.parse(d).forEach(r=>{if(!/^[^/]+\/[^/]+$/.test(r))process.exit(1)});
      });
    "
}

# ===========================================================================
# l0-auto-sync.yml — downstream template
# ===========================================================================

@test "auto-sync template: file exists" {
    [ -f "$AUTO_SYNC_WF" ]
}

@test "auto-sync template: triggers on repository_dispatch l0-sync" {
    grep -q "repository_dispatch:" "$AUTO_SYNC_WF"
    grep -q "l0-sync" "$AUTO_SYNC_WF"
}

@test "auto-sync template: triggers on repository_dispatch l1-sync" {
    grep -q "l1-sync" "$AUTO_SYNC_WF"
}

@test "auto-sync template: has schedule cron trigger" {
    grep -q "schedule:" "$AUTO_SYNC_WF"
    grep -q "cron:" "$AUTO_SYNC_WF"
}

@test "auto-sync template: has manual workflow_dispatch trigger" {
    grep -q "workflow_dispatch:" "$AUTO_SYNC_WF"
}

@test "auto-sync template: force input available in workflow_dispatch" {
    grep -q "force:" "$AUTO_SYNC_WF"
}

@test "auto-sync template: reads l0-manifest.json" {
    grep -q "l0-manifest.json" "$AUTO_SYNC_WF"
}

@test "auto-sync template: extracts topology from manifest" {
    grep -q "topology" "$AUTO_SYNC_WF"
}

@test "auto-sync template: compares commits for skip detection" {
    grep -q "l0Commit\|l0_commit\|LAST_COMMIT\|UPSTREAM_HEAD" "$AUTO_SYNC_WF"
}

@test "auto-sync template: dispatch always triggers sync (no skip)" {
    grep -q "repository_dispatch" "$AUTO_SYNC_WF"
    grep -q 'needed=true' "$AUTO_SYNC_WF"
}

@test "auto-sync template: runs sync-l0 CLI" {
    grep -q "sync-l0-cli" "$AUTO_SYNC_WF"
}

@test "auto-sync template: creates PR with changes" {
    grep -q "gh pr create" "$AUTO_SYNC_WF"
}

@test "auto-sync template: updates existing PR if branch exists" {
    grep -q "gh pr list" "$AUTO_SYNC_WF"
}

@test "auto-sync template: PR branch is auto-sync/l0-update" {
    grep -q "auto-sync/l0-update" "$AUTO_SYNC_WF"
}

@test "auto-sync template: has cascade dispatch for chain topology" {
    grep -q "Cascade dispatch" "$AUTO_SYNC_WF"
    grep -q "downstream-repos.json" "$AUTO_SYNC_WF"
}

@test "auto-sync template: cascade comment explains chain delay" {
    grep -q "auto-merge\|merged" "$AUTO_SYNC_WF"
}

@test "auto-sync template: has job summary step" {
    grep -q "GITHUB_STEP_SUMMARY" "$AUTO_SYNC_WF"
}

@test "auto-sync template: has concurrency group" {
    grep -q "concurrency:" "$AUTO_SYNC_WF"
}

@test "auto-sync template: clones upstream via source paths" {
    grep -q "git clone" "$AUTO_SYNC_WF"
}

@test "auto-sync template: uses Node.js 20" {
    grep -q "node-version.*20" "$AUTO_SYNC_WF"
}

@test "auto-sync template: builds sync CLI from L0 mcp-server" {
    grep -q "npm ci\|npm run build" "$AUTO_SYNC_WF"
}

@test "auto-sync template: handles v1 manifest fallback" {
    grep -q "l0_source" "$AUTO_SYNC_WF"
}

@test "auto-sync template: skips if no l0-manifest.json" {
    grep -q "No l0-manifest.json" "$AUTO_SYNC_WF"
}

# ===========================================================================
# Setup wizard W5 — offers auto-sync template
# ===========================================================================

@test "setup skill: W5 mentions l0-auto-sync.yml" {
    grep -q "l0-auto-sync" "$SETUP_SKILL"
}

@test "setup skill: W5 copies from setup/templates/workflows/" {
    grep -q "setup/templates/workflows/l0-auto-sync.yml" "$SETUP_SKILL"
}

@test "setup skill: verification checklist includes auto-sync" {
    grep -q "l0-auto-sync.yml exists" "$SETUP_SKILL"
}

@test "setup skill: final summary includes auto-sync row" {
    grep -q "Auto-sync" "$SETUP_SKILL"
}

@test "setup skill: Step 6 mentions auto-sync" {
    grep -q "auto-sync" "$SETUP_SKILL"
}

# ===========================================================================
# Layer topology doc — auto-sync section
# ===========================================================================

@test "layer-topology doc: has auto-sync section" {
    grep -q "## Auto-Sync" "$L0_ROOT/docs/architecture/layer-topology.md"
}

@test "layer-topology doc: describes dispatch mechanism" {
    grep -q "dispatch\|repository_dispatch" "$L0_ROOT/docs/architecture/layer-topology.md"
}

@test "layer-topology doc: describes cron safety net" {
    grep -q "cron\|scheduled\|safety net" "$L0_ROOT/docs/architecture/layer-topology.md"
}

@test "layer-topology doc: cross-references dispatch workflow" {
    grep -q "l0-sync-dispatch.yml" "$L0_ROOT/docs/architecture/layer-topology.md"
}

@test "layer-topology doc: cross-references auto-sync template" {
    grep -q "l0-auto-sync.yml" "$L0_ROOT/docs/architecture/layer-topology.md"
}

# ===========================================================================
# README — Updating section
# ===========================================================================

@test "README: Updating section describes automatic sync" {
    grep -q "Automatic\|automatically\|auto-sync" "$L0_ROOT/README.md"
}

@test "README: Updating section describes dispatch flow" {
    grep -q "dispatch" "$L0_ROOT/README.md"
}

@test "README: Updating section describes cron safety net" {
    grep -q "cron\|safety net\|daily" "$L0_ROOT/README.md"
}

@test "README: Updating section still has manual path" {
    grep -q "Manual" "$L0_ROOT/README.md"
    grep -q "sync-l0" "$L0_ROOT/README.md"
}

@test "README: mentions l0-sync-dispatch.yml in directory tree" {
    grep -q "l0-sync-dispatch.yml" "$L0_ROOT/README.md"
}

@test "README: mentions l0-auto-sync.yml in directory tree" {
    grep -q "l0-auto-sync.yml" "$L0_ROOT/README.md"
}

@test "README: links to layer-topology.md from Updating section" {
    grep -q "layer-topology.md" "$L0_ROOT/README.md"
}

# ===========================================================================
# Sync engine — commit tracking (l0Commit)
# ===========================================================================

@test "sync-engine: getGitCommit function exists" {
    grep -q "function getGitCommit" "$L0_ROOT/mcp-server/src/sync/sync-engine.ts"
}

@test "sync-engine: syncL0 report includes l0Commit" {
    grep -q "l0Commit" "$L0_ROOT/mcp-server/src/sync/sync-engine.ts"
}

@test "sync-engine: syncMultiSource report includes l0Commit" {
    grep -q "l0Commit.*getGitCommit" "$L0_ROOT/mcp-server/src/sync/sync-engine.ts"
}

# ===========================================================================
# Functional: downstream-repos.json round-trip
# ===========================================================================

@test "functional: dispatch workflow can parse downstream-repos.json" {
    # Verify the JSON file is parseable and has valid entries
    FIRST=$(cat "$DOWNSTREAM_JSON" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d)[0]))")
    echo "$FIRST" | grep -q "/"
}

@test "functional: auto-sync parses flat manifest" {
    cat > "$WORK_DIR/l0-manifest.json" << 'EOF'
{
  "version": 2,
  "sources": [
    { "layer": "L0", "path": "../AndroidCommonDoc", "role": "tooling" }
  ],
  "topology": "flat",
  "last_synced": "2026-03-21T00:00:00Z",
  "selection": { "mode": "include-all", "exclude_skills": [], "exclude_agents": [], "exclude_commands": [], "exclude_categories": [] },
  "checksums": {},
  "l2_specific": { "commands": [], "agents": [], "skills": [] }
}
EOF
    TOPOLOGY=$(cat "$WORK_DIR/l0-manifest.json" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).topology||'flat'))")
    [ "$TOPOLOGY" = "flat" ]
    SOURCES=$(cat "$WORK_DIR/l0-manifest.json" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.stringify((JSON.parse(d).sources||[]).map(s=>s.path))))")
    echo "$SOURCES" | grep -q "AndroidCommonDoc"
}

@test "functional: auto-sync parses chain manifest" {
    cat > "$WORK_DIR/l0-manifest.json" << 'EOF'
{
  "version": 2,
  "sources": [
    { "layer": "L0", "path": "../../AndroidCommonDoc", "role": "tooling" },
    { "layer": "L1", "path": "../../shared-kmp-libs", "role": "ecosystem" }
  ],
  "topology": "chain",
  "last_synced": "2026-03-21T00:00:00Z",
  "selection": { "mode": "include-all", "exclude_skills": [], "exclude_agents": [], "exclude_commands": [], "exclude_categories": [] },
  "checksums": {},
  "l2_specific": { "commands": [], "agents": [], "skills": [] }
}
EOF
    SOURCES=$(cat "$WORK_DIR/l0-manifest.json" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.stringify((JSON.parse(d).sources||[]).map(s=>s.path))))")
    echo "$SOURCES" | grep -q "AndroidCommonDoc"
    echo "$SOURCES" | grep -q "shared-kmp-libs"
}

@test "functional: auto-sync handles v1 manifest fallback" {
    cat > "$WORK_DIR/l0-manifest.json" << 'EOF'
{
  "version": 1,
  "l0_source": "../AndroidCommonDoc",
  "last_synced": "2026-03-21T00:00:00Z",
  "selection": { "mode": "include-all", "exclude_skills": [], "exclude_agents": [], "exclude_commands": [], "exclude_categories": [] },
  "checksums": {},
  "l2_specific": { "commands": [], "agents": [], "skills": [] }
}
EOF
    SOURCES=$(cat "$WORK_DIR/l0-manifest.json" | node -e "
      let d='';process.stdin.on('data',c=>d+=c);
      process.stdin.on('end',()=>{
        const m=JSON.parse(d);
        const paths=(m.sources||[]).map(s=>s.path);
        if(paths.length===0 && m.l0_source) paths.push(m.l0_source);
        console.log(JSON.stringify(paths));
      });
    ")
    echo "$SOURCES" | grep -q "AndroidCommonDoc"
}
