/**
 * Wave B-bis behavioral assertions: G1 FORBIDDEN doc strings + G2 hook registration.
 * Closes: G1-DOC, G2-HOOK, G3-DOC (topology-planner-write-gate).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');

describe('Wave B-bis: planner-write-gate G1 + G2 assertions', () => {

  it('tl-phase-execution.md contains FORBIDDEN planner-write entry', () => {
    const raw = fs.readFileSync(path.join(ROOT, 'docs/agents/tl-phase-execution.md'), 'utf-8');
    expect(raw).toContain('FORBIDDEN');
    expect(raw).toContain('.planning/wave-*/PLAN.md');
    expect(raw).toContain('feedback_planner_owns_plan_md');
  });

  it('tl-session-start.md contains FORBIDDEN planner-write entry', () => {
    const raw = fs.readFileSync(path.join(ROOT, 'docs/agents/tl-session-start.md'), 'utf-8');
    expect(raw).toContain('FORBIDDEN');
    expect(raw).toContain('.planning/wave-*/PLAN.md');
    expect(raw).toContain('feedback_planner_owns_plan_md');
  });

  it('plan-md-write-gate.js hook exists', () => {
    expect(fs.existsSync(path.join(ROOT, '.claude/hooks/plan-md-write-gate.js'))).toBe(true);
  });

  it('settings.json registers plan-md-write-gate.js in PreToolUse', () => {
    const raw = fs.readFileSync(path.join(ROOT, '.claude/settings.json'), 'utf-8');
    expect(raw).toContain('plan-md-write-gate.js');
  });

});
