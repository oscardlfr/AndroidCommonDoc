/**
 * Tests for the validate-claude-md MCP tool.
 *
 * Validates CLAUDE.md files for:
 * - Template structure (identity header, mandatory sections, delegation statement)
 * - Line count budget (warn >150, error >200)
 * - Canonical rule coverage (rules present per layer)
 * - Circular reference detection (L0 must not reference L1/L2, L1 must not reference L2)
 * - Override validation (overrides must reference valid canonical rule IDs)
 * - Version consistency (version numbers vs versions-manifest.json)
 * - Cross-file duplicate detection (verbatim rules across layers)
 */
import { describe, it, expect } from "vitest";
import {
  validateTemplateStructure,
  validateLineCount,
  validateCanonicalCoverage,
  detectCircularReferences,
  validateOverrides,
  checkVersionConsistency,
  detectCrossFileDuplicates,
  type CanonicalRule,
  type ClaudeMdFile,
  type ValidationIssue,
} from "../../../src/tools/validate-claude-md.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid L0 CLAUDE.md content */
const VALID_L0_CONTENT = `# Project Rules

> **Layer:** L0
> **Inherits:** ~/.claude/CLAUDE.md
> **Purpose:** L0 pattern toolkit for the KMP ecosystem

## What This Project Is

Description of the project.

## MCP Server

- Located in mcp-server/

## Skills & Agents

- Skills in skills/*/SKILL.md

## Pattern Docs

- Located in docs/

## Development Rules

- Konsist tests

## Build & Test

\`\`\`bash
cd mcp-server && npm test
\`\`\`

## Vault Sync

- Config at ~/.myapp/vault-config.json

Delegates to ~/.claude/CLAUDE.md for shared KMP rules.
`;

/** Minimal valid L1 CLAUDE.md content */
const VALID_L1_CONTENT = `# Shared KMP Libs Rules

> **Layer:** L1
> **Inherits:** ~/.claude/CLAUDE.md
> **Purpose:** Module catalog and API/-impl separation rules

## Module Catalog

- API modules (-api) contain ONLY interfaces

## Build & Test

\`\`\`bash
./gradlew test
\`\`\`

Delegates to ~/.claude/CLAUDE.md for shared KMP rules.
`;

/** Minimal valid L2 CLAUDE.md content */
const VALID_L2_CONTENT = `# MyApp Rules

> **Layer:** L2
> **Inherits:** ~/.claude/CLAUDE.md
> **Purpose:** MyApp domain-specific decisions

## Developer Context

- Solo developer on MyApp

## Domain Rules

- Feature gate enforcement per subscription tier

## Build & Test

\`\`\`bash
./gradlew assembleDebug
\`\`\`

Delegates to ~/.claude/CLAUDE.md for shared KMP rules.
`;

/** Sample canonical rules for testing */
const SAMPLE_RULES: CanonicalRule[] = [
  {
    id: "VM-01",
    category: "viewmodel",
    rule: "UiState: ALWAYS sealed interface (NEVER data class with boolean flags)",
    layer: "L0",
    overridable: false,
  },
  {
    id: "ERR-01",
    category: "error-handling",
    rule: "Use com.example.shared.core.result.Result<T> for all operations",
    layer: "L0",
    overridable: false,
  },
  {
    id: "DI-01",
    category: "di",
    rule: "Koin 4.1.1 for dependency injection",
    layer: "L0",
    overridable: true,
  },
  {
    id: "MOD-02",
    category: "module-catalog",
    rule: "API modules (-api) contain ONLY interfaces, sealed classes, data classes",
    layer: "L1",
    overridable: false,
  },
  {
    id: "DS-02",
    category: "domain",
    rule: "DO NOT DISTURB THE DAW: SILENT (0% CPU) when DAW recording",
    layer: "L2",
    overridable: false,
  },
];

// ---------------------------------------------------------------------------
// Template structure
// ---------------------------------------------------------------------------

