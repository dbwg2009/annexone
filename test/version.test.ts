import { describe, expect, it } from "vitest";
import manifest from "../package.json?raw";
import { TOOL_NAME, TOOL_VERSION } from "../src/version.js";

describe("tool identity", () => {
  it("matches package.json, which both bills of materials record as their producer", () => {
    const parsed = JSON.parse(manifest) as { name: string; version: string };
    expect(TOOL_NAME).toBe(parsed.name);
    expect(TOOL_VERSION).toBe(parsed.version);
  });
});
