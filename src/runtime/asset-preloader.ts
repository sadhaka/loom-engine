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

export interface AssetEntry {
  id: string;
  loader: () => Promise<unknown>;
  // Result populated after the loader resolves. null if the loader
  // failed (see AssetPreloaderEvents.error).
  result: unknown;
}

export interface AssetProgressEvent {
  completed: number;
  total: number;
  // 0..1.
  fraction: number;
}

export interface AssetLoadedEvent {
  id: string;
  result: unknown;
}

export interface AssetErrorEvent {
  id: string;
  error: unknown;
}

export interface AssetDoneEvent {
  total: number;
  succeeded: number;
  failed: number;
  errors: ReadonlyArray<AssetErrorEvent>;
}

type Listener<T> = (data: T) => void;

export class AssetPreloader {
  private entries: AssetEntry[] = [];
  private started: boolean = false;
  private completed: number = 0;
  private succeeded: number = 0;
  private failed: number = 0;
  private errors: AssetErrorEvent[] = [];

  private progressListeners: Listener<AssetProgressEvent>[] = [];
  private assetListeners: Listener<AssetLoadedEvent>[] = [];
  private errorListeners: Listener<AssetErrorEvent>[] = [];
  private doneListeners: Listener<AssetDoneEvent>[] = [];

  // Add an asset to the queue. ids must be unique; duplicate ids
  // throw immediately. Throws if start() has already been called -
  // the queue is frozen at that point.
  add(id: string, loader: () => Promise<unknown>): void {
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
      if (this.entries[i]!.id === id) {
        throw new Error('AssetPreloader.add: duplicate id "' + id + '"');
      }
    }
    this.entries.push({ id: id, loader: loader, result: null });
  }

  // Listen for events. Returns an unsubscribe function. The handler
  // signature varies by type; in TypeScript callers can cast or use
  // the typed helpers below for ergonomics.
  on(
    type: 'progress' | 'asset' | 'error' | 'done',
    handler: (data: unknown) => void,
  ): () => void {
    var list: Listener<unknown>[];
    if (type === 'progress') list = this.progressListeners as unknown as Listener<unknown>[];
    else if (type === 'asset') list = this.assetListeners as unknown as Listener<unknown>[];
    else if (type === 'error') list = this.errorListeners as unknown as Listener<unknown>[];
    else if (type === 'done') list = this.doneListeners as unknown as Listener<unknown>[];
    else throw new Error('AssetPreloader.on: unknown event type "' + (type as string) + '"');
    list.push(handler);
    return function () {
      var idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    };
  }

  // Typed helpers - ergonomic per-event subscribers.
  onProgress(handler: Listener<AssetProgressEvent>): () => void {
    return this.on('progress', handler as Listener<unknown>);
  }
  onAsset(handler: Listener<AssetLoadedEvent>): () => void {
    return this.on('asset', handler as Listener<unknown>);
  }
  onError(handler: Listener<AssetErrorEvent>): () => void {
    return this.on('error', handler as Listener<unknown>);
  }
  onDone(handler: Listener<AssetDoneEvent>): () => void {
    return this.on('done', handler as Listener<unknown>);
  }

  // Start loading. Idempotent: a second start() is a no-op.
  // Returns a promise that resolves with the AssetDoneEvent.
  start(): Promise<AssetDoneEvent> {
    if (this.started) {
      // Already started; return a promise that resolves on the
      // existing 'done' event (or immediately if already done).
      return new Promise<AssetDoneEvent>((resolve) => {
        if (this.completed === this.entries.length) {
          resolve(this.buildDone());
        } else {
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
    return new Promise<AssetDoneEvent>((resolve) => {
      bus2.onDone(function (ev) { resolve(ev); });
      for (var i = 0; i < bus2.entries.length; i++) {
        var entry = bus2.entries[i]!;
        bus2.runEntry(entry);
      }
    });
  }

  // Diagnostic counts.
  stats(): {
    total: number;
    completed: number;
    succeeded: number;
    failed: number;
    started: boolean;
  } {
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
  get(id: string): unknown {
    for (var i = 0; i < this.entries.length; i++) {
      if (this.entries[i]!.id === id) return this.entries[i]!.result;
    }
    return undefined;
  }

  // ----- Internal -----

  private runEntry(entry: AssetEntry): void {
    var bus = this;
    Promise.resolve().then(() => entry.loader()).then(
      (result) => {
        entry.result = result;
        bus.succeeded++;
        bus.fireAsset({ id: entry.id, result: result });
        bus.tickProgress();
      },
      (err) => {
        entry.result = null;
        bus.failed++;
        var errEv: AssetErrorEvent = { id: entry.id, error: err };
        bus.errors.push(errEv);
        bus.fireError(errEv);
        bus.tickProgress();
      },
    );
  }

  private tickProgress(): void {
    this.completed++;
    var total = this.entries.length;
    var ev: AssetProgressEvent = {
      completed: this.completed,
      total: total,
      fraction: total > 0 ? this.completed / total : 1,
    };
    this.fireProgress(ev);
    if (this.completed >= total) {
      this.fireDone(this.buildDone());
    }
  }

  private buildDone(): AssetDoneEvent {
    return {
      total: this.entries.length,
      succeeded: this.succeeded,
      failed: this.failed,
      errors: this.errors.slice(),
    };
  }

  private fireProgress(ev: AssetProgressEvent): void {
    var snap = this.progressListeners.slice();
    for (var i = 0; i < snap.length; i++) {
      try { snap[i]!(ev); } catch (e) { logHandlerErr('progress', e); }
    }
  }

  private fireAsset(ev: AssetLoadedEvent): void {
    var snap = this.assetListeners.slice();
    for (var i = 0; i < snap.length; i++) {
      try { snap[i]!(ev); } catch (e) { logHandlerErr('asset', e); }
    }
  }

  private fireError(ev: AssetErrorEvent): void {
    var snap = this.errorListeners.slice();
    for (var i = 0; i < snap.length; i++) {
      try { snap[i]!(ev); } catch (e) { logHandlerErr('error', e); }
    }
  }

  private fireDone(ev: AssetDoneEvent): void {
    var snap = this.doneListeners.slice();
    for (var i = 0; i < snap.length; i++) {
      try { snap[i]!(ev); } catch (e) { logHandlerErr('done', e); }
    }
  }
}

function logHandlerErr(eventType: string, e: unknown): void {
  try {
    console.error('[AssetPreloader] handler for "' + eventType + '" threw:', e);
  } catch { /* ignore */ }
}

// Resource key for the world-attached preloader.
export const RESOURCE_ASSET_PRELOADER = 'loom.asset_preloader';
