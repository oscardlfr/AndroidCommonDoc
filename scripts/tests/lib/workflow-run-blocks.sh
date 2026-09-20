#!/usr/bin/env bash
# Extract the semantic string values of every `run` or `script` key in a
# GitHub Actions workflow. Security fences must inspect the YAML GitHub will
# execute, not a spelling-specific approximation: valid workflows may use
# quoted/explicit/flow keys, anchors, tags, indentation indicators, folded
# blocks, or multiline scalars.
#
# The repository already pins the `yaml` package in mcp-server. A missing
# dependency, malformed YAML, duplicate key, alias overflow, or non-string
# runtime body is an extraction error and returns non-zero (fail closed).

_workflow_root() {
    if [[ -n "${L0_ROOT:-}" ]]; then
        printf '%s\n' "$L0_ROOT"
    else
        cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd
    fi
}

_yaml_block_lines() {
    local wf="$1"
    local key="$2"
    local root yaml_module
    root="$(_workflow_root)" || return
    yaml_module="$root/mcp-server/node_modules/yaml"

    ACD_WORKFLOW_YAML_MODULE="$yaml_module" node - "$wf" "$key" <<'NODE'
const fs = require('node:fs');

const workflowPath = process.argv[2];
const runtimeKey = process.argv[3];
const yamlModule = process.env.ACD_WORKFLOW_YAML_MODULE;

let YAML;
try {
  YAML = require(yamlModule);
} catch (error) {
  console.error(`[workflow-run-blocks] cannot load pinned YAML parser at ${yamlModule}: ${error.message}`);
  process.exit(2);
}

let document;
try {
  document = YAML.parseDocument(fs.readFileSync(workflowPath, 'utf8'), {
    strict: true,
    uniqueKeys: true,
  });
} catch (error) {
  console.error(`[workflow-run-blocks] cannot read/parse ${workflowPath}: ${error.message}`);
  process.exit(2);
}

if (document.errors.length > 0) {
  for (const error of document.errors) {
    console.error(`[workflow-run-blocks] invalid YAML in ${workflowPath}: ${error.message}`);
  }
  process.exit(2);
}

let workflow;
try {
  workflow = document.toJS({ maxAliasCount: 100, mapAsMap: false });
} catch (error) {
  console.error(`[workflow-run-blocks] cannot materialize ${workflowPath}: ${error.message}`);
  process.exit(2);
}

const visited = new WeakSet();
function visit(value) {
  if (value === null || typeof value !== 'object') return;
  if (visited.has(value)) return;
  visited.add(value);

  if (Array.isArray(value)) {
    for (const item of value) visit(item);
    return;
  }

  if (Object.prototype.hasOwnProperty.call(value, runtimeKey)) {
    const body = value[runtimeKey];
    const isRunDefaults = runtimeKey === 'run' && body !== null && typeof body === 'object' &&
      !Array.isArray(body) && Object.keys(body).every(key => key === 'shell' || key === 'working-directory');
    if (typeof body === 'string') {
      process.stdout.write(`${body}\n`);
    } else if (!isRunDefaults) {
      console.error(`[workflow-run-blocks] ${runtimeKey} in ${workflowPath} is not a string`);
      process.exit(2);
    }
  }

  for (const child of Object.values(value)) visit(child);
}

visit(workflow);
NODE
}

run_block_lines() {
    _yaml_block_lines "$1" "run"
}

script_block_lines() {
    _yaml_block_lines "$1" "script"
}

# Canonicalize expression spelling for security assertions. GitHub accepts
# whitespace-free/multiline expressions and bracket dereferences (for example
# `${{inputs['x']}}`) as equivalents of dot notation. Joining lines and
# canonicalizing simple quoted keys gives every fence one spelling to inspect.
_normalized_block_expression_text() {
    tr -d '[:space:]' | sed -E "s/\[['\"]([A-Za-z_][A-Za-z0-9_-]*)['\"]\]/.\1/g"
}

run_block_expression_text() {
    local extracted
    extracted="$(run_block_lines "$1")" || return
    printf '%s' "$extracted" | _normalized_block_expression_text
}

script_block_expression_text() {
    local extracted
    extracted="$(script_block_lines "$1")" || return
    printf '%s' "$extracted" | _normalized_block_expression_text
}

run_block_expression_absent() {
    local normalized
    normalized="$(run_block_expression_text "$1")" || return
    ! grep -qiE "$2" <<< "$normalized"
}

script_block_expression_absent() {
    local normalized
    normalized="$(script_block_expression_text "$1")" || return
    ! grep -qiE "$2" <<< "$normalized"
}
