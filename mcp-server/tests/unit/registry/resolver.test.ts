import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  resolvePattern,
  resolveAllPatterns,
  resolveAllPatternsWithExcludes,
} from "../../../src/registry/resolver.js";

/**
 * Helper: create a valid .md file with YAML frontmatter in the given directory.
 */
async function createDoc(
  dir: string,
  slug: string,
  opts: {
    scope?: string[];
    sources?: string[];
    targets?: string[];
    excludable_sources?: string[];
  } = {},
): Promise<void> {
  const scope = opts.scope ?? ["testing"];
  const sources = opts.sources ?? ["junit5"];
  const targets = opts.targets ?? ["android"];
  let fm = `---\nscope: [${scope.join(", ")}]\nsources: [${sources.join(", ")}]\ntargets: [${targets.join(", ")}]`;
  if (opts.excludable_sources) {
    fm += `\nexcludable_sources: [${opts.excludable_sources.join(", ")}]`;
  }
  fm += `\n---\n# ${slug}\nContent for ${slug}`;
  await fs.writeFile(path.join(dir, `${slug}.md`), fm);
}

describe("resolvePattern", () => {
  let tmpRoot: string;
  let l0Dir: string;
  let l2Dir: string;
  let projectDir: string;
  let l1Dir: string;
  const originalEnv = process.env.ANDROID_COMMON_DOC;
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "resolver-test-"));
    l0Dir = path.join(tmpRoot, "toolkit", "docs");
    l2Dir = path.join(tmpRoot, "userhome", ".androidcommondoc", "docs");
    projectDir = path.join(tmpRoot, "MyApp");
    l1Dir = path.join(projectDir, ".androidcommondoc", "docs");

    await fs.mkdir(l0Dir, { recursive: true });
    await fs.mkdir(l2Dir, { recursive: true });
    await fs.mkdir(l1Dir, { recursive: true });

    // Point toolkit root to our temp toolkit
    process.env.ANDROID_COMMON_DOC = path.join(tmpRoot, "toolkit");
    // Point home dir to our temp userhome
    process.env.HOME = path.join(tmpRoot, "userhome");
    process.env.USERPROFILE = path.join(tmpRoot, "userhome");
  });

  afterEach(async () => {
    // Restore env vars
    if (originalEnv !== undefined) {
      process.env.ANDROID_COMMON_DOC = originalEnv;
    } else {
      delete process.env.ANDROID_COMMON_DOC;
    }
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    if (originalUserProfile !== undefined) {
      process.env.USERPROFILE = originalUserProfile;
    } else {
      delete process.env.USERPROFILE;
    }
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("returns L0 entry when no L1/L2 override exists", async () => {
    await createDoc(l0Dir, "testing-patterns");

    const result = await resolvePattern("testing-patterns");
    expect(result).not.toBeNull();
    expect(result!.slug).toBe("testing-patterns");
    expect(result!.layer).toBe("L0");
  });

  it("returns L1 entry when project override exists", async () => {
    await createDoc(l0Dir, "testing-patterns");
    await createDoc(l1Dir, "testing-patterns");

    const result = await resolvePattern("testing-patterns", projectDir);
    expect(result).not.toBeNull();
    expect(result!.slug).toBe("testing-patterns");
    expect(result!.layer).toBe("L1");
  });

  it("returns L2 entry when user override exists and no project specified", async () => {
    await createDoc(l0Dir, "testing-patterns");
    await createDoc(l2Dir, "testing-patterns");

    const result = await resolvePattern("testing-patterns");
    expect(result).not.toBeNull();
    expect(result!.slug).toBe("testing-patterns");
    expect(result!.layer).toBe("L2");
  });

  it("returns L1 over L2 when both exist", async () => {
    await createDoc(l0Dir, "testing-patterns");
    await createDoc(l2Dir, "testing-patterns");
    await createDoc(l1Dir, "testing-patterns");

    const result = await resolvePattern("testing-patterns", projectDir);
    expect(result).not.toBeNull();
    expect(result!.layer).toBe("L1");
  });

  it("falls through L1 to L2 when L1 does not have the slug", async () => {
    await createDoc(l0Dir, "testing-patterns");
    await createDoc(l2Dir, "testing-patterns");
    // L1 dir exists but has no testing-patterns.md

    const result = await resolvePattern("testing-patterns", projectDir);
    expect(result).not.toBeNull();
    expect(result!.layer).toBe("L2");
  });

  it("returns null for nonexistent slug", async () => {
    await createDoc(l0Dir, "testing-patterns");

    const result = await resolvePattern("nonexistent");
    expect(result).toBeNull();
  });
});

