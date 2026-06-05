// ChatChannel - moderated channels with rate limit + filter hooks.
//
// 1.7.5 MILESTONE primitive (Wave 1.7 networking complete).
// "Multi-channel chat with safety rails." Each channel has a member
// roster, a rolling message history, per-sender rate limits, and
// pluggable filter functions (consumer-supplied predicates that
// either pass / drop / replace a message).
//
//   var chat = ChatChannel.create({
//     id: 'global',
//     historySize: 100,
//     rateLimitMessages: 5,
//     rateLimitWindowMs: 10000,
//   });
//
//   chat.join('alice', 1000);
//   chat.join('bob',   1000);
//
//   chat.send('alice', 'hello world', 1100);
//   // -> { ok: true, message: { id: 1, sender: 'alice', body: 'hello world', sentAt: 1100 } }
//
//   chat.send('alice', 'spam-spam-spam', 1110);
//   // (after rateLimitMessages exceeded) -> { ok: false, reason: 'rate-limit' }
//
//   chat.installFilter(function (msg) {
//     if (/badword/i.test(msg.body)) return null;  // drop
//     return msg;  // pass
//   });
//
// Multiple parallel channels via a ChatChannelRegistry below; each
// channel is independent (own membership, own rate limits, own
// history). Adapters wire the JSON message protocol to whatever
// transport carries chat (WebSocket typically, SSE possible).
//
// Code style: var-only in browser source.
export class ChatChannel {
    channelId;
    members = new Map();
    history = [];
    filters = [];
    historySize;
    rateLimitMessages;
    rateLimitWindowMs;
    maxBodyLen;
    nextMessageId = 1;
    constructor(opts) {
        if (typeof opts.id !== 'string' || opts.id.length === 0) {
            throw new Error('ChatChannel: id is required');
        }
        this.channelId = opts.id;
        this.historySize = (typeof opts.historySize === 'number' && opts.historySize > 0)
            ? Math.floor(opts.historySize) : 100;
        this.rateLimitMessages = (typeof opts.rateLimitMessages === 'number' && opts.rateLimitMessages > 0)
            ? Math.floor(opts.rateLimitMessages) : 5;
        this.rateLimitWindowMs = (typeof opts.rateLimitWindowMs === 'number' && opts.rateLimitWindowMs > 0)
            ? opts.rateLimitWindowMs : 10000;
        this.maxBodyLen = (typeof opts.maxBodyLen === 'number' && opts.maxBodyLen > 0)
            ? Math.floor(opts.maxBodyLen) : 500;
    }
    static create(opts) {
        return new ChatChannel(opts);
    }
    getId() { return this.channelId; }
    // Add a member. No-op if already present.
    join(id, now) {
        if (typeof id !== 'string' || id.length === 0)
            return false;
        if (typeof now !== 'number' || !isFinite(now))
            return false;
        if (this.members.has(id))
            return false;
        this.members.set(id, { id: id, joinedAt: now, recentSendsAt: [] });
        return true;
    }
    // Remove a member. Returns true if they were present.
    leave(id) {
        return this.members.delete(id);
    }
    hasMember(id) { return this.members.has(id); }
    memberCount() { return this.members.size; }
    members$() {
        var out = [];
        var iter = this.members.values();
        var v = iter.next();
        while (!v.done) {
            out.push({
                id: v.value.id,
                joinedAt: v.value.joinedAt,
                recentSendsAt: v.value.recentSendsAt.slice(),
            });
            v = iter.next();
        }
        return out;
    }
    // Install a filter. Multiple filters chain (all must pass for the
    // message to land). Filters MAY transform the message (return a
    // new ChatMessage object) or DROP it (return null).
    installFilter(fn) {
        if (typeof fn !== 'function')
            return;
        this.filters.push(fn);
    }
    // Remove a previously installed filter. Returns true if found.
    uninstallFilter(fn) {
        var i = this.filters.indexOf(fn);
        if (i < 0)
            return false;
        this.filters.splice(i, 1);
        return true;
    }
    filterCount() { return this.filters.length; }
    // Send a message. Returns SendResult; on success, message is
    // appended to history + returned. On failure, reason indicates why.
    send(senderId, body, now, meta) {
        if (typeof senderId !== 'string' || senderId.length === 0) {
            return { ok: false, message: null, reason: 'not-member' };
        }
        if (typeof body !== 'string') {
            return { ok: false, message: null, reason: 'empty' };
        }
        if (typeof now !== 'number' || !isFinite(now)) {
            return { ok: false, message: null, reason: 'empty' };
        }
        var member = this.members.get(senderId);
        if (!member) {
            return { ok: false, message: null, reason: 'not-member' };
        }
        // Built-in trim (linear) - the /^\s+|\s+$/g regex was quadratic (ReDoS) on
        // a body with a long run of whitespace (CodeQL js/polynomial-redos).
        var trimmed = body.trim();
        if (trimmed.length === 0) {
            return { ok: false, message: null, reason: 'empty' };
        }
        if (trimmed.length > this.maxBodyLen) {
            return { ok: false, message: null, reason: 'too-long' };
        }
        // Rate-limit check: count sends within window
        var windowStart = now - this.rateLimitWindowMs;
        var pruned = [];
        for (var i = 0; i < member.recentSendsAt.length; i++) {
            if (member.recentSendsAt[i] > windowStart) {
                pruned.push(member.recentSendsAt[i]);
            }
        }
        member.recentSendsAt = pruned;
        if (pruned.length >= this.rateLimitMessages) {
            return { ok: false, message: null, reason: 'rate-limit' };
        }
        // Build message
        var msg = {
            id: this.nextMessageId++,
            sender: senderId,
            body: trimmed,
            sentAt: now,
        };
        if (meta !== undefined)
            msg.meta = meta;
        // Apply filter chain
        var current = msg;
        for (var f = 0; f < this.filters.length; f++) {
            if (current === null)
                break;
            try {
                current = this.filters[f](current);
            }
            catch (e) {
                // Treat filter exceptions as a drop
                current = null;
            }
        }
        if (current === null) {
            // Don't count toward rate limit on filter drop (consumer's
            // moderation choice should not punish the sender mechanically).
            return { ok: false, message: null, reason: 'filtered' };
        }
        member.recentSendsAt.push(now);
        this.history.push(current);
        if (this.history.length > this.historySize) {
            this.history.shift();
        }
        return { ok: true, message: current };
    }
    // Read-only message history.
    recent(limit) {
        var n = (typeof limit === 'number' && limit > 0)
            ? Math.min(limit, this.history.length) : this.history.length;
        return this.history.slice(this.history.length - n);
    }
    historyLength() { return this.history.length; }
    clearHistory() { this.history.length = 0; }
    // Diagnostics
    getRateLimitMessages() { return this.rateLimitMessages; }
    getRateLimitWindowMs() { return this.rateLimitWindowMs; }
    getHistorySize() { return this.historySize; }
    getMaxBodyLen() { return this.maxBodyLen; }
    // Compute current sends-in-window for a sender (UI hook for
    // "x of N messages used").
    sendsInWindow(senderId, now) {
        var member = this.members.get(senderId);
        if (!member)
            return 0;
        var windowStart = now - this.rateLimitWindowMs;
        var n = 0;
        for (var i = 0; i < member.recentSendsAt.length; i++) {
            if (member.recentSendsAt[i] > windowStart)
                n++;
        }
        return n;
    }
}
// Multi-channel registry. Manages a set of named channels by id.
// Convenience over juggling multiple ChatChannel instances; a chat
// app typically has 5+ channels (global, guild, party, whisper, ...)
// and a single registry simplifies the dispatch.
export class ChatChannelRegistry {
    channels = new Map();
    static create() {
        return new ChatChannelRegistry();
    }
    // Create + register a channel. Throws if id already taken.
    create(opts) {
        if (this.channels.has(opts.id)) {
            throw new Error('ChatChannelRegistry: channel id already exists: ' + opts.id);
        }
        var ch = ChatChannel.create(opts);
        this.channels.set(opts.id, ch);
        return ch;
    }
    get(id) {
        return this.channels.get(id) || null;
    }
    has(id) { return this.channels.has(id); }
    remove(id) { return this.channels.delete(id); }
    count() { return this.channels.size; }
    ids() {
        var out = [];
        var iter = this.channels.keys();
        var v = iter.next();
        while (!v.done) {
            out.push(v.value);
            v = iter.next();
        }
        return out;
    }
    clear() { this.channels.clear(); }
}
// Resource keys for the world's resource registry.
export const RESOURCE_CHAT_CHANNEL = 'chat_channel';
export const RESOURCE_CHAT_CHANNEL_REGISTRY = 'chat_channel_registry';
//# sourceMappingURL=chat-channel.js.map