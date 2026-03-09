# Adapters

Adapters read canonical `skills/*/SKILL.md` definitions and `skills/params.json`, then generate tool-specific files for each AI development tool.

## How It Works

```
skills/*/SKILL.md  ─┐
                     ├──> adapter ──> tool-specific output files
skills/params.json ─┘
```

Each adapter is an independent Bash script. Adding a new AI tool requires only creating a new adapter file -- no existing adapters or generated files need modification (open/closed principle).

## Available Adapters

| Adapter | Output Location | Format |
|---------|----------------|--------|
| `claude-adapter.sh` | `.claude/commands/*.md` | Claude Code slash commands |
| `copilot-adapter.sh` | `setup/copilot-templates/*.prompt.md` | GitHub Copilot agent prompts |

## Running

Generate all outputs at once:

```bash
bash adapters/generate-all.sh
```

Or run a single adapter:

```bash
bash adapters/claude-adapter.sh
bash adapters/copilot-adapter.sh
```

## Adding a New Adapter

1. **Copy** an existing adapter (e.g., `claude-adapter.sh`) as a starting point.
2. **Modify** the output format to match the target tool's requirements:
   - Change the output directory and file extension.
   - Adjust the template structure for the target tool's syntax.
   - Map parameters using the appropriate `mapping` key from `params.json`.
3. **Add** a call to your adapter in `generate-all.sh`.
4. **Test** by running your adapter and verifying the output.

### Key points

- Each adapter reads the same inputs: `skills/*/SKILL.md` frontmatter + sections, and `skills/params.json` for parameter definitions.
- Parameter mappings in `params.json` include tool-specific syntax under `mapping` (e.g., `mapping.ps1`, `mapping.sh`, `mapping.copilot`). Add a new key for your tool if needed.
- Generated files must include a `<!-- GENERATED ... DO NOT EDIT MANUALLY -->` header.
- Adapters must be idempotent -- running twice produces identical output.

## File Structure

```
adapters/
  claude-adapter.sh      # Generates Claude Code commands
  copilot-adapter.sh     # Generates GitHub Copilot prompts
  generate-all.sh        # Runs all adapters
  README.md              # This file
skills/
  params.json            # Parameter definitions (single source of truth)
  test/SKILL.md          # Canonical skill definition
  coverage/SKILL.md      # ...
  ...
```
