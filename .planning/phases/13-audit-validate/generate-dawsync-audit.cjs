#!/usr/bin/env node
/**
 * DawSync Audit Manifest Generator
 * Phase 13, Plan 02: Classify all DawSync markdown files
 *
 * This is a one-off analysis script that reads files from disk and produces
 * a JSON manifest. It does not execute any shell commands or user input.
 */

const fs = require('fs');
const path = require('path');

const DAWSYNC_ROOT = 'C:/Users/34645/AndroidStudioProjects/DawSync';
const VERSIONS_MANIFEST_PATH = 'C:/Users/34645/AndroidStudioProjects/AndroidCommonDoc/versions-manifest.json';
const OUTPUT_PATH = 'C:/Users/34645/AndroidStudioProjects/AndroidCommonDoc/.planning/phases/13-audit-validate/audit-manifest-dawsync.json';

// Load versions manifest
const versionsManifest = JSON.parse(fs.readFileSync(VERSIONS_MANIFEST_PATH, 'utf8'));

// AndroidCommonDoc pattern doc slugs for overlap detection
const L0_PATTERN_SLUGS = [
  'compose-resources-configuration', 'compose-resources-patterns',
  'compose-resources-troubleshooting', 'compose-resources-usage',
  'enterprise-integration-proposal', 'error-handling-patterns',
  'gradle-patterns', 'kmp-architecture',
  'offline-first-architecture', 'offline-first-caching',
  'offline-first-patterns', 'offline-first-sync',
  'propuesta-integracion-enterprise', 'resource-management-patterns',
  'testing-patterns-coroutines', 'testing-patterns-coverage',
  'testing-patterns-fakes', 'testing-patterns',
  'ui-screen-patterns', 'viewmodel-events',
  'viewmodel-navigation', 'viewmodel-state-management',
  'viewmodel-state-patterns'
];

// Domain-specific keywords that indicate L2 content
const DOMAIN_KEYWORDS = [
  'daw', 'vst3', 'vst', 'session', 'audio', 'capture', 'recording',
  'asio', 'midi', 'plugin', 'oscillator', 'waveform', 'sample rate',
  'buffer', 'latency', 'track', 'mixer', 'snapshot', 'ableton',
  'max for live', 'm4l', 'bpm', 'playback', 'snapshotproducer',
  'dawsync', 'daw-guardian', 'processing mode', 'silent mode',
  'producer/consumer', 'producermain', 'consumermain',
  'freemium', 'subscription', 'premium', 'studio tier'
];

// Version patterns to extract
const VERSION_PATTERNS = [
  { tech: 'kotlin', regex: /kotlin\s+(\d+\.\d+\.\d+)/gi },
  { tech: 'agp', regex: /agp\s+(\d+\.\d+\.\d+)/gi },
  { tech: 'compose-multiplatform', regex: /compose[\s-]multiplatform\s+(\d+\.\d+\.\d+)/gi },
  { tech: 'compose-gradle-plugin', regex: /compose[\s-]gradle[\s-]plugin\s+(\d+\.\d+\.\d+)/gi },
  { tech: 'koin', regex: /koin\s+(\d+\.\d+\.\d+)/gi },
  { tech: 'kotlinx-coroutines', regex: /kotlinx[\s-]coroutines\s+(\d+\.\d+\.\d+)/gi },
  { tech: 'kover', regex: /kover\s+(\d+\.\d+\.\d+)/gi },
  { tech: 'detekt', regex: /detekt\s+(\d+\.\d+[-\w.]*)/gi },
  { tech: 'mockk', regex: /mockk\s+(\d+\.\d+\.\d+)/gi },
  { tech: 'compose-rules', regex: /compose[\s-]rules\s+(\d+\.\d+\.\d+)/gi },
  { tech: 'sqldelight', regex: /sqldelight\s+(\d+\.\d+\.\d+)/gi },
  { tech: 'okio', regex: /okio\s+(\d+\.\d+\.\d+)/gi },
  { tech: 'ktor', regex: /ktor\s+(\d+\.\d+\.\d+)/gi },
];

function findMdFiles(dir, excludePatterns) {
  const results = [];
  function walk(d) {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(d, entry.name).replace(/\\/g, '/');
      const relPath = fullPath.replace(DAWSYNC_ROOT.replace(/\\/g, '/') + '/', '');

      // Check exclusions
      const shouldExclude = excludePatterns.some(p => {
        if (p === '.planning') return relPath.startsWith('.planning/');
        if (p === 'worktrees') return relPath.includes('.claude/worktrees/');
        if (p === 'build') return relPath.includes('/build/') || relPath.startsWith('build/') ||
                                   relPath.includes('/build-Release/') || relPath.includes('/build-tests/');
        if (p === 'node_modules') return relPath.includes('node_modules/');
        return false;
      });

      if (shouldExclude) continue;

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(relPath);
      }
    }
  }
  walk(dir);
  return results.sort();
}

