/**
 * Tests for shared doc-scoring utilities.
 */
import { describe, it, expect } from "vitest";
import {
  tokenize,
  jaccardSimilarity,
  normalizeForComparison,
} from "../../../src/utils/doc-scoring.js";

describe("tokenize", () => {
  it("splits on spaces and lowercases", () => {
    expect(tokenize("Hello World")).toEqual(["hello", "world"]);
  });

  it("splits on commas and semicolons", () => {
    expect(tokenize("foo,bar;baz")).toEqual(["foo", "bar", "baz"]);
  });

  it("removes single-character tokens", () => {
    expect(tokenize("a bb ccc")).toEqual(["bb", "ccc"]);
  });

  it("handles empty string", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("jaccardSimilarity", () => {
  it("returns 1 for identical sets", () => {
    expect(jaccardSimilarity(["a", "b", "c"], ["a", "b", "c"])).toBe(1);
  });

  it("returns 0 for disjoint sets", () => {
    expect(jaccardSimilarity(["a", "b"], ["c", "d"])).toBe(0);
  });

  it("returns 1 for two empty sets", () => {
    expect(jaccardSimilarity([], [])).toBe(1);
  });

  it("returns 0 when one set is empty", () => {
    expect(jaccardSimilarity(["a"], [])).toBe(0);
  });

  it("computes correct ratio for partial overlap", () => {
    // intersection = {a, b} = 2, union = {a, b, c, d} = 4 → 0.5
    expect(jaccardSimilarity(["a", "b", "c"], ["a", "b", "d"])).toBe(0.5);
  });
});

describe("normalizeForComparison", () => {
  it("strips YAML frontmatter", () => {
    const text = "---\nslug: test\n---\n# Content\nReal text here";
    const tokens = normalizeForComparison(text);
    expect(tokens).not.toContain("slug");
    expect(tokens).toContain("content");
    expect(tokens).toContain("real");
  });

  it("strips code blocks", () => {
    const text = "Before\n```kotlin\nfun foo() = 42\n```\nAfter";
    const tokens = normalizeForComparison(text);
    expect(tokens).not.toContain("foo");
    expect(tokens).toContain("before");
    expect(tokens).toContain("after");
  });

  it("strips markdown formatting", () => {
    const text = "## **Bold** and *italic* text";
    const tokens = normalizeForComparison(text);
    expect(tokens).toContain("bold");
    expect(tokens).toContain("italic");
  });
});
