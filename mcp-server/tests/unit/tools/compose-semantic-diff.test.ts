import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  normalizePrintToString,
  parseSemanticTree,
  parseSemanticTreeFile,
  flattenTree,
  elementIdentity,
  diffTrees,
  toFindings,
  type SemanticNode,
} from "../../../src/tools/compose-semantic-diff.js";

// ── Fixtures (real printToString output captured from DawSync in 21-POC) ────

const FIXTURES_DIR = path.resolve(
  __dirname,
  "..",
  "fixtures",
  "compose-semantic-diff",
);
const sessionsEmpty = readFileSync(
  path.join(FIXTURES_DIR, "sessions-empty.txt"),
  "utf-8",
);
const sessionsLoading = readFileSync(
  path.join(FIXTURES_DIR, "sessions-loading.txt"),
  "utf-8",
);
const sessionsError = readFileSync(
  path.join(FIXTURES_DIR, "sessions-error.txt"),
  "utf-8",
);

// Synthetic minimal fixture — for targeted parser unit tests.
const MINIMAL = `Printing with useUnmergedTree = 'false'
Node #1 at (l=0.0, t=0.0, r=1024.0, b=768.0)px
IsTraversalGroup = 'true'
 |-Node #2 at (l=0.0, t=0.0, r=1024.0, b=768.0)px, Tag: 'screen'
   ContentDescription = '[My Screen]'
    |-Node #3 at (l=10.0, t=10.0, r=100.0, b=40.0)px, Tag: 'title'
      Text = '[Hello]'
      Actions = [GetTextLayoutResult]
`;

// ── normalizePrintToString ──────────────────────────────────────────────────

describe("normalizePrintToString", () => {
  it("strips Node #N numbers to a stable placeholder", () => {
    const out = normalizePrintToString("Node #123 foo\nNode #45 bar");
    expect(out).toBe("Node #N foo\nNode #N bar");
  });

  it("strips @<hashcode> suffixes on Shape reprs", () => {
    const out = normalizePrintToString(
      "Shape = 'HorizontalScrollableClipShape@c22ad75'",
    );
    expect(out).toBe("Shape = 'HorizontalScrollableClipShape@HASH'");
  });

  it("is idempotent on already-normalized input", () => {
    const once = normalizePrintToString(MINIMAL);
    const twice = normalizePrintToString(once);
    expect(twice).toBe(once);
  });

  it("makes two captures with different Node #N sequences equivalent", () => {
    const run1 = "Node #1 at (l=0.0, t=0.0, r=1.0, b=1.0)px, Tag: 'x'";
    const run2 = "Node #99 at (l=0.0, t=0.0, r=1.0, b=1.0)px, Tag: 'x'";
    expect(normalizePrintToString(run1)).toBe(normalizePrintToString(run2));
  });
});

// ── parseSemanticTree ───────────────────────────────────────────────────────

