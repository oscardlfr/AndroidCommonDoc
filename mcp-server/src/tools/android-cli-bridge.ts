/**
 * MCP tool: android-cli-bridge
 *
 * Narrow bridge to the two stateful Android CLI commands that change state
 * outside the process: `android run` (deploys an APK to a device) and
 * `android create` (writes files into the filesystem). Every other `android`
 * subcommand (docs, screen, layout, skills:list, sdk:list) is read-only and
 * can be invoked directly via Bash with the permission allowlist in
 * .claude/settings.json — this bridge intentionally does NOT re-export them.
 *
 * Why a tool for just two commands:
 *   - `android run --apks=...` deploys to a connected device. Mis-typed
 *     arguments (wrong target, wrong APK, wrong device) silently land
 *     broken builds on real devices. This tool validates APK paths exist,
 *     enforces an explicit device serial, and rejects production-tagged APKs
 *     unless the caller passes `confirm_production=true`.
 *   - `android create` writes new project/module files from templates. The
 *     tool enforces that the output path stays inside a caller-provided
 *     project root — no escaping to the user's home directory — and
 *     rejects names containing colons (AGP 9 flat-naming invariant).
 *
 * Everything else the CLI exposes is better served by Bash + the
 * `Bash(android:docs:*)` / `Bash(android:screen:*)` / `Bash(android:layout:*)`
 * permission rules. See docs/guides/agent-tool-permissions.md.
 */
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";

// ── Abstraction over spawn for testability ──────────────────────────────────

export type AndroidCliBridgeRunner = (
  args: string[],
  timeoutMs: number,
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

const defaultRunner: AndroidCliBridgeRunner = (args, timeoutMs) =>
  new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn("android", args, { windowsHide: true });
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        resolve({ stdout, stderr: stderr || `timed out after ${timeoutMs}ms`, exitCode: 124 });
      }
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c: string) => {
      stdout += c;
    });
    child.stderr.on("data", (c: string) => {
      stderr += c;
    });
    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ stdout, stderr: err.message, exitCode: 127 });
      }
    });
    child.on("close", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? 0 });
      }
    });
  });

// ── Validation — run ────────────────────────────────────────────────────────

export interface RunArgs {
  apks: string[];
  device_serial: string;
  activity?: string;
  component_type?: "ACTIVITY" | "SERVICE" | "WATCH_FACE" | "TILE" | "COMPLICATION" | "DECLARATIVE_WATCH_FACE";
  debug?: boolean;
  confirm_production?: boolean;
}

export interface ValidationError {
  ok: false;
  error: string;
  hint?: string;
}

export interface ValidationOk<T> {
  ok: true;
  value: T;
}

export type ValidationResult<T> = ValidationOk<T> | ValidationError;

/**
 * Validate an `android run` invocation.
 *
 * Rejects:
 * - empty `apks` array
 * - APK paths that do not resolve to existing files
 * - missing `device_serial` (the CLI allows implicit device selection, but we
 *   force explicit to avoid accidental deploy to the wrong phone on a
 *   multi-device machine)
 * - APKs whose basename contains "release" or "prod" unless
 *   `confirm_production` is explicitly true
 */
export function validateRunArgs(args: RunArgs): ValidationResult<string[]> {
  if (!args.apks || args.apks.length === 0) {
    return { ok: false, error: "At least one APK path is required (apks[])." };
  }
  for (const apk of args.apks) {
    if (!existsSync(apk)) {
      return {
        ok: false,
        error: `APK path does not exist: ${apk}`,
        hint: "Build the APK first (`./gradlew :app:assembleDebug`) or check the path.",
      };
    }
    const stat = statSync(apk);
    if (!stat.isFile()) {
      return { ok: false, error: `APK path is not a file: ${apk}` };
    }
  }
  if (!args.device_serial || args.device_serial.trim() === "") {
    return {
      ok: false,
      error: "device_serial is required.",
      hint: "Run `adb devices` to get the serial. Explicit serial is enforced to prevent mis-deploys on multi-device machines.",
    };
  }
  if (!args.confirm_production) {
    for (const apk of args.apks) {
      const base = path.basename(apk).toLowerCase();
      if (/(^|[-_])(release|prod|production)([-_.]|$)/.test(base)) {
        return {
          ok: false,
          error: `APK looks like a production build: ${apk}`,
          hint: "Pass `confirm_production: true` to deploy a release-tagged APK to a device.",
        };
      }
    }
  }

  const cliArgs = ["run"];
  cliArgs.push(`--apks=${args.apks.join(",")}`);
  cliArgs.push(`--device=${args.device_serial}`);
  if (args.activity) cliArgs.push(`--activity=${args.activity}`);
  if (args.component_type) cliArgs.push(`--type=${args.component_type}`);
  if (args.debug) cliArgs.push("--debug");
  return { ok: true, value: cliArgs };
}

