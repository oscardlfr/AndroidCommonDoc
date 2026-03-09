/**
 * Cross-platform script execution utility.
 *
 * Uses execFile (NOT exec) to prevent shell injection attacks.
 * Sets NO_COLOR=1 and ANDROID_COMMON_DOC in the child process
 * environment. All invocations have a configurable timeout.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

export interface ScriptResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Execute a shell script from the scripts/sh/ directory.
 *
 * @param scriptBaseName - Script name without .sh extension (e.g., "check-doc-freshness")
 * @param args - Arguments to pass to the script
 * @param rootDir - Root directory of the AndroidCommonDoc toolkit
 * @param timeoutMs - Maximum execution time in milliseconds (default: 30000)
 * @returns Script execution result with stdout, stderr, and exit code
 */
export async function runScript(
  scriptBaseName: string,
  args: string[],
  rootDir: string,
  timeoutMs = 30000,
): Promise<ScriptResult> {
  const scriptPath = path.join(
    rootDir,
    "scripts",
    "sh",
    `${scriptBaseName}.sh`,
  );

  try {
    const { stdout, stderr } = await execFileAsync(
      "bash",
      [scriptPath, ...args],
      {
        timeout: timeoutMs,
        env: {
          ...process.env,
          NO_COLOR: "1",
          ANDROID_COMMON_DOC: rootDir,
        },
        cwd: rootDir,
        maxBuffer: 10 * 1024 * 1024, // 10 MB
      },
    );

    return {
      stdout: stripAnsi(stdout),
      stderr: stripAnsi(stderr),
      exitCode: 0,
    };
  } catch (error: unknown) {
    const err = error as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      killed?: boolean;
    };

    // Timeout produces killed=true
    if (err.killed) {
      return {
        stdout: stripAnsi(err.stdout ?? ""),
        stderr: stripAnsi(err.stderr ?? "Script execution timed out"),
        exitCode: 124, // Standard timeout exit code
      };
    }

    // Script not found or other errors
    const exitCode =
      typeof err.code === "number"
        ? err.code
        : err.code === "ENOENT"
          ? 127
          : 1;

    return {
      stdout: stripAnsi(err.stdout ?? ""),
      stderr: stripAnsi(
        err.stderr ?? (error instanceof Error ? error.message : String(error)),
      ),
      exitCode,
    };
  }
}

/**
 * Strip ANSI escape sequences from text.
 *
 * Safety net in case NO_COLOR=1 is not respected by a script.
 */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}
