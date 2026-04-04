---
name: note
description: "Zero-friction idea capture to project memory."
copilot: false
---

# Note Skill

Zero-friction idea capture to project memory.

## Usage

```
/note <idea or observation>
```

## Steps

1. Parse the note content from `$ARGUMENTS`
2. Save as a project memory using the memory system:
   - Create a file in the project's memory directory
   - Type: `project`
   - Name derived from the note content (kebab-case, max 40 chars)
3. Update MEMORY.md index with a one-line entry
4. Confirm to the user what was saved

## Format

```markdown
---
name: {derived-name}
description: {first sentence of note}
type: project
---

{full note content}

Captured: {date}
```

## Notes

- This is lightweight — no agent spawned, just direct file write
- Notes persist across sessions via the memory system
- Use `/brainstorm` for ideas that need classification and routing
- Use `/note` for raw capture that you'll process later