function getDirectory(filePath) {
  if (filePath.indexOf('/') === -1) return 'root';
  if (filePath.startsWith('.agents/skills/')) return '.agents/skills';
  if (filePath.startsWith('.androidcommondoc/')) return '.androidcommondoc';
  if (filePath.startsWith('.claude/agent-memory/')) return '.claude/agent-memory';
  if (filePath.startsWith('.claude/agents/')) return '.claude/agents';
  if (filePath.startsWith('.claude/commands/')) return '.claude/commands';
  if (filePath.startsWith('docs/architecture/diagrams/')) return 'docs/architecture/diagrams';
  if (filePath.startsWith('docs/architecture/')) return 'docs/architecture';
  if (filePath.startsWith('docs/archive/')) return 'docs/archive';
  if (filePath.startsWith('docs/CODEX_AUDITY/')) return 'docs/CODEX_AUDITY';
  if (filePath.startsWith('docs/guides/')) return 'docs/guides';
  if (filePath.startsWith('docs/legal/')) return 'docs/legal';
  if (filePath.startsWith('docs/references/')) return 'docs/references';
  if (filePath.startsWith('docs/')) return 'docs';
  if (filePath.startsWith('SessionRecorder-VST3/')) return 'SessionRecorder-VST3';
  if (filePath.startsWith('SnapshotProducer/')) return 'SnapshotProducer';
  if (filePath.startsWith('iosApp/')) return 'iosApp';
  if (filePath.startsWith('macosApp/')) return 'macosApp';
  if (filePath.startsWith('appleShared/')) return 'appleShared';
  if (filePath.startsWith('reports/')) return 'reports';
  if (filePath.startsWith('web/')) return 'web';
  const parts = filePath.split('/');
  return parts.slice(0, -1).join('/');
}

function hasFrontmatter(content) {
  return content.trimStart().startsWith('---');
}

function countSections(content) {
  return (content.match(/^## /gm) || []).length;
}

function getMaxSectionSize(content) {
  const lines = content.split('\n');
  let maxSize = 0;
  let currentSize = 0;
  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (currentSize > maxSize) maxSize = currentSize;
      currentSize = 0;
    }
    currentSize++;
  }
  if (currentSize > maxSize) maxSize = currentSize;
  return maxSize;
}

function hasActionableContent(content) {
  const hasCode = content.includes('```');
  const hasTables = (content.match(/\|.*\|/g) || []).length >= 3;
  const hasInstructions = /\d+\.\s+\*\*/.test(content) || /- \*\*/.test(content);
  return hasCode || hasTables || hasInstructions;
}

function extractVersionRefs(content) {
  const refs = [];
  for (const { tech, regex } of VERSION_PATTERNS) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const found = match[1];
      const current = versionsManifest.versions[tech];
      if (!current) continue;

      const cleanCurrent = current.replace(/\.x$/, '');
      let stale;
      if (current.endsWith('.x')) {
        stale = !found.startsWith(cleanCurrent);
      } else {
        stale = found !== current;
      }

      if (!refs.find(r => r.tech === tech && r.found === found)) {
        refs.push({ tech, found, current, stale });
      }
    }
  }
  return refs;
}

function detectOverlaps(content, filePath) {
  const overlaps = [];
  const lowerContent = content.toLowerCase();

  for (const slug of L0_PATTERN_SLUGS) {
    if (slug.includes('testing') && (lowerContent.includes('testing pattern') || lowerContent.includes('test strategy') || lowerContent.includes('testing guide'))) {
      overlaps.push('L0:' + slug);
    } else if (slug.includes('viewmodel') && lowerContent.includes('viewmodel') && lowerContent.includes('uistate')) {
      overlaps.push('L0:' + slug);
    } else if (slug.includes('offline-first') && lowerContent.includes('offline') && lowerContent.includes('outbox')) {
      overlaps.push('L0:' + slug);
    } else if (slug.includes('compose-resources') && lowerContent.includes('composeresources') && lowerContent.includes('generateresclass')) {
      overlaps.push('L0:' + slug);
    } else if (slug === 'error-handling-patterns' && lowerContent.includes('result<') && lowerContent.includes('domainexception')) {
      overlaps.push('L0:' + slug);
    } else if (slug === 'gradle-patterns' && lowerContent.includes('gradle') && lowerContent.includes('default hierarchy')) {
      overlaps.push('L0:' + slug);
    } else if (slug === 'viewmodel-navigation' && lowerContent.includes('navigation3') && lowerContent.includes('navcontroller')) {
      overlaps.push('L0:' + slug);
    } else if (slug === 'kmp-architecture' && lowerContent.includes('commonmain') && lowerContent.includes('jvmmain')) {
      overlaps.push('L0:' + slug);
    }
  }

  return [...new Set(overlaps)];
}

