#!/usr/bin/env node
'use strict';

// Consumer-local adapter for the bounded set of L0 operations that are valid
// against an L1/L2 checkout. The manifest is the only source authority: ambient
// ANDROID_COMMON_DOC values are ignored and replaced only in the child process.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const LAUNCHER_RELATIVE = '.claude/runtime/l0-toolkit-launcher.cjs';
const CONTEXT_RELATIVE = 'scripts/lib/runtime-project-context.cjs';
const TOOL_SPECS = Object.freeze({
  'android-test': { relative: 'scripts/sh/run-android-tests.sh', windowsRelative: 'scripts/ps1/run-android-tests.ps1', executor: 'bash', injectProjectRoot: true, windowsPositionalFlag: '-ModuleFilter' },
  'audit-docs': { relative: 'mcp-server/build/cli/audit-docs.js', executor: 'node', injectProjectRoot: true },
  'benchmark': { relative: 'scripts/sh/run-benchmarks.sh', windowsRelative: 'scripts/ps1/run-benchmarks.ps1', executor: 'bash', injectProjectRoot: true },
  'bundle-write': { relative: 'scripts/sh/write-bundle.sh', executor: 'bash' },
  'catalog-coverage': { relative: 'scripts/sh/catalog-coverage-check.sh', windowsRelative: 'scripts/ps1/catalog-coverage-check.ps1', executor: 'bash', injectProjectRoot: true, windowsArgumentStyle: 'gnu' },
  'check-outdated': { relative: 'mcp-server/build/cli/check-outdated.js', executor: 'node', prependProjectRoot: true },
  'commit-tokens': { relative: 'scripts/sh/list-valid-commit-tokens.sh', windowsRelative: 'scripts/ps1/list-valid-commit-tokens.ps1', executor: 'bash', injectProjectAndToolkitRoots: true, windowsArgumentStyle: 'gnu' },
  'detect-project-type': { relative: 'scripts/sh/detect-project-type.sh', windowsRelative: 'scripts/ps1/detect-project-type.ps1', executor: 'bash', injectProjectRoot: true, windowsArgumentStyle: 'gnu' },
  'emit-qg-result': { relative: 'scripts/sh/emit-qg-result.sh', windowsRelative: 'scripts/ps1/emit-qg-result.ps1', executor: 'bash', injectProjectRoot: true, windowsArgumentStyle: 'gnu' },
  'emit-push-proof': { relative: 'scripts/sh/emit-push-proof.sh', windowsRelative: 'scripts/ps1/emit-push-proof.ps1', executor: 'bash', injectRepoRoot: true },
  'extract-errors': { relative: 'scripts/sh/ai-error-extractor.sh', windowsRelative: 'scripts/ps1/ai-error-extractor.ps1', executor: 'bash' },
  'generate-api-docs': { relative: 'mcp-server/build/cli/generate-api-docs.js', executor: 'node', prependProjectRoot: true },
  'generate-sbom': { relative: 'scripts/sh/generate-sbom.sh', windowsRelative: 'scripts/ps1/generate-sbom.ps1', executor: 'bash', injectProjectRoot: true, windowsPositionalFlag: '-Module' },
  'kdoc-coverage': { relative: 'mcp-server/build/cli/kdoc-coverage.js', executor: 'node', prependProjectRoot: true },
  'lint-resources': { relative: 'scripts/sh/lint-resources.sh', windowsRelative: 'scripts/ps1/lint-resources.ps1', executor: 'bash', injectProjectRoot: true },
  'l0-bats-sharded': { relative: 'scripts/tools/run-bats-sharded.cjs', executor: 'node', l0Only: true, injectProjectRoot: true },
  'qg-doc-validators': { relative: 'scripts/sh/qg-doc-validators.sh', windowsRelative: 'scripts/ps1/qg-doc-validators.ps1', executor: 'bash', l0Only: true, injectProjectAndToolkitRoots: true, windowsArgumentStyle: 'gnu' },
  'qg-path-audit': { relative: 'scripts/sh/qg-path-audit.sh', executor: 'bash', injectProjectRoot: true },
  'qg-registry-integrity': { relative: 'scripts/sh/qg-registry-integrity.sh', windowsRelative: 'scripts/ps1/qg-registry-integrity.ps1', executor: 'bash', l0Only: true, injectProjectRoot: true, windowsArgumentStyle: 'gnu' },
  'qg-report-freshness': { relative: 'scripts/sh/lib/qg-report-freshness.sh', executor: 'bash', l0Only: true },
  'readme-audit': { relative: 'scripts/sh/readme-audit.sh', windowsRelative: 'scripts/ps1/readme-audit.ps1', executor: 'bash', injectProjectRoot: true, windowsArgumentStyle: 'gnu' },
  'run-app': { relative: 'scripts/sh/build-run-app.sh', windowsRelative: 'scripts/ps1/build-run-app.ps1', executor: 'bash', injectProjectRoot: true, windowsPackArguments: true },
  'runtime-consult': { relative: 'scripts/lib/runtime-consultation.cjs', executor: 'node', allowedSubcommands: Object.freeze(['consult', 'record-delivery', 'await-result', 'accept-result']) },
  'runtime-consumer-qg': { relative: 'scripts/lib/runtime-consumer-quality-gate.cjs', executor: 'node', prependProjectRoot: true },
  'sbom-analyze': { relative: 'scripts/sh/analyze-sbom.sh', windowsRelative: 'scripts/ps1/analyze-sbom.ps1', executor: 'bash', injectProjectRoot: true, windowsPositionalFlag: '-Module' },
  'sbom-scan': { relative: 'scripts/sh/scan-sbom.sh', windowsRelative: 'scripts/ps1/scan-sbom.ps1', executor: 'bash', injectProjectRoot: true, windowsPositionalFlag: '-Module' },
  'secret-scan': { relative: 'scripts/sh/secret-scan-report.sh', executor: 'bash', prependProjectRoot: true },
  'scan-secrets': { relative: 'scripts/sh/scan-secrets.sh', executor: 'bash', prependProjectRoot: true },
  'sync-gsd-agents': { relative: 'scripts/sh/sync-gsd-agents.sh', windowsRelative: 'scripts/ps1/sync-gsd-agents.ps1', executor: 'bash', injectProjectRoot: true },
  'sync-gsd-skills': { relative: 'scripts/sh/sync-gsd-skills.sh', windowsRelative: 'scripts/ps1/sync-gsd-skills.ps1', executor: 'bash' },
  'check-agent-parity': { relative: 'scripts/sh/check-agent-parity.sh', windowsRelative: 'scripts/ps1/check-agent-parity.ps1', executor: 'bash', injectProjectRoot: true },
  'test-changed': { relative: 'scripts/sh/run-changed-modules-tests.sh', windowsRelative: 'scripts/ps1/run-changed-modules-tests.ps1', executor: 'bash', injectProjectRoot: true },
  'test-full': { relative: 'scripts/sh/run-parallel-coverage-suite.sh', windowsRelative: 'scripts/ps1/run-parallel-coverage-suite.ps1', executor: 'bash', injectProjectRoot: true },
  'test-module': { relative: 'scripts/sh/gradle-run.sh', windowsRelative: 'scripts/ps1/gradle-run.ps1', executor: 'bash', injectProjectRoot: true },
  'verdict-pre-execute-check': { relative: 'scripts/sh/verdict-pre-execute-check.sh', executor: 'bash', l0Only: true },
  'verdict-request-write': { relative: 'scripts/sh/write-verdict-request.sh', executor: 'bash' },
  'specialist-dispatch-write': { relative: 'scripts/sh/write-specialist-dispatch.sh', executor: 'bash' },
  'verdict-write': { relative: 'scripts/sh/write-verdict.sh', executor: 'bash' },
  'version-sync': { relative: 'scripts/sh/check-version-sync.sh', windowsRelative: 'scripts/ps1/check-version-sync.ps1', executor: 'bash' },
  'verify-kmp': { relative: 'scripts/sh/verify-kmp-packages.sh', windowsRelative: 'scripts/ps1/verify-kmp-packages.ps1', executor: 'bash', injectProjectRoot: true },
  'wave-control': { relative: 'scripts/tools/wave-control-plane.cjs', executor: 'node', injectControlRoot: true },
});

