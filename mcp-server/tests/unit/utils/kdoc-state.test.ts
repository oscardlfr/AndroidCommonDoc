/**
 * Tests for kdoc-state persistence utility.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  readKDocState,
  writeKDocState,
  createEmptyState,
  updateCoverage,
  updateDocsApi,
  updatePatternAlignment,
  type KDocState,
} from "../../../src/utils/kdoc-state.js";

const TEST_ROOT = path.join(os.tmpdir(), "kdoc-state-test-" + process.pid);

beforeEach(() => {
  if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(TEST_ROOT, { recursive: true });
});

afterEach(() => {
  try { if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true }); } catch { /* Windows */ }
});

describe("createEmptyState", () => {
  it("creates valid initial state", () => {
    const state = createEmptyState();
    expect(state.schema_version).toBe(1);
    expect(state.coverage.overall_pct).toBe(0);
    expect(state.coverage.per_module).toEqual({});
    expect(state.docs_api.modules_generated).toEqual([]);
    expect(state.pattern_alignment.drifts).toBe(0);
  });
});

describe("readKDocState / writeKDocState", () => {
  it("returns null for non-existent file", () => {
    expect(readKDocState(TEST_ROOT)).toBeNull();
  });

  it("writes and reads back state", () => {
    const state = createEmptyState();
    state.coverage.overall_pct = 79.6;
    writeKDocState(TEST_ROOT, state);

    const read = readKDocState(TEST_ROOT);
    expect(read).not.toBeNull();
    expect(read!.coverage.overall_pct).toBe(79.6);
  });

  it("creates .androidcommondoc directory", () => {
    writeKDocState(TEST_ROOT, createEmptyState());
    expect(existsSync(path.join(TEST_ROOT, ".androidcommondoc", "kdoc-state.json"))).toBe(true);
  });

  it("produces valid JSON", () => {
    writeKDocState(TEST_ROOT, createEmptyState());
    const raw = readFileSync(path.join(TEST_ROOT, ".androidcommondoc", "kdoc-state.json"), "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});

describe("updateCoverage", () => {
  it("updates per-module coverage", () => {
    const state = createEmptyState();
    updateCoverage(state, [
      { module: "core-common", total_public: 18, documented: 18, coverage_pct: 100 },
      { module: "core-domain", total_public: 10, documented: 8, coverage_pct: 80 },
    ]);

    expect(state.coverage.per_module["core-common"].pct).toBe(100);
    expect(state.coverage.per_module["core-domain"].pct).toBe(80);
    expect(state.coverage.total_public).toBe(28);
    expect(state.coverage.total_documented).toBe(26);
    expect(state.coverage.overall_pct).toBe(92.9);
  });

  it("merges with existing modules", () => {
    const state = createEmptyState();
    updateCoverage(state, [{ module: "a", total_public: 10, documented: 10, coverage_pct: 100 }]);
    updateCoverage(state, [{ module: "b", total_public: 10, documented: 5, coverage_pct: 50 }]);

    expect(Object.keys(state.coverage.per_module)).toEqual(["a", "b"]);
    expect(state.coverage.overall_pct).toBe(75);
  });

  it("overwrites stale module data", () => {
    const state = createEmptyState();
    updateCoverage(state, [{ module: "x", total_public: 10, documented: 5, coverage_pct: 50 }]);
    updateCoverage(state, [{ module: "x", total_public: 10, documented: 10, coverage_pct: 100 }]);

    expect(state.coverage.per_module["x"].pct).toBe(100);
    expect(state.coverage.overall_pct).toBe(100);
  });

  it("sets last_audit timestamp", () => {
    const state = createEmptyState();
    const before = new Date().toISOString();
    updateCoverage(state, []);
    expect(state.last_audit >= before).toBe(true);
  });
});

describe("updateDocsApi", () => {
  it("records generated modules", () => {
    const state = createEmptyState();
    updateDocsApi(state, ["core-common", "core-result"]);

    expect(state.docs_api.modules_generated).toEqual(["core-common", "core-result"]);
    expect(state.docs_api.generated_at).toBeTruthy();
  });

  it("merges with previously generated modules", () => {
    const state = createEmptyState();
    updateDocsApi(state, ["core-common"]);
    updateDocsApi(state, ["core-result"]);

    expect(state.docs_api.modules_generated).toEqual(["core-common", "core-result"]);
  });

  it("deduplicates modules", () => {
    const state = createEmptyState();
    updateDocsApi(state, ["core-common", "core-result"]);
    updateDocsApi(state, ["core-common", "core-domain"]);

    expect(state.docs_api.modules_generated).toEqual(["core-common", "core-domain", "core-result"]);
  });
});

describe("updatePatternAlignment", () => {
  it("records drift count", () => {
    const state = createEmptyState();
    updatePatternAlignment(state, 3);

    expect(state.pattern_alignment.drifts).toBe(3);
    expect(state.pattern_alignment.last_checked).toBeTruthy();
  });

  it("overwrites previous drifts", () => {
    const state = createEmptyState();
    updatePatternAlignment(state, 5);
    updatePatternAlignment(state, 0);

    expect(state.pattern_alignment.drifts).toBe(0);
  });
});

describe("end-to-end persistence", () => {
  it("survives write → read → update → write → read cycle", () => {
    const state = createEmptyState();
    updateCoverage(state, [{ module: "m1", total_public: 10, documented: 8, coverage_pct: 80 }]);
    updateDocsApi(state, ["m1"]);
    updatePatternAlignment(state, 1);
    writeKDocState(TEST_ROOT, state);

    const read1 = readKDocState(TEST_ROOT)!;
    expect(read1.coverage.per_module["m1"].pct).toBe(80);

    updateCoverage(read1, [{ module: "m1", total_public: 10, documented: 10, coverage_pct: 100 }]);
    updatePatternAlignment(read1, 0);
    writeKDocState(TEST_ROOT, read1);

    const read2 = readKDocState(TEST_ROOT)!;
    expect(read2.coverage.per_module["m1"].pct).toBe(100);
    expect(read2.pattern_alignment.drifts).toBe(0);
    expect(read2.docs_api.modules_generated).toEqual(["m1"]);
  });
});