function classifyFile(filePath, content, lineCount) {
  const dir = getDirectory(filePath);
  const fileName = path.basename(filePath, '.md');

  let recommendedLayer = 'L2';
  let classification = 'ACTIVE';
  let action = 'keep';
  let l2Override = false;
  let l2OverrideTarget = null;
  let notes = '';

  // --- ARCHIVE FILES ---
  if (dir === 'docs/archive') {
    classification = 'SUPERSEDED';
    action = 'archive';

    const uniqueArchive = [
      'ARCHITECTURE_PLAN', 'IMPLEMENTATION_ROADMAP', 'IMPLEMENTATION_PLAN',
      'MODULARIZATION_PLAN', 'DATA_LAYER_DESIGN', 'OPTIMIZATION_STRATEGY',
      'FREEMIUM_PREMIUM', 'PRODUCT_BRAINSTORMING', 'PRODUCT_MASTERPLAN',
      'PRODUCT_MOAT', 'PRODUCT_VISION', 'FOUNDER_STRATEGY', 'COST_MODEL',
      'FUTURE_CONSIDERATIONS', 'FUTURE_EXPANSION', 'LOCAL_PROCESSING_PLAN',
      'SNAPSHOT_CLEANUP_STRATEGY', 'snapshotproducer-multi-daw',
      'STRATEGIC_ALIGNMENT_2026', 'SYNC_STRATEGY', 'PRICING_MODEL'
    ];

    if (uniqueArchive.includes(fileName)) {
      classification = 'UNIQUE';
      action = 'keep';
      notes = 'Archived but contains unique domain/business context not available elsewhere.';
    }

    // Specific notes per file
    const archiveNotes = {
      'viewmodel-patterns': 'Superseded by AndroidCommonDoc L0 viewmodel-state-patterns. Already deprecated with pointer to canonical source.',
      'offline-first-patterns': 'Superseded by AndroidCommonDoc L0 offline-first-patterns. Generic KMP content promoted to L0.',
      'ui-patterns': 'Superseded by AndroidCommonDoc L0 ui-screen-patterns. Generic Compose UI patterns.',
      'ARCHITECTURE': 'Superseded by docs/architecture/SYSTEM_ARCHITECTURE.md (current version). Historical architecture.',
      'ARCHITECTURE_PLAN': 'Massive (3166 lines) original architecture plan. Unique historical context for DawSync evolution.',
      'GRADLE_PATTERNS': 'Superseded by docs/architecture/PRODUCER_CONSUMER.md. Also overlaps with L0 gradle-patterns.',
      'IMPLEMENTATION_ROADMAP': 'Historical implementation roadmap with unique project timeline and decision context.',
      'IMPLEMENTATION_PLAN': 'Historical implementation plan with unique project planning context.',
      'MODULARIZATION_PLAN': 'Contains unique modularization decisions specific to DawSync architecture evolution.',
      'DATA_LAYER_DESIGN': 'Contains unique data layer design decisions for producer/consumer pattern.',
      'API_DEPENDENCY_CLEANUP': 'Superseded by current module structure. Cleanup tracking doc.',
      'OPTIMIZATION_STRATEGY': 'Contains unique performance optimization strategies specific to DAW integration.',
      'PROJECT_UI_GUIDE': 'Superseded by current design system and accessibility guide.',
      'FREEMIUM_PREMIUM': 'Contains unique business model decisions for DawSync freemium structure.',
      'CURRENT_STATUS': 'Superseded by FEATURE_INVENTORY.md. Point-in-time status snapshot.',
      'ANALYTICS_STRATEGY': 'Superseded. Brief analytics strategy outline.',
      'SYNC_STRATEGY': 'Contains sync strategy decisions relevant to upcoming cloud phases.',
      'TAGGING_SYSTEM': 'Brief tagging system concept. Superseded by current metadata model.',
      'STORAGE_STRATEGY': 'Brief storage strategy. Superseded by current architecture docs.',
      'PROJECT_ORGANIZATION_ANALYSIS': 'Superseded by current module structure.',
      'PRODUCT_MASTERPLAN': 'Contains unique product masterplan with vision and strategy context.',
      'PRODUCT_BRAINSTORMING': 'Contains unique brainstorming notes with irreplaceable creative context.',
      'PRODUCT_MOAT': 'Contains unique competitive moat analysis.',
      'PRODUCT_VISION': 'Contains unique product vision context.',
      'FOUNDER_STRATEGY': 'Contains unique founder/business strategy context.',
      'COST_MODEL': 'Contains unique cost modeling and financial analysis.',
      'PRICING_MODEL': 'Contains unique pricing model analysis.',
      'FUTURE_CONSIDERATIONS': 'Contains unique future considerations and feature evaluation.',
      'FUTURE_EXPANSION': 'Contains unique expansion planning context.',
      'LOCAL_PROCESSING_PLAN': 'Contains unique local processing architecture decisions.',
      'SNAPSHOT_CLEANUP_STRATEGY': 'Contains unique cleanup strategy for snapshot management.',
      'snapshotproducer-multi-daw': 'Contains unique multi-DAW SnapshotProducer expansion plans.',
      'STRATEGIC_ALIGNMENT_2026': 'Contains unique 2026 strategic alignment and wishlist context.',
    };

    if (archiveNotes[fileName]) {
      notes = archiveNotes[fileName];
    }

    return { recommendedLayer, classification, action, l2Override, l2OverrideTarget, notes };
  }

  // --- .agents/skills (WEB-RELATED) ---
  if (dir === '.agents/skills') {
    recommendedLayer = 'L0';
    classification = 'ACTIVE';
    action = 'promote_L0';
    notes = 'Generic web quality audit skill (Lighthouse-based). Not DawSync-specific. Candidate for L0 promotion as reusable web quality pattern.';
    return { recommendedLayer, classification, action, l2Override, l2OverrideTarget, notes };
  }

  // --- .androidcommondoc ---
  if (dir === '.androidcommondoc') {
    if (filePath.includes('dawsync-domain-patterns')) {
      l2Override = true;
      l2OverrideTarget = 'general domain patterns';
      notes = 'L1 override doc for DawSync-specific domain patterns (producer/consumer, DAW guardian, freemium). Properly placed as L1 project override.';
    } else {
      notes = 'AndroidCommonDoc integration configuration. Properly placed.';
    }
    return { recommendedLayer, classification, action, l2Override, l2OverrideTarget, notes };
  }

  // --- .claude/agent-memory ---
  if (dir === '.claude/agent-memory') {
    notes = 'Agent memory file. Runtime state for AI agents. DawSync-specific context.';
    return { recommendedLayer, classification, action, l2Override, l2OverrideTarget, notes };
  }

  // --- .claude/agents ---
  if (dir === '.claude/agents') {
    const genericAgents = ['test-specialist', 'release-guardian-agent', 'doc-alignment-agent',
                          'cross-platform-validator', 'ui-specialist', 'beta-readiness-agent'];
    const domainAgents = ['daw-guardian', 'producer-consumer-validator', 'freemium-gate-checker',
                         'domain-model-specialist', 'data-layer-specialist'];

    if (genericAgents.includes(fileName)) {
      recommendedLayer = 'L0';
      action = 'promote_L0';
      const agentNotes = {
        'test-specialist': 'Generic test review agent. Testing patterns (runTest, fakes over mocks) are universal. DawSync-specific refs can be parameterized.',
        'release-guardian-agent': 'Generic release readiness scanner. Debug flags, dev URLs, placeholder text checks are universal.',
        'doc-alignment-agent': 'Generic doc drift detection agent. DawSync-specific file refs could be parameterized.',
        'cross-platform-validator': 'Generic cross-platform validation agent. KMP platform parity checks are universal.',
        'ui-specialist': 'Generic UI review agent. Compose/SwiftUI patterns are universal.',
        'beta-readiness-agent': 'Generic beta readiness agent. Pre-release validation is universal.'
      };
      notes = agentNotes[fileName] || 'Generic agent pattern applicable to any KMP project.';
    } else if (domainAgents.includes(fileName)) {
      notes = 'DawSync-specific agent. Contains irreplaceable domain knowledge (' + fileName.replace(/-/g, ' ') + '). Must stay L2.';
    }
    return { recommendedLayer, classification, action, l2Override, l2OverrideTarget, notes };
  }

  // --- .claude/commands ---
  if (dir === '.claude/commands') {
    const genericCommands = ['test', 'coverage', 'coverage-full', 'android-test', 'auto-cover',
      'bump-version', 'changelog', 'extract-errors', 'metrics', 'nuke-builds',
      'package', 'pre-release', 'run', 'run-clean', 'roadmap', 'prioritize',
      'brainstorm', 'doc-check', 'doc-update', 'feature-audit',
      'test-changed', 'test-full', 'test-full-parallel', 'unlock-tests',
      'validate-patterns', 'verify-kmp', 'verify-migrations',
      'sync-versions', 'sync-tech-versions', 'sbom', 'sbom-scan', 'sbom-analyze'];

    if (genericCommands.includes(fileName)) {
      recommendedLayer = 'L0';
      action = 'promote_L0';
      notes = 'Generic command pattern applicable to any KMP project. Could be templated for L0 with parameterization.';
    } else {
      notes = 'DawSync-specific command (' + fileName + '). Contains domain-specific logic.';
    }
    return { recommendedLayer, classification, action, l2Override, l2OverrideTarget, notes };
  }

  // --- docs/architecture/diagrams ---
  if (dir === 'docs/architecture/diagrams') {
    if (filePath.endsWith('README.md') || filePath.endsWith('LEGEND.md')) {
      notes = 'Architecture diagrams index/legend. DawSync-specific reference.';
    } else {
      classification = 'UNIQUE';
      const diagramNotes = {
        'B-vst3-m4l': 'VST3/M4L-specific architecture diagram. Irreplaceable audio plugin domain knowledge.',
        'C-domain-repositories': 'Repository architecture diagram. DawSync domain-specific data layer design.',
        'D-domain-usecases': 'Use case architecture diagram. DawSync domain-specific business logic design.',
        'E-data-datasources': 'DataSource architecture diagram. DawSync-specific data source design.',
        'F-engines': 'Engine architecture diagram. DawSync-specific background processing design.',
        'G-engines-combined': 'Combined engine orchestration diagram. DawSync-specific system design.',
        'H-business-flows': 'Business flow diagram. DawSync domain-specific workflow design.',
        'A-system-global': 'System-level architecture diagram. DawSync-specific global system design.'
      };
      for (const [key, note] of Object.entries(diagramNotes)) {
        if (filePath.includes('/' + key + '/')) { notes = note; break; }
      }
      if (!notes) notes = 'Detailed architecture diagram. Contains irreplaceable DawSync domain-specific system design.';
    }
    return { recommendedLayer, classification, action, l2Override, l2OverrideTarget, notes };
  }

  // --- docs/architecture (non-diagrams) ---
  if (dir === 'docs/architecture') {
    classification = 'UNIQUE';
    if (fileName === 'PATTERNS') {
      l2Override = true;
      l2OverrideTarget = 'offline-first-patterns';
      notes = 'DawSync architecture patterns (offline-first, processing modes, backoff). Contains L2-specific offline-first patterns that override generic L0. Flag as L2>L1 override.';
      action = 'flag_l2_override';
    } else if (fileName === 'PRODUCER_CONSUMER') {
      notes = 'Producer/Consumer pattern documentation. Unique DawSync architecture for platform-specific data sources.';
    } else if (fileName === 'SYSTEM_ARCHITECTURE') {
      notes = 'System architecture overview. Comprehensive DawSync-specific architecture documentation.';
    }
    return { recommendedLayer, classification, action, l2Override, l2OverrideTarget, notes };
  }

  // --- docs/CODEX_AUDITY ---
  if (dir === 'docs/CODEX_AUDITY') {
    classification = 'UNIQUE';
    notes = 'Codex audit document. Contains unique domain-specific audit findings and recommendations.';
    return { recommendedLayer, classification, action, l2Override, l2OverrideTarget, notes };
  }

  // --- docs/guides ---
  if (dir === 'docs/guides') {
    const guideInfo = {
      'TESTING': { l2Override: true, l2OverrideTarget: 'testing-patterns', action: 'flag_l2_override',
        notes: 'DawSync testing guide. Contains DawSync-specific testing conventions that override L0 testing-patterns. Flag as L2>L1 override.' },
      'NAVIGATION': { notes: 'DawSync Navigation3 guide. Contains generic Navigation3 patterns mixed with DawSync-specific routes.' },
      'KMP_RESOURCES': { notes: 'Compose Resources convention for DawSync. Contains generic patterns mixed with DawSync-specific dual-system approach.' },
      'CAPTURE_SYSTEM': { classification: 'UNIQUE', notes: 'DawSync capture system guide. Irreplaceable domain knowledge about DAW audio capture flow.' },
      'MEDIA_SESSION': { classification: 'UNIQUE', notes: 'DawSync media session guide. Domain-specific media controls for audio playback management.' },
      'ACCESSIBILITY': { notes: 'DawSync accessibility guide. Contains generic WCAG patterns with DawSync-specific JAB integration.' }
    };

    const info = guideInfo[fileName] || { notes: 'DawSync guide document.' };
    if (info.classification) classification = info.classification;
    if (info.l2Override) { l2Override = true; l2OverrideTarget = info.l2OverrideTarget; }
    if (info.action) action = info.action;
    notes = info.notes;
    return { recommendedLayer, classification, action, l2Override, l2OverrideTarget, notes };
  }

  // --- docs/legal ---
  if (dir === 'docs/legal') {
    notes = 'Legal document. DawSync-specific legal/compliance content (GDPR, privacy, terms).';
    return { recommendedLayer, classification, action, l2Override, l2OverrideTarget, notes };
  }

  // --- docs/references ---
  if (dir === 'docs/references') {
    if (fileName === 'ABLETON_TEST_DATA') {
      classification = 'UNIQUE';
      notes = 'Ableton test data reference (1616 lines). Unique domain-specific test fixtures for DAW integration testing.';
    } else if (fileName === 'ANDROID_2026') {
      notes = 'Android 2026 reference. Contains Android platform alignment notes.';
    }
    return { recommendedLayer, classification, action, l2Override, l2OverrideTarget, notes };
  }

  // --- docs/ (top-level) ---
  if (dir === 'docs') {
    const docInfo = {
      'PRODUCT_SPEC': { classification: 'UNIQUE', notes: 'DawSync product specification (1664 lines). Canonical product spec with 134 classified features. Irreplaceable.' },
      'FEATURE_INVENTORY': { classification: 'UNIQUE', notes: 'Feature status matrix. DawSync-specific feature tracking document.' },
      'BUSINESS_STRATEGY': { classification: 'UNIQUE', notes: 'Business strategy document. DawSync-specific pricing, costs, competitive positioning.' },
      'TECHNOLOGY_CHEATSHEET': { notes: 'Technology cheatsheet. Mix of generic version refs and DawSync-specific stack decisions.' },
      'RISKS_RULES': { classification: 'UNIQUE', notes: 'Risks and rules document. DawSync-specific anti-feature rules and compliance requirements.' },
      'VIABILITY_AUDIT': { classification: 'UNIQUE', notes: 'Viability audit. DawSync-specific business viability analysis.' },
      'CLAUDE_CODE_WORKFLOW': { recommendedLayer: 'L0', action: 'promote_L0',
        notes: 'Claude Code workflow documentation. Mix of generic AI workflow patterns and DawSync-specific skill references. The workflow pattern itself is L0-promotable.' },
      'SBOM': { notes: 'Software Bill of Materials. DawSync-specific dependency inventory.' },
      'SCALING_PLAN': { notes: 'Scaling plan. Brief DawSync-specific scaling strategy.' },
      'DAWSYNC_PARA_ARTISTAS': { classification: 'UNIQUE', notes: 'Marketing/user guide in Spanish for artists. DawSync-specific user-facing content.' },
    };

    const info = docInfo[fileName] || { notes: 'DawSync documentation file.' };
    if (info.classification) classification = info.classification;
    if (info.recommendedLayer) recommendedLayer = info.recommendedLayer;
    if (info.action) action = info.action;
    notes = info.notes;
    return { recommendedLayer, classification, action, l2Override, l2OverrideTarget, notes };
  }

  // --- SessionRecorder-VST3 ---
  if (dir === 'SessionRecorder-VST3') {
    classification = 'UNIQUE';
    const vst3Notes = {
      'EULA': 'VST3 plugin End User License Agreement. Legal document.',
      'CHANGELOG': 'VST3 plugin changelog. Sub-project version history.',
      'TESTING': 'VST3 plugin testing guide. Domain-specific audio plugin testing.',
      'MACOS_BUILD_INSTRUCTIONS': 'VST3 macOS build instructions. Domain-specific build documentation.',
    };
    notes = vst3Notes[fileName] || 'SessionRecorder VST3 sub-project documentation. Irreplaceable domain-specific audio plugin content.';
    if (filePath.includes('installer/')) notes = 'VST3 installer documentation. Platform-specific installation guide.';
    if (filePath.includes('src/')) notes = 'VST3 source code documentation. C++ audio plugin implementation notes.';
    return { recommendedLayer, classification, action, l2Override, l2OverrideTarget, notes };
  }

  // --- SnapshotProducer ---
  if (filePath.startsWith('SnapshotProducer/')) {
    classification = 'UNIQUE';
    const spNotes = {
      'LICENSE': 'SnapshotProducer license. Legal document.',
      'DISCLAIMER': 'SnapshotProducer disclaimer. Legal document.',
      'PRIVACY': 'SnapshotProducer privacy policy. Legal document.',
      'INSTALL': 'M4L device installation guide. Domain-specific setup instructions.',
      'setup': 'SnapshotProducer setup documentation. Domain-specific configuration.',
    };
    notes = spNotes[fileName] || 'SnapshotProducer (Max for Live) documentation. Irreplaceable domain-specific audio capture content.';
    return { recommendedLayer, classification, action, l2Override, l2OverrideTarget, notes };
  }

  // --- Root files ---
  if (dir === 'root') {
    const rootInfo = {
      'CLAUDE': { notes: 'DawSync CLAUDE.md (232 lines). Contains project-specific conventions + generic KMP patterns. Key file for Phase 15 rewrite. Version refs present.' },
      'README': { notes: 'Project README. Mix of generic project structure and DawSync-specific feature descriptions.' },
      'APPLE_SETUP': { classification: 'UNIQUE', notes: 'Apple platform setup guide (234 lines). DawSync-specific XCFramework and SwiftUI integration.' },
      'MARKETING_EN': { classification: 'UNIQUE', notes: 'Marketing content (English). DawSync-specific user-facing marketing material.' },
      'MARKETING_ES': { classification: 'UNIQUE', notes: 'Marketing content (Spanish). DawSync-specific user-facing marketing material.' },
      'THIRD_PARTY_LICENSES': { notes: 'Third-party licenses. Standard legal compliance document.' },
    };
    const info = rootInfo[fileName] || { notes: 'Root-level project file.' };
    if (info.classification) classification = info.classification;
    notes = info.notes;
    return { recommendedLayer, classification, action, l2Override, l2OverrideTarget, notes };
  }

  // --- Platform READMEs ---
  if (['iosApp', 'macosApp', 'appleShared', 'web'].includes(dir)) {
    notes = 'Platform-specific README for ' + dir + '. DawSync-specific platform configuration and setup.';
    if (filePath.includes('README_SWIFTUI_TESTING')) {
      notes = 'SwiftUI testing guide for iOS. Contains iOS-specific testing patterns.';
    }
    return { recommendedLayer, classification, action, l2Override, l2OverrideTarget, notes };
  }

  // --- Reports ---
  if (dir === 'reports') {
    notes = 'Generated report. DawSync-specific operational data.';
    return { recommendedLayer, classification, action, l2Override, l2OverrideTarget, notes };
  }

  // --- Coverage reports ---
  if (fileName === 'coverage-full-report' || fileName === 'coverage-gap-report') {
    notes = 'Coverage report. DawSync-specific test coverage data.';
    return { recommendedLayer, classification, action, l2Override, l2OverrideTarget, notes };
  }

  return { recommendedLayer, classification, action, l2Override, l2OverrideTarget, notes: notes || 'DawSync documentation file.' };
}

