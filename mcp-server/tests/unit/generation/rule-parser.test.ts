import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  parseRuleDefinitions,
  collectAllRules,
} from "../../../src/generation/rule-parser.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("parseRuleDefinitions", () => {
  it("extracts valid rule array from frontmatter data", () => {
    const frontmatter: Record<string, unknown> = {
      scope: ["viewmodel"],
      sources: ["lifecycle"],
      targets: ["android"],
      rules: [
        {
          id: "sealed-ui-state",
          type: "prefer-construct",
          message: "UiState must be sealed interface",
          detect: { class_suffix: "UiState", must_be: "sealed" },
        },
        {
          id: "no-channel-events",
          type: "banned-usage",
          message: "Use MutableSharedFlow instead of Channel",
          detect: {
            in_class_extending: "ViewModel",
            banned_initializer: "Channel<",
            prefer: "MutableSharedFlow",
          },
        },
      ],
    };

    const rules = parseRuleDefinitions(frontmatter);
    expect(rules).toHaveLength(2);
    expect(rules[0].id).toBe("sealed-ui-state");
    expect(rules[0].type).toBe("prefer-construct");
    expect(rules[0].message).toBe("UiState must be sealed interface");
    expect(rules[0].detect).toEqual({
      class_suffix: "UiState",
      must_be: "sealed",
    });
    expect(rules[1].id).toBe("no-channel-events");
    expect(rules[1].type).toBe("banned-usage");
  });

  it("skips entries missing required fields (id, type, message, detect)", () => {
    const frontmatter: Record<string, unknown> = {
      rules: [
        // Missing id
        {
          type: "banned-import",
          message: "test",
          detect: { banned_import: "x" },
        },
        // Missing type
        { id: "test", message: "test", detect: { banned_import: "x" } },
        // Missing message
        { id: "test", type: "banned-import", detect: { banned_import: "x" } },
        // Missing detect
        { id: "test", type: "banned-import", message: "test" },
        // Valid
        {
          id: "valid-rule",
          type: "banned-import",
          message: "Do not use X",
          detect: { banned_import: "com.example.bad" },
        },
      ],
    };

    const rules = parseRuleDefinitions(frontmatter);
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe("valid-rule");
  });

  it("returns empty array when no rules: field exists", () => {
    const frontmatter: Record<string, unknown> = {
      scope: ["viewmodel"],
      sources: ["lifecycle"],
      targets: ["android"],
    };

    const rules = parseRuleDefinitions(frontmatter);
    expect(rules).toEqual([]);
  });

  it("marks hand_written rules correctly", () => {
    const frontmatter: Record<string, unknown> = {
      rules: [
        {
          id: "sealed-ui-state",
          type: "prefer-construct",
          message: "UiState must be sealed",
          detect: { class_suffix: "UiState", must_be: "sealed" },
          hand_written: true,
          source_rule: "SealedUiStateRule.kt",
        },
        {
          id: "generated-rule",
          type: "banned-import",
          message: "Do not use X",
          detect: { banned_import: "com.bad", prefer: "com.good" },
        },
      ],
    };

    const rules = parseRuleDefinitions(frontmatter);
    expect(rules).toHaveLength(2);
    expect(rules[0].hand_written).toBe(true);
    expect(rules[0].source_rule).toBe("SealedUiStateRule.kt");
    expect(rules[1].hand_written).toBeUndefined();
    expect(rules[1].source_rule).toBeUndefined();
  });

  it("returns empty array when rules field is not an array", () => {
    const frontmatter: Record<string, unknown> = {
      rules: "not-an-array",
    };

    const rules = parseRuleDefinitions(frontmatter);
    expect(rules).toEqual([]);
  });

  it("extracts platforms map when present", () => {
    const frontmatter: Record<string, unknown> = {
      rules: [
        {
          id: "sealed-ui-state",
          type: "prefer-construct",
          message: "UiState must be sealed interface",
          detect: { class_suffix: "UiState", must_be: "sealed" },
          hand_written: true,
          source_rule: "SealedUiStateRule.kt",
          platforms: {
            kotlin: {
              tool: "detekt",
              source_rule: "SealedUiStateRule.kt",
              hand_written: true,
            },
            swift: {
              tool: "swiftlint",
              strategy: "custom_rule",
              equivalent: "enum with associated values",
            },
          },
        },
      ],
    };

    const rules = parseRuleDefinitions(frontmatter);
    expect(rules).toHaveLength(1);
    expect(rules[0].platforms).toBeDefined();
    expect(rules[0].platforms!.kotlin).toEqual({
      tool: "detekt",
      source_rule: "SealedUiStateRule.kt",
      hand_written: true,
    });
    expect(rules[0].platforms!.swift).toEqual({
      tool: "swiftlint",
      strategy: "custom_rule",
      equivalent: "enum with associated values",
    });
  });

  it("platforms field is undefined when not present in frontmatter", () => {
    const frontmatter: Record<string, unknown> = {
      rules: [
        {
          id: "simple-rule",
          type: "banned-import",
          message: "Don't use X",
          detect: { banned_import: "com.bad" },
        },
      ],
    };

    const rules = parseRuleDefinitions(frontmatter);
    expect(rules).toHaveLength(1);
    expect(rules[0].platforms).toBeUndefined();
  });

  it("platforms field is ignored when not an object", () => {
    const frontmatter: Record<string, unknown> = {
      rules: [
        {
          id: "bad-platforms",
          type: "banned-import",
          message: "test",
          detect: { banned_import: "x" },
          platforms: "not-an-object",
        },
      ],
    };

    const rules = parseRuleDefinitions(frontmatter);
    expect(rules).toHaveLength(1);
    expect(rules[0].platforms).toBeUndefined();
  });

  it("skips entries with invalid RuleType", () => {
    const frontmatter: Record<string, unknown> = {
      rules: [
        {
          id: "bad-type",
          type: "nonexistent-type",
          message: "test",
          detect: { x: "y" },
        },
        {
          id: "good-type",
          type: "banned-import",
          message: "test",
          detect: { banned_import: "com.bad" },
        },
      ],
    };

    const rules = parseRuleDefinitions(frontmatter);
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe("good-type");
  });
});

