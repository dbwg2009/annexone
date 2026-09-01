import { describe, expect, it } from "vitest";
import expressManifest from "./fixtures/express.package.json?raw";
import honoManifest from "./fixtures/hono.package.json?raw";
import type { Component } from "../src/model/component.js";
import { type NpmManifestScan, parsePackageJson } from "../src/ecosystems/npm/package-json.js";

function scan(manifest: unknown): NpmManifestScan {
  const result = parsePackageJson(typeof manifest === "string" ? manifest : JSON.stringify(manifest));
  if (!result.ok) throw new Error(`expected the manifest to parse: ${result.error.detail}`);
  return result.value;
}

function names(value: NpmManifestScan): string[] {
  return value.components.map((component) => component.name);
}

function component(value: NpmManifestScan, name: string): Component {
  const found = value.components.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`expected a component named ${name}`);
  return found;
}

describe("parsePackageJson: input that is not a manifest", () => {
  it.each([
    ["not JSON at all", "not json"],
    ["truncated JSON", '{"dependencies": {'],
    ["an empty string", ""],
    ["GitHub's plain-text 404 body", "404: Not Found"],
    ["a top-level array", "[]"],
    ["a top-level string", '"hono"'],
    ["a top-level number", "12"],
    ["a top-level null", "null"],
    ["a top-level boolean", "true"],
  ])("reports %s as unparseable rather than throwing", (_label, text) => {
    const result = parsePackageJson(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("manifest-unparseable");
    expect(result.error.detail).not.toBe("");
  });
});

describe("parsePackageJson: dependency fields", () => {
  it("treats a manifest with no dependency fields as empty, not as a failure", () => {
    const result = scan({ name: "thing", version: "1.0.0" });
    expect(result.components).toEqual([]);
    expect(result.notes).toEqual([]);
  });

  it("treats an empty dependencies object as empty", () => {
    expect(scan({ dependencies: {} }).components).toEqual([]);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
  ])("treats dependencies: %s as absent and emits no note", (_label, value) => {
    const result = scan({ dependencies: value });
    expect(result.components).toEqual([]);
    expect(result.notes).toEqual([]);
  });

  it.each([
    ["an array", []],
    ["a string", "hono"],
    ["a number", 3],
  ])("records dependencies: %s as an unreadable field and keeps going", (_label, value) => {
    const result = scan({ dependencies: value, optionalDependencies: { hono: "^4.0.0" } });
    expect(result.notes).toContainEqual({ kind: "unreadable-dependency-field", field: "dependencies" });
    expect(names(result)).toEqual(["hono"]);
  });

  it("skips entries whose specifier is not a string, and names them", () => {
    const result = scan({ dependencies: { good: "^1.0.0", nested: { version: "2" }, nullish: null, numeric: 3 } });
    expect(names(result)).toEqual(["good"]);
    expect(result.notes).toContainEqual({ kind: "skipped-entries", names: ["nested", "nullish", "numeric"] });
  });

  it("ignores an empty dependency name", () => {
    expect(names(scan({ dependencies: { "": "^1.0.0", hono: "^4.0.0" } }))).toEqual(["hono"]);
  });
});

describe("parsePackageJson: scope", () => {
  it("includes dependencies and optionalDependencies, and excludes the rest", () => {
    const result = scan({
      dependencies: { required: "^1.0.0" },
      optionalDependencies: { optional: "^2.0.0" },
      devDependencies: { dev: "^3.0.0", alsoDev: "^3.1.0" },
      peerDependencies: { peer: "^4.0.0" },
      bundledDependencies: ["required"],
    });
    expect(names(result)).toEqual(["optional", "required"]);
    expect(component(result, "required").scope).toBe("required");
    expect(component(result, "optional").scope).toBe("optional");
    expect(result.excludedDevDependencies).toBe(2);
    expect(result.excludedPeerDependencies).toBe(1);
  });

  it("lets optionalDependencies override a same-named entry in dependencies", () => {
    // npm: "Entries in optionalDependencies will override entries of the same
    // name in dependencies."
    const result = scan({ dependencies: { hono: "^3.0.0" }, optionalDependencies: { hono: "^4.0.0" } });
    expect(result.components).toHaveLength(1);
    expect(component(result, "hono").scope).toBe("optional");
    expect(component(result, "hono").declaredRange).toBe("^4.0.0");
  });
});

describe("parsePackageJson: version specifiers", () => {
  it.each([
    ["1.2.3", "1.2.3"],
    ["=1.2.3", "1.2.3"],
    ["v1.2.3", "1.2.3"],
    ["1.2.3-beta.1", "1.2.3-beta.1"],
  ])("resolves the exact version %s", (spec, expected) => {
    const result = component(scan({ dependencies: { pkg: spec } }), "pkg");
    expect(result.resolvedVersion).toBe(expected);
    expect(result.source).toBe("registry");
    expect(result.purl).toBe(`pkg:npm/pkg@${expected}`);
  });

  it("resolves a build-metadata version, percent-encoding the plus in the package URL", () => {
    // ECMA-427 clause 5.2 permits only alphanumerics, ".-_~", "%" and the
    // separator characters inside a PURL. "+" is not among them, so it is
    // encoded even though it is legal semver.
    const result = component(scan({ dependencies: { pkg: "1.2.3+build.5" } }), "pkg");
    expect(result.resolvedVersion).toBe("1.2.3+build.5");
    expect(result.purl).toBe("pkg:npm/pkg@1.2.3%2Bbuild.5");
  });

  it.each(["^1.2.3", "~1.2.3", "1.2", "1.x", "*", "", ">=1.0.0 <2.0.0", "1.0.0 || 2.0.0", "latest", "next"])(
    "leaves %s unresolved, because a range is not a version",
    (spec) => {
      const result = component(scan({ dependencies: { pkg: spec } }), "pkg");
      expect(result.resolvedVersion).toBeNull();
      expect(result.source).toBe("registry");
      expect(result.purl).toBe("pkg:npm/pkg");
    },
  );

  it("keeps the declared range verbatim, including surrounding whitespace", () => {
    expect(component(scan({ dependencies: { pkg: "  ^1.2.3  " } }), "pkg").declaredRange).toBe("  ^1.2.3  ");
  });

  it("resolves an exact version even when the manifest pads it", () => {
    expect(component(scan({ dependencies: { pkg: " 1.2.3 " } }), "pkg").resolvedVersion).toBe("1.2.3");
  });
});

describe("parsePackageJson: non-registry specifiers", () => {
  it.each([
    "file:../local",
    "link:../local",
    "workspace:*",
    "workspace:^1.0.0",
    "portal:../local",
    "git://github.com/u/r.git",
    "git+https://github.com/u/r.git",
    "git+ssh://git@github.com/u/r.git",
    "ssh://git@github.com/u/r.git",
    "https://example.com/pkg.tgz",
    "http://example.com/pkg.tgz",
    "github:user/repo",
    "gitlab:user/repo",
    "bitbucket:user/repo",
    "gist:1234",
    "user/repo",
  ])("gives %s no package URL, because it has no registry coordinates", (spec) => {
    const result = component(scan({ dependencies: { pkg: spec } }), "pkg");
    expect(result.source).toBe("other");
    expect(result.purl).toBeNull();
    expect(result.resolvedVersion).toBeNull();
    expect(result.declaredRange).toBe(spec);
  });

  it("marks an npm alias as an alias and gives it no package URL", () => {
    // What ships is "lodash", not the manifest key. Rather than assert either
    // name, the specifier is carried through verbatim and says so itself.
    const result = component(scan({ dependencies: { "lodash-es": "npm:lodash@^4.17.21" } }), "lodash-es");
    expect(result.source).toBe("alias");
    expect(result.purl).toBeNull();
    expect(result.declaredRange).toBe("npm:lodash@^4.17.21");
  });
});

describe("parsePackageJson: package URLs", () => {
  it("percent-encodes the scope of a scoped name", () => {
    // Confirmed against the purl specification's npm type definition, whose own
    // example is pkg:npm/%40angular/animation@12.3.1.
    expect(component(scan({ dependencies: { "@hono/node-server": "^1.0.0" } }), "@hono/node-server").purl).toBe(
      "pkg:npm/%40hono/node-server",
    );
  });

  it("percent-encodes the scope of a scoped name pinned to a version", () => {
    expect(component(scan({ dependencies: { "@hono/node-server": "1.13.7" } }), "@hono/node-server").purl).toBe(
      "pkg:npm/%40hono/node-server@1.13.7",
    );
  });

  it("preserves case, which npm package URLs are sensitive to", () => {
    expect(component(scan({ dependencies: { JSONStream: "1.3.5" } }), "JSONStream").purl).toBe("pkg:npm/JSONStream@1.3.5");
  });

  it.each([
    ["contains an exclamation mark", "bad!name"],
    ["contains characters npm forbids", "pkg!'()*"],
    ["contains a tilde", "pkg~name"],
    ["contains a space", "pkg name"],
    ["has more than one slash", "@scope/a/b"],
    ["starts with a period", ".hidden"],
    ["starts with an underscore", "_private"],
    ["is longer than npm allows", "a".repeat(215)],
    ["has an empty scope", "@/name"],
  ])("gives no package URL to a name that %s", (_label, name) => {
    // No such package can exist in the registry, so a package URL naming one
    // would be an identifier that resolves to nothing.
    expect(component(scan({ dependencies: { [name]: "1.0.0" } }), name).purl).toBeNull();
  });

  it.each(["qs", "JSONStream", "lodash.merge", "@hono/node-server", "a".repeat(214)])(
    "gives a package URL to the valid name %s",
    (name) => {
      expect(component(scan({ dependencies: { [name]: "1.0.0" } }), name).purl).not.toBeNull();
    },
  );

  it("still lists a component whose name npm would reject, without a package URL", () => {
    // The manifest said it, so the readout says it. Only the identifier claim
    // is withheld.
    const result = component(scan({ dependencies: { "bad!name": "^1.0.0" } }), "bad!name");
    expect(result.name).toBe("bad!name");
    expect(result.declaredRange).toBe("^1.0.0");
    expect(result.purl).toBeNull();
  });

});

describe("parsePackageJson: workspaces", () => {
  it("notes the array form and still reads the root manifest", () => {
    const result = scan({ workspaces: ["packages/*", "apps/*"], dependencies: { hono: "^4.0.0" } });
    expect(result.notes).toContainEqual({ kind: "declares-workspaces", patterns: 2 });
    expect(names(result)).toEqual(["hono"]);
  });

  it("notes the object form", () => {
    const result = scan({ workspaces: { packages: ["packages/*"] } });
    expect(result.notes).toContainEqual({ kind: "declares-workspaces", patterns: 1 });
  });

  it("emits no note where workspaces is absent or empty", () => {
    expect(scan({ workspaces: [] }).notes).toEqual([]);
    expect(scan({}).notes).toEqual([]);
  });
});

describe("parsePackageJson: ordering", () => {
  it("sorts by name by code point, independent of manifest order and locale", () => {
    const result = scan({ dependencies: { zod: "1.0.0", B: "1.0.0", a: "1.0.0", "@scope/x": "1.0.0", Z: "1.0.0" } });
    expect(names(result)).toEqual(["@scope/x", "B", "Z", "a", "zod"]);
  });
});

describe("parsePackageJson: the published manifests the checker is aimed at", () => {
  it("reads expressjs/express", () => {
    const result = scan(expressManifest);
    expect(result.declaredName).toBe("express");
    expect(result.components).toHaveLength(28);
    expect(result.components.every((c) => c.scope === "required")).toBe(true);
    expect(component(result, "qs").declaredRange).toBe("^6.15.2");
    expect(component(result, "qs").resolvedVersion).toBeNull();
    expect(component(result, "qs").purl).toBe("pkg:npm/qs");
    expect(result.notes).toEqual([]);
  });

  it("reads honojs/hono as having no runtime dependencies at all", () => {
    // hono declares no dependencies and no optionalDependencies. An empty
    // component list is the correct answer for it, not a failure to parse.
    const result = scan(honoManifest);
    expect(result.declaredName).toBe("hono");
    expect(result.components).toEqual([]);
    expect(result.excludedDevDependencies).toBeGreaterThan(0);
    expect(result.notes).toEqual([]);
  });
});