function computeAiReadiness(content, versionRefs) {
  const fm = hasFrontmatter(content);
  const maxSection = getMaxSectionSize(content);
  const sectionSizeOk = maxSection <= 150;
  const sections = countSections(content);
  const properSubdivision = sections >= 2;
  const staleRefs = versionRefs.filter(r => r.stale);
  const noStaleRefs = staleRefs.length === 0;
  const actionable = hasActionableContent(content);

  const breakdown = {
    has_frontmatter: fm,
    section_size_ok: sectionSizeOk,
    proper_subdivision: properSubdivision,
    no_stale_refs: noStaleRefs,
    actionable_content: actionable
  };

  const score = [fm, sectionSizeOk, properSubdivision, noStaleRefs, actionable]
    .filter(Boolean).length;

  return { score, breakdown };
}

// ---- Main execution ----

const files = findMdFiles(DAWSYNC_ROOT, ['.planning', 'worktrees', 'build', 'node_modules']);

const auditEntries = [];
const dirCounts = {};
const classificationCounts = { ACTIVE: 0, SUPERSEDED: 0, UNIQUE: 0 };
const layerCounts = { L0: 0, L1: 0, L2: 0 };
const actionCounts = { keep: 0, promote_L0: 0, promote_L1: 0, consolidate: 0, archive: 0, flag_l2_override: 0 };
let totalAiScore = 0;
const l0Candidates = [];
const l1Candidates = [];
const l2OverrideCandidates = [];

