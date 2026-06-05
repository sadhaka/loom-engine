# Security Policy

Loom Engine ships cryptographic and integrity primitives - an HMAC-SHA-256
tamper-evident event chain, deterministic replay, and anti-cheat resolution -
that consuming projects build trust on. We take their security seriously.

## Reporting a vulnerability

Please report vulnerabilities **privately**. Do NOT open a public issue, PR, or
discussion for a security problem.

- **Preferred:** GitHub's [private vulnerability reporting](https://github.com/sadhaka/loom-engine/security/advisories/new)
  (the "Report a vulnerability" button on the repo's Security tab).
- **Or email:** mythcore@theworldtable.ai

Please include the affected version, a description of the issue, and a minimal
reproduction or proof-of-concept if you have one. We aim to acknowledge within
72 hours and to ship a fix or mitigation as quickly as the severity warrants.

## Supported versions

| Version | Supported |
|---|---|
| 2.3.x   | yes       |
| < 2.3   | no - please upgrade |

This applies across every surface: npm (`loom-engine`), PyPI
(`loom-engine-rpg`), and crates.io (`loom_math` / `loom_combat` / `loom_events`).

## Scope

**In scope:** the published packages and their deterministic / cryptographic
core - the event chain + canonical encoding (`loom_events`), the PRNG and
integer math (`loom_math`), the combat/ruleset primitives (`loom_combat`), and
cross-language byte-parity (a divergence that breaks replay or anti-cheat is a
security issue, not just a bug). The event chain has been through four
independent crypto-audit rounds; the v2.3.0 cross-language release went through
an external security + determinism audit.

**Out of scope:** the consuming TheWorldTable.ai application, the demo pages, and
any deployment-specific configuration.

## Disclosure

We practice coordinated disclosure: we will agree a timeline with you and credit
you (if you wish) once a fix is available.
