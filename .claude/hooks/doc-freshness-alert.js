#!/usr/bin/env node
// Doc Freshness Alert — PostToolUse hook
// When Claude writes/edits a .kt file, checks if any pattern doc
// referencing that file is stale (>90 days since last update).
// Emits advisory warning as additionalContext.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const STALE_DAYS = 90;

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    const filePath = data.tool_input?.file_path || '';

    // Only check .kt files
    if (!filePath.endsWith('.kt')) {
      process.exit(0);
    }

    const cwd = data.cwd || process.cwd();
    const basename = path.basename(filePath).toLowerCase();

    // Find L0 docs dir (via ANDROID_COMMON_DOC or relative)
    const l0Root = process.env.ANDROID_COMMON_DOC || path.resolve(cwd);
    const docsDir = path.join(l0Root, 'docs');
    if (!fs.existsSync(docsDir)) {
      process.exit(0);
    }

    // Scan docs for frontmatter targets matching this file
    const staleWarnings = [];
    const scanDir = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.name.endsWith('.md')) {
          const content = fs.readFileSync(fullPath, 'utf8');
          const targetsMatch = content.match(/^targets:\s*\[([^\]]*)\]/m);
          if (!targetsMatch) continue;
          const targets = targetsMatch[1].toLowerCase();
          if (!targets.includes(basename.replace('.kt', '')) && !targets.includes('.kt')) continue;

          // Check git last-modified date using execFileSync (safe, no shell injection)
          try {
            const dateStr = execFileSync(
              'git', ['log', '-1', '--format=%ci', '--', fullPath],
              { cwd: l0Root, encoding: 'utf8', timeout: 3000 }
            ).trim();
            if (!dateStr) continue;
            const lastModified = new Date(dateStr);
            const daysSince = (Date.now() - lastModified.getTime()) / (1000 * 60 * 60 * 24);
            if (daysSince > STALE_DAYS) {
              const relPath = path.relative(l0Root, fullPath).replace(/\\/g, '/');
              staleWarnings.push(
                `${relPath} (${Math.round(daysSince)} days old) may reference patterns for ${basename}`
              );
            }
          } catch (e) {
            // git command failed, skip
          }
        }
      }
    };

    scanDir(docsDir);

    if (staleWarnings.length > 0) {
      const output = {
        additionalContext: `Stale docs detected for ${basename}:\n${staleWarnings.map(w => `- ${w}`).join('\n')}\nConsider updating these docs or running /doc-check.`
      };
      process.stdout.write(JSON.stringify(output));
    }
  } catch (e) {
    // Silent failure
  }
  process.exit(0);
});
