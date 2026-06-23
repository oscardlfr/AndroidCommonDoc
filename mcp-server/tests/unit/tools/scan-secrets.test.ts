/**
 * Tests for the scan-secrets MCP tool.
 *
 * Integration tests use vi.mock(runScript) at the tool boundary — no real bash,
 * trufflehog, or PATH manipulation is involved. This makes outcomes deterministic
 * on every host/OS regardless of what scanners are installed.
 *
 * The shell-layer contract (scan-secrets.sh + PATH resolution + sentinel emission)
 * is covered separately by scripts/tests/scan-secrets-sh.bats.
 */
import {
  describe,
  it,
  expect,
  vi,
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
import { mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// ── vi.mock: hoist before any imports consume runScript ──────────────────────
//
// scan-secrets.ts imports runScript from script-runner.js. vi.mock is hoisted
// by Vitest so the mock factory runs before the module graph resolves, replacing
// runScript with a vi.fn() throughout the test file.

vi.mock("../../../src/utils/script-runner.js", () => ({
  runScript: vi.fn(),
  stripAnsi: (text: string) => text, // identity — tests don't need ANSI stripping
}));

// Import AFTER vi.mock so we get the mocked version.
import { runScript } from "../../../src/utils/script-runner.js";
const mockRunScript = runScript as ReturnType<typeof vi.fn>;

// ── Fixture management ────────────────────────────────────────────────────────
//
// TEST_ROOT is a real tmpdir passed as projectRoot for schema validation.
// No trufflehog binary, no PATH manipulation — runScript is mocked at the boundary.

const TEST_ROOT = path.join(os.tmpdir(), "scan-secrets-test-" + process.pid);

function ensureClean(): void {
  if (existsSync(TEST_ROOT)) {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  }
  mkdirSync(TEST_ROOT, { recursive: true });
}

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
});

afterAll(async () => {
  await client.close();
  await server.close();
});

beforeEach(() => {
  ensureClean();
  mockRunScript.mockReset();
});

afterEach(() => {
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("scan-secrets tool", () => {
  it("is listed as a tool", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "scan-secrets");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("TruffleHog");
  });

  // ── Deterministic integration tests (vi.mock-controlled runScript) ──────────
  //
  // Each test sets mockRunScript.mockResolvedValueOnce(...) to control exactly
  // what scan-secrets.ts receives from runScript. No bash, no trufflehog, no PATH.

  it("returns SKIPPED when scanner is absent (runScript returns SKIPPED sentinel)", async () => {
    mockRunScript.mockResolvedValueOnce({
      stdout: '{"status":"SKIPPED","reason":"trufflehog not installed"}\n',
      stderr: "",
      exitCode: 0,
    });

    const result = await callTool({ projectRoot: TEST_ROOT });
    const json = extractJson(extractText(result));

    expect(json.status).toBe("SKIPPED");
    expect(json).toHaveProperty("summary");
    expect(String(json.summary)).toBeTruthy();

    // Confirm the tool called runScript with the correct arguments
    expect(mockRunScript).toHaveBeenCalledWith(
      "scan-secrets",
      [TEST_ROOT],
      expect.any(String),
      60000,
    );
  });

  it("returns PASS+OK when scanner runs clean (runScript returns PASS sentinel)", async () => {
    mockRunScript.mockResolvedValueOnce({
      stdout: '{"status":"PASS","reason_code":"OK"}\n',
      stderr: "",
      exitCode: 0,
    });

    const result = await callTool({ projectRoot: TEST_ROOT });
    const json = extractJson(extractText(result));

    expect(json.status).toBe("PASS");
    expect(json.reason_code).toBe("OK");
    expect(Array.isArray(json.findings)).toBe(true);
    expect((json.findings as unknown[]).length).toBe(0);
  });

  it("returns FAIL+SCANNER_ERROR when scanner errors (runScript returns FAIL sentinel)", async () => {
    mockRunScript.mockResolvedValueOnce({
      stdout: '{"status":"FAIL","reason_code":"SCANNER_ERROR"}\n',
      stderr: "",
      exitCode: 1,
    });

    const result = await callTool({ projectRoot: TEST_ROOT });
    const json = extractJson(extractText(result));

    expect(json.status).toBe("FAIL");
    expect(json.reason_code).toBe("SCANNER_ERROR");
  });

  it("parses output structure correctly (PASS sentinel → status/findings/summary present)", async () => {
    mockRunScript.mockResolvedValueOnce({
      stdout: '{"status":"PASS","reason_code":"OK"}\n',
      stderr: "",
      exitCode: 0,
    });

    const result = await callTool({ projectRoot: TEST_ROOT });
    const json = extractJson(extractText(result));

    expect(json).toHaveProperty("status");
    expect(json).toHaveProperty("findings");
    expect(json).toHaveProperty("summary");

    expect(Array.isArray(json.findings)).toBe(true);
    expect(typeof json.summary).toBe("string");
    expect(json.status).toBe("PASS");
  });

  it("returns FAIL+SECRETS_FOUND when runScript returns CRITICAL JSONL finding (exitCode 0)", async () => {
    // Mirrors the SSS-4 bats test: scanner exits 0 with a JSONL finding line.
    // The tool's parseOutput detects CRITICAL severity → FAIL + SECRETS_FOUND.
    const criticalJsonl =
      '{"DetectorName":"AWS","severity":"CRITICAL","Raw":"AKIAIOSFODNN7EXAMPLE","Verified":true}';
    mockRunScript.mockResolvedValueOnce({
      stdout: criticalJsonl + "\n",
      stderr: "",
      exitCode: 0,
    });

    const result = await callTool({ projectRoot: TEST_ROOT });
    const json = extractJson(extractText(result));

    expect(json.status).toBe("FAIL");
    expect(json.reason_code).toBe("SECRETS_FOUND");
    expect(Array.isArray(json.findings)).toBe(true);
    expect((json.findings as unknown[]).length).toBe(1);
  });

  // ── parseOutput unit tests (pure function — no I/O, no mock needed) ─────────

  it("parseOutput returns FAIL+SECRETS_FOUND when JSONL contains CRITICAL severity finding", () => {
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
    const highFinding =
      '{"DetectorName":"GitHub","severity":"HIGH","Raw":"ghp_exampletoken123456"}';

    const result = parseOutput(highFinding);

    expect(result.status).toBe("FAIL");
    expect(result.reason_code).toBe("SECRETS_FOUND");
    expect(result.findings).toHaveLength(1);
    expect(result.summary).toContain("CRITICAL or HIGH");
  });

  it("parseOutput returns PASS+OK when findings are low severity only", () => {
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
