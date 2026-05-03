/* eslint-disable no-console */
/**
 * CLI entrypoint for proguard-validate.
 *
 * Usage:
 *   node build/cli/proguard-validate.js --project-root /path/to/project
 *   node build/cli/proguard-validate.js --project-root /path --no-check-agp9-globals
 *   node build/cli/proguard-validate.js --project-root /path --sealed-parents com.example.Sealed
 */

import path from "node:path";
import { validateProguard } from "../tools/proguard-validator.js";
import { logger } from "../utils/logger.js";

interface CliOptions {
  projectRoot: string;
  checkAgp9Globals: boolean;
  checkPackagingType: boolean;
  sealedParents: string[];
}

function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);

  let projectRoot = process.cwd();
  let checkAgp9Globals = true;
  let checkPackagingType = true;
  let sealedParents: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    if (arg === "--project-root" && next) {
      projectRoot = path.resolve(next);
      i++;
    } else if (arg === "--check-agp9-globals") {
      checkAgp9Globals = true;
    } else if (arg === "--no-check-agp9-globals") {
      checkAgp9Globals = false;
    } else if (arg === "--check-packaging-type") {
      checkPackagingType = true;
    } else if (arg === "--no-check-packaging-type") {
      checkPackagingType = false;
    } else if (arg === "--sealed-parents" && next) {
      sealedParents = next
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      i++;
    }
  }

  return { projectRoot, checkAgp9Globals, checkPackagingType, sealedParents };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv);

  logger.info("ProGuard Validator CLI");
  logger.info(`Project: ${options.projectRoot}`);

  const result = await validateProguard({
    project_root: options.projectRoot,
    check_agp9_globals: options.checkAgp9Globals,
    check_packaging_type: options.checkPackagingType,
    sealed_parents: options.sealedParents,
  });

  process.stdout.write(result.markdown + "\n");

  if (result.hasErrors) {
    process.exit(1);
  }
}

main().catch((error) => {
  logger.warn(`Fatal: ${error}`);
  process.exit(2);
});
