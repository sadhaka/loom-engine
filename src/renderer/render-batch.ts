// RenderBatch - groups sprite draw submissions by (layer, atlas)
// for batched issue at end-of-frame.
//
// 0.23.0 enabling primitive. Today's render systems call
// device.drawSprite per-entity directly; the cost is negligible on
// Canvas2D (no real state machine) but compounds on a future WebGL2
// renderer where each drawSprite would otherwise mean a separate
// uniform/texture binding pair. RenderBatch lets a system accumulate
// per-frame submissions, sort or group as it sees fit, then issue
// flushTo() once - the device sees consecutive same-atlas draws.
//
// Shape:
//   batch.submit(layer, atlas, frame, x, y, z, tint?)
//   batch.flushTo(device, callback)
//   batch.clear()
//
// Layers: a layer is just an integer ordering key. Lower layers
// flush first; ties broken by submission order. Atlas grouping
// inside a layer is by reference equality; consumers using a string
// atlas id can pass the same string instance.
//
// Code style: var / class fields, no template literals.

// One queued draw submission. Tint optional; null encodes "no tint".
interface BatchEntry {
  frame: number;
  x: number;
  y: number;
  z: number;
  tintR: number;
  tintG: number;
  tintB: number;
  tintA: number;
  hasTint: boolean;
}

interface AtlasGroup {
  atlas: unknown;
  entries: BatchEntry[];
}

interface LayerBucket {
  layer: number;
  // Groups in submission order. Two non-adjacent submissions with the
  // same atlas land in DIFFERENT groups so a drawing system that
  // cares about painter order does not get re-ordered surprises.
  groups: AtlasGroup[];
}

// Callback signature for flushTo. The consumer iterates entries in
// submission order and translates them to whatever underlying API.
export type BatchFlushCallback = (
  layer: number,
  atlas: unknown,
  entries: ReadonlyArray<{
    frame: number;
    x: number;
    y: number;
    z: number;
    hasTint: boolean;
    tintR: number;
    tintG: number;
    tintB: number;
    tintA: number;
  }>,
) => void;

export class RenderBatch {
  private buckets: Map<number, LayerBucket> = new Map();
  private layerOrder: number[] = [];
  // Stats for tests + diagnostics.
  private submitCount: number = 0;
  private flushCount: number = 0;

  // Append a draw to (layer, atlas). If the previous entry in the
  // layer was for the same atlas (reference equality), it merges
  // into the same group; otherwise a new group starts. This keeps
  // painter order while still amortising same-atlas runs.
  submit(
    layer: number,
    atlas: unknown,
    frame: number,
    x: number,
    y: number,
    z: number,
    tint?: { r: number; g: number; b: number; a: number },
  ): void {
    var ly = layer | 0;
    var bucket = this.buckets.get(ly);
    if (!bucket) {
      bucket = { layer: ly, groups: [] };
      this.buckets.set(ly, bucket);
      this.layerOrder.push(ly);
      // Keep layerOrder sorted ascending; insertion is rare per
      // frame relative to per-entity submits.
      this.layerOrder.sort(function (a, b) { return a - b; });
    }
    var lastGroup: AtlasGroup | undefined =
      bucket.groups.length > 0
        ? bucket.groups[bucket.groups.length - 1]
        : undefined;
    var group: AtlasGroup;
    if (lastGroup && lastGroup.atlas === atlas) {
      group = lastGroup;
    } else {
      group = { atlas: atlas, entries: [] };
      bucket.groups.push(group);
    }
    var hasTint = !!tint;
    group.entries.push({
      frame: frame | 0,
      x: +x,
      y: +y,
      z: +z,
      hasTint: hasTint,
      tintR: hasTint ? +tint!.r : 1,
      tintG: hasTint ? +tint!.g : 1,
      tintB: hasTint ? +tint!.b : 1,
      tintA: hasTint ? +tint!.a : 1,
    });
    this.submitCount++;
  }

  // Drain the batch by calling `cb(layer, atlas, entries)` for each
  // group, in layer-ascending order then submission order. After
  // flush, the batch is empty; submit can begin filling for the next
  // frame.
  flushTo(_device: unknown, cb: BatchFlushCallback): void {
    for (var i = 0; i < this.layerOrder.length; i++) {
      var ly = this.layerOrder[i];
      if (ly === undefined) continue;
      var bucket = this.buckets.get(ly);
      if (!bucket) continue;
      for (var g = 0; g < bucket.groups.length; g++) {
        var group = bucket.groups[g];
        if (!group) continue;
        cb(ly, group.atlas, group.entries);
      }
    }
    this.flushCount++;
    this.clear();
  }

  // Discard everything queued so far without flushing. Used between
  // frames if a render is skipped (paused tab, off-screen) so the
  // queue does not grow unbounded.
  clear(): void {
    this.buckets.clear();
    this.layerOrder.length = 0;
  }

  // Diagnostic counters.
  stats(): {
    submits: number;
    flushes: number;
    layersQueued: number;
    groupsQueued: number;
    entriesQueued: number;
  } {
    var groupsQueued = 0;
    var entriesQueued = 0;
    for (var i = 0; i < this.layerOrder.length; i++) {
      var ly = this.layerOrder[i];
      if (ly === undefined) continue;
      var bucket = this.buckets.get(ly);
      if (!bucket) continue;
      groupsQueued += bucket.groups.length;
      for (var g = 0; g < bucket.groups.length; g++) {
        var group = bucket.groups[g];
        if (group) entriesQueued += group.entries.length;
      }
    }
    return {
      submits: this.submitCount,
      flushes: this.flushCount,
      layersQueued: this.layerOrder.length,
      groupsQueued: groupsQueued,
      entriesQueued: entriesQueued,
    };
  }
}

// Standard layer constants. Render systems can use any integer; these
// are conventions to keep the demo's painter order legible.
export const RENDER_LAYER_BACKGROUND = -100;
export const RENDER_LAYER_TERRAIN = 0;
export const RENDER_LAYER_ENTITIES = 100;
export const RENDER_LAYER_FX = 200;
export const RENDER_LAYER_HUD = 1000;

// Resource key for a world-attached batch instance.
export const RESOURCE_RENDER_BATCH = 'loom.render_batch';
