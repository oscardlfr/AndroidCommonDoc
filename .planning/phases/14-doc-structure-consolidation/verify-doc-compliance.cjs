/**
 * verify-doc-compliance.cjs
 *
 * Validates markdown documentation files against the standard doc template.
 * Checks: required frontmatter fields, line count limits, section structure.
 *
 * Usage: node verify-doc-compliance.cjs "docs/*.md"
 *        node verify-doc-compliance.cjs docs/testing-patterns.md
 */

const fs = require('fs');
const path = require('path');
const { glob } = require('path');

// Required frontmatter fields for template compliance
const REQUIRED_FIELDS = ['scope', 'sources', 'targets', 'slug', 'status', 'description'];

// Line count limits
const WARN_LINE_LIMIT = 300;
const ERROR_LINE_LIMIT = 500;
const MIN_H2_SECTIONS = 3;

/**
 * Parse YAML frontmatter from a markdown string.
 * Minimal parser -- handles the subset of YAML used in our frontmatter.
 */
function parseFrontmatter(content) {
  // Strip BOM
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }
  // Normalize line endings
  content = content.replace(/\r\n/g, '\n');

  if (!content.startsWith('---\n')) {
    return { data: null, body: content };
  }

  const closingIndex = content.indexOf('\n---\n', 3);
  if (closingIndex === -1) {
    if (content.endsWith('\n---')) {
      const yamlBlock = content.slice(4, content.length - 4);
      return { data: parseSimpleYaml(yamlBlock), body: '' };
    }
    return { data: null, body: content };
  }

  const yamlBlock = content.slice(4, closingIndex);
  const body = content.slice(closingIndex + 5);
  return { data: parseSimpleYaml(yamlBlock), body };
}

/**
 * Minimal YAML parser for frontmatter fields.
 * Handles: scalar values, arrays (both flow [...] and block - item), nested objects for monitor_urls/rules.
 */
