---
scope: L0
category: agents
slug: dual-location-protocol
sources: ["arch-platform-verdict-wave-b", "BL-bump-ktr-03"]
targets: [arch-platform, arch-testing, arch-integration]
version: 0.1.0
description: "SOURCE->COPY sync, manifest-first versioning, Write-tool-only MIGRATIONS.json."
---

# Dual-Location Protocol

SOURCE: setup/agent-templates/<name>.md
COPY:   .claude/agents/<name>.md

## Sync Steps (MANDATORY ORDER)
1. Edit SOURCE only -- never COPY directly
2. Bump manifest FIRST: update template_version in .claude/registry/agents.manifest.yaml
   (memory: feedback_template_version_manifest_first)
3. Copy: cp setup/agent-templates/<name>.md .claude/agents/<name>.md
4. Rehash: node mcp-server/build/cli/generate-template.js <name> --update-manifest-hash
   (NOT generate-registry.js -- memory: feedback_registry_rehash_template_aware)
5. MIGRATIONS.json (if breaking): Write/python3 ONLY, NEVER Edit on Windows
   (curly-quote autocorrect -- memory: feedback_migrations_json_encoding)

## MIGRATIONS.json Entry Shape
Insert under templates.arch-platform in setup/agent-templates/MIGRATIONS.json:
```json
{
  "version": "1.28.0",
  "date": "YYYY-MM-DD",
  "breaking": false,
  "description": "...",
  "migration": "No action required -- additive only"
}
```
