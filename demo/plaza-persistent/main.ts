// Loom Engine - Plaza Persistent example.
//
// THE PLAZA THAT REMEMBERS: persistence + partial sync, proven in one seeded,
// deterministic end-to-end run against the pinned golden vector (vector.json,
// byte-identical to test_vectors/v6_1_plaza_persistent.json - npm test drives
// the same inputs headlessly and asserts the same hashes).
//
//   1. BUILD     - S0: 12 villagers across 4 regions (region:<id> tags).
//   2. LIVE PLAY - tickEpoch epochs 1..2, both events onto an HMAC EventChain.
//   3. SUSPEND   - suspend() packs {snapshot @ index 0, chain tail} and EMBEDS
//                  the chain's seal in the bundle (bundle format v2) so a
//                  truncated tail cannot hide (a bare hash chain passes a cut
//                  tail; the structural seal's count+head catches it).
//   4. RESUME    - resume() verifies the snapshot hash, the STRUCTURAL seal +
//                  tail HMAC fail-closed, replays the tail via the
//                  recorded-mutation reducer, then resolves 12 offline epochs
//                  deterministically (0 voided).
//   5. PARTIAL SYNC - the page plays server AND client: partitionRegions on
//                  both sides, diffRegionLeaves finds EXACTLY the 2 regions the
//                  offline proposals touched, the client pulls only those 2
//                  partitions and applyPartialSync proves the recombined
//                  Merkle root equals the server root (fail-closed).
//
// This demo is a PROOF, not a printout: every stage is asserted against the
// pinned vector, the whole flow runs TWICE in-process and must be
// byte-identical, and any mismatch renders a red check and throws. The
// requestAnimationFrame timeline paces VISUALS ONLY - all state comes from the
// deterministic results computed up front. The tamper button corrupts one
// pulled region to show the red fail-closed rejection path (interactive only,
// not part of determinism).

import {
  EventChain,
  canonicalJson,
  tickEpoch,
  suspend,
  resume,
  replayEpochEvent,
  worldStateHash,
  regionLeaves,
  globalRegionHash,
  partitionRegions,
  diffRegionLeaves,
  applyPartialSync,
  type WorldState,
  type Ruleset,
  type ProposalMap,
  type EpochResolvedEvent,
  type ChainSeal,
  type WorldBundle,
  type ResumeResult,
  type RegionLeafDiff,
} from '@sadhaka/loom-engine';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const stats = document.getElementById('stats') as HTMLDivElement;
const syncEl = document.getElementById('sync') as HTMLDivElement;
const checksEl = document.getElementById('checks') as HTMLUListElement;
const tamperBtn = document.getElementById('tamper') as HTMLButtonElement;
const ctx = canvas.getContext('2d')!;

// ---- vector shape -----------------------------------------------------------

interface PlazaVectorInputs {
  key: string; worldId: string; genesis: string; actorTags: string[];
  regionTagPrefix: string; snapshotEventIndex: number; currentEpoch: number; maxCatchup: number;
  s0: WorldState; ruleset: Ruleset;
  liveProposalsByEpoch: Record<string, ProposalMap>;
  offlineProposalsByEpoch: Record<string, ProposalMap>;
}

interface PlazaVectorExpect {
  s0_hash: string;
  live: { event_hashes: string[]; record_sigs: string[]; chain_head: string; post_live_epoch: number; post_live_state_hash: string };
  suspend: {
    tail_length: number; tail_genesis: string; snapshot_state_hash: string; seal: ChainSeal;
    tail_verify_ok: boolean; truncated_tail_passes_without_seal: boolean; truncated_tail_fails_with_seal: boolean;
  };
  resume: {
    post_tail_state_hash: string; reducer_equals_live: boolean; final_epoch: number;
    epochs_resolved: number; epochs_voided: number; new_events_count: number;
    new_events_hash: string; final_state_hash: string;
  };
  partial_sync: {
    client_leaves: Record<string, string>; server_leaves: Record<string, string>; server_root: string;
    diff: { changed: string[]; added: string[]; removed: string[] };
    pulled: string[]; kept: string[]; merged_root_equals_server_root: boolean;
    bytes_pulled: number; bytes_full: number;
  };
  determinism: { runs: number; identical: boolean };
}

