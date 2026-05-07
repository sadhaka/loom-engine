# SECURITY AUDIT - @sadhaka/loom-engine 0.10.0

Phase 12.2 - npm package supply-chain + consumer-attack-surface audit.
Generated: 2026-05-08. Auditor: claude-opus-4-7 on
`claude/phase-12-2-npm-audit`.

Scope: the npm artifact published as
[`@sadhaka/loom-engine@0.10.0`](https://www.npmjs.com/package/@sadhaka/loom-engine)
on 2026-05-07T19:22:08Z, the GitHub source at
[sadhaka/loom-engine](https://github.com/sadhaka/loom-engine) commit
`b2b354d`, and the two CI workflows under `.github/workflows/`.

Deliverable: this report, branch
`claude/phase-12-2-npm-audit` on the engine repo. No source changes.

## 1. Summary

**Verdict: P0/P1/P2 clean. No npm-unpublish candidate.** The published
artifact is reproducible from public source, contains no secrets or
internal hostnames, has zero runtime dependencies, runs no install-time
scripts on consumers, and exposes no remote-code-execution vector
through its parser surface.

Eleven findings - one Low drift bug worth fixing in 0.10.1, six
Low-priority hardening / hygiene items, and four informational notes.

| ID    | Severity | Area                            | Closes in |
|-------|----------|---------------------------------|-----------|
| L-01  | Low      | Programmatic version drift      | 0.10.1    |
| L-02  | Low      | SSE/snapshot credentials default| 0.10.1 docs |
| L-03  | Low      | Snapshot envelope trust         | 0.11.0    |
| L-04  | Low      | `exports` blocks `package.json` | 0.10.1    |
| L-05  | Low      | Missing `--provenance` on publish| 0.10.1 CI |
| L-06  | Low      | Long-lived `NPM_TOKEN`          | trusted publishing migration |
| L-07  | Low      | No `v0.10.0` git tag            | tag retroactively |
| I-01  | Info     | `private` fields in `.d.ts`     | 1.0 prep  |
| I-02  | Info     | `clean` script in published pkg | 0.10.1    |
| I-03  | Info     | TWT-specific catalog identifiers| pre-1.0 |
| I-04  | Info     | 0.5 → 0.10 phase backfill in CHANGELOG | accept |

Clean areas: tarball contents, hardcoded-URL surface, runtime deps,
prototype-pollution / RCE / dynamic-import patterns, consumer storage
access (no localStorage / cookies / sendBeacon), license compliance
(all permissive), source-to-dist reproducibility, install-time script
surface (none), known CVEs (`npm audit` 0/0/0/0/0).

## 2. Tarball inventory

`npm pack` against the local tree at `b2b354d` produces the same
shasum as the published 0.10.0 tarball:

```
filename: sadhaka-loom-engine-0.10.0.tgz
package size: 133.6 kB
unpacked size: 601.6 kB
shasum: d520c2fa1e788e9092d1aa1743ceca0bee86ae22
total files: 219
```

Every file lives under one of: `dist/` (216 files), `LICENSE`,
`README.md`, `package.json`. No `.git`, no `.env`, no `src/`, no
`tests/`, no `tools/`, no `assets/`, no `docs/`, no internal spec
markdown, no editor cruft. The `.npmignore` file (committed but not
shipped) provides defense in depth on top of `package.json` `files`.

`dist/` breakdown: 54 `.js` + 54 `.d.ts` + 108 `.map`. Source maps
reference `../src/<file>.ts` paths but contain no `sourcesContent`
field, so no TypeScript source content is embedded in the published
artifact.

## 3. Secrets / hostname / path scan

Scanned the published `dist/` for: API-key / secret / token / hmac /
password / bearer / sk_live / NPM_TOKEN / GITHUB_TOKEN /
theworldtable / twt-prod / loom-engine.pages.dev / connoisseur /
twt-2nd-pc / krabi / sunisa / mitse / `D:\` / `/Users/` / `/home/` /
`/mnt/`. **Zero matches.**

Scanned for any HTTP / HTTPS URL literal in `dist/*.js` or
`dist/*.d.ts`. **Zero matches.** The four files that perform network
I/O all read URLs from constructor arguments supplied by the consumer.

## 4. Findings

### L-01. `LOOM_ENGINE_VERSION` constant says `0.10.0-perf-9-1`. Severity: Low.

The exported version constant in `dist/index.js:6` and
`dist/index.d.ts:1` reads:

```js
export const LOOM_ENGINE_VERSION = '0.10.0-perf-9-1';
```

But `package.json.version` is `0.10.0`. The CHANGELOG entry for 0.10.0
explicitly calls out that "Version suffix `-perf-9-1` dropped -
productization releases ship clean semver", so the source-level
constant just got missed when the suffix was stripped from
`package.json`.

**Repro:**
```sh
mkdir tmp && cd tmp && npm init -y >/dev/null
npm install @sadhaka/loom-engine
node --input-type=module \
  -e "import {LOOM_ENGINE_VERSION} from '@sadhaka/loom-engine'; console.log(LOOM_ENGINE_VERSION);"
# prints: 0.10.0-perf-9-1
node -p "require('@sadhaka/loom-engine/package.json').version" # ERR_PACKAGE_PATH_NOT_EXPORTED (see L-04)
```

**Impact:** any tool or test that does
`assert(LOOM_ENGINE_VERSION === packageJson.version)` will fail.
Anyone parsing the constant for a build / telemetry tag will record a
non-semver string. No security consequence beyond drift.

**Fix sketch:** in `src/index.ts`, change to either
`'0.10.0'` (literal) or `'0.10.0-perf-9-1'.split('-')[0]`. Better
long-term: define the constant in `tools/gen-version.ts` that reads
from `package.json` at build time, so the two never drift again.

### L-02. SSEDirectorBridge / SnapshotRecoveryHelper default to credentialed fetches. Severity: Low.

`dist/director/sse-director-bridge.js:60-62` (default factory branch):

```js
const ESCtor = EventSource;
this.eventSourceFactory = (u) => new ESCtor(u, { withCredentials: true });
```

`dist/director/snapshot-recovery.js:73`:

```js
resp = await this.fetchImpl(url, { credentials: 'include' });
```

When the consumer doesn't supply `eventSourceFactory` /
`fetchImpl`, both helpers send cookies / HTTP auth with the request.
This is the right default for the "embedded in TheWorldTable.ai
same-origin app" use case, but a third-party consumer pointing the
bridge at a URL configured from user input could end up sending their
own site's credentials cross-origin. The browser still requires the
target server to opt in via `Access-Control-Allow-Credentials: true`
plus a specific `Access-Control-Allow-Origin`, so this is not exploitable
as a one-sided SSRF; it requires attacker control of the target
server's CORS policy.

**Repro:** consumer integrates the engine, accepts a `directorUrl`
string from user input, instantiates
`new SSEDirectorBridge({ baseUrl: userInput, characterId: '...' })`.
If `userInput` is `https://attacker.example/sse` and the attacker's
server returns the right CORS response, the user's cookies for
`attacker.example` flow with the request. (Same-origin or
allowlisted-origin behaviour is unchanged.)

**Impact:** misuse-only. Not a vulnerability in the engine. But the
default is invisible - the README quickstart never mentions
`withCredentials`, so consumers may not realise the bridge sends
credentials by default.

**Fix sketch:**
- README: under SSEDirectorBridge, add a one-paragraph note that the
  default factory uses `withCredentials: true` and document the
  `eventSourceFactory` override for credential-less use.
- Same for SnapshotRecoveryHelper - document that `fetchImpl` is the
  override seam if `credentials: 'include'` is wrong for the consumer.
- Optional: add a constructor option `credentials?: 'include' |
  'omit' | 'same-origin'` (defaults to current behaviour) so consumers
  don't have to write a custom factory just to flip one flag.

### L-03. `SnapshotRecoveryHelper.validateResponse` does not validate nested envelope shapes. Severity: Low.

`dist/director/snapshot-recovery.js:174-176`:

```js
// The snapshot.* envelopes are validated lazily on apply; full
// shape validation here would duplicate parseEnvelope. Trust
// the server for v1.
return r;
```

`applySnapshot` then dot-accesses `snapshot.snapshot.knot_context.data.knot`,
`snapshot.snapshot.ve_budget.data.tier`, and so on. A malformed
server response can:

- crash with `TypeError: Cannot read properties of undefined` (low
  - throws synchronously, app can catch and trigger reconnect)
- produce `NaN` budgets via `TIER_SCALARS[d.tier]` lookup with
  `d.tier === '__proto__'` (returns `Object.prototype`,
  `scalars.particle` is undefined, `Math.round(BASE * undefined)` is
  `NaN`)

**Repro:** mock a snapshot response with
`{"ok": true, "character_id": "x", "tail_id": 1, "snapshot": {"ve_budget": {"data": {"tier": "__proto__", "encounter_budget_ve": 0}}}}`.
Pass to `SnapshotRecoveryHelper.applySnapshot(world, snapshot)` -
budget fields end up `NaN`.

**Impact:** server-controlled. The server is part of the trust
boundary, so this isn't a remote-attacker primitive. But it does mean
a buggy server change can corrupt client engine state instead of
producing a clean error. No prototype-pollution: the lookup uses
bracket access on a `const` literal whose only writable keys are
`green / amber / red`, so `__proto__` access reads but does not
write Object.prototype.

**Fix sketch:** in `validateResponse`, do `parseEnvelope`-equivalent
checks on the present nested envelopes (`knot_context`,
`ve_budget`, `scene`, `active_encounter`). Use the same
`KNOWN_EVENT_TYPES` allowlist to gate each. Reject the snapshot up
front so `applySnapshot` only ever sees validated input. Schedule
for 0.11.0 with the rest of the pre-1.0 hardening pass.

### L-04. `exports` field blocks `./package.json`. Severity: Low.

`package.json` exports only `.`:

```json
"exports": {
  ".": {
    "import": "./dist/index.js",
    "types": "./dist/index.d.ts"
  }
}
```

So consumers cannot do
`require('@sadhaka/loom-engine/package.json')` (a common pattern for
reading version metadata, support matrices, or the engine's own
declared license).

**Repro:**
```sh
node -p "require('@sadhaka/loom-engine/package.json').version"
# Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath
# './package.json' is not defined by "exports"
```

**Impact:** no security consequence. Limits downstream tooling.
Several common npm packages (telemetry libs, license auditors, build
plugins) read `<dep>/package.json` to introspect dependencies.

**Fix sketch:** add to `exports`:

```json
"exports": {
  ".": { ... },
  "./package.json": "./package.json"
}
```

### L-05. Publish workflow does not pass `--provenance`. Severity: Low.

`.github/workflows/npm-publish.yml` declares
`permissions: id-token: write` (the OIDC permission needed for npm
provenance attestation), but the publish step is:

```yaml
run: npm publish --access public
```

Without `--provenance`, the npm registry does not record a signed
attestation linking the published tarball to the GitHub workflow run
that produced it. Consumers cannot verify the artifact's build origin
via `npm view @sadhaka/loom-engine --json | jq .signatures` or the
provenance tab on npmjs.com.

**Repro:**
```sh
npm view @sadhaka/loom-engine --json | grep -i provenance
# (no provenance field)
```

**Impact:** loss of supply-chain verifiability. The engine is
reproducible from public source (verified in this audit, see Section
5), but provenance attestation makes that property mechanically
checkable instead of "trust me, I rebuilt it".

**Fix sketch:** change the publish step to
`npm publish --access public --provenance`. The OIDC permission is
already granted; only the flag is missing.

### L-06. `NPM_TOKEN` is a long-lived stored secret. Severity: Low.

`.github/workflows/npm-publish.yml` uses `secrets.NPM_TOKEN` as
`NODE_AUTH_TOKEN`. The token's scope, expiration, and bypass-2FA
setting cannot be observed from the public side; they live on
npmjs.com under the `sadhaka` account and must be verified there.

The 2024+ best practice is npm trusted publishing - OIDC-based
exchange between GitHub Actions and npm that issues a short-lived
publish token per workflow run. No long-lived secret to leak, rotate,
or revoke.

**Fix sketch:**
1. On npmjs.com → @sadhaka/loom-engine package settings → "Trusted
   publishers" → add GitHub Actions trusted publisher pointing at
   `sadhaka/loom-engine`, workflow file `.github/workflows/npm-publish.yml`,
   environment (none).
2. Drop `NODE_AUTH_TOKEN` env block from the workflow's publish step.
3. Add `--provenance` (this also closes L-05).
4. Delete the `NPM_TOKEN` repo secret once the trusted-publisher path
   is verified end-to-end.

### L-07. No `v0.10.0` git tag. Severity: Low.

`git tag -l` on `sadhaka/loom-engine` returns empty. The npm-publish
workflow only triggers on `v*` tags pushed to `main`, so the published
0.10.0 was the manual `npm publish` path documented in
`CHANGELOG.md` ("Manual final-gate to publish"), not the audited CI
path.

**Impact:** the CI publish path has not been exercised on production.
Future releases that go through CI will be the first to take that
flow live. There is also no immutable git pointer for "the commit
that produced the artifact published as 0.10.0".

**Fix sketch:** retroactively tag `b2b354d` as `v0.10.0` and push
the tag (this will trigger the publish workflow; use the
`workflow_dispatch` `dry_run: true` path first, OR delete the tag and
re-create it with a `--no-publish` flag added to the workflow once
it's been exercised).

For 0.10.1 onward, follow the documented release flow: bump version in
package.json + CHANGELOG, commit, tag `vX.Y.Z`, push the tag.

### I-01. TypeScript `private` fields surface in `.d.ts`. Severity: Informational.

`AudioBus`, `EntityAllocator`, `Canvas2DDevice`, `InputManager`,
`HealthPool`, `AnimationStatePool`, and several systems declare
`private` fields. TS emits these into `.d.ts` because `private` is a
compile-time check, not a runtime privacy boundary. Example
(`dist/audio/audio-bus.d.ts:10-15`):

```ts
private master;
private buses;
private masterGain;
private currentBudget;
private suspended;
private constructor();
```

**Impact:** no exploit. Limits the engine's freedom to refactor
internal state without bumping a major version (since consumers can
type-cheat via `(bus as any).buses` and end up depending on names
that are documented to be private).

**Fix sketch:** when stabilising for 1.0, migrate `private` keywords
to ECMAScript `#privateField` syntax. The `#` form does not surface
in `.d.ts` at all and is enforced at runtime.

### I-02. `clean` script remains in published `package.json`. Severity: Informational.

The published `package.json` includes:

```json
"clean": "rm -rf dist demo/*.js demo/*.js.map"
```

A consumer who runs `npm explore @sadhaka/loom-engine -- npm run clean`
or `cd node_modules/@sadhaka/loom-engine && npm run clean` would
delete the engine's installed `dist/`. Not a meaningful attack vector
- it requires the consumer to deliberately run `npm run clean` inside
the package - but the script does not need to ship.

**Fix sketch:** strip development scripts from the published
`package.json` via a build step, OR move the `clean` / `watch` /
`docs` / `build:demo` / `build:all` scripts into a `package.json`
override during `prepublishOnly`. Net cost: small. Net benefit:
slightly tidier shipped manifest.

### I-03. TWT-specific catalog identifiers ship as data tables. Severity: Informational.

`dist/zone/zone-catalog.js` exports `ZONE_CATALOG` with TWT zone IDs
(`lastlight_plaza`, `iron_reach`, `saltsprig`, `the_archive`,
`hammerwash`, etc). `dist/combat/mob-catalog.js` exports
`MOB_CATALOG` with TWT mob IDs (`skel_warrior`, `skel_archer`,
`skel_caster`). README also identifies the engine as
"Built from scratch in TypeScript for TheWorldTable.ai".

**Impact:** none in security terms. Branding leak only - any
consumer of `@sadhaka/loom-engine` can derive the TWT zone graph and
mob roster by reading the data tables. This is the intended posture
for an open-sourced productized engine - the catalog is data, not a
secret.

**Fix sketch:** none required. Optional: in pre-1.0, split the TWT-
specific catalogs into a sibling package (`@sadhaka/loom-twt-content`)
so the engine itself ships generic primitives only. Out of scope for
0.10.x.

### I-04. 0.10.0 backfills 0.5.0 → 0.10.0 phases in one CHANGELOG entry. Severity: Informational.

Phases 6, 7, 8, 8.4, 9.1, 9.3, and 11A.2 all shipped between
`0.5.0-phase5` and the productization milestone. The 0.10.0 CHANGELOG
entry honestly documents the backfill and notes "the work shipped in
commits but did not get its own versioned entries". Acceptable for a
pre-1.0 solo-dev project; the phases are individually traceable in
git.

**Fix sketch:** none. Consider per-phase semver discipline for any
post-1.0 work.

## 5. Source-to-dist reproducibility

Cleaned local node_modules, did a fresh `git clone --branch main` of
`sadhaka/loom-engine` from GitHub at `b2b354d`, ran `npm ci` then
`npm run build`. Compared the resulting `dist/` against the
published tarball's `dist/` (extracted from
`sadhaka-loom-engine-0.10.0.tgz`):

```sh
diff -r fresh-clone/dist published-package/dist
# (no output - byte-identical, 216 files match)
```

`npm test` against the fresh clone: 208 / 208 pass on Node 24.14.0
(matches CHANGELOG claim).

Conclusion: the published artifact is reproducible from public source.
No build-time injection occurred between the GitHub commit and the
npm publish.

## 6. Runtime dependency claim

`package.json` declares no `dependencies`, `peerDependencies`, or
`optionalDependencies`. Confirmed via:

```
node -e "var p=require('./package.json'); console.log('deps:', Object.keys(p.dependencies||{}).length);"
# deps: 0

npm ls --omit=dev
# @sadhaka/loom-engine@0.10.0
# `-- (empty)
```

Engine consumers receive zero transitive code at runtime. The four
network-facing modules (`asset/sprite-sheet-loader.js`,
`director/sse-director-bridge.js`, `director/snapshot-recovery.js`,
and the type-only `director/director-bridge.js`) all use browser
built-ins (`fetch`, `EventSource`, `Image`, `URL`) - no polyfills, no
shims, no helper packages.

Lockfile is v3 with integrity hashes for all 55 packages in the dev
tree.

`npm audit --json` reports 0 vulnerabilities at every severity tier
(info / low / moderate / high / critical) across the 54-package dev
graph.

## 7. Install-time script surface

`npm pack` of the published version exposes only one script that runs
on the publisher's machine: `prepublishOnly`. There is no
`install`, `preinstall`, `postinstall`, `prepare`, `preuninstall`, or
`postuninstall` script.

```
$ node -e "var p=require('@sadhaka/loom-engine/package.json'); 
           console.log(Object.entries(p.scripts).filter(e => 
             /^(pre|post)?install$|^(pre|post)?uninstall$|^prepare$/.test(e[0])));"
[]
```

A consumer running `npm install @sadhaka/loom-engine` executes zero
JavaScript from this package during install.

## 8. Consumer attack surface (parser / loader / bridge)

`parseEnvelope` (`dist/director/event-envelope.js`):
- Strict shape check - `KNOWN_EVENT_TYPES` allowlist of 11 types.
- Returns the same object passed in (no merge, no spread, no
  property assignment). Cannot trigger prototype pollution because no
  property is ever assigned to the parsed object.
- `parseEnvelopeJson` wraps `JSON.parse`; native `JSON.parse` does
  not pollute prototypes (it sets `__proto__` as an own property on
  the result, not as a prototype reference).

`loadSpriteSheet` (`dist/asset/sprite-sheet-loader.js`):
- Bracket access on parsed manifest - safe. No `Object.assign` from
  parsed data into engine objects.
- `resolveImageUrl` uses `new URL(imagePath, manifestUrl)`. A
  manifest at `trusted.com/manifest.json` with
  `"image": "https://evil.com/x.png"` would fetch from `evil.com`.
  This is intrinsic to URL semantics - the manifest is content the
  consumer has chosen to trust by passing its URL. Image bytes are
  decoded via `Image` element from a Blob with forced
  `type: 'image/png'`, so SVG-with-script polyglots cannot execute
  even if the server returns SVG content.
- No pixel data is ever evaluated as code.

`SSEDirectorBridge` (`dist/director/sse-director-bridge.js`):
- Reorder buffer is bounded at 32 entries with a 500ms timeout - no
  unbounded memory growth from a malicious server.
- Default credentialed factory: see L-02.
- Fully consumer-overridable via `eventSourceFactory`.

`SnapshotRecoveryHelper` (`dist/director/snapshot-recovery.js`):
- See L-03 for the lazy-validation finding.
- Hardcoded `credentials: 'include'`: see L-02.

Engine-wide grep for risk patterns: zero matches for `eval(`,
`new Function`, dynamic `require()` / `import()`,
`window.X = `, `global.X = `,
`Object.assign(*.prototype)`, `__proto__`, `localStorage`,
`sessionStorage`, `document.cookie`, `navigator.sendBeacon`,
`XMLHttpRequest`, or `WebSocket` constructor calls.

## 9. CI workflows

### npm-publish.yml

- Trigger: `push` of a `v*` tag (none exist yet, see L-07) plus
  `workflow_dispatch` with optional `dry_run` input.
- Permissions: `contents: read`, `id-token: write`. Minimal.
- Concurrency group keyed on ref. Good.
- Steps: checkout v6, setup-node v6 with npm cache and registry URL,
  `npm ci`, `npm test`, `npm run build`, version-tag match check,
  publish (or `--dry-run`).
- Token plumbed via `NODE_AUTH_TOKEN` env on the publish step.
  Standard pattern; not echoed.
- Missing: `--provenance` flag (L-05) and trusted publishing (L-06).

### docs.yml

- Trigger: push to `main`, PRs to `main`, `workflow_dispatch`.
- Permissions: `contents: write` (required for peaceiris to push to
  gh-pages branch). Auto-issued `GITHUB_TOKEN` scoped to the repo,
  expires at job end.
- Action versions: `actions/checkout@v6`, `actions/setup-node@v6`,
  `peaceiris/actions-gh-pages@v4`. All current.
- Force-flag (`FORCE_JAVASCRIPT_ACTIONS_TO_NODE24`) on
  peaceiris is documented and bridges the Node 24 deprecation cliff
  until peaceiris ships a node24 release. Reasonable.

## 10. License compliance

Engine itself: MIT, Copyright Misha Mitiev 2026. `LICENSE` is the
canonical SPDX MIT text.

`license-checker --csv` across the dev tree (29 packages):

```
23 MIT
 2 Apache-2.0
 1 Python-2.0       (argparse)
 1 ISC              (functionally equivalent to MIT)
 1 BlueOak-1.0.0    (permissive, OSI-approved)
 1 BSD-2-Clause     (permissive)
```

Zero copyleft. Zero GPL contamination. Critically, all of these are
**dev-only** - consumers receive zero of them since the published
package has zero runtime dependencies.

## 11. README quickstart smoke test

Created a fresh project, ran `npm install @sadhaka/loom-engine`,
exercised the README's Quickstart import block (with `skipAudio: true`
because Node has no AudioContext, and a minimal canvas + window
mock):

```
LOOM_ENGINE_VERSION exported as: 0.10.0-perf-9-1   (see L-01)
Engine.create OK, world systems before add: 0
After adding 2 systems, total: 2
3-frame tick loop OK
All 159 exports importable; key symbols all present
SMOKE OK
```

The README example works end-to-end against the published artifact.
All 159 named exports listed in `index.d.ts` are present at runtime.

## 12. Recommendations summary

For 0.10.1 (one-pass cleanup):

1. **L-01:** make `LOOM_ENGINE_VERSION` agree with `package.json`.
2. **L-04:** add `./package.json` to `exports`.
3. **L-05:** add `--provenance` to the npm publish step.
4. **L-02:** README note on default `withCredentials` / `credentials:
   'include'`.
5. **I-02:** strip dev-only scripts from the published `package.json`.
6. **L-07:** retroactively tag `v0.10.0` (or accept the gap and
   start the tag flow at 0.10.1).

For 0.11.0 (hardening pass before 1.0):

7. **L-03:** validate snapshot envelopes up front.
8. **L-06:** migrate to npm trusted publishing; delete `NPM_TOKEN`.
9. **I-01:** convert `private` to `#private` for fields the consumer
   should not touch.

No P0 / P1 / P2 findings. **No npm-unpublish candidate.**
0.10.0 stays live.
