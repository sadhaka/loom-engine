// AssetPreloader - declarative asset loading with progress events.
//
// 0.34.0 enabling primitive. The engine has src/asset/* helpers for
// individual asset kinds (images, sprite sheets, audio buffers).
// AssetPreloader bundles them into a declarative manifest the
// consumer hands over once + listens for progress events. Useful
// for a loading screen.
//
// Surface:
//   var pre = new AssetPreloader();
//   pre.add('hero', () => fetch('/img/hero.png').then(...));
//   pre.add('music', () => loadAudio('/snd/loom.ogg'));
//   pre.on('progress', (data) => updateBar(data.completed, data.total));
//   pre.on('asset', (data) => log('loaded', data.id));
//   pre.on('error', (data) => log('failed', data.id, data.error));
//   pre.on('done', () => startGame());
//   pre.start();
//
// Loaders return Promises; the preloader counts completion + emits
// events. Failures don't halt the queue - all assets attempt; the
// 'done' event fires once every loader settles, with `errors[]`
// populated if any failed.
export class AssetPreloader {
    entries = [];
    started = false;
    completed = 0;
    succeeded = 0;
    failed = 0;
    errors = [];
    progressListeners = [];
    assetListeners = [];
    errorListeners = [];
    doneListeners = [];
    // Add an asset to the queue. ids must be unique; duplicate ids
    // throw immediately. Throws if start() has already been called -
    // the queue is frozen at that point.
    add(id, loader) {
        if (this.started) {
            throw new Error('AssetPreloader.add: cannot add after start()');
        }
        if (typeof id !== 'string' || id.length === 0) {
            throw new Error('AssetPreloader.add: id must be a non-empty string');
        }
        if (typeof loader !== 'function') {
            throw new Error('AssetPreloader.add: loader must be a function');
        }
        for (var i = 0; i < this.entries.length; i++) {
            if (this.entries[i].id === id) {
                throw new Error('AssetPreloader.add: duplicate id "' + id + '"');
            }
        }
        this.entries.push({ id: id, loader: loader, result: null });
    }
    // Listen for events. Returns an unsubscribe function. The handler
    // signature varies by type; in TypeScript callers can cast or use
    // the typed helpers below for ergonomics.
    on(type, handler) {
        var list;
        if (type === 'progress')
            list = this.progressListeners;
        else if (type === 'asset')
            list = this.assetListeners;
        else if (type === 'error')
            list = this.errorListeners;
        else if (type === 'done')
            list = this.doneListeners;
        else
            throw new Error('AssetPreloader.on: unknown event type "' + type + '"');
        list.push(handler);
        return function () {
            var idx = list.indexOf(handler);
            if (idx >= 0)
                list.splice(idx, 1);
        };
    }
    // Typed helpers - ergonomic per-event subscribers.
    onProgress(handler) {
        return this.on('progress', handler);
    }
    onAsset(handler) {
        return this.on('asset', handler);
    }
    onError(handler) {
        return this.on('error', handler);
    }
    onDone(handler) {
        return this.on('done', handler);
    }
    // Start loading. Idempotent: a second start() is a no-op.
    // Returns a promise that resolves with the AssetDoneEvent.
    start() {
        if (this.started) {
            // Already started; return a promise that resolves on the
            // existing 'done' event (or immediately if already done).
            return new Promise((resolve) => {
                if (this.completed === this.entries.length) {
                    resolve(this.buildDone());
                }
                else {
                    this.onDone(function (ev) { resolve(ev); });
                }
            });
        }
        this.started = true;
        var total = this.entries.length;
        if (total === 0) {
            var done = this.buildDone();
            // Fire done synchronously in a microtask so listeners attached
            // before start() have a consistent observation order.
            var bus = this;
            return Promise.resolve().then(() => {
                bus.fireDone(done);
                return done;
            });
        }
        // Fire each loader; track completion count.
        var bus2 = this;
        return new Promise((resolve) => {
            bus2.onDone(function (ev) { resolve(ev); });
            for (var i = 0; i < bus2.entries.length; i++) {
                var entry = bus2.entries[i];
                bus2.runEntry(entry);
            }
        });
    }
    // Diagnostic counts.
    stats() {
        return {
            total: this.entries.length,
            completed: this.completed,
            succeeded: this.succeeded,
            failed: this.failed,
            started: this.started,
        };
    }
    // Fetch a successful result by id (after start + done). Returns
    // undefined if the asset failed or hasn't loaded yet.
    get(id) {
        for (var i = 0; i < this.entries.length; i++) {
            if (this.entries[i].id === id)
                return this.entries[i].result;
        }
        return undefined;
    }
    // ----- Internal -----
    runEntry(entry) {
        var bus = this;
        Promise.resolve().then(() => entry.loader()).then((result) => {
            entry.result = result;
            bus.succeeded++;
            bus.fireAsset({ id: entry.id, result: result });
            bus.tickProgress();
        }, (err) => {
            entry.result = null;
            bus.failed++;
            var errEv = { id: entry.id, error: err };
            bus.errors.push(errEv);
            bus.fireError(errEv);
            bus.tickProgress();
        });
    }
    tickProgress() {
        this.completed++;
        var total = this.entries.length;
        var ev = {
            completed: this.completed,
            total: total,
            fraction: total > 0 ? this.completed / total : 1,
        };
        this.fireProgress(ev);
        if (this.completed >= total) {
            this.fireDone(this.buildDone());
        }
    }
    buildDone() {
        return {
            total: this.entries.length,
            succeeded: this.succeeded,
            failed: this.failed,
            errors: this.errors.slice(),
        };
    }
    fireProgress(ev) {
        var snap = this.progressListeners.slice();
        for (var i = 0; i < snap.length; i++) {
            try {
                snap[i](ev);
            }
            catch (e) {
                logHandlerErr('progress', e);
            }
        }
    }
    fireAsset(ev) {
        var snap = this.assetListeners.slice();
        for (var i = 0; i < snap.length; i++) {
            try {
                snap[i](ev);
            }
            catch (e) {
                logHandlerErr('asset', e);
            }
        }
    }
    fireError(ev) {
        var snap = this.errorListeners.slice();
        for (var i = 0; i < snap.length; i++) {
            try {
                snap[i](ev);
            }
            catch (e) {
                logHandlerErr('error', e);
            }
        }
    }
    fireDone(ev) {
        var snap = this.doneListeners.slice();
        for (var i = 0; i < snap.length; i++) {
            try {
                snap[i](ev);
            }
            catch (e) {
                logHandlerErr('done', e);
            }
        }
    }
}
function logHandlerErr(eventType, e) {
    try {
        console.error('[AssetPreloader] handler for "' + eventType + '" threw:', e);
    }
    catch { /* ignore */ }
}
// Resource key for the world-attached preloader.
export const RESOURCE_ASSET_PRELOADER = 'loom.asset_preloader';
//# sourceMappingURL=asset-preloader.js.map