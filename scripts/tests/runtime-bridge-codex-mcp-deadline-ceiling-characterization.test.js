'use strict';

// Sequence 0 (final bounded MCP deadline repair): focused characterization of
// internal-search-mcp.cjs's CONTEXT_PROVIDER_MCP_TIMEOUT_MS ceiling raise
// (10s -> 20s). Proves: the exported ceiling is exactly 20s; a nearer
// request expiry still wins over the ceiling; connect/listTools/callTool
// draw down ONE shared operationDeadlineMs rather than each getting a fresh
// 20s window; and timeout/fail-closed behavior stays intact. Every case here
// uses injected fakes only -- never a real MCP SDK, child process, or
// network endpoint (same convention as runtime-bridge-codex-sequence15-
// characterization.test.js).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');
const { EventEmitter } = require('node:events');

const repoRoot = path.resolve(__dirname, '..', '..');
const moduleDir = path.join(repoRoot, 'scripts', 'lib', 'runtime-bridge-codex');
const { canonicalJSONStringify } = require(
  path.join(repoRoot, 'scripts', 'lib', 'runtime-consultation', 'primitives.cjs'),
);
const { createInternalSearchMcp } = require(path.join(moduleDir, 'internal-search-mcp.cjs'));

function mkTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function baseFactoryDeps(overrides) {
  return Object.assign({
    SESSION_RUN_KILL_CONFIRM_TIMEOUT_MS: 1000,
    SESSION_RUN_TERM_CONFIRM_TIMEOUT_MS: 1000,
    canonicalJSONStringify,
    createRequire: () => () => ({}),
    createSupervisorOwnedChildRegistry: () => ({ register: () => 1, unregister: () => {} }),
    fs,
    path,
    rc: { sha256Buffer: (buf) => crypto.createHash('sha256').update(buf).digest('hex') },
    stopOwnedAppServerChildBounded: async () => ({ stopped: true, escalated: false }),
    timerState: { isShuttingDown: () => false },
  }, overrides || {});
}

const {
  CONTEXT_PROVIDER_MCP_TIMEOUT_MS,
  remainingBoundedTimeoutMs,
  SEARCH_DOCS_DESCRIPTOR_INPUT_SCHEMA,
} = createInternalSearchMcp(baseFactoryDeps());

// ─────────────────────────────────────────────────────────────────────────────
// 1. The exported ceiling itself.
// ─────────────────────────────────────────────────────────────────────────────