for (const relPath of files) {
  const fullPath = path.join(DAWSYNC_ROOT, relPath).replace(/\\/g, '/');
  let content;
  try {
    content = fs.readFileSync(fullPath, 'utf8');
  } catch (e) {
    continue;
  }
  const lineCount = content.split('\n').length;
  const dir = getDirectory(relPath);

  dirCounts[dir] = (dirCounts[dir] || 0) + 1;

  const versionRefs = extractVersionRefs(content);
  const { recommendedLayer, classification, action, l2Override, l2OverrideTarget, notes } =
    classifyFile(relPath, content, lineCount);
  const { score: aiScore, breakdown: aiBreakdown } =
    computeAiReadiness(content, versionRefs);
  const overlaps = detectOverlaps(content, relPath);

  classificationCounts[classification]++;
  layerCounts[recommendedLayer]++;
  actionCounts[action] = (actionCounts[action] || 0) + 1;
  totalAiScore += aiScore;

  if (action === 'promote_L0' || (recommendedLayer === 'L0' && action !== 'archive')) {
    l0Candidates.push({ path: relPath, rationale: notes });
  }
  if (action === 'promote_L1') {
    l1Candidates.push({ path: relPath, rationale: notes });
  }
  if (l2Override) {
    l2OverrideCandidates.push({ path: relPath, target: l2OverrideTarget, rationale: notes });
  }

  auditEntries.push({
    path: relPath,
    directory: dir,
    current_layer: 'L2',
    recommended_layer: recommendedLayer,
    ai_readiness_score: aiScore,
    ai_readiness_breakdown: aiBreakdown,
    classification,
    action,
    l2_override: l2Override,
    l2_override_target: l2OverrideTarget,
    overlaps_with: overlaps,
    versionRefs: versionRefs,
    notes
  });
}

