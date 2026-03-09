/* eslint-disable no-console */
/**
 * CLI entry point for generating skills/registry.json.
 *
 * Usage: npx tsx src/cli/generate-registry.ts [root-dir]
 *
 * If root-dir is not specified, defaults to the parent of mcp-server/.
 */

import path from "node:path";
import { writeRegistry } from "../registry/skill-registry.js";

async function main(): Promise<void> {
  const rootDir =
    process.argv[2] ??
    path.resolve(import.meta.dirname, "..", "..", "..");

  console.log(`Generating registry for: ${rootDir}`);
  await writeRegistry(rootDir);
  console.log(`Registry written to: ${path.join(rootDir, "skills", "registry.json")}`);
}

main().catch((err) => {
  console.error("Failed to generate registry:", err);
  process.exit(1);
});
