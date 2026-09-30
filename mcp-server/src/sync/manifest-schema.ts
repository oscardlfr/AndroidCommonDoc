/**
 * Manifest Schema for l0-manifest.json
 *
 * Supports two versions:
 * - v1: single l0_source (flat topology — original)
 * - v2: sources[] array with topology (chain or flat)
 *
 * v1 manifests are auto-migrated to v2 at read time. The on-disk format
 * can be either — readManifest handles both transparently.
 *
 * Topology:
 * - "flat": project consumes L0 directly (enterprise / standalone)
 * - "chain": project inherits from parent layers: L0 → L1 → L2
 *   Each source in the chain provides skills, agents, commands, docs, and rules.
 *   Resolution order: last source wins per entry name (L1 overrides L0).
 */

import { z } from "zod";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------------------
// Layer source schema (v2)
// ---------------------------------------------------------------------------

export const LayerSourceSchema = z.object({
  /** Layer identifier: L0, L1, L2, etc. */
  layer: z.string().min(1),
  /** Relative path from this project to the source layer root */
  path: z.string().min(1),
  /** Role hint for tooling */
  role: z.enum(["tooling", "ecosystem", "application"]).default("tooling"),
  /** Remote git URL for cloning when path doesn't exist locally */
  remote: z.string().url().optional(),
  /** Upstream repository slug read by consumer CI (e.g. l0-auto-sync.yml); never used to resolve the source. */
  repository: z.string().min(1).optional(),
  /** Upstream ref read by consumer CI; never used to resolve the source. */
  ref: z.string().min(1).optional(),
});

export type LayerSource = z.infer<typeof LayerSourceSchema>;

// ---------------------------------------------------------------------------
// Shared sub-schemas
// ---------------------------------------------------------------------------

const SelectionSchema = z.object({
  mode: z.enum(["include-all", "explicit"]),
  exclude_skills: z.array(z.string()).default([]),
  exclude_agents: z.array(z.string()).default([]),
  exclude_commands: z.array(z.string()).default([]),
  exclude_categories: z.array(z.string()).default([]),
  /** Hook filenames to exclude from sync (e.g. "project-specific-gate.js") */
  exclude_hooks: z.array(z.string()).default([]),
});

const L2SpecificSchema = z.object({
  commands: z.array(z.string()).default([]),
  agents: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
});