describe("resolveAllPatterns", () => {
  let tmpRoot: string;
  let l0Dir: string;
  let l2Dir: string;
  let projectDir: string;
  let l1Dir: string;
  const originalEnv = process.env.ANDROID_COMMON_DOC;
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "resolver-all-test-"));
    l0Dir = path.join(tmpRoot, "toolkit", "docs");
    l2Dir = path.join(tmpRoot, "userhome", ".androidcommondoc", "docs");
    projectDir = path.join(tmpRoot, "MyApp");
    l1Dir = path.join(projectDir, ".androidcommondoc", "docs");

    await fs.mkdir(l0Dir, { recursive: true });
    await fs.mkdir(l2Dir, { recursive: true });
    await fs.mkdir(l1Dir, { recursive: true });

    process.env.ANDROID_COMMON_DOC = path.join(tmpRoot, "toolkit");
    process.env.HOME = path.join(tmpRoot, "userhome");
    process.env.USERPROFILE = path.join(tmpRoot, "userhome");
  });

  afterEach(async () => {
    if (originalEnv !== undefined) {
      process.env.ANDROID_COMMON_DOC = originalEnv;
    } else {
      delete process.env.ANDROID_COMMON_DOC;
    }
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    if (originalUserProfile !== undefined) {
      process.env.USERPROFILE = originalUserProfile;
    } else {
      delete process.env.USERPROFILE;
    }
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("returns all L0 docs when no overrides exist", async () => {
    await createDoc(l0Dir, "testing-patterns");
    await createDoc(l0Dir, "kmp-architecture");

    const results = await resolveAllPatterns();
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.layer === "L0")).toBe(true);
    const slugs = results.map((r) => r.slug).sort();
    expect(slugs).toEqual(["kmp-architecture", "testing-patterns"]);
  });

  it("resolves with L2 overrides per-slug (no project)", async () => {
    await createDoc(l0Dir, "testing-patterns");
    await createDoc(l0Dir, "kmp-architecture");
    await createDoc(l2Dir, "testing-patterns");

    const results = await resolveAllPatterns();
    expect(results).toHaveLength(2);

    const testing = results.find((r) => r.slug === "testing-patterns");
    const kmp = results.find((r) => r.slug === "kmp-architecture");
    expect(testing!.layer).toBe("L2");
    expect(kmp!.layer).toBe("L0");
  });

  it("resolves with L1 > L2 > L0 per-slug (with project)", async () => {
    await createDoc(l0Dir, "testing-patterns");
    await createDoc(l0Dir, "kmp-architecture");
    await createDoc(l0Dir, "gradle-patterns");
    await createDoc(l2Dir, "kmp-architecture");
    await createDoc(l1Dir, "testing-patterns");

    const results = await resolveAllPatterns(projectDir);
    expect(results).toHaveLength(3);

    const testing = results.find((r) => r.slug === "testing-patterns");
    const kmp = results.find((r) => r.slug === "kmp-architecture");
    const gradle = results.find((r) => r.slug === "gradle-patterns");
    expect(testing!.layer).toBe("L1");
    expect(kmp!.layer).toBe("L2");
    expect(gradle!.layer).toBe("L0");
  });

  it("includes L1-only docs not in L0", async () => {
    await createDoc(l0Dir, "testing-patterns");
    await createDoc(l1Dir, "custom-project-pattern");

    const results = await resolveAllPatterns(projectDir);
    expect(results).toHaveLength(2);
    const custom = results.find((r) => r.slug === "custom-project-pattern");
    expect(custom).toBeDefined();
    expect(custom!.layer).toBe("L1");
  });
});

describe("resolveAllPatternsWithExcludes", () => {
  let tmpRoot: string;
  let l0Dir: string;
  const originalEnv = process.env.ANDROID_COMMON_DOC;
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "resolver-excl-test-"));
    l0Dir = path.join(tmpRoot, "toolkit", "docs");
    const l2Dir = path.join(tmpRoot, "userhome", ".androidcommondoc", "docs");

    await fs.mkdir(l0Dir, { recursive: true });
    await fs.mkdir(l2Dir, { recursive: true });

    process.env.ANDROID_COMMON_DOC = path.join(tmpRoot, "toolkit");
    process.env.HOME = path.join(tmpRoot, "userhome");
    process.env.USERPROFILE = path.join(tmpRoot, "userhome");
  });

  afterEach(async () => {
    if (originalEnv !== undefined) {
      process.env.ANDROID_COMMON_DOC = originalEnv;
    } else {
      delete process.env.ANDROID_COMMON_DOC;
    }
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    if (originalUserProfile !== undefined) {
      process.env.USERPROFILE = originalUserProfile;
    } else {
      delete process.env.USERPROFILE;
    }
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("filters out entries whose sources intersect with excludes.sources", async () => {
    await createDoc(l0Dir, "junit-patterns", { sources: ["junit5"] });
    await createDoc(l0Dir, "compose-patterns", { sources: ["compose"] });
    await createDoc(l0Dir, "mixed-patterns", {
      sources: ["junit5", "compose"],
    });

    const results = await resolveAllPatternsWithExcludes(undefined, {
      sources: ["junit5"],
    });
    // Only compose-patterns should remain (mixed has junit5 in sources)
    expect(results).toHaveLength(1);
    expect(results[0].slug).toBe("compose-patterns");
  });

  it("returns all when no excludes provided", async () => {
    await createDoc(l0Dir, "pattern-a");
    await createDoc(l0Dir, "pattern-b");

    const results = await resolveAllPatternsWithExcludes();
    expect(results).toHaveLength(2);
  });
});
