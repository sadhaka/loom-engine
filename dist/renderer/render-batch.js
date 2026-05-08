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
export class RenderBatch {
    buckets = new Map();
    layerOrder = [];
    // Stats for tests + diagnostics.
    submitCount = 0;
    flushCount = 0;
    // Append a draw to (layer, atlas). If the previous entry in the
    // layer was for the same atlas (reference equality), it merges
    // into the same group; otherwise a new group starts. This keeps
    // painter order while still amortising same-atlas runs.
    submit(layer, atlas, frame, x, y, z, tint) {
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
        var lastGroup = bucket.groups.length > 0
            ? bucket.groups[bucket.groups.length - 1]
            : undefined;
        var group;
        if (lastGroup && lastGroup.atlas === atlas) {
            group = lastGroup;
        }
        else {
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
            tintR: hasTint ? +tint.r : 1,
            tintG: hasTint ? +tint.g : 1,
            tintB: hasTint ? +tint.b : 1,
            tintA: hasTint ? +tint.a : 1,
        });
        this.submitCount++;
    }
    // Drain the batch by calling `cb(layer, atlas, entries)` for each
    // group, in layer-ascending order then submission order. After
    // flush, the batch is empty; submit can begin filling for the next
    // frame.
    flushTo(_device, cb) {
        for (var i = 0; i < this.layerOrder.length; i++) {
            var ly = this.layerOrder[i];
            if (ly === undefined)
                continue;
            var bucket = this.buckets.get(ly);
            if (!bucket)
                continue;
            for (var g = 0; g < bucket.groups.length; g++) {
                var group = bucket.groups[g];
                if (!group)
                    continue;
                cb(ly, group.atlas, group.entries);
            }
        }
        this.flushCount++;
        this.clear();
    }
    // Discard everything queued so far without flushing. Used between
    // frames if a render is skipped (paused tab, off-screen) so the
    // queue does not grow unbounded.
    clear() {
        this.buckets.clear();
        this.layerOrder.length = 0;
    }
    // Diagnostic counters.
    stats() {
        var groupsQueued = 0;
        var entriesQueued = 0;
        for (var i = 0; i < this.layerOrder.length; i++) {
            var ly = this.layerOrder[i];
            if (ly === undefined)
                continue;
            var bucket = this.buckets.get(ly);
            if (!bucket)
                continue;
            groupsQueued += bucket.groups.length;
            for (var g = 0; g < bucket.groups.length; g++) {
                var group = bucket.groups[g];
                if (group)
                    entriesQueued += group.entries.length;
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
//# sourceMappingURL=render-batch.js.map