// CLAUDE.md assessment
const claudeMdContent = fs.readFileSync(path.join(DAWSYNC_ROOT, 'CLAUDE.md'), 'utf8');
const claudeMdEntry = auditEntries.find(e => e.path === 'CLAUDE.md');

const claudeMdAssessment = {
  line_count: claudeMdContent.split('\n').length,
  ai_readiness_score: claudeMdEntry ? claudeMdEntry.ai_readiness_score : 0,
  gaps: [
    'No YAML frontmatter (missing scope, sources, targets metadata for registry)',
    'Coverage table data appears to be from 2026-02-27 -- may be stale',
    'References Compose Multiplatform 1.10.0 vs versions-manifest compose-multiplatform 1.7.x (manifest may need updating or doc references compose-gradle-plugin)',
    'Wave 1 parallel tracks section may be outdated if tracks have been merged',
    'No explicit L0/L1 delegation references (Phase 15 will add @import directives)',
    'Module structure section duplicates README content -- consolidation opportunity',
    'Missing shared-kmp-libs module version info (which modules and versions consumed)',
    'No mention of .agents/skills or .claude/commands inventory'
  ],
  phase_15_notes: 'DawSync CLAUDE.md is the largest (232 lines, exceeds 150-line target). Phase 15 rewrite should: (1) add frontmatter, (2) extract wave/track info to separate doc, (3) add L0/L1 delegation via @import, (4) consolidate module structure with README, (5) add skills/commands reference. Target: <150 lines with delegation.'
};

