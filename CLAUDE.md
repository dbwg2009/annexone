# Annex One

**annexone** — working name. Dev/staging on `annexone.dbwg2009.uk`; the real domain gets
bought around week 5, before anything is shown to strangers.

A compliance tool for small vendors who sell products with digital elements into the
EU and are caught by the **Cyber Resilience Act** — Regulation (EU) 2024/2847.

Two halves:

- **Free checker** (build this first). Paste a public GitHub repo URL, get a software
  bill of materials plus a plain-English readout of what would fail under the CRA. No
  account, shareable result link. This is the funnel; nothing else matters until it works.
- **Paid product** (later). Private repos, SBOM versioned per release, vulnerability
  alerts, a hosted public security page, and the evidence trail a market surveillance
  authority would ask for. £29/mo one product, £79/mo up to ten.

Dates that set the deadline: reporting obligations under Article 14 began **11 September
2026**; the regulation fully applies **11 December 2027**.

## Regulatory facts that drive design decisions

These are from the Official Journal text, not from summaries. Several contradict what
most articles online say. Do not "improve" on them.

- **SBOM scope is top-level dependencies only.** Annex I Part II(1) requires a bill of
  materials "in a commonly used and machine-readable format covering at the very least
  the top-level dependencies". Parse direct dependencies. Do not resolve the transitive
  tree in v1 — it is not required, and it is where all the complexity lives.
- **No format is mandated.** Neither SPDX nor CycloneDX appears anywhere in the
  regulation. Article 13(24) reserves the right to specify one later by implementing
  act. Emit **both** CycloneDX 1.6 and SPDX 2.3; do not couple the internal model to
  either.
- **Publishing the SBOM is optional.** Annex II point 9 is conditional — "If the
  manufacturer decides to make available the software bill of materials to the user".
  So the public security page must **not** show the SBOM by default. Default off,
  explicit opt-in switch. Publishing a component inventory by default is a gift to
  attackers and is not something the law asks for.
- **A contact form alone is not a compliant point of contact.** Article 13(17): it
  "shall allow users to choose their preferred means of communication and shall not
  limit such means to automated tools." Any generated policy must include a
  human-reachable address.
- **Advisories are mandatory once a fix ships**, and must contain four things
  (Annex I Part II(4)): description, affected-version identification, impact and
  severity, and remediation guidance. The advisory editor should refuse to publish
  one missing any of them.
- **Two clocks, don't conflate them.** Support period: minimum 5 years (Art 13(8)).
  Availability of each issued update: minimum 10 years or the rest of the support
  period, whichever is longer (Art 13(9)).
- **"Actively exploited" is a defined term** — Art 3(42), requires reliable evidence a
  malicious actor has exploited it in the wild. A published CVE in a dependency is not
  automatically this. Never tell a user they have a reporting obligation just because a
  CVE matched.
- **Nothing can file on the manufacturer's behalf.** ENISA's single reporting platform
  has no API and will not have one at this stage. The product prepares, times and
  records. It never claims to submit.

## Hard rules

- Never state or imply that using this product makes anyone compliant. It produces
  evidence and reminders. A human decides and a human files.
- No legal advice. Where the regulation is ambiguous, quote it and say it is ambiguous.
- Every regulatory claim in user-facing copy carries its citation (e.g. "Annex I Part
  II(1)"). If a claim can't be cited, it doesn't ship.

## Stack

- TypeScript, Cloudflare Workers, Hono. D1 for storage, R2 later if artefacts need it.
- Server-rendered HTML. No SPA framework. Minimal client JS.
- OSV.dev for vulnerability data — free, no key, `POST https://api.osv.dev/v1/querybatch`.
- Stripe for billing, added last. Not before there is something worth charging for.
- Everything must stay inside free tiers until there is revenue.

## Voice

The readout is **neutral and factual**. State what is true, cite the article, stop.

- "3 of 9 checks pass." Not "Your product is at risk!"
- No score out of 100, no letter grade, no invented risk number, no countdown timer.
- No fines, no enforcement threats, no urgency language. The date does that work by
  itself and the audience is technical enough to resent being pushed.
- Adjectives are a smell. If a sentence would survive in a standards document, it passes.

The credibility *is* the product. Every competitor in adjacent compliance markets sounds
like a scare campaign; sounding like a reference instead is the differentiator, and it is
free.

## Conventions

- Small, pure functions for parsing; one module per ecosystem manifest.
- No dependency added without a reason written in the commit message. It would be
  embarrassing to fail our own checker.
- Tests on the parsers and the SBOM emitters. Those are the parts that must not be wrong.
