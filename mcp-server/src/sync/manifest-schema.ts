/**
 * Manifest Schema for l0-manifest.json
 *
 * Defines the schema that downstream L1/L2 projects use to declare which L0
 * skills, agents, and commands they adopt. Includes Zod-based validation,
 * default manifest generation, and type exports.
 *
 * The manifest is the declaration layer between the L0 registry and downstream
 * projects. The sync engine reads this to know what to materialize.
 */

import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";

/**
 * Zod schema for l0-manifest.json.
 *
 * Selection model: "include-all" (default) syncs everything except excluded items.
 * "explicit" requires explicit inclusion (future extension).
 *
 * l2_specific lists project-owned files that sync must never touch.
 * checksums maps relative paths to sha256:hex content hashes for drift detection.
 */
export const ManifestSchema = z.object({
  /** Schema version, currently always 1 */
  version: z.literal(1),

  /** Relative path from this project to AndroidCommonDoc (L0 root) */
  l0_source: z.string().min(1),

  /** ISO 8601 datetime of last successful sync */
  last_synced: z.string().datetime(),

  /** Selection configuration controlling which L0 assets to sync */
  selection: z.object({
    /** "include-all" syncs everything (minus excludes); "explicit" requires opt-in */
    mode: z.enum(["include-all", "explicit"]),

    /** Skill names to exclude from sync */
    exclude_skills: z.array(z.string()).default([]),

    /** Agent names to exclude from sync */
    exclude_agents: z.array(z.string()).default([]),

    /** Command names to exclude from sync */
    exclude_commands: z.array(z.string()).default([]),

    /** Category names to exclude (excludes all assets in that category) */
    exclude_categories: z.array(z.string()).default([]),
  }),

  /** Map of relative file paths to "sha256:{hex}" content hashes */
  checksums: z.record(z.string(), z.string()),

  /** Project-specific files that sync must never touch */
  l2_specific: z.object({
    /** Project-owned command names */
    commands: z.array(z.string()).default([]),

    /** Project-owned agent names */
    agents: z.array(z.string()).default([]),

    /** Project-owned skill names */
    skills: z.array(z.string()).default([]),
  }),
});

/** TypeScript type inferred from the Zod schema */
export type Manifest = z.infer<typeof ManifestSchema>;

/**
 * Parse and validate unknown data against the manifest schema.
 * @throws {ZodError} when data does not match the schema
 */
export function validateManifest(data: unknown): Manifest {
  return ManifestSchema.parse(data);
}

/**
 * Create a default include-all manifest for a new project.
 * Empty checksums and empty l2_specific, current timestamp for last_synced.
 */
export function createDefaultManifest(l0Source: string): Manifest {
  return {
    version: 1,
    l0_source: l0Source,
    last_synced: new Date().toISOString(),
    selection: {
      mode: "include-all",
      exclude_skills: [],
      exclude_agents: [],
      exclude_commands: [],
      exclude_categories: [],
    },
    checksums: {},
    l2_specific: {
      commands: [],
      agents: [],
      skills: [],
    },
  };
}

/**
 * Read a manifest JSON file from disk and validate it.
 * @throws on file read errors, JSON parse errors, or validation errors
 */
export async function readManifest(filePath: string): Promise<Manifest> {
  const content = await readFile(filePath, "utf-8");
  const data: unknown = JSON.parse(content);
  return validateManifest(data);
}

/**
 * Write a manifest to disk as JSON with 2-space indentation.
 * Adds a trailing newline for POSIX compliance.
 */
export async function writeManifest(
  filePath: string,
  manifest: Manifest,
): Promise<void> {
  const json = JSON.stringify(manifest, null, 2) + "\n";
  await writeFile(filePath, json, "utf-8");
}

/**
 * Example manifests documenting the expected content for the two downstream projects.
 * These are NOT written to the downstream projects yet (that happens in Plan 05 migration),
 * but establish the expected content and validate against the schema.
 */
export interface ExampleManifests {
  sharedLibs: Manifest;
  myApp: Manifest;
}

/**
 * Generate example manifests for a typical L1 shared library and an L2 app.
 * Both validated against ManifestSchema at creation time.
 *
 * L1 example: include-all, excludes GSD-specific commands and product docs category
 * L2 example: include-all, no exclusions (uses all L0), with example l2_specific items
 */
export function generateExampleManifests(): ExampleManifests {
  const now = new Date().toISOString();

  const sharedLibs: Manifest = {
    version: 1,
    l0_source: "../AndroidCommonDoc",
    last_synced: now,
    selection: {
      mode: "include-all",
      exclude_skills: [],
      exclude_agents: [],
      exclude_commands: [
        "start-track",
        "sync-roadmap",
        "merge-track",
      ],
      exclude_categories: ["product"],
    },
    checksums: {},
    l2_specific: {
      commands: [],
      agents: [],
      skills: [],
    },
  };

  const myApp: Manifest = {
    version: 1,
    l0_source: "../AndroidCommonDoc",
    last_synced: now,
    selection: {
      mode: "include-all",
      exclude_skills: [],
      exclude_agents: [],
      exclude_commands: [],
      exclude_categories: [],
    },
    checksums: {},
    l2_specific: {
      commands: [
        // Add your app-specific commands here
      ],
      agents: [
        // Add your app-specific agents here
      ],
      skills: [],
    },
  };

  // Validate both at creation time to ensure correctness
  ManifestSchema.parse(sharedLibs);
  ManifestSchema.parse(myApp);

  return { sharedLibs, myApp };
}
