'use strict';

const WAVE_CLASSES = Object.freeze(['HARNESS', 'DOC', 'FAST-PATH']);

function decodePlanBytes(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new Error('PLAN_BYTES_INVALID');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('PLAN_TEXT_ENCODING_INVALID'); }
}

function structuralLineFlags(lines) {
  const structural = [];
  let fence = null;
  for (const line of lines) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      const candidate = marker[1];
      if (fence === null) fence = { char: candidate[0], length: candidate.length };
      else if (candidate[0] === fence.char && candidate.length >= fence.length && /^[ \t]*$/.test(marker[2])) fence = null;
      structural.push(false);
      continue;
    }
    structural.push(fence === null);
  }
  return structural;
}

/**
 * Parse the one canonical Wave Class declaration from PLAN.md.
 * Error messages are stable machine-readable reason codes used by adapters.
 */
function parsePlanClass(planText) {
  if (typeof planText !== 'string') throw new Error('PLAN_TEXT_INVALID');
  const lines = planText.split(/\r?\n/);
  const structural = structuralLineFlags(lines);

  const headings = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (structural[index] && /^#{2,3}[ \t]+Wave[ \t]+Class[ \t]*$/.test(lines[index])) headings.push(index);
  }
  if (headings.length === 0) throw new Error('WAVE_CLASS_SECTION_MISSING');
  if (headings.length !== 1) throw new Error('WAVE_CLASS_SECTION_AMBIGUOUS');

  const declarations = [];
  for (let index = headings[0] + 1; index < lines.length; index += 1) {
    if (!structural[index]) continue;
    if (/^#{1,6}[ \t]+/.test(lines[index])) break;
    if (/^[ \t]*(?:-[ \t]+)?\*\*Class\*\*:/.test(lines[index])) declarations.push(lines[index]);
  }
  if (declarations.length === 0) throw new Error('PLAN_WAVE_CLASS_MISSING');
  if (declarations.length !== 1) throw new Error('PLAN_WAVE_CLASS_AMBIGUOUS');

  const match = /^[ \t]*(?:-[ \t]+)?\*\*Class\*\*:[ \t]*(?:`([A-Za-z0-9][A-Za-z0-9_-]*)`|([A-Za-z0-9][A-Za-z0-9_-]*))[ \t]*[.,;:!?]?[ \t]*$/.exec(declarations[0]);
  const className = match && (match[1] || match[2]);
  if (!className || !WAVE_CLASSES.includes(className)) throw new Error('INVALID_WAVE_CLASS');
  return className;
}

module.exports = { WAVE_CLASSES, decodePlanBytes, structuralLineFlags, parsePlanClass };