function parseSimpleYaml(yaml) {
  const result = {};
  const lines = yaml.split('\n');

  let currentKey = null;
  let inArray = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimEnd();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Check for top-level key: value
    const keyMatch = trimmed.match(/^([a-z_][a-z0-9_]*)\s*:\s*(.*)/i);
    if (keyMatch) {
      const key = keyMatch[1];
      const value = keyMatch[2].trim();

      if (value === '' || value === '|' || value === '>') {
        // Block scalar or start of nested structure -- mark key as present
        currentKey = key;
        inArray = false;
        result[key] = [];
        continue;
      }

      // Flow-style array: [item1, item2]
      if (value.startsWith('[')) {
        const arrayContent = value.slice(1, value.lastIndexOf(']'));
        result[key] = arrayContent
          .split(',')
          .map(s => s.trim().replace(/^["']|["']$/g, ''))
          .filter(s => s.length > 0);
        currentKey = null;
        inArray = false;
        continue;
      }

      // Quoted string value
      if (value.startsWith('"') || value.startsWith("'")) {
        result[key] = value.replace(/^["']|["']$/g, '');
      } else if (value === 'true') {
        result[key] = true;
      } else if (value === 'false') {
        result[key] = false;
      } else if (!isNaN(Number(value)) && value !== '') {
        result[key] = Number(value);
      } else {
        result[key] = value;
      }
      currentKey = key;
      inArray = false;
      continue;
    }

    // Block-style array item: - value
    const arrayItemMatch = trimmed.match(/^\s+-\s+(.*)/);
    if (arrayItemMatch && currentKey) {
      if (!Array.isArray(result[currentKey])) {
        result[currentKey] = [];
      }
      const itemValue = arrayItemMatch[1].trim();
      // If item starts with key: value, it's a nested object -- mark as present
      if (itemValue.match(/^[a-z_][a-z0-9_]*\s*:/i)) {
        result[currentKey].push({ _nested: true });
      } else {
        result[currentKey].push(itemValue.replace(/^["']|["']$/g, ''));
      }
      inArray = true;
      continue;
    }

    // Nested key under array item (indented further)
    if (inArray && trimmed.match(/^\s{4,}[a-z_]/i)) {
      // Part of nested object -- skip
      continue;
    }
  }

  return result;
}

/**
 * Check a single markdown file for template compliance.
 */
function checkFile(filePath) {
  const result = {
    file: filePath,
    valid: true,
    warnings: [],
    errors: []
  };

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    result.valid = false;
    result.errors.push(`Cannot read file: ${err.message}`);
    return result;
  }

  // Normalize line endings for consistent counting
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const lineCount = lines.length;

  // 1. Parse frontmatter
  const { data, body } = parseFrontmatter(content);

  if (!data) {
    result.valid = false;
    result.errors.push('No YAML frontmatter found (must start with ---)');
    return result;
  }

  // 2. Check required frontmatter fields
  for (const field of REQUIRED_FIELDS) {
    if (data[field] === undefined || data[field] === null) {
      result.errors.push(`Missing required frontmatter field: ${field}`);
      result.valid = false;
    } else if (Array.isArray(data[field]) && data[field].length === 0) {
      result.errors.push(`Empty required frontmatter field: ${field}`);
      result.valid = false;
    }
  }

  // 3. Check line count limits
  if (lineCount > ERROR_LINE_LIMIT) {
    result.errors.push(`File exceeds ${ERROR_LINE_LIMIT} line limit: ${lineCount} lines`);
    result.valid = false;
  } else if (lineCount > WARN_LINE_LIMIT) {
    result.warnings.push(`File exceeds ${WARN_LINE_LIMIT} line recommended limit: ${lineCount} lines (consider splitting into hub + sub-docs)`);
  }

  // 4. Check section count (at least 3 H2 sections)
  const h2Sections = (body || normalized)
    .split('\n')
    .filter(line => line.match(/^## /));

  if (h2Sections.length < MIN_H2_SECTIONS) {
    result.warnings.push(`Only ${h2Sections.length} H2 sections found (recommended: at least ${MIN_H2_SECTIONS})`);
  }

  // 5. Optional: check for common quality indicators
  if (data.version === undefined) {
    result.warnings.push('Missing optional field: version (recommended for change tracking)');
  }
  if (data.last_updated === undefined) {
    result.warnings.push('Missing optional field: last_updated (recommended for freshness tracking)');
  }

  return result;
}

/**
 * Resolve a glob pattern to file paths.
 * Simple glob support: handles * wildcard in filename only.
 */
function resolveGlob(pattern) {
  // Check if it's a direct file path
  if (fs.existsSync(pattern) && fs.statSync(pattern).isFile()) {
    return [pattern];
  }

  // Simple glob: split into dir + filename pattern
  const dir = path.dirname(pattern);
  const filePattern = path.basename(pattern);

  if (!fs.existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    return [];
  }

  // Convert glob to regex
  const regex = new RegExp(
    '^' + filePattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$'
  );

  return fs.readdirSync(dir)
    .filter(f => regex.test(f) && f.endsWith('.md'))
    .map(f => path.join(dir, f));
}

// Main
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node verify-doc-compliance.cjs <file-or-glob>');
  console.error('  e.g.: node verify-doc-compliance.cjs "docs/*.md"');
  console.error('  e.g.: node verify-doc-compliance.cjs docs/testing-patterns.md');
  process.exit(1);
}

const pattern = args[0];
const files = resolveGlob(pattern);

if (files.length === 0) {
  console.error(`No files matched: ${pattern}`);
  process.exit(1);
}

let allValid = true;
const results = [];

for (const file of files) {
  const result = checkFile(file);
  results.push(result);
  if (!result.valid) allValid = false;
}

// Output results as JSON
console.log(JSON.stringify(results, null, 2));

// Exit code: 0 if all valid, 1 if any errors
process.exit(allValid ? 0 : 1);
