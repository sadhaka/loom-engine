// EventBus - typed pub/sub for the Loom Engine.
//
// 0.28.0 enabling primitive. Systems and consumers need to talk to
// each other without each side knowing the other's identity. The
// engine already has a few specialized buses (zone events, plugin
// dispatch, DOM CustomEvents); EventBus is the generic layer for
// anything that doesn't fit those.
//
// Surface:
//   subscribe(topic, handler) -> unsubscribe()
//   once(topic, handler) -> unsubscribe()
//   publish(topic, data?)
//   off(topic)
//   clear()
//   topics()
//   handlerCount(topic)
//
// Errors in handlers are caught + logged (not thrown to publish()
// callers) so a buggy subscriber cannot break a publisher mid-loop.
// Handlers added DURING a publish() call do NOT fire for that same
// publish (snapshot semantics); they fire on subsequent publishes.
export class EventBus {
    subscribers = new Map();
    nextId = 1;
    publishCount = 0;
    deliveredCount = 0;
    // Subscribe to a topic. Returns a function that unsubscribes when
    // called. The returned function is idempotent (calling twice is a
    // no-op).
    subscribe(topic, handler) {
        return this.add(topic, handler, false);
    }
    // Subscribe for a single fire. The handler is auto-removed after
    // the first publish call delivers to it.
    once(topic, handler) {
        return this.add(topic, handler, true);
    }
    // Internal add path. Returns the unsubscribe function.
    add(topic, fn, once) {
        var t = String(topic);
        var list = this.subscribers.get(t);
        if (!list) {
            list = [];
            this.subscribers.set(t, list);
        }
        var entry = {
            fn: fn,
            once: once,
            id: this.nextId++,
        };
        list.push(entry);
        var bus = this;
        var unsubscribed = false;
        return function unsubscribe() {
            if (unsubscribed)
                return;
            unsubscribed = true;
            var current = bus.subscribers.get(t);
            if (!current)
                return;
            for (var i = 0; i < current.length; i++) {
                if (current[i] === entry) {
                    current.splice(i, 1);
                    break;
                }
            }
            if (current.length === 0)
                bus.subscribers.delete(t);
        };
    }
    // Fire data at every subscriber of `topic`. Snapshot semantics:
    // the list of handlers that fire is captured BEFORE delivery, so
    // a handler that subscribes mid-publish does not see this same
    // publish. once-subscribers are removed after delivery.
    publish(topic, data) {
        this.publishCount++;
        var t = String(topic);
        var list = this.subscribers.get(t);
        if (!list || list.length === 0)
            return;
        // Snapshot to a fresh array so adds / removes during delivery
        // don't affect this publish.
        var snapshot = list.slice();
        var toRemove = [];
        for (var i = 0; i < snapshot.length; i++) {
            var entry = snapshot[i];
            if (!entry)
                continue;
            try {
                entry.fn(data);
                this.deliveredCount++;
            }
            catch (e) {
                try {
                    console.error('[EventBus] handler for "' + t + '" threw:', e);
                }
                catch { /* ignore */ }
            }
            if (entry.once)
                toRemove.push(entry);
        }
        if (toRemove.length > 0) {
            var current = this.subscribers.get(t);
            if (current) {
                for (var j = 0; j < toRemove.length; j++) {
                    var idx = current.indexOf(toRemove[j]);
                    if (idx >= 0)
                        current.splice(idx, 1);
                }
                if (current.length === 0)
                    this.subscribers.delete(t);
            }
        }
    }
    // Drop every subscriber of a single topic.
    off(topic) {
        this.subscribers.delete(String(topic));
    }
    // Drop every subscriber of every topic.
    clear() {
        this.subscribers.clear();
    }
    // Snapshot of currently-subscribed topic names.
    topics() {
        var out = [];
        for (var k of this.subscribers.keys())
            out.push(k);
        return out;
    }
    // How many handlers are currently registered for `topic`. 0 if
    // the topic is unknown.
    handlerCount(topic) {
        var list = this.subscribers.get(String(topic));
        return list ? list.length : 0;
    }
    // Diagnostic counters.
    stats() {
        return {
            publishCount: this.publishCount,
            deliveredCount: this.deliveredCount,
            topicCount: this.subscribers.size,
        };
    }
}
// Resource key for the world-attached bus.
export const RESOURCE_EVENT_BUS = 'loom.event_bus';
//# sourceMappingURL=event-bus.js.map