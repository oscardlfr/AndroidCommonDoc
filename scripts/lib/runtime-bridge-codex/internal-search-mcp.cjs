'use strict';

// The retained context-provider's bounded internal search-docs MCP round trip, plus the shared timing/size constants and generic validators the surrounding retained-worker/turn-projection/context7 concerns also consume.

function createInternalSearchMcp({
  SESSION_RUN_KILL_CONFIRM_TIMEOUT_MS,
  SESSION_RUN_TERM_CONFIRM_TIMEOUT_MS,
  canonicalJSONStringify,
  createRequire,
  createSupervisorOwnedChildRegistry,
  fs,
  path,
  rc,
  stopOwnedAppServerChildBounded,
  timerState,
}) {
const RETAINED_WORKER_POLL_INTERVAL_MS = 250;
// The retained service loop ticks four times a second; re-proving the session generation is a small
// registry read, so it is throttled to once every five seconds. That is an order of magnitude
// inside the launcher's existing 45-second owned-teardown wait, so a retirement is observed and the
// ordinary owned shutdown completes well within it -- without turning a 250ms loop into a registry
// scanner. Not a scheduler, a heartbeat or a new authority: a throttle on a check that already
// exists, run inside a loop that already exists.
const RETAINED_SESSION_GENERATION_RECHECK_INTERVAL_MS = 5 * 1000;
const RETAINED_WORKER_HEARTBEAT_INTERVAL_MS = 60 * 1000;
const BOOTSTRAP_TURN_TIMEOUT_MS = 30 * 1000;
// P1-A (sequence123-codex-r129-binding.md section5): the bootstrap thread's
// own archive is housekeeping ("so an idle READY worker advertises
// thread_id:null"), never itself proof of a genuine root/worker capability
// -- BORN+INITIALIZED+LOGIN+THREAD_START+bootstrap-READY+root-finalized (the
// readyPromise's own documented resolution predicate) says nothing about
// archive. A short, dedicated bound -- distinct from the general 10s RPC
// ceiling -- keeps an uncooperative/silent transport from adding real
// multi-second latency to every startup for a step whose OWN failure is
// deliberately never fatal to it (see the call site's own comment).
const BOOTSTRAP_ARCHIVE_TIMEOUT_MS = 3 * 1000;
// P1-A: bound for the coordinator-driven turnInterrupt race in
// waitForValidatedTurnCompletion (see its own comment) -- comfortably
// inside stage2's own 12s admitted-work join budget (section5), leaving
// headroom for the child-stop stages that already ran before it.
const STOP_SIGNAL_INTERRUPT_BOUND_MS = 4 * 1000;
// §16c: 20 seconds bounds the ENTIRE internal MCP search (connect+
// initialize+listTools+callTool combined), not 20s per stage -- see
// runContextProviderInternalSearch's operationDeadlineMs. PLAN.md
// ~L1146-1167 measured this same dedicated MCP composition at ~5.963s total
// (connect ~5.182s, search ~0.778s) over WSL on /mnt/c, versus ~0.34s
// native -- the prior frozen 10s ceiling left only ~4s of headroom there and
// started failing closed under real sequential-batch contention
// (ROOT-INGRESS-E2E, S16-CP-EVIDENCE-MCP-CLEANUP-01) even though each case
// passes alone. Still one shared budget, never a fresh window per stage,
// and still capped by the request/session expiry (normally 3600s) via
// remainingBoundedTimeoutMs -- raising this ceiling never extends authority.
const CONTEXT_PROVIDER_MCP_TIMEOUT_MS = 20 * 1000;
const CONTEXT_PROVIDER_MCP_STDOUT_CAP = 1024 * 1024;
const CONTEXT_PROVIDER_MCP_STDERR_CAP = 64 * 1024;
const CONTEXT_PROVIDER_MCP_TEXT_CAP = 64 * 1024;
const CONTEXT7_SEARCH_RESPONSE_CAP = 256 * 1024;
const CONTEXT7_CONTEXT_RESPONSE_CAP = 1024 * 1024;
const CONTEXT7_REQUEST_TIMEOUT_MS = 10 * 1000;
const HOST_PATTERN_EVIDENCE_PROJECTED_TEXT_CAP = 60 * 1024;
const HOST_PATTERN_EVIDENCE_TURN_INPUT_CAP = 64 * 1024;
const TURN_READ_PROJECTION_FILE_CAP = 10 * 1024 * 1024;
const TURN_READ_PROJECTION_TOTAL_CAP = 20 * 1024 * 1024;
const TURN_READ_PROJECTION_ENTRY_CAP = 256;

const SEARCH_DOCS_MATCH_KEYS_REQUIRED = Object.freeze(['score', 'slug', 'title', 'uri']);
const SEARCH_DOCS_MATCH_KEYS_OPTIONAL = Object.freeze(['category', 'description']);
const SEARCH_DOCS_DESCRIPTOR_INPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Search query — matched against slug, description, scope, targets, and content',
    },
    category: {
      type: 'string',
      description: "Filter to a specific doc category (e.g., 'testing', 'architecture', 'security')",
    },
  },
  required: ['query'],
  additionalProperties: false,
  $schema: 'http://json-schema.org/draft-07/schema#',
});

