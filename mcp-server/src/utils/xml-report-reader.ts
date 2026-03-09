/**
 * Lightweight XML report parser for Kover, JaCoCo, and Detekt reports.
 *
 * Uses regex/string parsing (no xml2js dependency) since these are
 * simple counter-based XMLs with predictable structure.
 */
import { readFile } from "node:fs/promises";

export interface CoverageData {
  module: string;
  linePct: number;
  branchPct: number;
  missed: number;
  total: number;
}

export interface DetektData {
  module: string;
  violations: number;
  rules: string[];
}

/**
 * Parse a Kover XML coverage report.
 * Kover uses JaCoCo-compatible XML format.
 */
export async function parseKoverReport(
  xmlPath: string,
): Promise<CoverageData> {
  return parseJacocoReport(xmlPath);
}

/**
 * Parse a JaCoCo XML coverage report.
 * Extracts LINE and BRANCH counters from the root <report> element.
 */
export async function parseJacocoReport(
  xmlPath: string,
): Promise<CoverageData> {
  const content = await readFile(xmlPath, "utf-8");

  // Extract module name from <report name="...">
  const nameMatch = /<report\s+name="([^"]*)"/.exec(content);
  const module = nameMatch?.[1] ?? "unknown";

  // Extract counters: <counter type="LINE" missed="X" covered="Y"/>
  let lineMissed = 0;
  let lineCovered = 0;
  let branchMissed = 0;
  let branchCovered = 0;

  // Find root-level counters (last occurrences are the summary)
  const counterRegex =
    /<counter\s+type="(\w+)"\s+missed="(\d+)"\s+covered="(\d+)"\s*\/?>/g;
  let match: RegExpExecArray | null;
  while ((match = counterRegex.exec(content)) !== null) {
    const type = match[1];
    const missed = parseInt(match[2], 10);
    const covered = parseInt(match[3], 10);
    if (type === "LINE") {
      lineMissed = missed;
      lineCovered = covered;
    } else if (type === "BRANCH") {
      branchMissed = missed;
      branchCovered = covered;
    }
  }

  const lineTotal = lineMissed + lineCovered;
  const branchTotal = branchMissed + branchCovered;

  return {
    module,
    linePct: lineTotal > 0 ? Math.round((lineCovered / lineTotal) * 100) : 0,
    branchPct:
      branchTotal > 0 ? Math.round((branchCovered / branchTotal) * 100) : 0,
    missed: lineMissed,
    total: lineTotal,
  };
}

/**
 * Parse a Detekt XML report (Checkstyle format).
 * Counts <error> elements and extracts unique rule names.
 */
export async function parseDetektReport(
  xmlPath: string,
): Promise<DetektData> {
  const content = await readFile(xmlPath, "utf-8");

  // Extract module from first <file> element or filename
  const fileMatch = /<file\s+name="([^"]*)"/.exec(content);
  const module = fileMatch?.[1]?.split("/").find((p) => p.includes(":")) ?? "unknown";

  // Count <error> elements and extract rule sources
  const errorRegex = /<error[^>]+source="([^"]*)"[^>]*\/?>/g;
  const rules = new Set<string>();
  let violations = 0;
  let match: RegExpExecArray | null;

  while ((match = errorRegex.exec(content)) !== null) {
    violations++;
    rules.add(match[1]);
  }

  // Also handle <error> without source attribute
  const simpleErrorRegex = /<error\b[^>]*\/?>/g;
  const allErrors = content.match(simpleErrorRegex);
  if (allErrors && allErrors.length > violations) {
    violations = allErrors.length;
  }

  return {
    module,
    violations,
    rules: [...rules],
  };
}
