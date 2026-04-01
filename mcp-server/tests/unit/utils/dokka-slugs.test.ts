/**
 * Tests for Dokka slug encoding utilities.
 *
 * Validates that URL-encoded Dokka filenames are decoded correctly
 * before slug generation, preventing mangled cross-references.
 */
import { describe, it, expect } from "vitest";
import { decodeDokkaName, toDocSlug } from "../../../src/utils/dokka-slugs.js";

describe("decodeDokkaName", () => {
  it("decodes %3C/%3E (angle brackets from generics)", () => {
    expect(decodeDokkaName("Result%3CT%3E")).toBe("Result<T>");
  });

  it("decodes %20 (spaces)", () => {
    expect(decodeDokkaName("suspend%20fun")).toBe("suspend fun");
  });

  it("decodes %2F (forward slash)", () => {
    expect(decodeDokkaName("com%2Fexample%2FClass")).toBe("com/example/Class");
  });

  it("decodes %2C (comma in type parameters)", () => {
    expect(decodeDokkaName("Map%3CString%2C%20Any%3E")).toBe("Map<String, Any>");
  });

  it("passes through plain names unchanged", () => {
    expect(decodeDokkaName("SimpleClass")).toBe("SimpleClass");
    expect(decodeDokkaName("core-result")).toBe("core-result");
  });

  it("handles malformed percent-encoding gracefully", () => {
    // Lone % without two hex digits — should not throw
    const result = decodeDokkaName("bad%name");
    expect(result).toBe("badname");
  });

  it("handles empty string", () => {
    expect(decodeDokkaName("")).toBe("");
  });
});

describe("toDocSlug", () => {
  it("decodes then sanitizes generic type: Result<T>", () => {
    // Result%3CT%3E → decode to Result<T> → sanitize to Result-T
    expect(toDocSlug("Result%3CT%3E")).toBe("Result-T");
  });

  it("decodes then sanitizes suspend function", () => {
    // suspend%20fun → decode to "suspend fun" → sanitize to "suspend-fun"
    expect(toDocSlug("suspend%20fun")).toBe("suspend-fun");
  });

  it("decodes then sanitizes complex generic: Map<String, Any>", () => {
    expect(toDocSlug("Map%3CString%2C%20Any%3E")).toBe("Map-String-Any");
  });

  it("handles already-clean names", () => {
    expect(toDocSlug("simple-name")).toBe("simple-name");
    expect(toDocSlug("CamelCase")).toBe("CamelCase");
  });

  it("preserves dots and underscores", () => {
    expect(toDocSlug("some.class_name")).toBe("some.class_name");
  });

  it("collapses consecutive hyphens", () => {
    expect(toDocSlug("a%3C%3Eb")).toBe("a-b");
  });

  it("strips trailing hyphens", () => {
    expect(toDocSlug("Trail%3E")).toBe("Trail");
  });

  it("handles Dokka nullable type encoding: T%3F", () => {
    // %3F is '?', not valid in filenames → becomes hyphen
    expect(toDocSlug("Result%3CT%3F%3E")).toBe("Result-T");
  });

  it("handles Dokka star-projection: %2A", () => {
    // %2A is '*'
    expect(toDocSlug("List%3C%2A%3E")).toBe("List");
  });
});
