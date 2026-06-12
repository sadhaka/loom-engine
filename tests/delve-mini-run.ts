// Loom Engine - Delve Mini: a SEEDED ROGUELIKE RUN.
//
// One shareable seed drives a whole crawl, chaining engine primitives that
// already existed in isolation into a single deterministic pipeline:
//
//   DungeonGenerator (BSP)  -> rooms + corridors from the seed
//   bestiary                -> one creature per room (last room = the boss)
//   TileMap                 -> entities placed at room centres
//   Pcg32                   -> seeded, surface-stable combat dice
//   LootTable               -> drops on each kill
//   InventoryGrid           -> the satchel that holds them
//   (SaveSlots + Leaderboard wrap the run - see tests/delve-mini.test.ts)
//
// The pitch no other JS/Python engine can make: SAME SEED = SAME DUNGEON =
// SAME RUN, byte for byte, every time. runDelve() is pure and synchronous;
// the test runs it twice and asserts the results are identical and match a
// pinned fingerprint, and the browser demo renders the very same result.

// Imports from src so the headless proof in tests/delve-mini.test.ts exercises
// the SAME engine the rest of npm test does (the browser visual is a follow-up;
// see README). The package specifier only resolves under the demo importmap.
import {
  DungeonGenerator,
  TileMap,
  LootTable,
  InventoryGrid,
  Pcg32,
  CREATURE_CATALOG,
  getSpec,
  canonicalJson,
  type DungeonResult,
} from '../src/index.js';

// fnv1a: a tiny deterministic string hash. Used only to (a) derive a distinct
// sub-seed per subsystem from the master seed and (b) fingerprint a run for the
// determinism assertion - never for security.
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface DelveRoomLog {
  room: number;
  creatureId: string;
  creatureName: string;
  tier: number;
  isBoss: boolean;
  outcome: 'cleared' | 'died';
  playerHpAfter: number;
  rounds: number;
  drops: { itemId: string; count: number }[];
}

export interface DelveResult {
  seed: string;
  width: number;
  height: number;
  floorTiles: number;
  roomCount: number;
  // fnv1a over every room-centre marker READ BACK through TileMap.get - the
  // tile-map stage is part of the fingerprinted chain, not just populated and
  // discarded (3.1.0 release audit: a no-op set() must change the fingerprint).
  mapChecksum: number;
  rooms: DelveRoomLog[];
  roomsCleared: number;
  died: boolean;
  finalPlayerHp: number;
  inventory: { itemId: string; count: number }[];
  lootValue: number;
  score: number;
}

// A small, fixed loot table - itemId -> coarse value used to score a run.
const LOOT_VALUE: Record<string, number> = {
  copper: 1, silver: 5, gold: 25, gem: 60, relic: 150, potion: 12,
};

function lootTableFor(seedNum: number): LootTable {
  return LootTable.create({
    seed: seedNum,
    rollCount: 1,
    entries: [
      { itemId: 'copper', weight: 40, countRange: [1, 6] },
      { itemId: 'silver', weight: 25, countRange: [1, 3] },
      { itemId: 'gold', weight: 14, countRange: [1, 2] },
      { itemId: 'potion', weight: 12 },
      { itemId: 'gem', weight: 6 },
      { itemId: 'relic', weight: 3 },
    ],
  });
}

// Tier -> creature max HP. Deterministic; the bestiary spec carries a tier
// band, not HP, so the run derives a stable HP curve from it.
function hpForTier(tier: number): number {
  return 6 + tier * 7;
}

// The player: fixed starting kit, so the only variation across runs is the seed.
const PLAYER_MAX_HP = 34;
const PLAYER_ATK_BONUS = 5;
const PLAYER_DMG_DIE = 8;
const PLAYER_DMG_BONUS = 3;
const CREATURE_AC = 11;
const PLAYER_AC = 14;

