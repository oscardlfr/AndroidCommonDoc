# M004: Documentation Coherence & Context Management

**Vision:** A cross-platform developer toolkit that provides spec-driven development patterns and token-efficient AI skills for Android/KMP projects.

## Success Criteria


## Slices

- [x] **S01: Audit Validate** `risk:medium` `depends:[]`
  > After this: Mine all 209 WakeTheCave markdown files (docs/ 199 + docs2/ 10) for reusable KMP patterns sourced from official documentation.
- [x] **S02: Doc Structure Consolidation** `risk:medium` `depends:[S01]`
  > After this: Define the standard documentation template, extend MCP types for new frontmatter fields, fix versions-manifest.
- [x] **S03: Docs Subdirectory Reorganization** `risk:medium` `depends:[S02]`
  > After this: Extend the pattern registry foundation to support subdirectory-based doc organization: add `category` field to PatternMetadata, make scanner recursive (handle docs in subdirectories), and extend find-pattern with --category filter.
- [x] **S04: Docs Content Quality** `risk:medium` `depends:[S03]`
  > After this: Extend MCP tooling with l0_refs cross-layer reference support and quality validation checks.
- [x] **S05: Skill Materialization Registry** `risk:medium` `depends:[S04]`
  > After this: Build the L0 skill registry generator that scans all skills, agents, and commands, computes SHA-256 content hashes, extracts metadata from frontmatter, and outputs `skills/registry.
- [x] **S06: Claude Md Ecosystem Alignment** `risk:medium` `depends:[S05]`
  > After this: Extract canonical rule checklist from all 4 existing CLAUDE.