interface PlazaVector { inputs: PlazaVectorInputs; expect: PlazaVectorExpect; }

// ---- the deterministic scenario (mirrors tests/plaza-persistent.test.ts) -----

interface ScenarioRun {
  s0: WorldState;
  liveStates: WorldState[];          // after epoch 1, after epoch 2
  eventHashes: string[];
  recordSigs: string[];
  chainHead: string;
  bundle: WorldBundle;
  seal: ChainSeal;
  tailVerifyOk: boolean;
  truncatedBareOk: boolean;
  truncatedSealedRejected: boolean;
  sealMatchesPinned: boolean;
  postTailHash: string;
  resumeResult: ResumeResult;
  resumeStates: WorldState[];        // post-tail (epoch 2), then after each offline event (3..14)
  s0Hash: string;
  postLiveHash: string;
  finalStateHash: string;
  newEventsHash: string;
  serverRegions: Record<string, WorldState>;
  clientRegions: Record<string, WorldState>;
  serverLeaves: Record<string, string>;
  clientLeaves: Record<string, string>;
  serverRoot: string;
  diff: RegionLeafDiff;
  pulledRegions: Record<string, unknown>;
  syncedRoot: string;
  syncedPulled: string[];
  syncedKept: string[];
  bytesPulled: number;
  bytesFull: number;
}

function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