function fail(reason) {
  process.stderr.write(`[l0-toolkit-launcher] ${reason}\n`);
  process.exit(1);
}

function canonicalDirectory(value, reason) {
  if (typeof value !== 'string' || value.length === 0 || !path.isAbsolute(value)) fail(reason);
  const expected = path.resolve(value);
  try {
    const info = fs.lstatSync(expected);
    const canonical = fs.realpathSync(expected);
    const darwinPrivateAlias = process.platform === 'darwin'
      && expected.startsWith('/var/') && canonical === `/private${expected}`;
    if (!info.isDirectory() || info.isSymbolicLink() || (canonical !== expected && !darwinPrivateAlias)) fail(reason);
    return canonical;
  } catch { fail(reason); }
}

function regularCanonicalFile(root, relative, reason) {
  if (typeof relative !== 'string' || relative.length === 0 || path.isAbsolute(relative) || relative.includes('..')) {
    fail(reason);
  }
  const expected = path.resolve(root, relative);
  if (expected !== path.join(root, ...relative.split('/'))) fail(reason);
  try {
    const info = fs.lstatSync(expected);
    const canonical = fs.realpathSync(expected);
    const darwinPrivateAlias = process.platform === 'darwin'
      && expected.startsWith('/var/') && canonical === `/private${expected}`;
    if (!info.isFile() || info.isSymbolicLink() || (canonical !== expected && !darwinPrivateAlias)) fail(reason);
  } catch { fail(reason); }
  return fs.realpathSync(expected);
}