// Resolve ONE room's fight, fully deterministically off the shared combat rng.
// Returns the room log; mutates nothing outside the returned value + the rng /
// inventory the caller threads in.
function fight(
  roomIndex: number,
  isBoss: boolean,
  combat: Pcg32,
  loot: LootTable,
  satchel: InventoryGrid,
  playerHp: number,
): { log: DelveRoomLog; playerHp: number; lootValue: number } {
  // Pick a creature deterministically. The boss room always takes the
  // highest-tier catalogue entry; other rooms roll within the catalogue.
  let variant: number;
  if (isBoss) {
    variant = 0;
    for (let i = 1; i < CREATURE_CATALOG.length; i++) {
      const s = CREATURE_CATALOG[i];
      const best = CREATURE_CATALOG[variant];
      if (s && best && s.tier > best.tier) variant = i;
    }
  } else {
    variant = combat.rollDie(CREATURE_CATALOG.length) - 1;
  }
  const spec = getSpec(variant);
  const creatureId = spec ? spec.id : 'unknown';
  const creatureName = spec ? spec.displayName : 'Unknown';
  const tier = spec ? spec.tier : 1;

  let creatureHp = hpForTier(tier) + (isBoss ? 20 : 0);
  let rounds = 0;
  const drops: { itemId: string; count: number }[] = [];
  let lootValue = 0;

  // Initiative is fixed (player first) - the dice variety lives in the rolls.
  while (creatureHp > 0 && playerHp > 0 && rounds < 100) {
    rounds++;
    // Player swings.
    const pHit = combat.rollDie(20) + PLAYER_ATK_BONUS;
    if (pHit >= CREATURE_AC) {
      creatureHp -= combat.rollDie(PLAYER_DMG_DIE) + PLAYER_DMG_BONUS;
    }
    if (creatureHp <= 0) break;
    // Creature swings back.
    const cHit = combat.rollDie(20) + tier;
    if (cHit >= PLAYER_AC) {
      playerHp -= combat.rollDie(6) + tier;
    }
  }

  if (playerHp <= 0) {
    return {
      log: {
        room: roomIndex, creatureId, creatureName, tier, isBoss,
        outcome: 'died', playerHpAfter: 0, rounds, drops,
      },
      playerHp: 0, lootValue: 0,
    };
  }

  // Kill -> roll loot, fold into the satchel, value it.
  const rolled = loot.roll();
  for (let i = 0; i < rolled.length; i++) {
    const d = rolled[i];
    if (!d) continue;
    const res = satchel.add(d.itemId, d.count);
    if (res.added > 0) {
      drops.push({ itemId: d.itemId, count: res.added });
      lootValue += (LOOT_VALUE[d.itemId] || 0) * res.added;
    }
  }

  return {
    log: {
      room: roomIndex, creatureId, creatureName, tier, isBoss,
      outcome: 'cleared', playerHpAfter: playerHp, rounds, drops,
    },
    playerHp, lootValue,
  };
}

// Run a whole delve from one seed. Pure + synchronous + deterministic.
export function runDelve(seed: string | number): DelveResult {
  const seedStr = String(seed);
  const base = fnv1a(seedStr);

  // 1. The dungeon - rooms + corridors from the seed.
  const dungeon: DungeonResult = DungeonGenerator.create({
    width: 48, height: 32, seed: seedStr, minLeafSize: 8, maxDepth: 5,
  }).generate();
  let floorTiles = 0;
  for (let i = 0; i < dungeon.tiles.length; i++) {
    if (dungeon.tiles[i] === 1) floorTiles++;
  }

  // 2. The tile map - place an entity at each room centre (spawn + foes), then
  // READ each marker back through TileMap.get and fold (x, y, value) into a
  // checksum carried on the result. 3.1.0 release audit LOW: the map used to be
  // populated and discarded, so a no-op set() could not change the fingerprint;
  // now the tile-map stage is genuinely part of the proved chain.
  const map = TileMap.create({ width: dungeon.width, height: dungeon.height });
  let mapChecksum = 0;
  for (let r = 0; r < dungeon.rooms.length; r++) {
    const room = dungeon.rooms[r];
    if (!room) continue;
    const cx = room.x + (room.w >> 1);
    const cy = room.y + (room.h >> 1);
    map.set(cx, cy, r === 0 ? 2 : 3); // 2 = spawn, 3 = foe marker
    mapChecksum = fnv1a(
      mapChecksum.toString(16) + ':' + cx + ',' + cy + '=' + map.get(cx, cy));
  }

  // 3-6. Walk the rooms after the spawn, fighting + looting off shared rngs.
  const combat = Pcg32.seeded(BigInt(fnv1a(seedStr + ':combat')));
  const loot = lootTableFor(fnv1a(seedStr + ':loot'));
  const satchel = InventoryGrid.create({
    capacity: 24,
    itemInfo: function () { return { maxStack: 99 }; },
  });

  const rooms: DelveRoomLog[] = [];
  let playerHp = PLAYER_MAX_HP;
  let lootValue = 0;
  let died = false;
  let roomsCleared = 0;

  const lastIndex = dungeon.rooms.length - 1;
  for (let r = 1; r < dungeon.rooms.length; r++) {
    const isBoss = r === lastIndex;
    const res = fight(r, isBoss, combat, loot, satchel, playerHp);
    rooms.push(res.log);
    playerHp = res.playerHp;
    lootValue += res.lootValue;
    if (res.log.outcome === 'died') { died = true; break; }
    roomsCleared++;
  }

  // 7. The final satchel + score. toSnapshot() is the stable slot view.
  const inv: { itemId: string; count: number }[] = [];
  const snap = satchel.toSnapshot();
  for (let i = 0; i < snap.length; i++) {
    const s = snap[i];
    if (s) inv.push({ itemId: s.itemId, count: s.count });
  }
  const depthBonus = died ? 0 : 250; // reaching the boss alive
  const score = roomsCleared * 100 + lootValue + depthBonus;

  return {
    seed: seedStr,
    width: dungeon.width,
    height: dungeon.height,
    floorTiles,
    roomCount: dungeon.rooms.length,
    mapChecksum,
    rooms,
    roomsCleared,
    died,
    finalPlayerHp: playerHp,
    inventory: inv,
    lootValue,
    score,
  };
}

// A stable fingerprint of a run - the canonical JSON hashed with fnv1a. Two
// runs of the same seed MUST share this; the test pins it as a regression.
export function delveFingerprint(result: DelveResult): string {
  const canon = canonicalJson(result as unknown as Record<string, unknown>);
  return ('0000000' + fnv1a(canon).toString(16)).slice(-8);
}