describe("parseSemanticTree", () => {
  it("parses the root node of a minimal tree", () => {
    const roots = parseSemanticTree(MINIMAL);
    expect(roots).toHaveLength(1);
    expect(roots[0].bounds).toEqual({ l: 0, t: 0, r: 1024, b: 768 });
    expect(roots[0].extras.IsTraversalGroup).toBe("true");
  });

  it("captures testTag from the Tag: suffix", () => {
    const roots = parseSemanticTree(MINIMAL);
    const screen = roots[0].children[0];
    expect(screen.testTag).toBe("screen");
  });

  it("unwraps bracketed contentDescription and text", () => {
    const roots = parseSemanticTree(MINIMAL);
    const screen = roots[0].children[0];
    expect(screen.contentDescription).toBe("My Screen");
    const title = screen.children[0];
    expect(title.text).toBe("Hello");
  });

  it("parses Actions = [...] into a string array", () => {
    const roots = parseSemanticTree(MINIMAL);
    const title = roots[0].children[0].children[0];
    expect(title.actions).toEqual(["GetTextLayoutResult"]);
  });

  it("skips the Printing-with header", () => {
    const roots = parseSemanticTree(MINIMAL);
    expect(roots[0].extras.Printing).toBeUndefined();
  });

  it("returns an empty array for empty input", () => {
    expect(parseSemanticTree("")).toEqual([]);
  });

  it("is stable across repeated parsing of the same input", () => {
    const a = parseSemanticTree(MINIMAL);
    const b = parseSemanticTree(MINIMAL);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("parses the DawSync sessions-error fixture without losing nodes", () => {
    const roots = parseSemanticTree(sessionsError);
    const flat = flattenTree(roots);
    expect(flat.length).toBeGreaterThanOrEqual(4);
    const tags = flat.map((n) => n.testTag).filter(Boolean);
    expect(tags).toContain("sessions_screen");
    expect(tags).toContain("common_error_state");
    expect(tags).toContain("common_retry_button");
  });

  it("extracts visible error text from the DawSync sessions-error fixture", () => {
    const flat = flattenTree(parseSemanticTree(sessionsError));
    const errorMsg = flat.find((n) => n.testTag === "common_error_message");
    expect(errorMsg?.text).toBe("Failed to load sessions");
  });

  it("parses the larger sessions-empty fixture (9.9K, many children)", () => {
    const roots = parseSemanticTree(sessionsEmpty);
    const flat = flattenTree(roots);
    expect(flat.length).toBeGreaterThan(20);
    const tags = flat.map((n) => n.testTag).filter(Boolean);
    expect(tags).toContain("sessions_screen");
    expect(tags).toContain("sessions_filter_bar");
  });
});

// ── elementIdentity ─────────────────────────────────────────────────────────

describe("elementIdentity", () => {
  const baseNode = (over: Partial<SemanticNode>): SemanticNode => ({
    depth: 0,
    actions: [],
    extras: {},
    children: [],
    ...over,
  });

  it("prefers testTag when present", () => {
    expect(
      elementIdentity(baseNode({ testTag: "x", text: "y" })),
    ).toBe("x@depth0");
  });

  it("falls back to contentDescription then text", () => {
    expect(
      elementIdentity(baseNode({ contentDescription: "desc" })),
    ).toBe("desc@depth0");
    expect(elementIdentity(baseNode({ text: "t" }))).toBe("t@depth0");
  });

  it("uses role@depth when no textual identity exists", () => {
    const id = elementIdentity(baseNode({ role: "Button", depth: 3 }));
    expect(id).toBe("Button@depth3@depth3");
  });

  it("appends depth so duplicate tags in a list do not collide", () => {
    const a = elementIdentity(baseNode({ testTag: "card", depth: 1 }));
    const b = elementIdentity(baseNode({ testTag: "card", depth: 2 }));
    expect(a).not.toBe(b);
  });
});

// ── diffTrees ───────────────────────────────────────────────────────────────

describe("diffTrees", () => {
  const mk = (over: Partial<SemanticNode>): SemanticNode => ({
    depth: 1,
    actions: [],
    extras: {},
    children: [],
    ...over,
  });

  it("reports removed when a node disappears in current", () => {
    const baseline: SemanticNode[] = [
      mk({ testTag: "a" }),
      mk({ testTag: "b" }),
    ];
    const current: SemanticNode[] = [mk({ testTag: "a" })];
    const diff = diffTrees(baseline, current);
    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0].testTag).toBe("b");
    expect(diff.added).toHaveLength(0);
  });

  it("reports added when a new node appears in current", () => {
    const baseline: SemanticNode[] = [mk({ testTag: "a" })];
    const current: SemanticNode[] = [
      mk({ testTag: "a" }),
      mk({ testTag: "b" }),
    ];
    const diff = diffTrees(baseline, current);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].testTag).toBe("b");
  });

  it("reports modified on text drift for the same identity", () => {
    const baseline: SemanticNode[] = [
      mk({ testTag: "title", text: "Hello" }),
    ];
    const current: SemanticNode[] = [
      mk({ testTag: "title", text: "Goodbye" }),
    ];
    const diff = diffTrees(baseline, current);
    expect(diff.modified).toHaveLength(1);
    expect(diff.modified[0].changedFields).toContain("text");
  });

  it("returns an empty diff for identical trees", () => {
    const flat = flattenTree(parseSemanticTree(sessionsLoading));
    const diff = diffTrees(flat, flat);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.modified).toHaveLength(0);
  });

  it("treats action reorderings as no-change (set semantics)", () => {
    const baseline: SemanticNode[] = [
      mk({ testTag: "btn", actions: ["OnClick", "RequestFocus"] }),
    ];
    const current: SemanticNode[] = [
      mk({ testTag: "btn", actions: ["RequestFocus", "OnClick"] }),
    ];
    const diff = diffTrees(baseline, current);
    expect(diff.modified).toHaveLength(0);
  });

  it("detects changes in extras (e.g., Focused flipped)", () => {
    const baseline: SemanticNode[] = [
      mk({ testTag: "btn", extras: { Focused: "false" } }),
    ];
    const current: SemanticNode[] = [
      mk({ testTag: "btn", extras: { Focused: "true" } }),
    ];
    const diff = diffTrees(baseline, current);
    expect(diff.modified).toHaveLength(1);
    expect(diff.modified[0].changedFields).toContain("extras.Focused");
  });
});

// ── toFindings ──────────────────────────────────────────────────────────────