// Build consolidation recommendations
const archiveSuperseded = auditEntries.filter(e => e.directory === 'docs/archive' && e.classification === 'SUPERSEDED').length;
const archiveUnique = auditEntries.filter(e => e.directory === 'docs/archive' && e.classification === 'UNIQUE').length;
const overlapCount = auditEntries.filter(e => e.overlaps_with.length > 0).length;

const consolidationRecommendations = [
  'docs/archive/ has ' + archiveSuperseded + ' superseded files ready for cleanup and ' + archiveUnique + ' files with unique content to preserve',
  l0Candidates.length + ' files identified as L0 promotion candidates (generic patterns applicable to any KMP project)',
  overlapCount + ' active docs overlap with AndroidCommonDoc L0 patterns -- review for consolidation',
  l2OverrideCandidates.length + ' L2>L1 override candidates identified where DawSync patterns should take precedence',
  '.agents/skills/ contains 8 web-quality skills that are fully generic -- strong L0 promotion candidates',
  'CLAUDE.md exceeds 150-line context budget (232 lines) -- needs restructuring in Phase 15',
  '6 .claude/agents could be templated as generic L0 agent patterns with parameterization',
  auditEntries.filter(e => e.directory === '.claude/commands' && e.action === 'promote_L0').length + ' .claude/commands are generic enough for L0 templating',
  'docs/guides/TESTING.md contains DawSync-specific overrides that should be flagged as L2>L1 for testing-patterns',
  'Version discrepancy: DawSync CLAUDE.md references Kotlin 2.3.10, but TECHNOLOGY_CHEATSHEET says 2.3.0 -- internal inconsistency to resolve'
];

