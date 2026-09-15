'use strict';

// Extracted from runtime-consultation.cjs. This focused factory has no
// upward facade import; every authority, clock and durability seam is injected.
function createBlobPublisher(deps) {
  const {
    CliError,
    blobPathFor,
    computeRepoId,
    decodeSubjectBundleManifestOrThrow,
    fs,
    gitRevParse,
    isSafeRelativeEntryPath,
    path,
    planRootPath,
    publishNoClobber,
    realpathOrSelf,
    requireFlags,
    resolveAbsolute,
    sha256Buffer,
    sha256File,
  } = deps;


  // ─────────────────────────────────────────────────────────────────────────────
  // `publish-blob` (PLAN.md ~L760, ~L777) -- sole content-ref materializer. Deep
  // per-entry `BLOB-AUTH-01..08` adversarial validation (outside-root, host-auth/
  // config/home, coordination/evidence, traversal, symlink/hard-link/reparse,
  // post-open mutation, >10MiB), reusing the exact fd-bind / O_NOFOLLOW / fstat /
  // re-fstat-identity pattern already established by `resolveContentRefOrThrow`.
  //
  // CORRECTION PASS (WP2 BLOB-AUTH, post NO-GO audit): the original shipped
  // version's staging-root confinement was LEXICAL ONLY (`path.resolve`/
  // `path.join` never touch the filesystem) and its `fs.lstatSync`/
  // `fs.openSync(..., O_NOFOLLOW)` pair inspected only the FINAL path component,
  // so a symlinked PARENT directory anywhere earlier in `entry.path` was
  // transparently followed by the OS with no error at all (RCR-blob-parent-
  // symlink / RCR-blob-outside-abs, PATH-01/PATH-06). Separately, the
  // categorical denylist and `isSafeRelativeEntryPath` itself both split
  // candidate segments on `/` only, so a segment embedding a denylisted name
  // behind an internal `\` was never caught (RCR-blob-backslash, PATH-04). This
  // pass fixes all three: `isSafeRelativeEntryPath` now rejects `\` and control
  // chars unconditionally (see its own doc comment); `--entry`'s grammar is
  // checked BEFORE the subject-bundle manifest is decoded (so an unsafe --entry
  // always surfaces THIS verb's own SECURITY_INVALID, never the manifest
  // decode's generic SCHEMA_INVALID for the identical string); and the staging-
  // root confinement below is now a per-component symlink-rejecting walk, not a
  // single lexical string comparison.
  // ─────────────────────────────────────────────────────────────────────────────

  const MAX_BLOB_BYTES = 10485760;

  // Best-effort categorical host-auth/config/home denylist (PLAN.md ~L777) -- this
  // file's own reasonable inference of the segment denylist, since no PLAN range
  // read for this task enumerates literal segment names. `.planning` covers this
  // repo's own coordination/evidence convention as an additional segment-level
  // belt to the resolved-path coordination-root check below. Safe to split on
  // `/` alone: `isSafeRelativeEntryPath` (the sole gate every entry path here has
  // already passed) categorically rejects `\` anywhere, so a `/`-only split can
  // no longer be smuggled past by a backslash-joined lookalike segment.
  const BLOB_DENYLISTED_SEGMENTS = new Set(['.ssh', '.aws', '.gnupg', '.netrc', '.planning']);

  function cmdPublishBlob(flags) {
    requireFlags(flags, ['coordination-root', 'plan', 'subject-bundle', 'entry']);
    const coordRoot = resolveAbsolute(flags['coordination-root']);
    const planPath = resolveAbsolute(flags.plan);
    const subjectBundlePath = resolveAbsolute(flags['subject-bundle']);

    // --entry's OWN grammar is checked BEFORE the subject-bundle manifest is ever
    // decoded (WP2 BLOB-AUTH correction, ordering fix, RCR-blob-backslash): this
    // flag's raw value and every manifest entry's own `path` field are validated
    // by the SAME isSafeRelativeEntryPath predicate (SUBJECT_BUNDLE_ENTRY_FIELDS.path,
    // enforced inside decodeSubjectBundleManifestOrThrow immediately below). The
    // expected, legitimate case has --entry appear byte-for-byte as a manifest
    // entry's own path too -- checking it here, first, means an unsafe --entry
    // always surfaces this verb's own specific SECURITY_INVALID, rather than
    // being masked by the manifest decode's generic SCHEMA_INVALID for the
    // identical string.
    if (!isSafeRelativeEntryPath(flags.entry)) {
      throw new CliError('INVALID', 'SECURITY_INVALID', '--entry is not a safe relative path');
    }

    const manifest = decodeSubjectBundleManifestOrThrow(subjectBundlePath);
    const entry = manifest.entries.find((e) => e.path === flags.entry);
    if (!entry || !Number.isInteger(entry.size) || typeof entry.digest !== 'string') {
      throw new CliError('INVALID', 'SCHEMA_INVALID', '--entry is not a blob-eligible manifested subject entry');
    }
    const entrySegments = entry.path.split('/');
    for (const seg of entrySegments) {
      if (BLOB_DENYLISTED_SEGMENTS.has(seg)) {
        throw new CliError('INVALID', 'SECURITY_INVALID', 'entry references a categorically denylisted path segment');
      }
    }

    const planDigest = sha256File(planPath);
    const waveSlug = path.basename(path.dirname(planPath)).replace(/^wave-/, '');
    const repoId = computeRepoId(coordRoot);
    const planRoot = planRootPath(coordRoot, repoId, waveSlug, planDigest);

    // Staging root: the same git worktree toplevel every other identity field in
    // this file is already derived from (computeWorktreeId's own gitRevParse call)
    // -- no new manifest field is required to carry it (BLOB-AUTH-02/outside-root).
    // Realpath'd up front so the per-component walk below starts from a base
    // that is already known to be symlink-free.
    const stagingRoot = realpathOrSelf(gitRevParse(coordRoot, ['rev-parse', '--show-toplevel']));
    const resolvedStagingRoot = path.resolve(stagingRoot);

    // Coarse lexical pre-check (defense-in-depth, BLOB-AUTH-05 traversal): with
    // the hardened isSafeRelativeEntryPath grammar above (no '..' segment, never
    // absolute, never '\'), entry.path can never lexically resolve outside
    // resolvedStagingRoot -- this can in practice never itself fire post-grammar,
    // but costs nothing to assert explicitly rather than relying on the grammar
    // alone.
    const lexicalCandidate = path.resolve(path.join(resolvedStagingRoot, entry.path));
    if (lexicalCandidate !== resolvedStagingRoot && !lexicalCandidate.startsWith(resolvedStagingRoot + path.sep)) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'entry resolves outside the staging root (BLOB-AUTH-05 traversal)');
    }

    // Per-component symlink-confinement walk (WP2 BLOB-AUTH correction, fixes
    // PATH-01/PATH-06 -- RCR-blob-parent-symlink/RCR-blob-outside-abs): the
    // lexical check above is a pure string operation that never touches the
    // filesystem, so it cannot see a symlinked PATH COMPONENT (top-level or
    // nested) whose real target sits outside the staging root. Walk from the
    // already-realpath'd staging root one segment at a time; lstat EVERY
    // component -- including intermediates, not just the final/leaf component --
    // and reject the FIRST symlink found before ever descending into or opening
    // it. A real (non-symlink), '.'/'..' -free child name joined onto an
    // already-real parent is itself already that prefix's own realpath by
    // construction, so no repeated fs.realpathSync call (and therefore no extra
    // TOCTOU window) is needed per component.
    //
    // Windows junction/reparse note (verification gap, documented rather than
    // assumed): the rejection test below is `fs.lstatSync(...).isSymbolicLink()`
    // -- the same Node API call regardless of platform, since Node exposes no
    // separate cross-platform "is this a reparse point" primitive. Whether this
    // reliably reports `true` for a Windows junction (not only a Windows
    // symlink) could not be verified via context7/WebFetch in this pass (tool
    // unavailable this session) or via a live architect (unreachable, NO-TEAM
    // mode this session) -- flagged rather than assumed. Neither
    // runtime-consultation-windows.bats nor runtime-consultation-windows.ps1
    // currently exercises a real junction against this guard. Until the
    // windows.ps1 CI leg adds that case and confirms rejection, treat Windows-
    // junction coverage here as UNVERIFIED even though the POSIX-symlink case
    // this walk targets is fully covered and tested.
    const walkedDevIno = [];
    let walked = resolvedStagingRoot;
    for (let i = 0; i < entrySegments.length; i += 1) {
      const seg = entrySegments[i];
      const isLeaf = i === entrySegments.length - 1;
      const candidate = path.join(walked, seg);
      let lst;
      try {
        lst = fs.lstatSync(candidate);
      } catch (err) {
        throw new CliError('INVALID', 'SCHEMA_INVALID', 'manifested entry not found on disk: ' + entry.path);
      }
      if (lst.isSymbolicLink()) {
        throw new CliError('INVALID', 'SECURITY_INVALID', 'manifested entry path component is a symlink (rejected, BLOB-AUTH-06/PATH-01/PATH-06)');
      }
      if (isLeaf) {
        if (!lst.isFile()) {
          throw new CliError('INVALID', 'SCHEMA_INVALID', 'manifested entry is not a regular file');
        }
      } else if (!lst.isDirectory()) {
        throw new CliError('INVALID', 'SCHEMA_INVALID', 'manifested entry path component is not a directory: ' + seg);
      }
      walkedDevIno.push({ dev: lst.dev, ino: lst.ino });
      walked = candidate;
    }
    const resolvedCandidate = walked;

    // Real-target confinement (belt-and-suspenders): the walk above is built by
    // repeated path.join off resolvedStagingRoot itself, so resolvedCandidate is
    // already guaranteed to sit inside it by construction -- this assertion can
    // never itself fire, but is kept as an explicit, independent, cheap check
    // rather than relying on that construction alone.
    if (resolvedCandidate !== resolvedStagingRoot && !resolvedCandidate.startsWith(resolvedStagingRoot + path.sep)) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'entry resolves outside the staging root (BLOB-AUTH-05 traversal)');
    }

    // Categorical coordination/evidence rejection (PLAN.md ~L777): never blob the
    // coordination root's own internal state, even if it happens to sit inside the
    // staging root.
    const resolvedCoordRoot = path.resolve(coordRoot);
    if (resolvedCandidate === resolvedCoordRoot || resolvedCandidate.startsWith(resolvedCoordRoot + path.sep)) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'entry resolves inside coordination/evidence state');
    }

    let fd;
    try {
      fd = fs.openSync(resolvedCandidate, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    } catch (err) {
      if (err && err.code === 'ELOOP') {
        throw new CliError('INVALID', 'SECURITY_INVALID', 'manifested entry path is a symlink (rejected at open time)');
      }
      throw err;
    }
    try {
      const fstat = fs.fstatSync(fd);
      if (!fstat.isFile() || fstat.nlink !== 1) {
        throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'manifested entry durability unproven (hard-linked, BLOB-AUTH-06)');
      }
      if (fstat.size !== entry.size || fstat.size > MAX_BLOB_BYTES) {
        throw new CliError('INVALID', 'SCHEMA_INVALID', 'manifested entry size mismatch/overflow (BLOB-AUTH-08)');
      }
      const bytes = fs.readFileSync(fd);
      const digest = sha256Buffer(bytes);
      if (digest !== entry.digest) {
        throw new CliError('INVALID', 'SCHEMA_INVALID', 'manifested entry digest mismatch (tampered content)');
      }
      const fstat2 = fs.fstatSync(fd);
      if (fstat2.dev !== fstat.dev || fstat2.ino !== fstat.ino || fstat2.size !== fstat.size) {
        throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'manifested entry identity changed during read (BLOB-AUTH-07 post-open mutation)');
      }

      // Chain re-validation (WP2 BLOB-AUTH correction, best-effort substitution
      // detection -- PATH-02): pure Node has no openat/RESOLVE_NO_SYMLINKS
      // primitive that would make the walk-then-open sequence above a single
      // atomic operation, so a parent directory component could in principle
      // still be swapped for a symlink strictly between this walk's lstat of it
      // and the leaf's own open() call re-resolving the full path internally.
      // Re-lstat every walked component now (leaf included) and compare dev/ino
      // against what the walk itself recorded; any mismatch (or a component that
      // is now itself a symlink) is treated exactly like this file's existing
      // "identity changed during read" class of rejection just above. This is
      // the SAME documented, accepted residual as RCR-blob-9 (skipped): fd/
      // lstat-bound checks close the window for everything a single-process,
      // syscall-level observation CAN see, but cannot deterministically win a
      // race against a second process acting at the exact syscall boundary --
      // that residual is named here rather than silently assumed away.
      let revalidatePath = resolvedStagingRoot;
      for (let i = 0; i < entrySegments.length; i += 1) {
        revalidatePath = path.join(revalidatePath, entrySegments[i]);
        let relst;
        try {
          relst = fs.lstatSync(revalidatePath);
        } catch (err) {
          throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'manifested entry path component vanished during read (BLOB-AUTH-07 post-open mutation)');
        }
        const recorded = walkedDevIno[i];
        if (relst.isSymbolicLink() || relst.dev !== recorded.dev || relst.ino !== recorded.ino) {
          throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'manifested entry path component identity changed during read (BLOB-AUTH-07 post-open mutation)');
        }
      }

      const blobPath = blobPathFor(planRoot, digest);
      publishNoClobber(blobPath, bytes, { allowIdenticalIdempotent: true });
      return {
        artifact_ref: blobPath,
        content_ref: { blob: digest, digest, size: fstat.size },
      };
    } finally {
      fs.closeSync(fd);
    }
  }

  return { cmdPublishBlob };
}

module.exports = { createBlobPublisher };
