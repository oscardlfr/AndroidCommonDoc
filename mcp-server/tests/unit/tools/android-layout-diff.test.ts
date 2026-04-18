import { describe, it, expect, vi } from "vitest";
import {
  captureCurrentLayout,
  diffLayouts,
  elementIdentity,
  toFindings,
  type AndroidLayoutRunner,
  type LayoutElement,
} from "../../../src/tools/android-layout-diff.js";

const SEPARATOR = "----------------------------------------";

// ── Fixtures ────────────────────────────────────────────────────────────────

const el = (overrides: Partial<LayoutElement>): LayoutElement => ({
  center: "[0,0]",
  ...overrides,
});

const baseline: LayoutElement[] = [
  el({
    "resource-id": "loading_indicator",
    interactions: ["focusable"],
    center: "[540,1000]",
    bounds: "[0,900][1080,1100]",
  }),
  el({
    "resource-id": "song_title",
    text: "Song A",
    center: "[540,200]",
    bounds: "[0,150][1080,250]",
  }),
  el({
    "resource-id": "play_button",
    "content-desc": "Reproducir",
    interactions: ["clickable", "focusable"],
    center: "[540,1500]",
    bounds: "[440,1400][640,1600]",
  }),
];

// ── elementIdentity ──────────────────────────────────────────────────────────

describe("elementIdentity", () => {
  it("prefers resource-id", () => {
    expect(
      elementIdentity(el({ "resource-id": "x", text: "y", center: "[1,2]" })),
    ).toBe("x@[1,2]");
  });

  it("falls back to content-desc then text then 'anon'", () => {
    expect(elementIdentity(el({ "content-desc": "d", center: "[1,2]" }))).toBe("d@[1,2]");
    expect(elementIdentity(el({ text: "t", center: "[1,2]" }))).toBe("t@[1,2]");
    expect(elementIdentity(el({ center: "[1,2]" }))).toBe("anon@[1,2]");
  });

  it("uses bounds when present (more stable than center)", () => {
    expect(
      elementIdentity(
        el({ "resource-id": "x", bounds: "[0,0][100,100]", center: "[50,50]" }),
      ),
    ).toBe("x@[0,0][100,100]");
  });
});

// ── diffLayouts ──────────────────────────────────────────────────────────────

describe("diffLayouts", () => {
  it("reports removed elements when baseline has entries missing in current", () => {
    const current = baseline.filter((e) => e["resource-id"] !== "play_button");
    const diff = diffLayouts(baseline, current);
    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0]["resource-id"]).toBe("play_button");
    expect(diff.added).toHaveLength(0);
    expect(diff.modified).toHaveLength(0);
  });

  it("reports added elements when current has entries not in baseline", () => {
    const current: LayoutElement[] = [
      ...baseline,
      el({ "resource-id": "snackbar", text: "Error", center: "[540,2000]" }),
    ];
    const diff = diffLayouts(baseline, current);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0]["resource-id"]).toBe("snackbar");
  });

  it("reports modified when text changes on the same identity", () => {
    const current: LayoutElement[] = baseline.map((e) =>
      e["resource-id"] === "song_title" ? { ...e, text: "Song B" } : e,
    );
    const diff = diffLayouts(baseline, current);
    expect(diff.modified).toHaveLength(1);
    expect(diff.modified[0].changedFields).toContain("text");
  });

  it("returns an empty diff for identical layouts", () => {
    const diff = diffLayouts(baseline, baseline);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.modified).toHaveLength(0);
  });

  it("treats interactions reordering as equal", () => {
    const current: LayoutElement[] = baseline.map((e) =>
      e["resource-id"] === "play_button"
        ? { ...e, interactions: ["focusable", "clickable"] }
        : e,
    );
    const diff = diffLayouts(baseline, current);
    expect(diff.modified).toHaveLength(0);
  });

  it("detects state-array changes (e.g. selected toggled off)", () => {
    const withSelected: LayoutElement[] = [
      el({ "resource-id": "tab", center: "[100,100]", state: ["selected"] }),
    ];
    const withoutSelected: LayoutElement[] = [
      el({ "resource-id": "tab", center: "[100,100]" }),
    ];
    const diff = diffLayouts(withSelected, withoutSelected);
    expect(diff.modified).toHaveLength(1);
    expect(diff.modified[0].changedFields).toContain("state");
  });
});

// ── toFindings ───────────────────────────────────────────────────────────────