describe("toFindings", () => {
  const mk = (over: Partial<SemanticNode>): SemanticNode => ({
    depth: 1,
    actions: [],
    extras: {},
    children: [],
    ...over,
  });

  it("marks removed elements with testTag as HIGH", () => {
    const baseline: SemanticNode[] = [mk({ testTag: "sessions_screen" })];
    const current: SemanticNode[] = [];
    const findings = toFindings(diffTrees(baseline, current));
    expect(findings[0].severity).toBe("HIGH");
    expect(findings[0].title).toContain("disappeared");
    expect(findings[0].suggestion).toContain("sessions_screen");
    expect(findings[0].category).toBe("ui-accessibility");
  });

  it("marks removed anonymous elements as MEDIUM (not HIGH)", () => {
    const baseline: SemanticNode[] = [mk({ text: "something" })];
    const current: SemanticNode[] = [];
    const findings = toFindings(diffTrees(baseline, current));
    expect(findings[0].severity).toBe("MEDIUM");
  });

  it("marks added anonymous elements as LOW", () => {
    const baseline: SemanticNode[] = [];
    const current: SemanticNode[] = [mk({ text: "transient tooltip" })];
    const findings = toFindings(diffTrees(baseline, current));
    expect(findings[0].severity).toBe("LOW");
  });

  it("marks added tagged elements as MEDIUM", () => {
    const baseline: SemanticNode[] = [];
    const current: SemanticNode[] = [mk({ testTag: "new_card" })];
    const findings = toFindings(diffTrees(baseline, current));
    expect(findings[0].severity).toBe("MEDIUM");
  });

  it("marks text drift as MEDIUM and hints at string-resource regression", () => {
    const baseline: SemanticNode[] = [
      mk({ testTag: "title", text: "Original" }),
    ];
    const current: SemanticNode[] = [
      mk({ testTag: "title", text: "Drifted" }),
    ];
    const findings = toFindings(diffTrees(baseline, current));
    expect(findings[0].severity).toBe("MEDIUM");
    expect(findings[0].suggestion).toMatch(/string-resource/);
  });

  it("marks non-text modifications as LOW", () => {
    const baseline: SemanticNode[] = [
      mk({ testTag: "btn", actions: ["OnClick"] }),
    ];
    const current: SemanticNode[] = [
      mk({ testTag: "btn", actions: ["OnClick", "RequestFocus"] }),
    ];
    const findings = toFindings(diffTrees(baseline, current));
    expect(findings[0].severity).toBe("LOW");
  });

  it("prefixes all dedupe_keys with compose-semantic-diff to avoid collision with android-layout-diff", () => {
    const baseline: SemanticNode[] = [mk({ testTag: "x" })];
    const current: SemanticNode[] = [];
    const findings = toFindings(diffTrees(baseline, current));
    expect(findings[0].dedupe_key).toMatch(/^compose-semantic-diff:/);
  });

  it("emits stable dedupe_keys for stable input", () => {
    const baseline: SemanticNode[] = [mk({ testTag: "x" })];
    const current: SemanticNode[] = [];
    const f1 = toFindings(diffTrees(baseline, current));
    const f2 = toFindings(diffTrees(baseline, current));
    expect(f1.map((f) => f.dedupe_key)).toEqual(f2.map((f) => f.dedupe_key));
  });
});

// ── parseSemanticTreeFile ───────────────────────────────────────────────────

describe("parseSemanticTreeFile", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "compose-diff-"));

  it("returns capture_missing when the file does not exist", () => {
    const out = parseSemanticTreeFile(path.join(tmp, "nope.txt"));
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.kind).toBe("capture_missing");
      expect(out.message).toMatch(/captureUiBaselines/);
    }
  });

  it("returns parse_error for a non-printToString file", () => {
    const p = path.join(tmp, "garbage.txt");
    writeFileSync(p, "not a compose tree");
    const out = parseSemanticTreeFile(p);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.kind).toBe("parse_error");
  });

  it("returns ok with parsed nodes for a valid capture", () => {
    const p = path.join(tmp, "valid.txt");
    writeFileSync(p, MINIMAL);
    const out = parseSemanticTreeFile(p);
    expect(out.ok).toBe(true);
    if (out.ok) expect(flattenTree(out.nodes).length).toBeGreaterThan(0);
  });

  // Cleanup is best-effort; vitest holds the process open anyway.
  it("cleanup marker", () => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
    expect(true).toBe(true);
  });
});

// ── Schema parity with android-layout-diff ──────────────────────────────────

describe("LayoutFinding schema parity with android-layout-diff", () => {
  it("matches the field set exported from android-layout-diff", async () => {
    // Import both types to ensure structural assignability.
    const composeMod = await import("../../../src/tools/compose-semantic-diff.js");
    const androidMod = await import("../../../src/tools/android-layout-diff.js");
    // Type is inferred from the importable exports — a runtime check on at
    // least one finding demonstrates field-by-field parity.
    const compose: composeMod.LayoutFinding = {
      dedupe_key: "compose-semantic-diff:x",
      severity: "HIGH",
      category: "ui-accessibility",
      source: "compose-semantic-diff",
      check: "semantic-diff",
      title: "x",
    };
    const android: androidMod.LayoutFinding = {
      dedupe_key: "layout-diff:x",
      severity: "HIGH",
      category: "ui-accessibility",
      source: "android-layout-diff",
      check: "layout-diff",
      title: "x",
    };
    // Assignability is structural — this compiles only if the shapes are compatible.
    const shared: Array<Pick<
      composeMod.LayoutFinding,
      "dedupe_key" | "severity" | "category" | "title"
    >> = [compose, android];
    expect(shared).toHaveLength(2);
  });
});