// ── Validation — create ─────────────────────────────────────────────────────

export interface CreateArgs {
  template: string;
  name: string;
  output_dir: string;
  project_root: string;
  dry_run?: boolean;
  verbose?: boolean;
}

/**
 * Validate an `android create` invocation.
 *
 * Rejects:
 * - module names containing colons (AGP 9 flat-naming invariant)
 * - output_dir escaping project_root (path traversal guard)
 * - project_root that does not exist
 * - empty template / name
 */
export function validateCreateArgs(args: CreateArgs): ValidationResult<string[]> {
  if (!args.template || args.template.trim() === "") {
    return { ok: false, error: "template is required (see `android create --list-profiles`)." };
  }
  if (!args.name || args.name.trim() === "") {
    return { ok: false, error: "name is required." };
  }
  if (args.name.includes(":")) {
    return {
      ok: false,
      error: `Module name must be flat — no colons (got: ${args.name}).`,
      hint: "Use kebab-case (`core-json-api`) not nested paths (`core:json:api`). AGP 9+ requires flat names. See docs/gradle/gradle-patterns-agp9.md.",
    };
  }
  if (!args.project_root || args.project_root.trim() === "") {
    return { ok: false, error: "project_root is required." };
  }
  if (!existsSync(args.project_root)) {
    return { ok: false, error: `project_root does not exist: ${args.project_root}` };
  }

  const resolvedRoot = path.resolve(args.project_root);
  const resolvedOut = path.resolve(args.project_root, args.output_dir);
  // Path traversal guard: output_dir must be inside project_root.
  const rel = path.relative(resolvedRoot, resolvedOut);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return {
      ok: false,
      error: `output_dir escapes project_root: ${args.output_dir}`,
      hint: "Pass a path relative to project_root that stays inside it.",
    };
  }

  const cliArgs = ["create", args.template, `--name=${args.name}`, `--output=${resolvedOut}`];
  if (args.dry_run) cliArgs.unshift("create") /* preserve shape */;
  // Actually the CLI expects `--dry-run` as a flag after `create`, before the template.
  // Reconstruct: `android create [--dry-run] [--verbose] <template> --name=... --output=...`
  const reconstructed = ["create"];
  if (args.dry_run) reconstructed.push("--dry-run");
  if (args.verbose) reconstructed.push("--verbose");
  reconstructed.push(args.template, `--name=${args.name}`, `--output=${resolvedOut}`);
  return { ok: true, value: reconstructed };
}

// ── Error classifier (shared with android-layout-diff) ─────────────────────

function classifyError(
  stderr: string,
  exitCode: number,
): { kind: string; message: string } {
  if (exitCode === 124) return { kind: "timeout", message: stderr };
  if (/command not found|ENOENT|is not recognized/i.test(stderr)) {
    return {
      kind: "cli_missing",
      message: "Android CLI not on PATH. See docs/guides/getting-started/09-android-cli-windows.md",
    };
  }
  if (/AdbDeviceFailResponseException|device offline/i.test(stderr)) {
    return { kind: "adb_offline", message: "Device offline or unavailable." };
  }
  if (/more than one device/i.test(stderr)) {
    return { kind: "multi_device", message: "Multiple devices — pass explicit device_serial." };
  }
  return { kind: "unknown", message: stderr.trim().split("\n")[0] ?? `exit ${exitCode}` };
}

// ── Tool registration ───────────────────────────────────────────────────────

