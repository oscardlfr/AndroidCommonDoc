<!-- L0 Generic Command -->
<!-- Usage: /brainstorm <raw text with ideas> -->
# /brainstorm - Parse, Classify, and Route Ideas to Docs

Process raw brainstorm input, classify each idea, route to the correct documentation file, and write after user approval.

## Usage
```
/brainstorm <raw text with ideas separated by line breaks>
```

## Arguments
- Raw text pasted directly. Ideas separated by line breaks. Translate non-English ideas to English for docs.

## Examples
```
/brainstorm Add offline sync feature
Lower free tier limits
Need GDPR plan for cloud phase
The pricing page needs a comparison table
```

## Instructions

You are a brainstorm router. The user has dumped raw, chaotic ideas. Follow these steps EXACTLY.

### Step 1 -- Parse Ideas

Split the input (`$ARGUMENTS`) by line breaks. Group related consecutive lines into single ideas. Discard lines too vague to act on.

Produce a numbered list of distinct ideas with a short summary for each.

### Step 2 -- Read Current Docs

Read project documentation to understand existing content, sections, and numbering. Typical files include:
- Product specification (features and numbering)
- Business/strategy docs (pricing, costs)
- Risk/compliance docs
- Technology reference docs
- Feature inventory (status matrix)
- Architecture docs (patterns, constraints)
- `CLAUDE.md` (architecture layers, module rules)

Skip any that don't exist.

### Step 3 -- Classify, Validate, and Route

For each idea, determine:

| Field | Description |
|-------|-------------|
| **Idea** | Short English summary |
| **Target** | Which doc file it belongs to |
| **Section** | Which section within that doc |
| **Type** | `NEW` / `REFINEMENT` / `BUSINESS` / `TECH` |
| **Duplicate?** | Check if idea already exists in the target doc |
| **Feasibility** | OK / WARN / BLOCK |

**Technical validation (mandatory for NEW and REFINEMENT ideas):**
1. Architecture fit (layer boundaries, SSOT, separation of concerns)
2. SOLID compliance (single responsibility, contracts/interfaces)
3. Pattern consistency (Result<T>, sealed UiState, feature gates)
4. Constraint respect (platform boundaries, processing modes)
5. Dependency feasibility (does it depend on unbuilt infrastructure?)
6. Better alternative (propose cleaner approaches when applicable)

**Routing rules:**
- Feature ideas -> product spec
- Business/pricing/strategy -> business docs
- Risk/compliance -> risk docs
- Tech stack/tooling -> technology docs
- If no fit -> propose new subsection or flag for discussion

### Step 4 -- Present for Approval

Display routing table. Ask: "Approve all? Or reply with numbers to adjust/remove."

**DO NOT proceed to Step 5 until the user approves.**

### Step 5 -- Write to Docs (after approval only)

Write approved ideas to their target documents following existing formatting.

### Step 6 -- Commit

```
docs(brainstorm): add N ideas from brainstorm session
```

### Important Rules

1. **Always translate** non-English ideas to English
2. **Preserve numbering** in target docs
3. **Never change existing statuses**
4. **Duplicate detection** mandatory
5. **Approval gate is mandatory**
6. **Idempotent** -- running twice detects duplicates

### After Brainstorm

Suggest: "Ideas captured! Run `/prioritize --from-brainstorm` to route these ideas into the roadmap."
