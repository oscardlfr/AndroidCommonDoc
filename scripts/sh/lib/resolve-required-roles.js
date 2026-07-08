#!/usr/bin/env node
// resolve-required-roles.js — CLASS-aware artifact-floor resolver (BL-W48).
//
// Resolves the required architect roles for a wave from its CLASS, using
// .claude/registry/wave-topology.yaml `class_artifacts` as the single mechanical
// source of truth. Replaces the obsolete named-team roster floor.
//
// Usage:  node resolve-required-roles.js <repo_root> <wave_slug>
// Stdout (exactly one token):
//   - JSON array of arch-<role>  e.g. ["arch-platform","arch-testing","arch-integration"]
//       (HARNESS, or a DOC wave's declared list)
//   - "[]"                -> CLASS legitimately requires NO architects (e.g. FAST-PATH).
//   - "DECLARED_MISSING"  -> CLASS architects == "declared" but PLAN.md carries no
//                            usable `**Required-Architects**:` token -> caller FAILS-CLOSED.
//   - "FALLBACK"          -> could not resolve (no yaml pkg, unreadable topology, bad
//                            slug, unknown spec) -> caller uses the manifest's static
//                            required_roles (never silently drops the HARNESS floor).
// Exit 0 always (the token, not the exit code, carries the verdict) except exit 3 on usage error.
//
// CLASS resolution order: <wave-dir>/CLASS sentinel -> PLAN.md `**Class**:` token
// -> wave-topology default_class -> "HARNESS" fail-safe.

const fs = require('fs');
const path = require('path');

function out(s) { process.stdout.write(String(s)); process.exit(0); }

const repoRootArg = process.argv[2];
const slug = process.argv[3];
if (!repoRootArg || !slug) {
  process.stderr.write('usage: resolve-required-roles.js <repo_root> <wave_slug>\n');
  process.exit(3);
}
// Resolve to absolute: require() treats a relative path (e.g. "mcp-server/...")
// as a node_modules module name, not a path — so the yaml load would fail open.
const repoRoot = path.resolve(repoRootArg);

// Slug allowlist (defense-in-depth; mirrors the gates).
if (!/^[A-Za-z0-9._-]+$/.test(slug) || slug === '.' || slug === '..') out('FALLBACK');

let yaml;
try { yaml = require(path.join(repoRoot, 'mcp-server', 'node_modules', 'yaml')); }
catch { out('FALLBACK'); } // no yaml package -> caller uses manifest static value

let topo;
try { topo = yaml.parse(fs.readFileSync(path.join(repoRoot, '.claude', 'registry', 'wave-topology.yaml'), 'utf8')); }
catch { out('FALLBACK'); }
if (!topo || typeof topo !== 'object') out('FALLBACK');

const waveDir = path.join(repoRoot, '.planning', `wave-${slug}`);

function resolveClass() {
  // 1. CLASS sentinel
  try {
    const raw = fs.readFileSync(path.join(waveDir, 'CLASS'), 'utf8').split(/\r?\n/).find(l => l.trim());
    if (raw && raw.trim()) return raw.trim();
  } catch { /* fall through */ }
  // 2. PLAN.md **Class**: token (same token qg-path-audit.sh greps) — SECURITY-SENSITIVE:
  // section-anchored line-by-line scan, NOT a lazy cross-heading regex. A stray bold
  // **Class**: marker in prose elsewhere in PLAN.md must never resolve here; only a
  // **Class**: line inside the ### Wave Class section counts (mirrors qg-path-audit.sh's
  // own Step-2 anchoring shape).
  try {
    const plan = fs.readFileSync(path.join(waveDir, 'PLAN.md'), 'utf8');
    const lines = plan.split(/\r?\n/);
    let inClassSection = false;
    for (const line of lines) {
      if (/^###\s+Wave\s+Class\s*$/.test(line)) {
        inClassSection = true;
        continue;
      }
      if (inClassSection) {
        if (/^#{1,6}\s/.test(line)) break; // next heading ends the section
        const m = line.match(/\*\*Class\*\*:\s*([A-Za-z0-9._-]+)/);
        if (m) return m[1];
      }
    }
  } catch { /* fall through */ }
  // 3. default_class -> HARNESS fail-safe
  return topo.default_class || 'HARNESS';
}

const cls = resolveClass();
const classArtifacts = topo.class_artifacts || {};
const spec = classArtifacts[cls] || classArtifacts[topo.default_class || 'HARNESS'];
if (!spec || typeof spec !== 'object') out('FALLBACK'); // unknown class with no default spec

const architects = spec.architects;

if (Array.isArray(architects)) out(JSON.stringify(architects)); // incl. [] for FAST-PATH

if (architects === 'declared') {
  // Parse PLAN.md `**Required-Architects**: <role>[, <role>...]` (same grammar as **Class**:).
  try {
    const plan = fs.readFileSync(path.join(waveDir, 'PLAN.md'), 'utf8');
    const m = plan.match(/\*\*Required-Architects\*\*:\s*(.+)/);
    if (m) {
      const roles = m[1].split(',').map(s => s.trim()).filter(Boolean);
      if (roles.length) out(JSON.stringify(roles));
    }
  } catch { /* fall through to fail-closed */ }
  out('DECLARED_MISSING'); // fail-closed: "declared" class with no usable token
}

out('FALLBACK'); // architects spec present but neither array nor "declared"
