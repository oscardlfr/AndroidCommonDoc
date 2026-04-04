/**
 * Tests for the target-matcher utility.
 *
 * Verifies matchFileAgainstDocs() matching strategies: exact filename,
 * extension, path component, scope keyword, and edge cases.
 */
import { describe, it, expect } from "vitest";
import {
  matchFileAgainstDocs,
  type DocEntry,
} from "../../../src/utils/target-matcher.js";

/** Helper to create a minimal DocEntry for testing. */
function makeDoc(
  slug: string,
  targets: string[],
  scope = "",
  category = "testing",
): DocEntry {
  return {
    slug,
    filepath: `/docs/${category}/${slug}.md`,
    metadata: {
      description: `Doc for ${slug}`,
      scope,
      targets,
      category,
    },
  };
}

describe("matchFileAgainstDocs", () => {
  it("matches exact filename against target", () => {
    const docs = [makeDoc("viewmodel-patterns", ["ViewModel"])];
    const matches = matchFileAgainstDocs(
      "app/src/main/kotlin/HomeViewModel.kt",
      docs,
    );

    expect(matches.length).toBe(1);
    expect(matches[0].slug).toBe("viewmodel-patterns");
    expect(matches[0].matchReason).toContain("ViewModel");
  });

  it("matches extension with wildcard target (*.kt)", () => {
    const docs = [makeDoc("kotlin-patterns", ["*.kt"])];
    const matches = matchFileAgainstDocs(
      "src/main/kotlin/MyClass.kt",
      docs,
    );

    expect(matches.length).toBe(1);
    expect(matches[0].slug).toBe("kotlin-patterns");
    expect(matches[0].matchReason).toContain(".kt");
  });

  it("matches path component against target", () => {
    const docs = [makeDoc("navigation-patterns", ["navigation"])];
    const matches = matchFileAgainstDocs(
      "feature/navigation/src/main/kotlin/NavGraph.kt",
      docs,
    );

    expect(matches.length).toBe(1);
    expect(matches[0].slug).toBe("navigation-patterns");
    expect(matches[0].matchReason).toContain("navigation");
  });

  it("matches scope keyword against path", () => {
    const docs = [
      makeDoc("security-patterns", [], "security, encryption", "security"),
    ];
    const matches = matchFileAgainstDocs(
      "core/security/src/main/kotlin/Encryptor.kt",
      docs,
    );

    expect(matches.length).toBe(1);
    expect(matches[0].slug).toBe("security-patterns");
    expect(matches[0].matchReason).toContain("Scope");
  });

  it("returns empty for no matches", () => {
    const docs = [
      makeDoc("compose-patterns", ["compose"]),
      makeDoc("di-patterns", ["koin", "dagger"]),
    ];
    const matches = matchFileAgainstDocs(
      "totally/unrelated/file.xyz",
      docs,
    );

    expect(matches).toHaveLength(0);
  });

  it("matches case-insensitively", () => {
    const docs = [makeDoc("android-patterns", ["Android"])];
    const matches = matchFileAgainstDocs(
      "app/src/main/kotlin/com/example/android/MainActivity.kt",
      docs,
    );

    // "Android" target should match "android" path component (case insensitive)
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].slug).toBe("android-patterns");
  });

  it("does not duplicate matches from multiple strategies", () => {
    // A doc with target "android" should match only once even if
    // both filename and path component match
    const docs = [makeDoc("android-guide", ["android"])];
    const matches = matchFileAgainstDocs(
      "android/src/main/kotlin/AndroidApp.kt",
      docs,
    );

    // Should have exactly 1 match (first strategy wins, then breaks)
    const slugMatches = matches.filter((m) => m.slug === "android-guide");
    expect(slugMatches.length).toBe(1);
  });
});
