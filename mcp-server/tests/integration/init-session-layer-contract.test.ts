import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..", "..");
const skill = readFileSync(join(root, "skills", "init-session", "SKILL.md"), "utf8");

describe("init-session layer classification contract", () => {
  it("uses the explicit consumer layer without inventing a generic layer field", () => {
    expect(skill).not.toContain("Extract `layer`, `topology`, and `selection`");
    expect(skill).toContain("`l0-manifest.json.consumer_layer` is the L1/L2 architectural");
  });

  it("keeps registry markers as legacy compatibility rather than architectural identity", () => {
    expect(skill).toContain("publishing a skills registry is an independent capability");
    expect(skill).toMatch(/Legacy\s+manifests without that field may use the old registry marker/);
  });

  it("keeps certified runtime role distinct and fails visibly on disagreement", () => {
    expect(skill).toContain("runtime-consumer/v1");
    expect(skill).toContain("consumer_layer");
    expect(skill).toContain("flag disagreement");
  });
});