function isL0Root(root) {
  try {
    const registry = fs.lstatSync(path.join(root, 'skills', 'registry.json'));
    const mcpServer = fs.lstatSync(path.join(root, 'mcp-server'));
    return registry.isFile() && !registry.isSymbolicLink() && mcpServer.isDirectory() && !mcpServer.isSymbolicLink();
  } catch { return false; }
}

function sourceResolutionBases(projectRoot) {
  const bases = [projectRoot];
  try {
    const commonDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (path.basename(commonDir) === '.git') {
      const mainRoot = path.dirname(commonDir);
      bases.push(mainRoot);
      if (process.platform === 'darwin' && mainRoot.startsWith('/private/')) bases.push(mainRoot.slice('/private'.length));
    }
  } catch { /* non-Git consumers have only their literal root */ }
  return [...new Set(bases)];
}

function safeCanonicalDirectory(value) {
  try {
    const expected = path.resolve(value);
    const info = fs.lstatSync(expected);
    return info.isDirectory() && !info.isSymbolicLink() && fs.realpathSync(expected) === expected ? expected : null;
  } catch { return null; }
}

function resolveManifestToolkit(projectRoot) {
  const manifestPath = regularCanonicalFile(projectRoot, 'l0-manifest.json', 'consumer manifest is missing or unsafe');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch { fail('consumer manifest is malformed'); }
  const sources = manifest && manifest.version === 2 && Array.isArray(manifest.sources)
    ? manifest.sources.filter((source) => source && source.layer === 'L0' && source.role === 'tooling')
    : [];
  if (sources.length !== 1 || typeof sources[0].path !== 'string' || sources[0].path.length === 0
      || Object.prototype.hasOwnProperty.call(sources[0], 'remote')) {
    fail('consumer manifest must declare exactly one local L0 tooling source');
  }
  const candidates = new Set();
  for (const base of sourceResolutionBases(projectRoot)) {
    const candidate = safeCanonicalDirectory(path.resolve(base, sources[0].path));
    if (candidate && isL0Root(candidate)) candidates.add(candidate);
  }
  if (candidates.size !== 1) fail(candidates.size === 0 ? 'L0 tooling source is unresolved or unsafe' : 'L0 tooling source is ambiguous');
  return [...candidates][0];
}

function runtimeManifestState(rootAsGiven) {
  const manifestPath = path.join(rootAsGiven, 'l0-manifest.json');
  if (!fs.existsSync(manifestPath)) return 'absent';
  try {
    const info = fs.lstatSync(manifestPath);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!info.isFile() || info.isSymbolicLink()) return 'invalid';
    return manifest && manifest.runtime && manifest.runtime.enabled === true ? 'enabled' : 'disabled';
  } catch { return 'invalid'; }
}

