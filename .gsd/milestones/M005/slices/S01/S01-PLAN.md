# S01: Audit Infrastructure & Baseline

**Goal:** Build the l0-coherence-auditor agent and audit-l0 skill from scratch; extend the MCP registry types with new frontmatter fields; capture numeric baseline reports for all three layers.
**Demo:** Running `/audit-l0` against `../AndroidCommonDoc` produces a JSON baseline report listing hub-doc coverage, monitor_urls coverage, .planning/ violations, line-limit violations, and token counts per layer. The auditor agent file exists and can be referenced by name.

## Must-Haves

- `.claude/agents/l0-coherence-auditor.md` — read-only agent that audits any layer path
- `skills/audit-l0/SKILL.md` — skill that runs the auditor against a target root
- `mcp-server/src/registry/types.ts` updated with `assumes_read`, `token_budget`, `optional_capabilities` fields
- MCP `validate-doc-structure` logic (or new tool) updated to check new fields
- Baseline reports saved: `.gsd/audits/baseline-L0.json`, `baseline-L1.json`, `baseline-L2a.json`
- npm test still passing after types.ts changes

## Verification

- `test "l0-coherence-auditor.md exists and has read-only tools"`: `grep -E "Read|Glob|Grep" .claude/agents/l0-coherence-auditor.md`
- `test "audit-l0 SKILL.md exists"`: `test -f skills/audit-l0/SKILL.md`
- `test "types.ts has new fields"`: `grep -E "assumes_read|token_budget|optional_capabilities" mcp-server/src/registry/types.ts`
- `cd mcp-server && npm test` — all tests pass
- `test "baseline files exist"`: `ls .gsd/audits/baseline-L*.json`

## Tasks

- [ ] **T01: Define l0-coherence-auditor agent** `est:45m`
  - Why: The auditor is the foundation for all compliance checking — without it nothing can be validated.
  - Files: `.claude/agents/l0-coherence-auditor.md`
  - Do: Create the agent with system prompt covering all check categories: (1) hub doc presence per subdir, (2) doc line limits (hub ≤100, sub-doc ≤300), (3) frontmatter completeness (scope, sources, targets, monitor_urls, layer, category, status, assumes_read, token_budget), (4) .planning/ reference detection in commands, (5) archive metadata validity (status should be 'archived' not 'active'), (6) token budget compliance. Agent must be read-only — allowed tools: Read, Glob, Grep. Output must be structured JSON: `{"layer":"L0","violations":[],"coverage":{"hub_docs":{"total":13,"present":0},"monitor_urls":{"total":59,"present":26}},"token_counts":{}}`. Agent description must say "Audits L0/L1/L2 docs for coherence, hub structure, frontmatter completeness, and token efficiency."
  - Verify: `grep "Read\|Glob\|Grep" .claude/agents/l0-coherence-auditor.md && grep "violations" .claude/agents/l0-coherence-auditor.md`
  - Done when: Agent file exists, has read-only tools listed, and defines the JSON output schema.

- [ ] **T02: Create audit-l0 skill** `est:30m`
  - Why: A skill gives a quick `/audit-l0` entry point without manually invoking the agent; it also parameterizes the target layer path.
  - Files: `skills/audit-l0/SKILL.md`
  - Do: Create skill with: `name: audit-l0`, `description: Run coherence audit on any L0/L1/L2 layer root`, `parameters: [{name: target_root, description: Absolute path to the layer root to audit, default: . (current project)}]`. Skill body: instruct agent to use l0-coherence-auditor, scan the target_root, save report to `{target_root}/.gsd/audits/audit-{timestamp}.json`, print human-readable summary with violation count by category and coverage percentages. Reference the agent by name: "Use the l0-coherence-auditor agent." Do NOT inline the audit logic in the skill — delegate to the agent.
  - Verify: `grep "l0-coherence-auditor" skills/audit-l0/SKILL.md && grep "target_root" skills/audit-l0/SKILL.md`
  - Done when: SKILL.md exists, references the agent by name, defines target_root parameter with default.

- [ ] **T03: Extend PatternMetadata types with new fields** `est:30m`
  - Why: The scanner must recognize and pass through `assumes_read`, `token_budget`, and `optional_capabilities` fields so MCP tooling can validate them.
  - Files: `mcp-server/src/registry/types.ts`, `mcp-server/src/registry/frontmatter.ts` (if exists), `mcp-server/src/registry/scanner.ts`
  - Do: Add to `PatternMetadata` interface: `assumes_read?: string` (slug of hub doc this doc assumes was read), `token_budget?: number` (target token count for this doc), `optional_capabilities?: string[]` (for agent files — e.g. ["context7", "jina"]). Update `scanner.ts` to pass these fields through when parsing frontmatter. Do NOT add required validation — these are optional fields. Run `tsc --noEmit` to confirm no type errors.
  - Verify: `grep -E "assumes_read|token_budget|optional_capabilities" mcp-server/src/registry/types.ts`
  - Done when: All three fields present in PatternMetadata, TypeScript compiles clean.

- [ ] **T04: Run audit baseline and save reports** `est:20m`
  - Why: Without a numeric baseline, we can't measure the token reduction claimed in later slices.
  - Files: `.gsd/audits/baseline-L0.json`, `.gsd/audits/baseline-L1.json`, `.gsd/audits/baseline-L2a.json`
  - Do: Create `.gsd/audits/` directory. For each layer, manually run the audit checks (using bash) and produce a baseline JSON: hub_doc_coverage (count present/total per layer), monitor_urls_coverage (grep count), line_limit_violations (files >300 lines), planning_refs (grep count), total_doc_count, total_line_count, total_char_count (proxy for tokens: chars/4). Save as `baseline-L0.json`, `baseline-L1.json`, `baseline-L2a.json`. Example structure: `{"captured_at":"2026-03-17","layer":"L0","hub_docs":{"present":0,"total":13},"monitor_urls":{"present":26,"total":59},"line_limit_violations":2,"planning_ref_violations":3,"total_docs":59,"total_chars":XXXXX,"estimated_tokens":XXXXX}`.
  - Verify: `cat .gsd/audits/baseline-L0.json | python3 -c "import json,sys; d=json.load(sys.stdin); assert 'hub_docs' in d"`
  - Done when: All three baseline files exist and contain valid JSON with hub_docs, monitor_urls, and estimated_tokens fields.

- [ ] **T05: Verify MCP npm test still passes** `est:10m`
  - Why: T03 changes types.ts — must confirm no downstream TypeScript errors.
  - Files: `mcp-server/`
  - Do: `cd mcp-server && npm test`. If any test fails due to T03 changes (new optional fields shouldn't break anything), fix the test. Do not change test intent — only fix type mismatches.
  - Verify: `cd mcp-server && npm test` exits 0.
  - Done when: All MCP tests pass.

## Files Likely Touched

- `.claude/agents/l0-coherence-auditor.md` (new)
- `skills/audit-l0/SKILL.md` (new)
- `mcp-server/src/registry/types.ts`
- `mcp-server/src/registry/scanner.ts` (if frontmatter passthrough needed)
- `.gsd/audits/baseline-L0.json` (new)
- `.gsd/audits/baseline-L1.json` (new)
- `.gsd/audits/baseline-L2a.json` (new)
