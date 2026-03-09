const fs = require('fs');
const path = require('path');

const r = fs.readFileSync(path.join(__dirname, 'audit-report.md'), 'utf8');
const sections = [
  'L0 Promotion',
  'Consolidation Manifest',
  'Documentation Gaps',
  'Pattern Doc Health',
  'Freshness Report',
  'CLAUDE.md Assessment',
  'Recommendations for Phase 14',
  'Recommendations for Phase 15'
];
const missing = sections.filter(s => !r.includes(s));
if (missing.length > 0) throw new Error('Missing sections: ' + missing.join(', '));
console.log('Report has all required sections. Length:', r.length, 'chars');
console.log('PASS');