const manifest = {
  project: 'DawSync',
  path: DAWSYNC_ROOT,
  layer: 'L2',
  audit_mode: 'full',
  generated: new Date().toISOString(),
  file_count: auditEntries.length,
  files: auditEntries,
  summary: {
    total_files: auditEntries.length,
    by_directory: dirCounts,
    by_classification: classificationCounts,
    by_recommended_layer: layerCounts,
    by_action: actionCounts,
    ai_readiness_avg: Math.round((totalAiScore / auditEntries.length) * 100) / 100,
    l0_promotion_candidates: l0Candidates,
    l1_promotion_candidates: l1Candidates,
    l2_override_candidates: l2OverrideCandidates,
    claude_md_assessment: claudeMdAssessment,
    consolidation_recommendations: consolidationRecommendations
  }
};

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(manifest, null, 2), 'utf8');

console.log('Generated audit manifest: ' + OUTPUT_PATH);
console.log('Total files: ' + auditEntries.length);
console.log('Classification: ACTIVE=' + classificationCounts.ACTIVE + ', SUPERSEDED=' + classificationCounts.SUPERSEDED + ', UNIQUE=' + classificationCounts.UNIQUE);
console.log('Recommended layers: L0=' + layerCounts.L0 + ', L1=' + layerCounts.L1 + ', L2=' + layerCounts.L2);
console.log('AI readiness avg: ' + manifest.summary.ai_readiness_avg);
console.log('L0 candidates: ' + l0Candidates.length + ', L2>L1 overrides: ' + l2OverrideCandidates.length);
