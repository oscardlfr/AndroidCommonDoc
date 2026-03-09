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
});
