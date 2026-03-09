# M002: Hardening & Intelligence

**Vision:** A cross-platform developer toolkit that provides spec-driven development patterns and token-efficient AI skills for Android/KMP projects.

## Success Criteria


## Slices

- [x] **S01: Tech Debt Foundation** `risk:medium` `depends:[]`
  > After this: Add ANDROID_COMMON_DOC env var guards to all 8 consumer-facing scripts (4 SH + 4 PS1) and make install-copilot-prompts.
- [x] **S02: Konsist Internal Tests** `risk:medium` `depends:[S01]`
  > After this: Bootstrap the konsist-tests standalone JVM module, validate Konsist 0.
- [x] **S03: Consumer Guard Tests** `risk:medium` `depends:[S02]`
  > After this: Create guard test templates and install scripts that distribute parameterized architecture enforcement to consuming projects.
- [x] **S04: Mcp Server** `risk:medium` `depends:[S03]`
  > After this: Bootstrap the MCP server project with TypeScript compilation, all dev tooling, the server factory pattern, utility modules, and stub registration functions for resources/tools/prompts.
- [x] **S05: Pattern Registry Discovery** `risk:medium` `depends:[S04]`
  > After this: Create the pattern registry core: type definitions, YAML frontmatter parser, directory scanner, and add YAML frontmatter to all 9 existing pattern docs.
- [x] **S06: Doc Intelligence Detekt Generation** `risk:medium` `depends:[S05]`
  > After this: Extend the pattern registry schema with monitoring and rule definition types, then build the core monitoring engine that fetches upstream sources and detects changes.
- [x] **S07: Notebooklm Integration Skill** `risk:medium` `depends:[S06]`
  > After this: Define vault types, configuration management, and source file collection for the Obsidian vault sync pipeline.
- [x] **S08: Ecosystem Vault Expansion** `risk:medium` `depends:[S07]`
  > After this: Create stub test files for all 10 vault test files required by Phase 12.
