const fs = require('fs');
const path = require('path');

const baseDir = path.resolve(__dirname, '../../..');

// Load all manifests
const wtc = JSON.parse(fs.readFileSync(path.join(__dirname, 'audit-manifest-wakethecave.json'), 'utf8'));
const ds = JSON.parse(fs.readFileSync(path.join(__dirname, 'audit-manifest-dawsync.json'), 'utf8'));
const skl = JSON.parse(fs.readFileSync(path.join(__dirname, 'audit-manifest-shared-kmp-libs.json'), 'utf8'));
const acd = JSON.parse(fs.readFileSync(path.join(__dirname, 'audit-manifest-androidcommondoc.json'), 'utf8'));
const monitorReport = JSON.parse(fs.readFileSync(path.join(baseDir, 'reports/monitoring-report.json'), 'utf8'));
const versionsManifest = JSON.parse(fs.readFileSync(path.join(baseDir, 'versions-manifest.json'), 'utf8'));

// --- Aggregate version refs ---
const allVersionRefs = [];
function addRefs(project, files) {
  files.forEach(f => {
    if (f.versionRefs && f.versionRefs.length > 0) {
      f.versionRefs.forEach(vr => {
        allVersionRefs.push({ project, file: f.path, ...vr });
      });
    }
  });
}
addRefs('WakeTheCave', wtc.files);
addRefs('DawSync', ds.files);
addRefs('shared-kmp-libs', skl.files);
addRefs('AndroidCommonDoc', acd.files);

const totalRefs = allVersionRefs.length;
const staleRefs = allVersionRefs.filter(vr => vr.stale === true);
const currentRefs = allVersionRefs.filter(vr => vr.stale === false);

// Classify severity
const HIGH_TECHS = ['kotlin', 'agp', 'compose-multiplatform'];
const MEDIUM_TECHS = ['detekt', 'kover', 'konsist', 'compose-rules'];

const high = staleRefs.filter(vr => HIGH_TECHS.includes(vr.tech));
const medium = staleRefs.filter(vr => MEDIUM_TECHS.includes(vr.tech));
const low = staleRefs.filter(vr => !HIGH_TECHS.includes(vr.tech) && !MEDIUM_TECHS.includes(vr.tech));

// Cross-project inconsistencies
const versionsByTech = {};
allVersionRefs.forEach(vr => {
  if (!versionsByTech[vr.tech]) versionsByTech[vr.tech] = [];
  versionsByTech[vr.tech].push({ project: vr.project, file: vr.file, found_version: vr.found });
});

const crossProjectInconsistencies = [];
Object.entries(versionsByTech).forEach(([tech, entries]) => {
  const uniqueVersions = [...new Set(entries.map(e => e.found_version))];
  if (uniqueVersions.length > 1) {
    const currentVersion = versionsManifest.versions[tech] || 'unknown';
    crossProjectInconsistencies.push({
      technology: tech,
      manifest_version: currentVersion,
      versions_found: uniqueVersions,
      discrepancies: entries.map(e => ({ project: e.project, file: e.file, found_version: e.found_version })),
      severity: HIGH_TECHS.includes(tech) ? 'HIGH' : MEDIUM_TECHS.includes(tech) ? 'MEDIUM' : 'LOW',
      note: 'Internal version inconsistency across files within same or different projects'
    });
  }
});

// --- Cross-project analysis ---
const totalFiles = wtc.file_count + ds.file_count + skl.file_count + acd.file_count;
const byLayer = { L0: acd.file_count, L1: skl.file_count, L2: wtc.file_count + ds.file_count };

const byClassification = {
  ACTIVE: (wtc.summary.by_classification.ACTIVE || 0) +
          (ds.summary.by_classification.ACTIVE || 0) +
          (skl.summary.by_classification.ACTIVE || 0) +
          acd.file_count,
  SUPERSEDED: (wtc.summary.by_classification.SUPERSEDED || 0) +
              (ds.summary.by_classification.SUPERSEDED || 0) +
              (skl.summary.by_classification.SUPERSEDED || 0),
  UNIQUE: (wtc.summary.by_classification.UNIQUE || 0) +
          (ds.summary.by_classification.UNIQUE || 0) +
          (skl.summary.by_classification.UNIQUE || 0)
};

const dsActions = ds.summary.by_action || {};
const byAction = {
  keep: (dsActions.keep || 0) + wtc.file_count + skl.file_count + acd.file_count,
  promote_L0: dsActions.promote_L0 || 0,
  promote_L1: dsActions.promote_L1 || 0,
  consolidate: dsActions.consolidate || 0,
  archive: dsActions.archive || 0,
  flag_l2_override: dsActions.flag_l2_override || 0
};