describe("template structure", () => {
  it("passes for valid L0 CLAUDE.md with identity header", () => {
    const issues = validateTemplateStructure(VALID_L0_CONTENT, "L0");
    const errors = issues.filter((i) => i.level === "error");
    expect(errors).toHaveLength(0);
  });

  it("errors when identity header is missing", () => {
    const content = `# Project Rules

Some rules here without identity header.

## Build & Test

\`\`\`bash
npm test
\`\`\`
`;
    const issues = validateTemplateStructure(content, "L0");
    const errors = issues.filter((i) => i.level === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.message.toLowerCase().includes("layer"))).toBe(
      true,
    );
  });

  it("errors when Layer field is missing from identity header", () => {
    const content = `# Project Rules

> **Inherits:** ~/.claude/CLAUDE.md
> **Purpose:** Something

## Build & Test
`;
    const issues = validateTemplateStructure(content, "L0");
    const errors = issues.filter((i) => i.level === "error");
    expect(errors.some((e) => e.message.includes("Layer"))).toBe(true);
  });

  it("errors when delegation statement is missing", () => {
    const content = `# Project Rules

> **Layer:** L0
> **Inherits:** ~/.claude/CLAUDE.md
> **Purpose:** Something

## Build & Test

\`\`\`bash
npm test
\`\`\`
`;
    const issues = validateTemplateStructure(content, "L0");
    const warnings = issues.filter((i) => i.level === "warning");
    expect(
      warnings.some((w) => w.message.toLowerCase().includes("delegat")),
    ).toBe(true);
  });

  it("passes when L0 global (~/.claude/CLAUDE.md) lacks identity header", () => {
    const content = `# Shared KMP Development Rules

## Developer Context
- Solo developer

## Architecture
- 5-layer architecture
`;
    // L0-global is the root -- it does not need Layer/Inherits/Purpose
    const issues = validateTemplateStructure(content, "L0-global");
    const errors = issues.filter((i) => i.level === "error");
    expect(errors).toHaveLength(0);
  });

  // Boris Cherny style tests
  it("passes for Boris Cherny style L2 CLAUDE.md", () => {
    const content = `# DawSync

> L2 Application — Creative Project OS for musicians.

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task

### 2. Agent Delegation (mandatory)
- MUST delegate domain audits to specialized agents

| Agent | Domain | MUST delegate when |
|-------|--------|-------------------|
| \`daw-guardian\` | DAW safety | ANY change to background work |

### 3. Verification Before Done
- Never mark done without proving it works

### 4. Autonomous Execution
- Use L0 skills, never raw Gradle

## Project Constraints

### DO NOT DISTURB THE DAW
- SILENT (0% CPU) when DAW is recording

## Commands
- \`/pre-pr\` — full pre-merge validation
`;
    const issues = validateTemplateStructure(content, "L2");
    const errors = issues.filter((i) => i.level === "error");
    expect(errors).toHaveLength(0);
  });

  it("warns when Boris Cherny style is missing Agent Delegation section", () => {
    const content = `# MyApp

> L2 Application — Some app.

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode

### 3. Verification Before Done
- Never mark done without proving

## Project Constraints
- Some constraint
`;
    const issues = validateTemplateStructure(content, "L2");
    const warnings = issues.filter((i) => i.level === "warning");
    expect(warnings.some((w) => w.message.includes("Agent Delegation"))).toBe(true);
  });

  it("warns when Boris Cherny style is missing Workflow Orchestration", () => {
    const content = `# MyApp

> L2 Application — Some app.

## Project Constraints
- MUST delegate to agents

## Commands
- /test
`;
    const issues = validateTemplateStructure(content, "L2");
    const warnings = issues.filter((i) => i.level === "warning");
    expect(warnings.some((w) => w.message.includes("Workflow Orchestration"))).toBe(true);
  });

  it("errors when neither Boris Cherny nor Legacy format detected", () => {
    const content = `# Some Random File

Just some text without any recognized header format.

## Build
npm test
`;
    const issues = validateTemplateStructure(content, "L1");
    const errors = issues.filter((i) => i.level === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("No recognized CLAUDE.md format");
  });
});

// ---------------------------------------------------------------------------
// Line count and budget
// ---------------------------------------------------------------------------

describe("line count and budget", () => {
  it("passes when file is under 150 lines", () => {
    const content = Array(100).fill("some line").join("\n");
    const issues = validateLineCount(content, "test-file.md");
    expect(issues).toHaveLength(0);
  });

  it("warns when file exceeds 150 lines", () => {
    const content = Array(160).fill("some line").join("\n");
    const issues = validateLineCount(content, "test-file.md");
    const warnings = issues.filter((i) => i.level === "warning");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].message).toContain("150");
  });

  it("errors when file exceeds 200 lines", () => {
    const content = Array(210).fill("some line").join("\n");
    const issues = validateLineCount(content, "test-file.md");
    const errors = issues.filter((i) => i.level === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("200");
  });
});

// ---------------------------------------------------------------------------
// Canonical coverage
// ---------------------------------------------------------------------------