function qualify(projectRoot, rootAsGiven) {
  const manifestState = runtimeManifestState(rootAsGiven);
  // An installed consumer may legitimately contain its own skills registry and
  // MCP server. Its explicit runtime manifest therefore wins over all L0 shape
  // heuristics; otherwise an L1 checkout could silently execute itself as L0.
  if (manifestState === 'absent' && isL0Root(projectRoot)) {
    return { toolkitRoot: projectRoot, consumerLayer: 'L0' };
  }
  if (manifestState !== 'enabled') fail('runtime consumer manifest is not enabled or is unsafe');
  const toolkitRoot = resolveManifestToolkit(rootAsGiven);
  const contextPath = regularCanonicalFile(toolkitRoot, CONTEXT_RELATIVE, 'runtime project-context target is missing or unsafe');
  let runtimeContext;
  try { runtimeContext = require(contextPath); }
  catch { fail('runtime project-context target could not be loaded'); }
  const qualification = runtimeContext.verifyRuntimeConsumerInstallation(rootAsGiven, { verifyContent: true });
  if (!qualification || qualification.ok !== true || qualification.toolkitRoot !== toolkitRoot
      || qualification.consumerRoot !== projectRoot) {
    fail(`runtime installation is not qualified${qualification && qualification.reason ? `: ${qualification.reason}` : ''}`);
  }
  return { toolkitRoot, consumerLayer: qualification.consumerLayer };
}

function powershellName(name) {
  return '-' + name.split('-').filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
}

const WINDOWS_FLAG_OVERRIDES = Object.freeze({
  '--min-lines': '-MinMissedLines',
  '--strict': '-StrictMode',
});

function normalizeWindowsArgs(args) {
  return args.flatMap((arg) => {
    if (!arg.startsWith('--') || arg === '--') return [arg];
    const equal = arg.indexOf('=');
    const rawName = equal === -1 ? arg : arg.slice(0, equal);
    const name = WINDOWS_FLAG_OVERRIDES[rawName] || powershellName(rawName.slice(2));
    return equal === -1 ? [name] : [name, arg.slice(equal + 1)];
  });
}

function adaptWindowsArgs(spec, args) {
  if (spec.windowsPackArguments) return args.length === 0 ? [] : ['-Arguments', args.join(' ')];
  const normalized = args.slice();
  if (spec.windowsPositionalFlag && normalized[0] && !normalized[0].startsWith('-')) {
    normalized.unshift(spec.windowsPositionalFlag);
  }
  return spec.windowsArgumentStyle === 'gnu' ? normalized : normalizeWindowsArgs(normalized);
}

function injectedRootFlag(spec, invocation, gnuFlag, powershellFlag) {
  return invocation.windows && spec.windowsArgumentStyle !== 'gnu' ? powershellFlag : gnuFlag;
}

function selectToolInvocation(spec, platform = process.platform) {
  if (!spec || typeof spec !== 'object') throw new TypeError('operation spec is invalid');
  if (spec.executor === 'node') {
    return { executable: process.execPath, prefixArgs: [], targetRelative: spec.relative, windows: false };
  }
  if (platform === 'win32') {
    if (!spec.windowsRelative) throw new Error('operation has no Windows implementation');
    return {
      executable: 'pwsh.exe',
      prefixArgs: ['-NoLogo', '-NoProfile', '-NonInteractive', '-File'],
      targetRelative: spec.windowsRelative,
      windows: true,
    };
  }
  return { executable: 'bash', prefixArgs: [], targetRelative: spec.relative, windows: false };
}

function signalExitCode(signal) {
  const number = signal && os.constants.signals ? os.constants.signals[signal] : undefined;
  return Number.isInteger(number) ? 128 + number : 1;
}

function rejectRootOverrides(args) {
  const blocked = new Set(['--project-root', '--repo-root', '--toolkit-root']);
  if (args.some((arg) => blocked.has(arg) || [...blocked].some((name) => arg.startsWith(`${name}=`)))) {
    fail('project and toolkit roots are launcher-owned');
  }
}

