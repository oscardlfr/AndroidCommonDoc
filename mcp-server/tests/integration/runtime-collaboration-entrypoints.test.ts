/**
 * P3 RED -- executable five-entrypoint product-flow contract.
 *
 * Every one of the 18 tests below first calls the shared loadEntrypoint()
 * helper, which asserts that scripts/lib/runtime-collaboration-entrypoints.cjs
 * exists before requiring it. That production module does not exist yet, so
 * all 18 tests fail for that single, shared reason -- this is the intended
 * RED result. GREEN work implements the module; this file is not touched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import * as path from "path";
import { createRequire } from "module";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(__dirname, "../../..");
const ENTRYPOINT_MODULE = path.join(
  ROOT,
  "scripts/lib/runtime-collaboration-entrypoints.cjs",
);
const TEST_CAPABILITY_VALUE = "p3-entrypoints-v1";

const CANONICAL_ENTRYPOINTS = [
  "init-session",
  "resume-work",
  "work",
  "ingest-content",
  "monitor-docs",
];
const CANONICAL_RESULT_STATUSES = [
  "READY",
  "ACTION_REQUIRED",
  "COMPLETED",
  "BLOCKED",
  "UNAVAILABLE",
  "FAILED",
];
const SUPPORT_ROLES = [
  "arch-platform",
  "arch-testing",
  "arch-integration",
  "context-provider",
  "doc-updater",
];

/**
 * Shared entrypoint loader (Do not mock fs.existsSync for this path). Every
 * test calls this first; today it always throws with the missing absolute
 * module path in its message, producing 18 independent RED failures rather
 * than one suite-load crash.
 */
function loadEntrypoint(options?: { fresh?: boolean }): any {
  if (!fs.existsSync(ENTRYPOINT_MODULE)) {
    throw new Error(
      `P3 RED: missing production module at ${ENTRYPOINT_MODULE}`,
    );
  }
  const req = createRequire(import.meta.url);
  if (options?.fresh) {
    const resolved = req.resolve(ENTRYPOINT_MODULE);
    delete req.cache[resolved];
  }
  return req(ENTRYPOINT_MODULE);
}

function withTestCapability<T>(fn: () => T): T {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevCapability =
    process.env.RUNTIME_COLLABORATION_ENTRYPOINTS_TEST_CAPABILITY;
  process.env.NODE_ENV = "test";
  process.env.RUNTIME_COLLABORATION_ENTRYPOINTS_TEST_CAPABILITY =
    TEST_CAPABILITY_VALUE;
  try {
    return fn();
  } finally {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevCapability === undefined) {
      delete process.env.RUNTIME_COLLABORATION_ENTRYPOINTS_TEST_CAPABILITY;
    } else {
      process.env.RUNTIME_COLLABORATION_ENTRYPOINTS_TEST_CAPABILITY =
        prevCapability;
    }
  }
}

function loadEntrypointWithCapability(): any {
  return withTestCapability(() => loadEntrypoint({ fresh: true }));
}

const HEX64_A = "a".repeat(64);
const HEX64_B = "b".repeat(64);
const HEX64_C = "c".repeat(64);
const HEX64_D = "d".repeat(64);
const HEX64_E = "e".repeat(64);
const HEX64_F = "f".repeat(64);

function defaultSelectionResult() {
  return {
    actual_host: "claude",
    actual_model: "claude-sonnet-5",
    actual_role_engine: "claude",
    continuity: "session-persistent",
    fallback_reason: null,
    fallback_used: false,
    requested_host: "claude",
    requested_model_profile: ".claude/model-profiles.json#current",
    requested_role_engine: "claude",
  };
}

function createScriptedPorts(overrides: Record<string, Record<string, any>> = {}) {
  return {
    lifecycle: {
      status: vi.fn(async () => ({ roles: {} })),
      ensureRoles: vi.fn(async () => ({ actions: [] })),
      invokeRole: vi.fn(async () => ({ status: "ACTION_REQUIRED", actions: [] })),
      recoverRole: vi.fn(async () => ({ actions: [] })),
      stopOwned: vi.fn(async () => ({})),
      ...(overrides.lifecycle || {}),
    },
    consultation: {
      consult: vi.fn(async () => ({})),
      ingest: vi.fn(async () => ({})),
      monitor: vi.fn(async () => ({ observations: [], proposals: [] })),
      ...(overrides.consultation || {}),
    },
    adapter: {
      executeAction: vi.fn(async () => ({})),
      ...(overrides.adapter || {}),
    },
    selection: {
      resolve: vi.fn(() => defaultSelectionResult()),
      ...(overrides.selection || {}),
    },
    audit: {
      record: vi.fn(() => undefined),
      ...(overrides.audit || {}),
    },
  };
}