export function registerAndroidCliBridgeTool(
  server: McpServer,
  rateLimiter: RateLimiter,
  runner: AndroidCliBridgeRunner = defaultRunner,
): void {
  server.tool(
    "android-cli-bridge",
    "Narrow, validated bridge to the two stateful Android CLI commands: `android run` (deploy APK to device) and `android create` (scaffold module/project). Every other android subcommand is available via Bash with scoped permissions — see docs/guides/agent-tool-permissions.md.",
    {
      operation: z
        .enum(["run", "create"])
        .describe(
          "Which stateful operation to execute. 'run' deploys an APK; 'create' scaffolds a module.",
        ),
      // run-specific
      apks: z
        .array(z.string())
        .optional()
        .describe("[run] Absolute paths to APK files (one or more)."),
      device_serial: z
        .string()
        .optional()
        .describe(
          "[run] adb device serial. Explicit serial is required (prevents mis-deploy on multi-device hosts).",
        ),
      activity: z
        .string()
        .optional()
        .describe("[run] Fully-qualified activity name (e.g. .MainActivity)."),
      component_type: z
        .enum(["ACTIVITY", "SERVICE", "WATCH_FACE", "TILE", "COMPLICATION", "DECLARATIVE_WATCH_FACE"])
        .optional()
        .describe("[run] Target component type (defaults to ACTIVITY)."),
      debug: z.boolean().optional().describe("[run] Deploy in debug mode (attach debugger)."),
      confirm_production: z
        .boolean()
        .optional()
        .describe("[run] Must be true to deploy an APK whose name contains 'release' or 'prod'."),
      // create-specific
      template: z
        .string()
        .optional()
        .describe(
          "[create] Template slug (e.g. empty-activity-agp-9). List with Bash(android:create:list).",
        ),
      name: z
        .string()
        .optional()
        .describe("[create] Flat kebab-case module/project name (no colons)."),
      output_dir: z
        .string()
        .optional()
        .describe("[create] Destination directory, relative to project_root."),
      project_root: z
        .string()
        .optional()
        .describe("[create] Absolute project root (enforced as a containment boundary for output_dir)."),
      dry_run: z.boolean().optional().describe("[create] Preview template output without writing."),
      verbose: z.boolean().optional().describe("[create] Verbose scaffold output."),
      // common
      timeout_ms: z.number().int().min(1000).max(600_000).optional().default(120_000),
    },
    async (rawArgs) => {
      const rateLimitResponse = checkRateLimit(rateLimiter, "android-cli-bridge");
      if (rateLimitResponse) return rateLimitResponse;

      const {
        operation,
        timeout_ms,
        apks,
        device_serial,
        activity,
        component_type,
        debug,
        confirm_production,
        template,
        name,
        output_dir,
        project_root,
        dry_run,
        verbose,
      } = rawArgs;

      let cliArgs: string[];

      if (operation === "run") {
        const validation = validateRunArgs({
          apks: apks ?? [],
          device_serial: device_serial ?? "",
          activity,
          component_type,
          debug,
          confirm_production,
        });
        if (!validation.ok) return validationError(validation);
        cliArgs = validation.value;
      } else {
        const validation = validateCreateArgs({
          template: template ?? "",
          name: name ?? "",
          output_dir: output_dir ?? ".",
          project_root: project_root ?? "",
          dry_run,
          verbose,
        });
        if (!validation.ok) return validationError(validation);
        cliArgs = validation.value;
      }

      logger.info(`android-cli-bridge: ${operation} — args: ${cliArgs.join(" ")}`);

      const { stdout, stderr, exitCode } = await runner(cliArgs, timeout_ms);

      if (exitCode !== 0) {
        const { kind, message } = classifyError(stderr, exitCode);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: "ERROR",
                  operation,
                  kind,
                  summary: message,
                  stderr: stderr.trim().slice(0, 500),
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                status: "OK",
                operation,
                args: cliArgs,
                stdout: stdout.trim().slice(0, 2000),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}

function validationError(err: ValidationError) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            status: "ERROR",
            kind: "validation",
            summary: err.error,
            hint: err.hint,
          },
          null,
          2,
        ),
      },
    ],
    isError: true,
  };
}
