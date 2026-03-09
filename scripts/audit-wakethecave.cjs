/**
 * MyApp Documentation Audit Script
 *
 * Reads all 209 MyApp markdown files (docs/ 199 + docs2/ 10),
 * classifies each by layer placement, computes AI-readiness scores,
 * identifies L0 promotion candidates, and produces audit-manifest-sample.json.
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// Configuration
// ============================================================

const MYAPP_ROOT = 'C:/Users/34645/AndroidStudioProjects/MyApp/MyApp';
const DOCS_DIR = path.join(MYAPP_ROOT, 'docs');
const DOCS2_DIR = path.join(MYAPP_ROOT, 'docs2');
const VERSIONS_MANIFEST_PATH = 'C:/Users/34645/AndroidStudioProjects/AndroidCommonDoc/versions-manifest.json';
const OUTPUT_PATH = 'C:/Users/34645/AndroidStudioProjects/AndroidCommonDoc/.planning/phases/13-audit-validate/audit-manifest-sample.json';

// L0 pattern doc slugs from AndroidCommonDoc for overlap detection
const L0_PATTERN_SLUGS = [
  'compose-resources-configuration',
  'compose-resources-patterns',
  'compose-resources-troubleshooting',
  'compose-resources-usage',
  'enterprise-integration-proposal',
  'error-handling-patterns',
  'gradle-patterns',
  'kmp-architecture',
  'offline-first-architecture',
  'offline-first-caching',
  'offline-first-patterns',
  'offline-first-sync',
  'resource-management-patterns',
  'testing-patterns-coroutines',
  'testing-patterns-coverage',
  'testing-patterns-fakes',
  'testing-patterns',
  'ui-screen-patterns',
  'viewmodel-events',
  'viewmodel-navigation',
  'viewmodel-state-management',
  'viewmodel-state-patterns',
];

// Version patterns to detect in markdown content
const VERSION_PATTERNS = [
  { tech: 'kotlin', regex: /kotlin\s+(\d+\.\d+\.\d+)/gi },
  { tech: 'agp', regex: /agp\s+(\d+\.\d+\.\d+)/gi },
  { tech: 'compose-multiplatform', regex: /compose[- ]multiplatform\s+(\d+\.\d+\.\d+)/gi },
  { tech: 'koin', regex: /koin\s+(\d+\.\d+\.\d+)/gi },
  { tech: 'kotlinx-coroutines', regex: /kotlinx[- ]coroutines\s+(\d+\.\d+\.\d+)/gi },
  { tech: 'kover', regex: /kover\s+(\d+\.\d+\.\d+)/gi },
  { tech: 'mockk', regex: /mockk\s+(\d+\.\d+\.\d+)/gi },
  { tech: 'compose-gradle-plugin', regex: /compose[- ]gradle[- ]plugin\s+(\d+\.\d+\.\d+)/gi },
  { tech: 'detekt', regex: /detekt\s+(\d+\.\d+[-.\w]*)/gi },
  { tech: 'compose-rules', regex: /compose[- ]rules\s+(\d+\.\d+\.\d+)/gi },
  { tech: 'ktor', regex: /ktor\s+(\d+\.\d+\.\d+)/gi },
  { tech: 'navigation', regex: /navigation3?\s+(\d+\.\d+\.\d+[-\w.]*)/gi },
  { tech: 'sqldelight', regex: /sqldelight\s+(\d+\.\d+\.\d+)/gi },
];

// Topic keywords for overlap detection
const OVERLAP_KEYWORDS = {
  'error-handling-patterns': ['error handling', 'domainexception', 'result<t>', 'error mapping', 'retry policy', 'cancellationexception'],
  'testing-patterns': ['testing pattern', 'test pattern', 'maindispatcherrule', 'backgroundscope', 'unconfinedtestdispatcher', 'runtest'],
  'testing-patterns-coroutines': ['coroutine test', 'testdispatcher', 'advanceuntilidle', 'turbine'],
  'testing-patterns-coverage': ['test coverage', 'kover', 'coverage target', 'coverage report'],
  'testing-patterns-fakes': ['fake repository', 'test double', 'test data builder'],
  'viewmodel-state-patterns': ['uistate', 'sealed interface', 'stateflow', 'viewmodel pattern', 'whilesubscribed'],
  'viewmodel-events': ['sharedflow', 'ephemeral event', 'one-shot event'],
  'viewmodel-navigation': ['navcontroller', 'nav3', 'navdisplay', 'serializable route'],
  'viewmodel-state-management': ['statein', 'combine', 'mutablestateflow'],
  'ui-screen-patterns': ['screen composable', 'content composable', 'statelayout', 'design system', 'test tag', 'testtag'],
  'kmp-architecture': ['kotlin multiplatform', 'commonmain', 'expect actual', 'applemain', 'jvmmain', 'source set'],
  'gradle-patterns': ['convention plugin', 'version catalog', 'composite build'],
  'offline-first-architecture': ['offline-first', 'offline first', 'local first'],
  'offline-first-caching': ['room', 'local storage', 'datastore'],
  'offline-first-patterns': ['conflict resolution', 'last write wins'],
  'offline-first-sync': ['sync strategy', 'firestore sync', 'firebase sync'],
  'compose-resources-configuration': ['compose resources', 'composeresources', 'generateresclass'],
  'compose-resources-patterns': ['string resource', 'uitext', 'dynamicstring', 'stringresource'],
  'resource-management-patterns': ['resource management', 'string resources'],
};

// Files known to point to AndroidCommonDoc (superseded)
const KNOWN_SUPERSEDED_POINTERS = {
  'docs/01-architecture/patterns/viewmodel-patterns.md': 'viewmodel-state-patterns',
  'docs/01-architecture/patterns/ui-patterns.md': 'ui-screen-patterns',
  'docs/01-architecture/patterns/screen-implementation-guide.md': 'ui-screen-patterns',
};

// ============================================================
// Helper functions
// ============================================================

function findMarkdownFiles(dir) {
  const results = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      results.push(...findMarkdownFiles(fullPath));
    } else if (item.isFile() && item.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}

function hasFrontmatter(content) {
  return content.trimStart().startsWith('---');
}

function getSections(content) {
  const lines = content.split('\n');
  const sections = [];
  let currentSection = { name: '', lines: [] };

  for (const line of lines) {
    if (line.match(/^##\s+/)) {
      if (currentSection.lines.length > 0 || currentSection.name) {
        sections.push(currentSection);
      }
      currentSection = { name: line.replace(/^##\s+/, '').trim(), lines: [] };
    } else {
      currentSection.lines.push(line);
    }
  }
  if (currentSection.lines.length > 0 || currentSection.name) {
    sections.push(currentSection);
  }
  return sections;
}

function checkSectionSizes(sections) {
  if (sections.length === 0) return true;
  return sections.every(s => s.lines.length <= 150);
}

function hasProperSubdivision(sections) {
  return sections.length >= 3;
}

function hasActionableContent(content) {
  const hasCodeBlocks = (content.match(/```/g) || []).length >= 2;
  const hasTables = content.includes('|---') || content.includes('| ---');
  const hasLists = (content.match(/^[-*]\s/gm) || []).length >= 3;
  const hasCheckboxes = content.includes('- [ ]') || content.includes('- [x]');
  return hasCodeBlocks || hasTables || (hasLists && content.length > 500) || hasCheckboxes;
}

function extractVersionRefs(content, versionsManifest) {
  const refs = [];
  const seen = new Set();

  for (const { tech, regex } of VERSION_PATTERNS) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const found = match[1];
      const key = `${tech}:${found}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const currentVersion = versionsManifest.versions[tech];
      let stale = false;
      if (currentVersion) {
        if (currentVersion.includes('x')) {
          const [curMajor, curMinor] = currentVersion.split('.');
          const [foundMajor, foundMinor] = found.split('.');
          stale = curMajor !== foundMajor || curMinor !== foundMinor;
        } else {
          stale = found !== currentVersion;
        }
      }
      refs.push({ tech, found, current: currentVersion || 'unknown', stale });
    }
  }
  return refs;
}

function detectOverlaps(content, relativePath) {
  const overlaps = [];
  const contentLower = content.toLowerCase();

  for (const [slug, keywords] of Object.entries(OVERLAP_KEYWORDS)) {
    let matchCount = 0;
    for (const kw of keywords) {
      if (contentLower.includes(kw.toLowerCase())) {
        matchCount++;
      }
    }
    if (matchCount >= 2) {
      overlaps.push(slug);
    }
  }

  return overlaps;
}

function classifyFile(relativePath, content) {
  const contentLower = content.toLowerCase();

  // Check if file explicitly points to AndroidCommonDoc (superseded)
  if (contentLower.includes('deprecated') && contentLower.includes('androidcommondoc')) {
    return 'SUPERSEDED';
  }
  if (contentLower.includes('this document has been consolidated') && contentLower.includes('androidcommondoc')) {
    return 'SUPERSEDED';
  }
  if (KNOWN_SUPERSEDED_POINTERS[relativePath]) {
    return 'SUPERSEDED';
  }

  // Archive files default to SUPERSEDED
  if (relativePath.includes('/archive/')) {
    return 'SUPERSEDED';
  }

  // Domain-specific content with irreplaceable knowledge
  const pathLower = relativePath.toLowerCase();
  if (pathLower.includes('smart_home') || pathLower.includes('device_categories') ||
      pathLower.includes('api-analysis') || pathLower.includes('api-legal') ||
      pathLower.includes('api-technical') || pathLower.includes('pricing-analysis') ||
      pathLower.includes('antigravity') || pathLower.includes('agent_start_prompt') ||
      pathLower.includes('main-prompt') || pathLower.includes('ui-prd') ||
      pathLower.includes('geographic-distribution') || pathLower.includes('country-detection') ||
      pathLower.includes('logging-events-catalog') || pathLower.includes('sdk-architecture') ||
      pathLower.includes('integration-roadmap') || pathLower.includes('automation-system') ||
      pathLower.includes('domain-error-mapping') || pathLower.includes('consolidated-architecture-final') ||
      pathLower.includes('command-execution-guide') || pathLower.includes('roadmap-and-priorities') ||
      pathLower.includes('bugs-known-issues') || pathLower.includes('pending_tasks')) {
    return 'UNIQUE';
  }

  return 'ACTIVE';
}

function determineRecommendedLayer(relativePath, content, classification) {
  const contentLower = content.toLowerCase();
  const pathLower = relativePath.toLowerCase();

  // Conservative L0 promotion: ONLY if pattern is clearly from official docs

  // Check for L1 candidates (shared-libs conventions)
  if (contentLower.includes('shared-libs') || contentLower.includes('shared libs')) {
    return 'L1';
  }

  // Everything stays L2 (MyApp-specific) by default
  // The conservative threshold means we only promote to L0 patterns that are:
  // 1. Clearly sourced from official documentation
  // 2. NOT MyApp-specific
  // 3. Generic enough for any KMP/Android project

  // docs/01-architecture/patterns/testing-patterns.md has extensive testing content
  // from official sources, BUT it contains MyApp-specific examples (mockk,
  // MyApp theme, DeviceCapability types). So it stays L2.

  // docs2/05-cross-cutting/testing.md is a condensed version with MyApp
  // specifics (coverage numbers). Stays L2.

  // docs/08-reference/testdispatcher-comparison-analysis.md discusses official
  // Kotlin coroutines testing concepts but is a MyApp decision doc. Stays L2.

  // The existing L0 docs in AndroidCommonDoc already cover these patterns generically.
  // MyApp docs ADD project-specific context to those patterns.

  return 'L2';
}

function determineAction(recommendedLayer, classification, l0Candidate) {
  if (l0Candidate) return 'promote_L0';
  if (classification === 'SUPERSEDED') return 'advisory_superseded';
  if (recommendedLayer === 'L1') return 'flag_L1_review';
  return 'keep_L2';
}

function generateNotes(relativePath, content, classification, versionRefs) {
  const notes = [];
  const contentLower = content.toLowerCase();

  if (classification === 'SUPERSEDED') {
    if (contentLower.includes('androidcommondoc')) {
      notes.push('deprecated, points to AndroidCommonDoc');
    } else if (relativePath.includes('/archive/')) {
      notes.push('archived historical document');
    }
  }

  if (classification === 'UNIQUE') {
    if (contentLower.includes('smart home') || contentLower.includes('device_categories')) {
      notes.push('valuable domain insight - smart home device catalog');
    } else if (contentLower.includes('api-analysis') || contentLower.includes('api-legal') || contentLower.includes('api-technical')) {
      notes.push('valuable domain insight - API/legal analysis');
    } else if (contentLower.includes('automation')) {
      notes.push('valuable domain insight - automation system architecture');
    } else {
      notes.push('valuable domain insight');
    }
  }

  if (contentLower.includes('completado') || contentLower.includes('completed')) {
    notes.push('completed work');
  }

  if (contentLower.includes('now in android') || contentLower.includes('nowinandroid')) {
    notes.push('references Now in Android patterns');
  }

  const staleRefs = versionRefs.filter(r => r.stale);
  if (staleRefs.length > 0) {
    notes.push(`${staleRefs.length} stale version ref(s): ${staleRefs.map(r => `${r.tech} ${r.found}`).join(', ')}`);
  }

  if (content.length < 200) {
    notes.push('very short file');
  }

  return notes.join('; ') || '';
}

// ============================================================
// Main audit function
// ============================================================

function runAudit() {
  console.log('Starting MyApp documentation audit...\n');

  const versionsManifest = JSON.parse(fs.readFileSync(VERSIONS_MANIFEST_PATH, 'utf-8'));

  const docsFiles = findMarkdownFiles(DOCS_DIR);
  const docs2Files = findMarkdownFiles(DOCS2_DIR);
  const allFiles = [...docsFiles, ...docs2Files];

  console.log(`Found ${docsFiles.length} files in docs/, ${docs2Files.length} files in docs2/`);
  console.log(`Total: ${allFiles.length} files\n`);

  const entries = [];
  const directoryCounts = {};
  const classificationCounts = { ACTIVE: 0, SUPERSEDED: 0, UNIQUE: 0 };
  const layerCounts = { L0: 0, L1: 0, L2: 0 };
  let totalAiReadiness = 0;
  const l0CandidatesList = [];
  const staleVersionFiles = [];

  for (const filePath of allFiles) {
    const relativePath = path.relative(MYAPP_ROOT, filePath).replace(/\\/g, '/');
    const directory = path.dirname(relativePath);
    const content = fs.readFileSync(filePath, 'utf-8');

    directoryCounts[directory] = (directoryCounts[directory] || 0) + 1;

    const classification = classifyFile(relativePath, content);
    classificationCounts[classification]++;

    const hasFm = hasFrontmatter(content);
    const sections = getSections(content);
    const sectionSizeOk = checkSectionSizes(sections);
    const properSubdivision = hasProperSubdivision(sections);
    const versionRefs = extractVersionRefs(content, versionsManifest);
    const hasStaleRefs = versionRefs.some(r => r.stale);
    const noStaleRefs = !hasStaleRefs;

    if (hasStaleRefs) {
      staleVersionFiles.push({ path: relativePath, staleRefs: versionRefs.filter(r => r.stale) });
    }

    const actionable = hasActionableContent(content);

    const aiReadinessBreakdown = {
      has_frontmatter: hasFm,
      section_size_ok: sectionSizeOk,
      proper_subdivision: properSubdivision,
      no_stale_refs: noStaleRefs,
      actionable_content: actionable,
    };
    const aiReadinessScore = Object.values(aiReadinessBreakdown).filter(Boolean).length;
    totalAiReadiness += aiReadinessScore;

    const recommendedLayer = determineRecommendedLayer(relativePath, content, classification);
    layerCounts[recommendedLayer]++;

    const l0Candidate = recommendedLayer === 'L0' && classification !== 'SUPERSEDED';
    let l0Rationale = null;

    if (l0Candidate) {
      l0Rationale = 'Pattern appears to derive from official KMP/Kotlin/Jetpack documentation';
      l0CandidatesList.push({ path: relativePath, rationale: l0Rationale });
    }

    const overlaps = detectOverlaps(content, relativePath);
    const action = determineAction(recommendedLayer, classification, l0Candidate);
    const notes = generateNotes(relativePath, content, classification, versionRefs);

    entries.push({
      path: relativePath,
      directory: directory,
      current_layer: 'L2',
      recommended_layer: recommendedLayer,
      ai_readiness_score: aiReadinessScore,
      ai_readiness_breakdown: aiReadinessBreakdown,
      classification: classification,
      l0_candidate: l0Candidate,
      l0_rationale: l0Rationale,
      action: action,
      overlaps_with: overlaps,
      notes: notes,
    });
  }

  // Advisory recommendations
  const advisoryRecommendations = [];
  const archiveCount = entries.filter(e => e.directory.includes('archive')).length;
  const staleCount = staleVersionFiles.length;

  if (archiveCount > 0) {
    advisoryRecommendations.push(`docs/archive has ${archiveCount} superseded files that could be cleaned up or consolidated`);
  }
  if (staleCount > 0) {
    advisoryRecommendations.push(`${staleCount} file(s) reference stale versions (compared against versions-manifest.json)`);
  }

  const deprecatedPointers = entries.filter(e =>
    e.notes.includes('points to AndroidCommonDoc')
  ).length;
  if (deprecatedPointers > 0) {
    advisoryRecommendations.push(`${deprecatedPointers} files are deprecated and point to AndroidCommonDoc as canonical source`);
  }

  const lowReadiness = entries.filter(e => e.ai_readiness_score <= 2).length;
  if (lowReadiness > 0) {
    advisoryRecommendations.push(`${lowReadiness} files have low AI-readiness score (0-2 out of 5) - missing frontmatter, large sections, or lack structured content`);
  }

  if (entries.filter(e => e.directory.startsWith('docs2')).length === 10) {
    advisoryRecommendations.push('docs2/ has a clean Architecture-layer structure (10 files) that could serve as a documentation template model');
  }

  const uniqueCount = classificationCounts.UNIQUE;
  if (uniqueCount > 0) {
    advisoryRecommendations.push(`${uniqueCount} files contain unique domain knowledge not found elsewhere`);
  }

  const overlapFiles = entries.filter(e => e.overlaps_with.length > 0);
  if (overlapFiles.length > 0) {
    advisoryRecommendations.push(`${overlapFiles.length} files overlap with existing AndroidCommonDoc L0 pattern docs - content already covered at L0 level`);
  }

  // Build manifest
  const manifest = {
    project: 'MyApp',
    path: MYAPP_ROOT.replace(/\\/g, '/'),
    layer: 'L2',
    audit_mode: 'read-only',
    generated: new Date().toISOString(),
    file_count: entries.length,
    files: entries,
    summary: {
      total_files: entries.length,
      by_directory: directoryCounts,
      by_classification: classificationCounts,
      by_recommended_layer: layerCounts,
      ai_readiness_avg: parseFloat((totalAiReadiness / entries.length).toFixed(2)),
      l0_promotion_candidates: l0CandidatesList.length,
      l0_candidates_list: l0CandidatesList,
      advisory_recommendations: advisoryRecommendations,
    },
  };

  // Write output
  const outputDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(manifest, null, 2), 'utf-8');

  console.log('=== Audit Summary ===');
  console.log(`Total files: ${entries.length}`);
  console.log(`Classification: ACTIVE=${classificationCounts.ACTIVE}, SUPERSEDED=${classificationCounts.SUPERSEDED}, UNIQUE=${classificationCounts.UNIQUE}`);
  console.log(`Recommended layer: L0=${layerCounts.L0}, L1=${layerCounts.L1}, L2=${layerCounts.L2}`);
  console.log(`AI-readiness average: ${manifest.summary.ai_readiness_avg}`);
  console.log(`L0 promotion candidates: ${l0CandidatesList.length}`);
  console.log(`Files with stale versions: ${staleCount}`);
  console.log(`\nOutput: ${OUTPUT_PATH}`);
  console.log('\nAdvisory recommendations:');
  advisoryRecommendations.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
}

runAudit();
