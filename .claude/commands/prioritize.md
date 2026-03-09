<!-- L0 Generic Command -->
<!-- Usage: /prioritize [ideas or --from-brainstorm] -->
# /prioritize - Route Brainstorm Ideas to Roadmap

Analyze new ideas (from last `/brainstorm` session or user input), classify by priority tier, route to existing or new roadmap phases, and update ROADMAP.md after approval.

## Usage
```
/prioritize [ideas or --from-brainstorm]
```

## Arguments
- Raw text with ideas separated by line breaks
- `--from-brainstorm` -- auto-detect ideas from the last brainstorm commit

## Instructions

### Step 1 -- Detect New Ideas

**If `--from-brainstorm`:** Find the last brainstorm commit and extract newly added ideas.
**If raw text:** Parse by line breaks into distinct ideas.

### Step 2 -- Read Context

Read roadmap, product spec, feature inventory, business docs, and architecture docs to understand current state and constraints.

### Step 3 -- Classify Each Idea

| Field | Description |
|-------|-------------|
| **Priority** | P0 (Beta blocker) / P1 (v1.0) / P2 (Growth) / P3 (Future) |
| **Phase** | Existing phase or propose new one |
| **Effort** | Small (1-2 plans) / Medium (3-5) / Large (6+) |
| **Feasibility** | OK / WARN / BLOCK |
| **Dependencies** | Other phases/features this depends on |

**Technical validation is mandatory.** Check architecture fit, SOLID compliance, pattern consistency, constraint respect, and infrastructure dependencies.

### Step 4 -- Present for Approval

Display prioritization table. **DO NOT proceed until user approves.**

### Step 5 -- Update ROADMAP.md (after approval)

Route approved ideas to existing or new phases. Add priority metadata.

### Step 6 -- Commit

```
docs(roadmap): prioritize N ideas from brainstorm session
```

### Important Rules

1. **Never change existing plan statuses**
2. **Preserve phase numbering**
3. **Approval gate is mandatory**
4. **Conservative priority** -- prefer P2 over P1 when uncertain
5. **Dependency-aware** -- ideas needing unbuilt infrastructure cannot be P0