function remainingBoundedTimeoutMs(expiry, maximumMs) {
  const expiryMs = Date.parse(expiry);
  if (!Number.isFinite(expiryMs)) return 0;
  return Math.max(0, Math.min(maximumMs, expiryMs - Date.now()));
}

function isBoundedUtf8String(value, maximumBytes, allowEmpty) {
  return typeof value === 'string'
    && (allowEmpty === true || value.length > 0)
    && Buffer.byteLength(value, 'utf8') <= maximumBytes;
}

function exactObjectKeys(value, expected) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === expected.slice().sort().join('\0');
}

function validateSearchDocsDescriptor(tool) {
  if (!tool || typeof tool !== 'object' || Array.isArray(tool)) return false;
  if (!exactObjectKeys(tool, ['description', 'execution', 'inputSchema', 'name', 'title'])) return false;
  if (
    tool.name !== 'search-docs' || tool.title !== 'Search Docs'
    || tool.description !== 'Search pattern docs by keyword across frontmatter and content. Returns scored results ranked by relevance.'
    || !exactObjectKeys(tool.execution, ['taskSupport']) || tool.execution.taskSupport !== 'forbidden'
  ) return false;
  return canonicalJSONStringify(tool.inputSchema) === canonicalJSONStringify(SEARCH_DOCS_DESCRIPTOR_INPUT_SCHEMA);
}

function validateInternalSearchPayload(value, exactQuery) {
  if (!exactObjectKeys(value, ['matches', 'query', 'total'])) throw new Error('mcp-search-result-shape-invalid');
  if (value.query !== exactQuery || !Array.isArray(value.matches) || !Number.isInteger(value.total)) {
    throw new Error('mcp-search-result-correlation-invalid');
  }
  if (value.total !== value.matches.length || value.total < 0 || value.total > 20) {
    throw new Error('mcp-search-result-cardinality-invalid');
  }
  for (const match of value.matches) {
    if (!match || typeof match !== 'object' || Array.isArray(match)) throw new Error('mcp-search-match-invalid');
    const keys = Object.keys(match);
    if (SEARCH_DOCS_MATCH_KEYS_REQUIRED.some((key) => !keys.includes(key))) throw new Error('mcp-search-match-missing-key');
    if (keys.some((key) => !SEARCH_DOCS_MATCH_KEYS_REQUIRED.includes(key) && !SEARCH_DOCS_MATCH_KEYS_OPTIONAL.includes(key))) {
      throw new Error('mcp-search-match-extra-key');
    }
    if (
      !isBoundedUtf8String(match.slug, 512)
      || !isBoundedUtf8String(match.title, 1024)
      || (match.description !== undefined && !isBoundedUtf8String(match.description, 4096, true))
      || (match.category !== undefined && !isBoundedUtf8String(match.category, 512, true))
      || typeof match.score !== 'number' || !Number.isFinite(match.score) || match.score < 0
      || match.uri !== 'docs://androidcommondoc/' + match.slug
    ) throw new Error('mcp-search-match-value-invalid');
  }
  return value;
}

function canonicalInternalSearchSummary(value) {
  const summary = {
    query: value.query,
    total: value.total,
    matches: value.matches.map((match) => {
      const projected = {
        slug: match.slug,
        title: match.title,
        score: match.score,
        uri: match.uri,
      };
      if (match.category !== undefined) projected.category = match.category;
      return projected;
    }),
  };
  const text = canonicalJSONStringify(summary);
  if (Buffer.byteLength(text, 'utf8') > HOST_PATTERN_EVIDENCE_PROJECTED_TEXT_CAP) {
    throw new Error('mcp-search-summary-too-large');
  }
  return text;
}

