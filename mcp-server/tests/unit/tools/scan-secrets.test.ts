/**
 * Tests for the scan-secrets MCP tool.
 *
 * Uses in-memory MCP transport with real tool registration.
 * All integration tests use a PATH-controlled mock trufflehog binary so
 * outcomes are deterministic regardless of whether trufflehog is installed
 * on the host (trufflehog 3.95.6 is present on this host — without mocking
 * the result depends on what the scanner finds, making tests nondeterministic).
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerScanSecretsTool, parseOutput } from "../../../src/tools/scan-secrets.js";
import { RateLimiter } from "../../../src/utils/rate-limiter.js";
import { mkdirSync, writeFileSync, chmodSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Fixture management ────────────────────────────────────────────────────────

const TEST_ROOT = path.join(os.tmpdir(), "scan-secrets-test-" + process.pid);
const MOCK_BIN_DIR = path.join(os.tmpdir(), "scan-secrets-mock-bin-" + process.pid);

function ensureClean(): void {
  if (existsSync(TEST_ROOT)) {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  }
  mkdirSync(TEST_ROOT, { recursive: true });
}

// ── Mock trufflehog factory ───────────────────────────────────────────────────
//
// Mirrors the bats `make_mock_trufflehog` factory pattern (from secret-scan-report.bats).
// Creates a mock trufflehog shell script at MOCK_BIN_DIR/trufflehog.
// The tool's runScript child process inherits process.env.PATH, so prepending
// MOCK_BIN_DIR to PATH makes the tool find this mock instead of the real binary.
//
// Parameters:
//   scanRc     — exit code for filesystem subcommand invocations (0 = success)
//   scanOutput — stdout emitted during the filesystem scan (empty = 0 findings)
//
// The mock binary is recreated per-test so each test controls its own behavior.

function makeMockTrufflehog(scanRc: number, scanOutput: string): void {
  mkdirSync(MOCK_BIN_DIR, { recursive: true });
  const binPath = path.join(MOCK_BIN_DIR, "trufflehog");
  // Use sh (POSIX) for cross-platform compatibility on this Windows+Git-Bash host.
  // printf instead of echo -n for portability.
  const script = [
    "#!/usr/bin/env sh",
    'if [ "$1" = "--version" ]; then',
    "  printf 'trufflehog 3.82.0-mock\\n'",
    "  exit 0",
    "fi",
    "# filesystem sub-command",
    scanOutput.length > 0
      ? `printf '%s' '${scanOutput.replace(/'/g, "'\\''")}'`
      : "# no output",
    `exit ${scanRc}`,
    "",
  ].join("\n");
  writeFileSync(binPath, script, { encoding: "utf-8" });
  chmodSync(binPath, 0o755);
}

// Save/restore original PATH so each test controls the trufflehog resolution.
let originalPath: string;

// ── MCP client/server lifecycle ───────────────────────────────────────────────

let client: Client;
let server: McpServer;

beforeAll(async () => {
  server = new McpServer({ name: "test", version: "1.0.0" });
  const limiter = new RateLimiter(100, 60000);
  registerScanSecretsTool(server, limiter);

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);

  originalPath = process.env.PATH ?? "";
});

afterAll(async () => {
  await client.close();
  await server.close();
  // Restore PATH
  process.env.PATH = originalPath;
  // Cleanup mock bin dir
  try {
    rmSync(MOCK_BIN_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

beforeEach(() => {
  ensureClean();
  // Restore PATH before each test so tests that don't set it get the original.
  process.env.PATH = originalPath;
});

afterEach(() => {
  // Always restore PATH after each test
  process.env.PATH = originalPath;
  try {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors on Windows
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function callTool(args: Record<string, unknown>) {
  return client.callTool({
    name: "scan-secrets",
    arguments: args,
  });
}

function extractText(result: Awaited<ReturnType<typeof callTool>>): string {
  return (result.content[0] as { type: "text"; text: string }).text;
}

function extractJson(text: string): Record<string, unknown> {
  return JSON.parse(text);
}

// PATH separator: colon on POSIX, semicolon on Windows (but bash on this host uses colon)
const PATH_SEP = process.platform === "win32" ? ";" : ":";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("scan-secrets tool", () => {
  it("is listed as a tool", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "scan-secrets");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("TruffleHog");
  });

  // ── Deterministic integration tests (mock-controlled PATH) ─────────────────
  //
  // The tool's runScript child inherits process.env.PATH. We prepend MOCK_BIN_DIR
  // (containing a mock `trufflehog`) or use a PATH without trufflehog to control
  // exactly which branch the tool takes. This eliminates host-trufflehog nondeterminism.

  it("returns SKIPPED when trufflehog not on PATH (mock-absent)", async () => {
    // Remove any directory containing a trufflehog binary from PATH.
    // We do this by filtering the original PATH entries — this preserves system
    // utilities that bash scripts need (printf, wc, etc.) while ensuring trufflehog
    // is not findable via PATH. A dedicated empty dir alone is too aggressive on
    // Windows/Git-Bash where some utilities are external (not bash builtins).
    const filteredPath = originalPath
      .split(PATH_SEP)
      .filter((dir) => {
        // Exclude dirs that contain a trufflehog binary.
        // Also exclude any mock bin dir from prior tests.
        if (!dir) return false;
        // Convert Windows paths to forward-slash form for existsSync
        const th = path.join(dir, "trufflehog");
        const thExe = path.join(dir, "trufflehog.exe");
        return !existsSync(th) && !existsSync(thExe);
      })
      .join(PATH_SEP);

    process.env.PATH = filteredPath;

    const result = await callTool({ projectRoot: TEST_ROOT });
    const text = extractText(result);
    const json = extractJson(text);

    // Exact assertion: absent trufflehog → SKIPPED
    expect(json.status).toBe("SKIPPED");
    expect(json).toHaveProperty("summary");
    expect(String(json.summary)).toBeTruthy();
  });

  it("returns PASS when mock trufflehog runs clean (exit 0, empty stdout)", async () => {
    // Mock: exit 0, empty stdout → scan-secrets.sh emits PASS sentinel → parseOutput → PASS
    makeMockTrufflehog(0, "");
    process.env.PATH = MOCK_BIN_DIR + PATH_SEP + originalPath;

    const result = await callTool({ projectRoot: TEST_ROOT });
    const text = extractText(result);
    const json = extractJson(text);

    // Exact assertion: mock-clean trufflehog → PASS + reason_code OK
    expect(json.status).toBe("PASS");
    expect(json.reason_code).toBe("OK");
    expect(Array.isArray(json.findings)).toBe(true);
    expect((json.findings as unknown[]).length).toBe(0);
  });

  it("returns FAIL+SCANNER_ERROR when mock trufflehog exits non-zero", async () => {
    // Mock: exit 1 → scan-secrets.sh emits FAIL+SCANNER_ERROR sentinel → parseOutput → FAIL
    makeMockTrufflehog(1, "");
    process.env.PATH = MOCK_BIN_DIR + PATH_SEP + originalPath;

    const result = await callTool({ projectRoot: TEST_ROOT });
    const text = extractText(result);
    const json = extractJson(text);

    // Exact assertion: mock-error trufflehog → FAIL + SCANNER_ERROR
    expect(json.status).toBe("FAIL");
    expect(json.reason_code).toBe("SCANNER_ERROR");
  });

  it("parses output structure correctly (mock-clean scan)", async () => {
    // Use mock-clean path so the structure assertions are deterministic.
    makeMockTrufflehog(0, "");
    process.env.PATH = MOCK_BIN_DIR + PATH_SEP + originalPath;

    const result = await callTool({ projectRoot: TEST_ROOT });
    const text = extractText(result);
    const json = extractJson(text);

    // All responses must have these three fields
    expect(json).toHaveProperty("status");
    expect(json).toHaveProperty("findings");
    expect(json).toHaveProperty("summary");

    expect(Array.isArray(json.findings)).toBe(true);
    expect(typeof json.summary).toBe("string");
    // With mock-clean path, status is exactly PASS
    expect(json.status).toBe("PASS");
  });

  // ── parseOutput unit tests (pure function, no I/O, no PATH dependency) ─────

  it("parseOutput returns FAIL+SECRETS_FOUND when JSONL contains CRITICAL severity finding", () => {
    // BLOCKER 3: assert reason_code in addition to status.
    const criticalFinding =
      '{"SourceMetadata":{"Data":{}},"SourceID":1,"SourceType":15,' +
      '"SourceName":"trufflehog","DetectorType":2,"DetectorName":"AWS",' +
      '"DecoderName":"PLAIN","Verified":true,"Raw":"AKIAIOSFODNN7EXAMPLE",' +
      '"RawV2":"","Redacted":"AKIA************MPLE","ExtraData":null,' +
      '"StructuredData":null,"severity":"CRITICAL"}';

    const result = parseOutput(criticalFinding);

    expect(result.status).toBe("FAIL");
    expect(result.reason_code).toBe("SECRETS_FOUND");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe("CRITICAL");
    expect(result.summary).toContain("CRITICAL");
  });

  it("parseOutput returns FAIL+SECRETS_FOUND when JSONL contains HIGH severity finding", () => {
    // BLOCKER 3: assert reason_code in addition to status.
    const highFinding =
      '{"DetectorName":"GitHub","severity":"HIGH","Raw":"ghp_exampletoken123456"}';

    const result = parseOutput(highFinding);

    expect(result.status).toBe("FAIL");
    expect(result.reason_code).toBe("SECRETS_FOUND");
    expect(result.findings).toHaveLength(1);
    expect(result.summary).toContain("CRITICAL or HIGH");
  });

  it("parseOutput returns PASS+OK when findings are low severity only", () => {
    // BLOCKER 3: assert reason_code in addition to status.
    const lowFinding =
      '{"DetectorName":"SomeDetector","severity":"LOW","Raw":"not-critical"}';

    const result = parseOutput(lowFinding);

    expect(result.status).toBe("PASS");
    expect(result.reason_code).toBe("OK");
    expect(result.findings).toHaveLength(1);
    expect(result.summary).toContain("no CRITICAL or HIGH");
  });

  // ── parseOutput exact-contract cases (Fix 2: fail-closed empty/non-JSON) ──────
  //
  // CONTRACT CHANGE: empty output and non-JSON output now fail-closed.
  // Prior behavior: empty → PASS, non-JSON → PASS (open/permissive).
  // New behavior:   empty → FAIL+SCANNER_ERROR, non-JSON → FAIL+SCANNER_ERROR.
  // Rationale: bare empty stdout is NEVER a legitimate clean signal; non-JSON
  // output indicates the scanner errored before producing structured output.
  // These are intentional fail-closed changes, NOT weakening of existing tests.

  it("parseOutput('') → FAIL + reason_code SCANNER_ERROR (contract change: empty now fail-closed)", () => {
    const result = parseOutput("");
    expect(result.status).toBe("FAIL");
    expect(result.reason_code).toBe("SCANNER_ERROR");
  });

  it("parseOutput non-JSON → FAIL + reason_code SCANNER_ERROR (contract change: non-JSON now fail-closed)", () => {
    const result = parseOutput("not json\n");
    expect(result.status).toBe("FAIL");
    expect(result.reason_code).toBe("SCANNER_ERROR");
  });

  it("parseOutput PASS sentinel → status PASS + reason_code OK", () => {
    const result = parseOutput('{"status":"PASS","reason_code":"OK"}');
    expect(result.status).toBe("PASS");
    expect(result.reason_code).toBe("OK");
  });

  it("parseOutput FAIL sentinel → status FAIL + reason_code SCANNER_ERROR", () => {
    const result = parseOutput('{"status":"FAIL","reason_code":"SCANNER_ERROR"}');
    expect(result.status).toBe("FAIL");
    expect(result.reason_code).toBe("SCANNER_ERROR");
  });

  it("parseOutput SKIPPED sentinel → status SKIPPED (unchanged by Fix 2)", () => {
    const result = parseOutput('{"status":"SKIPPED","reason":"trufflehog not installed"}');
    expect(result.status).toBe("SKIPPED");
  });
});