function runOperation(projectRoot, rootAsGiven, id, callerArgs) {
  const spec = TOOL_SPECS[id];
  if (!spec) fail(`unknown operation id: ${id}`);
  const { toolkitRoot, consumerLayer } = qualify(projectRoot, rootAsGiven);
  if (spec.l0Only && consumerLayer !== 'L0') fail(`operation is L0-source-only: ${id}`);
  rejectRootOverrides(callerArgs);
  if (spec.allowedSubcommands && !spec.allowedSubcommands.includes(callerArgs[0])) fail(`subcommand is not admitted for ${id}`);
  let invocation;
  try { invocation = selectToolInvocation(spec); }
  catch (error) { fail(`${error.message}: ${id}`); }
  const target = regularCanonicalFile(toolkitRoot, invocation.targetRelative, `operation target is missing or unsafe: ${id}`);
  let args = callerArgs.slice();
  if (invocation.windows && spec.windowsPackArguments) args = adaptWindowsArgs(spec, args);
  if (spec.prependProjectRoot) args = [projectRoot, ...args];
  if (spec.injectProjectRoot) args.push(
    injectedRootFlag(spec, invocation, '--project-root', '-ProjectRoot'), projectRoot,
  );
  if (spec.injectRepoRoot) args.push(
    injectedRootFlag(spec, invocation, '--repo-root', '-RepoRoot'), projectRoot,
  );
  if (spec.injectProjectAndToolkitRoots) args.push(
    injectedRootFlag(spec, invocation, '--project-root', '-ProjectRoot'), projectRoot,
    injectedRootFlag(spec, invocation, '--toolkit-root', '-ToolkitRoot'), toolkitRoot,
  );
  if (spec.injectControlRoot) args.push(
    injectedRootFlag(spec, invocation, '--root', '-Root'), projectRoot,
  );
  if (invocation.windows && !spec.windowsPackArguments) args = adaptWindowsArgs(spec, args);
  const child = spawnSync(invocation.executable, [...invocation.prefixArgs, target, ...args], {
    cwd: projectRoot,
    env: { ...process.env, ANDROID_COMMON_DOC: toolkitRoot, CLAUDE_PROJECT_DIR: projectRoot },
    stdio: 'inherit',
  });
  if (child.error) fail(`operation could not be launched: ${child.error.message}`);
  if (child.status === null) {
    process.stderr.write(`[l0-toolkit-launcher] operation terminated by signal: ${child.signal || 'unknown'}\n`);
    process.exit(signalExitCode(child.signal));
  }
  process.exit(child.status);
}

function readRuntimeDoc(projectRoot, rootAsGiven, relative) {
  if (typeof relative !== 'string' || !relative.startsWith('docs/')) fail('runtime doc must be under docs/');
  const { toolkitRoot } = qualify(projectRoot, rootAsGiven);
  const target = regularCanonicalFile(toolkitRoot, relative, 'runtime doc is missing or unsafe');
  process.stdout.write(fs.readFileSync(target));
}