const aiReadinessAvgByProject = {
  WakeTheCave: wtc.summary.ai_readiness_avg,
  DawSync: ds.summary.ai_readiness_avg,
  'shared-kmp-libs': skl.summary.ai_readiness_avg,
  AndroidCommonDoc: acd.summary.ai_readiness_avg
};

const l0PromoTotal = 0 + 47 + 1; // WTC: 0, DS: 47, SKL: 1 partial
const l2OverrideTotal = 3;

const contentOverlaps = [
  {
    topic: 'ViewModel patterns',
    found_in: [
      'WakeTheCave/docs/01-architecture/patterns/viewmodel-patterns.md',
      'AndroidCommonDoc/docs/viewmodel-state-patterns.md'
    ],
    relationship: 'WakeTheCave uses L2-specific examples; L0 covers generic patterns'
  },
  {
    topic: 'Error handling patterns',
    found_in: [
      'WakeTheCave/docs/01-architecture/error-handling-guide.md',
      'DawSync/.androidcommondoc/docs/dawsync-domain-patterns.md',
      'shared-kmp-libs/docs/ERROR_HANDLING_PATTERN.md',
      'AndroidCommonDoc/docs/error-handling-patterns.md'
    ],
    relationship: 'Layered: L0 generic, L1 ExceptionMapper, L2 project-specific error types'
  },
  {
    topic: 'Testing patterns',
    found_in: [
      'WakeTheCave/docs/01-architecture/patterns/testing-patterns.md',
      'DawSync/docs/guides/TESTING.md',
      'shared-kmp-libs/docs/TESTING_STRATEGY.md',
      'AndroidCommonDoc/docs/testing-patterns.md'
    ],
    relationship: 'Layered: L0 generic KMP testing, L1 coverage strategy, L2 project-specific conventions'
  },
  {
    topic: 'Offline-first architecture',
    found_in: [
      'WakeTheCave/docs/01-architecture/datasources-guide.md',
      'DawSync/docs/architecture/PATTERNS.md',
      'AndroidCommonDoc/docs/offline-first-patterns.md'
    ],
    relationship: 'L0 covers generic patterns; DawSync PATTERNS.md is L2>L1 override candidate'
  },
  {
    topic: 'Compose resources',
    found_in: [
      'WakeTheCave/docs/08-reference/compose-resources-guide.md',
      'AndroidCommonDoc/docs/compose-resources-patterns.md'
    ],
    relationship: 'WakeTheCave references L0 patterns; L0 is canonical'
  },
  {
    topic: 'Gradle patterns and convention plugins',
    found_in: [
      'shared-kmp-libs/docs/CONVENTION_PLUGINS.md',
      'shared-kmp-libs/docs/GRADLE_SETUP.md',
      'AndroidCommonDoc/docs/gradle-patterns.md'
    ],
    relationship: 'L0 covers generic patterns; L1 contains project-specific convention plugins and setup'
  }
];

// Build merged manifest
const merged = {
  version: 1,
  generated: new Date().toISOString(),
  versions_manifest_path: 'versions-manifest.json',
  projects: {
    WakeTheCave: wtc,
    DawSync: ds,
    'shared-kmp-libs': skl,
    AndroidCommonDoc: acd
  },
  freshness: {
    monitor_sources_result: monitorReport,
    version_ref_summary: {
      total_refs: totalRefs,
      current_refs: currentRefs.length,
      stale_refs: staleRefs.length,
      by_severity: {
        HIGH: high.length,
        MEDIUM: medium.length,
        LOW: low.length
      },
      stale_details: staleRefs.map(vr => ({
        project: vr.project,
        file: vr.file,
        tech: vr.tech,
        found_version: vr.found,
        current_version: vr.current,
        severity: HIGH_TECHS.includes(vr.tech) ? 'HIGH' : MEDIUM_TECHS.includes(vr.tech) ? 'MEDIUM' : 'LOW'
      })),
      cross_project_inconsistencies: crossProjectInconsistencies
    }
  },
  cross_project: {
    total_files: totalFiles,
    by_layer: byLayer,
    by_classification: byClassification,
    by_action: byAction,
    ai_readiness_avg_by_project: aiReadinessAvgByProject,
    l0_promotion_candidates_total: l0PromoTotal,
    l2_override_candidates_total: l2OverrideTotal,
    content_overlaps: contentOverlaps
  }
};

const outPath = path.join(__dirname, 'audit-manifest.json');
fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
console.log('Wrote audit-manifest.json');
console.log('Total files:', totalFiles);
console.log('By layer:', JSON.stringify(byLayer));
console.log('By classification:', JSON.stringify(byClassification));
console.log('Stale refs:', staleRefs.length, '(HIGH:', high.length, ', MEDIUM:', medium.length, ', LOW:', low.length, ')');
console.log('L0 promo total:', l0PromoTotal);
console.log('L2 override total:', l2OverrideTotal);
console.log('Cross-project inconsistencies:', crossProjectInconsistencies.length);
