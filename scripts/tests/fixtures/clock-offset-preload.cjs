'use strict';

// Test-only injectable clock for child processes: ACD_TEST_CLOCK_OFFSET_MS shifts Date.now() and `new Date()` forward, so
// a test can let hours pass between two real hook or CLI invocations without waiting. Every TTL the production code
// checks (bindings, grants, leases, compositions) then ages for real. Required through NODE_OPTIONS.

const offset = Number(process.env.ACD_TEST_CLOCK_OFFSET_MS || 0);
if (Number.isFinite(offset) && offset !== 0) {
  const RealDate = Date;
  class ShiftedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...args);
    }
    static now() { return RealDate.now() + offset; }
  }
  global.Date = ShiftedDate;
}
