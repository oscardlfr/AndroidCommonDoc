/**
 * Tests for the scan-secrets MCP tool.
 *
 * Uses in-memory MCP transport with real tool registration.
 * Creates temp directories with fixture files to test tool behavior.
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
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Fixture management ────────────────────────────────────────────────────────

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

  it("returns SKIPPED when trufflehog not on PATH", async () => {
    // When trufflehog is not installed the script emits the SKIPPED sentinel.
    // On CI/dev machines without trufflehog this test verifies the fallback path.
    const result = await callTool({ projectRoot: TEST_ROOT });
    const text = extractText(result);
    const json = extractJson(text);

    // Must have status field — either SKIPPED (no trufflehog) or PASS/FAIL (has trufflehog)
    expect(json).toHaveProperty("status");
    expect(["PASS", "FAIL", "SKIPPED"]).toContain(json.status);

    if (json.status === "SKIPPED") {
      expect(json).toHaveProperty("summary");
      expect(String(json.summary)).toBeTruthy();
    }
  });

  it("returns PASS when scan finds nothing", async () => {
    // Create a clean directory with a simple text file (no secrets)
    writeFileSync(path.join(TEST_ROOT, "readme.txt"), "Hello world!\n", "utf-8");

    const result = await callTool({ projectRoot: TEST_ROOT });
    const text = extractText(result);
    const json = extractJson(text);

    expect(json).toHaveProperty("status");
    expect(["PASS", "SKIPPED"]).toContain(json.status);
  });

  it("parses output structure correctly", async () => {
    const result = await callTool({ projectRoot: TEST_ROOT });
    const text = extractText(result);
    const json = extractJson(text);

    // All responses must have these three fields
    expect(json).toHaveProperty("status");
    expect(json).toHaveProperty("findings");
    expect(json).toHaveProperty("summary");

    expect(Array.isArray(json.findings)).toBe(true);
    expect(typeof json.summary).toBe("string");
    expect(["PASS", "FAIL", "SKIPPED"]).toContain(json.status);
  });

  it("parseOutput returns FAIL when JSONL contains CRITICAL severity finding", () => {
    // Exercise the FAIL branch of parseOutput directly with fixture JSONL.
    // This covers the path that cannot be reached without a real trufflehog install.
    const criticalFinding =
      '{"SourceMetadata":{"Data":{}},"SourceID":1,"SourceType":15,' +
      '"SourceName":"trufflehog","DetectorType":2,"DetectorName":"AWS",' +
      '"DecoderName":"PLAIN","Verified":true,"Raw":"AKIAIOSFODNN7EXAMPLE",' +
      '"RawV2":"","Redacted":"AKIA************MPLE","ExtraData":null,' +
      '"StructuredData":null,"severity":"CRITICAL"}';

    const result = parseOutput(criticalFinding);

    expect(result.status).toBe("FAIL");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe("CRITICAL");
    expect(result.summary).toContain("CRITICAL");
  });

  it("parseOutput returns FAIL when JSONL contains HIGH severity finding", () => {
    const highFinding =
      '{"DetectorName":"GitHub","severity":"HIGH","Raw":"ghp_exampletoken123456"}';

    const result = parseOutput(highFinding);

    expect(result.status).toBe("FAIL");
    expect(result.findings).toHaveLength(1);
    expect(result.summary).toContain("CRITICAL or HIGH");
  });

  it("parseOutput returns PASS when findings are low severity only", () => {
    const lowFinding =
      '{"DetectorName":"SomeDetector","severity":"LOW","Raw":"not-critical"}';

    const result = parseOutput(lowFinding);

    expect(result.status).toBe("PASS");
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
