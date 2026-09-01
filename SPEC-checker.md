# Build spec — the Annex One checker

The only thing being built right now. If this doesn't get used, the paid product never
gets built, and that is a good outcome to reach cheaply.

**Goal:** a stranger pastes a public GitHub URL, and within a few seconds sees a readout
that makes them uneasy in a specific, accurate, actionable way.

## Flow

1. `GET /` — one input, one button. Explain in two sentences what it does and what the
   CRA is. No sign-up, no email gate.
2. `POST /check` — takes `repo` (a GitHub URL or `owner/name`). Validates, then queues
   or runs the scan.
3. `GET /r/:id` — the result page. Stable, shareable, indexable. This is the artefact
   people paste into their team chat, so it has to be good enough to survive that.

## What the scan does

### 1. Fetch manifests

Public repos only in v1. Use the GitHub contents API on the default branch. Look for,
in this order of usefulness:

| Ecosystem | Files |
|---|---|
| npm | `package.json` |
| Python | `pyproject.toml`, `requirements.txt` |
| Go | `go.mod` |
| Rust | `Cargo.toml` |
| Java | `pom.xml`, `build.gradle`, `build.gradle.kts` |
| PHP | `composer.json` |
| Ruby | `Gemfile` |
| .NET | `*.csproj` |

Search the repo root and one level down (monorepos). Stop at 20 manifests.

**Direct dependencies only.** Do not read lockfiles to resolve the transitive tree —
that is deliberate, see CLAUDE.md. Do read a lockfile only to pin a version where the
manifest gives a range.

### 2. Emit the SBOM

Build one internal component model, then serialise to both:

- CycloneDX 1.6 JSON
- SPDX 2.3 JSON

Both downloadable from the result page. Validate the output against the published
schemas in tests — an invalid SBOM is worse than none.

### 3. Check for known vulnerabilities

Batch the components to `POST https://api.osv.dev/v1/querybatch`. For each hit, pull the
severity and a summary. Cache by `(ecosystem, name, version)` in D1 for 24h — OSV is
free and we should not hammer it.

**Wording matters here.** A CVE match means "a known vulnerability exists in a component
you ship". It does **not** mean "you have a reporting obligation" — that requires an
actively exploited vulnerability under Art 3(42). Never blur those two.

### 4. Check the things everyone forgets

This is the differentiator, and it's cheap. Existing SBOM tools stop at step 3. The
Annex I Part II obligations that have nothing to do with dependencies are the ones small
vendors actually fail, and they are all detectable from a repo:

| Check | Looks for | Maps to |
|---|---|---|
| Vulnerability disclosure policy | `SECURITY.md`, `.github/SECURITY.md` | Annex I Part II(5) |
| Security contact | An email address inside that file; `.well-known/security.txt` on the project site if one is linked | Annex I Part II(6), Art 13(17) |
| Contact is not form-only | A reachable address, not just a link to a web form | Art 13(17) |
| Published advisories | GitHub Security Advisories on the repo; a `CHANGELOG` with security entries | Annex I Part II(4) |
| Support period stated | Any published end-of-support date in README/SECURITY.md | Art 13(19), Annex II(7) |
| Update mechanism | Signed releases, release artefacts present | Annex I Part II(7) |

Most repos will fail four or more of these. That is the moment the free tool earns the
paid one.

## The result page

- A headline verdict, honest and unsexy: *"3 of 9 checks pass."* No score out of 100,
  no letter grade, no invented risk number, no countdown to December 2027.
- Neutral register throughout — see the Voice section in CLAUDE.md. A failed check reads
  "No coordinated vulnerability disclosure policy found (Annex I Part II(5))", not
  "You're not compliant!" The citation carries the weight.
- Each check: pass/fail, one sentence on what it means, and **the citation**. The
  citations are the reason to trust it.
- The component list with vulnerability flags, sorted worst first.
- Download buttons for both SBOM formats.
- No email capture on this page. Ask nothing. Let it be useful.

## Explicitly not in v1

Private repos · accounts · billing · the hosted security page · advisory editor ·
risk-assessment module · transitive dependencies · container images · anything
that files anything anywhere.

## Done when

A stranger can paste a URL and get a result they'd forward to a colleague, and the
whole thing runs inside the Cloudflare free tier.
