# M005 Context

## What This Milestone Is

Ecosystem-wide coherence, token optimization, and capability enhancement across the full L0→L1→L2 stack.

**L0 (AndroidCommonDoc):** Pattern toolkit — 59 docs across 13 subdirs, 0 hub docs, 11 agents, 29+ skills, MCP server.
**L1 (shared-kmp-libs):** KMP library suite — 37 docs across 9 subdirs, 0 hub docs, 1 agent.
**L2a (DawSync):** Application — 190 docs (152 active + 38 archive), already has most hub docs (5/8 subdirs covered), 16 agents, 22 commands.
**L2b (DawSyncWeb):** Astro subproject — has `.claude/` with commands and skills but no l0-manifest.json or CLAUDE.md.

## Key Facts from Audit

### Hub Doc Status
- L0: 0/13 subdirs have hub docs (ALL missing)
- L1: 0/9 subdirs have hub docs (ALL missing; `guides-index.md` exists but isn't named `guides-hub.md`)
- L2a: 5/8 subdirs have hub docs (archive, images missing; `architecture-hub.md` ✓)
- L2b: 1 docs subdir (`legal/`) — no hub needed, trivial

### .planning/ References (must be .gsd/)
- L0 commands: doc-check.md, merge-track.md, sync-roadmap.md
- L2a commands: doc-check.md, merge-track.md, roadmap.md, start-track.md, sync-roadmap.md

### Token Redundancy
- L0: skills inline scripts, CLAUDE.md duplicates docs content
- L0 archive: 2 docs > 300 lines (338 + 346 lines)
- All layers: sub-docs repeat hub intro content

### monitor_urls Coverage (L0)
- 26/59 docs have monitor_urls (44% coverage) — target >85%
- L1 and L2: 0/37 and unknown — not yet scanned with correct field name

### detekt_rules Coverage (L0)
- 0/59 docs have `detekt_rules` frontmatter field (target >15)
- Note: The field may be named differently — check existing pattern

### Capability Detection
- No agent in any layer has optional capability detection for Context7/Jina
- l0-coherence-auditor agent: does not exist yet
- audit-l0 skill: does not exist yet

### MCP Resources
- Only `docs://` scheme exists
- No `gsd://` scheme for project state

### DawSync Architecture
- docs/architecture: 8 files at root + `diagrams/` subdir with 11 files = NOT 66 flat files
- Sub-subdirs exist: A-system-global, B-vst3-m4l, C-domain-repositories, D-domain-usecases, E-data-datasources
- Hub `architecture-hub.md` already exists at root level ✓

## Constraints
- Breaking changes OK — no downstream consuming currently
- Hub: <100 lines, sub-doc: <300 lines, absolute max: 500
- No console.log in MCP server — use logger (stderr)
- Context7/Jina: OPTIONAL — never required
- Agents: read-only by design (Read, Grep, Glob)
- Script parity: any new script needs both PS1 and SH versions
- L2-specific files in l0-manifest.json are NEVER touched by sync-l0
- DawSyncWeb is a subproject — no separate repo treatment needed

## Milestones Already Completed
- M001: MVP
- M002: Hardening & Intelligence
- M003: Phase Details
- M004: Documentation Coherence & Context Management (v1.2)

## Why This Milestone Matters
L0 ships patterns that L1 and L2 follow — but L0 itself violates those patterns. This is a credibility and efficiency problem. The hub doc system was built in M004 but never applied to L0's own docs. The auditor doesn't exist yet. Token waste is compounding across 280+ docs ecosystem-wide.
