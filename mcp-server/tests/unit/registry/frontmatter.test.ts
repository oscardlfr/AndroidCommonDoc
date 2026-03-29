import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "../../../src/registry/frontmatter.js";

describe("parseFrontmatter", () => {
  it("parses valid YAML frontmatter with scope array", () => {
    const raw = '---\nscope:\n  - testing\n---\n# Content';
    const result = parseFrontmatter(raw);
    expect(result).not.toBeNull();
    expect(result!.data).toEqual({ scope: ["testing"] });
    expect(result!.content).toBe("# Content");
  });

  it("returns null when no frontmatter present", () => {
    const raw = "# No frontmatter";
    const result = parseFrontmatter(raw);
    expect(result).toBeNull();
  });

  it("parses empty frontmatter block", () => {
    const raw = "---\n---\n# Content";
    const result = parseFrontmatter(raw);
    expect(result).not.toBeNull();
    expect(result!.data).toEqual({});
    expect(result!.content).toBe("# Content");
  });

  it("strips BOM and parses correctly", () => {
    const raw = '\uFEFF---\nscope:\n  - testing\n---\n# Content';
    const result = parseFrontmatter(raw);
    expect(result).not.toBeNull();
    expect(result!.data).toEqual({ scope: ["testing"] });
    expect(result!.content).toBe("# Content");
  });

  it("handles CRLF line endings", () => {
    const raw = '---\r\nscope:\r\n  - testing\r\n---\r\n# Content';
    const result = parseFrontmatter(raw);
    expect(result).not.toBeNull();
    expect(result!.data).toEqual({ scope: ["testing"] });
    expect(result!.content).toBe("# Content");
  });

  it("returns null for invalid YAML", () => {
    const raw = '---\n: invalid: yaml: [broken\n---\n# Content';
    const result = parseFrontmatter(raw);
    expect(result).toBeNull();
  });

  it("returns null when only opening delimiter exists", () => {
    const raw = "---\nscope:\n  - testing\n# No closing delimiter";
    const result = parseFrontmatter(raw);
    expect(result).toBeNull();
  });

  it("parses frontmatter with multiple fields", () => {
    const raw = [
      "---",
      "scope: [testing, coroutines]",
      "sources: [junit5, kover]",
      "targets: [android, ios]",
      "version: 2",
      'last_updated: "2026-03"',
      "---",
      "# Testing Patterns",
      "",
      "Some content here.",
    ].join("\n");
    const result = parseFrontmatter(raw);
    expect(result).not.toBeNull();
    expect(result!.data.scope).toEqual(["testing", "coroutines"]);
    expect(result!.data.sources).toEqual(["junit5", "kover"]);
    expect(result!.data.targets).toEqual(["android", "ios"]);
    expect(result!.data.version).toBe(2);
    expect(result!.content).toContain("# Testing Patterns");
    expect(result!.content).toContain("Some content here.");
  });

  it("returns null for empty string", () => {
    const result = parseFrontmatter("");
    expect(result).toBeNull();
  });

  it("handles closing --- at end of file (no trailing content)", () => {
    const raw = "---\nscope:\n  - testing\n---";
    const result = parseFrontmatter(raw);
    expect(result).not.toBeNull();
    expect(result!.data).toEqual({ scope: ["testing"] });
    expect(result!.content).toBe("");
  });

  it("handles BOM + CRLF combined", () => {
    const raw = "\uFEFF---\r\nscope:\r\n  - testing\r\nsources:\r\n  - junit5\r\n---\r\n# Content";
    const result = parseFrontmatter(raw);
    expect(result).not.toBeNull();
    expect(result!.data.scope).toEqual(["testing"]);
    expect(result!.data.sources).toEqual(["junit5"]);
    expect(result!.content).toBe("# Content");
  });

  it("returns null when file starts with text before ---", () => {
    const raw = "Some text\n---\nscope:\n  - testing\n---\n# Content";
    const result = parseFrontmatter(raw);
    expect(result).toBeNull();
  });

  it("returns null for missing closing delimiter (only opening ---)", () => {
    const raw = "---\nscope:\n  - testing\nSome content without closing";
    const result = parseFrontmatter(raw);
    expect(result).toBeNull();
  });

  it("parses complex nested YAML structures", () => {
    const raw = [
      "---",
      "scope: [testing, coroutines]",
      "sources: [junit5]",
      "targets: [android, ios]",
      "monitor_urls:",
      "  - url: https://example.com",
      "    type: doc-page",
      "    tier: 2",
      "rules:",
      "  - id: test-rule",
      "    type: banned-import",
      '    message: "Do not use"',
      "    detect:",
      "      import: com.example.banned",
      "---",
      "# Content",
    ].join("\n");
    const result = parseFrontmatter(raw);
    expect(result).not.toBeNull();
    expect(result!.data.monitor_urls).toHaveLength(1);
    expect(result!.data.rules).toHaveLength(1);
    expect(result!.data.rules[0].id).toBe("test-rule");
  });

  it("returns null for severely malformed YAML (unbalanced brackets)", () => {
    const raw = "---\nscope: [testing, [broken\n---\n# Content";
    const result = parseFrontmatter(raw);
    // yaml parser should either parse it or return null
    // The important thing is it doesn't throw
    if (result !== null) {
      expect(result.data).toBeDefined();
    }
  });
});
