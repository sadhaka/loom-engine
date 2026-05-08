// Loom Engine - non-determinism tripwire (Phase 0.18 polish).
//
// Greps the engine source tree for non-deterministic clock / RNG calls
// that would silently break trace replays. The whitelist below covers
// every site that legitimately falls back to a wall clock (the
// CueCatalog default, the snapshot recovery boot path, and so on).
//
// What this test prevents:
//   - Math.random() in a tick-driven system (use RESOURCE_ENTROPY).
//   - Date.now() in a tick-driven system (use TimeResource or an
//     injected clock seam).
//   - new Date().getTime() (same hazard).
//   - performance.now() in a tick-driven system EXCEPT in the
//     whitelisted boot/recovery paths that run outside the per-frame
//     update loop.
//
// Adding one of these to a system inside src/systems/ or to a system
// reachable from world.tick() will fail this test. The fix is either:
//   (a) route through the entropy resource (Math.random equivalent),
//   (b) read TimeResource.elapsed * 1000 from world.resources, or
//   (c) accept an injected clock function via the constructor and
//       have the consumer pass a TimeResource-driven closure.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(__dirname, '..', 'src');

// Walk the src tree and yield every .ts file.
function walkTs(dir: string, out: string[]): void {
  const entries = readdirSync(dir);
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkTs(full, out);
    } else if (st.isFile() && name.endsWith('.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
}

interface MatchSite {
  file: string;
  line: number;
  text: string;
}

function findMatches(pattern: RegExp): MatchSite[] {
  const files: string[] = [];
  walkTs(SRC_ROOT, files);
  const out: MatchSite[] = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const lines = src.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i] ?? '';
      // Strip line comments and string literals when checking. Crude
      // but adequate: we only want EXECUTABLE code references. A line
      // that mentions Math.random inside a /* ... */ or a // comment
      // or a quoted string is documentation, not a call.
      const stripped = stripCommentsAndStrings(ln);
      if (pattern.test(stripped)) {
        out.push({ file, line: i + 1, text: ln.trim() });
      }
    }
  }
  return out;
}

// Best-effort strip of // comments, /* */ block comments (single line),
// and double / single quoted string literals. Does not handle template
// literals (engine source has none per CLAUDE.md style) or block
// comments that span lines (we treat each line independently).
function stripCommentsAndStrings(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    const ch2 = s[i + 1];
    // Line comment
    if (ch === '/' && ch2 === '/') break;
    // Block comment (single-line scope only)
    if (ch === '/' && ch2 === '*') {
      const end = s.indexOf('*/', i + 2);
      if (end < 0) {
        // Comment continues past end of line; drop the rest.
        break;
      }
      i = end + 2;
      continue;
    }
    // String literal
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < s.length) {
        if (s[i] === '\\') { i += 2; continue; }
        if (s[i] === quote) { i++; break; }
        i++;
      }
      out += ' ';
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// ----- Math.random -----