describe("canonical coverage", () => {
  it("reports missing rules when L0 global file lacks expected content", () => {
    const content = `# Shared KMP Development Rules

## ViewModel Rules
- UiState: ALWAYS sealed interface

## Error Handling
- Use com.example.shared.core.result.Result<T> for all operations
`;
    // L0 rules: VM-01, ERR-01, DI-01 -- DI-01 is missing
    const issues = validateCanonicalCoverage(content, "L0", SAMPLE_RULES);
    expect(issues.some((i) => i.message.includes("DI-01"))).toBe(true);
  });

  it("reports coverage percentage in summary message", () => {
    const content = `# Rules
## ViewModel
- UiState: ALWAYS sealed interface
## Error Handling
- Use Result<T> for all operations
## DI
- Koin 4.1.1
`;
    const issues = validateCanonicalCoverage(content, "L0", SAMPLE_RULES);
    // All 3 L0 rules present -- should have no missing rule issues
    const missingRules = issues.filter(
      (i) => i.category === "canonical-coverage" && i.level === "warning",
    );
    expect(missingRules).toHaveLength(0);
  });

  it("only checks rules assigned to the current layer", () => {
    // L1 file should only be checked against L1 rules (MOD-02)
    const content = `# L1 Rules
## Module Catalog
- API modules (-api) contain ONLY interfaces, sealed classes
`;
    const issues = validateCanonicalCoverage(content, "L1", SAMPLE_RULES);
    // Should not report VM-01 or ERR-01 missing (those are L0 rules)
    expect(issues.some((i) => i.message.includes("VM-01"))).toBe(false);
    expect(issues.some((i) => i.message.includes("ERR-01"))).toBe(false);
  });

  it("detects L2 rule missing from L2 file", () => {
    const content = `# MyApp Rules
## Domain
- Feature gates only
`;
    const issues = validateCanonicalCoverage(content, "L2", SAMPLE_RULES);
    expect(issues.some((i) => i.message.includes("DS-02"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Circular references
// ---------------------------------------------------------------------------

describe("circular references", () => {
  // Test options with explicit project names (since global lists are empty by default)
  const testOptions = {
    l1Names: ["my-shared-libs"],
    l2Names: ["MyApp", "OtherApp"],
  };

  it("errors when L0 file references L1 project name in generic section", () => {
    const files: ClaudeMdFile[] = [
      {
        path: "CLAUDE.md",
        layer: "L0",
        content: `# L0 Rules

> **Layer:** L0

## Architecture
Use my-shared-libs module for networking.

## Build & Test
npm test
`,
      },
    ];
    const issues = detectCircularReferences(files, testOptions);
    const errors = issues.filter((i) => i.level === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(
      errors.some((e) => e.message.includes("my-shared-libs")),
    ).toBe(true);
  });

  it("allows L0 references to L1/L2 in Developer Context section", () => {
    const files: ClaudeMdFile[] = [
      {
        path: "~/.claude/CLAUDE.md",
        layer: "L0-global",
        content: `# Shared KMP Rules

## Developer Context
- Solo developer working on KMP ecosystem: MyApp, OtherApp, my-shared-libs

## Architecture
- 5-layer architecture
`,
      },
    ];
    const issues = detectCircularReferences(files, testOptions);
    const errors = issues.filter((i) => i.level === "error");
    expect(errors).toHaveLength(0);
  });

  it("errors when L1 file references L2 project name", () => {
    const files: ClaudeMdFile[] = [
      {
        path: "my-shared-libs/CLAUDE.md",
        layer: "L1",
        content: `# L1 Rules

> **Layer:** L1

## Module Catalog
- MyApp uses core-network-ktor for API calls
`,
      },
    ];
    const issues = detectCircularReferences(files, testOptions);
    const errors = issues.filter((i) => i.level === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.message.includes("MyApp"))).toBe(true);
  });

  it("allows L2 references to L1/L0 (downward is fine)", () => {
    const files: ClaudeMdFile[] = [
      {
        path: "MyApp/CLAUDE.md",
        layer: "L2",
        content: `# MyApp Rules

> **Layer:** L2

## Build
Uses my-shared-libs catalog. Delegates to ~/.claude/CLAUDE.md.
`,
      },
    ];
    const issues = detectCircularReferences(files, testOptions);
    expect(issues).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Override validation
// ---------------------------------------------------------------------------

describe("override validation", () => {
  it("passes when overrides reference valid canonical rule IDs", () => {
    const content = `# L1 Rules

## L0 Overrides

| Rule ID | Override | Reason |
|---------|----------|--------|
| DI-01 | Use Dagger/Hilt instead of Koin | Corporate standard |
`;
    const issues = validateOverrides(content, SAMPLE_RULES);
    const errors = issues.filter((i) => i.level === "error");
    expect(errors).toHaveLength(0);
  });

  it("errors when override references invalid rule ID", () => {
    const content = `# L1 Rules

## L0 Overrides

| Rule ID | Override | Reason |
|---------|----------|--------|
| FAKE-99 | Some override | No reason |
`;
    const issues = validateOverrides(content, SAMPLE_RULES);
    const errors = issues.filter((i) => i.level === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("FAKE-99");
  });

  it("warns when overriding a non-overridable rule", () => {
    const content = `# L1 Rules

## L0 Overrides

| Rule ID | Override | Reason |
|---------|----------|--------|
| VM-01 | Use data class for UiState | Simpler for our case |
`;
    const issues = validateOverrides(content, SAMPLE_RULES);
    const warnings = issues.filter((i) => i.level === "warning");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].message).toContain("VM-01");
    expect(warnings[0].message.toLowerCase()).toContain("overridable");
  });

  it("returns no issues when no overrides section exists", () => {
    const content = `# L1 Rules

## Module Catalog
Some rules here.
`;
    const issues = validateOverrides(content, SAMPLE_RULES);
    expect(issues).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Version consistency
// ---------------------------------------------------------------------------

describe("version consistency", () => {
  const manifest: Record<string, string> = {
    kotlin: "2.3.10",
    koin: "4.1.1",
    kover: "0.9.4",
  };

  it("passes when version numbers match manifest", () => {
    const content = `# Rules
## DI
- Koin 4.1.1 for dependency injection
## Build
- Kover for coverage
`;
    const issues = checkVersionConsistency(content, manifest);
    const mismatches = issues.filter(
      (i) => i.category === "version-consistency",
    );
    expect(mismatches).toHaveLength(0);
  });

  it("warns when version number mismatches manifest", () => {
    const content = `# Rules
## DI
- Koin 3.5.0 for dependency injection
`;
    const issues = checkVersionConsistency(content, manifest);
    const warnings = issues.filter(
      (i) =>
        i.category === "version-consistency" && i.level === "warning",
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].message.toLowerCase()).toContain("koin");
  });

  it("returns no issues when no version numbers found in content", () => {
    const content = `# Rules
## Architecture
- 5-layer architecture
`;
    const issues = checkVersionConsistency(content, manifest);
    expect(issues).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Cross-file duplicates
// ---------------------------------------------------------------------------

describe("cross-file duplicates", () => {
  it("warns when rules are duplicated verbatim across layers", () => {
    const files: ClaudeMdFile[] = [
      {
        path: "~/.claude/CLAUDE.md",
        layer: "L0-global",
        content: `# L0 Rules
## Build
- Convention plugins in build-logic/ for module boilerplate
`,
      },
      {
        path: "my-shared-libs/CLAUDE.md",
        layer: "L1",
        content: `# L1 Rules
## Build
- Convention plugins in build-logic/ for module boilerplate
`,
      },
    ];
    const issues = detectCrossFileDuplicates(files);
    const warnings = issues.filter((i) => i.level === "warning");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].message.toLowerCase()).toContain("duplicate");
  });

  it("does not warn when rules differ between layers", () => {
    const files: ClaudeMdFile[] = [
      {
        path: "~/.claude/CLAUDE.md",
        layer: "L0-global",
        content: `# L0 Rules
## Build
- Convention plugins in build-logic/ for module boilerplate
`,
      },
      {
        path: "my-shared-libs/CLAUDE.md",
        layer: "L1",
        content: `# L1 Rules
## Build
- Convention plugins in build-logic/ for consistent config across all modules
`,
      },
    ];
    const issues = detectCrossFileDuplicates(files);
    const warnings = issues.filter((i) => i.level === "warning");
    expect(warnings).toHaveLength(0);
  });

  it("does not flag duplicates within the same file", () => {
    const files: ClaudeMdFile[] = [
      {
        path: "CLAUDE.md",
        layer: "L0",
        content: `# L0 Rules
## Section A
- Same rule text here
## Section B
- Same rule text here
`,
      },
    ];
    const issues = detectCrossFileDuplicates(files);
    expect(issues).toHaveLength(0);
  });
});