function runScenario(vec: PlazaVector): ScenarioRun {
  const i = vec.inputs;

  // (1) BUILD - work on a private clone so two runs share nothing.
  const s0 = JSON.parse(JSON.stringify(i.s0)) as WorldState;

  // (2) LIVE PLAY - epochs 1..2 onto the HMAC chain.
  const t1 = tickEpoch({ worldId: i.worldId, state: s0, epochNumber: 1, proposals: i.liveProposalsByEpoch['1']!, ruleset: i.ruleset, actorTags: i.actorTags });
  const t2 = tickEpoch({ worldId: i.worldId, state: t1.state, epochNumber: 2, proposals: i.liveProposalsByEpoch['2']!, ruleset: i.ruleset, actorTags: i.actorTags });
  const chain = EventChain.create<EpochResolvedEvent>({ key: i.key, genesis: i.genesis });
  const rec1 = chain.append('EpochResolved', t1.event);
  const rec2 = chain.append('EpochResolved', t2.event);
  if (!rec1 || !rec2) throw new Error('chain rejected a live event');

  // (3) SUSPEND - the bundle CARRIES its seal structurally (bundle format v2);
  // the embedded seal closes the tail-truncation hole and resume() verifies it.
  const bundle = suspend({ key: i.key, worldId: i.worldId, snapshotState: s0, snapshotEventIndex: i.snapshotEventIndex, chain });
  const seal = bundle.seal;
  const tailVerify = EventChain.verifyRecords<EpochResolvedEvent>(i.key, bundle.chainTail, bundle.tailGenesis, seal);
  const truncated = bundle.chainTail.slice(0, 1);
  const truncatedBare = EventChain.verifyRecords<EpochResolvedEvent>(i.key, truncated, bundle.tailGenesis);
  const truncatedSealed = EventChain.verifyRecords<EpochResolvedEvent>(i.key, truncated, bundle.tailGenesis, seal);

  // (4) RESUME - snapshot verify, tail verify + replay, 12 offline epochs.
  const postTail = replayEpochEvent(replayEpochEvent(s0, t1.event), t2.event);
  const r = resume({
    key: i.key, bundle, currentEpoch: i.currentEpoch, ruleset: i.ruleset,
    proposalsByEpoch: i.offlineProposalsByEpoch, maxCatchup: i.maxCatchup, actorTags: i.actorTags,
  });
  // Progressive states for the epoch-stepper HUD: pure reducer replay of the
  // resume result's own events - no re-ticking, no second source of truth.
  const resumeStates: WorldState[] = [postTail];
  let cursor = postTail;
  for (const ev of r.newEvents) {
    cursor = replayEpochEvent(cursor, ev);
    resumeStates.push(cursor);
  }

  // (5) PARTIAL SYNC - server = resumed state; client cache = pre-suspend state.
  const serverRegions = partitionRegions(r.state, i.regionTagPrefix);
  const clientRegions = partitionRegions(t2.state, i.regionTagPrefix);
  const serverLeaves = regionLeaves(i.key, serverRegions);
  const serverRoot = globalRegionHash(i.key, serverRegions);
  const clientLeaves = regionLeaves(i.key, clientRegions);
  const diff = diffRegionLeaves(clientLeaves, serverLeaves);
  const pulledRegions: Record<string, unknown> = {};
  for (const id of diff.changed) pulledRegions[id] = serverRegions[id];
  const synced = applyPartialSync({ key: i.key, cachedRegions: clientRegions, pulledRegions, serverLeaves, serverRoot });

  let bytesPulled = 0;
  let bytesFull = 0;
  for (const rid of Object.keys(serverRegions)) {
    const size = utf8Bytes(canonicalJson(serverRegions[rid]));
    bytesFull += size;
    if (diff.changed.indexOf(rid) >= 0) bytesPulled += size;
  }

  return {
    s0,
    liveStates: [t1.state, t2.state],
    eventHashes: [worldStateHash(i.key, t1.event), worldStateHash(i.key, t2.event)],
    recordSigs: [rec1.sig, rec2.sig],
    chainHead: chain.head(),
    bundle,
    seal,
    tailVerifyOk: tailVerify.ok,
    truncatedBareOk: truncatedBare.ok,
    truncatedSealedRejected: !truncatedSealed.ok,
    sealMatchesPinned: JSON.stringify(seal) === JSON.stringify(vec.expect.suspend.seal),
    postTailHash: worldStateHash(i.key, postTail),
    resumeResult: r,
    resumeStates,
    s0Hash: worldStateHash(i.key, s0),
    postLiveHash: worldStateHash(i.key, t2.state),
    finalStateHash: worldStateHash(i.key, r.state),
    newEventsHash: worldStateHash(i.key, r.newEvents),
    serverRegions,
    clientRegions,
    serverLeaves,
    clientLeaves,
    serverRoot,
    diff,
    pulledRegions,
    syncedRoot: synced.root,
    syncedPulled: synced.pulled,
    syncedKept: synced.kept,
    bytesPulled,
    bytesFull,
  };
}

// ---- the proof: every stage asserted against the pinned vector ---------------

interface Check { label: string; ok: boolean; }

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, idx) => v === b[idx]);
}