test('determinism tripwire: Math.random() does not appear in src/', () => {
  const sites = findMatches(/\bMath\.random\s*\(/);
  if (sites.length > 0) {
    const lines = sites.map((s) => relative(SRC_ROOT, s.file) + ':' + s.line + ' -> ' + s.text);
    assert.fail(
      'Math.random() found in src/. Use RESOURCE_ENTROPY (createEntropy + entropy.random()).\n'
      + lines.join('\n'),
    );
  }
});

// ----- Date.now / new Date().getTime -----
//
// Whitelist: cue-catalog.ts has a `defaultNowMs` fallback that returns
// Date.now() ONLY when performance.now is unavailable (Node SSR boot).
// CueCatalog accepts a `now` override at create time so consumers can
// pass a deterministic clock - the fallback is the no-options legacy
// path.
//
// The plugin-context defaults to Date.now too (the AI-plugin world is
// out-of-band from the per-frame tick loop; plugins are async and can
// run on consumer timers, not necessarily on the world tick).
//
// snapshot-recovery.ts is called at bridge-recovery time, NOT each
// frame; the nowMs there is a one-shot for `beginFade`.
const DATE_NOW_WHITELIST = [
  'audio/cue-catalog.ts',     // defaultNowMs fallback only
  'director/ai/plugin-context.ts',  // plugin context default (out-of-tick)
  'network/mock-multiplayer-bridge.ts',  // test bridge default constructor
  'network/sse-multiplayer-bridge.ts',   // browser SSE timeline bookkeeping
  // Phase 0.19 client-side plugin SDK. The plugin runtime is
  // out-of-tick (driven by SSE event arrivals); plugin authors who
  // need replay-tight clocks override now via ClientPluginRegistryOptions.
  'plugins/types.ts',           // PluginEntropy default seed fallback
  'plugins/client-registry.ts', // default opts.now + TTL helpers + reload cache-bust
];

function isWhitelisted(file: string, list: string[]): boolean {
  const rel = relative(SRC_ROOT, file).replace(/\\/g, '/');
  return list.indexOf(rel) >= 0;
}

test('determinism tripwire: Date.now() outside whitelist does not appear in src/systems/', () => {
  const all = findMatches(/\bDate\.now\s*\(/);
  const offenders = all.filter((s) => {
    const rel = relative(SRC_ROOT, s.file).replace(/\\/g, '/');
    return rel.startsWith('systems/');
  });
  if (offenders.length > 0) {
    const lines = offenders.map((s) => relative(SRC_ROOT, s.file) + ':' + s.line + ' -> ' + s.text);
    assert.fail(
      'Date.now() found inside src/systems/. Read TimeResource.elapsed * 1000 instead.\n'
      + lines.join('\n'),
    );
  }
});

test('determinism tripwire: Date.now() outside the documented whitelist (rest of src/) does not appear', () => {
  const all = findMatches(/\bDate\.now\s*\(/);
  const offenders = all.filter((s) => !isWhitelisted(s.file, DATE_NOW_WHITELIST));
  if (offenders.length > 0) {
    const lines = offenders.map((s) => relative(SRC_ROOT, s.file) + ':' + s.line + ' -> ' + s.text);
    assert.fail(
      'Date.now() found outside the determinism whitelist. Either:\n'
      + '  (a) inject a clock seam (see CueCatalogOptions.now), or\n'
      + '  (b) add the file to DATE_NOW_WHITELIST with an explanation.\n'
      + lines.join('\n'),
    );
  }
});

test('determinism tripwire: new Date().getTime() does not appear in src/', () => {
  const sites = findMatches(/new\s+Date\s*\(\s*\)\s*\.\s*getTime\s*\(/);
  if (sites.length > 0) {
    const lines = sites.map((s) => relative(SRC_ROOT, s.file) + ':' + s.line + ' -> ' + s.text);
    assert.fail(
      'new Date().getTime() found in src/. Same hazard as Date.now().\n'
      + lines.join('\n'),
    );
  }
});

// ----- performance.now() in tick-driven systems -----
//
// performance.now() is allowed in:
//   - cue-catalog.ts default fallback (clock seam injection point).
//   - snapshot-recovery.ts (one-shot recovery, not per-frame).
//   - mock-multiplayer-bridge / sse-multiplayer-bridge default clocks.
//   - audio/cue-catalog.ts and any test fixture that mocks the clock.
//
// performance.now() is FORBIDDEN inside src/systems/ because every
// file there is invoked from world.tick() each frame. Determinism
// requires those reads to come from TimeResource.

const PERF_NOW_SYSTEMS_WHITELIST: string[] = [
  // Empty - no system in src/systems/ should call performance.now.
];

test('determinism tripwire: performance.now() is absent from src/systems/', () => {
  const all = findMatches(/\bperformance\s*\.\s*now\s*\(/);
  const offenders = all.filter((s) => {
    const rel = relative(SRC_ROOT, s.file).replace(/\\/g, '/');
    if (!rel.startsWith('systems/')) return false;
    return PERF_NOW_SYSTEMS_WHITELIST.indexOf(rel) < 0;
  });
  if (offenders.length > 0) {
    const lines = offenders.map((s) => relative(SRC_ROOT, s.file) + ':' + s.line + ' -> ' + s.text);
    assert.fail(
      'performance.now() found inside src/systems/. Read TimeResource.elapsed * 1000 from world.resources.\n'
      + lines.join('\n'),
    );
  }
});

// ----- The director-system.ts and zone-event-system.ts cleanup -----
//
// Both used to mix performance.now() into the nowMs they pass to
// KnotContextResource.beginFade / tickFade. Phase 0.18 dropped that
// pollution. Verify those files no longer call performance.now().

test('determinism tripwire: director-system.ts does not call performance.now()', () => {
  const file = join(SRC_ROOT, 'director', 'director-system.ts');
  const src = readFileSync(file, 'utf8');
  const stripped = src.split(/\r?\n/).map(stripCommentsAndStrings).join('\n');
  assert.equal(/\bperformance\s*\.\s*now\s*\(/.test(stripped), false,
    'director-system.ts should read TimeResource.elapsed * 1000 only.');
});

test('determinism tripwire: zone-event-system.ts does not call performance.now()', () => {
  const file = join(SRC_ROOT, 'director', 'zone', 'zone-event-system.ts');
  const src = readFileSync(file, 'utf8');
  const stripped = src.split(/\r?\n/).map(stripCommentsAndStrings).join('\n');
  assert.equal(/\bperformance\s*\.\s*now\s*\(/.test(stripped), false,
    'zone-event-system.ts should read TimeResource.elapsed * 1000 only.');
});

// ----- Self-test: the regex helpers do what we expect -----

test('determinism tripwire: stripCommentsAndStrings ignores comments + string literals', () => {
  // A literal string mentioning Math.random must NOT trigger.
  assert.equal(/\bMath\.random\s*\(/.test(stripCommentsAndStrings('var s = "Math.random()";')), false);
  // A line comment.
  assert.equal(/\bMath\.random\s*\(/.test(stripCommentsAndStrings('// Math.random() ok in comments')), false);
  // A real call.
  assert.equal(/\bMath\.random\s*\(/.test(stripCommentsAndStrings('var r = Math.random();')), true);
});