function closedMcpEnvironment(projectRoot, isolatedHome) {
  if (process.platform !== 'win32') {
    return {
      ANDROID_COMMON_DOC: projectRoot,
      HOME: isolatedHome,
      LOGNAME: 'runtime',
      PATH: '',
      SHELL: '',
      TERM: 'dumb',
      USER: 'runtime',
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
      ALL_PROXY: '',
      NO_PROXY: '*',
    };
  }
  const boundedHost = (key) => {
    const value = process.env[key];
    if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > 4096 || /[\x00-\x1f\x7f]/.test(value)) {
      throw new Error('mcp-windows-host-environment-invalid:' + key);
    }
    return value;
  };
  const userRoot = path.join(isolatedHome, 'mcp-user');
  const tempRoot = path.join(isolatedHome, 'mcp-temp');
  const processorArchitecture = Object.freeze({
    ia32: 'x86',
    x64: 'AMD64',
    arm64: 'ARM64',
  })[process.arch];
  if (!processorArchitecture) {
    throw new Error('mcp-windows-host-environment-invalid:process.arch');
  }
  fs.mkdirSync(path.join(userRoot, 'AppData', 'Roaming'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(userRoot, 'AppData', 'Local'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(tempRoot, { recursive: true, mode: 0o700 });
  const userRootVolume = path.parse(userRoot).root;
  return {
    APPDATA: path.join(userRoot, 'AppData', 'Roaming'),
    HOMEDRIVE: userRootVolume.replace(/[\\/]$/, ''),
    HOMEPATH: userRoot.slice(userRootVolume.length - 1),
    LOCALAPPDATA: path.join(userRoot, 'AppData', 'Local'),
    PATH: '',
    // Git Bash and some embedded Windows hosts omit this environment value.
    // Node's native process.arch is the authoritative bounded equivalent and
    // avoids reopening the child environment to the caller's profile.
    PROCESSOR_ARCHITECTURE: processorArchitecture,
    SYSTEMDRIVE: boundedHost('SYSTEMDRIVE'),
    SYSTEMROOT: boundedHost('SYSTEMROOT'),
    TEMP: tempRoot,
    USERNAME: 'runtime',
    USERPROFILE: userRoot,
    PROGRAMFILES: boundedHost('PROGRAMFILES'),
    ANDROID_COMMON_DOC: projectRoot,
    HTTP_PROXY: '',
    HTTPS_PROXY: '',
    ALL_PROXY: '',
    NO_PROXY: '*',
  };
}

async function runContextProviderInternalSearch(
  { projectRoot, isolatedHome, question, requestExpiry }, ownership,
) {
  if (
    typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)
    || typeof isolatedHome !== 'string' || !path.isAbsolute(isolatedHome)
    || !isBoundedUtf8String(question, 8192)
  ) throw new Error('mcp-search-input-invalid');
  // One shared absolute deadline for the whole sequence (NO-GO Correction
  // B) -- each stage below draws down whatever remains via stageTimeoutMs()
  // rather than requesting a fresh CONTEXT_PROVIDER_MCP_TIMEOUT_MS.
  const operationDeadlineMs = Date.now() + remainingBoundedTimeoutMs(requestExpiry, CONTEXT_PROVIDER_MCP_TIMEOUT_MS);
  const stageTimeoutMs = () => Math.max(0, operationDeadlineMs - Date.now());
  const timeoutMs = stageTimeoutMs();
  if (timeoutMs <= 0) throw new Error('mcp-search-deadline-expired');
  // Sequence 15 extraction moved this module one directory deeper than the
  // pre-extraction monolith (scripts/lib/ -> scripts/lib/runtime-bridge-codex/),
  // so reaching the checkout root now needs one more '..' than before.
  const toolkitRoot = path.resolve(__dirname, '..', '..', '..');
  // The retained context-provider is authorized to call exactly search-docs,
  // so launch the MCP server's dedicated composition for that real tool.
  // Loading the general 47-tool entrypoint here adds unrelated cold-start
  // work and can consume most of the frozen 10s end-to-end budget on native
  // Windows.  This remains the same MCP SDK, search-docs registration and
  // toolkit build; it merely excludes tools this closed path cannot invoke.
  const serverScript = path.join(toolkitRoot, 'mcp-server', 'build', 'runtime-search-stdio.js');
  const packageFile = path.join(toolkitRoot, 'mcp-server', 'package.json');
  const localRequire = createRequire(packageFile);
  const { Client } = localRequire('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = localRequire('@modelcontextprotocol/sdk/client/stdio.js');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverScript],
    cwd: projectRoot,
    env: closedMcpEnvironment(projectRoot, isolatedHome),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'AndroidCommonDoc-runtime', version: '1.0.0' }, { capabilities: {} });
  const childRegistry = ownership && ownership.registry
    ? ownership.registry : createSupervisorOwnedChildRegistry();
  const sessionOwnedChildren = ownership && Array.isArray(ownership.children)
    ? ownership.children : null;
  // P1-A / sequence143 correction (finding P1A-142-06): an OPTIONAL
  // caller-provided hook (never assumed present -- mirrors childRegistry/
  // sessionOwnedChildren's own optionality just above) that admits a
  // promise into the coordinator's OWN pendingRawMcpPromises join set --
  // used below to separately retain this function's internal
  // Promise.race operation and its SDK/client/transport close settlement,
  // never only the outer wrapper this whole function itself returns.
  const registerPromise = ownership && typeof ownership.registerPromise === 'function' ? ownership.registerPromise : null;
  if (
    !childRegistry || typeof childRegistry.register !== 'function'
    || typeof childRegistry.unregister !== 'function'
  ) throw new Error('mcp-owned-child-registry-invalid');
  let ownedChild = null;
  let ownedChildId = null;
  let stdoutBytes = 0;
  const stdoutChunks = [];
  let stdoutOverflow = false;
  let stderrBytes = 0;
  let stderrOverflow = false;
  if (transport.stderr) {
    transport.stderr.on('data', (chunk) => {
      stderrBytes += Buffer.byteLength(chunk);
      if (stderrBytes > CONTEXT_PROVIDER_MCP_STDERR_CAP) stderrOverflow = true;
    });
  }
  const adoptMcpChild = () => {
    if (ownedChild) return;
    ownedChild = transport._process || null;
    if (!ownedChild || typeof ownedChild.once !== 'function') throw new Error('mcp-owned-child-unavailable');
    ownedChildId = childRegistry.register(ownedChild);
    if (sessionOwnedChildren && !sessionOwnedChildren.includes(ownedChild)) {
      sessionOwnedChildren.push(ownedChild);
    }
    if (ownedChild.stdout) {
      ownedChild.stdout.on('data', (chunk) => {
        stdoutBytes += Buffer.byteLength(chunk);
        if (stdoutBytes > CONTEXT_PROVIDER_MCP_STDOUT_CAP) {
          stdoutOverflow = true;
        } else {
          stdoutChunks.push(Buffer.from(chunk));
        }
      });
    }
  };
  const sdkTransportStart = transport.start.bind(transport);
  transport.start = async () => {
    // StdioClientTransport invokes cross-spawn synchronously before its
    // start promise settles.  Adopt that exact handle immediately, in the
    // same stack, so no live MCP process exists outside the owned registry.
    const started = sdkTransportStart();
    adoptMcpChild();
    await started;
  };
  const operation = (async () => {
    await client.connect(transport, { timeout: timeoutMs, maxTotalTimeout: timeoutMs });
    adoptMcpChild();
    const serverVersion = client.getServerVersion();
    if (!exactObjectKeys(serverVersion, ['name', 'version']) || serverVersion.name !== 'androidcommondoc' || serverVersion.version !== '1.0.0') {
      throw new Error('mcp-server-version-invalid');
    }
    const listTimeout = stageTimeoutMs();
    if (listTimeout <= 0) throw new Error('mcp-search-deadline-expired');
    const listed = await client.listTools(undefined, { timeout: listTimeout, maxTotalTimeout: listTimeout });
    const candidates = listed && Array.isArray(listed.tools) ? listed.tools.filter((tool) => tool && tool.name === 'search-docs') : [];
    if (candidates.length !== 1 || !validateSearchDocsDescriptor(candidates[0])) throw new Error('mcp-search-tool-descriptor-invalid');
    const callTimeout = stageTimeoutMs();
    if (callTimeout <= 0) throw new Error('mcp-search-deadline-expired');
    const called = await client.callTool(
      { name: 'search-docs', arguments: { query: question } },
      undefined,
      { timeout: callTimeout, maxTotalTimeout: callTimeout },
    );
    if (!called || called.isError === true || !Array.isArray(called.content) || called.content.length !== 1) {
      throw new Error('mcp-search-tool-result-invalid');
    }
    const text = called.content[0];
    if (!text || !exactObjectKeys(text, ['text', 'type']) || text.type !== 'text' || !isBoundedUtf8String(text.text, CONTEXT_PROVIDER_MCP_TEXT_CAP, true)) {
      throw new Error('mcp-search-text-result-invalid');
    }
    if (stdoutOverflow || Buffer.byteLength(text.text, 'utf8') > CONTEXT_PROVIDER_MCP_STDOUT_CAP) throw new Error('mcp-search-stdout-cap-exceeded');
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(stdoutChunks));
    } catch (err) {
      throw new Error('mcp-search-stdout-utf8-invalid');
    }
    let decoded;
    try { decoded = JSON.parse(text.text); } catch (err) { throw new Error('mcp-search-json-invalid'); }
    const value = validateInternalSearchPayload(decoded, question);
    if (stderrOverflow) throw new Error('mcp-search-stderr-cap-exceeded');
    const bytes = Buffer.from(canonicalJSONStringify(value), 'utf8');
    return {
      ok: true, value, bytes, digest: rc.sha256Buffer(bytes),
      summary: canonicalInternalSearchSummary(value),
    };
  })();
  // P1-A / sequence143 correction (finding P1A-142-06): registered the
  // instant this internal operation exists, unconditionally -- so a
  // timeout-race "loser" (the timer below winning Promise.race first) is
  // never left dangling/unjoined: the coordinator's own stop timeline can
  // still genuinely react to operation's real eventual settlement, and
  // this same registration (registerRawMcpPromise itself always attaches
  // its own unconditional .then(untrack,untrack)) also means a LATE
  // rejection here (e.g. client.close() below interrupting an in-flight
  // call) can never surface as an unhandled rejection either.
  if (registerPromise) registerPromise(operation);
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('mcp-search-timeout')), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (!ownedChild && transport._process) adoptMcpChild();
    // P1-A / sequence143 correction (finding P1A-142-06): the actual SDK/
    // client/transport close settlement is now its own explicitly
    // retained/registered operation too -- never left merely nested,
    // unregistered, inside this function's own outer wrapper promise.
    // Behavior is otherwise unchanged: still awaited in the SAME place,
    // same fallback/best-effort semantics.
    const closeOperation = (async () => {
      try { await client.close(); } catch (err) { try { await transport.close(); } catch (ignored) { /* best effort */ } }
    })();
    if (registerPromise) registerPromise(closeOperation);
    await closeOperation;
    if (ownedChild) {
      const stopped = await stopOwnedAppServerChildBounded(
        ownedChild, SESSION_RUN_TERM_CONFIRM_TIMEOUT_MS, SESSION_RUN_KILL_CONFIRM_TIMEOUT_MS,
      );
      if (!stopped.stopped) throw new Error('DURABILITY_UNPROVEN:mcp-child-stop-unconfirmed');
      if (ownedChildId !== null) childRegistry.unregister(ownedChildId);
      if (sessionOwnedChildren && !timerState.isShuttingDown()) {
        const childIndex = sessionOwnedChildren.indexOf(ownedChild);
        if (childIndex >= 0) sessionOwnedChildren.splice(childIndex, 1);
      }
    }
  }
}

  return Object.freeze({
    BOOTSTRAP_ARCHIVE_TIMEOUT_MS,
    BOOTSTRAP_TURN_TIMEOUT_MS,
    CONTEXT7_CONTEXT_RESPONSE_CAP,
    CONTEXT7_REQUEST_TIMEOUT_MS,
    CONTEXT7_SEARCH_RESPONSE_CAP,
    CONTEXT_PROVIDER_MCP_STDERR_CAP,
    CONTEXT_PROVIDER_MCP_STDOUT_CAP,
    CONTEXT_PROVIDER_MCP_TEXT_CAP,
    CONTEXT_PROVIDER_MCP_TIMEOUT_MS,
    HOST_PATTERN_EVIDENCE_PROJECTED_TEXT_CAP,
    HOST_PATTERN_EVIDENCE_TURN_INPUT_CAP,
    RETAINED_SESSION_GENERATION_RECHECK_INTERVAL_MS,
    RETAINED_WORKER_HEARTBEAT_INTERVAL_MS,
    RETAINED_WORKER_POLL_INTERVAL_MS,
    SEARCH_DOCS_DESCRIPTOR_INPUT_SCHEMA,
    SEARCH_DOCS_MATCH_KEYS_OPTIONAL,
    SEARCH_DOCS_MATCH_KEYS_REQUIRED,
    STOP_SIGNAL_INTERRUPT_BOUND_MS,
    TURN_READ_PROJECTION_ENTRY_CAP,
    TURN_READ_PROJECTION_FILE_CAP,
    TURN_READ_PROJECTION_TOTAL_CAP,
    canonicalInternalSearchSummary,
    closedMcpEnvironment,
    exactObjectKeys,
    isBoundedUtf8String,
    remainingBoundedTimeoutMs,
    runContextProviderInternalSearch,
    validateInternalSearchPayload,
    validateSearchDocsDescriptor,
  });
}

module.exports = Object.freeze({ createInternalSearchMcp });
