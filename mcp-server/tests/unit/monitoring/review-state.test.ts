/**
 * Tests for the review state tracking system.
 *
 * Verifies persistence (load/save with atomic writes), filtering of
 * previously reviewed findings, and TTL-based re-surfacing of deferred
 * findings.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { MonitoringFinding } from "../../../src/registry/types.js";
import {
  loadReviewState,
  saveReviewState,
  filterNewFindings,
  type ReviewState,
  type ReviewEntry,
} from "../../../src/monitoring/review-state.js";

describe("review-state", () => {
  let tmpDir: string;
  let statePath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "review-state-test-"));
    statePath = path.join(tmpDir, "monitoring-state.json");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("loadReviewState", () => {
    it("returns empty state when file doesn't exist", async () => {
      const state = await loadReviewState(statePath);
      expect(state.schema_version).toBe(1);
      expect(state.last_run).toBeDefined();
      expect(Object.keys(state.findings)).toHaveLength(0);
    });

    it("reads back state saved by saveReviewState", async () => {
      const original: ReviewState = {
        schema_version: 1,
        last_run: "2026-03-14T00:00:00Z",
        findings: {
          abc123: {
            status: "accepted",
            reviewed_at: "2026-03-14T00:00:00Z",
            finding_hash: "abc123",
            reason: "Already handled",
          },
        },
      };

      await saveReviewState(statePath, original);
      const loaded = await loadReviewState(statePath);

      expect(loaded.schema_version).toBe(1);
      expect(loaded.last_run).toBe("2026-03-14T00:00:00Z");
      expect(loaded.findings["abc123"]).toBeDefined();
      expect(loaded.findings["abc123"].status).toBe("accepted");
      expect(loaded.findings["abc123"].reason).toBe("Already handled");
    });
  });

  describe("saveReviewState", () => {
    it("writes valid JSON with 2-space indent and cleans up temp file", async () => {
      const state: ReviewState = {
        schema_version: 1,
        last_run: "2026-03-14T00:00:00Z",
        findings: {},
      };

      await saveReviewState(statePath, state);

      // Verify the file exists and is valid JSON
      const raw = await fs.readFile(statePath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.schema_version).toBe(1);

      // Verify pretty-print (2-space indent)
      expect(raw).toContain("  ");
      expect(raw.startsWith("{")).toBe(true);

      // Verify temp file is cleaned up (no .tmp file should remain)
      const files = await fs.readdir(tmpDir);
      const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
      expect(tmpFiles).toHaveLength(0);
    });
  });

  describe("filterNewFindings", () => {
    const makeFinding = (hash: string, severity = "MEDIUM" as const): MonitoringFinding => ({
      slug: "test-doc",
      source_url: "https://example.com",
      severity,
      category: "version-drift",
      summary: `Finding ${hash}`,
      details: `Details for ${hash}`,
      finding_hash: hash,
    });

    it("removes findings whose hash matches an accepted entry", () => {
      const findings = [makeFinding("hash1"), makeFinding("hash2")];
      const state: ReviewState = {
        schema_version: 1,
        last_run: "2026-03-14T00:00:00Z",
        findings: {
          hash1: {
            status: "accepted",
            reviewed_at: "2026-03-14T00:00:00Z",
            finding_hash: "hash1",
          },
        },
      };

      const result = filterNewFindings(findings, state);
      expect(result).toHaveLength(1);
      expect(result[0].finding_hash).toBe("hash2");
    });

    it("removes findings whose hash matches a rejected entry", () => {
      const findings = [makeFinding("hash1"), makeFinding("hash2")];
      const state: ReviewState = {
        schema_version: 1,
        last_run: "2026-03-14T00:00:00Z",
        findings: {
          hash1: {
            status: "rejected",
            reviewed_at: "2026-03-14T00:00:00Z",
            finding_hash: "hash1",
          },
        },
      };

      const result = filterNewFindings(findings, state);
      expect(result).toHaveLength(1);
      expect(result[0].finding_hash).toBe("hash2");
    });

    it("re-surfaces deferred findings past TTL (default 90 days)", () => {
      const findings = [makeFinding("deferred-hash")];
      // Reviewed 100 days ago (past 90-day TTL)
      const reviewedAt = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();

      const state: ReviewState = {
        schema_version: 1,
        last_run: "2026-03-14T00:00:00Z",
        findings: {
          "deferred-hash": {
            status: "deferred",
            reviewed_at: reviewedAt,
            finding_hash: "deferred-hash",
          },
        },
      };

      const result = filterNewFindings(findings, state);
      expect(result).toHaveLength(1);
      expect(result[0].finding_hash).toBe("deferred-hash");
    });

    it("keeps deferred findings within TTL filtered out", () => {
      const findings = [makeFinding("deferred-hash")];
      // Reviewed 10 days ago (within 90-day TTL)
      const reviewedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

      const state: ReviewState = {
        schema_version: 1,
        last_run: "2026-03-14T00:00:00Z",
        findings: {
          "deferred-hash": {
            status: "deferred",
            reviewed_at: reviewedAt,
            finding_hash: "deferred-hash",
          },
        },
      };

      const result = filterNewFindings(findings, state);
      expect(result).toHaveLength(0);
    });

    it("respects deferred_until field over TTL calculation", () => {
      const findings = [makeFinding("deferred-hash")];
      // deferred_until is in the past -> should re-surface
      const pastDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

      const state: ReviewState = {
        schema_version: 1,
        last_run: "2026-03-14T00:00:00Z",
        findings: {
          "deferred-hash": {
            status: "deferred",
            reviewed_at: new Date().toISOString(),
            finding_hash: "deferred-hash",
            deferred_until: pastDate,
          },
        },
      };

      const result = filterNewFindings(findings, state);
      expect(result).toHaveLength(1);
    });

    it("keeps all findings when state has no reviewed entries", () => {
      const findings = [makeFinding("new1"), makeFinding("new2"), makeFinding("new3")];
      const state: ReviewState = {
        schema_version: 1,
        last_run: "2026-03-14T00:00:00Z",
        findings: {},
      };

      const result = filterNewFindings(findings, state);
      expect(result).toHaveLength(3);
    });
  });
});
