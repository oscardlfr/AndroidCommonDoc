#!/usr/bin/env bash

# Shared structured-verdict fixtures for isolated quality-gate repositories.
# These helpers intentionally write the same verdict-request/v1 + verdict/v1
# records consumed by the production validator; no Markdown authority remains.

install_verdict_contract_runtime() {
  local source_root="$1" repo="$2"
  mkdir -p "$repo/scripts/lib/runtime-role-lifecycle"
  cp "$source_root/scripts/lib/verdict-evidence-contract.cjs" "$repo/scripts/lib/"
  cp "$source_root/scripts/lib/verdict-artifact-store.cjs" "$repo/scripts/lib/"
  cp "$source_root/scripts/lib/verdict-evidence-contract-cli.cjs" "$repo/scripts/lib/"
  cp "$source_root/scripts/lib/runtime-role-lifecycle/structural-validators.cjs" \
    "$repo/scripts/lib/runtime-role-lifecycle/"
}

write_structured_arch_verdicts() {
  local repo="$1" slug="$2" head="$3"
  shift 3
  local roles=("$@")
  if [ "${#roles[@]}" -eq 0 ]; then
    roles=(arch-platform arch-testing arch-integration)
  fi
  local wave_dir="$repo/.planning/wave-$slug"
  mkdir -p "$wave_dir/verdict-requests" "$wave_dir/source-manifests"
  [ -f "$wave_dir/PLAN.md" ] || printf '# PLAN\n' > "$wave_dir/PLAN.md"

  node - "$wave_dir" "$slug" "$head" "${roles[@]}" <<'NODEEOF'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const [waveDir, slug, head, ...roles] = process.argv.slice(2);
const planPath = path.join(waveDir, 'PLAN.md');
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const planSha = sha256(fs.readFileSync(planPath));
const createdAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
function writeJson(filePath, value) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.writeFileSync(filePath, bytes);
  return sha256(bytes);
}
for (const role of roles) {
  const requestId = sha256(`${slug}|${head}|${role}|verify-final`).slice(0, 32);
  const subjectRel = `source-manifests/${requestId}.json`;
  const subjectSha = writeJson(path.join(waveDir, subjectRel), {
    schema: 'source-manifest/v1', files: [],
  });
  const requestRel = `verdict-requests/${requestId}.json`;
  const request = {
    schema: 'verdict-request/v1', request_id: requestId,
    role, phase: 'verify-final', wave_slug: slug,
    plan_sha256: planSha, head,
    subject: { kind: 'source-manifest', path: subjectRel, sha256: subjectSha },
    created_at: createdAt,
  };
  const requestSha = writeJson(path.join(waveDir, requestRel), request);
  const verdict = {
    schema: 'verdict/v1', role, wave_slug: slug,
    phase: 'verify-final', decision: 'approve',
    rationale: 'isolated quality-gate fixture',
    evidence: [{
      kind: 'json-record', path: subjectRel,
      sha256: subjectSha, expected_schema: 'source-manifest/v1',
    }],
    head, plan_sha256: planSha, in_reply_to: requestId,
    request_ref: { path: requestRel, sha256: requestSha },
    created_at: createdAt, supersedes: null,
  };
  const shortRole = role.replace(/^arch-/, '');
  writeJson(path.join(waveDir, `arch-${shortRole}-verdict-verify-final.json`), verdict);
}
NODEEOF
}

write_two_agreeing_bats_handoffs() {
  local repo="$1" acdoc="$2" slug="$3" head="$4"
  local ok="${5:-42}" not_ok="${6:-0}" complete="${7:-true}" verdict="${8:-pass}"
  local wave_dir="$repo/.planning/wave-$slug"
  mkdir -p "$acdoc" "$wave_dir"
  [ -f "$wave_dir/PLAN.md" ] || printf '# PLAN\n' > "$wave_dir/PLAN.md"
  node - "$acdoc" "$wave_dir/PLAN.md" "$slug" "$head" "$ok" "$not_ok" "$complete" "$verdict" <<'NODEEOF'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const [acdoc, planPath, slug, head, ok, notOk, complete, verdict] = process.argv.slice(2);
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const expected = String(Number(ok) + Number(notOk));
const planDigest = sha256(fs.readFileSync(planPath));
const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const targetDigest = sha256('isolated-full-roster');
const envDigest = sha256('isolated-quality-gate-fixture');
for (const index of [1, 2]) {
  const runId = `fixture-${process.pid}-${index}`;
  const values = {
    BATS_OK: ok, BATS_NOT_OK: notOk, BATS_EXPECTED: expected,
    BATS_TOTAL: expected, BATS_COMPLETE: complete, BATS_VERDICT: verdict,
    BATS_LOG: `/tmp/${runId}.tap`, BATS_HEAD: head,
    BATS_RUN_ID: runId, BATS_GENERATED_AT: stamp, BATS_SCOPE: 'full',
    BATS_PLAN_DIGEST: planDigest, BATS_WAVE_SLUG: slug,
    BATS_TARGET_DIGEST: targetDigest, BATS_ENV_FINGERPRINT: envDigest,
    BATS_STARTED_AT: stamp, BATS_FINISHED_AT: stamp,
    BATS_LOG_DIGEST: sha256(`${runId}|tap`),
    BATS_LOG_IDENTITY: sha256(`${runId}|artifact`),
    BATS_TOOL_VERSIONS: 'bats-1.13.0_node-24',
  };
  const body = Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join('');
  fs.writeFileSync(path.join(acdoc, `bats-result.${runId}.env`), body, 'utf8');
}
NODEEOF
}
