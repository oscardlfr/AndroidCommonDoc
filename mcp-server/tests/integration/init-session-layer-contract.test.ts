import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..", "..");
const skill = readFileSync(join(root, "skills", "init-session", "SKILL.md"), "utf8");

describe("init-session layer classification contract", () => {
  it("does not invent the removed top-level manifest layer field", () => {
    expect(skill).not.toContain("Extract `layer`, `topology`, and `selection`");
    expect(skill).toContain("manifest v2 has none");
  });

  it("documents marker-based L0, L1, and L2 classification", () => {
    expect(skill).toContain("registry + manifest = L1");
    expect(skill).toContain("manifest without registry = L2");
    expect(skill).toContain("no manifest = L0");
  });

  it("keeps certified runtime role distinct and fails visibly on disagreement", () => {
    expect(skill).toContain("runtime-consumer/v1");
    expect(skill).toContain("consumer_layer");
    expect(skill).toContain("flag any disagreement");
  });
});
