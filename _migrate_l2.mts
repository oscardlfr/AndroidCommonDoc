// Direct pipeline migration for DawSync (L2) and DawSyncWeb
// Bypasses Groq free-tier TPM limit by importing gsd-pi TypeScript source directly

import { validatePlanningDirectory, parsePlanningDirectory, transformToGSD, writeGSDDirectory, generatePreview } from 'file:///C:/nvm4w/nodejs/node_modules/gsd-pi/src/resources/extensions/gsd/migrate/index.js';
import { existsSync } from 'node:fs';

async function migrate(projectPath: string, projectName: string) {
  const planningDir = `${projectPath}/.planning`;

  console.log(`\n=== Migrating ${projectName} ===`);
  console.log(`Planning dir: ${planningDir}`);

  // Check if .gsd already exists
  if (existsSync(`${projectPath}/.gsd`)) {
    console.log(`ERROR: .gsd/ already exists at ${projectPath}. Skipping.`);
    return;
  }

  // Step 1: Validate
  console.log('\n--- Step 1: Validate ---');
  const validation = await validatePlanningDirectory(planningDir);
  console.log(`Valid: ${validation.valid}`);
  for (const issue of validation.issues) {
    console.log(`  [${issue.severity}] ${issue.file}: ${issue.message}`);
  }
  if (!validation.valid) {
    console.log('FATAL: Validation failed. Cannot proceed.');
    return;
  }

  // Step 2: Parse
  console.log('\n--- Step 2: Parse ---');
  const parsed = await parsePlanningDirectory(planningDir);
  console.log(`Parsed keys: ${Object.keys(parsed).join(', ')}`);
  console.log(`Parsed type: ${typeof parsed}`);
  // Inspect shape
  for (const key of Object.keys(parsed)) {
    const val = (parsed as any)[key];
    if (Array.isArray(val)) {
      console.log(`  ${key}: Array(${val.length})`);
    } else if (typeof val === 'object' && val !== null) {
      console.log(`  ${key}: Object(${Object.keys(val).join(', ')})`);
    } else {
      console.log(`  ${key}: ${typeof val} = ${String(val).substring(0, 100)}`);
    }
  }

  // Step 3: Transform
  console.log('\n--- Step 3: Transform ---');
  const gsd = transformToGSD(parsed);
  console.log(`Milestones: ${gsd.milestones.length}`);
  for (const m of gsd.milestones) {
    console.log(`  ${m.id}: ${m.name} (${m.slices.length} slices)`);
    for (const s of m.slices) {
      console.log(`    ${s.id}: ${s.name} (${s.tasks.length} tasks, done=${s.done})`);
    }
  }

  // Step 4: Preview
  console.log('\n--- Step 4: Preview ---');
  const preview = generatePreview(gsd);
  console.log(`Milestones: ${preview.milestoneCount}`);
  console.log(`Total slices: ${preview.totalSlices}, done: ${preview.doneSlices} (${preview.sliceCompletionPct}%)`);
  console.log(`Total tasks: ${preview.totalTasks}, done: ${preview.doneTasks} (${preview.taskCompletionPct}%)`);
  console.log(`Requirements: ${JSON.stringify(preview.requirements)}`);

  // Step 5: Write
  console.log('\n--- Step 5: Write ---');
  const outputDir = `${projectPath}/.gsd`;
  const result = await writeGSDDirectory(gsd, outputDir);
  console.log(`Files written: ${result.paths.length}`);
  console.log(`Counts: ${JSON.stringify(result.counts)}`);

  console.log(`\n=== ${projectName} migration complete ===\n`);
  return { preview, result };
}

// Run migrations
const DAWSYNC_PATH = 'C:/Users/34645/AndroidStudioProjects/DawSync';
const DAWSYNCWEB_PATH = 'C:/Users/34645/AndroidStudioProjects/DawSyncWeb';

try {
  const dawsyncResult = await migrate(DAWSYNC_PATH, 'DawSync (L2)');
  const dawsyncwebResult = await migrate(DAWSYNCWEB_PATH, 'DawSyncWeb');

  console.log('\n=== MIGRATION SUMMARY ===');
  if (dawsyncResult) {
    console.log(`DawSync: ${dawsyncResult.result.paths.length} files, ${dawsyncResult.preview.milestoneCount} milestones, ${dawsyncResult.preview.totalSlices} slices, ${dawsyncResult.preview.totalTasks} tasks`);
  }
  if (dawsyncwebResult) {
    console.log(`DawSyncWeb: ${dawsyncwebResult.result.paths.length} files, ${dawsyncwebResult.preview.milestoneCount} milestones, ${dawsyncwebResult.preview.totalSlices} slices, ${dawsyncwebResult.preview.totalTasks} tasks`);
  }
} catch (err) {
  console.error('Migration failed:', err);
  process.exit(1);
}
