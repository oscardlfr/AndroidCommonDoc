/**
 * Tests for xml-report-reader utility.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  parseKoverReport,
  parseJacocoReport,
  parseDetektReport,
} from "../../../src/utils/xml-report-reader.js";

const TEST_ROOT = path.join(
  os.tmpdir(),
  "xml-report-reader-test-" + process.pid,
);

function ensureClean(): void {
  if (existsSync(TEST_ROOT)) {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  }
  mkdirSync(TEST_ROOT, { recursive: true });
}

beforeEach(() => {
  ensureClean();
});

afterEach(() => {
  try {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

function writeFile(name: string, content: string): string {
  const filePath = path.join(TEST_ROOT, name);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

const JACOCO_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE report PUBLIC "-//JACOCO//DTD Report 1.1//EN" "report.dtd">
<report name="core-network">
  <package name="com/example/network">
    <class name="com/example/network/Client">
      <counter type="LINE" missed="5" covered="15"/>
      <counter type="BRANCH" missed="2" covered="8"/>
    </class>
  </package>
  <counter type="INSTRUCTION" missed="10" covered="90"/>
  <counter type="LINE" missed="20" covered="80"/>
  <counter type="BRANCH" missed="5" covered="15"/>
</report>`;

const DETEKT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<checkstyle version="4.3">
  <file name="src/main/kotlin/com/example/Foo.kt">
    <error line="10" column="5" severity="warning" message="Long method" source="detekt.LongMethod"/>
    <error line="25" column="1" severity="error" message="Empty catch" source="detekt.EmptyCatchBlock"/>
  </file>
  <file name="src/main/kotlin/com/example/Bar.kt">
    <error line="3" column="1" severity="warning" message="Long method" source="detekt.LongMethod"/>
  </file>
</checkstyle>`;

describe("parseJacocoReport", () => {
  it("parses valid JaCoCo/Kover report", async () => {
    const p = writeFile("report.xml", JACOCO_XML);
    const result = await parseJacocoReport(p);

    expect(result.module).toBe("core-network");
    expect(result.linePct).toBe(80); // 80/(80+20) = 80%
    expect(result.branchPct).toBe(75); // 15/(15+5) = 75%
    expect(result.missed).toBe(20);
    expect(result.total).toBe(100);
  });

  it("returns zero for empty report", async () => {
    const p = writeFile(
      "empty.xml",
      `<?xml version="1.0"?><report name="empty"></report>`,
    );
    const result = await parseJacocoReport(p);

    expect(result.module).toBe("empty");
    expect(result.linePct).toBe(0);
    expect(result.branchPct).toBe(0);
    expect(result.total).toBe(0);
  });

  it("throws for missing file", async () => {
    await expect(
      parseJacocoReport(path.join(TEST_ROOT, "nonexistent.xml")),
    ).rejects.toThrow();
  });
});

describe("parseKoverReport", () => {
  it("delegates to parseJacocoReport", async () => {
    const p = writeFile("kover.xml", JACOCO_XML);
    const result = await parseKoverReport(p);
    expect(result.module).toBe("core-network");
    expect(result.linePct).toBe(80);
  });
});

describe("parseDetektReport", () => {
  it("parses violations and rules", async () => {
    const p = writeFile("detekt.xml", DETEKT_XML);
    const result = await parseDetektReport(p);

    expect(result.violations).toBe(3);
    expect(result.rules).toContain("detekt.LongMethod");
    expect(result.rules).toContain("detekt.EmptyCatchBlock");
    expect(result.rules).toHaveLength(2); // unique rules
  });

  it("returns zero for clean report", async () => {
    const p = writeFile(
      "clean.xml",
      `<?xml version="1.0"?><checkstyle version="4.3"></checkstyle>`,
    );
    const result = await parseDetektReport(p);
    expect(result.violations).toBe(0);
    expect(result.rules).toEqual([]);
  });
});
