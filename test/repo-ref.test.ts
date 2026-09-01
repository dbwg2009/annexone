import { describe, expect, it } from "vitest";
import { formatRepoRef, parseRepoRef } from "../src/github/repo-ref.js";

/** Asserts the input parses, and returns the canonical "owner/repo" form. */
function parsed(input: string): string {
  const result = parseRepoRef(input);
  if (!result.ok) throw new Error(`expected ${JSON.stringify(input)} to parse`);
  return formatRepoRef(result.value);
}

function rejected(input: string): boolean {
  return !parseRepoRef(input).ok;
}

describe("parseRepoRef", () => {
  it.each([
    ["owner/name", "owner/name"],
    ["https://github.com/honojs/hono", "honojs/hono"],
    ["http://github.com/honojs/hono", "honojs/hono"],
    ["https://www.github.com/honojs/hono", "honojs/hono"],
    ["github.com/honojs/hono", "honojs/hono"],
    ["www.github.com/honojs/hono", "honojs/hono"],
    ["//github.com/honojs/hono", "honojs/hono"],
    ["https://github.com/honojs/hono/", "honojs/hono"],
    ["https://github.com/honojs/hono.git", "honojs/hono"],
    ["git@github.com:honojs/hono.git", "honojs/hono"],
    ["  https://github.com/honojs/hono  ", "honojs/hono"],
  ])("accepts %s", (input, expected) => {
    expect(parsed(input)).toBe(expected);
  });

  it.each([
    "https://github.com/honojs/hono/tree/main",
    "https://github.com/honojs/hono/blob/main/package.json",
    "https://github.com/honojs/hono/pull/12",
    "https://github.com/honojs/hono?tab=readme-ov-file",
    "https://github.com/honojs/hono#install",
  ])("discards everything after the repository name in %s", (input) => {
    // Only the default branch is scanned in this slice, so a branch or blob in
    // the URL is deliberately ignored rather than honoured.
    expect(parsed(input)).toBe("honojs/hono");
  });

  it("preserves the case as typed", () => {
    // GitHub resolves names case-insensitively, but echoing back what the user
    // pasted is more honest on the result page than silently lowercasing it.
    expect(parsed("Honojs/Hono")).toBe("Honojs/Hono");
  });

  it.each([
    ["empty", ""],
    ["whitespace only", "   "],
    ["a single segment", "hono"],
    ["a trailing slash with no name", "honojs/"],
    ["another host", "https://gitlab.com/honojs/hono"],
    ["a host-shaped lookalike", "https://github.com.evil.example/honojs/hono"],
    ["a non-URL with a colon", "npm:hono"],
    ["an owner starting with a hyphen", "-owner/name"],
    ["an owner ending with a hyphen", "owner-/name"],
    ["an owner over 39 characters", `${"a".repeat(40)}/name`],
    ["a repository name with a space", "owner/na me"],
    ["a repository name over 100 characters", `owner/${"a".repeat(101)}`],
    ["a dot as a repository name", "owner/."],
    ["a double dot as a repository name", "owner/.."],
    ["an over-long input", `owner/${"a".repeat(400)}`],
  ])("rejects %s", (_label, input) => {
    expect(rejected(input)).toBe(true);
  });

  it("reports the failure as a value, not a throw", () => {
    const result = parseRepoRef("gitlab.com/a/b");
    expect(result).toEqual({ ok: false, error: { kind: "invalid-input", input: "gitlab.com/a/b" } });
  });
});
