import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

import {
  cloneRemoteSource,
  cleanupClone,
} from "../../../src/sync/sync-engine.js";

// ---------------------------------------------------------------------------
// cloneRemoteSource + cleanupClone
// ---------------------------------------------------------------------------

describe("cloneRemoteSource", () => {
  let clonedDir: string | undefined;

  afterEach(() => {
    if (clonedDir && existsSync(clonedDir)) {
      cleanupClone(clonedDir);
    }
    clonedDir = undefined;
  });

  it("clones a local git repo as a remote URL (file:// protocol)", () => {
    // Create a temp git repo to use as "remote"
    const fakeRemote = mkdtempSync(join(tmpdir(), "fake-remote-"));
    execSync("git init", { cwd: fakeRemote, stdio: "pipe" });
    execSync("git config user.email test@test.com", { cwd: fakeRemote, stdio: "pipe" });
    execSync("git config user.name test", { cwd: fakeRemote, stdio: "pipe" });
    mkdirSync(join(fakeRemote, "skills"), { recursive: true });
    writeFileSync(join(fakeRemote, "skills", "registry.json"), '{"entries":[]}');
    execSync("git add -A && git commit -m init", { cwd: fakeRemote, stdio: "pipe", shell: "bash" });

    const fileUrl = `file://${fakeRemote.replace(/\\/g, "/")}`;
    clonedDir = cloneRemoteSource(fileUrl);

    expect(existsSync(clonedDir)).toBe(true);
    expect(existsSync(join(clonedDir, "skills", "registry.json"))).toBe(true);

    rmSync(fakeRemote, { recursive: true, force: true });
  });

  it("throws on invalid remote URL", () => {
    expect(() => cloneRemoteSource("https://example.com/nonexistent-repo-12345.git"))
      .toThrow(/Failed to clone/);
  });

  it("creates a unique temp directory per call", () => {
    const fakeRemote = mkdtempSync(join(tmpdir(), "fake-remote-"));
    execSync("git init", { cwd: fakeRemote, stdio: "pipe" });
    execSync("git config user.email test@test.com", { cwd: fakeRemote, stdio: "pipe" });
    execSync("git config user.name test", { cwd: fakeRemote, stdio: "pipe" });
    writeFileSync(join(fakeRemote, "file.txt"), "hello");
    execSync("git add -A && git commit -m init", { cwd: fakeRemote, stdio: "pipe", shell: "bash" });

    const fileUrl = `file://${fakeRemote.replace(/\\/g, "/")}`;
    const dir1 = cloneRemoteSource(fileUrl);
    const dir2 = cloneRemoteSource(fileUrl);

    expect(dir1).not.toBe(dir2);

    cleanupClone(dir1);
    cleanupClone(dir2);
    rmSync(fakeRemote, { recursive: true, force: true });
  });
});

describe("cleanupClone", () => {
  it("removes the cloned directory", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cleanup-test-"));
    writeFileSync(join(tempDir, "file.txt"), "data");
    expect(existsSync(tempDir)).toBe(true);

    cleanupClone(tempDir);
    expect(existsSync(tempDir)).toBe(false);
  });

  it("does not throw on nonexistent directory", () => {
    expect(() => cleanupClone("/nonexistent/path/12345")).not.toThrow();
  });
});