function buildChecks(vec: PlazaVector, run: ScenarioRun, identical: boolean): Check[] {
  const e = vec.expect;
  return [
    { label: 'S0 state hash == pinned (' + e.s0_hash.slice(0, 12) + '...)', ok: run.s0Hash === e.s0_hash },
    {
      label: 'live epochs 1..2: event hashes + record sigs + chain head == pinned',
      ok: sameList(run.eventHashes, e.live.event_hashes) && sameList(run.recordSigs, e.live.record_sigs)
        && run.chainHead === e.live.chain_head && run.postLiveHash === e.live.post_live_state_hash,
    },
    {
      label: 'suspend: snapshot hash == pinned S0 hash; tail = ' + e.suspend.tail_length + ' records anchored at the genesis',
      ok: run.bundle.snapshot.stateHash === e.suspend.snapshot_state_hash
        && run.bundle.snapshot.stateHash === e.s0_hash
        && run.bundle.chainTail.length === e.suspend.tail_length
        && run.bundle.tailGenesis === e.suspend.tail_genesis,
    },
    { label: 'tail HMAC + linkage verified; seal == pinned and verified over the full chain', ok: run.tailVerifyOk && run.sealMatchesPinned },
    {
      label: 'seal closes the truncation hole: cut tail passes bare verify, REJECTED with the seal',
      ok: run.truncatedBareOk && run.truncatedSealedRejected
        && e.suspend.truncated_tail_passes_without_seal && e.suspend.truncated_tail_fails_with_seal,
    },
    {
      label: 'tail replayed: post-tail hash == pinned == live state (recorded-mutation reducer)',
      ok: run.postTailHash === e.resume.post_tail_state_hash && run.postTailHash === e.live.post_live_state_hash,
    },
    {
      label: 'offline catch-up: ' + e.resume.epochs_resolved + ' resolved / ' + e.resume.epochs_voided + ' voided, final epoch ' + e.resume.final_epoch,
      ok: run.resumeResult.epochsResolved === e.resume.epochs_resolved
        && run.resumeResult.epochsVoided === e.resume.epochs_voided
        && run.resumeResult.newEvents.length === e.resume.new_events_count
        && run.resumeResult.state.epoch === e.resume.final_epoch
        && run.newEventsHash === e.resume.new_events_hash,
    },
    { label: 'final state hash == pinned (' + e.resume.final_state_hash.slice(0, 12) + '...)', ok: run.finalStateHash === e.resume.final_state_hash },
    {
      label: 'partial sync diff: changed == [' + e.partial_sync.diff.changed.join(', ') + '], nothing added/removed (pinned)',
      ok: sameList(run.diff.changed, e.partial_sync.diff.changed)
        && run.diff.added.length === 0 && run.diff.removed.length === 0
        && JSON.stringify(run.serverLeaves) === JSON.stringify(e.partial_sync.server_leaves)
        && JSON.stringify(run.clientLeaves) === JSON.stringify(e.partial_sync.client_leaves)
        && run.serverRoot === e.partial_sync.server_root,
    },
    {
      label: 'pulled ' + e.partial_sync.pulled.length + ' of ' + Object.keys(e.partial_sync.server_leaves).length + ' partitions: each leaf verified, recombined root == server root',
      ok: sameList(run.syncedPulled, e.partial_sync.pulled) && sameList(run.syncedKept, e.partial_sync.kept)
        && run.syncedRoot === run.serverRoot && e.partial_sync.merged_root_equals_server_root,
    },
    {
      label: 'bytes pulled ' + run.bytesPulled + ' of ' + run.bytesFull + ' == pinned (' + e.partial_sync.bytes_pulled + ' / ' + e.partial_sync.bytes_full + ')',
      ok: run.bytesPulled === e.partial_sync.bytes_pulled && run.bytesFull === e.partial_sync.bytes_full && run.bytesPulled < run.bytesFull,
    },
    { label: 'determinism: full flow run twice in-process, byte-identical', ok: identical },
  ];
}

// ---- rendering (procedural sprites, no asset files) ---------------------------

const REGION_QUADS: Record<string, { x: number; y: number; label: string }> = {
  north: { x: 0, y: 0, label: 'NORTH' },
  east: { x: 320, y: 0, label: 'EAST' },
  west: { x: 0, y: 200, label: 'WEST' },
  south: { x: 320, y: 200, label: 'SOUTH' },
};

const REGION_BODY: Record<string, string> = {
  north: '#7fa6c9', east: '#8fbf7f', west: '#b08fbf', south: '#c9a06f',
};

// Procedural sprites - colored rectangles, no asset files needed (the
// paintSprite pattern from survivor-mini).
function paintSprite(w: number, h: number, body: string, eye: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const sctx = c.getContext('2d')!;
  sctx.fillStyle = body; sctx.fillRect(0, 0, w, h);
  sctx.fillStyle = eye; sctx.fillRect(w * 0.25, h * 0.25, 2, 2); sctx.fillRect(w * 0.65, h * 0.25, 2, 2);
  return c;
}

