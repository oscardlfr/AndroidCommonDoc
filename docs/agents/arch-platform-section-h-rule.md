---
category: agents
slug: arch-platform-section-h-rule
scope: arch-platform verdict authoring
sources: [BL-W40-FIND-01, BL-W40-FIND-02]
---

# Section H Authoring Rule (MANDATORY -- BL-W41)

Applies to: arch-platform verdict authoring. Referenced from: setup/agent-templates/arch-platform.md.

## Rule 1 -- Manifest yaml required when versions bump

IF section G modifies any template_version field for ANY agent template, section H MUST include
the literal path .claude/registry/agents.manifest.yaml AND skills/registry.json.
Verdict authoring is blocked if either is absent.

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

1. Does section G bump any template_version? If YES -> both agents.manifest.yaml AND
   skills/registry.json MUST appear in section H as literal paths.
2. Are ALL section H entries literal paths with recognized file extensions?
   If NO -> replace with literal paths before proceeding.

## Canonical 2-step rehash (always required when section G bumps template_version)

  Step 1:  node mcp-server/build/cli/generate-template.js <agent-name> --update-manifest-hash
  Step 2:  bash scripts/sh/rehash-registry.sh --project-root "$(pwd)"

Source: docs/guides/pre-commit-hooks.md lines 115-117.
