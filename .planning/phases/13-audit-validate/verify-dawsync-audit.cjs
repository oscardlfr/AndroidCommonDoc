const fs = require('fs');
const m = JSON.parse(fs.readFileSync('.planning/phases/13-audit-validate/audit-manifest-dawsync.json', 'utf8'));

console.log('files:', m.file_count);
console.log('ACTIVE:', m.summary.by_classification.ACTIVE);
console.log('SUPERSEDED:', m.summary.by_classification.SUPERSEDED);
console.log('UNIQUE:', m.summary.by_classification.UNIQUE);

let pass = true;

if (m.file_count < 150) {
  console.error('FAIL: Expected ~291 files, got too few -- check exclusions');
  pass = false;
}

if (!m.summary.claude_md_assessment) {
  console.error('FAIL: Missing CLAUDE.md assessment');
  pass = false;
}

if (!m.summary.l2_override_candidates) {
  console.error('FAIL: Missing L2 override candidates');
  pass = false;
}

// Additional checks
if (!m.summary.l0_promotion_candidates || m.summary.l0_promotion_candidates.length === 0) {
  console.error('FAIL: Missing L0 promotion candidates');
  pass = false;
}

// Verify no worktree files included
const worktreeFiles = m.files.filter(f => f.path.includes('worktrees'));
if (worktreeFiles.length > 0) {
  console.error('FAIL: Worktree files included:', worktreeFiles.length);
  pass = false;
}

// Verify no .planning files included
const planningFiles = m.files.filter(f => f.path.startsWith('.planning/'));
if (planningFiles.length > 0) {
  console.error('FAIL: .planning files included:', planningFiles.length);
  pass = false;
}

// Verify archive files individually assessed
const archiveFiles = m.files.filter(f => f.directory === 'docs/archive');
const archiveWithNotes = archiveFiles.filter(f => f.notes && f.notes.length > 10);
console.log('Archive files:', archiveFiles.length, 'with individual notes:', archiveWithNotes.length);
if (archiveFiles.length > 0 && archiveWithNotes.length < archiveFiles.length * 0.5) {
  console.error('FAIL: Not all archive files individually assessed');
  pass = false;
}

if (pass) {
  console.log('PASS');
} else {
  process.exit(1);
}
