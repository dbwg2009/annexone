import { describe, expect, it } from "vitest";
import { encodePurlComponent, isNpmPackageName, npmPurl } from "../src/ecosystems/npm/purl.js";

/**
 * The encoder is tested directly rather than through npmPurl. npm package names
 * cannot contain the characters at issue, so no valid input reaches this path
 * from a manifest -- which is exactly why the rule needs its own test rather
 * than one that depends on an invalid name slipping through the validator.
 */
describe("encodePurlComponent", () => {
  it.each([
    ["!", "%21"],
    ["'", "%27"],
    ["(", "%28"],
    [")", "%29"],
    ["*", "%2A"],
  ])("encodes %s, which encodeURIComponent leaves alone", (character, encoded) => {
    // ECMA-427 clause 5.2 permits only the alphanumerics, ".-_~", "%" and the
    // separator characters inside a PURL component.
    expect(encodeURIComponent(character)).toBe(character);
    expect(encodePurlComponent(character)).toBe(encoded);
  });

  it.each(["+", "@", "/", " ", "^", "|"])("encodes %s", (character) => {
    expect(encodePurlComponent(character)).toMatch(/^%[0-9A-F]{2}$/);
  });

  it.each([".", "-", "_", "~", "a", "Z", "9"])("leaves the permitted character %s alone", (character) => {
    expect(encodePurlComponent(character)).toBe(character);
  });

  it("encodes non-ASCII as UTF-8 octets", () => {
    expect(encodePurlComponent("é")).toBe("%C3%A9");
  });
});

describe("isNpmPackageName", () => {
  it.each(["qs", "JSONStream", "lodash.merge", "a-b_c.d", "@hono/node-server", "@a/b", "a".repeat(214)])(
    "accepts %s",
    (name) => {
      expect(isNpmPackageName(name)).toBe(true);
    },
  );

  it.each([
    "",
    "bad!name",
    "pkg~name",
    "pkg name",
    "pkg'name",
    "pkg(name)",
    "pkg*name",
    ".hidden",
    "_private",
    "@scope/a/b",
    "@/name",
    "@scope/",
    "a/b",
    "a".repeat(215),
  ])("rejects %s", (name) => {
    expect(isNpmPackageName(name)).toBe(false);
  });
});

describe("npmPurl", () => {
  it("builds a purl for an unscoped name", () => {
    expect(npmPurl("qs", null)).toBe("pkg:npm/qs");
    expect(npmPurl("qs", "6.15.2")).toBe("pkg:npm/qs@6.15.2");
  });

  it("percent-encodes the scope, per the purl npm type definition", () => {
    expect(npmPurl("@hono/node-server", "1.13.7")).toBe("pkg:npm/%40hono/node-server@1.13.7");
  });

  it("encodes build metadata in a version", () => {
    expect(npmPurl("pkg", "1.2.3+build.5")).toBe("pkg:npm/pkg@1.2.3%2Bbuild.5");
  });

  it("returns null rather than a purl that resolves to nothing", () => {
    expect(npmPurl("bad!name", "1.0.0")).toBeNull();
  });
});
