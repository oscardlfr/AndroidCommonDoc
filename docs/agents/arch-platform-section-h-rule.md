---
category: agents
slug: arch-platform-section-h-rule
scope: arch-platform verdict authoring
sources: [BL-W40-FIND-01, BL-W40-FIND-02]
targets: [setup/agent-templates/arch-platform.md, .claude/agents/arch-platform.md]
---

# Section H Authoring Rule (MANDATORY -- BL-W41)

Applies to: arch-platform verdict authoring. Referenced from: setup/agent-templates/arch-platform.md.

## Rule 1 -- Manifest yaml required when versions bump

IF section G modifies any template_version field for ANY agent template, section H MUST include
ALL FOUR of the following literal paths. Verdict authoring is blocked if any is absent:

  .claude/registry/agents.manifest.yaml
  skills/registry.json
  setup/agent-templates/MIGRATIONS.json
  setup/agent-templates/<agent-name>.md   (the bumped template itself)

**MIGRATIONS.json** records the breaking-change migration entry for consumers inheriting the
new template version. It is required even when the bump is non-breaking — the entry documents
the version increment so consumers can audit their sync history.

## Rule 2 -- Literal paths only

Every entry in section H MUST be a literal filesystem path ending in a recognized extension
(.md, .yaml, .js, .ts, .kt, .sh, .bats). Placeholders, indirections, and descriptive labels
are FORBIDDEN. doc-updater must be able to pass section H lines directly to git add without
any interpretation.

## Anti-pattern (BL-W40 PR4 violation -- line 124)

  PLACEHOLDER: <registry manifest -- path from rehash-registry.sh>   <- FORBIDDEN

Correct form:
  .claude/registry/agents.manifest.yaml
  skills/registry.json

## Self-check before writing verdict heredoc

1. Does section G bump any template_version? If YES -> ALL FOUR paths (agents.manifest.yaml,
   skills/registry.json, MIGRATIONS.json, and the template .md) MUST appear in section H
   as literal paths.
2. Is there a MIGRATIONS.json entry drafted for each bumped template_version?
   If NO -> draft the entry before emitting APPROVED-PREP.
3. Are ALL section H entries literal paths with recognized file extensions?
   If NO -> replace with literal paths before proceeding.

## Canonical 5-pata ceremony (always required when section G bumps template_version)

Execute in this exact order. Each step produces its own commit:

  Pata 1 (MIGRATIONS.json):  Add migration entry for the new version in
                              setup/agent-templates/MIGRATIONS.json BEFORE generate-template.
  Pata 2 (generate-template): node mcp-server/build/cli/generate-template.js <agent-name>
                               --update-manifest-hash
  Pata 3 (registry):          bash scripts/sh/rehash-registry.sh --project-root "$(pwd)"
                               → produces skills/registry.json update
  Pata 4 (manifest):          Verify .claude/registry/agents.manifest.yaml sha256 updated.
  Pata 5 (snapshot repin):    Re-pin vitest snapshots if generate output changed hint text.

Source: docs/guides/pre-commit-hooks.md lines 115-117.
