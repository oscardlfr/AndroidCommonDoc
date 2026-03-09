---
mode: agent
description: "Configure a project to consume AndroidCommonDoc: install toolkit, create l0-manifest.json, sync skills, wire Detekt, and verify."
tools:
  - run_terminal_command
  - create_file
  - read_file
  - insert_edit_into_file
---

Configure this project to consume AndroidCommonDoc following the setup skill.

Steps:
1. Verify ANDROID_COMMON_DOC is set; if not, stop and instruct the user.
2. Run `bash "$ANDROID_COMMON_DOC/setup/setup-toolkit.sh" --project-root {{projectRoot}} --mode warn`.
3. Create or validate `l0-manifest.json` using the L2 template (or L1 if specified).
4. Run the L0 sync CLI: `cd "$ANDROID_COMMON_DOC/mcp-server" && npx tsx src/sync/sync-l0-cli.ts --project-root {{projectRoot}}`.
5. Run the verification checklist and print a summary table.

Parameters:
- `{{projectRoot}}` — path to the project root (default: workspace root)
- `{{layer}}` — L1 or L2 (default: L2)
- `{{mode}}` — warn or block (default: warn)

See full skill: `skills/setup/SKILL.md` in AndroidCommonDoc.
See full guide: `docs/guides/getting-started.md` in AndroidCommonDoc.
