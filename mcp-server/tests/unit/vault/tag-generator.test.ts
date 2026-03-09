import { describe, it, expect } from "vitest";
import { generateTags } from "../../../src/vault/tag-generator.js";

describe("vault tag-generator", () => {
  it("architecture tag added for architecture sourceType", () => {
    const tags = generateTags({
      sourceType: "architecture",
    });

    expect(tags).toContain("architecture");
  });

  it("ecosystem tag added for L1 layer", () => {
    const tags = generateTags({
      sourceType: "docs",
      layer: "L1",
    });

    expect(tags).toContain("ecosystem");
    expect(tags).toContain("l1");
  });

  it("app tag added for L2 layer", () => {
    const tags = generateTags({
      sourceType: "docs",
      layer: "L2",
    });

    expect(tags).toContain("app");
    expect(tags).toContain("l2");
  });

  it("sub-project tag added when subProject present", () => {
    const tags = generateTags({
      sourceType: "docs",
      layer: "L2",
      project: "MyApp",
      subProject: "SessionRecorder-VST3",
    });

    expect(tags).toContain("sessionrecorder-vst3");
  });

  it("existing scope/targets/layer/project tags preserved", () => {
    const tags = generateTags({
      scope: ["viewmodel", "compose"],
      targets: ["android", "ios"],
      layer: "L0",
      sourceType: "pattern",
      project: "MyApp",
    });

    expect(tags).toContain("viewmodel");
    expect(tags).toContain("compose");
    expect(tags).toContain("android");
    expect(tags).toContain("ios");
    expect(tags).toContain("l0");
    expect(tags).toContain("pattern");
    expect(tags).toContain("myapp");
  });

  it("tags are lowercase, deduplicated, and sorted", () => {
    const tags = generateTags({
      scope: ["Compose", "compose"],
      targets: ["Android"],
      layer: "L0",
      sourceType: "pattern",
    });

    // All lowercase
    for (const tag of tags) {
      expect(tag).toBe(tag.toLowerCase());
    }

    // No duplicates
    const uniqueTags = [...new Set(tags)];
    expect(tags).toHaveLength(uniqueTags.length);

    // Sorted
    const sorted = [...tags].sort();
    expect(tags).toEqual(sorted);
  });

  it("no ecosystem/app tag for L0 layer", () => {
    const tags = generateTags({
      sourceType: "pattern",
      layer: "L0",
    });

    expect(tags).not.toContain("ecosystem");
    expect(tags).not.toContain("app");
  });
});