describe("collectAllRules", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rule-collector-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("scans docs directory and returns all rule definitions with source doc slug", async () => {
    const doc1 = [
      "---",
      "scope: [viewmodel]",
      "sources: [lifecycle]",
      "targets: [android]",
      "rules:",
      "  - id: sealed-ui-state",
      "    type: prefer-construct",
      '    message: "UiState must be sealed"',
      "    detect:",
      "      class_suffix: UiState",
      "      must_be: sealed",
      "---",
      "# ViewModel Patterns",
    ].join("\n");

    const doc2 = [
      "---",
      "scope: [error-handling]",
      "sources: [kotlinx-coroutines]",
      "targets: [android]",
      "rules:",
      "  - id: rethrow-cancellation",
      "    type: required-rethrow",
      '    message: "Must rethrow CancellationException"',
      "    detect:",
      "      exception_type: CancellationException",
      "---",
      "# Error Handling",
    ].join("\n");

    const docNoRules = [
      "---",
      "scope: [testing]",
      "sources: [junit]",
      "targets: [android]",
      "---",
      "# Testing",
    ].join("\n");

    await fs.writeFile(path.join(tmpDir, "viewmodel-patterns.md"), doc1);
    await fs.writeFile(path.join(tmpDir, "error-handling.md"), doc2);
    await fs.writeFile(path.join(tmpDir, "testing-patterns.md"), docNoRules);

    const results = await collectAllRules(tmpDir);
    expect(results).toHaveLength(2);

    const slugs = results.map((r) => r.slug).sort();
    expect(slugs).toContain("error-handling");
    expect(slugs).toContain("viewmodel-patterns");

    const vmRule = results.find((r) => r.slug === "viewmodel-patterns");
    expect(vmRule?.rule.id).toBe("sealed-ui-state");
    expect(vmRule?.rule.type).toBe("prefer-construct");
  });

  it("returns empty array for directory with no rules", async () => {
    const doc = [
      "---",
      "scope: [testing]",
      "sources: [junit]",
      "targets: [android]",
      "---",
      "# Testing",
    ].join("\n");
    await fs.writeFile(path.join(tmpDir, "testing.md"), doc);

    const results = await collectAllRules(tmpDir);
    expect(results).toEqual([]);
  });

  it("deduplicates rules with the same ID across multiple docs", async () => {
    const doc1 = [
      "---",
      "scope: [testing]",
      "sources: [junit]",
      "targets: [android]",
      "rules:",
      "  - id: no-mocks-in-common-tests",
      "    type: banned-import",
      '    message: "Use fakes not mocks"',
      "    detect:",
      "      banned_import_prefixes:",
      '        - "io.mockk"',
      '        - "org.mockito"',
      '      prefer: "pure Kotlin fake class"',
      "---",
      "# Testing Hub",
    ].join("\n");

    const doc2 = [
      "---",
      "scope: [testing]",
      "sources: [junit]",
      "targets: [android]",
      "rules:",
      "  - id: no-mocks-in-common-tests",
      "    type: banned-import",
      '    message: "Use fakes not mocks"',
      "    detect:",
      "      banned_import_prefixes:",
      '        - "io.mockk"',
      "---",
      "# Testing Patterns",
    ].join("\n");

    await fs.writeFile(path.join(tmpDir, "testing-hub.md"), doc1);
    await fs.writeFile(path.join(tmpDir, "testing-patterns.md"), doc2);

    const results = await collectAllRules(tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0].rule.id).toBe("no-mocks-in-common-tests");
  });

  it("keeps the entry with more complete detect block on duplicate", async () => {
    // doc1 has fewer detect keys (less complete)
    const doc1 = [
      "---",
      "scope: [testing]",
      "sources: [junit]",
      "targets: [android]",
      "rules:",
      "  - id: shared-rule",
      "    type: banned-import",
      '    message: "test"',
      "    detect:",
      '      banned_import: "com.bad"',
      "---",
      "# Doc1",
    ].join("\n");

    // doc2 has more detect keys (more complete)
    const doc2 = [
      "---",
      "scope: [testing]",
      "sources: [junit]",
      "targets: [android]",
      "rules:",
      "  - id: shared-rule",
      "    type: banned-import",
      '    message: "test"',
      "    detect:",
      "      banned_import_prefixes:",
      '        - "com.bad"',
      '        - "com.worse"',
      '      prefer: "com.good"',
      "---",
      "# Doc2",
    ].join("\n");

    await fs.writeFile(path.join(tmpDir, "aaa-doc1.md"), doc1);
    await fs.writeFile(path.join(tmpDir, "bbb-doc2.md"), doc2);

    const results = await collectAllRules(tmpDir);
    expect(results).toHaveLength(1);
    // The more complete detect block (doc2 with 2 keys) should win
    expect(results[0].rule.detect).toHaveProperty("banned_import_prefixes");
  });
});