const spriteCache: Record<string, HTMLCanvasElement> = {};
function spriteFor(region: string, actor: boolean): HTMLCanvasElement {
  const k = region + (actor ? ':a' : ':n');
  let s = spriteCache[k];
  if (!s) {
    s = paintSprite(16, 24, REGION_BODY[region] ?? '#999', actor ? '#1a1408' : '#000');
    spriteCache[k] = s;
  }
  return s;
}

function groupByRegion(state: WorldState, prefix: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const id of Object.keys(state.entities).sort()) {
    const ent = state.entities[id];
    if (!ent) continue;
    const tag = ent.tags.find((t) => t.indexOf(prefix) === 0);
    if (!tag) continue;
    const region = tag.slice(prefix.length);
    (out[region] = out[region] ?? []).push(id);
  }
  return out;
}

interface DrawOpts {
  suspended?: boolean;
  regionStatus?: Record<string, 'pulled' | 'kept'>;
  flashRegion?: string;
}

function drawWorld(state: WorldState, prefix: string, opts: DrawOpts): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0c0a07';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const groups = groupByRegion(state, prefix);
  for (const region of Object.keys(REGION_QUADS)) {
    const q = REGION_QUADS[region]!;
    // quadrant panel
    ctx.fillStyle = '#15120c';
    ctx.fillRect(q.x + 4, q.y + 4, 312, 192);
    ctx.strokeStyle = '#2a241a';
    ctx.lineWidth = 1;
    ctx.strokeRect(q.x + 4.5, q.y + 4.5, 311, 191);
    // partial-sync status overlay
    const status = opts.regionStatus ? opts.regionStatus[region] : undefined;
    if (status === 'pulled') { ctx.strokeStyle = '#9fce8f'; ctx.lineWidth = 2; ctx.strokeRect(q.x + 6, q.y + 6, 308, 188); }
    if (opts.flashRegion === region) { ctx.strokeStyle = '#d97b6c'; ctx.lineWidth = 3; ctx.strokeRect(q.x + 6, q.y + 6, 308, 188); }
    ctx.fillStyle = '#d6c694';
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.fillText(q.label, q.x + 12, q.y + 18);
    if (status) {
      ctx.fillStyle = status === 'pulled' ? '#9fce8f' : '#6e6347';
      ctx.fillText(status === 'pulled' ? 'pulled + verified' : 'kept from cache', q.x + 60, q.y + 18);
    }
    // villagers
    const ids = groups[region] ?? [];
    for (let v = 0; v < ids.length; v++) {
      const id = ids[v]!;
      const ent = state.entities[id]!;
      const actor = ent.tags.indexOf('acts_offline') >= 0;
      const vx = q.x + 24 + v * 100;
      const vy = q.y + 44;
      ctx.drawImage(spriteFor(region, actor), vx, vy, 32, 48);
      if (actor) { // offline-actor badge: a coin above the head
        ctx.fillStyle = '#e8c44a';
        ctx.beginPath(); ctx.arc(vx + 16, vy - 8, 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#b6a17a';
      ctx.font = '9px ui-monospace, Consolas, monospace';
      ctx.fillText(id, vx - 8, vy + 62);
      const props = ent.properties;
      ctx.fillStyle = '#8a7c5e';
      ctx.fillText('hp ' + (props['hp'] ?? 0) + '  gold ' + (props['gold'] ?? 0), vx - 8, vy + 74);
    }
  }
  if (opts.suspended) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#d6c694';
    ctx.font = '14px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SUSPENDED - sealed bundle on the shelf', canvas.width / 2, canvas.height / 2 - 6);
    ctx.font = '11px ui-monospace, Consolas, monospace';
    ctx.fillStyle = '#8a7c5e';
    ctx.fillText('snapshot + 2-event HMAC tail + chain seal', canvas.width / 2, canvas.height / 2 + 14);
    ctx.textAlign = 'left';
  }
}

// ---- HUD ----------------------------------------------------------------------

