'use strict';

function createSchemaProtocol(deps) {
  const {
    fs,
    CliError,
    HEX_ID_RE,
  } = deps;

function readArtifactBytes(artifactPath) {
  try {
    return fs.readFileSync(artifactPath);
  } catch (err) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'cannot read artifact: ' + artifactPath);
  }
}

function parseJsonOrSchemaInvalid(bytes) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (err) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'artifact is not valid JSON');
  }
}

/**
 * Validates `obj` against a closed field-shape definition: every key in `obj`
 * must be a known field (additionalProperties:false), every field marked
 * `required !== false` must be present, and every present field must pass its
 * own `check(value, wholeObject)` predicate. Throws SCHEMA_INVALID otherwise.
 */
function assertClosedShape(obj, fieldDefs) {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'artifact is not a JSON object');
  }
  const allowedKeys = Object.keys(fieldDefs);
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.includes(key)) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'unknown field: ' + key);
    }
  }
  for (const key of allowedKeys) {
    const def = fieldDefs[key];
    const present = Object.prototype.hasOwnProperty.call(obj, key);
    if (!present) {
      if (def.required !== false) {
        throw new CliError('INVALID', 'SCHEMA_INVALID', 'missing required field: ' + key);
      }
      continue;
    }
    if (def.check && !def.check(obj[key], obj)) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'invalid field: ' + key);
    }
  }
}


// ── Field-check predicate library ───────────────────────────────────────────

function isString(v) { return typeof v === 'string'; }
function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }
function isInteger(v) { return Number.isInteger(v); }
function isNonNegativeInteger(v) { return Number.isInteger(v) && v >= 0; }
function isBoolean(v) { return typeof v === 'boolean'; }
function orNull(check) { return (v) => v === null || check(v); }
function isHex64(v) { return typeof v === 'string' && /^[a-f0-9]{64}$/.test(v); }
function isHexId(v) { return typeof v === 'string' && HEX_ID_RE.test(v); }
function isIsoTimestamp(v) { return typeof v === 'string' && !Number.isNaN(new Date(v).getTime()); }
function isEnum(values) { return (v) => values.includes(v); }
function utf8ByteLength(s) { return Buffer.byteLength(s, 'utf8'); }
function isPlainObject(v) { return typeof v === 'object' && v !== null && !Array.isArray(v); }

function isContentRefHandle(v) {
  if (!isPlainObject(v)) return false;
  const keys = Object.keys(v).sort().join(',');
  if (keys !== 'blob,digest,size') return false;
  if (!isHex64(v.blob) || !isHex64(v.digest)) return false;
  if (!Number.isInteger(v.size) || v.size < 0 || v.size > 10485760) return false;
  return true;
}

/**
 * ANSWERED/BLOCKED result content is `content` (inline, <=64KiB) XOR `content_ref`
 * (content_ref-handle, <=10MiB) -- never both, never neither, never any other key
 * (PLAN.md ~L429). This helper is applied at the whole-object level (see
 * `RESULT_V2_FIELDS`'s `status` check) rather than per-field, since it is a
 * cross-field XOR rule.
 */
function assertResultContentXor(obj) {
  const hasContent = Object.prototype.hasOwnProperty.call(obj, 'content');
  const hasRef = Object.prototype.hasOwnProperty.call(obj, 'content_ref');
  if (obj.status === 'ANSWERED') {
    if (hasContent === hasRef) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'ANSWERED requires exactly one of content/content_ref');
    }
    if (hasContent && (typeof obj.content !== 'string' || obj.content.length === 0 || utf8ByteLength(obj.content) > 65536)) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'invalid inline content');
    }
    if (hasRef && !isContentRefHandle(obj.content_ref)) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'invalid content_ref handle');
    }
    if (obj.reason !== null) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'ANSWERED requires reason:null');
    }
  } else if (obj.status === 'BLOCKED') {
    if (hasContent || hasRef) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'BLOCKED must not carry content/content_ref');
    }
    if (!isEnum(['CONTENT_TOO_LARGE', 'INSUFFICIENT_CONTEXT', 'UNSUPPORTED_REQUEST', 'CONSULTATION_FAILED', 'POLICY_DENIED'])(obj.reason)) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'BLOCKED requires a valid reason enum');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

  return {
    readArtifactBytes,
    parseJsonOrSchemaInvalid,
    assertClosedShape,
    isString,
    isNonEmptyString,
    isInteger,
    isNonNegativeInteger,
    isBoolean,
    orNull,
    isHex64,
    isHexId,
    isIsoTimestamp,
    isEnum,
    utf8ByteLength,
    isPlainObject,
    isContentRefHandle,
    assertResultContentXor,
  };
}

module.exports = { createSchemaProtocol };
