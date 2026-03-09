/**
 * Shared JSONL file reader for audit and findings logs.
 *
 * Provides a generic, reusable reader that parses newline-delimited JSON
 * files. Used by audit-report, findings-report, and any future tools
 * that consume .jsonl logs.
 */
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";

/**
 * Read a JSONL file and return parsed entries.
 *
 * - Skips empty lines
 * - Skips malformed JSON lines (silently)
 * - Returns empty array if file does not exist
 *
 * @param logPath - Absolute path to the .jsonl file
 * @returns Array of parsed entries typed as T
 */
export async function readJsonlFile<T>(logPath: string): Promise<T[]> {
  if (!existsSync(logPath)) {
    return [];
  }

  const entries: T[] = [];
  const rl = createInterface({
    input: createReadStream(logPath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as T);
    } catch {
      // skip malformed lines silently
    }
  }

  return entries;
}

/**
 * Check whether a file exists on disk.
 */
export function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}
