/**
 * Tests for the shared JSONL file reader utility.
 *
 * Covers: valid JSONL, empty lines, malformed lines, empty file,
 * and non-existent file scenarios.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readJsonlFile, fileExists } from "../../../src/utils/jsonl-reader.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Test fixture management ──────────────────────────────────────────────────

const TEST_DIR = path.join(os.tmpdir(), "jsonl-reader-test-" + process.pid);

function fixtureFile(name: string): string {
  return path.join(TEST_DIR, name);
}

function writeFixture(name: string, content: string): string {
  const p = fixtureFile(name);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content, "utf-8");
  return p;
}

afterEach(() => {
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

// ── Tests ────────────────────────────────────────────────────────────────────

interface SimpleEntry {
  id: number;
  name: string;
}

describe("readJsonlFile", () => {
  it("reads valid JSONL file", async () => {
    const content = [
      '{"id":1,"name":"alpha"}',
      '{"id":2,"name":"beta"}',
      '{"id":3,"name":"gamma"}',
    ].join("\n");

    const filePath = writeFixture("valid.jsonl", content);
    const result = await readJsonlFile<SimpleEntry>(filePath);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ id: 1, name: "alpha" });
    expect(result[1]).toEqual({ id: 2, name: "beta" });
    expect(result[2]).toEqual({ id: 3, name: "gamma" });
  });

  it("skips empty lines", async () => {
    const content = [
      '{"id":1,"name":"first"}',
      "",
      '{"id":2,"name":"second"}',
      "   ",
      '{"id":3,"name":"third"}',
    ].join("\n");

    const filePath = writeFixture("empty-lines.jsonl", content);
    const result = await readJsonlFile<SimpleEntry>(filePath);

    expect(result).toHaveLength(3);
    expect(result[0].id).toBe(1);
    expect(result[1].id).toBe(2);
    expect(result[2].id).toBe(3);
  });

  it("skips malformed JSON lines", async () => {
    const content = [
      '{"id":1,"name":"valid"}',
      "this is not json",
      '{"broken": }',
      '{"id":2,"name":"also-valid"}',
    ].join("\n");

    const filePath = writeFixture("malformed.jsonl", content);
    const result = await readJsonlFile<SimpleEntry>(filePath);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(1);
    expect(result[1].id).toBe(2);
  });

  it("returns empty array for empty file", async () => {
    const filePath = writeFixture("empty.jsonl", "");
    const result = await readJsonlFile<SimpleEntry>(filePath);

    expect(result).toEqual([]);
  });

  it("returns empty array for non-existent file", async () => {
    const result = await readJsonlFile<SimpleEntry>(
      path.join(TEST_DIR, "does-not-exist.jsonl"),
    );

    expect(result).toEqual([]);
  });

  it("handles file with only whitespace lines", async () => {
    const content = "\n  \n\t\n";
    const filePath = writeFixture("whitespace-only.jsonl", content);
    const result = await readJsonlFile<SimpleEntry>(filePath);

    expect(result).toEqual([]);
  });

  it("handles CRLF line endings", async () => {
    const content = '{"id":1,"name":"a"}\r\n{"id":2,"name":"b"}\r\n';
    const filePath = writeFixture("crlf.jsonl", content);
    const result = await readJsonlFile<SimpleEntry>(filePath);

    expect(result).toHaveLength(2);
  });
});

describe("fileExists", () => {
  it("returns true for existing file", () => {
    const filePath = writeFixture("exists.txt", "content");
    expect(fileExists(filePath)).toBe(true);
  });

  it("returns false for non-existent file", () => {
    expect(fileExists(path.join(TEST_DIR, "nope.txt"))).toBe(false);
  });
});