test('CONTEXT_PROVIDER_MCP_TIMEOUT_MS is exactly 20 seconds', () => {
  assert.equal(CONTEXT_PROVIDER_MCP_TIMEOUT_MS, 20 * 1000);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. remainingBoundedTimeoutMs: a nearer request expiry still wins over the
//    ceiling, a farther one is capped at the ceiling, and an already-past
//    expiry is bounded at zero -- independent of the full MCP round trip.
// ─────────────────────────────────────────────────────────────────────────────

test('remainingBoundedTimeoutMs caps at the ceiling when the request expiry is far away', () => {
  const farExpiry = new Date(Date.now() + 3600 * 1000).toISOString();
  const remaining = remainingBoundedTimeoutMs(farExpiry, CONTEXT_PROVIDER_MCP_TIMEOUT_MS);
  assert.ok(remaining <= CONTEXT_PROVIDER_MCP_TIMEOUT_MS, 'must never exceed the ceiling');
  assert.ok(remaining > CONTEXT_PROVIDER_MCP_TIMEOUT_MS - 2000, 'a far-away expiry should leave the ceiling almost fully intact, got ' + remaining);
});

test('remainingBoundedTimeoutMs yields to a nearer request expiry instead of the ceiling', () => {
  const nearExpiry = new Date(Date.now() + 5000).toISOString();
  const remaining = remainingBoundedTimeoutMs(nearExpiry, CONTEXT_PROVIDER_MCP_TIMEOUT_MS);
  assert.ok(remaining < CONTEXT_PROVIDER_MCP_TIMEOUT_MS, 'a nearer expiry must win over the ceiling, got ' + remaining);
  assert.ok(remaining > 3000 && remaining <= 5000, 'expected roughly the 5s expiry window, got ' + remaining);
});

test('remainingBoundedTimeoutMs floors at zero for an already-past request expiry', () => {
  const pastExpiry = new Date(Date.now() - 1000).toISOString();
  assert.equal(remainingBoundedTimeoutMs(pastExpiry, CONTEXT_PROVIDER_MCP_TIMEOUT_MS), 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. runContextProviderInternalSearch dynamics, via a fully fake MCP SDK
//    (fake Client/StdioClientTransport injected through createRequire) --
//    never a real subprocess, network endpoint, or the genuine SDK.
// ─────────────────────────────────────────────────────────────────────────────

const FAKE_SEARCH_DOCS_TOOL = Object.freeze({
  name: 'search-docs',
  title: 'Search Docs',
  description: 'Search pattern docs by keyword across frontmatter and content. Returns scored results ranked by relevance.',
  execution: Object.freeze({ taskSupport: 'forbidden' }),
  inputSchema: SEARCH_DOCS_DESCRIPTOR_INPUT_SCHEMA,
});

// Builds a fake @modelcontextprotocol/sdk pair whose connect/listTools/
// callTool each record the `timeout` they were actually handed, so the test
// can observe whether it shrinks (one shared deadline) or resets (independent
// fresh windows) across stages. onConnect/onListTools optionally delay (or
// hang) after their timeout is recorded, before the fake resolves.
function makeFakeMcpHarness({ question, onConnect, onListTools }) {
  const recordedTimeouts = {};
  const fakeChild = new EventEmitter();
  class FakeStdioClientTransport {
    constructor() { this._process = null; this.stderr = null; }
    // Mirrors the real SDK's own synchronous-spawn-before-settle contract
    // (see internal-search-mcp.cjs's own comment on transport.start) --
    // production's adoptMcpChild reads transport._process synchronously
    // right after invoking this, never after it resolves.
    async start() { this._process = fakeChild; }
    async close() {}
  }
  class FakeClient {
    async connect(transport, opts) {
      recordedTimeouts.connect = opts.timeout;
      await transport.start();
      if (onConnect) await onConnect();
    }
    getServerVersion() { return { name: 'androidcommondoc', version: '1.0.0' }; }
    async listTools(_params, opts) {
      recordedTimeouts.listTools = opts.timeout;
      if (onListTools) await onListTools();
      return { tools: [FAKE_SEARCH_DOCS_TOOL] };
    }
    async callTool(_args, _resultSchema, opts) {
      recordedTimeouts.callTool = opts.timeout;
      return { isError: false, content: [{ type: 'text', text: JSON.stringify({ query: question, total: 0, matches: [] }) }] };
    }
    async close() {}
  }
  const createRequire = () => (specifier) => (
    specifier.endsWith('stdio.js') ? { StdioClientTransport: FakeStdioClientTransport } : { Client: FakeClient }
  );
  return { recordedTimeouts, createRequire };
}

function makeRunner(overrides) {
  return createInternalSearchMcp(baseFactoryDeps(overrides)).runContextProviderInternalSearch;
}

test('connect/listTools/callTool draw down one shared deadline -- each stage sees a strictly smaller remaining timeout, never a fresh ceiling-sized window', async () => {
  const question = 'mcp deadline ceiling: shared budget characterization';
  const { recordedTimeouts, createRequire } = makeFakeMcpHarness({
    question,
    onConnect: () => sleep(60),
    onListTools: () => sleep(60),
  });
  const run = makeRunner({ createRequire });
  const tempDir = mkTempDir('mcp-deadline-shared-');
  try {
    const result = await run(
      { projectRoot: tempDir, isolatedHome: tempDir, question, requestExpiry: new Date(Date.now() + 3600 * 1000).toISOString() },
      {},
    );
    assert.equal(result.ok, true);
    assert.ok(recordedTimeouts.connect <= CONTEXT_PROVIDER_MCP_TIMEOUT_MS);
    assert.ok(
      recordedTimeouts.connect > CONTEXT_PROVIDER_MCP_TIMEOUT_MS - 2000,
      'connect should see nearly the full 20s ceiling, got ' + recordedTimeouts.connect,
    );
    assert.ok(
      recordedTimeouts.connect - recordedTimeouts.listTools >= 20,
      'listTools must see a smaller remaining budget after connect\'s own elapsed time, not a fresh window (connect=' + recordedTimeouts.connect + ' listTools=' + recordedTimeouts.listTools + ')',
    );
    assert.ok(
      recordedTimeouts.listTools - recordedTimeouts.callTool >= 20,
      'callTool must see a smaller remaining budget after listTools\' own elapsed time, not a fresh window (listTools=' + recordedTimeouts.listTools + ' callTool=' + recordedTimeouts.callTool + ')',
    );
    assert.ok(recordedTimeouts.callTool < CONTEXT_PROVIDER_MCP_TIMEOUT_MS - 100, 'callTool must never be handed a fresh ceiling-sized window');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('a request expiry nearer than the ceiling still bounds the real operation, and a genuine hang times out closed well before the 20s ceiling', async () => {
  const question = 'mcp deadline ceiling: near-expiry timeout characterization';
  const { recordedTimeouts, createRequire } = makeFakeMcpHarness({
    question,
    onConnect: () => new Promise(() => {}), // never resolves -- a genuine hang past connect
  });
  const run = makeRunner({ createRequire });
  const tempDir = mkTempDir('mcp-deadline-hang-');
  try {
    const startedAt = Date.now();
    await assert.rejects(
      () => run(
        { projectRoot: tempDir, isolatedHome: tempDir, question, requestExpiry: new Date(Date.now() + 300).toISOString() },
        {},
      ),
      /mcp-search-timeout/,
    );
    const elapsedMs = Date.now() - startedAt;
    assert.ok(elapsedMs < 5000, 'a 300ms request expiry must fail closed in well under the 20s ceiling, took ' + elapsedMs + 'ms');
    assert.ok(
      recordedTimeouts.connect <= 300,
      'connect must be handed the nearer request-expiry-derived budget, not the full 20s ceiling, got ' + recordedTimeouts.connect,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('an already-expired request budget fails closed before ever touching the MCP SDK', async () => {
  const run = makeRunner({
    createRequire: () => { throw new Error('must never be called once the budget is already exhausted'); },
  });
  const tempDir = mkTempDir('mcp-deadline-expired-');
  try {
    await assert.rejects(
      () => run(
        { projectRoot: tempDir, isolatedHome: tempDir, question: 'q', requestExpiry: new Date(Date.now() - 1000).toISOString() },
        {},
      ),
      /mcp-search-deadline-expired/,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
