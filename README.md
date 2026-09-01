# Annex One

A software bill of materials for a public GitHub repository, in both CycloneDX 1.6 and
SPDX 2.3.

Paste a public GitHub repository. This reads `package.json` from the default branch,
lists the direct dependencies, and emits both documents.

Annex I Part II(1) of Regulation (EU) 2024/2847 requires a bill of materials "in a
commonly used and machine-readable format covering at the very least the top-level
dependencies". This covers those and stops there.

It produces a document. It does not make anyone compliant, and it is not legal advice.

## Running it

```shell
npm install
npm run dev          # http://127.0.0.1:8787
npm test             # parsers and both serialisers
npm run check        # typecheck, tests, and a Workers build
```

Node 22, or 24 and newer -- the intersection of what wrangler and vitest declare, and
what `engines` in `package.json` records. `npm ci` installs from the committed lockfile
and is what CI should use.

### On WSL, run the Linux npm

If `npm install` fails inside a `\\wsl.localhost\...` path with `UNC paths are not
supported. Defaulting to Windows directory.`, Windows npm is being used against WSL
files. `cmd.exe` cannot take a UNC path as its working directory, so it silently falls
back to `C:\Windows` and any package with an install script -- esbuild, here, by way of
vitest -- fails to find its own files.

Nothing in this repository can work around that; the fix is to run the Linux toolchain.
Check which one you have:

```shell
which npm && npm config get cache
```

A path under `/mnt/c/` or a cache under `C:\Users\` means you are running the Windows
npm. Install Node inside the distribution (`nvm`, or your package manager), and if the
Windows entries still win, drop them from the WSL `PATH` by adding this to
`/etc/wsl.conf` and restarting with `wsl --shutdown`:

```ini
[interop]
appendWindowsPath = false
```

Then delete `node_modules` from inside WSL and install again. Keeping the repository on
the Linux filesystem rather than under `/mnt/c/` avoids the same class of problem, and
is considerably faster.

## What this version does

- npm only, `package.json` at the repository root, on the default branch.
- `dependencies` and `optionalDependencies`. Not `devDependencies`, not
  `peerDependencies`.
- No transitive tree and no lockfile. That is a scoping decision grounded in
  Annex I Part II(1), not an omission; see `CLAUDE.md`.
- Where the manifest gives a version range, no version is recorded in either document.
  The declared range is carried verbatim in a CycloneDX property and an SPDX package
  comment.
- Nothing is stored. No account, no database, no result identifiers.

Not yet built, and specified in `SPEC-checker.md`: the other ecosystems, OSV
vulnerability lookups, the Annex I Part II checks, and shareable result pages.

## Layout

| Path | Responsibility |
|---|---|
| `src/model/` | The internal component model. Imports nothing; knows no ecosystem and no format. |
| `src/ecosystems/npm/` | npm manifest semantics and package URL construction. No HTTP, no serialisation. |
| `src/github/` | Reference parsing and the manifest fetch. Knows HTTP and nothing else. |
| `src/sbom/` | One module per output format. Each imports the model only, and is pure. |
| `src/render/` | Server-rendered HTML. |
| `src/scan.ts` | The one module that knows about all of the above. |
| `test/schemas/` | The published JSON schemas the serialisers are validated against. |

Expected outcomes travel as `Result` values rather than exceptions: a repository that
does not exist, a rate-limited upstream and a manifest that is not JSON are ordinary
states of a public checker, and each gets its own page and status code.

## Regenerating the schemas

`npm run fetch-schemas` re-downloads the four vendored schemas and rewrites
`test/schemas/SOURCES.md` with their URLs and checksums. They are committed so the test
suite runs offline and an upstream change arrives as a reviewable diff.