export const RuntimeConsumerSchema = z.object({
  schema: z.literal("runtime-consumer/v1"),
  enabled: z.literal(true),
  consumer_layer: z.enum(["L1", "L2"]),
  toolkit_commit: z.string().regex(/^[0-9a-f]{40}$/),
  toolkit_content_sha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export type RuntimeConsumer = z.infer<typeof RuntimeConsumerSchema>;

// ---------------------------------------------------------------------------
// v1 schema (original — single l0_source)
// ---------------------------------------------------------------------------

export const ManifestSchemaV1 = z.object({
  version: z.literal(1),
  l0_source: z.string().min(1),
  last_synced: z.string(),
  selection: SelectionSchema,
  checksums: z.record(z.string(), z.string()),
  l2_specific: L2SpecificSchema,
});

export type ManifestV1 = z.infer<typeof ManifestSchemaV1>;

// ---------------------------------------------------------------------------
// v2 schema (multi-source with topology)
// ---------------------------------------------------------------------------

export const ManifestSchemaV2 = z.object({
  version: z.literal(2),
  /** Architectural identity of this consumer. Independent of optional registry capabilities. */
  consumer_layer: z.enum(["L1", "L2"]).optional(),
  /** Ordered list of source layers (L0 first, then L1, etc.) */
  sources: z.array(LayerSourceSchema).min(1),
  /** "flat" = direct L0 consumption. "chain" = L0 → L1 → L2 cascade */
  topology: z.enum(["flat", "chain"]).default("flat"),
  last_synced: z.string(),
  selection: SelectionSchema,
  checksums: z.record(z.string(), z.string()),
  l2_specific: L2SpecificSchema,
  /** Migration IDs that have been applied to this manifest */
  migrations_applied: z.array(z.string()).optional().default([]),
  /** Explicit opt-in and immutable compatibility pin for the L0 runtime. */
  runtime: RuntimeConsumerSchema.optional(),
  /** L0 commit of the last sync, read by consumer CI. Advanced by sync only when the consumer already carries it. */
  l0Commit: z.string().regex(/^[0-9a-f]{40}$/).optional(),
});

export type ManifestV2 = z.infer<typeof ManifestSchemaV2>;

// ---------------------------------------------------------------------------
// Canonical type (always v2 shape internally)
// ---------------------------------------------------------------------------

/** Canonical manifest type — always v2 */
export type Manifest = ManifestV2;

/** Backward compat alias */
export const ManifestSchema = ManifestSchemaV2;

// ---------------------------------------------------------------------------
// Migration: v1 → v2
// ---------------------------------------------------------------------------

export function migrateV1toV2(v1: ManifestV1): ManifestV2 {
  return {
    version: 2,
    consumer_layer: undefined,
    sources: [{ layer: "L0", path: v1.l0_source, role: "tooling" }],
    topology: "flat",
    last_synced: v1.last_synced,
    selection: v1.selection,
    checksums: v1.checksums,
    l2_specific: v1.l2_specific,
    migrations_applied: [],
    runtime: undefined,
  };
}

// ---------------------------------------------------------------------------
// Validation + IO
// ---------------------------------------------------------------------------

/**
 * Parse and validate unknown data. v1 is auto-migrated to v2.
 */
export function validateManifest(data: unknown): Manifest {
  const v2Result = ManifestSchemaV2.safeParse(data);
  if (v2Result.success) return v2Result.data;

  const v1Result = ManifestSchemaV1.safeParse(data);
  if (v1Result.success) return migrateV1toV2(v1Result.data);

  // Throw the v2 error for diagnostics
  ManifestSchemaV2.parse(data);
  throw new Error("Unreachable");
}

export function createDefaultManifest(l0Source: string): Manifest {
  return {
    version: 2,
    consumer_layer: undefined,
    sources: [{ layer: "L0", path: l0Source, role: "tooling" }],
    topology: "flat",
    last_synced: new Date().toISOString(),
    selection: {
      mode: "include-all",
      exclude_skills: [],
      exclude_agents: [],
      exclude_commands: [],
      exclude_categories: [],
      exclude_hooks: [],
    },
    checksums: {},
    l2_specific: { commands: [], agents: [], skills: [] },
    migrations_applied: [],
    runtime: undefined,
  };
}

export function createChainManifest(sources: LayerSource[]): Manifest {
  return {
    version: 2,
    consumer_layer: undefined,
    sources,
    topology: "chain",
    last_synced: new Date().toISOString(),
    selection: {
      mode: "include-all",
      exclude_skills: [],
      exclude_agents: [],
      exclude_commands: [],
      exclude_categories: [],
      exclude_hooks: [],
    },
    checksums: {},
    l2_specific: { commands: [], agents: [], skills: [] },
    migrations_applied: [],
  };
}

export async function readManifest(filePath: string): Promise<Manifest> {
  const content = await readFile(filePath, "utf-8");
  const data: unknown = JSON.parse(content);
  return validateManifest(data);
}

export async function writeManifest(filePath: string, manifest: Manifest): Promise<void> {
  const json = JSON.stringify(manifest, null, 2) + "\n";
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.l0-manifest.json.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  try {
    await writeFile(temporaryPath, json, "utf-8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch {
      // The temporary file may not exist or may already have been renamed.
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get the L0 source path from any manifest */
export function getL0Source(manifest: Manifest): string {
  const l0 = manifest.sources.find((s) => s.layer === "L0");
  return l0?.path ?? manifest.sources[0].path;
}

/** Get all sources ordered by layer (L0 first) */
export function getOrderedSources(manifest: Manifest): LayerSource[] {
  return [...manifest.sources].sort((a, b) => a.layer.localeCompare(b.layer));
}

// ---------------------------------------------------------------------------
// Examples
// ---------------------------------------------------------------------------

export interface ExampleManifests {
  sharedLibs: Manifest;
  myApp: Manifest;
  myAppChain: Manifest;
}

export function generateExampleManifests(): ExampleManifests {
  const sharedLibs = createDefaultManifest("../AndroidCommonDoc");
  sharedLibs.selection.exclude_commands = ["start-track", "sync-roadmap", "merge-track"];
  sharedLibs.selection.exclude_categories = ["product"];

  const myApp = createDefaultManifest("../AndroidCommonDoc");

  const myAppChain = createChainManifest([
    { layer: "L0", path: "../../AndroidCommonDoc", role: "tooling" },
    { layer: "L1", path: "../../shared-kmp-libs", role: "ecosystem" },
  ]);

  return { sharedLibs, myApp, myAppChain };
}
