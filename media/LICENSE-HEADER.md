# Loom Engine - License at a Glance

This is a human-readable summary of the engine's license. It is **not** a
substitute for the legally binding terms in [LICENSE](./LICENSE).

## TL;DR

| | |
|---|---|
| **License** | Business Source License 1.1 (BUSL-1.1) |
| **Licensor** | Misha Mitiev (TheWorldTable.ai) |
| **Free-use revenue ceiling** | USD $1,000,000 per consecutive 12-month period |
| **Above ceiling** | Commercial license required - see [COMMERCIAL_LICENSE_TERMS.md](./COMMERCIAL_LICENSE_TERMS.md) |
| **Change Date** | 2030-05-08 |
| **License after Change Date** | Apache License 2.0 |
| **Contact for commercial licensing** | licensor@theworldtable.ai |

## What you can do for free under BUSL

- Read, audit, and learn from the source code
- Copy, modify, and create derivative works
- Redistribute the engine (with this license attached)
- Use it in non-production work (research, prototypes, teaching)
- **Use it in production**, including commercial production, as long as the
  product, game, or service that incorporates it earns less than **USD $1M
  in gross revenue per consecutive 12 months**
- Continue using any version freely once that version's Change Date passes
  (the version then becomes Apache 2.0)

## What requires a commercial license

- Production use where the incorporating product crosses USD $1M gross
  revenue per consecutive 12 months
- Standard commercial terms: 5% royalty on revenue above the threshold,
  paid quarterly
- Alternative arrangements available (lump-sum buyout, equity-for-license)
  - see [COMMERCIAL_LICENSE_TERMS.md](./COMMERCIAL_LICENSE_TERMS.md)

## What you may not do under either license

- Repackage and resell the engine itself as an engine product (the
  Additional Use Grant covers products that *incorporate* the engine, not
  competing engines)
- Use Licensor trademarks or logos beyond what the license requires
- Sub-license without separate written agreement

## The Change Date promise

On **2030-05-08**, every version of the engine released to that point
automatically converts to **Apache License 2.0** - permissive, no royalty,
no revenue threshold, no further obligations to the Licensor.

The Change Date applies per-version: a version published today gets four
years of BUSL terms, then becomes Apache 2.0 on 2030-05-08. Future versions
published after this LICENSE-HEADER.md is dated will have their own Change
Date as specified in the LICENSE file shipped with that version.

## Why BUSL and not MIT / Apache / GPL

BUSL preserves the freedom to read, learn from, and build on the engine
while protecting the project from being repackaged as a competing engine
during its commercially fragile early years. The four-year Change Date
guarantees the code becomes fully open-source eventually - this is a
time-delayed open-source license, not a closed one.

Other projects using BUSL or BUSL-derivatives include MariaDB, CockroachDB,
Sentry, HashiCorp Terraform (pre-MPL), and Couchbase.

## Why GitHub shows "NOASSERTION" instead of a license badge

BUSL-1.1 is not in the SPDX license identifier list, so GitHub's
license-detection library does not recognize it. This is cosmetic - the
license itself is in the [LICENSE](./LICENSE) file and is fully binding.
Other BUSL projects show the same NOASSERTION display.

## Questions

For licensing questions, commercial license requests, or any clarification
on what the engine can be used for, contact **licensor@theworldtable.ai**.

For technical questions about the engine itself, see the
[README](./README.md), the [CHANGELOG](./CHANGELOG.md), or the API docs at
[loom-engine.pages.dev](https://loom-engine.pages.dev/).
