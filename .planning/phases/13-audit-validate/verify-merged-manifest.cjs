const fs = require('fs');
const path = require('path');

const m = JSON.parse(fs.readFileSync(path.join(__dirname, 'audit-manifest.json'), 'utf8'));
const p = Object.keys(m.projects);
console.log('projects:', p.join(', '), 'total files:', m.cross_project.total_files);

if (p.length !== 4) throw new Error('Expected 4 projects, got ' + p.length);
if (!m.freshness) throw new Error('Missing freshness data');
if (!m.cross_project) throw new Error('Missing cross-project analysis');
if (!m.freshness.monitor_sources_result) throw new Error('Missing monitor_sources_result');
if (!m.freshness.version_ref_summary) throw new Error('Missing version_ref_summary');
if (m.cross_project.total_files < 400) throw new Error('Total files seems too low: ' + m.cross_project.total_files);

console.log('By layer:', JSON.stringify(m.cross_project.by_layer));
console.log('By classification:', JSON.stringify(m.cross_project.by_classification));
console.log('Version refs - total:', m.freshness.version_ref_summary.total_refs,
  'stale:', m.freshness.version_ref_summary.stale_refs);
console.log('L0 promo candidates:', m.cross_project.l0_promotion_candidates_total);
console.log('L2 override candidates:', m.cross_project.l2_override_candidates_total);
console.log('PASS');