describe("toFindings", () => {
  it("marks removed elements with resource-id as HIGH severity", () => {
    const current = baseline.slice(0, 1); // drop song_title + play_button
    const findings = toFindings(diffLayouts(baseline, current));
    const high = findings.filter((f) => f.severity === "HIGH");
    expect(high.length).toBeGreaterThan(0);
    expect(high[0].title).toContain("disappeared");
    expect(high[0].category).toBe("ui-accessibility");
  });

  it("marks added anonymous elements as LOW severity", () => {
    const current: LayoutElement[] = [
      ...baseline,
      el({ text: "transient tooltip", center: "[10,10]" }),
    ];
    const findings = toFindings(diffLayouts(baseline, current));
    const addedLow = findings.filter(
      (f) => f.severity === "LOW" && f.dedupe_key.startsWith("layout-diff:added:"),
    );
    expect(addedLow).toHaveLength(1);
  });

  it("marks text drift as MEDIUM (likely string-resource regression)", () => {
    const current: LayoutElement[] = baseline.map((e) =>
      e["resource-id"] === "song_title" ? { ...e, text: "Different" } : e,
    );
    const findings = toFindings(diffLayouts(baseline, current));
    const drift = findings.find((f) => f.dedupe_key.includes("song_title"));
    expect(drift?.severity).toBe("MEDIUM");
    expect(drift?.suggestion).toContain("string-resource");
  });

  it("emits stable dedupe_key values", () => {
    const f1 = toFindings(diffLayouts(baseline, baseline.slice(0, 1)));
    const f2 = toFindings(diffLayouts(baseline, baseline.slice(0, 1)));
    expect(f1.map((f) => f.dedupe_key)).toEqual(f2.map((f) => f.dedupe_key));
  });
});

// ── captureCurrentLayout ─────────────────────────────────────────────────────

describe("captureCurrentLayout", () => {
  it("parses a clean JSON array response", async () => {
    const runner: AndroidLayoutRunner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify([{ center: "[0,0]", "resource-id": "x" }]),
      stderr: "",
      exitCode: 0,
    });

    const result = await captureCurrentLayout(undefined, 5000, runner);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.elements).toHaveLength(1);
      expect(result.elements[0]["resource-id"]).toBe("x");
    }
    expect(runner).toHaveBeenCalledWith(["layout", "--pretty"], 5000);
  });

  it("passes --device flag when serial is provided", async () => {
    const runner: AndroidLayoutRunner = vi.fn().mockResolvedValue({
      stdout: "[]",
      stderr: "",
      exitCode: 0,
    });
    await captureCurrentLayout("R3CT30KAMEH", 5000, runner);
    expect(runner).toHaveBeenCalledWith(
      ["layout", "--pretty", "--device=R3CT30KAMEH"],
      5000,
    );
  });

  it("strips status-prelude lines before the JSON array", async () => {
    const runner: AndroidLayoutRunner = vi.fn().mockResolvedValue({
      stdout: `Layout tree written to /tmp/x.json\n[{"center":"[1,2]","resource-id":"a"}]`,
      stderr: "",
      exitCode: 0,
    });
    const result = await captureCurrentLayout(undefined, 5000, runner);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.elements).toHaveLength(1);
  });

  it("strips a 40-dash separator before the JSON payload", async () => {
    const runner: AndroidLayoutRunner = vi.fn().mockResolvedValue({
      stdout: `Waiting for index...\n${SEPARATOR}\n[{"center":"[1,2]"}]`,
      stderr: "",
      exitCode: 0,
    });
    const result = await captureCurrentLayout(undefined, 5000, runner);
    expect(result.ok).toBe(true);
  });

  it("classifies missing-CLI errors with install hint", async () => {
    const runner: AndroidLayoutRunner = vi.fn().mockResolvedValue({
      stdout: "",
      stderr: "'android' is not recognized as an internal or external command",
      exitCode: 127,
    });
    const result = await captureCurrentLayout(undefined, 5000, runner);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("cli_missing");
      expect(result.message).toContain("Android CLI not on PATH");
    }
  });

  it("classifies adb-offline Java exceptions", async () => {
    const runner: AndroidLayoutRunner = vi.fn().mockResolvedValue({
      stdout: "",
      stderr:
        "AdbDeviceFailResponseException: 'device offline' error on device serial",
      exitCode: 1,
    });
    const result = await captureCurrentLayout("FAKE", 5000, runner);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("adb_offline");
      expect(result.message).toContain("FAKE");
    }
  });

  it("classifies multi-device ambiguity", async () => {
    const runner: AndroidLayoutRunner = vi.fn().mockResolvedValue({
      stdout: "",
      stderr: "adb.exe: more than one device/emulator",
      exitCode: 1,
    });
    const result = await captureCurrentLayout(undefined, 5000, runner);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("multi_device");
      expect(result.message).toContain("device_serial");
    }
  });

  it("surfaces timeouts distinctly", async () => {
    const runner: AndroidLayoutRunner = vi.fn().mockResolvedValue({
      stdout: "",
      stderr: "timed out after 5000ms",
      exitCode: 124,
    });
    const result = await captureCurrentLayout(undefined, 5000, runner);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("timeout");
  });

  it("returns a json_parse error for malformed output", async () => {
    const runner: AndroidLayoutRunner = vi.fn().mockResolvedValue({
      stdout: "[this is not json",
      stderr: "",
      exitCode: 0,
    });
    const result = await captureCurrentLayout(undefined, 5000, runner);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("json_parse");
  });

  it("rejects non-array JSON at the top level", async () => {
    const runner: AndroidLayoutRunner = vi.fn().mockResolvedValue({
      stdout: '{"added":[],"modified":[]}',
      stderr: "",
      exitCode: 0,
    });
    const result = await captureCurrentLayout(undefined, 5000, runner);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("json_parse");
  });
});