// What each operation does, shown by `--help`. Every TOOL_SPECS id must have a line (pinned by l0-toolkit-launcher.test.js).
const OPERATION_SUMMARIES = Object.freeze({
  'android-test': 'Run the Android tests of a module.',
  'audit-docs': 'Audit documentation structure and coherence.',
  'benchmark': 'Run the benchmark suites.',
  'bundle-write': 'Write the context bundle a role reads before it starts.',
  'catalog-coverage': 'Check that the skill and agent catalogs cover every entry.',
  'check-agent-parity': 'Check that .claude/agents and the registered agents agree.',
  'check-outdated': 'Check dependency versions against Maven Central.',
  'commit-tokens': 'List the valid commit types and scopes for this project.',
  'detect-project-type': 'Detect whether the project is gradle, node or hybrid.',
  'emit-push-proof': 'L0 only: mint and verify the push proof of the quality gate.',
  'emit-qg-result': 'Emit the quality-gate phase and result signal of the active wave.',
  'extract-errors': 'Extract build and test errors from Gradle output.',
  'generate-api-docs': 'Generate or validate docs/api.',
  'generate-sbom': 'Generate the software bill of materials.',
  'kdoc-coverage': 'Report KDoc coverage of public Kotlin APIs.',
  'l0-bats-sharded': 'L0 only: run the sharded Bats aggregate.',
  'lint-resources': 'Check string resource completeness.',
  'qg-doc-validators': 'L0 only: run the doc-validator parity checks.',
  'qg-path-audit': 'Check that every file the wave touched is in its PLAN Path-Manifest.',
  'qg-registry-integrity': 'L0 only: check the skill registry hashes.',
  'qg-report-freshness': 'L0 only: check the quality-gate report is fresh for HEAD.',
  'readme-audit': 'Audit the README counts against the repository.',
  'run-app': 'Build and run the application.',
  'runtime-consult': 'Consultation requester operations: consult, record-delivery, await-result, accept-result.',
  'runtime-consumer-qg': 'Consumer quality gate: pre-pr (record the stamp), mint (publish the proof), verify.',
  'sbom-analyze': 'Analyze the software bill of materials.',
  'sbom-scan': 'Scan the software bill of materials for known vulnerabilities.',
  'scan-secrets': 'Scan the project for secrets (the /pre-pr scan).',
  'secret-scan': 'Run the secret scanner and write its quality-gate report.',
  'sync-gsd-agents': 'Sync the agents to the GSD subagent system.',
  'sync-gsd-skills': 'Sync the skills to the GSD user-level directory.',
  'test-changed': 'Run the tests of the modules with uncommitted changes.',
  'test-full': 'Run the full test suite.',
  'test-module': 'Run the tests of one module.',
  'verdict-pre-execute-check': 'L0 only: check the PREP verdicts before an EXECUTE dispatch.',
  'verdict-request-write': 'Create the immutable verdict request of an architect (--phase prep|verify-final).',
  'specialist-dispatch-write': 'Architect writes the dispatch artifact a specialist needs before editing (--architect, --specialist, --file; task on stdin).',
  'verdict-write': 'Record an architect verdict (--phase prep|verify-final, --decision approve|escalate).',
  'verify-kmp': 'Validate KMP source sets and imports.',
  'version-sync': 'Check that the versions agree across the project.',
  'wave-control': 'Wave control plane: init, status, transition, lifecycle-actions.',
});

function printHelp() {
  const lines = [
    'Usage: node .claude/runtime/l0-toolkit-launcher.cjs <run <operation>|read-doc <docs/...>|describe layer> --project-root <absolute-root> [-- <operation arguments>]',
    '',
    'Operations (run <operation>):',
  ];
  const width = Math.max(...Object.keys(TOOL_SPECS).map((id) => id.length));
  for (const id of Object.keys(TOOL_SPECS).sort()) lines.push(`  ${id.padEnd(width)}  ${OPERATION_SUMMARIES[id] || ''}`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

function main(argv) {
  if (argv.length === 0 || ['--help', '-h', 'help'].includes(argv[0])) { printHelp(); return; }
  if (argv.length < 4) fail('expected run/read-doc/describe, subject, --project-root, absolute-root (see --help)');
  const mode = argv[0];
  const subject = argv[1];
  if (argv[2] !== '--project-root') fail('expected --project-root');
  const rootAsGiven = path.resolve(argv[3]);
  const projectRoot = canonicalDirectory(rootAsGiven, 'consumer project root is unresolved or unsafe');
  const launcherRoot = canonicalDirectory(path.resolve(__dirname, '../..'), 'launcher root is unresolved or unsafe');
  const expectedLauncher = regularCanonicalFile(launcherRoot, LAUNCHER_RELATIVE, 'launcher is missing or unsafe');
  if (fs.realpathSync(__filename) !== expectedLauncher || projectRoot !== launcherRoot) fail('launcher must be invoked from its owning project root');
  if (mode === 'read-doc') {
    if (argv.length !== 4) fail('read-doc accepts exactly one runtime doc');
    readRuntimeDoc(projectRoot, rootAsGiven, subject);
    return;
  }
  if (mode === 'describe') {
    if (argv.length !== 4 || !['layer', 'toolkit-root'].includes(subject)) {
      fail('describe supports only layer or toolkit-root');
    }
    const qualification = qualify(projectRoot, rootAsGiven);
    process.stdout.write(`${subject === 'layer' ? qualification.consumerLayer : qualification.toolkitRoot}\n`);
    return;
  }
  if (mode !== 'run' || argv[4] !== '--') fail('run requires -- before operation arguments');
  runOperation(projectRoot, rootAsGiven, subject, argv.slice(5));
}

module.exports = {
  TOOL_SPECS, adaptWindowsArgs, injectedRootFlag, normalizeWindowsArgs, runtimeManifestState,
  selectToolInvocation, signalExitCode,
};
if (require.main === module) main(process.argv.slice(2));