function totals(state: WorldState): { gold: number; hp: number } {
  let gold = 0; let hp = 0;
  for (const id of Object.keys(state.entities)) {
    const props = state.entities[id]!.properties;
    gold += props['gold'] ?? 0;
    hp += props['hp'] ?? 0;
  }
  return { gold, hp };
}

function renderStats(stage: string, state: WorldState, run: ScenarioRun, extra: string): void {
  const t = totals(state);
  stats.textContent =
    'stage  ' + stage + '\n' +
    'epoch  ' + state.epoch + ' / 14\n' +
    'plaza  12 villagers, 4 regions   gold ' + t.gold + '   hp ' + t.hp + '\n' +
    'chain  ' + run.bundle.chainTail.length + ' records, head ' + run.chainHead.slice(0, 16) + '...' +
    (extra ? '\n' + extra : '');
}

function renderChecks(checks: Check[], visible: number): void {
  checksEl.innerHTML = '';
  for (let c = 0; c < checks.length; c++) {
    const li = document.createElement('li');
    const check = checks[c]!;
    if (c < visible) {
      li.className = check.ok ? 'pass' : 'fail';
      li.textContent = check.label;
    } else {
      li.textContent = check.label;
    }
    checksEl.appendChild(li);
  }
}

// ---- boot: compute the proof, then let rAF pace the reveal ---------------------