describe("P3 runtime-collaboration-entrypoints (RED)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1. exports exact ENTRYPOINTS/RESULT_STATUSES/async executeEntrypoint; a plain require exposes no __TEST_ONLY__ helper", () => {
    const mod = loadEntrypoint({ fresh: true });

    expect(Object.isFrozen(mod.ENTRYPOINTS)).toBe(true);
    expect(Array.from(mod.ENTRYPOINTS)).toEqual(CANONICAL_ENTRYPOINTS);

    expect(Object.isFrozen(mod.RESULT_STATUSES)).toBe(true);
    expect(Array.from(mod.RESULT_STATUSES)).toEqual(CANONICAL_RESULT_STATUSES);

    expect(typeof mod.executeEntrypoint).toBe("function");
    expect(mod.executeEntrypoint.constructor.name).toBe("AsyncFunction");
    expect(typeof mod.planEntrypointStep).toBe("function");

    expect(mod.__TEST_ONLY__createTrustedHostContext).toBeUndefined();
  });

  it("2. __TEST_ONLY__createTrustedHostContext requires both capability gates, exact ports, freezes the context, and rejects missing/extra/non-function ports", () => {
    const plainRequire = loadEntrypoint({ fresh: true });
    expect(plainRequire.__TEST_ONLY__createTrustedHostContext).toBeUndefined();

    const capabilityOnlyMod = (() => {
      const prev = process.env.RUNTIME_COLLABORATION_ENTRYPOINTS_TEST_CAPABILITY;
      const prevNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      process.env.RUNTIME_COLLABORATION_ENTRYPOINTS_TEST_CAPABILITY = TEST_CAPABILITY_VALUE;
      try {
        return loadEntrypoint({ fresh: true });
      } finally {
        if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = prevNodeEnv;
        if (prev === undefined) delete process.env.RUNTIME_COLLABORATION_ENTRYPOINTS_TEST_CAPABILITY;
        else process.env.RUNTIME_COLLABORATION_ENTRYPOINTS_TEST_CAPABILITY = prev;
      }
    })();
    expect(capabilityOnlyMod.__TEST_ONLY__createTrustedHostContext).toBeUndefined();

    withTestCapability(() => {
      const mod = loadEntrypoint({ fresh: true });
      expect(typeof mod.__TEST_ONLY__createTrustedHostContext).toBe("function");

      const ports = createScriptedPorts();
      const context = mod.__TEST_ONLY__createTrustedHostContext(ports);
      expect(Object.isFrozen(context)).toBe(true);

      const { lifecycle, ...missingLifecycle } = ports;
      expect(() => mod.__TEST_ONLY__createTrustedHostContext(missingLifecycle)).toThrow();

      expect(() =>
        mod.__TEST_ONLY__createTrustedHostContext({ ...ports, extraTopLevelKey: {} }),
      ).toThrow();

      expect(() =>
        mod.__TEST_ONLY__createTrustedHostContext({
          ...ports,
          audit: { record: "not-a-function" },
        }),
      ).toThrow();

      expect(() =>
        mod.__TEST_ONLY__createTrustedHostContext({
          ...ports,
          selection: { resolve: ports.selection.resolve, extraPort: () => {} },
        }),
      ).toThrow();
    });
  });

  it("3. forged/plain/cross-module context is rejected before every port/audit call", async () => {
    const mod = loadEntrypointWithCapability();
    const ports = createScriptedPorts();

    const forged = { lifecycle: ports.lifecycle, consultation: ports.consultation, adapter: ports.adapter, selection: ports.selection, audit: ports.audit };
    await expect(
      mod.executeEntrypoint("init-session", { mode: "dashboard" }, forged),
    ).rejects.toBeTruthy();

    const crossModulePorts = createScriptedPorts();
    const crossModuleMod = loadEntrypointWithCapability();
    const crossModuleContext = crossModuleMod.__TEST_ONLY__createTrustedHostContext(crossModulePorts);
    await expect(
      mod.executeEntrypoint("init-session", { mode: "dashboard" }, crossModuleContext),
    ).rejects.toBeTruthy();

    for (const key of Object.keys(ports.lifecycle)) expect(ports.lifecycle[key]).not.toHaveBeenCalled();
    for (const key of Object.keys(ports.consultation)) expect(ports.consultation[key]).not.toHaveBeenCalled();
    expect(ports.adapter.executeAction).not.toHaveBeenCalled();
    expect(ports.audit.record).not.toHaveBeenCalled();
    for (const key of Object.keys(crossModulePorts.lifecycle)) expect(crossModulePorts.lifecycle[key]).not.toHaveBeenCalled();
  });

  it("4. unknown entrypoint and extra/missing intent keys reject before selection or any side effect", async () => {
    const mod = loadEntrypointWithCapability();
    const ports = createScriptedPorts();
    const context = mod.__TEST_ONLY__createTrustedHostContext(ports);

    await expect(
      mod.executeEntrypoint("not-a-real-entrypoint", { mode: "dashboard" }, context),
    ).rejects.toBeTruthy();
    await expect(
      mod.executeEntrypoint("init-session", { mode: "dashboard", extraKey: true }, context),
    ).rejects.toBeTruthy();
    await expect(
      mod.executeEntrypoint("init-session", {}, context),
    ).rejects.toBeTruthy();

    expect(ports.selection.resolve).not.toHaveBeenCalled();
    for (const key of Object.keys(ports.lifecycle)) expect(ports.lifecycle[key]).not.toHaveBeenCalled();
    for (const key of Object.keys(ports.consultation)) expect(ports.consultation[key]).not.toHaveBeenCalled();
    expect(ports.adapter.executeAction).not.toHaveBeenCalled();
  });

  it("5. every returned envelope has the exact seven-key closed shape and closed status/detail rules", async () => {
    const mod = loadEntrypointWithCapability();
    const ports = createScriptedPorts();
    const context = mod.__TEST_ONLY__createTrustedHostContext(ports);

    const envelope = await mod.executeEntrypoint("init-session", { mode: "dashboard" }, context);

    expect(Object.keys(envelope).sort()).toEqual(
      ["actions", "detail", "entrypoint", "result", "schema", "selection", "status"].sort(),
    );
    expect(envelope.schema).toBe("runtime/collaboration-entrypoint-result/v1");
    expect(CANONICAL_ENTRYPOINTS).toContain(envelope.entrypoint);
    expect(CANONICAL_RESULT_STATUSES).toContain(envelope.status);
    expect(typeof envelope.detail).toBe("string");
    expect(envelope.detail.length).toBeGreaterThan(0);
    expect(envelope.detail).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(Array.isArray(envelope.actions)).toBe(true);
    if (envelope.status !== "READY" && envelope.status !== "COMPLETED") {
      expect(envelope.result).toBeNull();
    }
    if (envelope.selection !== null) {
      expect(Object.keys(envelope.selection).sort()).toEqual(
        [
          "actual_host",
          "actual_model",
          "actual_role_engine",
          "continuity",
          "fallback_reason",
          "fallback_used",
          "requested_host",
          "requested_model_profile",
          "requested_role_engine",
        ].sort(),
      );
      expect(typeof envelope.selection.fallback_used).toBe("boolean");
      if (envelope.selection.fallback_used === false) {
        expect(envelope.selection.fallback_reason).toBeNull();
      }
    }
  });

  it("6. v2 policy exact canonical object validates; mutated/unknown/invalid-fallback/silently-downgraded variants fail; v1 projection is exact", () => {
    // Gated behind the same shared loadEntrypoint() failure -- policy v2
    // support in runtime-role-lifecycle.cjs is validated together with the
    // entrypoints module in GREEN, never ahead of it.
    loadEntrypoint({ fresh: true });

    const rll = require(path.join(ROOT, "scripts/lib/runtime-role-lifecycle.cjs"));
    const policyPath = path.join(ROOT, "scripts/lib/runtime-collaboration-policy.json");
    const v2Policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
    const v1Policy = { ...v2Policy };
    delete v1Policy.selection;
    v1Policy.schema = "runtime-collaboration-policy/v1";
    v1Policy.version = 1;

    expect(typeof rll.isValidPolicyV2).toBe("function");
    expect(typeof rll.projectPolicyV2ToV1).toBe("function");
    expect(typeof rll.isValidPolicy).toBe("function");

    expect(rll.isValidPolicyV2(v2Policy)).toBe(true);
    expect(rll.isValidPolicy(v1Policy)).toBe(true);

    for (const mutatedKey of Object.keys(v2Policy.selection)) {
      const mutated = {
        ...v2Policy,
        selection: { ...v2Policy.selection, [mutatedKey]: undefined },
      };
      expect(rll.isValidPolicyV2(mutated)).toBe(false);
    }
    expect(rll.isValidPolicyV2({ ...v2Policy, unknownTopLevelKey: true })).toBe(false);
    expect(
      rll.isValidPolicyV2({
        ...v2Policy,
        selection: { ...v2Policy.selection, fallback: { mode: "deny", allowed: [{ host: "claude", role_engine: "claude", continuity: "session-persistent" }] } },
      }),
    ).toBe(false);
    expect(
      rll.isValidPolicyV2({
        ...v2Policy,
        selection: { ...v2Policy.selection, fallback: { mode: "allow", allowed: [{ host: "claude", role_engine: "claude", continuity: "ephemeral" }] } },
      }),
    ).toBe(false);
    expect(
      rll.isValidPolicyV2({
        ...v2Policy,
        selection: { ...v2Policy.selection, fallback: { mode: "allow", allowed: [{ host: "claude", role_engine: "claude", continuity: "session-persistent" }] } },
      }),
    ).toBe(false);
    expect(
      rll.isValidPolicyV2({
        ...v2Policy,
        selection: { ...v2Policy.selection, required_continuity: "ephemeral" },
      }),
    ).toBe(false);

    const projected = rll.projectPolicyV2ToV1(v2Policy);
    expect(projected).toEqual(v1Policy);

    const pair = rll.resolvePolicyPair(ROOT);
    if (pair && pair.ok && pair.policy && pair.policy.selection !== undefined) {
      expect(pair.policyV1).toEqual(rll.projectPolicyV2ToV1(pair.policy));
    }
  });

  it("7. init-session dashboard intent {mode:'dashboard'} calls only lifecycle.status and returns READY; zero ensure/action/consult/audit mutation", async () => {
    const mod = loadEntrypointWithCapability();
    const ports = createScriptedPorts({
      lifecycle: { status: vi.fn(async () => ({ roles: Object.fromEntries(SUPPORT_ROLES.map((r) => [r, "READY"])) })) },
    });
    const context = mod.__TEST_ONLY__createTrustedHostContext(ports);

    const envelope = await mod.executeEntrypoint("init-session", { mode: "dashboard" }, context);

    expect(envelope.status).toBe("READY");
    expect(ports.lifecycle.status).toHaveBeenCalledTimes(1);
    expect(ports.lifecycle.ensureRoles).not.toHaveBeenCalled();
    expect(ports.lifecycle.invokeRole).not.toHaveBeenCalled();
    expect(ports.lifecycle.recoverRole).not.toHaveBeenCalled();
    expect(ports.adapter.executeAction).not.toHaveBeenCalled();
    expect(ports.consultation.consult).not.toHaveBeenCalled();
    expect(ports.consultation.ingest).not.toHaveBeenCalled();
    expect(ports.consultation.monitor).not.toHaveBeenCalled();
    expect(ports.audit.record).not.toHaveBeenCalled();
  });

  it("8. init-session start intent {mode:'start'} resolves selection, ensures exactly the five support roles, executes only returned ACTION_REQUIRED action refs, then status; a second call over READY performs zero duplicate ensure/action", async () => {
    const mod = loadEntrypointWithCapability();
    const actionRef = { ref: "action:" + HEX64_A };
    const firstStatus = vi.fn(async () => ({ roles: Object.fromEntries(SUPPORT_ROLES.map((r) => [r, "STARTING"])) }));
    const readyStatus = vi.fn(async () => ({ roles: Object.fromEntries(SUPPORT_ROLES.map((r) => [r, "READY"])) }));
    let statusCall = 0;
    const ports = createScriptedPorts({
      lifecycle: {
        status: vi.fn(async () => (statusCall++ === 0 ? firstStatus() : readyStatus())),
        ensureRoles: vi.fn(async () => ({ actions: [actionRef] })),
      },
      adapter: { executeAction: vi.fn(async (ref: any) => ({ ref })) },
    });
    const context = mod.__TEST_ONLY__createTrustedHostContext(ports);

    const first = await mod.executeEntrypoint("init-session", { mode: "start" }, context);
    expect(ports.selection.resolve).toHaveBeenCalledTimes(1);
    expect(ports.lifecycle.ensureRoles).toHaveBeenCalledTimes(1);
    expect(ports.lifecycle.ensureRoles.mock.calls[0][0]).toEqual(SUPPORT_ROLES);
    expect(ports.adapter.executeAction).toHaveBeenCalledTimes(1);
    expect(ports.adapter.executeAction).toHaveBeenCalledWith(actionRef);
    expect(CANONICAL_RESULT_STATUSES).toContain(first.status);

    ports.lifecycle.ensureRoles.mockClear();
    ports.adapter.executeAction.mockClear();
    const second = await mod.executeEntrypoint("init-session", { mode: "start" }, context);
    expect(second.status).toBe("READY");
    expect(ports.lifecycle.ensureRoles).not.toHaveBeenCalled();
    expect(ports.adapter.executeAction).not.toHaveBeenCalled();
  });

  it("9. exact selection mismatch with fallback deny returns UNAVAILABLE before lifecycle/adapter calls and records one digest-safe audit decision", async () => {
    const mod = loadEntrypointWithCapability();
    const ports = createScriptedPorts({
      selection: {
        resolve: vi.fn(() => ({
          ...defaultSelectionResult(),
          actual_host: "codex",
          fallback_used: false,
          fallback_reason: null,
        })),
      },
    });
    const context = mod.__TEST_ONLY__createTrustedHostContext(ports);

    const envelope = await mod.executeEntrypoint("init-session", { mode: "start" }, context);

    expect(envelope.status).toBe("UNAVAILABLE");
    expect(ports.lifecycle.status).not.toHaveBeenCalled();
    expect(ports.lifecycle.ensureRoles).not.toHaveBeenCalled();
    expect(ports.adapter.executeAction).not.toHaveBeenCalled();
    expect(ports.audit.record).toHaveBeenCalledTimes(1);
    const auditPayload = JSON.stringify(ports.audit.record.mock.calls[0][0]);
    expect(auditPayload).not.toMatch(/accessToken|access_token|password|secret|credential/i);
  });

  it("10. explicitly allowlisted claude/claude/ephemeral fallback is visible in selection fallback_used=true and fallback_reason, while a non-allowlisted fallback is UNAVAILABLE", async () => {
    const mod = loadEntrypointWithCapability();

    const allowedPorts = createScriptedPorts({
      selection: {
        resolve: vi.fn(() => ({
          ...defaultSelectionResult(),
          continuity: "ephemeral",
          fallback_used: true,
          fallback_reason: "primary-host-unavailable",
        })),
      },
    });
    const allowedContext = mod.__TEST_ONLY__createTrustedHostContext(allowedPorts);
    const allowedEnvelope = await mod.executeEntrypoint("init-session", { mode: "dashboard" }, allowedContext);
    expect(allowedEnvelope.selection).not.toBeNull();
    expect(allowedEnvelope.selection.fallback_used).toBe(true);
    expect(typeof allowedEnvelope.selection.fallback_reason).toBe("string");
    expect(allowedEnvelope.selection.fallback_reason!.length).toBeGreaterThan(0);
    expect(allowedEnvelope.status).not.toBe("UNAVAILABLE");

    const deniedPorts = createScriptedPorts({
      selection: {
        resolve: vi.fn(() => ({
          ...defaultSelectionResult(),
          actual_host: "codex",
          actual_role_engine: "codex",
          continuity: "ephemeral",
          fallback_used: true,
          fallback_reason: "codex-role-engine-fallback",
        })),
      },
    });
    const deniedContext = mod.__TEST_ONLY__createTrustedHostContext(deniedPorts);
    const deniedEnvelope = await mod.executeEntrypoint("init-session", { mode: "dashboard" }, deniedContext);
    expect(deniedEnvelope.status).toBe("UNAVAILABLE");
  });

  it("11. resume-work exact intent {checkpoint_ref} reuses five live non-fenced bindings with zero recoverRole calls", async () => {
    const mod = loadEntrypointWithCapability();
    const ports = createScriptedPorts({
      lifecycle: {
        status: vi.fn(async () => ({
          roles: Object.fromEntries(SUPPORT_ROLES.map((r) => [r, "READY"])),
        })),
      },
    });
    const context = mod.__TEST_ONLY__createTrustedHostContext(ports);

    const envelope = await mod.executeEntrypoint(
      "resume-work",
      { checkpoint_ref: "checkpoint:" + HEX64_B },
      context,
    );

    expect(ports.lifecycle.recoverRole).not.toHaveBeenCalled();
    expect(CANONICAL_RESULT_STATUSES).toContain(envelope.status);
  });

  it("12. resume-work recovers each missing/dead/fenced role exactly once from a validated bundle ref, never transfers old actor/session authority, and returns ACTION_REQUIRED or READY per the lifecycle result", async () => {
    const mod = loadEntrypointWithCapability();
    const staleRoles = { "arch-testing": "DEAD", "context-provider": "FENCED", "doc-updater": "ABSENT" };
    const ports = createScriptedPorts({
      lifecycle: {
        status: vi.fn(async () => ({
          roles: {
            "arch-platform": "READY",
            "arch-integration": "READY",
            ...staleRoles,
          },
        })),
        recoverRole: vi.fn(async (call: any) => {
          expect(call).not.toHaveProperty("actor_instance_id");
          expect(call).not.toHaveProperty("session_id");
          expect(call).not.toHaveProperty("old_actor_instance_id");
          expect(call.bundle_ref).toEqual(expect.stringMatching(/^bundle:/));
          return { actions: [] };
        }),
      },
    });
    const context = mod.__TEST_ONLY__createTrustedHostContext(ports);

    const envelope = await mod.executeEntrypoint(
      "resume-work",
      { checkpoint_ref: "checkpoint:" + HEX64_C },
      context,
    );

    expect(ports.lifecycle.recoverRole).toHaveBeenCalledTimes(Object.keys(staleRoles).length);
    const recoveredRoles = ports.lifecycle.recoverRole.mock.calls.map((call: any[]) => call[0].role).sort();
    expect(recoveredRoles).toEqual(Object.keys(staleRoles).sort());
    expect(["ACTION_REQUIRED", "READY"]).toContain(envelope.status);
  });

  it("13. work exact intent {role,subject_ref,task} calls lifecycle.invokeRole once; source contains no TeamCreate, SendMessage, Agent(, codex-app-server or provider-branch literal", async () => {
    const mod = loadEntrypointWithCapability();
    const ports = createScriptedPorts();
    const context = mod.__TEST_ONLY__createTrustedHostContext(ports);

    await mod.executeEntrypoint(
      "work",
      { role: "arch-platform", subject_ref: "subject:" + HEX64_D, task: "Implement the P3 entrypoint contract." },
      context,
    );

    expect(ports.lifecycle.invokeRole).toHaveBeenCalledTimes(1);

    const source = fs.readFileSync(ENTRYPOINT_MODULE, "utf8");
    expect(source).not.toMatch(/TeamCreate/);
    expect(source).not.toMatch(/SendMessage/);
    expect(source).not.toMatch(/Agent\(/);
    expect(source).not.toMatch(/codex-app-server/);
    expect(source).not.toMatch(/provider\s*===\s*['"]codex['"]/);
    expect(source).not.toMatch(/provider\s*===\s*['"]claude['"]/);
  });

  it("14. work drives ACTION_REQUIRED through adapter.executeAction and resumes the same core operation until terminal; COMPLETED requires all six canonical consultation refs/digests and never treats action success/message text as evidence", async () => {
    const mod = loadEntrypointWithCapability();
    let invokeCall = 0;
    const ports = createScriptedPorts({
      lifecycle: {
        invokeRole: vi.fn(async () => {
          invokeCall += 1;
          if (invokeCall === 1) return { status: "ACTION_REQUIRED", actions: [{ ref: "action:" + HEX64_E }] };
          return {
            status: "COMPLETED",
            result_ref: "consultation/results/" + HEX64_A + ".json",
            result_digest: HEX64_B,
            accepted_result_ref: "consultation/accepted/" + HEX64_C + ".json",
            accepted_result_digest: HEX64_D,
            ack_ref: "consultation/acks/" + HEX64_E + ".json",
            ack_digest: HEX64_F,
            subject_ref: "subject:" + HEX64_D,
            actor_role: "arch-platform",
          };
        }),
      },
      adapter: {
        executeAction: vi.fn(async () => ({
          ok: true,
          message: "action reported success -- must never be treated as consultation evidence",
        })),
      },
    });
    const context = mod.__TEST_ONLY__createTrustedHostContext(ports);

    const envelope = await mod.executeEntrypoint(
      "work",
      { role: "arch-platform", subject_ref: "subject:" + HEX64_D, task: "Drive one action-required cycle to completion." },
      context,
    );

    expect(ports.adapter.executeAction).toHaveBeenCalledTimes(1);
    expect(ports.lifecycle.invokeRole).toHaveBeenCalledTimes(2);
    expect(envelope.status).toBe("COMPLETED");
    expect(envelope.result).not.toBeNull();
    for (const field of ["result_ref", "result_digest", "accepted_result_ref", "accepted_result_digest", "ack_ref", "ack_digest"]) {
      expect(typeof envelope.result[field]).toBe("string");
      expect(envelope.result[field].length).toBeGreaterThan(0);
    }
    for (const digestField of ["result_digest", "accepted_result_digest", "ack_digest"]) {
      expect(envelope.result[digestField]).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("15. work with noncanonical role, empty task, unsafe subject_ref, extra key, or uncorrelated completion returns BLOCKED/FAILED before adapter execution and never emits COMPLETED", async () => {
    const mod = loadEntrypointWithCapability();
    const baseIntent = { role: "arch-platform", subject_ref: "subject:" + HEX64_D, task: "A valid task." };
    const variants = [
      { ...baseIntent, role: "not-a-canonical-role" },
      { ...baseIntent, task: "" },
      { ...baseIntent, subject_ref: "../../etc/passwd" },
      { ...baseIntent, extraKey: true },
    ];

    for (const intent of variants) {
      const ports = createScriptedPorts();
      const context = mod.__TEST_ONLY__createTrustedHostContext(ports);
      const envelope = await mod.executeEntrypoint("work", intent, context).catch((err: any) => ({ status: "FAILED", __threw: err }));
      expect(ports.adapter.executeAction).not.toHaveBeenCalled();
      if (!("__threw" in (envelope as any))) {
        expect(["BLOCKED", "FAILED"]).toContain((envelope as any).status);
      }
    }

    const uncorrelatedPorts = createScriptedPorts({
      lifecycle: {
        invokeRole: vi.fn(async () => ({
          status: "COMPLETED",
          result_ref: "consultation/results/" + HEX64_A + ".json",
          result_digest: "not-a-64-hex-digest",
          accepted_result_ref: "consultation/accepted/" + HEX64_C + ".json",
          accepted_result_digest: HEX64_D,
          ack_ref: "consultation/acks/" + HEX64_E + ".json",
          ack_digest: HEX64_F,
          subject_ref: baseIntent.subject_ref,
          actor_role: baseIntent.role,
        })),
      },
    });
    const uncorrelatedContext = mod.__TEST_ONLY__createTrustedHostContext(uncorrelatedPorts);
    const uncorrelatedEnvelope = await mod
      .executeEntrypoint("work", baseIntent, uncorrelatedContext)
      .catch((err: any) => ({ status: "FAILED", __threw: err }));
    if (!("__threw" in (uncorrelatedEnvelope as any))) {
      expect((uncorrelatedEnvelope as any).status).not.toBe("COMPLETED");
    }
  });

  it("16. ingest-content exact intent {request_ref,approval_ref} blocks missing/empty approval with zero consultation.ingest; an approved call preserves the exact pair, accepts only a correlated canonical result, records one audit, and a repeated exact pair deduplicates without a second write", async () => {
    const mod = loadEntrypointWithCapability();

    const blockedPorts = createScriptedPorts();
    const blockedContext = mod.__TEST_ONLY__createTrustedHostContext(blockedPorts);
    const blockedEnvelope = await mod.executeEntrypoint(
      "ingest-content",
      { request_ref: "request:" + HEX64_A, approval_ref: "" },
      blockedContext,
    );
    expect(blockedEnvelope.status).toBe("BLOCKED");
    expect(blockedPorts.consultation.ingest).not.toHaveBeenCalled();

    const requestRef = "request:" + HEX64_A;
    const approvalRef = "approval:" + HEX64_B;
    const approvedPorts = createScriptedPorts({
      consultation: {
        ingest: vi.fn(async (call: any) => {
          expect(call.request_ref).toBe(requestRef);
          expect(call.approval_ref).toBe(approvalRef);
          return {
            approval_digest: HEX64_B,
            approval_ref: approvalRef,
            audit_status: "accepted",
            disposition: "written",
            request_digest: HEX64_A,
            request_ref: requestRef,
            result_digest: HEX64_D,
            result_ref: "consultation/results/" + HEX64_C + ".json",
          };
        }),
      },
    });
    const approvedContext = mod.__TEST_ONLY__createTrustedHostContext(approvedPorts);
    const approvedEnvelope = await mod.executeEntrypoint(
      "ingest-content",
      { request_ref: requestRef, approval_ref: approvalRef },
      approvedContext,
    );
    expect(approvedPorts.consultation.ingest).toHaveBeenCalledTimes(1);
    expect(approvedPorts.audit.record).toHaveBeenCalledTimes(1);
    expect(["READY", "COMPLETED"]).toContain(approvedEnvelope.status);

    const repeated = await mod.executeEntrypoint(
      "ingest-content",
      { request_ref: requestRef, approval_ref: approvalRef },
      approvedContext,
    );
    expect(approvedPorts.consultation.ingest).toHaveBeenCalledTimes(1);
    expect(repeated.status).toBe(approvedEnvelope.status);
  });

  it("17. monitor-docs exact intent {scope} calls consultation.monitor only and returns observations/proposals; it never calls consultation.ingest, never converts a proposal to approval, and never writes docs", async () => {
    const mod = loadEntrypointWithCapability();
    const ports = createScriptedPorts({
      consultation: {
        monitor: vi.fn(async () => ({
          observations: [{ ref: "observation:" + HEX64_A }],
          proposals: [{ ref: "proposal:" + HEX64_B }],
        })),
      },
    });
    const context = mod.__TEST_ONLY__createTrustedHostContext(ports);
    const writeFileSpy = vi.spyOn(fs, "writeFileSync");

    const envelope = await mod.executeEntrypoint("monitor-docs", { scope: "docs/agents/**" }, context);

    expect(ports.consultation.monitor).toHaveBeenCalledTimes(1);
    expect(ports.consultation.ingest).not.toHaveBeenCalled();
    expect(writeFileSpy).not.toHaveBeenCalled();
    expect(envelope.result === null || Array.isArray((envelope.result as any)?.observations)).toBe(true);

    writeFileSpy.mockRestore();
  });

  it("18. all five canonical skills contain the exact CLI prefix and their own --entrypoint value; the work skill never dispatches TeamCreate/SendMessage/Agent( directly; a static module scan proves the entrypoints module imports only node builtins plus the three named siblings", () => {
    loadEntrypoint({ fresh: true });

    const skillEntrypoints: Record<string, string> = {
      "init-session": "init-session",
      "resume-work": "resume-work",
      work: "work",
      "ingest-content": "ingest-content",
      "monitor-docs": "monitor-docs",
    };
    for (const [skillDir, entrypointValue] of Object.entries(skillEntrypoints)) {
      const skillPath = path.join(ROOT, "skills", skillDir, "SKILL.md");
      const text = fs.readFileSync(skillPath, "utf8");
      expect(text).toContain("node scripts/lib/runtime-collaboration-entrypoints.cjs execute");
      expect(text).toContain(`--entrypoint ${entrypointValue}`);
      expect(text).toContain("literal absolute project path");
      expect(text).toContain("Never use `$(pwd)`, `$PWD`, `cd`");
      if (skillDir === "work") {
        expect(text).not.toMatch(/TeamCreate/);
        expect(text).not.toMatch(/SendMessage/);
        expect(text).not.toMatch(/Agent\(/);
        expect(text).toContain("subject:090b9779a46f94e328cb61bf5e78d5a64a15337a6e9279090837647a87f2ff7a");
        expect(text).toContain("do not search for or hand-write a bundle file");
      }
    }

    const source = fs.readFileSync(ENTRYPOINT_MODULE, "utf8");
    const importPattern = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
    const allowedRelative = new Set([
      "./runtime-role-lifecycle.cjs",
      "./runtime-consultation.cjs",
      "./runtime-host-claude.cjs",
    ]);
    const nodeBuiltins = new Set(["fs", "path", "crypto", "child_process", "module", "os", "util"]);
    let match: RegExpExecArray | null;
    let sawAnyImport = false;
    while ((match = importPattern.exec(source)) !== null) {
      sawAnyImport = true;
      const specifier = match[1];
      const isBuiltin = nodeBuiltins.has(specifier) || specifier.startsWith("node:");
      const isAllowedRelative = allowedRelative.has(specifier);
      expect(isBuiltin || isAllowedRelative).toBe(true);
      expect(specifier).not.toMatch(/@anthropic|@openai|openai|anthropic-ai|codex-sdk/i);
    }
    expect(sawAnyImport).toBe(true);
  });

  it("19. on-disk policy is genuine v2 and projects to a fresh exact v1 object", () => {
    const rll = createRequire(import.meta.url)(path.join(ROOT, "scripts/lib/runtime-role-lifecycle.cjs"));
    const policy = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/lib/runtime-collaboration-policy.json"), "utf8"));
    expect(policy.schema).toBe("runtime-collaboration-policy/v2");
    expect(policy.version).toBe(2);
    expect(rll.isValidPolicyV2(policy)).toBe(true);
    const projected = rll.projectPolicyV2ToV1(policy);
    expect(projected).not.toBe(policy);
    expect(projected.schema).toBe("runtime-collaboration-policy/v1");
    expect(projected.version).toBe(1);
    expect(rll.isValidPolicy(projected)).toBe(true);
  });

  it("20. a signed production admission runs the real CLI once and replay is unavailable", () => {
    const req = createRequire(import.meta.url);
    const mod = loadEntrypoint({ fresh: true });
    const host = req(path.join(ROOT, "scripts/lib/runtime-host-claude.cjs"));
    const intent = { scope: "all" };
    const plan = mod.planEntrypointStep("monitor-docs", intent, ROOT);
    const admission = host.mintProductionHostComposition({
      projectRoot: ROOT,
      event: { hook_event_name: "PreToolUse", tool_name: "Bash", model: "claude-sonnet-5" },
      entrypoint: "monitor-docs",
      argvDigest: plan.argv_digest,
      roleScope: plan.role_scope,
    });
    expect(admission.ok).toBe(true);
    const args = [ENTRYPOINT_MODULE, "execute", "--entrypoint", "monitor-docs", "--project-root", ROOT,
      "--intent", Buffer.from(JSON.stringify(intent)).toString("base64url"), "--host-composition", admission.compositionId];
    const first = spawnSync(process.execPath, args, { encoding: "utf8" });
    expect(first.status).toBe(0);
    expect(JSON.parse(first.stdout).status).toBe("COMPLETED");
    const replay = spawnSync(process.execPath, args, { encoding: "utf8" });
    expect(replay.status).toBe(6);
    expect(JSON.parse(replay.stdout).status).toBe("UNAVAILABLE");
  }, 60_000);

  it("21. caller-supplied or missing composition/grant cannot authorize the CLI", () => {
    const encoded = Buffer.from(JSON.stringify({ scope: "all" })).toString("base64url");
    const base = [ENTRYPOINT_MODULE, "execute", "--entrypoint", "monitor-docs", "--project-root", ROOT, "--intent", encoded];
    const missing = spawnSync(process.execPath, base, { encoding: "utf8" });
    expect(missing.status).toBe(6);
    const forged = spawnSync(process.execPath, base.concat(["--host-composition", "a".repeat(32)]), { encoding: "utf8" });
    expect(forged.status).toBe(6);
    const forgedGrant = spawnSync(process.execPath, base.concat(["--lifecycle-binding", "b".repeat(32)]), { encoding: "utf8" });
    expect(forgedGrant.status).toBe(6);
  });

  it("22. production-style deferred native action returns ACTION_REQUIRED without an in-process callback loop", async () => {
    const mod = loadEntrypointWithCapability();
    const ports = createScriptedPorts({
      lifecycle: { ensureRoles: vi.fn(async () => ({ actions: [{ action_id: "c".repeat(32), kind: "role-spawn", operation: "Agent" }] })) },
      adapter: { executeAction: vi.fn(async () => false) },
    });
    const envelope = await mod.executeEntrypoint("init-session", { mode: "start" }, mod.__TEST_ONLY__createTrustedHostContext(ports));
    expect(envelope.status).toBe("ACTION_REQUIRED");
    expect(envelope.actions).toHaveLength(1);
    expect(ports.adapter.executeAction).toHaveBeenCalledTimes(1);
    expect(ports.lifecycle.status).toHaveBeenCalledTimes(1);
  });

  it("23. completion accepts confined canonical paths only and enforces subject/actor correlation", async () => {
    const mod = loadEntrypointWithCapability();
    const intent = { role: "arch-platform", subject_ref: "subject:" + HEX64_A, task: "Correlate completion." };
    const completion = {
      status: "COMPLETED", result_ref: "consultation/results/result.json", result_digest: HEX64_A,
      accepted_result_ref: "consultation/accepted/result.json", accepted_result_digest: HEX64_B,
      ack_ref: "consultation/acks/result.json", ack_digest: HEX64_C,
      subject_ref: intent.subject_ref, actor_role: intent.role,
    };
    const okPorts = createScriptedPorts({ lifecycle: { invokeRole: vi.fn(async () => completion) } });
    const ok = await mod.executeEntrypoint("work", intent, mod.__TEST_ONLY__createTrustedHostContext(okPorts));
    expect(ok.status).toBe("COMPLETED");
    for (const badRef of ["/tmp/result.json", "../result.json", "consultation/../result.json"]) {
      const badPorts = createScriptedPorts({ lifecycle: { invokeRole: vi.fn(async () => ({ ...completion, result_ref: badRef })) } });
      const bad = await mod.executeEntrypoint("work", intent, mod.__TEST_ONLY__createTrustedHostContext(badPorts));
      expect(bad.status).toBe("BLOCKED");
    }
    const wrongActorPorts = createScriptedPorts({ lifecycle: { invokeRole: vi.fn(async () => ({ ...completion, actor_role: "arch-testing" })) } });
    const wrongActor = await mod.executeEntrypoint("work", intent, mod.__TEST_ONLY__createTrustedHostContext(wrongActorPorts));
    expect(wrongActor.status).toBe("BLOCKED");
  });

  it("24. all five entrypoints share the canonical deterministic step planner", () => {
    const mod = loadEntrypoint({ fresh: true });
    const cases: Array<[string, any, string | null]> = [
      ["init-session", { mode: "start" }, "ensure"],
      ["resume-work", { checkpoint_ref: "checkpoint:" + HEX64_A }, "ensure"],
      ["work", { role: "arch-platform", subject_ref: "subject:" + HEX64_A, task: "x" }, "consult-root"],
      ["ingest-content", { request_ref: "request:" + HEX64_A, approval_ref: "approval:" + HEX64_B }, null],
      ["monitor-docs", { scope: "all" }, null],
    ];
    for (const [entrypoint, intent, command] of cases) {
      const first = mod.planEntrypointStep(entrypoint, intent, ROOT);
      const second = mod.planEntrypointStep(entrypoint, intent, ROOT);
      expect(first).toEqual(second);
      expect(first.command).toBe(command);
      expect(Object.keys(first).sort()).toEqual(["command", "argv_digest", "role_scope"].sort());
      expect(first.argv_digest).toMatch(/^[0-9a-f]{64}$/);
      expect(Object.isFrozen(first)).toBe(true);
    }
  });
});
