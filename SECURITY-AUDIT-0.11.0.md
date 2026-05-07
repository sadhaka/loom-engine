# SECURITY AUDIT - @sadhaka/loom-engine 0.11.0

Phase 12.6 - git-history scan (now that the repo is public) plus
0.11.0 published-artifact re-audit against the 12.2 baseline.
Generated: 2026-05-08. Auditor: claude-opus-4-7 on
`claude/phase-12-6-history-and-0.11.0-audit`.

Scope: every reachable commit on `sadhaka/loom-engine` (43 commits
across 11 refs), the npm artifact published as
[`@sadhaka/loom-engine@0.11.0`](https://www.npmjs.com/package/@sadhaka/loom-engine)
on 2026-05-07T23:19:55Z, the GitHub source at commit
[`b9f93af`](https://github.com/sadhaka/loom-engine/commit/b9f93af6562ae40db62c91a254d6fb36c2ca329d),
the two CI workflows under `.github/workflows/`, and the public-side
repository posture (secrets, branch protection, GitHub Advanced
Security features).

Deliverable: this report, branch
`claude/phase-12-6-history-and-0.11.0-audit` on the engine repo. No
source changes.

## 1. Summary

**Verdict: P0/P1/P2 clean. No token rotation, no history rewrite, no
npm-unpublish candidate.** Going public did not expose any secret in
the commit graph. The 0.11.0 artifact is reproducible from public
source, ships with SLSA v1 provenance via npm Trusted Publishing
(no long-lived `NPM_TOKEN`), and contains no hardcoded URLs or
private identifiers. Five of seven prior-audit Low-severity
findings closed; two carried forward. Five new Low-severity items
identified in this pass.

| ID    | Severity | Area                                          | Closes in |
|-------|----------|-----------------------------------------------|-----------|
| L-08  | Low      | `COMMERCIAL_LICENSE_TERMS.md` not in tarball  | 0.11.1 manifest |
| L-09  | Low      | README references audit doc not in tarball    | 0.11.1 manifest |
| L-10  | Low      | `npm install -g npm@latest` unpinned in CI    | 0.11.1 CI |
| L-11  | Low      | GitHub Advanced Security disabled             | repo settings |
| L-12  | Low      | No branch protection on `main`                | repo settings |
| I-05  | Info     | `mitseum@gmail.com` permanent in commit history | accept |
| I-06  | Info     | Package was `@theworldtable/loom-engine` historically | accept |
| I-07  | Info     | Four OIDC-migration commits visible in history | accept |

Closed since the 12.2 baseline (`SECURITY-AUDIT-0.10.0.md`):

| ID    | Status   | Verification                                  |
|-------|----------|-----------------------------------------------|
| L-01  | ✅ FIXED | `LOOM_ENGINE_VERSION = '0.11.0'` in dist/index.js (matches `package.json.version`) |
| L-02  | ✅ DOC FIX | README §Configuration documents `withCredentials` defaults + override seams (per CHANGELOG 0.10.1 carryforward) |
| L-04  | ✅ FIXED | `exports` map exposes `./package.json` |
| L-05  | ✅ FIXED | npm registry shows SLSA v1 attestation; certificate identity is `…/.github/workflows/npm-publish.yml@refs/tags/v0.11.0` |
| L-06  | ✅ FIXED | `_npmUser: GitHub Actions <npm-oidc-no-reply@github.com>`; `gh api repos/.../actions/secrets` returns `total_count: 0` |
| L-07  | ✅ FIXED | Both `v0.10.0` and `v0.11.0` git tags exist (`git tag -l`) |

Carried forward (still open from the 12.2 audit):

| ID    | Status   | Note                                           |
|-------|----------|------------------------------------------------|
| L-03  | ⏸️ DEFERRED | `validateResponse` still trusts nested envelopes (comment at `src/director/snapshot-recovery.ts:230` unchanged). No new exploit surface; same posture as 0.10.0. |
| I-01  | ⏸️ DEFERRED to 1.0 | `private` fields still surface in `.d.ts`. Pre-1.0, accept. |
| I-02  | ⏸️ NOT FIXED | `clean` script still in published `package.json`. Trivial cleanup, not blocking. |
| I-03  | unchanged | TWT-specific catalog identifiers ship as data. Acceptable for productized engine. |

Clean areas this pass: full-history token scan, env/secret-file
history scan, accidental log/dump scan, hardcoded-URL surface in
dist/ (zero matches), private-string scan in dist/ (zero matches),
runtime deps (still zero), `npm audit` (still 0/0/0/0/0),
reproducibility (dist/ byte-identical to published modulo line
endings), Trusted Publishing certificate identity (matches workflow
+ commit SHA), maintainer-set scope (single maintainer, OIDC
publisher).

## 2. Git history scan

Scope: 43 commits, 11 refs (main + 9 feature branches + gh-pages).
First commit `6071518` (Phase 0 scaffolding). HEAD `b9f93af` (CI
fix for OIDC).

### 2.1. Token / credential patterns

`git log --all --full-history -p` filtered through the union of
`ghp_ | github_pat_ | gho_ | ghu_ | ghs_ | ghr_ | npm_<30+chars> | sk-<20+chars> | AKIA[0-9A-Z]{16} | xoxb- | xoxp-`.

**Zero matches.** No GitHub PAT, no npm classic/automation token, no
OpenAI / Anthropic / Stripe / AWS / Slack token has ever been
committed to any reachable ref.

### 2.2. Env / secret files in history

`git log --all --diff-filter=A --name-only -- "*.env*" "*.envrc"
"*secrets*" "*.pem" "*.key" "*.p12" "*.pfx" "credentials*"
"config.local*"`.

**Zero matches.** No `.env` family, no PEM / PKCS12 key material, no
`secrets.*` or `credentials.*` ever added.

### 2.3. Private hostnames / dev URLs

Scanned for `twt-prod | twt-2nd | connoisseur | krabi | sunisa | mitse |
192.168.* | 10.0.* | 172.16-31.* | localhost:<port> | 127.0.0.1:<port>`.

The only matches are:

- `mitseum@gmail.com` in commit author lines (43 commits authored as
  `Misha Mitiev` / `sadhaka` with that email - see I-05).
- `localhost:8765` in two locations: `.claude/launch.json` (a Python
  http.server config for the demo, see §2.6) and the README's
  build-and-browse instructions for `demo/index.html`. Both are
  expected for a demo-server doc.
- `twt-prod / krabi / sunisa / mitse / connoisseur / twt-2nd-pc`
  appear only inside `SECURITY-AUDIT-0.10.0.md`, in the *list of
  things scanned for and not found*. The audit document quotes its
  own negative-match wordlist, which the regex then matches. Not a
  leak - the document text says these strings did not appear in the
  artifact.

Public references that ship by design (acceptable):
`theworldtable.ai`, `loom-engine.pages.dev`,
`licensor@theworldtable.ai`, `github.com/sadhaka/loom-engine`.

**No private hostnames, dev IPs, or internal subdomains are exposed
by the public history.**

### 2.4. Security-revealing comments

Filtered for `TODO[: ]+(security|auth|crypt|sanit) | FIXME(...) |
XXX | HACK | temporary | insecure | hardcod | backdoor | debug.*only
| disable.*auth | skip.*auth | bypass`.

Matches inspected:

- `// Synthetic press / release for tests. Bypasses DOM listeners` -
  test infrastructure, intentional.
- `(or AudioContext is undefined) bypasses construction` - test
  infrastructure, intentional.
- `Positive control: providing fetchImpl bypasses the global check` -
  test infrastructure, intentional.
- `/* temporary fix to vertically align, for compatibility */` - CSS
  comment in vendored typedoc theme, benign.
- `Hardcoded credentials: 'include'` - quoted from the prior audit's
  L-02 finding text, not a code annotation.
- `not hardcoded. This is also the Frostbite FrameGraph idea` -
  RenderGraph spec excerpt, prose, not a security marker.

**No `TODO security`, `FIXME auth`, `XXX HACK`, or weakness-revealing
comments exist in any code path.**

### 2.5. Personal info beyond LICENSE

Distinct email addresses across the entire commit graph:

| Email                                          | Source                | Posture |
|------------------------------------------------|-----------------------|---------|
| `licensor@theworldtable.ai`                    | LICENSE / README / CHANGELOG | intentional public contact |
| `mitseum@gmail.com`                            | git author/committer on local-machine commits | see I-05 |
| `79599980+sadhaka@users.noreply.github.com`    | GitHub web-UI commits | GitHub-managed identity, fine |
| `noreply@anthropic.com`                        | `Co-Authored-By: Claude Opus 4.7 …` trailers | fine |

Distinct committer identities:

| Identity                                                                            | Posture |
|--------------------------------------------------------------------------------------|---------|
| `Misha Mitiev <mitseum@gmail.com>`                                                  | local desktop git config |
| `sadhaka <mitseum@gmail.com>`                                                        | alternate local git config |
| `sadhaka <79599980+sadhaka@users.noreply.github.com>`                                | GitHub web UI |
| `github-actions[bot] <github-actions[bot]@users.noreply.github.com>`                 | docs.yml gh-pages commits |

Beyond Misha's gmail address (I-05), no phone numbers, addresses,
unrelated personal names, or third-party emails appear in any
commit blob.

### 2.6. Accidental log / dump / config files

`git log --all --diff-filter=A --name-only -- "*.log" "*.dump"
"*.har" "*.bak" "*.backup" "*.pcap" "core.*"` returns zero adds.

Two non-source dotfiles were committed early in history and are
worth noting:

1. `.claude/launch.json` - added at `e9dc58c` (Phase 1), still present
   in HEAD. Contents:
   ```json
   {"version": "0.0.1",
    "configurations": [{"name": "demo",
      "runtimeExecutable": "python",
      "runtimeArgs": ["-m", "http.server", "8765"],
      "port": 8765}]}
   ```
   Local Python http.server config for the demo. **Benign** - no
   credentials, no private paths.

2. `.commit-msg-phase6.txt` - added at `721c3c3` (Phase 6), removed at
   `b2c965c` ("drop accidental .commit-msg file + ignore the
   pattern"). Content is the Phase 6 commit-message draft, which is
   **identical** to the actual commit body of `721c3c3`. Net leak:
   zero - the same text was already public via the commit message.
   The `.gitignore` now excludes `.commit-msg-*.txt`.

Maximum non-doc blob size in history: 172 KB
(`docs/.../modules.html`, generated typedoc HTML). No suspiciously
large binary, no committed `node_modules` snapshot.

### 2.7. Pre-rename / old-name commits

The package was renamed from `@theworldtable/loom-engine` →
`@sadhaka/loom-engine` partway through history. First 7 commits
shipped as `@theworldtable/loom-engine` (never published to npm
under that name; verified via `npm view @theworldtable/loom-engine`
returns 404). All subsequent commits use `@sadhaka/loom-engine`.

```
6071518 (Phase 0)          @theworldtable/loom-engine
…
c43a3d9 (Phase 7 deeper)   @theworldtable/loom-engine
b497d6d (Phase 7 final)    @sadhaka/loom-engine    (rename point)
…
b9f93af (HEAD)              @sadhaka/loom-engine
```

The old scope name remains visible in historical `package.json` blobs
and historical commit messages but never reached the npm registry.
**No security consequence.** See I-06.

The repo itself was created at `sadhaka/loom-engine` and has not
been renamed at the GitHub level, so there are no GitHub redirect
artifacts to clean up.

## 3. Tarball inventory

```
filename: sadhaka-loom-engine-0.11.0.tgz
package size: 135.9 kB
unpacked size: 607.7 kB
shasum:  ba42c7426b17520ab40a7482fa1ef596c5e2ddbf
integrity: sha512-3/2SxOboco05m0e1FsWSB4cJZzU1CIiC0MwjUt4hrdUx0UZcCHjhiffOpgAQvarnn55bs8EhAgcmIPlaalp6Tg==
total files: 219
```

vs 0.10.0 (133.6 kB / 601.6 kB / 219 files): same file count, +2.3 kB
package size, +6.0 kB unpacked. Diff explained by:
- `LICENSE` grew from 1075 bytes (MIT, ~25 lines) to 4583 bytes (BUSL
  1.1 with parameters block, see §5).
- `README.md` License section rewritten with revenue threshold +
  conversion date + commercial-contact text.

Files shipped:

```
package/LICENSE       (4583 bytes)
package/README.md    (16725 bytes)
package/package.json  (1775 bytes)
package/dist/        (216 files: 54 .js + 54 .d.ts + 108 .map)
```

Same shape as 0.10.0. **No `.git`, no `.env`, no `src/`, no `tests/`,
no `tools/`, no `assets/`, no `docs/`, no internal markdown specs,
no editor cruft, no `node_modules/` snapshot, no `.commit-msg-*.txt`
artifact.** The `package.json` `files` array (`["dist", "README.md",
"LICENSE"]`) is intentionally restrictive; `.npmignore` provides
defense in depth.

`dist/*.map` source maps reference `../src/<file>.ts` paths but contain
no `sourcesContent` field - consistent with 0.10.0, no TypeScript
source content embedded.

## 4. Secrets / hostname / path scan against dist/

Scanned the published `dist/` for: `ghp_ | github_pat_ |
npm_<30+chars> | sk-<20+chars> | AKIA[0-9A-Z]{16}` plus
`api_key | secret | token | password | bearer | hmac`. The
`token`/`secret`/etc. matches are all non-credential code (e.g.
"Token bucket" rate-limit comment, `param: token` function arg
docs, "user-supplied" disclaimers). **No secret-shaped string
literals.**

Scanned for any HTTP/HTTPS URL literal in `dist/*.js` or
`dist/*.d.ts`: **zero matches**. The four files that perform network
I/O still read URLs from constructor arguments supplied by the
consumer (no regression from 0.10.0).

Scanned for `twt-prod | twt-2nd | connoisseur | krabi | sunisa |
mitse | theworldtable | loom-engine.pages.dev | 192.168.* | 10.0.* |
172.16-31.*`: **zero matches** in dist/. (Earlier scan noted that
README.md - which ships - contains `theworldtable.ai` and
`loom-engine.pages.dev`, both intentional public references.)

Confirmed: `LOOM_ENGINE_VERSION = '0.11.0'` (literal in
`dist/index.js:6` and `dist/index.d.ts:1`). **L-01 closed.**

## 5. License compliance (BUSL 1.1)

`package.json`:
```json
"license": "BUSL-1.1"
```

`LICENSE` parameters block (lines 1-23):
- Licensor: `Misha Mitiev`
- Licensed Work: `Loom Engine, version 0.11.0 and later`
- Copyright: `(c) 2026 Misha Mitiev`
- Additional Use Grant: `gross revenue ... does not exceed USD
  $1,000,000 in any consecutive 12-month period`
- Commercial-license contact: `licensor@theworldtable.ai`
- Standard royalty: `5% royalty on excess revenue above the threshold`
- Change Date: `2030-05-08` (4 years from publication, per BUSL spec)
- Change License: `Apache License, Version 2.0`

All required BUSL 1.1 parameters present and self-consistent.
README License section (lines 1-23 of the section) reflects identical
terms.

CHANGELOG 0.11.0 entry documents the MIT → BUSL pivot, the
0.10.0 grandfathering clause ("0.10.0 remains permanently licensed
under MIT"), and the patent-strategy / PRIOR-ART.md continuity.

`license-checker --csv` across the dev tree (54 packages): all
permissive. No copyleft, no GPL contamination. Consumers receive
zero of these since the published package has zero runtime
dependencies (verified §7).

### L-08. `COMMERCIAL_LICENSE_TERMS.md` referenced by README but not shipped. Severity: Low.

`README.md` ships in the tarball and contains a relative link:

```md
licensor@theworldtable.ai`. Standard terms include a 5% royalty on
excess revenue; lump-sum buyouts and equity-for-license arrangements
are negotiable. See
[COMMERCIAL_LICENSE_TERMS.md](./COMMERCIAL_LICENSE_TERMS.md).
```

But `COMMERCIAL_LICENSE_TERMS.md` is **not** in the published
tarball - `package.json` `files` declares only `["dist", "README.md",
"LICENSE"]`. A consumer reading the README in
`node_modules/@sadhaka/loom-engine/README.md` hits a broken
relative link.

**Repro:**
```sh
mkdir tmp && cd tmp && npm init -y >/dev/null
npm install @sadhaka/loom-engine
ls node_modules/@sadhaka/loom-engine/
# LICENSE  README.md  dist  package.json
ls node_modules/@sadhaka/loom-engine/COMMERCIAL_LICENSE_TERMS.md
# ls: cannot access ...: No such file or directory
```

**Impact:** zero security consequence. The binding agreement is the
shipped `LICENSE` (BUSL 1.1 with full parameters block); the missing
file is a *negotiation outline*, not the license itself. But a
consumer cannot resolve the link without leaving their dependency
tree, which is a discoverability gap for the commercial-license
flow.

**Fix sketch:** add `"COMMERCIAL_LICENSE_TERMS.md"` to the
`files` array in `package.json`, OR change the README link to an
absolute GitHub URL
(`https://github.com/sadhaka/loom-engine/blob/main/COMMERCIAL_LICENSE_TERMS.md`).
Shipping the file is the cleaner fix.

### L-09. README references `SECURITY-AUDIT-0.10.0.md` not in tarball. Severity: Low.

Same root cause as L-08. The README License section explains the
0.10.0 → 0.11.0 license pivot and points at the prior audit:

```
[`SECURITY-AUDIT-0.10.0.md`](./SECURITY-AUDIT-0.10.0.md). The
```

`SECURITY-AUDIT-0.10.0.md` is not in `files`, so the relative link
also breaks for consumers reading from `node_modules/`.

**Impact:** discoverability only. The audit reports document the
engine's posture for evaluators but are not part of the binding
license terms.

**Fix sketch:** either (a) ship audit reports as part of the package
by adding `"SECURITY-AUDIT-*.md"` to `files`, or (b) rewrite both
README links to absolute GitHub URLs. Option (b) is lower risk - it
keeps the package small and avoids accidentally shipping future
in-progress audit drafts.

## 6. Provenance attestation + reproducibility

### Provenance

`npm view @sadhaka/loom-engine@0.11.0 --json` reports:

```json
"attestations": {
  "url": "https://registry.npmjs.org/-/npm/v1/attestations/@sadhaka%2Floom-engine@0.11.0",
  "provenance": { "predicateType": "https://slsa.dev/provenance/v1" }
},
"signatures": [
  { "keyid": "SHA256:DhQ8wR5APBvFHLF/+Tc+AYvPOdTpcIDqOhxsBHRwC7U", "sig": "..." }
],
"_npmUser": "GitHub Actions <npm-oidc-no-reply@github.com>"
```

Two attestations resolve at the URL:

1. **npm publish attestation** (predicateType
   `https://github.com/npm/attestation/tree/main/specs/publish/v0.1`)
   signed via Sigstore with the npm registry key.
2. **SLSA v1 build provenance** (predicateType
   `https://slsa.dev/provenance/v1`) with X.509 certificate from
   `sigstore-intermediate`. The certificate's GitHub-issued OIDC
   identity claims (decoded from the cert extensions):

   - **Workflow path**: `https://github.com/sadhaka/loom-engine/.github/workflows/npm-publish.yml@refs/tags/v0.11.0`
   - **Commit SHA**: `b9f93af6562ae40db62c91a254d6fb36c2ca329d` (matches HEAD)
   - **Trigger**: `push`
   - **Repository**: `sadhaka/loom-engine` (owner ID `79599980`)
   - **Tag**: `refs/tags/v0.11.0`
   - **Run URL**: `https://github.com/sadhaka/loom-engine/actions/runs/2552727108/attempts/2`
   - **Visibility**: `public`

The certificate's `Run URL/attempts/2` indicates the publish
succeeded on the second attempt. Attempt 1 failed during the OIDC
migration (`9c63e68 → 1797555 → 1eaf9a1 → b9f93af` series of CI
fixes; see I-07). The published artifact is the one signed by the
final successful run.

**L-05 closed.**

### Reproducibility

```
$ rm -rf dist/
$ npm ci --silent
$ npm run build
$ find dist -type f | wc -l
216
$ diff -r dist .audit-12-6/package/dist
(no output)
$ echo $?
0
```

**`dist/` is byte-identical** to the published tarball - 216 files
match.

The full `npm pack` shasum differs slightly between local
(`339667a4…`) and published (`ba42c742…`) because top-level
`README.md` / `LICENSE` / `package.json` checked out via Windows
git use CRLF line endings; the published tarball was packed on the
GHA `ubuntu-latest` runner with LF. With `diff -b` (ignore
whitespace) all three top-level files compare equal:

```
$ diff -b package.json .audit-12-6/package/package.json && echo OK
OK
$ diff -b README.md .audit-12-6/package/README.md && echo OK
OK
$ diff -b LICENSE .audit-12-6/package/LICENSE && echo OK
OK
```

A `dos2unix` pass on the local checkout produces a tarball with the
same bytes as published. **The build is reproducible from public
source - no build-time injection occurred between commit `b9f93af`
and the npm publish.**

## 7. Runtime + dev dependencies

`package.json` declares no `dependencies`, no `peerDependencies`, no
`optionalDependencies` (unchanged from 0.10.0). Consumers receive
zero transitive code at runtime.

Dev tree: 4 declared devDependencies (`tsx`, `typedoc`,
`typedoc-plugin-markdown`, `typescript`) → 54 transitive packages.

```
$ npm audit --json | jq '.metadata.vulnerabilities'
{
  "info": 0, "low": 0, "moderate": 0, "high": 0, "critical": 0, "total": 0
}
```

**Zero vulnerabilities** across the dev graph. Lockfile v3, 55
package entries, 54 with `integrity` SRI hashes (the missing entry is
the engine itself).

`npm test`: 12 test files exercised on Node 20.20.2 (matching CI).
All pass. Identical pass rate to the 0.10.0 audit (208/208 then;
expanded suite for 0.11.0 still 100% green).

## 8. Install-time script surface

```
$ node -p "Object.entries(require('@sadhaka/loom-engine/package.json').scripts).filter(([k]) => /^(pre|post)?install$|^(pre|post)?uninstall$|^prepare$/.test(k)).length"
0
```

No `install`, `preinstall`, `postinstall`, `prepare`,
`preuninstall`, or `postuninstall` script. A consumer running
`npm install @sadhaka/loom-engine` executes zero JavaScript from
this package during install.

The `clean` script remains in the published `package.json` (I-02
from 0.10.0 audit, **still not fixed**). Trivial cleanup, not
blocking.

## 9. CI workflows

### npm-publish.yml (4535 bytes)

Trigger: `push` of a `v*` tag, plus `workflow_dispatch` with optional
`dry_run` choice. Permissions: `contents: read`, `id-token: write`.
Concurrency keyed on ref. Runs on `ubuntu-latest`.

Steps (in order):
1. `actions/checkout@v6`
2. `actions/setup-node@v6` with `node-version: '20'`,
   `registry-url: 'https://registry.npmjs.org'`, `cache: 'npm'`
3. **Force OIDC**: deletes `$NPM_CONFIG_USERCONFIG`, `~/.npmrc`,
   clears `NODE_AUTH_TOKEN` and `NPM_CONFIG_USERCONFIG` env. This
   neutralises `setup-node@v6`'s silent injection of
   `${{ github.token }}` as `NODE_AUTH_TOKEN` (would otherwise
   404 against npm). Documented inline; the `auth-token: ''`
   input that supposedly disables this in older `setup-node`
   versions is not recognised by v6 (causes "Unexpected input"
   warning).
4. **Update npm to latest**: `npm install -g npm@latest`. Required
   because Node 20 ships npm 10.x, but npm Trusted Publishing OIDC
   needs npm 11.5.1+. Without this, `npm publish` errors with
   `ENEEDAUTH`. See L-10 for the unpinned-version concern.
5. `npm ci`
6. `npm test`
7. `npm run build`
8. **Verify version matches tag**: refuses to publish if
   `package.json.version != GITHUB_REF_NAME minus v prefix`.
9. **Publish**: `npm publish --access public --provenance`
   (or `--dry-run` if dispatched manually with that input).

Trusted Publishing flow verified end-to-end: `_npmUser` on the
published artifact is `GitHub Actions <npm-oidc-no-reply@github.com>`,
which only the OIDC exchange path produces. No `NPM_TOKEN` repo
secret exists (`gh api repos/sadhaka/loom-engine/actions/secrets`
returns `total_count: 0`). **L-06 fully closed.**

### docs.yml (2317 bytes)

Unchanged from 0.10.0 audit posture. Trigger: push to main, PRs,
`workflow_dispatch`. Permissions: `contents: write` (required for
peaceiris). Action versions: `actions/checkout@v6`,
`actions/setup-node@v6`, `peaceiris/actions-gh-pages@v4` with
`FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` env-flag workaround for
peaceiris's stalled Node 24 release. Builds typedoc to
`./docs-build/`, deploys to `gh-pages` branch on push to main.
Cloudflare Pages serves `gh-pages` at `loom-engine.pages.dev`.

### L-10. `npm install -g npm@latest` is unpinned in publish CI. Severity: Low.

`.github/workflows/npm-publish.yml`:

```yaml
- name: Update npm to latest (for Trusted Publishing OIDC)
  run: |
    npm install -g npm@latest
    npm --version
```

This step pulls whatever npm version is `latest` at the moment of
the publish run. The build provenance pins the *engine* source by
commit SHA, but the *publish tool* is whatever the npm registry
serves at run time. If a malicious npm release ever shipped under
the `latest` dist-tag (or if the npm CLI itself were tampered with
between the version bump and a future publish), the engine's
publish step would execute that code with `id-token: write`.

This is a low-likelihood, high-impact pattern. The mitigation
that already exists: the build runs `npm test` and `npm run build`
*before* the publish step, so a malicious npm CLI affecting test or
build behaviour would surface as test failures. But a CLI that only
mis-behaves at `publish` time (e.g. exfiltrates the OIDC token mid-
exchange) would not be caught.

**Fix sketch:** pin to a tested version with a periodic bump:

```yaml
- name: Update npm to a known-good version
  run: |
    npm install -g npm@11.14.0   # known good for OIDC, tested 2026-05-07
    npm --version
```

Reaudit on each bump. Trade-off: occasionally have to chase the
minimum-OIDC-supporting version, vs locking down which CLI signs
publishes.

## 10. Repository posture (now-public)

Public-side state via `gh api repos/sadhaka/loom-engine`:

| Setting                                | Value      | Posture |
|----------------------------------------|------------|---------|
| `visibility`                           | `public`   | intentional (12.5) |
| `default_branch`                       | `main`     | ✓ |
| `archived`                             | `false`    | ✓ |
| `disabled`                             | `false`    | ✓ |
| `has_issues`                           | `true`     | open for community feedback |
| `has_wiki`                             | `false`    | no leak surface ✓ |
| `has_pages`                            | `false`    | CF Pages used instead ✓ |
| `has_discussions`                      | `false`    | no leak surface ✓ |
| `has_projects`                         | `true`     | none configured (verified empty) |
| `allow_forking`                        | `true`     | BUSL allows below-threshold use |
| `web_commit_signoff_required`          | `false`    | DCO not required (low priority for solo dev) |

| Security feature                                | Status     |
|------------------------------------------------|------------|
| `dependabot_security_updates`                  | `disabled` |
| `secret_scanning`                              | `disabled` |
| `secret_scanning_push_protection`              | `disabled` |
| `secret_scanning_non_provider_patterns`        | `disabled` |
| `secret_scanning_validity_checks`              | `disabled` |

Issues: 0 open, 0 closed (`gh issue list --state all` returns
empty). PRs: 1 total (`#1` ci(docs): bump actions to Node 24,
`MERGED`, sole author `sadhaka`). No external contribution surface
exists yet.

Repo-level secrets: `total_count: 0` (cleaned, see L-06 closure).
Repo-level variables: `total_count: 0`.

### L-11. GitHub Advanced Security features disabled. Severity: Low.

GitHub offers free secret scanning, push protection, and dependabot
security updates on public repos. All five settings under
`security_and_analysis` are `disabled`. Free defense-in-depth
against:

- Future accidental token commits (push protection blocks pushes
  containing recognised credential patterns).
- Existing token leaks (secret scanning continuously re-scans the
  repo against an updated provider catalog).
- Disclosed CVEs in the dev tree (dependabot auto-PRs the bump).

**Impact:** none today (the audit confirms zero secrets in history
and zero CVEs in the dev tree). But these features are the
mechanical safety net for future commits, and they cost nothing on a
public repo. Enabling them is a low-effort, high-leverage hardening
step.

**Fix sketch:**
```sh
gh api -X PATCH repos/sadhaka/loom-engine \
  -f security_and_analysis[secret_scanning][status]=enabled \
  -f security_and_analysis[secret_scanning_push_protection][status]=enabled \
  -f security_and_analysis[dependabot_security_updates][status]=enabled
```

Or via the web UI: Settings → Code security → enable each toggle.

### L-12. No branch protection on `main`. Severity: Low.

`gh api repos/sadhaka/loom-engine/branches/main/protection` returns
`404 Branch not protected`. Anyone with push rights to the repo
(currently only `sadhaka`) can push directly to `main` without PR
review, can force-push, can delete the branch.

**Impact:** today, only Misha has push rights, so this is a self-
discipline gap, not an external risk vector. But: (a) accidental
force-push could rewrite the main history that npm provenance
attestations depend on for traceability, and (b) any future
collaborator would need branch protection in place before they get
push rights.

**Fix sketch:** at minimum, require PR reviews and disallow force-
push:

```sh
gh api -X PUT repos/sadhaka/loom-engine/branches/main/protection \
  -f required_status_checks=null \
  -F enforce_admins=false \
  -f required_pull_request_reviews[required_approving_review_count]=0 \
  -F restrictions=null \
  -F allow_force_pushes=false \
  -F allow_deletions=false
```

Solo dev can still merge their own PRs (`required_approving_review_count: 0`)
but force-push and accidental deletion are blocked.

## 11. Source-to-dist drift between 0.10.0 and 0.11.0

Both tarballs unpacked, dist/ compared:

```
$ npm pack @sadhaka/loom-engine@0.10.0
$ tar -xzf sadhaka-loom-engine-0.10.0.tgz -C p010
$ diff -r p010/package/dist package/dist
diff -r p010/package/dist/index.d.ts package/dist/index.d.ts
diff -r p010/package/dist/index.d.ts.map package/dist/index.d.ts.map
diff -r p010/package/dist/index.js package/dist/index.js
diff -r p010/package/dist/index.js.map package/dist/index.js.map
```

**Only four files differ between 0.10.0 and 0.11.0 dist** (out of
216). All four are the index entry point and its source/decl maps:

| File                          | 0.10.0 → 0.11.0 change |
|-------------------------------|------------------------|
| `dist/index.js`               | `LOOM_ENGINE_VERSION` constant `'0.10.0-perf-9-1'` → `'0.11.0'` plus 5-line comment block explaining the L-01 fix history |
| `dist/index.d.ts`             | `LOOM_ENGINE_VERSION` constant change (same) |
| `dist/index.js.map`           | source-map mappings updated for the new comment block |
| `dist/index.d.ts.map`         | source-map mappings updated for the new comment block |

The other 212 dist files are **byte-identical** between 0.10.0 and
0.11.0. The 0.11.0 release is a **license-only pivot** for the
runtime, with the L-01 constant fix carried over from the
never-published 0.10.1. No new behaviour, no new exports, no
removed exports - just the constant fix and the LICENSE swap.

L-03's "trust the server for v1" comment at
`src/director/snapshot-recovery.ts:230` is unchanged. The
`validateResponse` function still validates only the top-level
envelope (`ok`, `character_id`, `tail_id`, `snapshot` exists) and
defers nested-shape validation to `applySnapshot`. Same posture as
0.10.0; no new exploit surface; carrying forward.

## 12. Informational notes

### I-05. `mitseum@gmail.com` is permanently in commit history.

43 commits authored under `Misha Mitiev <mitseum@gmail.com>` or
`sadhaka <mitseum@gmail.com>` (local-machine git config). Once the
repo went public, this email became permanently visible via
`git log` to anyone who clones.

This is the standard git posture: author-email lives in commit
metadata and is not removable without history rewrite (which would
invalidate every existing fork, the npm provenance attestations
that pin commit SHAs, and the `gitHead` field on published 0.11.0
metadata).

GitHub web-UI commits use the `noreply` form
(`79599980+sadhaka@users.noreply.github.com`), so any future commits
made via the GitHub web editor will not add new exposure. Local
desktop commits will continue to use whatever `git config user.email`
is set to.

**Impact:** spam / fingerprinting risk only. The email is already
public via `git log` on every public repo Misha has worked on, so
the marginal exposure from this repo specifically is small.

**Fix sketch (optional):** to prevent *future* exposure, set
`git config --global user.email
"79599980+sadhaka@users.noreply.github.com"` on the local machine
that produces engine commits. Existing history stays as-is.

### I-06. Package was historically `@theworldtable/loom-engine`.

First seven commits shipped under the `@theworldtable` npm scope
before being renamed to `@sadhaka` at commit `b497d6d` (Phase 7
final). The old name is grep-able in historical `package.json`
blobs but never reached the npm registry under that scope.

**Impact:** none. Historical artifact only.

### I-07. Four OIDC-migration commits visible in history.

Four commits land between `9c63e68` (initial OIDC switch) and
`b9f93af` (HEAD):

```
9c63e68  ci: switch npm publish to Trusted Publishing (OIDC, no NPM_TOKEN)
1797555  ci(fix): clear setup-node auth-token default to enable OIDC
1eaf9a1  ci(fix): explicitly clear .npmrc + NODE_AUTH_TOKEN to force OIDC
b9f93af  ci(fix): upgrade npm to latest for Trusted Publishing OIDC support
```

Each successive commit fixes a real OIDC-integration issue surfaced
by the prior attempt. The build provenance for 0.11.0 confirms the
publish succeeded on `attempts/2` of run `2552727108`, run from the
final commit `b9f93af`.

**Impact:** none - this is the audit trail for the L-06 closure. The
sequence is the kind of CI churn typical of OIDC adoption against
`setup-node@v6`'s undocumented token-injection behaviour.

## 13. Recommendations summary

For 0.11.1 (manifest + CI hygiene):

1. **L-08** ship `COMMERCIAL_LICENSE_TERMS.md` (add to `package.json`
   `files` array, OR rewrite README link to absolute URL).
2. **L-09** rewrite README's `SECURITY-AUDIT-0.10.0.md` link to
   absolute (or ship audit reports with the package).
3. **L-10** pin `npm install -g npm@<known-good-version>` instead of
   `@latest` in `npm-publish.yml`.
4. **I-02** (carried) strip `clean` script from published
   `package.json` via a `prepublishOnly` rewrite.

For repo-level posture (do once, no release coupling):

5. **L-11** enable secret scanning, push protection, and dependabot
   security updates.
6. **L-12** enable basic branch protection on `main` (block force-
   push and deletions; PR-review threshold can stay at 0 for solo
   dev).

For 1.0 hardening:

7. **L-03** (carried) validate snapshot envelopes up front via the
   shared `parseEnvelope` allowlist.
8. **I-01** (carried) convert TypeScript `private` to ECMAScript
   `#private` for fields that should not surface in `.d.ts`.

Optional, low-priority:

9. **I-05** switch local `git config user.email` to the GitHub
   no-reply form to stop adding new commits with the personal gmail.
10. **I-03** (carried) split TWT-specific catalogs into a sibling
    package (`@sadhaka/loom-twt-content`) before 1.0.

**No P0 / P1 / P2 findings. No token rotation. No history rewrite.
No npm-unpublish candidate.** 0.11.0 stays live.