(async function boot(): Promise<void> {
  const res = await fetch('./vector.json');
  if (!res.ok) throw new Error('vector.json fetch failed: ' + res.status);
  const vec = (await res.json()) as PlazaVector;
  const i = vec.inputs;
  const prefix = i.regionTagPrefix;

  // The deterministic core: run the WHOLE flow twice; both runs must agree
  // byte for byte before anything is shown.
  const run = runScenario(vec);
  const run2 = runScenario(vec);
  const identical = JSON.stringify(run) === JSON.stringify(run2);
  const checks = buildChecks(vec, run, identical);
  const failedCount = checks.filter((c) => !c.ok).length;

  if (failedCount > 0) {
    // A proof, not a printout: fail loudly, show everything, stop.
    renderChecks(checks, checks.length);
    drawWorld(run.resumeStates[run.resumeStates.length - 1] ?? run.s0, prefix, {});
    stats.textContent = 'PROOF FAILED: ' + failedCount + ' of ' + checks.length + ' checks mismatched the pinned vector';
    throw new Error('plaza-persistent proof failed: ' + failedCount + ' check(s) mismatched');
  }

  const pct = (run.bytesPulled / run.bytesFull * 100).toFixed(1);
  const syncLine = 'changed: ' + run.diff.changed.join(', ') + ' (' + run.diff.changed.length + ' of '
    + Object.keys(run.serverLeaves).length + ') - pulled ' + run.syncedPulled.length
    + ', verified leaf+root, skipped ' + run.syncedKept.join(', ') + '\n'
    + 'bytes pulled ' + run.bytesPulled + ' of ' + run.bytesFull + ' (' + pct + '% of a full sync)';
  const finalState = run.resumeStates[run.resumeStates.length - 1]!;
  const regionStatus: Record<string, 'pulled' | 'kept'> = {};
  for (const id of run.syncedPulled) regionStatus[id] = 'pulled';
  for (const id of run.syncedKept) regionStatus[id] = 'kept';

  // Visual timeline (rAF paces the reveal; every value is precomputed above).
  interface Step { at: number; fn: () => void; }
  const steps: Step[] = [];
  steps.push({ at: 0, fn: () => { drawWorld(run.s0, prefix, {}); renderStats('BUILD - the plaza at epoch 0', run.s0, run, ''); renderChecks(checks, 0); } });
  steps.push({ at: 900, fn: () => { drawWorld(run.liveStates[0]!, prefix, {}); renderStats('LIVE PLAY - epoch 1 resolved onto the chain', run.liveStates[0]!, run, ''); renderChecks(checks, 1); } });
  steps.push({ at: 1800, fn: () => { drawWorld(run.liveStates[1]!, prefix, {}); renderStats('LIVE PLAY - epoch 2 resolved onto the chain', run.liveStates[1]!, run, ''); renderChecks(checks, 2); } });
  steps.push({
    at: 2800, fn: () => {
      drawWorld(run.liveStates[1]!, prefix, { suspended: true });
      renderStats('SUSPEND - bundle packed + chain sealed', run.liveStates[1]!, run,
        'seal   count ' + run.seal.count + ', head ' + run.seal.head.slice(0, 16) + '...');
      renderChecks(checks, 5);
    },
  });
  steps.push({
    at: 4600, fn: () => {
      drawWorld(run.resumeStates[0]!, prefix, {});
      renderStats('RESUME - snapshot + tail + seal verified, tail replayed', run.resumeStates[0]!, run, '');
      renderChecks(checks, 6);
    },
  });
  for (let k = 1; k < run.resumeStates.length; k++) {
    const state = run.resumeStates[k]!;
    steps.push({
      at: 4600 + 350 * k, fn: () => {
        drawWorld(state, prefix, {});
        renderStats('RESUME - offline epoch ' + state.epoch + ' replayed (' + k + ' of 12)', state, run, '');
      },
    });
  }
  const afterCatchup = 4600 + 350 * (run.resumeStates.length - 1) + 500;
  steps.push({
    at: afterCatchup, fn: () => {
      drawWorld(finalState, prefix, {});
      renderStats('RESUME COMPLETE - 12 resolved / 0 voided', finalState, run, '');
      renderChecks(checks, 8);
    },
  });
  steps.push({
    at: afterCatchup + 900, fn: () => {
      drawWorld(finalState, prefix, { regionStatus });
      renderStats('PARTIAL SYNC - client pulls only the changed regions', finalState, run, '');
      renderChecks(checks, 11);
      syncEl.className = 'sync ok';
      syncEl.textContent = syncLine;
    },
  });
  steps.push({
    at: afterCatchup + 1700, fn: () => {
      renderChecks(checks, 12);
      renderStats('PROOF COMPLETE - all ' + checks.length + ' checks green', finalState, run, '');
      tamperBtn.style.display = 'inline-block';
    },
  });

  let next = 0;
  let start = -1;
  function frame(now: number): void {
    if (start < 0) start = now;
    const elapsed = now - start;
    while (next < steps.length && steps[next]!.at <= elapsed) {
      steps[next]!.fn();
      next++;
    }
    if (next < steps.length) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // The red path (interactive only): corrupt one pulled region and show the
  // fail-closed rejection.
  tamperBtn.addEventListener('click', () => {
    const tampered = JSON.parse(JSON.stringify(run.pulledRegions)) as Record<string, WorldState>;
    const firstPulled = run.syncedPulled[0]!;
    const region = tampered[firstPulled]!;
    const victim = Object.keys(region.entities).sort()[0]!;
    region.entities[victim]!.properties['gold'] = 9999;
    let rejected = false;
    let message = '';
    try {
      applyPartialSync({ key: i.key, cachedRegions: run.clientRegions, pulledRegions: tampered, serverLeaves: run.serverLeaves, serverRoot: run.serverRoot });
    } catch (err) {
      rejected = true;
      message = err instanceof Error ? err.message : String(err);
    }
    if (!rejected) {
      syncEl.className = 'sync bad';
      syncEl.textContent = 'TAMPER NOT CAUGHT - the fail-closed gate is broken';
      throw new Error('plaza-persistent: tampered pulled region was accepted');
    }
    drawWorld(finalState, prefix, { regionStatus, flashRegion: firstPulled });
    syncEl.className = 'sync bad';
    syncEl.textContent = 'tampered ' + firstPulled + ' pull (gold -> 9999) REJECTED fail-closed:\n' + message;
    window.setTimeout(() => {
      drawWorld(finalState, prefix, { regionStatus });
      syncEl.className = 'sync ok';
      syncEl.textContent = syncLine;
    }, 2600);
  });
})().catch((err) => { stats.textContent = 'boot failed: ' + (err instanceof Error ? err.message : String(err)); });
