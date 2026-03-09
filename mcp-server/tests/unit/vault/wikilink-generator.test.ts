import { describe, it, expect } from "vitest";
import { injectWikilinks } from "../../../src/vault/wikilink-generator.js";

describe("vault wikilink-generator", () => {
  it("project-prefixed slugs use display-text format [[slug|displayName]]", () => {
    const allSlugs = new Set(["MyApp-CLAUDE"]);
    const content = "See MyApp-CLAUDE for details.";

    const result = injectWikilinks(content, allSlugs);

    expect(result).toContain("[[MyApp-CLAUDE|CLAUDE]]");
    expect(result).not.toContain("See MyApp-CLAUDE for");
  });

  it("bare L0 slugs produce [[slug]] format", () => {
    const allSlugs = new Set(["testing-patterns"]);
    const content = "Follow the testing-patterns guide.";

    const result = injectWikilinks(content, allSlugs);

    expect(result).toContain("[[testing-patterns]]");
  });

  it("code blocks not modified", () => {
    const allSlugs = new Set(["testing-patterns"]);
    const content = "Text\n```\ntesting-patterns\n```\nMore text";

    const result = injectWikilinks(content, allSlugs);

    // The fenced code block should not be modified
    expect(result).toContain("```\ntesting-patterns\n```");
  });

  it("inline code not modified", () => {
    const allSlugs = new Set(["testing-patterns"]);
    const content = "Use `testing-patterns` as reference.";

    const result = injectWikilinks(content, allSlugs);

    // Inline code should not be modified
    expect(result).toContain("`testing-patterns`");
    // Should not contain a wikilink inside inline code
    expect(result).not.toContain("`[[testing-patterns]]`");
  });

  it("existing wikilinks not double-wrapped", () => {
    const allSlugs = new Set(["testing-patterns"]);
    const content = "See [[testing-patterns]] for info.";

    const result = injectWikilinks(content, allSlugs);

    // Should NOT produce [[[[testing-patterns]]]]
    expect(result).not.toContain("[[[[");
    expect(result).toContain("[[testing-patterns]]");
  });

  it("own slug is excluded from wikilink injection", () => {
    const allSlugs = new Set(["my-doc", "other-doc"]);
    const content = "This is my-doc about other-doc.";

    const result = injectWikilinks(content, allSlugs, "my-doc");

    // Own slug should not be wikified
    expect(result).not.toContain("[[my-doc]]");
    // Other slug should be wikified
    expect(result).toContain("[[other-doc]]");
  });

  it("multiple slugs replaced in one pass", () => {
    const allSlugs = new Set(["testing-patterns", "error-handling"]);
    const content = "Use testing-patterns and error-handling.";

    const result = injectWikilinks(content, allSlugs);

    expect(result).toContain("[[testing-patterns]]");
    expect(result).toContain("[[error-handling]]");
  });
});
